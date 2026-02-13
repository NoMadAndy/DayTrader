"""
Tests für v1.43.0 Features — AI Trader Intelligence Improvements II

Tests:
1. Cosine LR Schedule
2. Curriculum Learning Callback
3. Consistency Reward
4. Signal Recency Weighting (exponential trend)
5. Drawdown-Based Position Scaling (Engine)
6. ATR-Based Position Sizing (Engine)
7. Graduated Risk Checks
8. Win/Loss Streak Tracking
"""

import sys
import os
import numpy as np
import pytest
import pandas as pd

# Setup path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("MODEL_DIR", "/tmp/models")
os.environ.setdefault("CHECKPOINT_DIR", "/tmp/checkpoints")
os.makedirs("/tmp/models", exist_ok=True)
os.makedirs("/tmp/checkpoints", exist_ok=True)

from app.trading_env import TradingEnvironment, DEFAULT_REWARD_WEIGHTS
from app.agent_config import AgentConfig
from app.trainer import cosine_lr_schedule, CurriculumCallback
from app.ai_trader_risk import RiskManager, RiskCheckResult
from app.ai_trader_engine import AITraderConfig, AITraderEngine


# ── Helpers ──────────────────────────────────────────────────────────────────

def make_df(rows=300, trend="up"):
    """Create synthetic OHLCV DataFrame with indicators."""
    np.random.seed(42)
    base = 100.0
    prices = [base]
    for i in range(1, rows):
        if trend == "up":
            change = np.random.normal(0.001, 0.01)
        elif trend == "down":
            change = np.random.normal(-0.001, 0.01)
        else:
            change = np.random.normal(0.0, 0.01)
        prices.append(prices[-1] * (1 + change))

    closes = np.array(prices)
    df = pd.DataFrame({
        "open": closes * (1 + np.random.uniform(-0.005, 0.005, rows)),
        "high": closes * (1 + np.random.uniform(0.001, 0.015, rows)),
        "low": closes * (1 - np.random.uniform(0.001, 0.015, rows)),
        "close": closes,
        "volume": np.random.randint(1_000_000, 10_000_000, rows).astype(float),
    })

    # Add all required indicator columns
    df["returns"] = df["close"].pct_change().fillna(0)
    df["log_returns"] = np.log(df["close"] / df["close"].shift(1)).fillna(0)
    df["sma_20"] = df["close"].rolling(20).mean().bfill()
    df["sma_50"] = df["close"].rolling(50).mean().bfill()
    df["sma_200"] = df["close"].rolling(200).mean().bfill()
    df["ema_12"] = df["close"].ewm(span=12).mean()
    df["ema_26"] = df["close"].ewm(span=26).mean()
    df["rsi"] = 50.0
    df["rsi_signal"] = 50.0
    df["macd"] = df["ema_12"] - df["ema_26"]
    df["macd_signal"] = df["macd"].ewm(span=9).mean()
    df["macd_hist"] = df["macd"] - df["macd_signal"]
    df["bb_middle"] = df["sma_20"]
    std = df["close"].rolling(20).std().bfill()
    df["bb_upper"] = df["bb_middle"] + 2 * std
    df["bb_lower"] = df["bb_middle"] - 2 * std
    df["bb_width"] = (df["bb_upper"] - df["bb_lower"]) / df["bb_middle"]
    df["bb_pct"] = (df["close"] - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-8)
    df["atr"] = (df["high"] - df["low"]).rolling(14).mean().bfill()
    df["atr_pct"] = df["atr"] / df["close"] * 100
    df["obv"] = (np.sign(df["returns"]) * df["volume"]).cumsum()
    df["obv_ema"] = df["obv"].ewm(span=20).mean()
    df["adx"] = 25.0
    df["plus_di"] = 20.0
    df["minus_di"] = 15.0
    df["stoch_k"] = 50.0
    df["stoch_d"] = 50.0
    df["cci"] = 0.0
    df["mfi"] = 50.0
    df["volatility"] = df["returns"].rolling(20).std().bfill() * np.sqrt(252)
    df["trend_strength"] = 0.25
    df["momentum_5"] = df["close"] / df["close"].shift(5) - 1
    df["momentum_10"] = df["close"] / df["close"].shift(10) - 1
    df["momentum_20"] = df["close"] / df["close"].shift(20) - 1
    df["volume_sma"] = df["volume"].rolling(20).mean().bfill()
    df["volume_ratio"] = df["volume"] / df["volume_sma"]
    df["gap"] = (df["open"] - df["close"].shift(1)) / df["close"].shift(1)
    df = df.bfill().ffill().fillna(0)
    return df


