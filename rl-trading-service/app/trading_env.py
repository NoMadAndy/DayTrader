"""
Trading Environment for Reinforcement Learning (v2)

Implements a Gymnasium-compatible environment that simulates
stock trading with realistic constraints:
- Transaction costs (broker fees) with configurable slippage
- Position sizing (long AND short positions)
- Risk management (stop loss, take profit, trailing stop)
- Multiple technical indicators as observations
- Extended metrics tracking (Sharpe, Sortino, Calmar, Profit Factor)
- Configurable reward function (risk-adjusted returns)
"""

import gymnasium as gym
from gymnasium import spaces
import numpy as np
import pandas as pd
from typing import Optional, Tuple, Dict, Any, List
from enum import IntEnum
import logging

from .agent_config import AgentConfig, HoldingPeriod, RiskProfile, BrokerProfile

logger = logging.getLogger(__name__)


class Actions(IntEnum):
    """Discrete action space for the trading agent (long + short)"""
    HOLD = 0           # Do nothing
    BUY_SMALL = 1      # Buy 10% of available capital
    BUY_MEDIUM = 2     # Buy 25% of available capital
    BUY_LARGE = 3      # Buy 50% of available capital
    SELL_SMALL = 4      # Sell 25% of position
    SELL_MEDIUM = 5     # Sell 50% of position
    SELL_ALL = 6        # Close entire position
    # Short selling actions (optional, controlled by config)
    SHORT_SMALL = 7     # Short sell 10% of capital
    SHORT_MEDIUM = 8    # Short sell 25% of capital
    SHORT_LARGE = 9     # Short sell 50% of capital
    COVER_SMALL = 10    # Cover 25% of short position
    COVER_MEDIUM = 11   # Cover 50% of short position
    COVER_ALL = 12      # Cover entire short position


# Broker fee configurations (matching backend BROKER_PROFILES)
BROKER_FEES = {
    "discount": {
        "flat_fee": 1.00,
        "percentage_fee": 0.0,
        "min_fee": 1.00,
        "max_fee": 1.00,
        "exchange_fee": 0.0,
        "spread_percent": 0.10,
    },
    "standard": {
        "flat_fee": 4.95,
        "percentage_fee": 0.25,
        "min_fee": 4.95,
        "max_fee": 59.00,
        "exchange_fee": 0.0,
        "spread_percent": 0.15,
    },
    "premium": {
        "flat_fee": 9.90,
        "percentage_fee": 0.0,
        "min_fee": 9.90,
        "max_fee": 9.90,
        "exchange_fee": 0.0,
        "spread_percent": 0.05,
    },
    "marketMaker": {
        "flat_fee": 0.0,
        "percentage_fee": 0.0,
        "min_fee": 0.0,
        "max_fee": 0.0,
        "exchange_fee": 0.0,
        "spread_percent": 0.30,
    },
    "flatex": {
        "flat_fee": 8.50,
        "percentage_fee": 0.0,
        "min_fee": 8.50,
        "max_fee": 8.50,
        "exchange_fee": 0.0,
        "spread_percent": 0.05,
    },
    "ingdiba": {
        "flat_fee": 5.30,
        "percentage_fee": 0.25,
        "min_fee": 10.70,
        "max_fee": 75.50,
        "exchange_fee": 2.05,
        "spread_percent": 0.05,
    },
}


# Default reward weights (can be overridden via RewardConfig)
DEFAULT_REWARD_WEIGHTS = {
    "portfolio_return_scale": 100.0,
    "holding_in_range_bonus": 0.1,
    "holding_too_long_penalty": 0.2,
    "drawdown_penalty_threshold": 0.10,
    "drawdown_penalty_scale": 2.0,
    "stop_loss_penalty": 1.0,
    "take_profit_bonus": 2.0,
    "trailing_stop_penalty": 0.5,
    "episode_return_scale": 50.0,
    "fee_ratio_penalty_threshold": 0.5,
    "fee_ratio_penalty_scale": 10.0,
    "churning_penalty": 2.0,
    "risk_adjusted_scale": 10.0,
    "win_rate_bonus_scale": 20.0,
    # Sharpe-based reward (replaces simple portfolio return when enabled)
    "use_sharpe_reward": True,
    "sharpe_scale": 5.0,
    "sortino_scale": 3.0,
}


