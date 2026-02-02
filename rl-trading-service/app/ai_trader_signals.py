"""
Signal Aggregation für AI Trader

Aggregates signals from multiple sources:
- ML Service (LSTM price predictions)
- RL Agent (PPO trading agent)
- Sentiment Analysis (FinBERT)
- Technical Indicators (RSI, MACD, Moving Averages)
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
import numpy as np
import httpx
from datetime import datetime


@dataclass
class AggregatedSignal:
    """Result of signal aggregation from all sources"""
    weighted_score: float
    confidence: float
    agreement: str  # 'strong', 'moderate', 'weak', 'mixed'
    ml_score: float
    rl_score: float
    sentiment_score: float
    technical_score: float
    ml_details: Dict[str, Any]
    rl_details: Dict[str, Any]
    sentiment_details: Dict[str, Any]
    technical_details: Dict[str, Any]
    market_context: Dict[str, Any]


class SignalAggregator:
    """Aggregates trading signals from multiple sources"""
    
    def __init__(self, config):
        """
        Initialize signal aggregator.
        
        Args:
            config: AITraderConfig instance
        """
        self.config = config
        self.ml_service_url = "http://ml-service:8000"
        self.backend_url = "http://backend:3001"  # For combined endpoints
        self.http_client = httpx.AsyncClient(timeout=30.0)
    
    async def aggregate_signals(
        self,
        symbol: str,
        market_data: Dict,
        portfolio_state: Dict,
        rl_agent_name: Optional[str] = None
    ) -> AggregatedSignal:
        """
        Aggregate signals from all sources.
        
        Args:
            symbol: Trading symbol
            market_data: Market data including OHLCV
            portfolio_state: Current portfolio state
            rl_agent_name: Name of RL agent to use
            
        Returns:
            AggregatedSignal with all scores and details
        """
        # Fetch signals from all sources
        ml_result = await self._get_ml_signal(symbol, market_data)
        rl_result = await self._get_rl_signal(symbol, market_data, rl_agent_name)
        sentiment_result = await self._get_sentiment_signal(symbol)
        technical_result = self._calculate_technical_signal(market_data)
        
        # Extract scores
        ml_score = ml_result.get('score', 0.0)
        rl_score = rl_result.get('score', 0.0)
        sentiment_score = sentiment_result.get('score', 0.0)
        technical_score = technical_result.get('score', 0.0)
        
        # Calculate weighted score
        weighted_score = (
            ml_score * self.config.ml_weight +
            rl_score * self.config.rl_weight +
            sentiment_score * self.config.sentiment_weight +
            technical_score * self.config.technical_weight
        )
        
        # Calculate agreement level
        scores = [ml_score, rl_score, sentiment_score, technical_score]
        agreement = self._calculate_agreement(scores)
        
        # Calculate confidence based on agreement and individual confidences
        confidences = [
            ml_result.get('confidence', 0.5),
            rl_result.get('confidence', 0.5),
            sentiment_result.get('confidence', 0.5),
            technical_result.get('confidence', 0.5)
        ]
        avg_confidence = np.mean(confidences)
        
        # Adjust confidence based on agreement
        if agreement == 'strong':
            confidence = min(1.0, avg_confidence * 1.2)
        elif agreement == 'moderate':
            confidence = avg_confidence
        elif agreement == 'weak':
            confidence = avg_confidence * 0.8
        else:  # mixed
            confidence = avg_confidence * 0.6
        
        # Build market context
        market_context = {
            'symbol': symbol,
            'current_price': market_data.get('current_price', 0),
            'volume': market_data.get('volume', 0),
            'timestamp': datetime.now().isoformat()
        }
        
        return AggregatedSignal(
            weighted_score=weighted_score,
            confidence=confidence,
            agreement=agreement,
            ml_score=ml_score,
            rl_score=rl_score,
            sentiment_score=sentiment_score,
            technical_score=technical_score,
            ml_details=ml_result,
            rl_details=rl_result,
            sentiment_details=sentiment_result,
            technical_details=technical_result,
            market_context=market_context
        )
    
    async def _get_ml_signal(self, symbol: str, market_data: Dict) -> Dict:
        """
        Get ML signal from LSTM price prediction service.
        
        Args:
            symbol: Trading symbol
            market_data: Market data for prediction
            
        Returns:
            Dict with score, confidence, and details
        """
        try:
            # Prepare data for ML service
            prices = market_data.get('prices', [])
            if len(prices) < 60:
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'prediction': None,
                    'error': 'Insufficient data (need 60+ points)'
                }
            
            # Call ML service prediction endpoint
            response = await self.http_client.post(
                f"{self.ml_service_url}/api/ml/predict",
                json={
                    'symbol': symbol,
                    'prices': prices[-100:]  # Send last 100 points
                },
                timeout=30.0
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Extract prediction
                prediction = data.get('prediction', 0)
                current_price = prices[-1].get('close', 0) if prices else 0
                
                # Calculate score based on predicted change
                if current_price > 0:
                    predicted_change = (prediction - current_price) / current_price
                    
                    # Normalize to -1 to +1 range
                    # Assume +/-10% is strong signal
                    score = np.clip(predicted_change / 0.10, -1.0, 1.0)
                else:
                    score = 0.0
                
                return {
                    'score': score,
                    'confidence': data.get('confidence', 0.5),
                    'prediction': prediction,
                    'current_price': current_price,
                    'predicted_change': predicted_change if current_price > 0 else 0,
                    'model': data.get('model', 'lstm')
                }
            else:
                print(f"ML service error: {response.status_code}")
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'error': f'ML service returned {response.status_code}'
                }
                
        except Exception as e:
            print(f"Error getting ML signal: {e}")
            return {
                'score': 0.0,
                'confidence': 0.0,
                'error': str(e)
            }
    
    async def _get_rl_signal(
        self,
        symbol: str,
        market_data: Dict,
        agent_name: Optional[str]
    ) -> Dict:
        """
        Get RL signal from local PPO agent.
        
        Args:
            symbol: Trading symbol
            market_data: Market data for agent
            agent_name: Name of agent to use (from config)
            
        Returns:
            Dict with score, confidence, and details
        """
        try:
            # Use configured agent or default
            if not agent_name:
                agent_name = self.config.rl_agent_name
            
            if not agent_name:
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'signal': 'hold',
                    'error': 'No RL agent configured'
                }
            
            # Import trainer to access agents
            from .trainer import trainer
            
            # Check if agent exists and is trained
            status = trainer.get_agent_status(agent_name)
            if not status or not status.is_trained:
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'signal': 'hold',
                    'error': f'Agent {agent_name} not found or not trained'
                }
            
            # Prepare data for signal
            prices = market_data.get('prices', [])
            if len(prices) < 60:
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'signal': 'hold',
                    'error': 'Insufficient data (need 60+ points)'
                }
            
            # Get signal from trainer
            from .indicators import prepare_data_for_training
            import pandas as pd
            
            # Convert to DataFrame
            df_data = [{
                'timestamp': p.get('timestamp', 0),
                'open': p.get('open', 0),
                'high': p.get('high', 0),
                'low': p.get('low', 0),
                'close': p.get('close', 0),
                'volume': p.get('volume', 0)
            } for p in prices]
            
            df = pd.DataFrame(df_data)
            df = prepare_data_for_training(df)
            
            signal_result = trainer.get_trading_signal(agent_name, df)
            
            # Convert signal to score
            signal_type = signal_result.get('signal', 'hold')
            strength = signal_result.get('strength', 'weak')
            
            # Map to -1 to +1 score
            if signal_type == 'buy':
                base_score = 0.5 if strength == 'weak' else 0.75 if strength == 'moderate' else 1.0
            elif signal_type == 'sell':
                base_score = -0.5 if strength == 'weak' else -0.75 if strength == 'moderate' else -1.0
            else:  # hold
                base_score = 0.0
            
            return {
                'score': base_score,
                'confidence': signal_result.get('confidence', 0.5),
                'signal': signal_type,
                'strength': strength,
                'action': signal_result.get('action', 'hold'),
                'agent_name': agent_name,
                'action_probs': signal_result.get('action_probabilities', {})
            }
            
        except Exception as e:
            print(f"Error getting RL signal: {e}")
            return {
                'score': 0.0,
                'confidence': 0.0,
                'signal': 'hold',
                'error': str(e)
            }
    
    async def _get_sentiment_signal(self, symbol: str) -> Dict:
        """
        Get sentiment signal from FinBERT analysis.
        
        Uses the backend's combined endpoint which fetches news and
        analyzes sentiment using the ML service.
        
        Args:
            symbol: Trading symbol
            
        Returns:
            Dict with score, confidence, and details
        """
        try:
            # Call backend combined sentiment endpoint
            # Backend fetches news and analyzes sentiment via ML service
            response = await self.http_client.get(
                f"{self.backend_url}/api/ml/sentiment/{symbol}",
                timeout=30.0
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Extract sentiment
                sentiment = data.get('sentiment', 'neutral')
                sentiment_score = data.get('score', 0.0)
                
                # Map sentiment to -1 to +1 score
                if sentiment == 'positive':
                    score = sentiment_score
                elif sentiment == 'negative':
                    score = -sentiment_score
                else:  # neutral
                    score = 0.0
                
                return {
                    'score': score,
                    'confidence': data.get('confidence', 0.5),
                    'sentiment': sentiment,
                    'sentiment_score': sentiment_score,
                    'news_count': data.get('news_count', 0),
                    'sources': data.get('sources', [])
                }
            else:
                print(f"Sentiment service error: {response.status_code}")
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'sentiment': 'neutral',
                    'error': f'Sentiment service returned {response.status_code}'
                }
                
        except Exception as e:
            print(f"Error getting sentiment signal: {e}")
            return {
                'score': 0.0,
                'confidence': 0.0,
                'sentiment': 'neutral',
                'error': str(e)
            }
    
    def _calculate_technical_signal(self, market_data: Dict) -> Dict:
        """
        Calculate technical analysis signal.
        
        Args:
            market_data: Market data with OHLCV
            
        Returns:
            Dict with score, confidence, and indicator details
        """
        try:
            prices = market_data.get('prices', [])
            if len(prices) < 60:
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'error': 'Insufficient data (need 60+ points)'
                }
            
            # Extract close prices for calculations
            closes = np.array([p.get('close', 0) for p in prices])
            highs = np.array([p.get('high', 0) for p in prices])
            lows = np.array([p.get('low', 0) for p in prices])
            volumes = np.array([p.get('volume', 0) for p in prices])
            
            # Calculate indicators
            rsi = self._calculate_rsi(closes)
            macd, macd_signal, macd_hist = self._calculate_macd(closes)
            sma_20 = np.mean(closes[-20:]) if len(closes) >= 20 else closes[-1]
            sma_50 = np.mean(closes[-50:]) if len(closes) >= 50 else closes[-1]
            current_price = closes[-1]
            
            # Score each indicator
            scores = []
            
            # RSI scoring
            if rsi < 30:
                rsi_score = 0.8  # Oversold - bullish
            elif rsi < 40:
                rsi_score = 0.4
            elif rsi > 70:
                rsi_score = -0.8  # Overbought - bearish
            elif rsi > 60:
                rsi_score = -0.4
            else:
                rsi_score = 0.0  # Neutral
            scores.append(rsi_score)
            
            # MACD scoring
            if macd_hist > 0:
                macd_score = 0.5  # Bullish
            elif macd_hist < 0:
                macd_score = -0.5  # Bearish
            else:
                macd_score = 0.0
            scores.append(macd_score)
            
            # Moving Average scoring
            if current_price > sma_20 > sma_50:
                ma_score = 0.7  # Strong uptrend
            elif current_price > sma_20:
                ma_score = 0.3  # Mild uptrend
            elif current_price < sma_20 < sma_50:
                ma_score = -0.7  # Strong downtrend
            elif current_price < sma_20:
                ma_score = -0.3  # Mild downtrend
            else:
                ma_score = 0.0
            scores.append(ma_score)
            
            # Aggregate technical score
            tech_score = np.mean(scores)
            
            # Confidence based on indicator agreement
            score_std = np.std(scores)
            confidence = max(0.3, 1.0 - score_std)  # Lower std = higher confidence
            
            return {
                'score': tech_score,
                'confidence': confidence,
                'rsi': rsi,
                'rsi_signal': 'oversold' if rsi < 30 else 'overbought' if rsi > 70 else 'neutral',
                'macd': macd,
                'macd_signal': macd_signal,
                'macd_hist': macd_hist,
                'sma_20': sma_20,
                'sma_50': sma_50,
                'current_price': current_price,
                'trend': 'bullish' if ma_score > 0.3 else 'bearish' if ma_score < -0.3 else 'neutral'
            }
            
        except Exception as e:
            print(f"Error calculating technical signal: {e}")
            return {
                'score': 0.0,
                'confidence': 0.0,
                'error': str(e)
            }
    
    def _calculate_rsi(self, closes: np.ndarray, period: int = 14) -> float:
        """
        Calculate Relative Strength Index.
        
        Args:
            closes: Array of close prices
            period: RSI period (default 14)
            
        Returns:
            RSI value (0-100)
        """
        if len(closes) < period + 1:
            return 50.0  # Neutral if insufficient data
        
        # Calculate price changes
        deltas = np.diff(closes)
        
        # Separate gains and losses
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        
        # Calculate average gains and losses
        avg_gain = np.mean(gains[-period:])
        avg_loss = np.mean(losses[-period:])
        
        if avg_loss == 0:
            return 100.0
        
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        
        return rsi
    
    def _calculate_macd(
        self,
        closes: np.ndarray,
        fast: int = 12,
        slow: int = 26,
        signal: int = 9
    ) -> tuple:
        """
        Calculate MACD indicator.
        
        Args:
            closes: Array of close prices
            fast: Fast EMA period
            slow: Slow EMA period
            signal: Signal line period
            
        Returns:
            Tuple of (macd, signal_line, histogram)
        """
        if len(closes) < slow:
            return (0.0, 0.0, 0.0)
        
        # Calculate EMAs
        ema_fast = self._calculate_ema(closes, fast)
        ema_slow = self._calculate_ema(closes, slow)
        
        # MACD line
        macd = ema_fast - ema_slow
        
        # Signal line (EMA of MACD)
        # For simplicity, use SMA instead of EMA of MACD
        if len(closes) >= slow + signal:
            macd_values = []
            for i in range(slow, len(closes)):
                ema_f = self._calculate_ema(closes[:i+1], fast)
                ema_s = self._calculate_ema(closes[:i+1], slow)
                macd_values.append(ema_f - ema_s)
            signal_line = np.mean(macd_values[-signal:]) if len(macd_values) >= signal else macd
        else:
            signal_line = macd
        
        # Histogram
        histogram = macd - signal_line
        
        return (macd, signal_line, histogram)
    
    def _calculate_ema(self, data: np.ndarray, period: int) -> float:
        """
        Calculate Exponential Moving Average.
        
        Args:
            data: Array of values
            period: EMA period
            
        Returns:
            EMA value
        """
        if len(data) < period:
            return np.mean(data)
        
        multiplier = 2 / (period + 1)
        ema = np.mean(data[:period])  # Start with SMA
        
        for value in data[period:]:
            ema = (value - ema) * multiplier + ema
        
        return ema
    
    def _calculate_agreement(self, scores: List[float]) -> str:
        """
        Calculate agreement level between signals.
        
        Args:
            scores: List of signal scores (-1 to +1)
            
        Returns:
            Agreement level: 'strong', 'moderate', 'weak', 'mixed'
        """
        # Filter out zero scores (neutral signals)
        non_zero_scores = [s for s in scores if abs(s) > 0.1]
        
        if len(non_zero_scores) < 2:
            return 'weak'
        
        # Check if all signals agree on direction
        positive_signals = sum(1 for s in non_zero_scores if s > 0)
        negative_signals = sum(1 for s in non_zero_scores if s < 0)
        
        total_signals = len(non_zero_scores)
        agreement_ratio = max(positive_signals, negative_signals) / total_signals
        
        # Calculate standard deviation
        std_dev = np.std(scores)
        
        if agreement_ratio >= 0.75 and std_dev < 0.3:
            return 'strong'
        elif agreement_ratio >= 0.6 and std_dev < 0.5:
            return 'moderate'
        elif agreement_ratio >= 0.5:
            return 'weak'
        else:
            return 'mixed'
    
    async def close(self):
        """Cleanup resources"""
        await self.http_client.aclose()
