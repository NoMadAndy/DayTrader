"""
Technical Indicators Calculator

Calculates technical indicators for use in the RL trading environment.
Matches indicators used in the frontend and ML service.
"""

import pandas as pd
import numpy as np
from typing import Optional
import ta
from ta.trend import SMAIndicator, EMAIndicator, ADXIndicator, MACD, CCIIndicator
from ta.momentum import RSIIndicator, StochasticOscillator
from ta.volatility import BollingerBands, AverageTrueRange
from ta.volume import OnBalanceVolumeIndicator, MFIIndicator


def calculate_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate technical indicators for trading.
    
    Args:
        df: DataFrame with columns ['open', 'high', 'low', 'close', 'volume']
        
    Returns:
        DataFrame with additional indicator columns
    """
    df = df.copy()
    
    # Ensure column names are lowercase
    df.columns = [col.lower() for col in df.columns]
    
    # Price returns
    df['returns'] = df['close'].pct_change()
    df['log_returns'] = np.log(df['close'] / df['close'].shift(1))
    
    # Simple Moving Averages
    df['sma_20'] = SMAIndicator(close=df['close'], window=20).sma_indicator()
    df['sma_50'] = SMAIndicator(close=df['close'], window=50).sma_indicator()
    df['sma_200'] = SMAIndicator(close=df['close'], window=200).sma_indicator()
    
    # Exponential Moving Averages
    df['ema_12'] = EMAIndicator(close=df['close'], window=12).ema_indicator()
    df['ema_26'] = EMAIndicator(close=df['close'], window=26).ema_indicator()
    
    # RSI
    rsi = RSIIndicator(close=df['close'], window=14)
    df['rsi'] = rsi.rsi()
    df['rsi_signal'] = df['rsi'].rolling(window=9).mean()
    
    # MACD
    macd = MACD(close=df['close'], window_slow=26, window_fast=12, window_sign=9)
    df['macd'] = macd.macd()
    df['macd_signal'] = macd.macd_signal()
    df['macd_hist'] = macd.macd_diff()
    
    # Bollinger Bands
    bb = BollingerBands(close=df['close'], window=20, window_dev=2)
    df['bb_upper'] = bb.bollinger_hband()
    df['bb_middle'] = bb.bollinger_mavg()
    df['bb_lower'] = bb.bollinger_lband()
    df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']
    df['bb_pct'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
    
    # Average True Range
    atr = AverageTrueRange(high=df['high'], low=df['low'], close=df['close'], window=14)
    df['atr'] = atr.average_true_range()
    df['atr_pct'] = df['atr'] / df['close'] * 100
    
    # On Balance Volume
    obv = OnBalanceVolumeIndicator(close=df['close'], volume=df['volume'])
    df['obv'] = obv.on_balance_volume()
    df['obv_ema'] = df['obv'].ewm(span=20).mean()
    
    # ADX (Average Directional Index)
    adx = ADXIndicator(high=df['high'], low=df['low'], close=df['close'], window=14)
    df['adx'] = adx.adx()
    df['plus_di'] = adx.adx_pos()
    df['minus_di'] = adx.adx_neg()
    
    # Stochastic Oscillator
    stoch = StochasticOscillator(
        high=df['high'], low=df['low'], close=df['close'],
        window=14, smooth_window=3
    )
    df['stoch_k'] = stoch.stoch()
    df['stoch_d'] = stoch.stoch_signal()
    
    # CCI (Commodity Channel Index)
    cci = CCIIndicator(high=df['high'], low=df['low'], close=df['close'], window=20)
    df['cci'] = cci.cci()
    
    # MFI (Money Flow Index)
    mfi = MFIIndicator(
        high=df['high'], low=df['low'], close=df['close'],
        volume=df['volume'], window=14
    )
    df['mfi'] = mfi.money_flow_index()
    
    # Volatility (rolling std of returns)
    df['volatility'] = df['returns'].rolling(window=20).std() * np.sqrt(252)
    
    # Trend strength (based on ADX and price position vs SMAs)
    df['trend_strength'] = df['adx'] / 100
    df.loc[df['close'] > df['sma_50'], 'trend_strength'] *= 1
    df.loc[df['close'] < df['sma_50'], 'trend_strength'] *= -1
    
    # Price momentum
    df['momentum_5'] = df['close'] / df['close'].shift(5) - 1
    df['momentum_10'] = df['close'] / df['close'].shift(10) - 1
    df['momentum_20'] = df['close'] / df['close'].shift(20) - 1
    
    # Volume indicators
    df['volume_sma'] = df['volume'].rolling(window=20).mean()
    df['volume_ratio'] = df['volume'] / df['volume_sma']
    
    # Gap detection
    df['gap'] = (df['open'] - df['close'].shift(1)) / df['close'].shift(1)
    
    # Fill NaN values (use bfill() and ffill() methods instead of deprecated fillna method arg)
    df = df.bfill().ffill().fillna(0)
    
    return df


def prepare_data_for_training(
    ohlcv_data: list,
    timestamp_key: str = 'timestamp',
) -> pd.DataFrame:
    """
    Prepare OHLCV data for training.
    
    Args:
        ohlcv_data: List of OHLCV dictionaries
        timestamp_key: Key for timestamp in data
        
    Returns:
        DataFrame ready for training with indicators
    """
    # Convert to DataFrame
    df = pd.DataFrame(ohlcv_data)
    
    # Normalize column names
    column_mapping = {
        'Open': 'open', 'High': 'high', 'Low': 'low',
        'Close': 'close', 'Volume': 'volume',
        'Timestamp': 'timestamp', timestamp_key: 'timestamp'
    }
    df = df.rename(columns=column_mapping)
    
    # Ensure required columns
    required = ['open', 'high', 'low', 'close', 'volume']
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")
    
    # Sort by timestamp if present
    if 'timestamp' in df.columns:
        df = df.sort_values('timestamp').reset_index(drop=True)
    
    # Calculate indicators
    df = calculate_indicators(df)
    
    return df