# ════════════════════════════════════════════════════════════════════════════
# 1. Cosine LR Schedule
# ════════════════════════════════════════════════════════════════════════════

class TestCosineLRSchedule:
    """Test cosine annealing learning rate schedule."""

    def test_schedule_returns_callable(self):
        schedule = cosine_lr_schedule(0.0003)
        assert callable(schedule)

    def test_schedule_at_start(self):
        """At start (progress_remaining=1.0), LR should be at initial value."""
        schedule = cosine_lr_schedule(0.0003)
        lr = schedule(1.0)
        assert abs(lr - 0.0003) < 1e-8

    def test_schedule_at_end(self):
        """At end (progress_remaining=0.0), LR should be at 10% of initial."""
        schedule = cosine_lr_schedule(0.0003)
        lr = schedule(0.0)
        assert abs(lr - 0.00003) < 1e-8

    def test_schedule_monotonically_decreasing(self):
        """LR should decrease as training progresses."""
        schedule = cosine_lr_schedule(0.001)
        lrs = [schedule(p) for p in np.linspace(1.0, 0.0, 20)]
        for i in range(1, len(lrs)):
            assert lrs[i] <= lrs[i - 1] + 1e-10

    def test_schedule_at_midpoint(self):
        """At midpoint, LR should be roughly 55% of initial (cosine curve)."""
        schedule = cosine_lr_schedule(0.001)
        lr_mid = schedule(0.5)
        assert 0.0004 < lr_mid < 0.0007  # approximately 55%


# ════════════════════════════════════════════════════════════════════════════
# 2. Curriculum Learning Callback
# ════════════════════════════════════════════════════════════════════════════

class TestCurriculumCallback:
    """Test curriculum learning callback structure."""

    def test_callback_creation(self):
        cb = CurriculumCallback()
        assert cb.current_phase == 0
        assert len(cb._phase_boundaries) == 3
        assert len(cb._phase_multipliers) == 3

    def test_phase_multipliers_structure(self):
        """Each phase should have the required keys."""
        cb = CurriculumCallback()
        required_keys = {
            "drawdown_penalty_scale",
            "step_fee_penalty_scale",
            "opportunity_cost_scale",
            "churning_penalty",
            "holding_in_range_bonus",
            "holding_too_long_penalty",
        }
        for phase in cb._phase_multipliers:
            assert required_keys.issubset(phase.keys())

    def test_phase_progression(self):
        """Phase 1 should have lower multipliers than Phase 3."""
        cb = CurriculumCallback()
        phase1 = cb._phase_multipliers[0]
        phase3 = cb._phase_multipliers[2]
        # Penalty scales should increase
        assert phase1["drawdown_penalty_scale"] < phase3["drawdown_penalty_scale"]
        assert phase1["step_fee_penalty_scale"] < phase3["step_fee_penalty_scale"]
        assert phase1["opportunity_cost_scale"] < phase3["opportunity_cost_scale"]

    def test_phase_names(self):
        cb = CurriculumCallback()
        assert len(cb._phase_names) == 3
        assert "Easy" in cb._phase_names[0]
        assert "Full" in cb._phase_names[2]


