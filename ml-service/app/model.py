"""
LSTM-based Stock Price Prediction Model

This module implements a multi-layer LSTM neural network for time series
forecasting of stock prices. It uses historical OHLCV data and technical
indicators as features.

Architecture:
- Input: sequence of features (price, volume, technical indicators)
- LSTM layers with dropout for regularization
- Fully connected output layer for price prediction

CUDA Support:
- Automatically uses GPU if available
- Falls back to CPU for inference if needed
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from typing import Tuple, List, Optional, Iterator
import os
import json
import logging
from datetime import datetime

from .config import settings
from .cross_asset_features import CrossAssetFeatureProvider
from .feature_selector import FeatureSelector

# Setup logger
logger = logging.getLogger(__name__)


class DirectionalTradingLoss(nn.Module):
    """
    Combined MSE + directional-accuracy loss for time-series price forecasting.

    Penalises predictions whose day-over-day sign disagrees with the true
    direction more heavily than pure MSE, encouraging the model to get
    trend direction right in addition to minimising absolute error.

    Args:
        direction_weight: Weight on the directional penalty term (default 0.3).
        mse_weight: Weight on the standard MSE term (default 0.7).
    """

    def __init__(self, direction_weight: float = 0.3, mse_weight: float = 0.7):
        super().__init__()
        self.direction_weight = direction_weight
        self.mse_weight = mse_weight

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        # Standard MSE component
        mse = F.mse_loss(pred, target)

        # Directional component: compare consecutive-day sign agreement.
        # pred/target shape: (batch, forecast_days)
        if pred.shape[1] > 1:
            pred_changes = pred[:, 1:] - pred[:, :-1]
            target_changes = target[:, 1:] - target[:, :-1]
            # +1 when signs agree, -1 when they disagree
            direction_match = torch.sign(pred_changes) * torch.sign(target_changes)
            # Normalise to [0, 1]: 0 = perfect, 1 = always wrong
            direction_loss = (1.0 - direction_match).mean() / 2.0
        else:
            direction_loss = torch.tensor(0.0, device=pred.device)

        return self.mse_weight * mse + self.direction_weight * direction_loss


class LSTMModel(nn.Module):
    """
    Multi-layer LSTM model for stock price prediction
    
    Architecture:
    - Input layer: (batch, sequence, features)
    - LSTM layers: configurable depth and hidden size
    - Dropout layers for regularization
    - Fully connected output: predicts next N days
    """
    
    def __init__(
        self,
        input_size: int,
        hidden_size: int = 128,
        num_layers: int = 2,
        output_size: int = 14,  # Forecast days
        dropout: float = 0.2
    ):
        super().__init__()
        
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        
        # LSTM layers
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0
        )
        
        # Fully connected layers
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 2, output_size)
        )
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass
        
        Args:
            x: Input tensor of shape (batch, sequence, features)
            
        Returns:
            Predictions of shape (batch, output_size)
        """
        # LSTM forward
        lstm_out, _ = self.lstm(x)
        
        # Take the last time step's output
        last_output = lstm_out[:, -1, :]
        
        # Fully connected layers
        predictions = self.fc(last_output)
        
        return predictions


