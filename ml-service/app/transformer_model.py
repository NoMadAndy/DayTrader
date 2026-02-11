"""
Transformer-based Stock Price Prediction Model

Replaces/complements the LSTM model with a Transformer architecture
featuring self-attention for superior long-range pattern recognition.

Architecture:
- Multi-scale 1D CNN encoder for feature extraction at different time scales
- Sinusoidal positional encoding for temporal awareness
- Transformer encoder with multi-head self-attention
- Multi-scale temporal aggregation (short/medium/long term)
- Fully connected output for multi-day price forecast

Advantages over LSTM:
- Self-attention captures long-range dependencies without vanishing gradients
- Parallel processing of sequence elements (faster training on GPU)
- Multi-scale analysis recognizes patterns at 3, 5, 7, 14 day horizons
- Attention weights provide interpretability (which past days influenced the forecast)

CUDA Support:
- Automatically uses GPU if available
- Falls back to CPU for inference if needed
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from typing import Tuple, List, Optional, Dict
import os
import json
import logging
from datetime import datetime

from .config import settings

logger = logging.getLogger(__name__)


# =============================================================================
# Transformer Architecture Components
# =============================================================================

class PositionalEncoding(nn.Module):
    """
    Sinusoidal positional encoding for time series data.
    Helps the model understand temporal position within the sequence.
    """

    def __init__(self, d_model: int, max_len: int = 5000, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)

        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # [1, max_len, d_model]
        self.register_buffer("pe", pe)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.pe[:, : x.size(1), :]
        return self.dropout(x)


class MultiScaleCNN(nn.Module):
    """
    Multi-scale 1D CNN for extracting features at different temporal scales.
    Parallel convolutions with kernel sizes 3, 5, 7, 14 capture
    short-term to medium-term price patterns.
    """

    def __init__(self, in_channels: int, out_channels: int = 64):
        super().__init__()
        self.conv3 = nn.Conv1d(in_channels, out_channels, kernel_size=3, padding="same")
        self.conv5 = nn.Conv1d(in_channels, out_channels, kernel_size=5, padding="same")
        self.conv7 = nn.Conv1d(in_channels, out_channels, kernel_size=7, padding="same")
        self.conv14 = nn.Conv1d(in_channels, out_channels, kernel_size=14, padding="same")

        self.bn3 = nn.BatchNorm1d(out_channels)
        self.bn5 = nn.BatchNorm1d(out_channels)
        self.bn7 = nn.BatchNorm1d(out_channels)
        self.bn14 = nn.BatchNorm1d(out_channels)

        self.projection = nn.Linear(out_channels * 4, out_channels * 4)
        self.layer_norm = nn.LayerNorm(out_channels * 4)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: [batch, seq_len, features] -> transpose for Conv1d
        x = x.transpose(1, 2)  # [batch, features, seq_len]

        out3 = F.relu(self.bn3(self.conv3(x)))
        out5 = F.relu(self.bn5(self.conv5(x)))
        out7 = F.relu(self.bn7(self.conv7(x)))
        out14 = F.relu(self.bn14(self.conv14(x)))

        out = torch.cat([out3, out5, out7, out14], dim=1)  # [batch, 4*out_ch, seq_len]
        out = out.transpose(1, 2)  # [batch, seq_len, 4*out_ch]

        out = self.projection(out)
        out = self.layer_norm(out)
        return out


class TransformerPricePredictionModel(nn.Module):
    """
    Transformer model for stock price prediction.

    Architecture:
    1. Multi-scale CNN → extract features at 3/5/7/14 day scales
    2. Projection → d_model dimensions
    3. Positional Encoding → temporal awareness
    4. N × Transformer Encoder layers (multi-head self-attention)
    5. Multi-scale temporal aggregation (short/medium/long windows)
    6. FC output → forecast_days predictions

    Args:
        input_size: Number of input features per timestep
        d_model: Transformer model dimension (default: 128)
        n_heads: Number of attention heads (default: 4)
        n_layers: Number of transformer encoder layers (default: 3)
        d_ff: Feedforward network dimension (default: 256)
        dropout: Dropout rate (default: 0.1)
        output_size: Number of forecast days (default: 14)
        seq_len: Input sequence length (default: 60)
    """

    def __init__(
        self,
        input_size: int,
        d_model: int = 128,
        n_heads: int = 4,
        n_layers: int = 3,
        d_ff: int = 256,
        dropout: float = 0.1,
        output_size: int = 14,
        seq_len: int = 60,
    ):
        super().__init__()

        self.input_size = input_size
        self.d_model = d_model
        self.seq_len = seq_len
        self.output_size = output_size

        # Multi-scale CNN encoder
        cnn_out_channels = 64
        cnn_total_out = cnn_out_channels * 4  # 256

        self.cnn_encoder = MultiScaleCNN(input_size, out_channels=cnn_out_channels)

        # Project CNN output to d_model
        self.input_projection = nn.Linear(cnn_total_out, d_model)

        # Positional encoding
        self.pos_encoding = PositionalEncoding(d_model, max_len=seq_len, dropout=dropout)

        # Transformer encoder layers
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            batch_first=True,
            activation="gelu",
        )
        self.transformer_encoder = nn.TransformerEncoder(
            encoder_layer, num_layers=n_layers
        )

        # Multi-scale temporal aggregation
        # Short (last 5), Medium (last 20), Long (all) → 3 * d_model
        self.short_pool = nn.AdaptiveAvgPool1d(1)
        self.medium_pool = nn.AdaptiveAvgPool1d(1)
        self.long_pool = nn.AdaptiveAvgPool1d(1)

        aggregated_dim = d_model * 3

        # Output head for price prediction
        self.output_head = nn.Sequential(
            nn.Linear(aggregated_dim, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model // 2, output_size),
        )

        self._initialize_weights()

    def _initialize_weights(self):
        """Xavier/Kaiming initialization for stable training."""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.Conv1d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, (nn.BatchNorm1d, nn.LayerNorm)):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.

        Args:
            x: [batch, seq_len, input_size]

        Returns:
            [batch, output_size] predicted values
        """
        # 1. Multi-scale CNN encoding
        x = self.cnn_encoder(x)  # [batch, seq_len, 256]

        # 2. Project to d_model
        x = self.input_projection(x)  # [batch, seq_len, d_model]

        # 3. Positional encoding
        x = self.pos_encoding(x)  # [batch, seq_len, d_model]

        # 4. Transformer encoder
        x = self.transformer_encoder(x)  # [batch, seq_len, d_model]

        # 5. Multi-scale temporal aggregation
        seq_len = x.size(1)
        x_t = x.transpose(1, 2)  # [batch, d_model, seq_len]

        short_window = min(5, seq_len)
        medium_window = min(20, seq_len)

        short_feat = self.short_pool(x_t[:, :, -short_window:]).squeeze(-1)
        medium_feat = self.medium_pool(x_t[:, :, -medium_window:]).squeeze(-1)
        long_feat = self.long_pool(x_t).squeeze(-1)

        aggregated = torch.cat([short_feat, medium_feat, long_feat], dim=-1)

        # 6. Output prediction
        predictions = self.output_head(aggregated)  # [batch, output_size]

        return predictions

    def get_parameter_count(self) -> dict:
        """Get detailed parameter count breakdown."""
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)

        return {
            "total": total,
            "trainable": trainable,
            "cnn_encoder": sum(p.numel() for p in self.cnn_encoder.parameters()),
            "transformer_encoder": sum(
                p.numel() for p in self.transformer_encoder.parameters()
            ),
            "output_head": sum(p.numel() for p in self.output_head.parameters()),
        }

    def get_attention_weights(self, x: torch.Tensor) -> List[torch.Tensor]:
        """
        Extract attention weights for interpretability.

        Returns list of attention weight matrices, one per layer.
        """
        attention_weights = []

        # Forward through CNN + projection + positional encoding
        x = self.cnn_encoder(x)
        x = self.input_projection(x)
        x = self.pos_encoding(x)

        # Manually iterate through encoder layers to capture attention
        for layer in self.transformer_encoder.layers:
            # Self-attention with output_weights
            attn_output, attn_weights = layer.self_attn(
                x, x, x, need_weights=True, average_attn_weights=False
            )
            attention_weights.append(attn_weights.detach().cpu())

            # Complete the forward pass of this layer
            x = layer.norm1(x + layer.dropout1(attn_output))
            ff_output = layer.linear2(
                layer.dropout(layer.activation(layer.linear1(x)))
            )
            x = layer.norm2(x + layer.dropout2(ff_output))

        return attention_weights


