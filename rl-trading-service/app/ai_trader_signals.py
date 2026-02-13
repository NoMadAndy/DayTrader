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
import asyncio
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
        
        # Detect market regime from technical indicators
        market_regime = self._detect_market_regime(market_data, technical_result)
        
        # Extract scores
        ml_score = ml_result.get('score', 0.0)
        rl_score = rl_result.get('score', 0.0)
        sentiment_score = sentiment_result.get('score', 0.0)
        technical_score = technical_result.get('score', 0.0)
        
        # Calculate weighted score with adaptive weighting
        # If a signal has very low confidence or error, reduce its weight
        ml_conf = ml_result.get('confidence', 0.5)
        rl_conf = rl_result.get('confidence', 0.5)
        sentiment_conf = sentiment_result.get('confidence', 0.5)
        technical_conf = technical_result.get('confidence', 0.5)
        
        # Adjust weights based on signal availability/confidence
        # Use defaults if weights are None
        ml_weight = self.config.ml_weight if self.config.ml_weight is not None else 0.25
        rl_weight = self.config.rl_weight if self.config.rl_weight is not None else 0.25
        sentiment_weight = self.config.sentiment_weight if self.config.sentiment_weight is not None else 0.25
        technical_weight = self.config.technical_weight if self.config.technical_weight is not None else 0.25
        
        effective_ml_weight = ml_weight * (ml_conf if ml_conf > 0.1 else 0.1)
        effective_rl_weight = rl_weight * (rl_conf if rl_conf > 0.1 else 0.1)
        effective_sentiment_weight = sentiment_weight * (sentiment_conf if sentiment_conf > 0.1 else 0.1)
        effective_technical_weight = technical_weight * (technical_conf if technical_conf > 0.1 else 0.1)
        
        # Adjust weights based on market regime
        regime = market_regime.get('regime', 'range')
        if regime == 'crash':
            # In crash: boost sentiment (panic detection) and technical (mean reversion)
            effective_sentiment_weight *= 1.5
            effective_technical_weight *= 1.3
            effective_ml_weight *= 0.7  # ML predictions less reliable in crashes
        elif regime == 'volatile':
            # Volatile: boost technical (breakout/breakdown), reduce ML
            effective_technical_weight *= 1.3
            effective_ml_weight *= 0.8
        elif regime == 'trend':
            # Trending: boost RL (momentum following) and ML
            effective_rl_weight *= 1.3
            effective_ml_weight *= 1.2
            effective_technical_weight *= 0.9  # Mean-reversion signals less useful
        
        # Normalize weights
        total_weight = effective_ml_weight + effective_rl_weight + effective_sentiment_weight + effective_technical_weight
        if total_weight > 0:
            effective_ml_weight /= total_weight
            effective_rl_weight /= total_weight
            effective_sentiment_weight /= total_weight
            effective_technical_weight /= total_weight
        
        weighted_score = (
            ml_score * effective_ml_weight +
            rl_score * effective_rl_weight +
            sentiment_score * effective_sentiment_weight +
            technical_score * effective_technical_weight
        )
        
        # Calculate agreement level
        scores = [ml_score, rl_score, sentiment_score, technical_score]
        agreement = self._calculate_agreement(scores)
        
        # Calculate confidence based on agreement and individual confidences
        # Only consider signals with valid confidence (> 0.05)
        confidences = [ml_conf, rl_conf, sentiment_conf, technical_conf]
        valid_confidences = [c for c in confidences if c > 0.05]
        
        if valid_confidences:
            avg_confidence = np.mean(valid_confidences)
        else:
            avg_confidence = 0.3  # Fallback if no valid confidences
        
        # Adjust confidence based on agreement
        if agreement == 'strong':
            confidence = min(1.0, avg_confidence * 1.2)
        elif agreement == 'moderate':
            confidence = avg_confidence
        elif agreement == 'weak':
            confidence = avg_confidence * 0.85  # Less harsh penalty
        else:  # mixed
            confidence = avg_confidence * 0.7  # Less harsh penalty
        
        # Build market context
        market_context = {
            'symbol': symbol,
            'current_price': market_data.get('current_price', 0),
            'volume': market_data.get('volume', 0),
            'timestamp': datetime.now().isoformat(),
            'market_regime': market_regime
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
            # ML needs: 50 points for SMA_50 indicator + 60 points for sequence = 110 minimum
            # Request 150 to have buffer
            if len(prices) < 150:
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'prediction': None,
                    'error': f'Insufficient data (have {len(prices)}, need 150+ points for ML indicators)'
                }
            
            # Convert prices to OHLCVData format expected by ML service
            # ML service expects: { symbol, data: [{ timestamp, open, high, low, close, volume }, ...] }
            ohlcv_data = []
            for p in prices[-200:]:  # Send last 200 points (50 for SMA_50 + 60 for seq + 90 buffer)
                ohlcv_data.append({
                    'timestamp': p.get('timestamp', int(p.get('date', 0))),
                    'open': p.get('open', p.get('close', 0)),
                    'high': p.get('high', p.get('close', 0)),
                    'low': p.get('low', p.get('close', 0)),
                    'close': p.get('close', 0),
                    'volume': p.get('volume', 0)
                })
            
            # Call ML service prediction endpoint
            response = await self.http_client.post(
                f"{self.ml_service_url}/api/ml/predict",
                json={
                    'symbol': symbol,
                    'data': ohlcv_data,
                    'model_type': getattr(self.config, 'ml_model_type', None)
                },
                timeout=30.0
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # ML service returns: { symbol, current_price, predictions: [{ day, predicted_price, confidence, change_pct }, ...] }
                predictions = data.get('predictions', [])
                current_price = data.get('current_price', 0)
                
                if predictions and current_price > 0:
                    # Use first prediction (day 1) for immediate signal
                    first_pred = predictions[0]
                    predicted_price = first_pred.get('predicted_price', current_price)
                    confidence = first_pred.get('confidence', 0.5)
                    change_pct = first_pred.get('change_pct', 0)
                    
                    # Normalize change_pct relative to symbol's historical volatility
                    # instead of fixed /10.0 — adapts to each stock's range
                    prices_list = market_data.get('prices', [])
                    if len(prices_list) >= 20:
                        hist_closes = np.array([p.get('close', 0) for p in prices_list[-60:]])
                        hist_returns = np.diff(hist_closes) / hist_closes[:-1]
                        hist_vol = np.std(hist_returns) * 100  # Daily vol as percentage
                        normalizer = max(hist_vol * 3, 1.0)  # 3-sigma range
                    else:
                        normalizer = 10.0  # Fallback
                    score = np.clip(change_pct / normalizer, -1.0, 1.0)
                    
                    return {
                        'score': score,
                        'confidence': confidence,
                        'prediction': predicted_price,
                        'current_price': current_price,
                        'predicted_change': change_pct / 100.0,  # Convert percentage to decimal
                        'model': data.get('model_info', {}).get('type', 'lstm')
                    }
                else:
                    return {
                        'score': 0.0,
                        'confidence': 0.0,
                        'error': 'No predictions returned'
                    }
            elif response.status_code == 404:
                # No trained model found - try auto-training if enabled
                if self.config.auto_train_ml:
                    print(f"No ML model for {symbol}, attempting auto-training...")
                    train_result = await self._auto_train_ml_model(symbol, market_data)
                    if train_result.get('success'):
                        # Retry prediction after training
                        return await self._get_ml_signal(symbol, market_data)
                    else:
                        return {
                            'score': 0.0,
                            'confidence': 0.0,
                            'error': f"Auto-training failed: {train_result.get('error', 'unknown')}"
                        }
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'error': 'No trained model for this symbol'
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
    
    async def _auto_train_ml_model(self, symbol: str, market_data: Dict) -> Dict:
        """
        Automatically train an ML model for a symbol if none exists.
        
        Args:
            symbol: Trading symbol
            market_data: Market data (used for training period hint)
            
        Returns:
            Dict with success status and details
        """
        try:
            # Fetch historical data for training (use configured period, default 2y)
            period = getattr(self.config, 'ml_training_period', '2y')
            
            print(f"Fetching {period} historical data for {symbol}...")
            response = await self.http_client.get(
                f"{self.backend_url}/api/yahoo/chart/{symbol}?period={period}&interval=1d",
                timeout=60.0
            )
            
            if response.status_code != 200:
                return {'success': False, 'error': f'Failed to fetch historical data: {response.status_code}'}
            
            data = response.json()
            
            # Parse Yahoo Finance format
            result = data.get('chart', {}).get('result', [{}])[0]
            timestamps = result.get('timestamp', [])
            quotes = result.get('indicators', {}).get('quote', [{}])[0]
            
            ohlcv_data = []
            for i, ts in enumerate(timestamps):
                close = quotes.get('close', [])[i]
                if close is not None:
                    ohlcv_data.append({
                        'timestamp': ts * 1000,  # Convert to milliseconds
                        'open': quotes.get('open', [])[i] or close,
                        'high': quotes.get('high', [])[i] or close,
                        'low': quotes.get('low', [])[i] or close,
                        'close': close,
                        'volume': quotes.get('volume', [])[i] or 0
                    })
            
            if len(ohlcv_data) < 150:  # Minimum for training with indicators
                return {'success': False, 'error': f'Insufficient data: {len(ohlcv_data)} points (need 150+)'}
            
            print(f"Starting ML training for {symbol} with {len(ohlcv_data)} data points...")
            
            # Submit training request
            train_response = await self.http_client.post(
                f"{self.ml_service_url}/api/ml/train",
                json={
                    'symbol': symbol,
                    'data': ohlcv_data,
                    'epochs': 50,  # Reasonable default
                    'sequence_length': 60,
                    'forecast_days': 14,
                    'model_type': getattr(self.config, 'ml_model_type', None)
                },
                timeout=10.0  # Just submit, don't wait for completion
            )
            
            if train_response.status_code not in [200, 202]:
                return {'success': False, 'error': f'Training submit failed: {train_response.status_code}'}
            
            # Wait for training to complete (poll status)
            max_wait = 120  # Maximum wait time in seconds
            waited = 0
            while waited < max_wait:
                await asyncio.sleep(5)
                waited += 5
                
                status_response = await self.http_client.get(
                    f"{self.ml_service_url}/api/ml/train/{symbol}/status",
                    timeout=10.0
                )
                
                if status_response.status_code == 200:
                    status = status_response.json()
                    if status.get('status') == 'completed':
                        print(f"ML model training completed for {symbol}")
                        return {'success': True, 'result': status.get('result')}
                    elif status.get('status') == 'failed':
                        return {'success': False, 'error': status.get('message', 'Training failed')}
                    # Still training, continue waiting
                    print(f"Training {symbol}... {status.get('progress', 0):.0f}%")
                elif status_response.status_code == 404:
                    # Training job not found - might have completed
                    break
            
            return {'success': False, 'error': 'Training timeout'}
            
        except Exception as e:
            print(f"Auto-training error for {symbol}: {e}")
            return {'success': False, 'error': str(e)}
    
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
            
            # Convert signal to continuous score using action probabilities
            # instead of stepped 0.5/0.75/1.0 values
            action_probs = signal_result.get('action_probabilities', {})
            signal_type = signal_result.get('signal', 'hold')
            strength = signal_result.get('strength', 'weak')
            
            if action_probs:
                # Weighted continuous score from action probability distribution
                # Buy actions contribute positively, sell actions negatively
                buy_weight = (
                    action_probs.get('buy_small', 0) * 0.33 +
                    action_probs.get('buy_medium', 0) * 0.67 +
                    action_probs.get('buy_large', 0) * 1.0
                )
                sell_weight = (
                    action_probs.get('sell_small', 0) * 0.33 +
                    action_probs.get('sell_medium', 0) * 0.67 +
                    action_probs.get('sell_all', 0) * 1.0
                )
                # Short actions if present
                short_weight = (
                    action_probs.get('short_small', 0) * 0.33 +
                    action_probs.get('short_medium', 0) * 0.67 +
                    action_probs.get('short_large', 0) * 1.0
                )
                cover_weight = (
                    action_probs.get('cover_small', 0) * 0.33 +
                    action_probs.get('cover_medium', 0) * 0.67 +
                    action_probs.get('cover_all', 0) * 1.0
                )
                # Net bullish minus bearish probability mass
                base_score = np.clip(
                    (buy_weight + cover_weight) - (sell_weight + short_weight),
                    -1.0, 1.0
                )
            else:
                # Fallback to stepped mapping if no action probabilities
                if signal_type == 'buy':
                    base_score = 0.5 if strength == 'weak' else 0.75 if strength == 'moderate' else 1.0
                elif signal_type == 'sell':
                    base_score = -0.5 if strength == 'weak' else -0.75 if strength == 'moderate' else -1.0
                else:
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
                raw_score = data.get('score', 0.0)
                
                # Use the raw score directly - it's already in -1 to +1 range
                # The 'sentiment' field is just a label, don't override the numeric score
                score = raw_score if raw_score != 0 else 0.0
                
                # Ensure score reflects sentiment direction
                if sentiment == 'negative' and score > 0:
                    score = -score
                elif sentiment == 'positive' and score < 0:
                    score = abs(score)
                
                return {
                    'score': score,
                    'confidence': data.get('confidence', 0.5),
                    'sentiment': sentiment,
                    'sentiment_score': raw_score,
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
    
    def _detect_market_regime(self, market_data: Dict, technical_result: Dict) -> Dict:
        """
        Detect current market regime from price data and technical indicators.
        
        Regimes: trend, range, volatile, crash
        """
        try:
            prices = market_data.get('prices', [])
            if len(prices) < 30:
                return {'regime': 'range', 'confidence': 0.3}
            
            closes = np.array([p.get('close', 0) for p in prices])
            recent = closes[-31:]  # Need 31 for 30 returns
            returns = np.diff(recent) / recent[:-1]
            
            # Volatility metrics
            vol_20 = np.std(returns[-20:]) if len(returns) >= 20 else np.std(returns)
            vol_5 = np.std(returns[-5:]) if len(returns) >= 5 else vol_20
            avg_return = np.mean(returns[-20:])
            
            # ADX from technical result (if available)
            adx = technical_result.get('adx', 20)
            
            # Regime classification
            # Crash: strong negative returns (avg < -1%) AND elevated volatility
            if avg_return < -0.01 and (vol_5 > vol_20 * 1.3 or vol_20 > 0.02):
                return {
                    'regime': 'crash',
                    'confidence': min(0.9, abs(avg_return) * 10 + 0.3),
                    'volatility': float(vol_20),
                    'recent_volatility': float(vol_5),
                    'avg_return': float(avg_return)
                }
            
            # Volatile: high absolute vol (> 2% daily) or vol spike
            if vol_20 > 0.025 or vol_5 > vol_20 * 1.5:
                return {
                    'regime': 'volatile',
                    'confidence': min(0.85, vol_20 * 10 + 0.3),
                    'volatility': float(vol_20),
                    'recent_volatility': float(vol_5),
                    'avg_return': float(avg_return)
                }
            
            # Trend: ADX > 25 or consistent directional returns
            consecutive_positive = sum(1 for r in returns[-10:] if r > 0)
            consecutive_negative = sum(1 for r in returns[-10:] if r < 0)
            directional = max(consecutive_positive, consecutive_negative) / 10
            
            if adx > 25 or directional > 0.7:
                return {
                    'regime': 'trend',
                    'confidence': min(0.85, directional * 0.5 + (adx - 15) / 50),
                    'direction': 'up' if avg_return > 0 else 'down',
                    'adx': float(adx),
                    'volatility': float(vol_20),
                    'avg_return': float(avg_return)
                }
            
            # Default: range-bound
            return {
                'regime': 'range',
                'confidence': 0.6,
                'volatility': float(vol_20),
                'avg_return': float(avg_return)
            }
            
        except Exception as e:
            return {'regime': 'range', 'confidence': 0.3, 'error': str(e)}
    
    def _calculate_technical_signal(self, market_data: Dict) -> Dict:
        """
        Calculate technical analysis signal using comprehensive indicator suite.
        
        Uses RSI, MACD, Moving Averages, Bollinger Bands, ADX, Stochastic,
        ATR-based volatility, CCI, and MFI for a robust composite score.
        """
        try:
            prices = market_data.get('prices', [])
            if len(prices) < 60:
                return {
                    'score': 0.0,
                    'confidence': 0.0,
                    'error': 'Insufficient data (need 60+ points)'
                }
            
            # Extract price arrays
            closes = np.array([p.get('close', 0) for p in prices])
            highs = np.array([p.get('high', 0) for p in prices])
            lows = np.array([p.get('low', 0) for p in prices])
            volumes = np.array([p.get('volume', 0) for p in prices])
            
            current_price = closes[-1]
            
            # Calculate all indicators
            rsi = self._calculate_rsi(closes)
            macd, macd_signal, macd_hist = self._calculate_macd(closes)
            sma_20 = np.mean(closes[-20:]) if len(closes) >= 20 else closes[-1]
            sma_50 = np.mean(closes[-50:]) if len(closes) >= 50 else closes[-1]
            
            scores = []
            indicator_details = {}
            
            # 1. RSI scoring (weight: momentum)
            if rsi < 30:
                rsi_score = 0.8  # Oversold - bullish
            elif rsi < 40:
                rsi_score = 0.4
            elif rsi > 70:
                rsi_score = -0.8  # Overbought - bearish
            elif rsi > 60:
                rsi_score = -0.4
            else:
                rsi_score = 0.0
            scores.append(rsi_score)
            indicator_details['rsi'] = rsi
            indicator_details['rsi_signal'] = 'oversold' if rsi < 30 else 'overbought' if rsi > 70 else 'neutral'
            
            # 2. MACD scoring (weight: trend)
            if macd_hist > 0:
                macd_score = min(0.8, macd_hist / (abs(macd) + 1e-8))  # Proportional to histogram strength
            elif macd_hist < 0:
                macd_score = max(-0.8, macd_hist / (abs(macd) + 1e-8))
            else:
                macd_score = 0.0
            scores.append(macd_score)
            
            # 3. Moving Average scoring (weight: trend)
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
            
            # 4. Bollinger Bands scoring (mean reversion + volatility)
            if len(closes) >= 20:
                bb_middle = sma_20
                bb_std = np.std(closes[-20:])
                bb_upper = bb_middle + 2 * bb_std
                bb_lower = bb_middle - 2 * bb_std
                bb_width = (bb_upper - bb_lower) / bb_middle if bb_middle > 0 else 0
                
                if bb_upper > bb_lower:
                    bb_pct = (current_price - bb_lower) / (bb_upper - bb_lower)
                else:
                    bb_pct = 0.5
                
                # Near lower band = oversold (+), near upper = overbought (-)
                bb_score = np.clip(1.0 - 2.0 * bb_pct, -0.7, 0.7)
                scores.append(bb_score)
                indicator_details['bb_pct'] = bb_pct
                indicator_details['bb_width'] = bb_width
            
            # 5. ADX scoring (trend strength, direction from DI+/DI-)
            if len(closes) >= 28:
                adx = self._calculate_adx(highs, lows, closes)
                if adx is not None:
                    # ADX > 25 = trending, < 20 = ranging
                    if adx > 25:
                        # Determine direction from price vs SMA
                        direction = 1.0 if current_price > sma_20 else -1.0
                        adx_score = direction * min(0.6, (adx - 25) / 50)
                    else:
                        adx_score = 0.0  # No clear trend
                    scores.append(adx_score)
                    indicator_details['adx'] = adx
            
            # 6. Stochastic Oscillator scoring
            if len(closes) >= 14:
                stoch_k = self._calculate_stochastic(highs, lows, closes)
                if stoch_k is not None:
                    if stoch_k < 20:
                        stoch_score = 0.6  # Oversold
                    elif stoch_k > 80:
                        stoch_score = -0.6  # Overbought
                    else:
                        stoch_score = (50 - stoch_k) / 100  # Slight directional bias
                    scores.append(stoch_score)
                    indicator_details['stoch_k'] = stoch_k
            
            # 7. CCI scoring (Commodity Channel Index)
            if len(closes) >= 20:
                cci = self._calculate_cci(highs, lows, closes)
                if cci is not None:
                    if cci < -100:
                        cci_score = 0.5  # Oversold
                    elif cci > 100:
                        cci_score = -0.5  # Overbought
                    else:
                        cci_score = -cci / 200  # Linear scaling
                    scores.append(cci_score)
                    indicator_details['cci'] = cci
            
            # 8. MFI scoring (Money Flow Index — volume-weighted RSI)
            if len(closes) >= 14 and np.any(volumes > 0):
                mfi = self._calculate_mfi(highs, lows, closes, volumes)
                if mfi is not None:
                    if mfi < 20:
                        mfi_score = 0.5  # Money flowing in
                    elif mfi > 80:
                        mfi_score = -0.5  # Money flowing out
                    else:
                        mfi_score = (50 - mfi) / 100
                    scores.append(mfi_score)
                    indicator_details['mfi'] = mfi
            
            # 9. Momentum scoring (5/10/20 period returns)
            mom_5 = (current_price / closes[-6] - 1) if len(closes) > 5 else 0
            mom_20 = (current_price / closes[-21] - 1) if len(closes) > 20 else 0
            # Positive momentum = bullish
            mom_score = np.clip((mom_5 * 0.6 + mom_20 * 0.4) * 5, -0.6, 0.6)
            scores.append(mom_score)
            indicator_details['momentum_5d'] = mom_5
            indicator_details['momentum_20d'] = mom_20
            
            # Aggregate technical score
            tech_score = np.mean(scores)
            
            # Confidence: based on indicator agreement (lower std = higher confidence)
            score_std = np.std(scores)
            n_indicators = len(scores)
            # More indicators agreeing = higher confidence
            confidence = max(0.3, min(0.95, 1.0 - score_std + (n_indicators - 3) * 0.03))
            
            return {
                'score': tech_score,
                'confidence': confidence,
                'rsi': rsi,
                'rsi_signal': indicator_details.get('rsi_signal', 'neutral'),
                'macd': macd,
                'macd_signal': macd_signal,
                'macd_hist': macd_hist,
                'sma_20': sma_20,
                'sma_50': sma_50,
                'current_price': current_price,
                'trend': 'bullish' if ma_score > 0.3 else 'bearish' if ma_score < -0.3 else 'neutral',
                'n_indicators': n_indicators,
                **{k: v for k, v in indicator_details.items() if k not in ('rsi_signal',)}
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
    
    def _calculate_adx(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
        """Calculate Average Directional Index (ADX)."""
        try:
            n = len(closes)
            if n < period * 2:
                return None
            
            tr_list = []
            plus_dm_list = []
            minus_dm_list = []
            
            for i in range(1, n):
                high_diff = highs[i] - highs[i-1]
                low_diff = lows[i-1] - lows[i]
                
                tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
                tr_list.append(tr)
                
                plus_dm = high_diff if high_diff > low_diff and high_diff > 0 else 0
                minus_dm = low_diff if low_diff > high_diff and low_diff > 0 else 0
                plus_dm_list.append(plus_dm)
                minus_dm_list.append(minus_dm)
            
            # Smoothed averages (Wilder's smoothing)
            atr = np.mean(tr_list[:period])
            plus_di_smooth = np.mean(plus_dm_list[:period])
            minus_di_smooth = np.mean(minus_dm_list[:period])
            
            dx_list = []
            for i in range(period, len(tr_list)):
                atr = atr - (atr / period) + tr_list[i]
                plus_di_smooth = plus_di_smooth - (plus_di_smooth / period) + plus_dm_list[i]
                minus_di_smooth = minus_di_smooth - (minus_di_smooth / period) + minus_dm_list[i]
                
                plus_di = 100 * plus_di_smooth / atr if atr > 0 else 0
                minus_di = 100 * minus_di_smooth / atr if atr > 0 else 0
                
                di_sum = plus_di + minus_di
                dx = 100 * abs(plus_di - minus_di) / di_sum if di_sum > 0 else 0
                dx_list.append(dx)
            
            if len(dx_list) < period:
                return np.mean(dx_list) if dx_list else None
            
            adx = np.mean(dx_list[:period])
            for i in range(period, len(dx_list)):
                adx = (adx * (period - 1) + dx_list[i]) / period
            
            return adx
        except Exception:
            return None
    
    def _calculate_stochastic(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
        """Calculate Stochastic Oscillator %K."""
        try:
            if len(closes) < period:
                return None
            highest = np.max(highs[-period:])
            lowest = np.min(lows[-period:])
            if highest == lowest:
                return 50.0
            return 100 * (closes[-1] - lowest) / (highest - lowest)
        except Exception:
            return None
    
    def _calculate_cci(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 20) -> float:
        """Calculate Commodity Channel Index (CCI)."""
        try:
            if len(closes) < period:
                return None
            tp = (highs[-period:] + lows[-period:] + closes[-period:]) / 3
            tp_mean = np.mean(tp)
            mean_dev = np.mean(np.abs(tp - tp_mean))
            if mean_dev == 0:
                return 0.0
            return (tp[-1] - tp_mean) / (0.015 * mean_dev)
        except Exception:
            return None
    
    def _calculate_mfi(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, volumes: np.ndarray, period: int = 14) -> float:
        """Calculate Money Flow Index (MFI)."""
        try:
            if len(closes) < period + 1:
                return None
            tp = (highs + lows + closes) / 3
            pos_flow = 0.0
            neg_flow = 0.0
            for i in range(-period, 0):
                money_flow = tp[i] * volumes[i]
                if tp[i] > tp[i-1]:
                    pos_flow += money_flow
                else:
                    neg_flow += money_flow
            if neg_flow == 0:
                return 100.0
            ratio = pos_flow / neg_flow
            return 100 - (100 / (1 + ratio))
        except Exception:
            return None
    
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