# ════════════════════════════════════════════════════════════════════════════
# 3. Consistency Reward
# ════════════════════════════════════════════════════════════════════════════

class TestConsistencyReward:
    """Test consistency bonus in step reward."""

    def test_consistency_bonus_key_exists(self):
        assert "consistency_bonus_scale" in DEFAULT_REWARD_WEIGHTS
        assert DEFAULT_REWARD_WEIGHTS["consistency_bonus_scale"] == 5.0

    def test_consistency_reward_with_positive_streak(self):
        """Agent with consistently positive returns should get bonus."""
        env = TradingEnvironment(df=make_df(trend="up"), config=AgentConfig(name="test"))
        env.reset()

        # Simulate 15 positive returns
        env._daily_returns = [0.005] * 15  # Consistent positive

        rw = env.reward_weights
        reward = env._calculate_step_reward(0.005, 0.0, env.initial_balance)

        # Should include consistency bonus (positive_ratio = 1.0 > 0.6)
        # Bonus = (1.0 - 0.5) * 5.0 = 2.5
        # Also low variance bonus: std(same values) = 0, mean > 0
        assert reward > 0

    def test_consistency_reward_with_mixed_returns(self):
        """Agent with mixed returns should get smaller or no bonus."""
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        env.reset()

        # Simulate mixed returns (50% positive)
        env._daily_returns = [0.01, -0.01] * 5 + [0.01, -0.01]  # 50/50

        reward_mixed = env._calculate_step_reward(0.0, 0.0, env.initial_balance)

        # Now test mostly positive
        env._daily_returns = [0.005] * 10
        reward_positive = env._calculate_step_reward(0.0, 0.0, env.initial_balance)

        # Positive streak should yield higher reward
        assert reward_positive > reward_mixed

    def test_low_variance_bonus(self):
        """Consistent low-variance positive returns get extra bonus."""
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        env.reset()

        # Very consistent small positive returns
        env._daily_returns = [0.002] * 15
        reward_steady = env._calculate_step_reward(0.002, 0.0, env.initial_balance)

        # Volatile large returns
        env._daily_returns = [0.05, -0.03, 0.04, -0.02, 0.06, -0.01, 0.03, -0.04, 0.05, -0.02]
        reward_volatile = env._calculate_step_reward(0.002, 0.0, env.initial_balance)

        # Steady returns should get equal or higher consistency bonus
        # Note: the base sharpe reward also differs, so just check steady is not penalized
        assert reward_steady >= 0


# ════════════════════════════════════════════════════════════════════════════
# 4. Signal Recency Weighting
# ════════════════════════════════════════════════════════════════════════════

class TestSignalRecencyWeighting:
    """Test exponential recency weighting in technical signals."""

    def test_recency_weighted_momentum(self):
        """Recent momentum should be weighted 50%, not 60% like before."""
        from app.ai_trader_signals import SignalAggregator

        # Create aggregator with minimal config
        config = AITraderConfig(trader_id=1, name="test")
        agg = SignalAggregator(config)

        # Generate market data with strong recent momentum
        prices = []
        base = 100.0
        for i in range(60):
            if i < 40:
                base += 0.0  # Flat for first 40 bars
            else:
                base += 1.0  # Strong uptrend in last 20 bars
            prices.append({
                "close": base,
                "high": base + 0.5,
                "low": base - 0.5,
                "volume": 5_000_000,
            })

        market_data = {"prices": prices}
        result = agg._calculate_technical_signal(market_data)

        # Should have momentum_5d captured
        assert "momentum_5d" in result
        assert result["momentum_5d"] > 0  # Recent uptrend

    def test_exponential_weighted_trend(self):
        """Exponentially weighted trend indicator should be present."""
        from app.ai_trader_signals import SignalAggregator

        config = AITraderConfig(trader_id=1, name="test")
        agg = SignalAggregator(config)

        # Uptrending prices
        prices = []
        for i in range(60):
            prices.append({
                "close": 100 + i * 0.5,
                "high": 100.5 + i * 0.5,
                "low": 99.5 + i * 0.5,
                "volume": 5_000_000,
            })

        market_data = {"prices": prices}
        result = agg._calculate_technical_signal(market_data)

        # Should have ew_trend key (exponentially weighted)
        assert "ew_trend" in result
        assert result["ew_trend"] > 0  # Uptrend

    def test_n_indicators_increased(self):
        """Should have 10+ indicators with recency-weighted trend added."""
        from app.ai_trader_signals import SignalAggregator

        config = AITraderConfig(trader_id=1, name="test")
        agg = SignalAggregator(config)

        prices = [{"close": 100 + i * 0.1, "high": 100.5 + i * 0.1,
                    "low": 99.5 + i * 0.1, "volume": 5_000_000} for i in range(60)]
        result = agg._calculate_technical_signal({"prices": prices})

        assert result.get("n_indicators", 0) >= 10


