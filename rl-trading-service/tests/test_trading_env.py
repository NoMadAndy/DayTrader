"""Tests for the TradingEnvironment (v2) — core RL environment."""

import numpy as np
import pandas as pd
import pytest

from app.trading_env import (
    TradingEnvironment,
    Actions,
    DEFAULT_REWARD_WEIGHTS,
)
from app.agent_config import AgentConfig

# N_PORTFOLIO_FEATURES is a class attribute
N_PORTFOLIO_FEATURES = TradingEnvironment.N_PORTFOLIO_FEATURES


def make_df(n: int = 200, seed: int = 42) -> pd.DataFrame:
    """Create a synthetic OHLCV DataFrame for testing."""
    rng = np.random.RandomState(seed)
    close = 100.0 + np.cumsum(rng.randn(n) * 0.5)
    df = pd.DataFrame({
        "date": pd.date_range("2023-01-01", periods=n),
        "open": close + rng.randn(n) * 0.2,
        "high": close + np.abs(rng.randn(n)),
        "low": close - np.abs(rng.randn(n)),
        "close": close,
        "volume": rng.randint(100_000, 1_000_000, n).astype(float),
    })
    df.set_index("date", inplace=True)
    return df


class TestConstants:
    """Verify global constants."""

    def test_n_portfolio_features(self):
        assert N_PORTFOLIO_FEATURES == 7

    def test_actions_count(self):
        assert len(Actions) == 13

    def test_default_reward_weights_keys(self):
        expected_keys = {
            "portfolio_return_scale", "holding_in_range_bonus",
            "holding_too_long_penalty", "drawdown_penalty_threshold",
            "drawdown_penalty_scale", "stop_loss_penalty",
            "take_profit_bonus", "trailing_stop_penalty",
            "episode_return_scale", "fee_ratio_penalty_threshold",
            "fee_ratio_penalty_scale", "churning_penalty",
            "risk_adjusted_scale", "win_rate_bonus_scale",
            "use_sharpe_reward", "sharpe_scale", "sortino_scale",
            "step_fee_penalty_scale", "opportunity_cost_scale",
        }
        assert set(DEFAULT_REWARD_WEIGHTS.keys()) == expected_keys


class TestEnvironmentCreation:
    """Test environment initialization and validation."""

    def test_create_with_default_config(self):
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        obs, info = env.reset()
        assert obs.shape[0] > 0
        assert isinstance(info, dict)

    def test_observation_shape_includes_portfolio_features(self):
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        obs, _ = env.reset()
        assert obs.shape == (300 + N_PORTFOLIO_FEATURES,)

    def test_rejects_insufficient_data(self):
        with pytest.raises(ValueError, match="at least 100 rows"):
            TradingEnvironment(df=make_df(n=50), config=AgentConfig(name="test"))

    def test_accepts_minimum_data(self):
        env = TradingEnvironment(df=make_df(n=100), config=AgentConfig(name="test"))
        obs, _ = env.reset()
        assert obs.shape[0] > 0

    def test_observation_all_finite(self):
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        obs, _ = env.reset()
        assert np.all(np.isfinite(obs))


class TestConfigIntegration:
    """Test that config values are properly propagated to the environment."""

    def test_short_selling_from_config(self):
        cfg = AgentConfig(name="test", enable_short_selling=True)
        env = TradingEnvironment(df=make_df(), config=cfg)
        assert env.enable_short_selling is True
        assert env.action_space.n == 13

    def test_short_selling_disabled_from_config(self):
        cfg = AgentConfig(name="test", enable_short_selling=False)
        env = TradingEnvironment(df=make_df(), config=cfg)
        assert env.enable_short_selling is False
        assert env.action_space.n == 7

    def test_slippage_model_from_config(self):
        cfg = AgentConfig(name="test", slippage_model="fixed", slippage_bps=10.0)
        env = TradingEnvironment(df=make_df(), config=cfg)
        assert env.slippage_model == "fixed"
        assert env.slippage_bps == 10.0

    def test_explicit_params_override_config(self):
        cfg = AgentConfig(name="test", enable_short_selling=False, slippage_model="none")
        env = TradingEnvironment(df=make_df(), config=cfg, enable_short_selling=True, slippage_model="fixed")
        assert env.enable_short_selling is True
        assert env.slippage_model == "fixed"


class TestLongTrading:
    """Test long-only trading actions."""

    def test_hold_action(self):
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        env.reset()
        obs, reward, terminated, truncated, info = env.step(Actions.HOLD)
        assert isinstance(reward, float)
        assert not terminated

    def test_buy_sell_cycle(self):
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        env.reset()
        initial_cash = env.cash

        env.step(Actions.BUY_MEDIUM)
        assert env.shares_held > 0
        assert env.cash < initial_cash

        env.step(Actions.SELL_ALL)
        assert env.shares_held == 0

    def test_buy_sizes_ascending(self):
        """Larger buy actions should acquire more shares."""
        results = []
        for action in [Actions.BUY_SMALL, Actions.BUY_MEDIUM, Actions.BUY_LARGE]:
            env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
            env.reset()
            env.step(action)
            results.append(env.shares_held)
        for i in range(len(results) - 1):
            assert results[i] <= results[i + 1]


