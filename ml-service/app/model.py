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
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from typing import Tuple, List, Optional
import os
import json
import logging
from datetime import datetime

from .config import settings

# Setup logger
logger = logging.getLogger(__name__)


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
    
    def __init__(self, symbol: str, use_cuda: Optional[bool] = None):
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
        
        return df_clean.values, feature_columns
    
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
        
        # Scale features
        X_scaled = self.scaler_X.fit_transform(X)
        y_scaled = self.scaler_y.fit_transform(y.reshape(-1, 1)).flatten()
        
        # Create sequences
        X_seq, y_seq = self._create_sequences(
            X_scaled,
            y_scaled,
            seq_len,
            fc_days
        )
        
        # Reshape y_seq to (samples, forecast_days)
        # Each target is the next forecast_days of scaled close prices
        y_targets = []
        for i in range(len(X_seq)):
            start_idx = seq_len + i
            end_idx = start_idx + fc_days
            if end_idx <= len(y_scaled):
                y_targets.append(y_scaled[start_idx:end_idx])
        
        y_seq = np.array(y_targets[:len(X_seq)])
        X_seq = X_seq[:len(y_seq)]
        
        # Train/validation split (80/20)
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
        early_stopping_patience: int = 10
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
            
        Returns:
            Training results dict with loss history and metadata
        """
        epochs = epochs or settings.epochs
        learning_rate = learning_rate or settings.learning_rate
        
        # Store custom parameters for this training session
        self._train_sequence_length = sequence_length or settings.sequence_length
        self._train_forecast_days = forecast_days or settings.forecast_days
        
        print(f"[ML Training] Parameters: epochs={epochs}, lr={learning_rate}, "
              f"seq_len={self._train_sequence_length}, forecast_days={self._train_forecast_days}")
        
        # Prepare data with custom parameters
        X_train, y_train, X_val, y_val = self.prepare_data(
            ohlcv_data,
            sequence_length=self._train_sequence_length,
            forecast_days=self._train_forecast_days
        )
        
        # Initialize model with custom forecast_days
        input_size = X_train.shape[2]  # Number of features
        self.model = LSTMModel(
            input_size=input_size,
            hidden_size=128,
            num_layers=2,
            output_size=self._train_forecast_days,
            dropout=0.2
        ).to(self.device)
        
        # Loss and optimizer
        criterion = nn.MSELoss()
        optimizer = torch.optim.Adam(self.model.parameters(), lr=learning_rate)
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode='min', factor=0.5, patience=5
        )
        
        # Training loop
        self.training_history = []
        best_val_loss = float('inf')
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
                'lr': optimizer.param_groups[0]['lr']
            })
            
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
            'data_points': len(ohlcv_data)
        }
        
        return {
            'success': True,
            'metadata': self.model_metadata,
            'history': self.training_history
        }
    
    def predict(self, ohlcv_data: List[dict]) -> dict:
        """
        Generate price predictions for the next N days
        
        Args:
            ohlcv_data: Recent OHLCV data (at least sequence_length points)
            
        Returns:
            Prediction results with forecasted prices and confidence
        """
        if not self.is_trained or self.model is None:
            raise ValueError("Model not trained. Call train() first.")
        
        # Prepare features
        df = pd.DataFrame(ohlcv_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df = df.sort_values('timestamp').reset_index(drop=True)
        
        X, _ = self._prepare_features(df)
        
        # Scale using fitted scaler
        X_scaled = self.scaler_X.transform(X)
        
        # Get the last sequence
        if len(X_scaled) < settings.sequence_length:
            raise ValueError(f"Need at least {settings.sequence_length} data points")
        
        last_sequence = X_scaled[-settings.sequence_length:]
        X_input = torch.FloatTensor(last_sequence).unsqueeze(0).to(self.device)
        
        # Predict
        self.model.eval()
        with torch.no_grad():
            predictions_scaled = self.model(X_input).cpu().numpy()[0]
        
        # Inverse transform to get actual prices
        predictions = self.scaler_y.inverse_transform(
            predictions_scaled.reshape(-1, 1)
        ).flatten()
        
        # Calculate prediction confidence based on model uncertainty
        # Using simple heuristic: confidence decreases with forecast horizon
        current_price = ohlcv_data[-1]['close']
        confidences = []
        for i, pred in enumerate(predictions):
            # Base confidence decreases linearly with days
            base_confidence = max(0.5, 1.0 - (i * 0.03))
            # Adjust based on predicted change magnitude
            change_pct = abs(pred - current_price) / current_price
            change_penalty = min(0.3, change_pct)
            confidence = max(0.3, base_confidence - change_penalty)
            confidences.append(confidence)
        
        # Generate dates for predictions
        last_date = pd.to_datetime(ohlcv_data[-1]['timestamp'], unit='ms')
        prediction_dates = [
            (last_date + pd.Timedelta(days=i+1)).isoformat()
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
                    'change_pct': float((pred - current_price) / current_price * 100)
                }
                for i, (date, pred, conf) in enumerate(zip(
                    prediction_dates, predictions, confidences
                ))
            ],
            'model_info': self.model_metadata,
            'generated_at': datetime.now().isoformat()
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
                'sequence_length': settings.sequence_length,
                'forecast_days': settings.forecast_days
            }
        }
        
        torch.save(save_dict, path)
        return path
    
    def load(self, path: Optional[str] = None) -> bool:
        """Load model from disk"""
        path = path or os.path.join(settings.model_dir, f"{self.symbol}_model.pt")
        
        if not os.path.exists(path):
            return False
        
        save_dict = torch.load(path, map_location=self.device)
        
        self.scaler_X = save_dict['scaler_X']
        self.scaler_y = save_dict['scaler_y']
        self.feature_names = save_dict['feature_names']
        self.model_metadata = save_dict['metadata']
        
        # Recreate model architecture
        input_size = len(self.feature_names)
        self.model = LSTMModel(
            input_size=input_size,
            hidden_size=128,
            num_layers=2,
            output_size=settings.forecast_days,
            dropout=0.2
        ).to(self.device)
        
        self.model.load_state_dict(save_dict['model_state'])
        self.model.eval()
        self.is_trained = True
        
        return True