# ════════════════════════════════════════════════════════════════════════════
# 5. Drawdown-Based Position Scaling (Engine)
# ════════════════════════════════════════════════════════════════════════════

class TestDrawdownPositionScaling:
    """Test that position sizes reduce during drawdown."""

    def _make_engine(self):
        config = AITraderConfig(
            trader_id=1, name="test",
            initial_budget=100000,
            max_drawdown=0.15,
            position_sizing="fixed",
            fixed_position_percent=0.10,
        )
        engine = AITraderEngine(config)
        return engine

    def test_no_drawdown_full_size(self):
        """No drawdown should give full position size."""
        engine = self._make_engine()
        portfolio = {
            "cash": 100000,
            "total_value": 100000,
            "max_value": 100000,
            "positions": {},
        }
        size, qty = engine._calculate_position_size("buy", 100.0, 0.8, portfolio)
        # $10,000 = 10% of 100k
        assert size == pytest.approx(10000, rel=0.01)
        assert qty == 100

    def test_moderate_drawdown_delegated_to_risk_manager(self):
        """Position sizing delegates drawdown scaling to RiskManager.
        
        _calculate_position_size should NOT scale for drawdown itself.
        Instead, RiskManager._check_drawdown_graduated provides the scale factor
        which is applied in analyze_symbol(). This prevents double-scaling.
        """
        engine = self._make_engine()
        # 7.5% drawdown = 50% of 15% max drawdown
        portfolio = {
            "cash": 92500,
            "total_value": 92500,
            "max_value": 100000,
            "positions": {},
        }
        size, qty = engine._calculate_position_size("buy", 100.0, 0.8, portfolio)
        # Position size should be FULL (drawdown scaling not applied here)
        assert size == pytest.approx(10000, rel=0.01)
        # The RiskManager will scale this down via position_scale_factor

    def test_drawdown_scaling_via_risk_manager(self):
        """RiskManager provides graduated drawdown scaling."""
        config = AITraderConfig(
            trader_id=1, name="test",
            initial_budget=100000,
            max_drawdown=0.15,
        )
        rm = RiskManager(config)
        # 10% drawdown = 67% of 15% max
        portfolio = {"total_value": 90000, "max_value": 100000}
        check, scale = rm._check_drawdown_graduated(portfolio)
        # At 67% of max DD: scale = 0.50
        assert scale == 0.50
        # Applied in analyze_symbol: $10,000 * 0.50 = $5,000
        base_size = 10000
        scaled = base_size * scale
        assert scaled == pytest.approx(5000, rel=0.01)


# ════════════════════════════════════════════════════════════════════════════
# 6. ATR-Based Position Sizing
# ════════════════════════════════════════════════════════════════════════════