class TestShortSelling:
    """Test short selling functionality."""

    def test_short_disabled_by_default(self):
        cfg = AgentConfig(name="test")
        env = TradingEnvironment(df=make_df(), config=cfg)
        env.reset()
        assert env.action_space.n == 7

    def test_short_enabled_via_config(self):
        cfg = AgentConfig(name="test", enable_short_selling=True)
        env = TradingEnvironment(df=make_df(), config=cfg)
        env.reset()
        assert env.action_space.n == 13
        env.step(Actions.SHORT_LARGE)
        assert env.shares_shorted > 0
        assert env.short_collateral > 0

    def test_short_cover_cycle(self):
        cfg = AgentConfig(name="test", enable_short_selling=True)
        env = TradingEnvironment(df=make_df(), config=cfg)
        env.reset()

        env.step(Actions.SHORT_LARGE)
        assert env.shares_shorted > 0

        env.step(Actions.COVER_ALL)
        assert env.shares_shorted == 0
        assert env.short_collateral == 0

    def test_all_short_actions_exist(self):
        short_actions = [Actions.SHORT_SMALL, Actions.SHORT_MEDIUM, Actions.SHORT_LARGE,
                         Actions.COVER_SMALL, Actions.COVER_MEDIUM, Actions.COVER_ALL]
        assert len(short_actions) == 6


class TestSlippage:
    """Test slippage calculations."""

    def test_slippage_always_non_negative(self):
        for model in ["none", "fixed", "proportional", "volume"]:
            cfg = AgentConfig(name="test", slippage_model=model, slippage_bps=5.0)
            env = TradingEnvironment(df=make_df(), config=cfg)
            env.reset()
            slippage = env._calculate_slippage(50000, is_buy=True)
            assert slippage >= 0, f"Negative slippage for model '{model}': {slippage}"

    def test_slippage_proportional_to_trade_value(self):
        cfg = AgentConfig(name="test", slippage_model="proportional", slippage_bps=5.0)
        env = TradingEnvironment(df=make_df(), config=cfg)
        env.reset()
        small = env._calculate_slippage(10000, is_buy=True)
        large = env._calculate_slippage(100000, is_buy=True)
        assert large > small


class TestMetrics:
    """Test performance metric calculations."""

    def test_metrics_present_after_episode(self):
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        env.reset()
        for _ in range(50):
            env.step(Actions.HOLD)
        metrics = env._calculate_metrics(env.cash)
        assert "sharpe_ratio" in metrics
        assert "sortino_ratio" in metrics
        assert "calmar_ratio" in metrics
        assert "profit_factor" in metrics
        assert "alpha_pct" in metrics
        assert "benchmark_return_pct" in metrics

    def test_benchmark_tracking(self):
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        env.reset()
        assert env._benchmark_start_price > 0
        for _ in range(10):
            env.step(Actions.HOLD)
        metrics = env._calculate_metrics(env.cash)
        assert isinstance(metrics["benchmark_return_pct"], float)


class TestRewardWeights:
    """Test configurable reward weights."""

    def test_custom_weights_merged(self):
        custom = {"portfolio_return_scale": 200.0, "sharpe_scale": 10.0}
        cfg = AgentConfig(name="test")
        env = TradingEnvironment(df=make_df(), config=cfg, reward_weights=custom)
        env.reset()
        assert env.reward_weights["portfolio_return_scale"] == 200.0
        assert env.reward_weights["sharpe_scale"] == 10.0
        assert env.reward_weights["churning_penalty"] == DEFAULT_REWARD_WEIGHTS["churning_penalty"]

    def test_default_weights_used_when_none_provided(self):
        env = TradingEnvironment(df=make_df(), config=AgentConfig(name="test"))
        env.reset()
        for key in DEFAULT_REWARD_WEIGHTS:
            assert key in env.reward_weights


class TestEpisodeCompletion:
    """Test that episodes terminate correctly."""

    def test_episode_completes(self):
        env = TradingEnvironment(df=make_df(n=120), config=AgentConfig(name="test"))
        env.reset()
        done = False
        steps = 0
        while not done:
            _, _, terminated, truncated, _ = env.step(Actions.HOLD)
            done = terminated or truncated
            steps += 1
            if steps > 200:
                break
        assert done

    def test_reset_after_episode(self):
        env = TradingEnvironment(df=make_df(n=120), config=AgentConfig(name="test"))
        env.reset()
        done = False
        while not done:
            _, _, terminated, truncated, _ = env.step(Actions.HOLD)
            done = terminated or truncated
        obs, info = env.reset()
        assert obs.shape[0] > 0
        assert env.shares_held == 0