# =============================================================================
# High-Level Predictor (same interface as StockPredictor)
# =============================================================================


class TransformerStockPredictor:
    """
    High-level interface for Transformer-based stock price prediction.

    Drop-in replacement for StockPredictor (LSTM) with the same API:
    - prepare_data() / train() / predict() / save() / load()

    The model_info in predict() response includes type='transformer'
    so consumers can distinguish model types.
    """

    def __init__(self, symbol: str, use_cuda: Optional[bool] = None):
        self.symbol = symbol
        self.model_type = "transformer"

        # Device selection
        if use_cuda is True:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            if self.device == "cpu":
                logger.warning("CUDA requested but not available, falling back to CPU")
        elif use_cuda is False:
            self.device = "cpu"
        else:
            self.device = str(settings.device)

        logger.info(
            f"TransformerStockPredictor for {symbol} using device: {self.device}"
        )

        self.model: Optional[TransformerPricePredictionModel] = None
        self.scaler_X = MinMaxScaler()
        self.scaler_y = MinMaxScaler()
        self.feature_names: List[str] = []
        self.is_trained = False
        self.training_history: List[dict] = []
        self.model_metadata: dict = {}

        # Transformer hyperparameters (configurable via env or train() call)
        self.d_model = int(os.getenv("ML_TRANSFORMER_D_MODEL", "128"))
        self.n_heads = int(os.getenv("ML_TRANSFORMER_N_HEADS", "4"))
        self.n_layers = int(os.getenv("ML_TRANSFORMER_N_LAYERS", "3"))
        self.d_ff = int(os.getenv("ML_TRANSFORMER_D_FF", "256"))
        self.transformer_dropout = float(
            os.getenv("ML_TRANSFORMER_DROPOUT", "0.1")
        )

    def _calculate_technical_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate technical indicators — identical to LSTM version for
        consistent feature engineering across model types.
        """
        df = df.copy()

        # Price returns
        df["returns"] = df["close"].pct_change()
        df["log_returns"] = np.log(df["close"] / df["close"].shift(1))

        # Moving averages
        for window in [5, 10, 20, 50]:
            df[f"sma_{window}"] = df["close"].rolling(window=window).mean()
            df[f"ema_{window}"] = df["close"].ewm(span=window).mean()
            df[f"sma_{window}_ratio"] = df["close"] / df[f"sma_{window}"]

        # RSI
        delta = df["close"].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df["rsi"] = 100 - (100 / (1 + rs))

        # MACD
        ema12 = df["close"].ewm(span=12).mean()
        ema26 = df["close"].ewm(span=26).mean()
        df["macd"] = ema12 - ema26
        df["macd_signal"] = df["macd"].ewm(span=9).mean()
        df["macd_hist"] = df["macd"] - df["macd_signal"]

        # Bollinger Bands
        df["bb_middle"] = df["close"].rolling(window=20).mean()
        bb_std = df["close"].rolling(window=20).std()
        df["bb_upper"] = df["bb_middle"] + (bb_std * 2)
        df["bb_lower"] = df["bb_middle"] - (bb_std * 2)
        df["bb_width"] = (df["bb_upper"] - df["bb_lower"]) / df["bb_middle"]
        df["bb_position"] = (df["close"] - df["bb_lower"]) / (
            df["bb_upper"] - df["bb_lower"]
        )

        # Volume indicators
        df["volume_sma"] = df["volume"].rolling(window=20).mean()
        df["volume_ratio"] = df["volume"] / df["volume_sma"]

        # Volatility
        df["volatility"] = df["returns"].rolling(window=20).std()

        # High-Low range
        df["hl_range"] = (df["high"] - df["low"]) / df["close"]

        # Price momentum
        for period in [5, 10, 20]:
            df[f"momentum_{period}"] = df["close"] / df["close"].shift(period) - 1

        return df

    def _prepare_features(self, df: pd.DataFrame) -> Tuple[np.ndarray, List[str]]:
        """Prepare feature matrix from dataframe."""
        df = self._calculate_technical_indicators(df)

        feature_columns = [
            "close", "open", "high", "low", "volume",
            "returns", "log_returns",
            "sma_5_ratio", "sma_10_ratio", "sma_20_ratio", "sma_50_ratio",
            "rsi", "macd", "macd_signal", "macd_hist",
            "bb_width", "bb_position",
            "volume_ratio", "volatility", "hl_range",
            "momentum_5", "momentum_10", "momentum_20",
        ]

        feature_columns = [c for c in feature_columns if c in df.columns]
        df_clean = df[feature_columns].dropna()

        return df_clean.values, feature_columns

    def _create_sequences(
        self,
        X: np.ndarray,
        y: np.ndarray,
        sequence_length: int,
        forecast_days: int,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Create sequences for training."""
        X_seq, y_seq = [], []
        for i in range(len(X) - sequence_length - forecast_days + 1):
            X_seq.append(X[i : i + sequence_length])
            y_seq.append(y[i + sequence_length : i + sequence_length + forecast_days])
        return np.array(X_seq), np.array(y_seq)

    def prepare_data(
        self,
        ohlcv_data: List[dict],
        sequence_length: Optional[int] = None,
        forecast_days: Optional[int] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Prepare data for training — same interface as LSTM."""
        seq_len = sequence_length or settings.sequence_length
        fc_days = forecast_days or settings.forecast_days

        df = pd.DataFrame(ohlcv_data)
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        df = df.sort_values("timestamp").reset_index(drop=True)

        X, self.feature_names = self._prepare_features(df)

        close_idx = self.feature_names.index("close")
        y = X[:, close_idx]

        X_scaled = self.scaler_X.fit_transform(X)
        y_scaled = self.scaler_y.fit_transform(y.reshape(-1, 1)).flatten()

        X_seq, _ = self._create_sequences(X_scaled, y_scaled, seq_len, fc_days)

        y_targets = []
        for i in range(len(X_seq)):
            start_idx = seq_len + i
            end_idx = start_idx + fc_days
            if end_idx <= len(y_scaled):
                y_targets.append(y_scaled[start_idx:end_idx])

        y_seq = np.array(y_targets[: len(X_seq)])
        X_seq = X_seq[: len(y_seq)]

        split_idx = int(len(X_seq) * 0.8)

        X_train = torch.FloatTensor(X_seq[:split_idx]).to(self.device)
        y_train = torch.FloatTensor(y_seq[:split_idx]).to(self.device)
        X_val = torch.FloatTensor(X_seq[split_idx:]).to(self.device)
        y_val = torch.FloatTensor(y_seq[split_idx:]).to(self.device)

        return X_train, y_train, X_val, y_val

    def train(
        self,
        ohlcv_data: List[dict],
        epochs: Optional[int] = None,
        learning_rate: Optional[float] = None,
        sequence_length: Optional[int] = None,
        forecast_days: Optional[int] = None,
        early_stopping_patience: int = 15,
    ) -> dict:
        """
        Train the Transformer model on historical data.
        Same interface as StockPredictor.train().
        """
        epochs = epochs or settings.epochs
        learning_rate = learning_rate or settings.learning_rate

        self._train_sequence_length = sequence_length or settings.sequence_length
        self._train_forecast_days = forecast_days or settings.forecast_days

        print(
            f"[ML Transformer Training] symbol={self.symbol}, epochs={epochs}, "
            f"lr={learning_rate}, seq_len={self._train_sequence_length}, "
            f"forecast_days={self._train_forecast_days}, device={self.device}"
        )
        print(
            f"[ML Transformer Training] Architecture: d_model={self.d_model}, "
            f"n_heads={self.n_heads}, n_layers={self.n_layers}, d_ff={self.d_ff}"
        )

        # Prepare data
        X_train, y_train, X_val, y_val = self.prepare_data(
            ohlcv_data,
            sequence_length=self._train_sequence_length,
            forecast_days=self._train_forecast_days,
        )

        input_size = X_train.shape[2]

        # Create Transformer model
        self.model = TransformerPricePredictionModel(
            input_size=input_size,
            d_model=self.d_model,
            n_heads=self.n_heads,
            n_layers=self.n_layers,
            d_ff=self.d_ff,
            dropout=self.transformer_dropout,
            output_size=self._train_forecast_days,
            seq_len=self._train_sequence_length,
        ).to(self.device)

        param_count = self.model.get_parameter_count()
        print(f"[ML Transformer Training] Parameters: {param_count['total']:,} total")

        # Loss, optimizer, scheduler
        criterion = nn.MSELoss()
        optimizer = torch.optim.AdamW(
            self.model.parameters(),
            lr=learning_rate,
            weight_decay=1e-5,
        )
        scheduler = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(
            optimizer, T_0=20, T_mult=2, eta_min=learning_rate * 0.01
        )

        # Training loop
        self.training_history = []
        best_val_loss = float("inf")
        patience_counter = 0
        best_model_state = None

        training_start = datetime.now()

        for epoch in range(epochs):
            # Training phase
            self.model.train()
            optimizer.zero_grad()

            train_pred = self.model(X_train)
            train_loss = criterion(train_pred, y_train)

            train_loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            optimizer.step()
            scheduler.step(epoch + train_loss.item())

            # Validation phase
            self.model.eval()
            with torch.no_grad():
                val_pred = self.model(X_val)
                val_loss = criterion(val_pred, y_val)

            self.training_history.append(
                {
                    "epoch": epoch + 1,
                    "train_loss": train_loss.item(),
                    "val_loss": val_loss.item(),
                    "lr": optimizer.param_groups[0]["lr"],
                }
            )

            # Early stopping
            if val_loss < best_val_loss:
                best_val_loss = val_loss.item()
                patience_counter = 0
                best_model_state = {
                    k: v.clone() for k, v in self.model.state_dict().items()
                }
            else:
                patience_counter += 1

            if patience_counter >= early_stopping_patience:
                print(f"[ML Transformer] Early stopping at epoch {epoch + 1}")
                break

        # Restore best model
        if best_model_state is not None:
            self.model.load_state_dict(best_model_state)

        training_end = datetime.now()

        self.is_trained = True
        self.model_metadata = {
            "symbol": self.symbol,
            "type": "transformer",
            "trained_at": training_end.isoformat(),
            "training_duration_seconds": (training_end - training_start).total_seconds(),
            "epochs_completed": len(self.training_history),
            "final_train_loss": self.training_history[-1]["train_loss"],
            "final_val_loss": self.training_history[-1]["val_loss"],
            "best_val_loss": best_val_loss,
            "device": str(self.device),
            "input_features": self.feature_names,
            "sequence_length": self._train_sequence_length,
            "forecast_days": self._train_forecast_days,
            "data_points": len(ohlcv_data),
            "architecture": {
                "d_model": self.d_model,
                "n_heads": self.n_heads,
                "n_layers": self.n_layers,
                "d_ff": self.d_ff,
                "dropout": self.transformer_dropout,
                "parameters": self.model.get_parameter_count(),
            },
        }

        return {
            "success": True,
            "metadata": self.model_metadata,
            "history": self.training_history,
        }

    def predict(self, ohlcv_data: List[dict]) -> dict:
        """
        Generate price predictions — same interface as LSTM version.
        Output includes type='transformer' in model_info.
        """
        if not self.is_trained or self.model is None:
            raise ValueError("Model not trained. Call train() first.")

        df = pd.DataFrame(ohlcv_data)
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        df = df.sort_values("timestamp").reset_index(drop=True)

        X, _ = self._prepare_features(df)
        X_scaled = self.scaler_X.transform(X)

        seq_len = self.model_metadata.get("sequence_length", settings.sequence_length)
        if len(X_scaled) < seq_len:
            raise ValueError(f"Need at least {seq_len} data points")

        last_sequence = X_scaled[-seq_len:]
        X_input = torch.FloatTensor(last_sequence).unsqueeze(0).to(self.device)

        self.model.eval()
        with torch.no_grad():
            predictions_scaled = self.model(X_input).cpu().numpy()[0]

        # Inverse transform
        predictions_raw = self.scaler_y.inverse_transform(
            predictions_scaled.reshape(-1, 1)
        ).flatten()

        current_price = ohlcv_data[-1]["close"]

        # Sanity-clamp predictions
        predictions = []
        for pred in predictions_raw:
            change_pct = (pred - current_price) / current_price
            if abs(change_pct) > 0.5:
                logger.warning(
                    f"Prediction {pred:.2f} is {change_pct*100:.1f}% from "
                    f"current price {current_price:.2f}, clamping"
                )
                max_change = 0.20
                pred = current_price * (1 + max_change if change_pct > 0 else 1 - max_change)
            predictions.append(pred)

        # Confidence (decreases with horizon, Transformer retains more confidence further out)
        confidences = []
        for i, pred in enumerate(predictions):
            # Transformer has better long-range confidence than LSTM
            base_confidence = max(0.55, 1.0 - (i * 0.025))
            change_pct = abs(pred - current_price) / current_price
            change_penalty = min(0.25, change_pct)
            confidence = max(0.35, base_confidence - change_penalty)
            confidences.append(confidence)

        last_date = pd.to_datetime(ohlcv_data[-1]["timestamp"], unit="ms")
        prediction_dates = [
            (last_date + pd.Timedelta(days=i + 1)).isoformat()
            for i in range(len(predictions))
        ]

        return {
            "symbol": self.symbol,
            "current_price": current_price,
            "predictions": [
                {
                    "date": date,
                    "day": i + 1,
                    "predicted_price": float(pred),
                    "confidence": float(conf),
                    "change_pct": float(
                        (pred - current_price) / current_price * 100
                    ),
                }
                for i, (date, pred, conf) in enumerate(
                    zip(prediction_dates, predictions, confidences)
                )
            ],
            "model_info": self.model_metadata,
            "generated_at": datetime.now().isoformat(),
        }

    def save(self, path: Optional[str] = None) -> str:
        """Save model to disk."""
        if not self.is_trained:
            raise ValueError("Model not trained")

        os.makedirs(settings.model_dir, exist_ok=True)
        path = path or os.path.join(settings.model_dir, f"{self.symbol}_transformer.pt")

        save_dict = {
            "model_state": self.model.state_dict(),
            "scaler_X": self.scaler_X,
            "scaler_y": self.scaler_y,
            "feature_names": self.feature_names,
            "metadata": self.model_metadata,
            "config": {
                "sequence_length": self.model_metadata.get(
                    "sequence_length", settings.sequence_length
                ),
                "forecast_days": self.model_metadata.get(
                    "forecast_days", settings.forecast_days
                ),
            },
            "architecture": {
                "d_model": self.d_model,
                "n_heads": self.n_heads,
                "n_layers": self.n_layers,
                "d_ff": self.d_ff,
                "dropout": self.transformer_dropout,
            },
        }

        torch.save(save_dict, path)
        logger.info(f"Transformer model saved to {path}")
        return path

    def load(self, path: Optional[str] = None) -> bool:
        """Load model from disk."""
        path = path or os.path.join(settings.model_dir, f"{self.symbol}_transformer.pt")

        if not os.path.exists(path):
            return False

        save_dict = torch.load(path, map_location=self.device, weights_only=False)

        self.scaler_X = save_dict["scaler_X"]
        self.scaler_y = save_dict["scaler_y"]
        self.feature_names = save_dict["feature_names"]
        self.model_metadata = save_dict["metadata"]

        # Restore architecture params
        arch = save_dict.get("architecture", {})
        self.d_model = arch.get("d_model", 128)
        self.n_heads = arch.get("n_heads", 4)
        self.n_layers = arch.get("n_layers", 3)
        self.d_ff = arch.get("d_ff", 256)
        self.transformer_dropout = arch.get("dropout", 0.1)

        input_size = len(self.feature_names)
        forecast_days = self.model_metadata.get("forecast_days", settings.forecast_days)
        seq_len = self.model_metadata.get("sequence_length", settings.sequence_length)

        self.model = TransformerPricePredictionModel(
            input_size=input_size,
            d_model=self.d_model,
            n_heads=self.n_heads,
            n_layers=self.n_layers,
            d_ff=self.d_ff,
            dropout=self.transformer_dropout,
            output_size=forecast_days,
            seq_len=seq_len,
        ).to(self.device)

        self.model.load_state_dict(save_dict["model_state"])
        self.model.eval()
        self.is_trained = True

        logger.info(
            f"Transformer model loaded from {path} "
            f"({self.model.get_parameter_count()['total']:,} params)"
        )
        return True