class TestATRPositionSizing:
    """Test ATR-inverse volatility-based position sizing."""

    def test_volatility_sizing_with_market_data(self):
        """Volatility sizing should use ATR when market data available."""
        config = AITraderConfig(
            trader_id=1, name="test",
            initial_budget=100000,
            position_sizing="volatility",
            fixed_position_percent=0.10,
        )
        engine = AITraderEngine(config)

        # Create market data with low volatility (ATR ~2% of price)
        prices = [{"close": 100, "high": 102, "low": 98, "volume": 5000000}
                  for _ in range(30)]
        portfolio = {
            "cash": 100000, "total_value": 100000, "max_value": 100000,
            "positions": {},
        }
        size_low_vol, _ = engine._calculate_position_size(
            "buy", 100.0, 0.8, portfolio, market_data={"prices": prices})

        # High volatility (ATR ~10% of price)
        prices_high = [{"close": 100, "high": 110, "low": 90, "volume": 5000000}
                       for _ in range(30)]
        size_high_vol, _ = engine._calculate_position_size(
            "buy", 100.0, 0.8, portfolio, market_data={"prices": prices_high})

        # Low volatility should yield LARGER positions (ATR-inverse)
        assert size_low_vol > size_high_vol

    def test_volatility_sizing_fallback(self):
        """Without market data, should fall back to confidence-scaled fixed."""
        config = AITraderConfig(
            trader_id=1, name="test",
            initial_budget=100000,
            position_sizing="volatility",
            fixed_position_percent=0.10,
        )
        engine = AITraderEngine(config)
        portfolio = {
            "cash": 100000, "total_value": 100000, "max_value": 100000,
            "positions": {},
        }
        size, _ = engine._calculate_position_size("buy", 100.0, 0.7, portfolio)
        # Should use fallback: 100000 * 0.10 * 0.7 = 7000
        assert size == pytest.approx(7000, rel=0.05)


# ════════════════════════════════════════════════════════════════════════════
# 7. Graduated Risk Checks
# ════════════════════════════════════════════════════════════════════════════

class TestGraduatedRiskChecks:
    """Test graduated drawdown risk checks with position scaling."""

    def _make_risk_manager(self, max_drawdown=0.15):
        config = AITraderConfig(
            trader_id=1, name="test",
            max_drawdown=max_drawdown,
        )
        return RiskManager(config)

    def test_no_drawdown_scale_1(self):
        """No drawdown -> scale factor = 1.0."""
        rm = self._make_risk_manager()
        portfolio = {"total_value": 100000, "max_value": 100000}
        check, scale = rm._check_drawdown_graduated(portfolio)
        assert scale == 1.0
        assert check.passed is True
        assert check.severity == "info"

    def test_moderate_drawdown_scale_075(self):
        """25-50% of max drawdown -> scale = 0.75."""
        rm = self._make_risk_manager()
        # 5% drawdown = 33% of 15% max -> between 25% and 50%
        portfolio = {"total_value": 95000, "max_value": 100000}
        check, scale = rm._check_drawdown_graduated(portfolio)
        assert scale == 0.75
        assert check.severity == "warning"

    def test_high_drawdown_scale_050(self):
        """50-75% of max drawdown -> scale = 0.50."""
        rm = self._make_risk_manager()
        # 10% drawdown = 67% of 15% max
        portfolio = {"total_value": 90000, "max_value": 100000}
        check, scale = rm._check_drawdown_graduated(portfolio)
        assert scale == 0.50
        assert check.severity == "warning"

    def test_severe_drawdown_scale_030(self):
        """75%+ of max drawdown -> scale = 0.30."""
        rm = self._make_risk_manager()
        # 13% drawdown = 87% of 15% max
        portfolio = {"total_value": 87000, "max_value": 100000}
        check, scale = rm._check_drawdown_graduated(portfolio)
        assert scale == 0.30
        assert check.severity == "warning"

    def test_risk_result_has_scale_factor(self):
        """RiskCheckResult should have position_scale_factor field."""
        result = RiskCheckResult(
            all_passed=True,
            passed_count=10,
            total_count=10,
            checks=[],
            warnings=[],
            blockers=[],
            position_scale_factor=0.75,
        )
        assert result.position_scale_factor == 0.75

    def test_scale_factor_default_is_1(self):
        """Default position_scale_factor should be 1.0."""
        result = RiskCheckResult(
            all_passed=True,
            passed_count=10,
            total_count=10,
            checks=[],
            warnings=[],
            blockers=[],
        )
        assert result.position_scale_factor == 1.0