class StockPredictor:
    """
    High-level interface for stock price prediction
    
    Handles:
    - Data preprocessing (feature engineering, scaling)
    - Model training with early stopping
    - Prediction with confidence intervals
    - Model persistence (save/load)
    """
    
    def __init__(self, symbol: str, use_cuda: Optional[bool] = None,
                 use_cross_asset_features: bool = False,
                 use_feature_selection: bool = False):
        self.symbol = symbol
        
        # Determine device based on use_cuda parameter
        if use_cuda is True:
            if torch.cuda.is_available():
                self.device = "cuda"
            else:
                logger.warning(f"CUDA requested but not available, falling back to CPU")
                self.device = "cpu"
        elif use_cuda is False:
            self.device = "cpu"
        else:
            # None: use default from settings
            self.device = settings.device
            
        logger.info(f"StockPredictor for {symbol} using device: {self.device} (requested: {use_cuda})")
        
        self.model: Optional[LSTMModel] = None
        self.scaler_X = MinMaxScaler()
        self.scaler_y = MinMaxScaler()
        self.feature_names: List[str] = []
        self.is_trained = False
        self.training_history: List[dict] = []
        self.model_metadata: dict = {}

        # Optional enrichment / pruning flags
        self.use_cross_asset_features: bool = use_cross_asset_features
        self.use_feature_selection: bool = use_feature_selection
        self._cross_asset_provider: Optional[CrossAssetFeatureProvider] = (
            CrossAssetFeatureProvider(cache_ttl_seconds=settings.cross_asset_cache_ttl)
            if use_cross_asset_features
            else None
        )
        self._feature_selector: Optional[FeatureSelector] = None
        
    def _calculate_technical_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate technical indicators as additional features
        
        Features:
        - Price changes (returns)
        - Moving averages (SMA, EMA)
        - RSI
        - MACD
        - Bollinger Bands
        - Volume indicators
        """
        # Make a copy to avoid modifying original
        df = df.copy()
        
        # Price returns
        df['returns'] = df['close'].pct_change()
        df['log_returns'] = np.log(df['close'] / df['close'].shift(1))
        
        # Moving averages
        for window in [5, 10, 20, 50]:
            df[f'sma_{window}'] = df['close'].rolling(window=window).mean()
            df[f'ema_{window}'] = df['close'].ewm(span=window).mean()
            df[f'sma_{window}_ratio'] = df['close'] / df[f'sma_{window}']
        
        # RSI
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['rsi'] = 100 - (100 / (1 + rs))
        
        # MACD
        ema12 = df['close'].ewm(span=12).mean()
        ema26 = df['close'].ewm(span=26).mean()
        df['macd'] = ema12 - ema26
        df['macd_signal'] = df['macd'].ewm(span=9).mean()
        df['macd_hist'] = df['macd'] - df['macd_signal']
        
        # Bollinger Bands
        df['bb_middle'] = df['close'].rolling(window=20).mean()
        bb_std = df['close'].rolling(window=20).std()
        df['bb_upper'] = df['bb_middle'] + (bb_std * 2)
        df['bb_lower'] = df['bb_middle'] - (bb_std * 2)
        df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']
        df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
        
        # Volume indicators
        df['volume_sma'] = df['volume'].rolling(window=20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_sma']
        
        # Volatility
        df['volatility'] = df['returns'].rolling(window=20).std()
        
        # High-Low range
        df['hl_range'] = (df['high'] - df['low']) / df['close']
        
        # Price momentum
        for period in [5, 10, 20]:
            df[f'momentum_{period}'] = df['close'] / df['close'].shift(period) - 1
        
        return df
    
    def _prepare_features(self, df: pd.DataFrame) -> Tuple[np.ndarray, List[str]]:
        """
        Prepare feature matrix from dataframe
        
        Returns:
            Tuple of (feature_matrix, feature_names)
        """
        # Calculate indicators
        df = self._calculate_technical_indicators(df)
        
        # Select features
        feature_columns = [
            'close', 'open', 'high', 'low', 'volume',
            'returns', 'log_returns',
            'sma_5_ratio', 'sma_10_ratio', 'sma_20_ratio', 'sma_50_ratio',
            'rsi', 'macd', 'macd_signal', 'macd_hist',
            'bb_width', 'bb_position',
            'volume_ratio', 'volatility', 'hl_range',
            'momentum_5', 'momentum_10', 'momentum_20'
        ]
        
        # Filter to existing columns
        feature_columns = [c for c in feature_columns if c in df.columns]
        
        # Drop NaN rows
        df_clean = df[feature_columns].dropna()

        # Optionally enrich with cross-asset features
        if self._cross_asset_provider is not None:
            try:
                # Reconstruct a DatetimeIndex aligned to the cleaned rows
                if 'timestamp' in df.columns:
                    dates = pd.to_datetime(df['timestamp']).iloc[df_clean.index]
                else:
                    dates = df_clean.index
                cross_df = self._cross_asset_provider.get_cross_asset_features(
                    self.symbol, pd.DatetimeIndex(dates)
                )
                if cross_df is not None and not cross_df.empty:
                    # Reset to positional index for safe concatenation
                    cross_df = cross_df.reset_index(drop=True)
                    df_clean = df_clean.reset_index(drop=True)
                    # Align lengths
                    min_len = min(len(df_clean), len(cross_df))
                    df_clean = df_clean.iloc[:min_len].copy()
                    cross_vals = cross_df.iloc[:min_len]
                    new_cols = {col: cross_vals[col].values for col in cross_df.columns}
                    df_clean = df_clean.assign(**new_cols)
                    for col in cross_df.columns:
                        if col not in feature_columns:
                            feature_columns.append(col)
            except Exception as exc:
                logger.warning(f"StockPredictor: cross-asset feature enrichment failed: {exc}")

        return df_clean.values, [c for c in feature_columns if c in df_clean.columns]
    
    def _create_sequences(
        self,
        X: np.ndarray,
        y: np.ndarray,
        sequence_length: int,
        forecast_days: int
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Create sequences for LSTM training
        
        Args:
            X: Feature matrix (samples, features)
            y: Target values (samples, forecast_days)
            sequence_length: Number of time steps in each sequence
            forecast_days: Number of days to forecast
            
        Returns:
            Tuple of (X_sequences, y_sequences)
        """
        X_seq, y_seq = [], []
        
        for i in range(len(X) - sequence_length - forecast_days + 1):
            X_seq.append(X[i:i + sequence_length])
            y_seq.append(y[i + sequence_length:i + sequence_length + forecast_days])
        
        return np.array(X_seq), np.array(y_seq)
    
    def prepare_data(
        self,
        ohlcv_data: List[dict],
        sequence_length: Optional[int] = None,
        forecast_days: Optional[int] = None
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Prepare data for training
        
        Args:
            ohlcv_data: List of OHLCV dictionaries with keys:
                       timestamp, open, high, low, close, volume
            sequence_length: Number of time steps in each sequence (default from settings)
            forecast_days: Number of days to forecast (default from settings)
                       
        Returns:
            Tuple of (X_train, y_train, X_val, y_val) tensors
        """
        seq_len = sequence_length or settings.sequence_length
        fc_days = forecast_days or settings.forecast_days
        
        # Convert to DataFrame
        df = pd.DataFrame(ohlcv_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df = df.sort_values('timestamp').reset_index(drop=True)
        
        # Prepare features
        X, self.feature_names = self._prepare_features(df)

        # Target: future close prices
        close_idx = self.feature_names.index('close')
        y = X[:, close_idx]

        # --- Scaler fix: split raw data FIRST, then fit scaler on training
        # portion only.  Fitting on all data (including validation) leaks
        # future min/max statistics into training. ---
        train_end = int(len(X) * 0.8)
        X_train_raw, X_val_raw = X[:train_end], X[train_end:]
        y_train_raw, y_val_raw = y[:train_end], y[train_end:]

        # Optional feature selection (fit on training data only, then transform both)
        if self.use_feature_selection:
            try:
                max_f = settings.feature_selection_max_features or None
                corr_t = settings.feature_selection_correlation_threshold
                self._feature_selector = FeatureSelector(
                    correlation_threshold=corr_t,
                    max_features=max_f,
                )
                X_train_raw, selected_names = self._feature_selector.fit_transform(
                    X_train_raw, y_train_raw, self.feature_names
                )
                X_val_raw, _ = self._feature_selector.transform(X_val_raw, self.feature_names)
                self.feature_names = selected_names
                logger.info(
                    f"StockPredictor: feature selection kept "
                    f"{len(selected_names)} features: {selected_names}"
                )
            except Exception as exc:
                logger.warning(f"StockPredictor: feature selection failed, using all features: {exc}")
                self._feature_selector = None

        X_train_scaled = self.scaler_X.fit_transform(X_train_raw)
        y_train_scaled = self.scaler_y.fit_transform(
            y_train_raw.reshape(-1, 1)
        ).flatten()
        X_val_scaled = self.scaler_X.transform(X_val_raw)
        y_val_scaled = self.scaler_y.transform(
            y_val_raw.reshape(-1, 1)
        ).flatten()

        # Create training sequences
        X_seq_train, y_seq_train = self._create_sequences(
            X_train_scaled, y_train_scaled, seq_len, fc_days
        )

        # For validation sequences, prefix with the last seq_len training
        # points so the first validation window has proper historical context.
        X_val_prefixed = np.concatenate(
            [X_train_scaled[-seq_len:], X_val_scaled], axis=0
        )
        y_val_prefixed = np.concatenate(
            [y_train_scaled[-seq_len:], y_val_scaled]
        )
        X_seq_val, y_seq_val = self._create_sequences(
            X_val_prefixed, y_val_prefixed, seq_len, fc_days
        )

        X_train = torch.FloatTensor(X_seq_train).to(self.device)
        y_train = torch.FloatTensor(y_seq_train).to(self.device)
        X_val = torch.FloatTensor(X_seq_val).to(self.device)
        y_val = torch.FloatTensor(y_seq_val).to(self.device)

        return X_train, y_train, X_val, y_val

    @staticmethod
    def walk_forward_split(
        n_samples: int,
        n_splits: int = 3,
        gap: int = 5,
        min_train_ratio: float = 0.5,
    ) -> Iterator[Tuple[slice, slice]]:
        """
        Purged Walk-Forward Cross-Validation for time series.

        Yields ``(train_slice, val_slice)`` pairs where:

        - Training always starts from index 0 (expanding window).
        - A ``gap`` (embargo) period separates the end of training from the
          start of validation to prevent information leakage.
        - The validation window slides forward with each fold.
        - Each subsequent fold has more training data.

        Args:
            n_samples: Total number of sequences (samples).
            n_splits: Number of cross-validation folds.
            gap: Number of samples between train end and validation start
                 (embargo to prevent leakage).
            min_train_ratio: Minimum fraction of ``n_samples`` each training
                             set must contain.  Folds with fewer samples are
                             skipped.

        Yields:
            Tuple of ``(train_slice, val_slice)`` — both are ``slice`` objects
            that can be used to index arrays directly.
        """
        val_size = int(n_samples * (1 - min_train_ratio) / n_splits)
        for i in range(n_splits):
            val_end = n_samples - (n_splits - 1 - i) * val_size
            val_start = val_end - val_size
            train_end = val_start - gap
            if train_end < int(n_samples * 0.3):  # Require at least 30 % of data for training
                continue
            yield (slice(0, train_end), slice(val_start, val_end))

    def _prepare_all_sequences(
        self,
        ohlcv_data: List[dict],
        sequence_length: Optional[int] = None,
        forecast_days: Optional[int] = None,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Prepare ALL sequences from raw OHLCV data without a train/val split.

        Used internally by :meth:`train` when ``use_walk_forward=True`` so
        that :meth:`walk_forward_split` can define the fold boundaries.

        The scaler is fitted on the initial 80 % of raw data (consistent with
        the single-split path in :meth:`prepare_data`) so that future data
        statistics are never visible during fitting.

        Args:
            ohlcv_data: Historical OHLCV records.
            sequence_length: Sequence window size (defaults to settings).
            forecast_days: Forecast horizon (defaults to settings).

        Returns:
            Tuple ``(X_seq, y_seq)`` of shape
            ``(n_sequences, sequence_length, n_features)`` and
            ``(n_sequences, forecast_days)`` respectively.
        """
        seq_len = sequence_length or settings.sequence_length
        fc_days = forecast_days or settings.forecast_days

        df = pd.DataFrame(ohlcv_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df = df.sort_values('timestamp').reset_index(drop=True)

        X, self.feature_names = self._prepare_features(df)
        close_idx = self.feature_names.index('close')
        y = X[:, close_idx]

        # Fit scaler on the initial training portion only (no leakage)
        init_train_end = int(len(X) * 0.8)
        X_train_init = X[:init_train_end]
        y_train_init = y[:init_train_end]

        # Optional feature selection (fit on training portion only)
        if self.use_feature_selection:
            try:
                max_f = settings.feature_selection_max_features or None
                corr_t = settings.feature_selection_correlation_threshold
                self._feature_selector = FeatureSelector(
                    correlation_threshold=corr_t,
                    max_features=max_f,
                )
                X_train_init, selected_names = self._feature_selector.fit_transform(
                    X_train_init, y_train_init, self.feature_names
                )
                X, _ = self._feature_selector.transform(X, self.feature_names)
                self.feature_names = selected_names
            except Exception as exc:
                logger.warning(
                    f"StockPredictor: walk-forward feature selection failed: {exc}"
                )
                self._feature_selector = None

        self.scaler_X.fit(X_train_init)
        self.scaler_y.fit(y_train_init.reshape(-1, 1))

        X_scaled = self.scaler_X.transform(X)
        y_scaled = self.scaler_y.transform(y.reshape(-1, 1)).flatten()

        X_seq, y_seq = self._create_sequences(X_scaled, y_scaled, seq_len, fc_days)
        return X_seq, y_seq

    def train(
        self,
        ohlcv_data: List[dict],
        epochs: Optional[int] = None,
        learning_rate: Optional[float] = None,
        sequence_length: Optional[int] = None,
        forecast_days: Optional[int] = None,
        early_stopping_patience: int = 10,
        progress_callback=None,
        use_walk_forward: bool = False,
    ) -> dict:
        """
        Train the model on historical data

        Args:
            ohlcv_data: Historical OHLCV data
            epochs: Number of training epochs (default from settings)
            learning_rate: Learning rate (default from settings)
            sequence_length: Number of time steps in each sequence (default from settings)
            forecast_days: Number of days to forecast (default from settings)
            early_stopping_patience: Epochs to wait before early stopping
            progress_callback: Optional callable(epoch, total_epochs, train_loss, val_loss)
            use_walk_forward: When True, use purged walk-forward cross-validation
                              (3 folds) and keep the model with the best average
                              validation loss.  Defaults to False (single 80/20 split).

        Returns:
            Training results dict with loss history and metadata
        """
        epochs = epochs or settings.epochs
        learning_rate = learning_rate or settings.learning_rate

        # Store custom parameters for this training session
        self._train_sequence_length = sequence_length or settings.sequence_length
        self._train_forecast_days = forecast_days or settings.forecast_days

        print(f"[ML Training] Parameters: epochs={epochs}, lr={learning_rate}, "
              f"seq_len={self._train_sequence_length}, forecast_days={self._train_forecast_days}, "
              f"walk_forward={use_walk_forward}")

        # Shared loss function (directional-aware MSE)
        criterion = DirectionalTradingLoss(direction_weight=0.3, mse_weight=0.7)

        training_start = datetime.now()
        self.training_history = []

        if use_walk_forward:
            # ----------------------------------------------------------------
            # Walk-forward cross-validation path
            # ----------------------------------------------------------------
            X_seq, y_seq = self._prepare_all_sequences(
                ohlcv_data,
                sequence_length=self._train_sequence_length,
                forecast_days=self._train_forecast_days,
            )
            input_size = X_seq.shape[2]

            best_overall_val_loss = float('inf')
            best_overall_model_state = None
            fold_results = []

            for fold_idx, (train_sl, val_sl) in enumerate(
                self.walk_forward_split(len(X_seq))
            ):
                X_train_f = torch.FloatTensor(X_seq[train_sl]).to(self.device)
                y_train_f = torch.FloatTensor(y_seq[train_sl]).to(self.device)
                X_val_f = torch.FloatTensor(X_seq[val_sl]).to(self.device)
                y_val_f = torch.FloatTensor(y_seq[val_sl]).to(self.device)

                fold_model = LSTMModel(
                    input_size=input_size,
                    hidden_size=128,
                    num_layers=2,
                    output_size=self._train_forecast_days,
                    dropout=0.2,
                ).to(self.device)

                fold_optimizer = torch.optim.Adam(
                    fold_model.parameters(), lr=learning_rate
                )
                fold_scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
                    fold_optimizer, mode='min', factor=0.5, patience=5
                )

                best_fold_loss = float('inf')
                fold_patience = 0
                best_fold_state = None

                for epoch in range(epochs):
                    fold_model.train()
                    fold_optimizer.zero_grad()
                    train_pred = fold_model(X_train_f)
                    train_loss = criterion(train_pred, y_train_f)
                    train_loss.backward()
                    torch.nn.utils.clip_grad_norm_(
                        fold_model.parameters(), max_norm=1.0
                    )
                    fold_optimizer.step()

                    fold_model.eval()
                    with torch.no_grad():
                        val_pred = fold_model(X_val_f)
                        val_loss = criterion(val_pred, y_val_f)

                    fold_scheduler.step(val_loss)

                    self.training_history.append({
                        'fold': fold_idx + 1,
                        'epoch': epoch + 1,
                        'train_loss': train_loss.item(),
                        'val_loss': val_loss.item(),
                        'lr': fold_optimizer.param_groups[0]['lr'],
                    })

                    if val_loss < best_fold_loss:
                        best_fold_loss = val_loss.item()
                        fold_patience = 0
                        best_fold_state = fold_model.state_dict().copy()
                    else:
                        fold_patience += 1

                    if fold_patience >= early_stopping_patience:
                        print(f"Fold {fold_idx + 1}: early stopping at epoch {epoch + 1}")
                        break

                fold_results.append({
                    'fold': fold_idx + 1,
                    'best_val_loss': best_fold_loss,
                    'train_size': train_sl.stop,
                    'val_size': val_sl.stop - val_sl.start,
                })

                if best_fold_loss < best_overall_val_loss:
                    best_overall_val_loss = best_fold_loss
                    best_overall_model_state = best_fold_state
                    input_size_best = input_size

            # Build final model from best fold's weights
            self.model = LSTMModel(
                input_size=input_size_best,
                hidden_size=128,
                num_layers=2,
                output_size=self._train_forecast_days,
                dropout=0.2,
            ).to(self.device)
            if best_overall_model_state is not None:
                self.model.load_state_dict(best_overall_model_state)
            self.model.eval()

            best_val_loss = best_overall_val_loss

        else:
            # ----------------------------------------------------------------
            # Default single 80/20 split path
            # ----------------------------------------------------------------
            X_train, y_train, X_val, y_val = self.prepare_data(
                ohlcv_data,
                sequence_length=self._train_sequence_length,
                forecast_days=self._train_forecast_days,
            )

            # Initialize model with custom forecast_days
            input_size = X_train.shape[2]  # Number of features
            self.model = LSTMModel(
                input_size=input_size,
                hidden_size=128,
                num_layers=2,
                output_size=self._train_forecast_days,
                dropout=0.2,
            ).to(self.device)

            optimizer = torch.optim.Adam(self.model.parameters(), lr=learning_rate)
            scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
                optimizer, mode='min', factor=0.5, patience=5
            )

            best_val_loss = float('inf')
            patience_counter = 0
            best_model_state = None

            for epoch in range(epochs):
                # Training phase
                self.model.train()
                optimizer.zero_grad()

                train_pred = self.model(X_train)
                train_loss = criterion(train_pred, y_train)

                train_loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
                optimizer.step()

                # Validation phase
                self.model.eval()
                with torch.no_grad():
                    val_pred = self.model(X_val)
                    val_loss = criterion(val_pred, y_val)

                # Learning rate scheduling
                scheduler.step(val_loss)

                # Record history
                self.training_history.append({
                    'epoch': epoch + 1,
                    'train_loss': train_loss.item(),
                    'val_loss': val_loss.item(),
                    'lr': optimizer.param_groups[0]['lr'],
                })

                # Report progress via callback
                if progress_callback:
                    try:
                        progress_callback(epoch + 1, epochs, train_loss.item(), val_loss.item())
                    except Exception:
                        pass  # Don't let callback errors break training

                # Early stopping check
                if val_loss < best_val_loss:
                    best_val_loss = val_loss.item()
                    patience_counter = 0
                    best_model_state = self.model.state_dict().copy()
                else:
                    patience_counter += 1

                if patience_counter >= early_stopping_patience:
                    print(f"Early stopping at epoch {epoch + 1}")
                    break

            # Restore best model
            if best_model_state is not None:
                self.model.load_state_dict(best_model_state)

        training_end = datetime.now()

        self.is_trained = True
        self.model_metadata = {
            'symbol': self.symbol,
            'trained_at': training_end.isoformat(),
            'training_duration_seconds': (training_end - training_start).total_seconds(),
            'epochs_completed': len(self.training_history),
            'final_train_loss': self.training_history[-1]['train_loss'],
            'final_val_loss': self.training_history[-1]['val_loss'],
            'best_val_loss': best_val_loss,
            'device': str(self.device),
            'input_features': self.feature_names,
            'sequence_length': self._train_sequence_length,
            'forecast_days': self._train_forecast_days,
            'data_points': len(ohlcv_data),
            'walk_forward': use_walk_forward,
            'use_cross_asset_features': self.use_cross_asset_features,
            'use_feature_selection': self.use_feature_selection,
            'feature_selection_report': (
                self._feature_selector.get_report()
                if self._feature_selector is not None
                else None
            ),
        }

        return {
            'success': True,
            'metadata': self.model_metadata,
            'history': self.training_history,
        }
    
    def predict(self, ohlcv_data: List[dict], smooth_predictions: bool = False) -> dict:
        """
        Generate price predictions for the next N days.

        Args:
            ohlcv_data: Recent OHLCV data (at least sequence_length points).
            smooth_predictions: When True, apply an exponential moving average
                                (alpha=0.4) over the raw predictions to reduce
                                day-to-day oscillation.  Defaults to False
                                because smoothing introduces a mean-reversion
                                bias that pulls multi-day forecasts toward day 1.

        Returns:
            Prediction results with forecasted prices and confidence.
        """
        if not self.is_trained or self.model is None:
            raise ValueError("Model not trained. Call train() first.")

        # Prepare features
        df = pd.DataFrame(ohlcv_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df = df.sort_values('timestamp').reset_index(drop=True)

        X, feature_names = self._prepare_features(df)

        # Apply feature selection if it was used during training
        if self._feature_selector is not None and self._feature_selector.selected_features_ is not None:
            try:
                X, feature_names = self._feature_selector.transform(X, feature_names)
            except Exception as exc:
                logger.warning(f"StockPredictor: feature selector transform failed in predict: {exc}")

        # Scale using fitted scaler
        X_scaled = self.scaler_X.transform(X)

        # Get the last sequence
        seq_len = self.model_metadata.get('sequence_length', settings.sequence_length)
        if len(X_scaled) < seq_len:
            raise ValueError(f"Need at least {seq_len} data points")

        last_sequence = X_scaled[-seq_len:]
        X_input = torch.FloatTensor(last_sequence).unsqueeze(0).to(self.device)

        # Deterministic forward pass for point estimates
        self.model.eval()
        with torch.no_grad():
            predictions_scaled = self.model(X_input).cpu().numpy()[0]

        # Inverse transform to get actual prices
        predictions_raw = self.scaler_y.inverse_transform(
            predictions_scaled.reshape(-1, 1)
        ).flatten()

        # ----------------------------------------------------------------
        # Volatility-adaptive clamping
        # Historical volatility (60-day rolling std of returns) determines
        # how far each day's forecast may deviate from current price.
        # Bound grows with sqrt(t) for multi-day horizons.
        # ----------------------------------------------------------------
        current_price = ohlcv_data[-1]['close']
        closes = pd.Series([d['close'] for d in ohlcv_data])
        returns = closes.pct_change().dropna()
        if len(returns) > 5:
            # 60-day window matches the default sequence_length; shorter histories use all available data
            hist_vol = returns.rolling(min(60, len(returns))).std().iloc[-1]
            if pd.isna(hist_vol):
                hist_vol = returns.std()
        else:
            hist_vol = 0.02  # Fallback: ~2 % daily vol (typical equity assumption)

        predictions = []
        for i, pred in enumerate(predictions_raw):
            day = i + 1
            # 2.5-sigma (≈99 %) bound that widens with sqrt(horizon).
            # Floor at 2 % (minimum meaningful move), cap at 25 % (extreme event ceiling).
            max_change = float(np.clip(hist_vol * 2.5 * np.sqrt(day), 0.02, 0.25))
            change_pct = (pred - current_price) / current_price
            if abs(change_pct) > max_change:
                logger.warning(
                    f"Prediction day {day}: {pred:.2f} is {change_pct*100:.1f}% "
                    f"from current price {current_price:.2f}, clamping to "
                    f"±{max_change*100:.1f}%"
                )
                pred = current_price * (1 + max_change if change_pct > 0 else 1 - max_change)
            predictions.append(pred)

        # Optional EMA smoothing (off by default to avoid mean-reversion bias)
        if smooth_predictions:
            smoothed = [predictions[0]]
            alpha = 0.4  # Smoothing factor (0=very smooth, 1=no smoothing)
            for i in range(1, len(predictions)):
                smoothed.append(alpha * predictions[i] + (1 - alpha) * smoothed[i - 1])
            predictions = smoothed

        # ----------------------------------------------------------------
        # Monte Carlo Dropout for uncertainty estimation
        # Run n_mc_samples stochastic forward passes with dropout active to
        # measure prediction variance, replacing the previous heuristic.
        # 20 samples balance confidence accuracy vs. inference latency.
        # ----------------------------------------------------------------
        mc_predictions = []
        self.model.train()  # Enable dropout
        n_mc_samples = 20  # Stochastic forward passes for uncertainty estimation
        with torch.no_grad():
            for _ in range(n_mc_samples):
                mc_pred = self.model(X_input).cpu().numpy()[0]
                mc_raw = self.scaler_y.inverse_transform(
                    mc_pred.reshape(-1, 1)
                ).flatten()
                mc_predictions.append(mc_raw)
        self.model.eval()

        mc_preds = np.array(mc_predictions)  # (n_mc_samples, forecast_days)
        mc_std = mc_preds.std(axis=0)       # per-day std

        confidences = []
        for i, pred in enumerate(predictions):
            # Scale relative std to [0, 1]: std/price * 5 ≈ 1 when vol is 20 %
            relative_std = mc_std[i] / current_price if current_price > 0 else 0.1
            mc_confidence = max(0.3, 1.0 - relative_std * 5)
            # Horizon decay: confidence drops 3 %/day, floor at 0.5
            horizon_decay = max(0.5, 1.0 - (i * 0.03))
            # Geometric mean of MC and horizon confidence, clipped to [0.3, 0.95]
            confidence = max(0.3, min(0.95, (mc_confidence * horizon_decay) ** 0.5))
            confidences.append(confidence)

        # Generate dates for predictions
        last_date = pd.to_datetime(ohlcv_data[-1]['timestamp'], unit='ms')
        prediction_dates = [
            (last_date + pd.Timedelta(days=i + 1)).isoformat()
            for i in range(len(predictions))
        ]

        return {
            'symbol': self.symbol,
            'current_price': current_price,
            'predictions': [
                {
                    'date': date,
                    'day': i + 1,
                    'predicted_price': float(pred),
                    'confidence': float(conf),
                    'change_pct': float((pred - current_price) / current_price * 100),
                }
                for i, (date, pred, conf) in enumerate(zip(
                    prediction_dates, predictions, confidences
                ))
            ],
            'model_info': self.model_metadata,
            'generated_at': datetime.now().isoformat(),
        }
    
    def save(self, path: Optional[str] = None) -> str:
        """Save model to disk"""
        if not self.is_trained:
            raise ValueError("Model not trained")
        
        os.makedirs(settings.model_dir, exist_ok=True)
        path = path or os.path.join(settings.model_dir, f"{self.symbol}_model.pt")
        
        save_dict = {
            'model_state': self.model.state_dict(),
            'scaler_X': self.scaler_X,
            'scaler_y': self.scaler_y,
            'feature_names': self.feature_names,
            'metadata': self.model_metadata,
            'config': {
                'sequence_length': self.model_metadata.get('sequence_length', settings.sequence_length),
                'forecast_days': self.model_metadata.get('forecast_days', settings.forecast_days)
            },
            'feature_selector': self._feature_selector,
            'use_cross_asset_features': self.use_cross_asset_features,
            'use_feature_selection': self.use_feature_selection,
        }
        
        torch.save(save_dict, path)
        return path

    @staticmethod
    def _infer_output_size_from_state(model_state: dict) -> Optional[int]:
        """Infer forecast horizon from the final FC layer in a saved state dict."""
        if not isinstance(model_state, dict):
            return None

        out_bias = model_state.get('fc.3.bias')
        if out_bias is None:
            return None

        shape = getattr(out_bias, 'shape', None)
        if shape is None or len(shape) != 1:
            return None

        return int(shape[0])

    @staticmethod
    def _resolve_forecast_days(save_dict: dict) -> int:
        """Resolve forecast horizon from checkpoint metadata/config/state, with safe fallback."""
        model_state = save_dict.get('model_state', {})
        inferred = StockPredictor._infer_output_size_from_state(model_state)
        if inferred is not None:
            return inferred

        metadata = save_dict.get('metadata', {})
        config = save_dict.get('config', {})
        return int(metadata.get('forecast_days', config.get('forecast_days', settings.forecast_days)))
    
    def load(self, path: Optional[str] = None) -> bool:
        """Load model from disk"""
        path = path or os.path.join(settings.model_dir, f"{self.symbol}_model.pt")
        
        if not os.path.exists(path):
            return False
        
        # weights_only=False needed because we save sklearn scalers
        # This is safe because we only load our own saved models
        save_dict = torch.load(path, map_location=self.device, weights_only=False)
        
        self.scaler_X = save_dict['scaler_X']
        self.scaler_y = save_dict['scaler_y']
        self.feature_names = save_dict['feature_names']
        self.model_metadata = save_dict['metadata']

        # Restore optional enrichment flags and feature selector
        self.use_cross_asset_features = save_dict.get('use_cross_asset_features', False)
        self.use_feature_selection = save_dict.get('use_feature_selection', False)
        self._feature_selector = save_dict.get('feature_selector', None)
        if self.use_cross_asset_features and self._cross_asset_provider is None:
            self._cross_asset_provider = CrossAssetFeatureProvider(
                cache_ttl_seconds=settings.cross_asset_cache_ttl
            )
        
        # Recreate model architecture
        input_size = len(self.feature_names)
        forecast_days = self._resolve_forecast_days(save_dict)
        self.model = LSTMModel(
            input_size=input_size,
            hidden_size=128,
            num_layers=2,
            output_size=forecast_days,
            dropout=0.2
        ).to(self.device)

        try:
            self.model.load_state_dict(save_dict['model_state'])
        except RuntimeError as exc:
            logger.warning(
                f"Failed to load model for {self.symbol} from {path}: {exc}. "
                "Checkpoint is likely incompatible with current architecture."
            )
            self.model = None
            self.is_trained = False
            return False

        self.model.eval()
        self.is_trained = True
        
        return True