class TradingEnvironment(gym.Env):
    """
    A Gymnasium environment for stock trading simulation (v2).

    Improvements over v1:
    - Short selling support (configurable)
    - Slippage modeling (volume-dependent market impact)
    - Extended metrics (Sharpe, Sortino, Calmar, Profit Factor)
    - Configurable reward weights
    - Risk-adjusted reward function (Sharpe/Sortino-based)

    Observation Space:
    - Historical price data (OHLCV)
    - Technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, etc.)
    - Portfolio state (cash, long position, short position, unrealized P&L, drawdown, short flag)

    Action Space:
    - Without shorts: 7 actions (HOLD, BUY x3, SELL x3)
    - With shorts: 13 actions (+ SHORT x3, COVER x3)

    Reward:
    - Risk-adjusted returns (Sharpe/Sortino-based)
    - Holding period alignment
    - Drawdown penalty
    - Fee-impact awareness
    """

    metadata = {"render_modes": ["human", "ansi"]}

    # Number of portfolio state features included in observations
    # v2: [cash_ratio, long_position_ratio, short_position_ratio,
    #      unrealized_pnl_ratio, holding_time_ratio, current_drawdown, is_short]
    N_PORTFOLIO_FEATURES = 7

    def __init__(
        self,
        df: pd.DataFrame,
        config: AgentConfig,
        render_mode: Optional[str] = None,
        inference_mode: bool = False,
        reward_weights: Optional[Dict[str, float]] = None,
        enable_short_selling: Optional[bool] = None,
        slippage_model: Optional[str] = None,
        slippage_bps: Optional[float] = None,
    ):
        super().__init__()

        self.df = df.copy()
        self.config = config
        self.render_mode = render_mode
        self.inference_mode = inference_mode
        # Use explicit params if provided, otherwise fall back to config values
        self.enable_short_selling = enable_short_selling if enable_short_selling is not None else getattr(config, 'enable_short_selling', False)
        self.slippage_model = slippage_model if slippage_model is not None else getattr(config, 'slippage_model', 'proportional')
        self.slippage_bps = slippage_bps if slippage_bps is not None else getattr(config, 'slippage_bps', 5.0)

        # Reward weights (merge defaults with overrides)
        self.reward_weights = {**DEFAULT_REWARD_WEIGHTS}
        if reward_weights:
            self.reward_weights.update(reward_weights)

        self._validate_dataframe()

        # Environment parameters
        self.initial_balance = config.initial_balance
        self.max_position_size = config.max_position_size
        self.stop_loss_pct = config.stop_loss_percent or 0.05
        self.take_profit_pct = config.take_profit_percent or 0.10
        self.trailing_stop = config.trailing_stop
        self.trailing_distance = config.trailing_stop_distance

        # Broker fees
        broker = BROKER_FEES.get(config.broker_profile, BROKER_FEES["standard"])
        self.flat_fee = broker["flat_fee"]
        self.percentage_fee = broker["percentage_fee"] / 100
        self.min_fee = broker.get("min_fee", broker["flat_fee"])
        self.max_fee = broker.get("max_fee", 100.0)
        self.exchange_fee = broker.get("exchange_fee", 0.0)
        self.spread_pct = broker["spread_percent"] / 100

        self.target_holding_period = self._get_holding_period_steps()
        self.risk_multiplier = self._get_risk_multiplier()

        # Window size for observation (configurable)
        self.window_size = getattr(config, 'lookback_window', None) or 60

        self.feature_columns = self._get_feature_columns()
        self.n_features = len(self.feature_columns)

        # Action space (with or without short selling)
        if self.enable_short_selling:
            self.action_space = spaces.Discrete(13)
        else:
            self.action_space = spaces.Discrete(7)

        # Observation: window of features + portfolio state
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(self.window_size * self.n_features + self.N_PORTFOLIO_FEATURES,),
            dtype=np.float32
        )

        self.reset()

    def _validate_dataframe(self):
        required = ['open', 'high', 'low', 'close', 'volume']
        for col in required:
            if col not in self.df.columns:
                raise ValueError(f"DataFrame missing required column: {col}")
        if len(self.df) < 100:
            raise ValueError("DataFrame must have at least 100 rows")

    def _get_feature_columns(self) -> List[str]:
        features = ['open', 'high', 'low', 'close', 'volume']
        indicator_cols = [
            'returns', 'log_returns',
            'sma_20', 'sma_50', 'sma_200',
            'ema_12', 'ema_26',
            'rsi', 'rsi_signal',
            'macd', 'macd_signal', 'macd_hist',
            'bb_upper', 'bb_middle', 'bb_lower', 'bb_width', 'bb_pct',
            'atr', 'atr_pct',
            'obv', 'obv_ema',
            'adx', 'plus_di', 'minus_di',
            'stoch_k', 'stoch_d',
            'cci',
            'mfi',
            'volatility',
            'trend_strength',
        ]
        for col in indicator_cols:
            if col in self.df.columns:
                features.append(col)
        return features

    def _get_holding_period_steps(self) -> int:
        period_map = {
            "scalping": 4, "intraday": 8, "swing_short": 3,
            "swing_medium": 5, "position_short": 10, "position_medium": 20,
            "position_long": 60, "investor": 120,
        }
        return period_map.get(self.config.holding_period, 5)

    def _get_risk_multiplier(self) -> float:
        risk_map = {
            "conservative": 0.5, "moderate": 1.0,
            "aggressive": 1.5, "very_aggressive": 2.0,
        }
        return risk_map.get(self.config.risk_profile, 1.0)

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)

        min_start = self.window_size
        max_start = len(self.df) - self.window_size - 100

        if self.inference_mode:
            self.current_step = len(self.df) - 1
        else:
            use_random_start = True
            if options is not None and 'random_start' in options:
                use_random_start = options.get('random_start', True)
            if use_random_start and max_start > min_start:
                self.current_step = np.random.randint(min_start, max_start)
            else:
                self.current_step = min_start

        # Long positions
        self.cash = self.initial_balance
        self.shares_held = 0
        self.entry_price = 0.0
        self.highest_price_since_entry = 0.0
        self.holding_time = 0

        # Short positions
        self.shares_shorted = 0
        self.short_entry_price = 0.0
        self.lowest_price_since_short = 0.0
        self.short_holding_time = 0
        self.short_collateral = 0.0

        # Trade tracking
        self.total_trades = 0
        self.winning_trades = 0
        self.losing_trades = 0
        self.total_profit = 0.0
        self.total_fees_paid = 0.0
        self.max_drawdown = 0.0
        self.peak_value = self.initial_balance

        # Extended metrics
        self._daily_returns: List[float] = []
        self._portfolio_values: List[float] = [self.initial_balance]
        self._trade_profits: List[float] = []

        self.trade_history = []

        # Benchmark
        self._benchmark_start_price = self.df.iloc[self.current_step]['close']
        self._start_step = self.current_step

        return self._get_observation(), self._get_info()

    # ========== Slippage ==========

    def _calculate_slippage(self, trade_value: float, is_buy: bool) -> float:
        if self.slippage_model == "none":
            return 0.0
        if self.slippage_model == "fixed":
            return trade_value * (self.slippage_bps / 10000)
        if self.slippage_model == "proportional":
            base = self.slippage_bps / 10000
            jitter = 1.0 + (np.random.random() - 0.5) * 0.6
            return trade_value * base * jitter
        if self.slippage_model == "volume":
            vol = self.df.iloc[self.current_step]['volume']
            price = self.df.iloc[self.current_step]['close']
            if vol > 0 and price > 0:
                shares = trade_value / price
                vfrac = shares / vol
                impact = self.slippage_bps * (1 + 10 * np.sqrt(vfrac))
            else:
                impact = self.slippage_bps * 2
            return trade_value * (impact / 10000)
        return 0.0

    def _calculate_execution_price(self, base_price: float, trade_value: float, is_buy: bool) -> float:
        slip_cost = self._calculate_slippage(trade_value, is_buy)
        slip_per_share = slip_cost / max(trade_value / base_price, 1)
        return base_price + slip_per_share if is_buy else base_price - slip_per_share

    # ========== Observations & Info ==========

    def _get_observation(self) -> np.ndarray:
        start_idx = self.current_step - self.window_size
        end_idx = self.current_step
        window_data = self.df.iloc[start_idx:end_idx][self.feature_columns].values

        normalized = np.zeros_like(window_data)
        for i in range(window_data.shape[1]):
            col = window_data[:, i]
            cmin, cmax = col.min(), col.max()
            if cmax - cmin > 1e-8:
                normalized[:, i] = (col - cmin) / (cmax - cmin)
            else:
                normalized[:, i] = 0.5

        flat_features = normalized.flatten().astype(np.float32)

        current_price = self.df.iloc[self.current_step]['close']
        pv = self._get_portfolio_value(current_price)

        cash_ratio = self.cash / self.initial_balance
        long_ratio = (self.shares_held * current_price) / pv if pv > 0 else 0
        short_ratio = (self.shares_shorted * current_price) / pv if pv > 0 else 0

        unrealized_pnl = 0.0
        if self.shares_held > 0:
            unrealized_pnl += (current_price - self.entry_price) / self.entry_price
        if self.shares_shorted > 0:
            unrealized_pnl += (self.short_entry_price - current_price) / self.short_entry_price

        ht = max(self.holding_time, self.short_holding_time)
        holding_ratio = min(ht / self.target_holding_period, 2.0) if (self.shares_held > 0 or self.shares_shorted > 0) else 0
        dd = (self.peak_value - pv) / self.peak_value if self.peak_value > 0 else 0
        is_short = 1.0 if self.shares_shorted > 0 else 0.0

        portfolio_features = np.array([
            cash_ratio, long_ratio, short_ratio,
            unrealized_pnl, holding_ratio, dd, is_short
        ], dtype=np.float32)

        return np.concatenate([flat_features, portfolio_features])

    def _get_portfolio_value(self, current_price: float) -> float:
        long_val = self.shares_held * current_price
        short_pnl = 0.0
        if self.shares_shorted > 0:
            short_pnl = (self.short_entry_price - current_price) * self.shares_shorted
        return self.cash + long_val + self.short_collateral + short_pnl

    def _get_info(self) -> Dict[str, Any]:
        current_price = self.df.iloc[self.current_step]['close']
        pv = self._get_portfolio_value(current_price)
        metrics = self._calculate_metrics(pv)
        return {
            "step": self.current_step,
            "cash": self.cash,
            "shares_held": self.shares_held,
            "shares_shorted": self.shares_shorted,
            "portfolio_value": pv,
            "total_trades": self.total_trades,
            "winning_trades": self.winning_trades,
            "losing_trades": self.losing_trades,
            "win_rate": self.winning_trades / max(self.total_trades, 1),
            "total_profit": self.total_profit,
            "total_fees_paid": self.total_fees_paid,
            "fee_impact_pct": (self.total_fees_paid / self.initial_balance * 100) if self.initial_balance > 0 else 0,
            "max_drawdown": self.max_drawdown,
            "return_pct": (pv - self.initial_balance) / self.initial_balance * 100,
            **metrics,
        }

    # ========== Extended Metrics ==========

    def _calculate_metrics(self, portfolio_value: float) -> Dict[str, float]:
        m = {}
        if len(self._daily_returns) > 5:
            arr = np.array(self._daily_returns)
            mean_r = np.mean(arr)
            std_r = np.std(arr)
            m["sharpe_ratio"] = float((mean_r / std_r) * np.sqrt(252)) if std_r > 1e-8 else 0.0
            down = arr[arr < 0]
            if len(down) > 0:
                ds = np.std(down)
                m["sortino_ratio"] = float((mean_r / ds) * np.sqrt(252)) if ds > 1e-8 else m["sharpe_ratio"] * 1.5
            else:
                m["sortino_ratio"] = m["sharpe_ratio"] * 2.0
        else:
            m["sharpe_ratio"] = 0.0
            m["sortino_ratio"] = 0.0

        total_return = (portfolio_value - self.initial_balance) / self.initial_balance
        steps = len(self._daily_returns) if self._daily_returns else 1
        ann_ret = total_return * (252 / max(steps, 1))
        m["calmar_ratio"] = float(ann_ret / self.max_drawdown) if self.max_drawdown > 1e-8 else 0.0

        wins = sum(p for p in self._trade_profits if p > 0)
        losses = abs(sum(p for p in self._trade_profits if p < 0))
        if losses > 0:
            m["profit_factor"] = float(wins / losses)
        elif wins > 0:
            m["profit_factor"] = 999.0
        else:
            m["profit_factor"] = 0.0

        w = [p for p in self._trade_profits if p > 0]
        l = [p for p in self._trade_profits if p < 0]
        m["avg_win"] = float(np.mean(w)) if w else 0.0
        m["avg_loss"] = float(np.mean(l)) if l else 0.0

        cp = self.df.iloc[self.current_step]['close']
        m["benchmark_return_pct"] = float((cp - self._benchmark_start_price) / self._benchmark_start_price * 100) if self._benchmark_start_price > 0 else 0.0
        m["alpha_pct"] = float(total_return * 100 - m["benchmark_return_pct"])

        return m

    # ========== Transaction Costs ==========

    def _calculate_transaction_cost(self, trade_value: float) -> float:
        percentage_part = trade_value * self.percentage_fee
        commission = max(self.min_fee, min(self.max_fee, self.flat_fee + percentage_part))
        commission += self.exchange_fee
        spread_cost = trade_value * self.spread_pct
        total_cost = commission + spread_cost
        self.total_fees_paid += total_cost
        return total_cost

    def _record_trade(self, action_type, shares, price, profit, holding_time):
        self.trade_history.append({
            "step": self.current_step, "action": action_type,
            "shares": shares, "price": price,
            "profit": profit, "holding_time": holding_time,
        })
        self._trade_profits.append(profit)
        self.total_profit += profit
        self.total_trades += 1
        if profit > 0:
            self.winning_trades += 1
        elif profit < 0:
            self.losing_trades += 1

    # ========== Position Management ==========

    def _close_long_position(self, shares_to_sell, current_price):
        if shares_to_sell <= 0 or self.shares_held <= 0:
            return
        shares_to_sell = min(shares_to_sell, self.shares_held)
        tv = shares_to_sell * current_price
        ep = self._calculate_execution_price(current_price, tv, is_buy=False)
        rev = shares_to_sell * ep
        tc = self._calculate_transaction_cost(rev)
        profit = rev - tc - (shares_to_sell * self.entry_price)
        self._record_trade("sell", shares_to_sell, ep, profit, self.holding_time)
        self.cash += rev - tc
        self.shares_held -= shares_to_sell
        if self.shares_held == 0:
            self.holding_time = 0
            self.entry_price = 0.0

    def _close_short_position(self, shares_to_cover, current_price):
        if shares_to_cover <= 0 or self.shares_shorted <= 0:
            return
        shares_to_cover = min(shares_to_cover, self.shares_shorted)
        tv = shares_to_cover * current_price
        ep = self._calculate_execution_price(current_price, tv, is_buy=True)
        tc = self._calculate_transaction_cost(shares_to_cover * ep)
        profit = (self.short_entry_price - ep) * shares_to_cover - tc
        self._record_trade("cover", shares_to_cover, ep, profit, self.short_holding_time)
        if self.shares_shorted > 0:
            coll_ret = self.short_collateral * (shares_to_cover / self.shares_shorted)
        else:
            coll_ret = self.short_collateral
        self.cash += coll_ret + profit
        self.short_collateral -= coll_ret
        self.shares_shorted -= shares_to_cover
        if self.shares_shorted == 0:
            self.short_holding_time = 0
            self.short_entry_price = 0.0
            self.short_collateral = 0.0

    # ========== Main Step ==========

    def step(self, action: int):
        current_price = self.df.iloc[self.current_step]['close']
        prev_pv = self._get_portfolio_value(current_price)
        reward = 0.0
        rw = self.reward_weights

        # ---- Execute action ----
        if action == Actions.HOLD:
            pass

        elif action in (Actions.BUY_SMALL, Actions.BUY_MEDIUM, Actions.BUY_LARGE):
            fracs = {Actions.BUY_SMALL: 0.10, Actions.BUY_MEDIUM: 0.25, Actions.BUY_LARGE: 0.50}
            frac = min(fracs[action] * self.risk_multiplier, self.max_position_size)
            amt = self.cash * frac
            if amt > 100:
                ep = self._calculate_execution_price(current_price, amt, is_buy=True)
                stb = int(amt / ep)
                if stb > 0:
                    cost = stb * ep
                    tc = self._calculate_transaction_cost(cost)
                    if cost + tc <= self.cash:
                        self.cash -= cost + tc
                        if self.shares_held == 0:
                            self.entry_price = ep
                            self.highest_price_since_entry = current_price
                        else:
                            ts = self.shares_held + stb
                            self.entry_price = (self.entry_price * self.shares_held + ep * stb) / ts
                        self.shares_held += stb
                        self.holding_time = 0

        elif action in (Actions.SELL_SMALL, Actions.SELL_MEDIUM, Actions.SELL_ALL):
            if self.shares_held > 0:
                fracs = {Actions.SELL_SMALL: 0.25, Actions.SELL_MEDIUM: 0.50, Actions.SELL_ALL: 1.0}
                sf = fracs[action]
                sts = int(self.shares_held * sf)
                if sf == 1.0:
                    sts = self.shares_held
                self._close_long_position(sts, current_price)

        elif self.enable_short_selling and action in (Actions.SHORT_SMALL, Actions.SHORT_MEDIUM, Actions.SHORT_LARGE):
            fracs = {Actions.SHORT_SMALL: 0.10, Actions.SHORT_MEDIUM: 0.25, Actions.SHORT_LARGE: 0.50}
            frac = min(fracs[action] * self.risk_multiplier, self.max_position_size)
            amt = self.cash * frac
            if amt > 100:
                ep = self._calculate_execution_price(current_price, amt, is_buy=False)
                sts = int(amt / ep)
                if sts > 0:
                    coll = sts * ep
                    tc = self._calculate_transaction_cost(coll)
                    if coll + tc <= self.cash:
                        self.cash -= coll + tc
                        self.short_collateral += coll
                        if self.shares_shorted == 0:
                            self.short_entry_price = ep
                            self.lowest_price_since_short = current_price
                        else:
                            ts = self.shares_shorted + sts
                            self.short_entry_price = (self.short_entry_price * self.shares_shorted + ep * sts) / ts
                        self.shares_shorted += sts
                        self.short_holding_time = 0

        elif self.enable_short_selling and action in (Actions.COVER_SMALL, Actions.COVER_MEDIUM, Actions.COVER_ALL):
            if self.shares_shorted > 0:
                fracs = {Actions.COVER_SMALL: 0.25, Actions.COVER_MEDIUM: 0.50, Actions.COVER_ALL: 1.0}
                cf = fracs[action]
                stc = int(self.shares_shorted * cf)
                if cf == 1.0:
                    stc = self.shares_shorted
                self._close_short_position(stc, current_price)

        # Update holding / tracking
        if self.shares_held > 0:
            self.holding_time += 1
            self.highest_price_since_entry = max(self.highest_price_since_entry, current_price)
        if self.shares_shorted > 0:
            self.short_holding_time += 1
            self.lowest_price_since_short = min(self.lowest_price_since_short, current_price)

        # ---- SL/TP for LONG ----
        if self.shares_held > 0:
            ur = (current_price - self.entry_price) / self.entry_price
            if self.trailing_stop:
                tr = (current_price - self.highest_price_since_entry) / self.highest_price_since_entry
                if tr < -self.trailing_distance:
                    self._close_long_position(self.shares_held, current_price)
                    reward -= rw["trailing_stop_penalty"]
            elif ur <= -self.stop_loss_pct:
                self._close_long_position(self.shares_held, current_price)
                reward -= rw["stop_loss_penalty"]
            elif ur >= self.take_profit_pct:
                self._close_long_position(self.shares_held, current_price)
                reward += rw["take_profit_bonus"]

        # ---- SL/TP for SHORT ----
        if self.shares_shorted > 0:
            sr = (self.short_entry_price - current_price) / self.short_entry_price
            if sr <= -self.stop_loss_pct:
                self._close_short_position(self.shares_shorted, current_price)
                reward -= rw["stop_loss_penalty"]
            elif sr >= self.take_profit_pct:
                self._close_short_position(self.shares_shorted, current_price)
                reward += rw["take_profit_bonus"]

        # Next step
        self.current_step += 1
        new_price = self.df.iloc[min(self.current_step, len(self.df) - 1)]['close']
        pv = self._get_portfolio_value(new_price)

        dr = (pv - prev_pv) / prev_pv
        self._daily_returns.append(dr)
        self._portfolio_values.append(pv)

        if pv > self.peak_value:
            self.peak_value = pv
        dd = (self.peak_value - pv) / self.peak_value
        self.max_drawdown = max(self.max_drawdown, dd)

        reward += self._calculate_step_reward(dr, dd, pv)

        terminated = self.current_step >= len(self.df) - 1
        truncated = False

        if terminated:
            reward += self._calculate_episode_end_reward(pv, new_price)

        return self._get_observation(), reward, terminated, truncated, self._get_info()

    # ========== Reward Functions ==========

    def _calculate_step_reward(self, daily_return, current_drawdown, portfolio_value):
        rw = self.reward_weights
        reward = 0.0

        # Sharpe-based step reward
        if rw.get("use_sharpe_reward") and len(self._daily_returns) > 10:
            rs = np.std(self._daily_returns[-20:])
            if rs > 1e-8:
                reward += (daily_return / rs) * rw["sharpe_scale"]
            else:
                reward += daily_return * rw["portfolio_return_scale"] * self.risk_multiplier
        else:
            reward += daily_return * rw["portfolio_return_scale"] * self.risk_multiplier

        # Holding period
        ht = max(self.holding_time, self.short_holding_time)
        if ht > 0:
            hr = ht / self.target_holding_period
            if 0.5 <= hr <= 2.0:
                reward += rw["holding_in_range_bonus"]
            elif hr > 3.0:
                reward -= rw["holding_too_long_penalty"]

        # Drawdown penalty
        if current_drawdown > rw["drawdown_penalty_threshold"]:
            reward -= current_drawdown * rw["drawdown_penalty_scale"]

        return reward

    def _calculate_episode_end_reward(self, portfolio_value, final_price):
        rw = self.reward_weights
        reward = 0.0

        # Close remaining positions
        if self.shares_held > 0:
            self._close_long_position(self.shares_held, final_price)
        if self.shares_shorted > 0:
            self._close_short_position(self.shares_shorted, final_price)

        final_value = self.cash
        total_return = (final_value - self.initial_balance) / self.initial_balance

        # 1. Total return
        reward += total_return * rw["episode_return_scale"]

        # 2. Fee-impact penalty
        gp = self.total_profit + self.total_fees_paid
        if gp > 0:
            fr = self.total_fees_paid / gp
            if fr > rw["fee_ratio_penalty_threshold"]:
                reward -= (fr - rw["fee_ratio_penalty_threshold"]) * rw["fee_ratio_penalty_scale"]
        elif self.total_trades > 0:
            if (self.total_fees_paid / self.total_trades) > self.initial_balance * 0.001:
                reward -= rw["churning_penalty"]

        # 3. Risk-adjusted (Sharpe/Sortino)
        if len(self._daily_returns) > 10:
            arr = np.array(self._daily_returns)
            std_r = np.std(arr)
            if std_r > 1e-8:
                sharpe = (np.mean(arr) / std_r) * np.sqrt(252)
                reward += sharpe * rw["risk_adjusted_scale"]
                down = arr[arr < 0]
                if len(down) > 0:
                    ds = np.std(down)
                    if ds > 1e-8:
                        sortino = (np.mean(arr) / ds) * np.sqrt(252)
                        reward += max(0, sortino - sharpe) * rw["sortino_scale"]
            elif self.max_drawdown > 0:
                reward += (total_return / (self.max_drawdown + 0.01)) * rw["risk_adjusted_scale"]
        elif self.max_drawdown > 0:
            reward += (total_return / (self.max_drawdown + 0.01)) * rw["risk_adjusted_scale"]

        # 4. Win rate bonus
        if self.total_trades > 0:
            wr = self.winning_trades / self.total_trades
            if wr > 0.5:
                reward += (wr - 0.5) * rw["win_rate_bonus_scale"]

        # 5. Alpha bonus (vs B&H)
        if self._benchmark_start_price > 0:
            bm_ret = (final_price - self._benchmark_start_price) / self._benchmark_start_price
            alpha = total_return - bm_ret
            reward += alpha * 20 if alpha > 0 else alpha * 10

        return reward

    def render(self):
        if self.render_mode == "human":
            info = self._get_info()
            si = f", Short: {info['shares_shorted']}" if self.enable_short_selling else ""
            print(f"Step {info['step']}: Portfolio ${info['portfolio_value']:.2f}, "
                  f"Return: {info['return_pct']:.2f}%, "
                  f"Trades: {info['total_trades']}, Win Rate: {info['win_rate']:.2%}"
                  f"{si}, Sharpe: {info.get('sharpe_ratio', 0):.2f}")

    def close(self):
        pass