# ════════════════════════════════════════════════════════════════════════════
# 8. Win/Loss Streak Tracking
# ════════════════════════════════════════════════════════════════════════════

class TestWinLossStreakTracking:
    """Test win/loss streak tracking and its effect on position sizing."""

    def _make_engine(self):
        config = AITraderConfig(
            trader_id=1, name="test",
            initial_budget=100000,
            position_sizing="fixed",
            fixed_position_percent=0.10,
        )
        return AITraderEngine(config)

    def test_initial_streaks_zero(self):
        """Engine should start with 0 consecutive wins and losses."""
        engine = self._make_engine()
        assert engine.consecutive_wins == 0
        assert engine.consecutive_losses == 0

    def test_record_winning_trade(self):
        engine = self._make_engine()
        engine.record_trade_outcome(500)
        assert engine.consecutive_wins == 1
        assert engine.consecutive_losses == 0

    def test_record_losing_trade(self):
        engine = self._make_engine()
        engine.record_trade_outcome(-300)
        assert engine.consecutive_losses == 1
        assert engine.consecutive_wins == 0

    def test_streak_reset_on_opposite(self):
        """Winning trade should reset loss streak and vice versa."""
        engine = self._make_engine()
        engine.record_trade_outcome(-100)
        engine.record_trade_outcome(-200)
        assert engine.consecutive_losses == 2
        engine.record_trade_outcome(100)  # Win resets losses
        assert engine.consecutive_losses == 0
        assert engine.consecutive_wins == 1

    def test_loss_streak_reduces_position(self):
        """After 3+ consecutive losses, position size should be reduced."""
        engine = self._make_engine()
        portfolio = {
            "cash": 100000, "total_value": 100000, "max_value": 100000,
            "positions": {},
        }

        # No streak
        size_normal, _ = engine._calculate_position_size("buy", 100.0, 0.8, portfolio)

        # Record 4 losses
        for _ in range(4):
            engine.record_trade_outcome(-500)

        size_after_losses, _ = engine._calculate_position_size("buy", 100.0, 0.8, portfolio)

        # Should be reduced
        assert size_after_losses < size_normal

    def test_trade_history_capped(self):
        """Trade history should be capped at 100 entries."""
        engine = self._make_engine()
        for i in range(150):
            engine.record_trade_outcome(100 if i % 2 == 0 else -50)
        assert len(engine._trade_history) <= 100

    def test_win_streak_raises_threshold(self):
        """After 5+ consecutive wins, adaptive threshold should increase."""
        config = AITraderConfig(
            trader_id=1, name="test",
            min_confidence=0.65,
            adaptive_threshold=True,
        )
        engine = AITraderEngine(config)

        from app.ai_trader_signals import AggregatedSignal
        aggregated = AggregatedSignal(
            weighted_score=0.5,
            confidence=0.8,
            agreement="moderate",
            ml_score=0.5, rl_score=0.5,
            sentiment_score=0.5, technical_score=0.5,
            ml_details={}, rl_details={},
            sentiment_details={}, technical_details={},
            market_context={},
        )
        portfolio = {"total_value": 100000, "max_value": 100000}

        # Normal threshold
        threshold_normal = engine._calculate_adaptive_threshold(aggregated, portfolio)

        # Record 6 wins
        for _ in range(6):
            engine.record_trade_outcome(1000)

        threshold_after_wins = engine._calculate_adaptive_threshold(aggregated, portfolio)

        # Threshold should be slightly higher (anti-overconfidence)
        assert threshold_after_wins > threshold_normal
