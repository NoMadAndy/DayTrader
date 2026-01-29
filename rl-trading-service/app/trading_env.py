"""
Trading Environment for Reinforcement Learning

Implements a Gymnasium-compatible environment that simulates
stock trading with realistic constraints:
- Transaction costs (broker fees)
- Position sizing
- Risk management (stop loss, take profit)
- Multiple technical indicators as observations
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
    """Discrete action space for the trading agent"""
    HOLD = 0       # Do nothing
    BUY_SMALL = 1  # Buy 10% of available capital
    BUY_MEDIUM = 2  # Buy 25% of available capital
    BUY_LARGE = 3  # Buy 50% of available capital
    SELL_SMALL = 4  # Sell 25% of position
    SELL_MEDIUM = 5  # Sell 50% of position
    SELL_ALL = 6    # Close entire position


# Broker fee configurations (matching backend BROKER_PROFILES)
BROKER_FEES = {
    "discount": {
        "flat_fee": 1.00,
        "percentage_fee": 0.0,
        "spread_percent": 0.10,
    },
    "standard": {
        "flat_fee": 4.95,
        "percentage_fee": 0.25,
        "spread_percent": 0.15,
    },
    "premium": {
        "flat_fee": 9.90,
        "percentage_fee": 0.0,
        "spread_percent": 0.05,
    },
    "marketMaker": {
        "flat_fee": 0.0,
        "percentage_fee": 0.0,
        "spread_percent": 0.30,
    },
}


class TradingEnvironment(gym.Env):
    """
    A Gymnasium environment for stock trading simulation.
    
    Observation Space:
    - Historical price data (OHLCV)
    - Technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, etc.)
    - Portfolio state (cash, position, unrealized P&L)
    - Market conditions (volatility, trend strength)
    
    Action Space:
    - Discrete: HOLD, BUY (small/medium/large), SELL (small/medium/all)
    
    Reward:
    - Realized profit/loss on closed positions
    - Penalty for holding periods outside target
    - Risk-adjusted returns (Sharpe-like)
    """
    
    metadata = {"render_modes": ["human", "ansi"]}
    
    # Number of portfolio state features included in observations
    # [cash_ratio, position_ratio, unrealized_pnl_ratio, holding_time_ratio, current_drawdown]
    N_PORTFOLIO_FEATURES = 5
    
    def __init__(
        self,
        df: pd.DataFrame,
        config: AgentConfig,
        render_mode: Optional[str] = None,
        inference_mode: bool = False,
    ):
        """
        Initialize the trading environment.
        
        Args:
            df: DataFrame with OHLCV data and technical indicators
            config: Agent configuration
            render_mode: How to render the environment
            inference_mode: If True, start at end of data for signal inference (no random start)
        """
        super().__init__()
        
        self.df = df.copy()
        self.config = config
        self.render_mode = render_mode
        self.inference_mode = inference_mode
        
        # Validate DataFrame columns
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
        self.spread_pct = broker["spread_percent"] / 100
        
        # Holding period targets (in steps)
        self.target_holding_period = self._get_holding_period_steps()
        
        # Risk profile multipliers
        self.risk_multiplier = self._get_risk_multiplier()
        
        # Window size for observation
        self.window_size = 60  # Look back 60 periods
        
        # Feature columns (technical indicators)
        self.feature_columns = self._get_feature_columns()
        self.n_features = len(self.feature_columns)
        
        # Define action and observation spaces
        self.action_space = spaces.Discrete(len(Actions))
        
        # Observation: window of features + portfolio state
        # Portfolio state: [cash_ratio, position_ratio, unrealized_pnl_ratio, 
        #                   holding_time_ratio, current_drawdown]
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(self.window_size * self.n_features + self.N_PORTFOLIO_FEATURES,),
            dtype=np.float32
        )
        
        # Trading state (reset on each episode)
        self.reset()
        
    def _validate_dataframe(self):
        """Ensure required columns exist"""
        required = ['open', 'high', 'low', 'close', 'volume']
        for col in required:
            if col not in self.df.columns:
                raise ValueError(f"DataFrame missing required column: {col}")
        
        # Ensure we have enough data
        if len(self.df) < 100:
            raise ValueError("DataFrame must have at least 100 rows")
    
    def _get_feature_columns(self) -> List[str]:
        """Get list of feature columns from DataFrame"""
        # Base features
        features = ['open', 'high', 'low', 'close', 'volume']
        
        # Technical indicators (if present)
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
        """Convert holding period to number of steps"""
        period_map = {
            "scalping": 4,        # ~4 hours (if intraday data)
            "intraday": 8,        # ~1 day
            "swing_short": 3,     # 1-3 days
            "swing_medium": 5,    # 3-7 days
            "position_short": 10, # 1-2 weeks
            "position_medium": 20, # 2-4 weeks
            "position_long": 60,  # 1-3 months
            "investor": 120,      # 3+ months
        }
        return period_map.get(self.config.holding_period, 5)
    
    def _get_risk_multiplier(self) -> float:
        """Get risk multiplier based on risk profile"""
        risk_map = {
            "conservative": 0.5,
            "moderate": 1.0,
            "aggressive": 1.5,
            "very_aggressive": 2.0,
        }
        return risk_map.get(self.config.risk_profile, 1.0)
    
    def reset(
        self,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Reset the environment for a new episode"""
        super().reset(seed=seed)
        
        # Determine start position
        min_start = self.window_size
        max_start = len(self.df) - self.window_size - 100  # Leave room for at least 100 steps
        
        # Inference mode: always start at the end of data for current signal
        if self.inference_mode:
            # Start at the last valid position to get signal for current market state
            self.current_step = len(self.df) - 1
        else:
            # Check if random start should be used (default: True for training)
            use_random_start = True
            if options is not None and 'random_start' in options:
                use_random_start = options.get('random_start', True)
            
            if use_random_start and max_start > min_start:
                # Random start position for varied training/evaluation
                # np.random.seed is set externally in trainer for reproducibility
                self.current_step = np.random.randint(min_start, max_start)
            else:
                # Fixed start (for reproducibility when needed)
                self.current_step = min_start
        
        # Portfolio state
        self.cash = self.initial_balance
        self.shares_held = 0
        self.entry_price = 0.0
        self.highest_price_since_entry = 0.0
        self.holding_time = 0
        self.total_trades = 0
        self.winning_trades = 0
        self.total_profit = 0.0
        self.max_drawdown = 0.0
        self.peak_value = self.initial_balance
        
        # Trade history for this episode
        self.trade_history = []
        
        return self._get_observation(), self._get_info()
    
    def _get_observation(self) -> np.ndarray:
        """Construct the observation vector"""
        # Get window of features
        start_idx = self.current_step - self.window_size
        end_idx = self.current_step
        
        window_data = self.df.iloc[start_idx:end_idx][self.feature_columns].values
        
        # Normalize each feature column
        normalized = np.zeros_like(window_data)
        for i in range(window_data.shape[1]):
            col = window_data[:, i]
            col_min, col_max = col.min(), col.max()
            if col_max - col_min > 1e-8:
                normalized[:, i] = (col - col_min) / (col_max - col_min)
            else:
                normalized[:, i] = 0.5
        
        # Flatten window features
        flat_features = normalized.flatten().astype(np.float32)
        
        # Portfolio state features
        current_price = self.df.iloc[self.current_step]['close']
        portfolio_value = self.cash + self.shares_held * current_price
        
        cash_ratio = self.cash / self.initial_balance
        position_ratio = (self.shares_held * current_price) / portfolio_value if portfolio_value > 0 else 0
        
        unrealized_pnl = 0.0
        if self.shares_held > 0:
            unrealized_pnl = (current_price - self.entry_price) / self.entry_price
        
        holding_ratio = min(self.holding_time / self.target_holding_period, 2.0) if self.shares_held > 0 else 0
        
        current_drawdown = (self.peak_value - portfolio_value) / self.peak_value if self.peak_value > 0 else 0
        
        portfolio_features = np.array([
            cash_ratio,
            position_ratio,
            unrealized_pnl,
            holding_ratio,
            current_drawdown
        ], dtype=np.float32)
        
        return np.concatenate([flat_features, portfolio_features])
    
    def _get_info(self) -> Dict[str, Any]:
        """Get info dict for current state"""
        current_price = self.df.iloc[self.current_step]['close']
        portfolio_value = self.cash + self.shares_held * current_price
        
        return {
            "step": self.current_step,
            "cash": self.cash,
            "shares_held": self.shares_held,
            "portfolio_value": portfolio_value,
            "total_trades": self.total_trades,
            "winning_trades": self.winning_trades,
            "win_rate": self.winning_trades / max(self.total_trades, 1),
            "total_profit": self.total_profit,
            "max_drawdown": self.max_drawdown,
            "return_pct": (portfolio_value - self.initial_balance) / self.initial_balance * 100,
        }
    
    def _calculate_transaction_cost(self, trade_value: float) -> float:
        """Calculate total transaction cost including spread"""
        commission = max(self.flat_fee, trade_value * self.percentage_fee)
        spread_cost = trade_value * self.spread_pct
        return commission + spread_cost
    
    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        """
        Execute one step in the environment.
        
        Returns:
            observation, reward, terminated, truncated, info
        """
        current_price = self.df.iloc[self.current_step]['close']
        previous_portfolio_value = self.cash + self.shares_held * current_price
        
        reward = 0.0
        trade_made = False
        
        # Execute action
        if action == Actions.HOLD:
            pass  # Do nothing
            
        elif action in [Actions.BUY_SMALL, Actions.BUY_MEDIUM, Actions.BUY_LARGE]:
            # Determine buy fraction
            buy_fractions = {
                Actions.BUY_SMALL: 0.10,
                Actions.BUY_MEDIUM: 0.25,
                Actions.BUY_LARGE: 0.50,
            }
            buy_fraction = buy_fractions[action] * self.risk_multiplier
            buy_fraction = min(buy_fraction, self.max_position_size)
            
            # Calculate buy amount
            buy_amount = self.cash * buy_fraction
            if buy_amount > 100:  # Minimum trade size
                shares_to_buy = int(buy_amount / current_price)
                if shares_to_buy > 0:
                    cost = shares_to_buy * current_price
                    transaction_cost = self._calculate_transaction_cost(cost)
                    total_cost = cost + transaction_cost
                    
                    if total_cost <= self.cash:
                        self.cash -= total_cost
                        
                        # Update average entry price
                        if self.shares_held == 0:
                            self.entry_price = current_price
                            self.highest_price_since_entry = current_price
                        else:
                            total_shares = self.shares_held + shares_to_buy
                            self.entry_price = (
                                self.entry_price * self.shares_held + 
                                current_price * shares_to_buy
                            ) / total_shares
                        
                        self.shares_held += shares_to_buy
                        self.holding_time = 0
                        trade_made = True
                        
        elif action in [Actions.SELL_SMALL, Actions.SELL_MEDIUM, Actions.SELL_ALL]:
            if self.shares_held > 0:
                # Determine sell fraction
                sell_fractions = {
                    Actions.SELL_SMALL: 0.25,
                    Actions.SELL_MEDIUM: 0.50,
                    Actions.SELL_ALL: 1.0,
                }
                sell_fraction = sell_fractions[action]
                
                shares_to_sell = int(self.shares_held * sell_fraction)
                if sell_fraction == 1.0:
                    shares_to_sell = self.shares_held  # Ensure complete sell
                
                if shares_to_sell > 0:
                    revenue = shares_to_sell * current_price
                    transaction_cost = self._calculate_transaction_cost(revenue)
                    net_revenue = revenue - transaction_cost
                    
                    # Calculate profit for this trade
                    trade_profit = net_revenue - (shares_to_sell * self.entry_price)
                    self.total_profit += trade_profit
                    
                    if trade_profit > 0:
                        self.winning_trades += 1
                    
                    self.total_trades += 1
                    self.cash += net_revenue
                    self.shares_held -= shares_to_sell
                    trade_made = True
                    
                    # Record trade
                    self.trade_history.append({
                        "step": self.current_step,
                        "action": "sell",
                        "shares": shares_to_sell,
                        "price": current_price,
                        "profit": trade_profit,
                        "holding_time": self.holding_time,
                    })
                    
                    if self.shares_held == 0:
                        self.holding_time = 0
                        self.entry_price = 0.0
        
        # Update holding time
        if self.shares_held > 0:
            self.holding_time += 1
            self.highest_price_since_entry = max(
                self.highest_price_since_entry, current_price
            )
        
        # Check stop loss and take profit
        if self.shares_held > 0:
            unrealized_return = (current_price - self.entry_price) / self.entry_price
            
            # Trailing stop check
            if self.trailing_stop:
                trailing_return = (current_price - self.highest_price_since_entry) / self.highest_price_since_entry
                if trailing_return < -self.trailing_distance:
                    # Force close position
                    revenue = self.shares_held * current_price
                    transaction_cost = self._calculate_transaction_cost(revenue)
                    trade_profit = revenue - transaction_cost - (self.shares_held * self.entry_price)
                    self.cash += revenue - transaction_cost
                    self.total_profit += trade_profit
                    if trade_profit > 0:
                        self.winning_trades += 1
                    self.total_trades += 1
                    self.shares_held = 0
                    self.holding_time = 0
                    reward -= 0.5  # Small penalty for being stopped out
            
            # Regular stop loss
            elif unrealized_return <= -self.stop_loss_pct:
                revenue = self.shares_held * current_price
                transaction_cost = self._calculate_transaction_cost(revenue)
                trade_profit = revenue - transaction_cost - (self.shares_held * self.entry_price)
                self.cash += revenue - transaction_cost
                self.total_profit += trade_profit
                if trade_profit > 0:
                    self.winning_trades += 1
                self.total_trades += 1
                self.shares_held = 0
                self.holding_time = 0
                reward -= 1.0  # Penalty for stop loss
            
            # Take profit
            elif unrealized_return >= self.take_profit_pct:
                revenue = self.shares_held * current_price
                transaction_cost = self._calculate_transaction_cost(revenue)
                trade_profit = revenue - transaction_cost - (self.shares_held * self.entry_price)
                self.cash += revenue - transaction_cost
                self.total_profit += trade_profit
                self.winning_trades += 1
                self.total_trades += 1
                self.shares_held = 0
                self.holding_time = 0
                reward += 2.0  # Bonus for hitting take profit
        
        # Move to next step
        self.current_step += 1
        
        # Calculate portfolio value
        new_price = self.df.iloc[min(self.current_step, len(self.df) - 1)]['close']
        portfolio_value = self.cash + self.shares_held * new_price
        
        # Update peak and drawdown
        if portfolio_value > self.peak_value:
            self.peak_value = portfolio_value
        current_drawdown = (self.peak_value - portfolio_value) / self.peak_value
        self.max_drawdown = max(self.max_drawdown, current_drawdown)
        
        # Calculate reward
        # 1. Portfolio return component
        returns = (portfolio_value - previous_portfolio_value) / previous_portfolio_value
        reward += returns * 100 * self.risk_multiplier
        
        # 2. Holding period alignment bonus/penalty
        if self.shares_held > 0 and self.holding_time > 0:
            holding_ratio = self.holding_time / self.target_holding_period
            if 0.5 <= holding_ratio <= 2.0:
                reward += 0.1  # In target range
            elif holding_ratio > 3.0:
                reward -= 0.2  # Holding too long
        
        # 3. Drawdown penalty
        if current_drawdown > 0.1:
            reward -= current_drawdown * 2
        
        # Check if episode is done
        terminated = self.current_step >= len(self.df) - 1
        truncated = False
        
        # Final reward adjustment at end of episode
        if terminated:
            # Close any remaining position
            if self.shares_held > 0:
                final_price = self.df.iloc[-1]['close']
                revenue = self.shares_held * final_price
                transaction_cost = self._calculate_transaction_cost(revenue)
                trade_profit = revenue - transaction_cost - (self.shares_held * self.entry_price)
                self.cash += revenue - transaction_cost
                self.total_profit += trade_profit
                if trade_profit > 0:
                    self.winning_trades += 1
                self.total_trades += 1
                self.shares_held = 0
            
            # Final portfolio value
            final_value = self.cash
            total_return = (final_value - self.initial_balance) / self.initial_balance
            
            # Reward based on total return
            reward += total_return * 50
            
            # Sharpe-like risk adjustment
            if self.max_drawdown > 0:
                risk_adjusted = total_return / (self.max_drawdown + 0.01)
                reward += risk_adjusted * 10
            
            # Win rate bonus
            if self.total_trades > 0:
                win_rate = self.winning_trades / self.total_trades
                if win_rate > 0.5:
                    reward += (win_rate - 0.5) * 20
        
        return self._get_observation(), reward, terminated, truncated, self._get_info()
    
    def render(self):
        """Render the environment"""
        if self.render_mode == "human":
            info = self._get_info()
            print(f"Step {info['step']}: Portfolio ${info['portfolio_value']:.2f}, "
                  f"Return: {info['return_pct']:.2f}%, "
                  f"Trades: {info['total_trades']}, Win Rate: {info['win_rate']:.2%}")
    
    def close(self):
        """Clean up resources"""
        pass
