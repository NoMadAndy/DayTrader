"""
Market Regime Detection and Regime-Based Signal Weighting

Detects current market regime (bull, bear, sideways, high-volatility)
and adjusts signal weights accordingly for better performance.

Also provides multi-timeframe analysis support.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from enum import Enum
import numpy as np
import logging

logger = logging.getLogger(__name__)


class MarketRegime(str, Enum):
    """Market regime classification"""
    STRONG_BULL = "strong_bull"
    BULL = "bull"
    SIDEWAYS = "sideways"
    BEAR = "bear"
    STRONG_BEAR = "strong_bear"
    HIGH_VOLATILITY = "high_volatility"
    CRASH = "crash"


@dataclass
class RegimeAnalysis:
    """Result of market regime analysis"""
    regime: MarketRegime
    confidence: float  # 0-1
    trend_strength: float  # -1 to +1
    volatility_level: str  # 'low', 'normal', 'high', 'extreme'
    volatility_percentile: float  # 0-100
    momentum: float  # -1 to +1
    details: Dict


@dataclass
class RegimeWeights:
    """Signal weights adjusted for market regime"""
    ml_weight: float
    rl_weight: float
    sentiment_weight: float
    technical_weight: float
    regime: MarketRegime
    adjustment_reason: str


class MarketRegimeDetector:
    """
    Detects market regime from price data and technical indicators.

    Uses multiple signals:
    - Trend direction and strength (SMA crossovers, ADX)
    - Volatility level (ATR percentile, Bollinger Band width)
    - Momentum (RSI, MACD, price momentum)
    - Volume dynamics
    """

    def __init__(self):
        self._regime_history: List[MarketRegime] = []

    def detect_regime(
        self,
        prices: List[Dict],
        indicators: Optional[Dict] = None,
    ) -> RegimeAnalysis:
        """
        Detect current market regime from price data.

        Args:
            prices: List of OHLCV dicts (most recent last)
            indicators: Pre-calculated indicators (optional)

        Returns:
            RegimeAnalysis with regime classification
        """
        if not prices or len(prices) < 50:
            return RegimeAnalysis(
                regime=MarketRegime.SIDEWAYS,
                confidence=0.3,
                trend_strength=0.0,
                volatility_level='normal',
                volatility_percentile=50.0,
                momentum=0.0,
                details={'reason': 'Insufficient data'}
            )

        closes = np.array([p.get('close', 0) for p in prices if p.get('close', 0) > 0])
        highs = np.array([p.get('high', 0) for p in prices if p.get('high', 0) > 0])
        lows = np.array([p.get('low', 0) for p in prices if p.get('low', 0) > 0])

        if len(closes) < 50:
            return RegimeAnalysis(
                regime=MarketRegime.SIDEWAYS,
                confidence=0.3,
                trend_strength=0.0,
                volatility_level='normal',
                volatility_percentile=50.0,
                momentum=0.0,
                details={'reason': 'Insufficient valid data'}
            )

        # 1. Trend analysis
        sma_20 = np.mean(closes[-20:])
        sma_50 = np.mean(closes[-50:])
        sma_200 = np.mean(closes[-min(200, len(closes)):])
        current_price = closes[-1]

        # Price relative to SMAs
        above_sma20 = current_price > sma_20
        above_sma50 = current_price > sma_50
        above_sma200 = current_price > sma_200

        # SMA slope (normalized)
        sma20_slope = (sma_20 - np.mean(closes[-25:-5])) / sma_20 if sma_20 > 0 else 0
        sma50_slope = (np.mean(closes[-10:]) - np.mean(closes[-50:-40])) / sma_50 if sma_50 > 0 else 0

        # Trend score: -1 (strong bear) to +1 (strong bull)
        trend_score = 0.0
        if above_sma20:
            trend_score += 0.2
        else:
            trend_score -= 0.2
        if above_sma50:
            trend_score += 0.3
        else:
            trend_score -= 0.3
        if above_sma200:
            trend_score += 0.2
        else:
            trend_score -= 0.2
        trend_score += np.clip(sma20_slope * 50, -0.15, 0.15)
        trend_score += np.clip(sma50_slope * 30, -0.15, 0.15)

        # 2. Volatility analysis
        returns = np.diff(closes) / closes[:-1]
        recent_vol = np.std(returns[-20:]) * np.sqrt(252) if len(returns) >= 20 else 0.15

        # Historical volatility percentiles
        if len(returns) >= 50:
            rolling_vols = []
            for i in range(20, len(returns)):
                rv = np.std(returns[i-20:i]) * np.sqrt(252)
                rolling_vols.append(rv)
            vol_percentile = np.percentile(
                rolling_vols,
                [i for i, v in enumerate(sorted(rolling_vols)) if v <= recent_vol][-1] / len(rolling_vols) * 100
            ) if rolling_vols else 50.0
            # Simpler percentile calculation
            vol_percentile = sum(1 for v in rolling_vols if v <= recent_vol) / len(rolling_vols) * 100
        else:
            vol_percentile = 50.0

        if recent_vol < 0.10:
            vol_level = 'low'
        elif recent_vol < 0.20:
            vol_level = 'normal'
        elif recent_vol < 0.35:
            vol_level = 'high'
        else:
            vol_level = 'extreme'

        # 3. Momentum analysis
        momentum_5d = (closes[-1] / closes[-6] - 1) if len(closes) >= 6 else 0
        momentum_20d = (closes[-1] / closes[-21] - 1) if len(closes) >= 21 else 0

        # RSI approximation
        gains = returns[returns > 0]
        losses = np.abs(returns[returns < 0])
        avg_gain = np.mean(gains[-14:]) if len(gains) >= 14 else np.mean(gains) if len(gains) > 0 else 0
        avg_loss = np.mean(losses[-14:]) if len(losses) >= 14 else np.mean(losses) if len(losses) > 0 else 0.001
        rs = avg_gain / avg_loss if avg_loss > 0 else 1
        rsi = 100 - (100 / (1 + rs))

        momentum_score = np.clip(momentum_5d * 5, -1, 1) * 0.4 + np.clip(momentum_20d * 3, -1, 1) * 0.3
        momentum_score += (rsi - 50) / 100 * 0.3

        # 4. Classify regime
        regime, confidence = self._classify_regime(
            trend_score, recent_vol, vol_level, momentum_score, vol_percentile
        )

        # Track regime history
        self._regime_history.append(regime)
        if len(self._regime_history) > 100:
            self._regime_history = self._regime_history[-100:]

        return RegimeAnalysis(
            regime=regime,
            confidence=confidence,
            trend_strength=np.clip(trend_score, -1, 1),
            volatility_level=vol_level,
            volatility_percentile=vol_percentile,
            momentum=np.clip(momentum_score, -1, 1),
            details={
                'sma_20': float(sma_20),
                'sma_50': float(sma_50),
                'sma_200': float(sma_200),
                'above_sma20': above_sma20,
                'above_sma50': above_sma50,
                'above_sma200': above_sma200,
                'annualized_volatility': float(recent_vol),
                'rsi_approx': float(rsi),
                'momentum_5d': float(momentum_5d),
                'momentum_20d': float(momentum_20d),
            }
        )

    def _classify_regime(
        self,
        trend: float,
        volatility: float,
        vol_level: str,
        momentum: float,
        vol_percentile: float,
    ) -> Tuple[MarketRegime, float]:
        """Classify market regime from computed scores"""

        # Crash detection: extremely negative momentum + high volatility
        if momentum < -0.6 and vol_level in ('high', 'extreme'):
            return MarketRegime.CRASH, 0.85

        # High volatility regime
        if vol_level == 'extreme' or (vol_level == 'high' and vol_percentile > 85):
            return MarketRegime.HIGH_VOLATILITY, 0.75

        # Trend-based classification
        if trend > 0.5:
            return MarketRegime.STRONG_BULL, min(0.9, 0.5 + abs(trend))
        elif trend > 0.15:
            return MarketRegime.BULL, min(0.85, 0.5 + abs(trend))
        elif trend < -0.5:
            return MarketRegime.STRONG_BEAR, min(0.9, 0.5 + abs(trend))
        elif trend < -0.15:
            return MarketRegime.BEAR, min(0.85, 0.5 + abs(trend))
        else:
            return MarketRegime.SIDEWAYS, 0.6

    def get_regime_adjusted_weights(
        self,
        regime_analysis: RegimeAnalysis,
        base_weights: Dict[str, float],
    ) -> RegimeWeights:
        """
        Adjust signal weights based on detected market regime.

        Strategy:
        - Bull/Bear trending: Increase RL and Technical weight
        - Sideways: Increase Mean Reversion / Technical
        - High volatility: Increase Sentiment, reduce position sizes
        - Crash: Heavy Sentiment weight, defensive
        """
        ml_w = base_weights.get('ml_weight', 0.30)
        rl_w = base_weights.get('rl_weight', 0.30)
        sent_w = base_weights.get('sentiment_weight', 0.20)
        tech_w = base_weights.get('technical_weight', 0.20)

        regime = regime_analysis.regime
        reason = f"Regime: {regime.value}"

        if regime in (MarketRegime.STRONG_BULL, MarketRegime.BULL):
            # Trending up: RL and Technical are strong
            rl_w += 0.08
            tech_w += 0.05
            ml_w -= 0.05
            sent_w -= 0.08
            reason += " - Boost RL/Technical for trend-following"

        elif regime in (MarketRegime.STRONG_BEAR, MarketRegime.BEAR):
            # Trending down: Sentiment important for bottoming signals
            sent_w += 0.08
            tech_w += 0.05
            rl_w -= 0.05
            ml_w -= 0.08
            reason += " - Boost Sentiment/Technical for bearish signals"

        elif regime == MarketRegime.SIDEWAYS:
            # Range-bound: Technical indicators shine
            tech_w += 0.10
            ml_w += 0.05
            rl_w -= 0.10
            sent_w -= 0.05
            reason += " - Boost Technical for mean-reversion"

        elif regime == MarketRegime.HIGH_VOLATILITY:
            # High vol: Sentiment drives, reduce ML (noisy)
            sent_w += 0.12
            tech_w += 0.03
            ml_w -= 0.10
            rl_w -= 0.05
            reason += " - Boost Sentiment, reduce ML in high volatility"

        elif regime == MarketRegime.CRASH:
            # Crash: Sentiment is king, defensive mode
            sent_w += 0.20
            tech_w -= 0.05
            ml_w -= 0.10
            rl_w -= 0.05
            reason += " - Heavy Sentiment weight in crash mode"

        # Normalize weights to sum to 1.0
        total = ml_w + rl_w + sent_w + tech_w
        if total > 0:
            ml_w /= total
            rl_w /= total
            sent_w /= total
            tech_w /= total

        # Ensure no negative weights
        ml_w = max(0.05, ml_w)
        rl_w = max(0.05, rl_w)
        sent_w = max(0.05, sent_w)
        tech_w = max(0.05, tech_w)

        # Re-normalize
        total = ml_w + rl_w + sent_w + tech_w
        ml_w /= total
        rl_w /= total
        sent_w /= total
        tech_w /= total

        return RegimeWeights(
            ml_weight=round(ml_w, 4),
            rl_weight=round(rl_w, 4),
            sentiment_weight=round(sent_w, 4),
            technical_weight=round(tech_w, 4),
            regime=regime,
            adjustment_reason=reason,
        )


class MultiTimeframeAnalyzer:
    """
    Analyzes signals across multiple timeframes for confirmation.

    A signal confirmed across multiple timeframes has higher reliability.
    """

    def __init__(self):
        self.timeframes = ['short', 'medium', 'long']

    def analyze_multi_timeframe(
        self,
        prices: List[Dict],
    ) -> Dict:
        """
        Analyze price data at multiple timeframes.

        Args:
            prices: Daily OHLCV data (minimum 200 bars)

        Returns:
            Dict with multi-timeframe analysis results
        """
        if not prices or len(prices) < 50:
            return {
                'alignment': 'neutral',
                'strength': 0.0,
                'timeframes': {},
                'confirmation_level': 0
            }

        closes = [p.get('close', 0) for p in prices if p.get('close', 0) > 0]
        if len(closes) < 50:
            return {
                'alignment': 'neutral',
                'strength': 0.0,
                'timeframes': {},
                'confirmation_level': 0
            }

        # Short-term (5-20 day lookback)
        short_signal = self._analyze_timeframe(closes, 5, 20)

        # Medium-term (20-50 day lookback)
        medium_signal = self._analyze_timeframe(closes, 20, 50)

        # Long-term (50-200 day lookback)
        long_signal = self._analyze_timeframe(closes, 50, min(200, len(closes)))

        timeframes = {
            'short': short_signal,
            'medium': medium_signal,
            'long': long_signal,
        }

        # Check alignment
        signals = [short_signal['direction'], medium_signal['direction'], long_signal['direction']]
        bullish_count = sum(1 for s in signals if s == 'bullish')
        bearish_count = sum(1 for s in signals if s == 'bearish')

        if bullish_count == 3:
            alignment = 'strongly_bullish'
            strength = 0.9
            confirmation = 3
        elif bullish_count >= 2:
            alignment = 'bullish'
            strength = 0.6
            confirmation = 2
        elif bearish_count == 3:
            alignment = 'strongly_bearish'
            strength = -0.9
            confirmation = 3
        elif bearish_count >= 2:
            alignment = 'bearish'
            strength = -0.6
            confirmation = 2
        else:
            alignment = 'neutral'
            strength = 0.0
            confirmation = 0

        return {
            'alignment': alignment,
            'strength': strength,
            'timeframes': timeframes,
            'confirmation_level': confirmation,
        }

    def _analyze_timeframe(
        self,
        closes: List[float],
        short_period: int,
        long_period: int,
    ) -> Dict:
        """Analyze a single timeframe"""
        current = closes[-1]

        # Short MA
        short_ma = np.mean(closes[-short_period:]) if len(closes) >= short_period else current
        # Long MA
        long_ma = np.mean(closes[-long_period:]) if len(closes) >= long_period else current

        # Direction
        if short_ma > long_ma * 1.005:
            direction = 'bullish'
        elif short_ma < long_ma * 0.995:
            direction = 'bearish'
        else:
            direction = 'neutral'

        # Momentum
        start_price = closes[-long_period] if len(closes) >= long_period else closes[0]
        momentum = (current - start_price) / start_price if start_price > 0 else 0

        # Price vs MA
        price_vs_short_ma = (current - short_ma) / short_ma if short_ma > 0 else 0
        price_vs_long_ma = (current - long_ma) / long_ma if long_ma > 0 else 0

        return {
            'direction': direction,
            'short_ma': float(short_ma),
            'long_ma': float(long_ma),
            'momentum': float(momentum),
            'price_vs_short_ma': float(price_vs_short_ma),
            'price_vs_long_ma': float(price_vs_long_ma),
        }

    def get_confidence_multiplier(self, analysis: Dict) -> float:
        """
        Get confidence multiplier based on multi-timeframe alignment.

        Returns:
            Multiplier (0.5 - 1.3):
            - 3 timeframes aligned: 1.3x
            - 2 timeframes aligned: 1.1x
            - Mixed: 0.8x
            - Conflicting: 0.5x
        """
        confirmation = analysis.get('confirmation_level', 0)

        if confirmation == 3:
            return 1.3
        elif confirmation == 2:
            return 1.1
        elif confirmation == 0:
            return 0.8
        else:
            return 0.5
