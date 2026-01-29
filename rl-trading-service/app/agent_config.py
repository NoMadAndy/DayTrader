"""
Trading Agent Configuration & Profile Models

Defines the configuration schema for virtual trading agents,
including holding periods, risk profiles, and trading preferences.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from enum import Enum


class HoldingPeriod(str, Enum):
    """Typical holding periods for trading strategies"""
    SCALPING = "scalping"        # Minutes to hours
    INTRADAY = "intraday"        # Within single trading day
    SWING_SHORT = "swing_short"  # 1-3 days
    SWING_MEDIUM = "swing_medium"  # 3-7 days
    POSITION_SHORT = "position_short"  # 1-2 weeks
    POSITION_MEDIUM = "position_medium"  # 2-4 weeks
    POSITION_LONG = "position_long"  # 1-3 months
    INVESTOR = "investor"        # 3+ months


class RiskProfile(str, Enum):
    """Risk appetite levels"""
    CONSERVATIVE = "conservative"
    MODERATE = "moderate"
    AGGRESSIVE = "aggressive"
    VERY_AGGRESSIVE = "very_aggressive"


class TradingStyle(str, Enum):
    """Trading approach preferences"""
    TREND_FOLLOWING = "trend_following"
    MEAN_REVERSION = "mean_reversion"
    MOMENTUM = "momentum"
    BREAKOUT = "breakout"
    CONTRARIAN = "contrarian"
    MIXED = "mixed"


class BrokerProfile(str, Enum):
    """Broker fee profiles"""
    DISCOUNT = "discount"
    STANDARD = "standard"
    PREMIUM = "premium"
    MARKET_MAKER = "marketMaker"


class AgentConfig(BaseModel):
    """Configuration for a trading agent"""
    
    # Identity
    name: str = Field(..., description="Unique name for this agent profile")
    description: Optional[str] = Field(None, description="Human-readable description")
    
    # Trading parameters
    holding_period: HoldingPeriod = Field(
        default=HoldingPeriod.SWING_SHORT,
        description="Preferred holding period for positions"
    )
    risk_profile: RiskProfile = Field(
        default=RiskProfile.MODERATE,
        description="Risk appetite level"
    )
    trading_style: TradingStyle = Field(
        default=TradingStyle.MIXED,
        description="Trading strategy approach"
    )
    
    # Capital management
    initial_balance: float = Field(
        default=100000.0,
        ge=1000,
        description="Starting capital for backtesting"
    )
    max_position_size: float = Field(
        default=0.25,
        ge=0.01,
        le=1.0,
        description="Maximum position size as fraction of portfolio"
    )
    max_positions: int = Field(
        default=5,
        ge=1,
        le=50,
        description="Maximum number of concurrent positions"
    )
    
    # Risk management
    stop_loss_percent: Optional[float] = Field(
        default=0.05,
        ge=0.01,
        le=0.50,
        description="Default stop loss percentage (5% = 0.05)"
    )
    take_profit_percent: Optional[float] = Field(
        default=0.10,
        ge=0.01,
        le=1.0,
        description="Default take profit percentage"
    )
    trailing_stop: bool = Field(
        default=False,
        description="Use trailing stop loss"
    )
    trailing_stop_distance: float = Field(
        default=0.03,
        ge=0.01,
        le=0.20,
        description="Trailing stop distance as percentage"
    )
    
    # Broker settings
    broker_profile: BrokerProfile = Field(
        default=BrokerProfile.STANDARD,
        description="Fee structure to use"
    )
    
    # Market conditions preferences
    trade_on_high_volatility: bool = Field(
        default=True,
        description="Allow trading during high volatility"
    )
    min_volume_threshold: float = Field(
        default=0.0,
        ge=0.0,
        description="Minimum volume threshold for entry"
    )
    
    # Time preferences (for backtesting granularity)
    use_daily_data: bool = Field(
        default=True,
        description="Use daily candles (vs intraday)"
    )
    
    # Symbols to train on
    symbols: List[str] = Field(
        default=["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA"],
        description="Stock symbols to train on"
    )
    
    # RL Training parameters
    learning_rate: float = Field(
        default=0.0003,
        ge=0.000001,
        le=0.1,
        description="Learning rate for RL algorithm"
    )
    gamma: float = Field(
        default=0.99,
        ge=0.0,
        le=1.0,
        description="Discount factor for future rewards"
    )
    ent_coef: float = Field(
        default=0.01,
        ge=0.0,
        le=1.0,
        description="Entropy coefficient for exploration"
    )
    
    # Transformer Architecture Settings (Advanced)
    use_transformer_policy: bool = Field(
        default=False,
        description="Use advanced Transformer-enhanced architecture instead of MLP"
    )
    transformer_d_model: int = Field(
        default=256,
        ge=64,
        le=512,
        description="Transformer model dimension"
    )
    transformer_n_heads: int = Field(
        default=8,
        ge=1,
        le=16,
        description="Number of attention heads"
    )
    transformer_n_layers: int = Field(
        default=4,
        ge=1,
        le=8,
        description="Number of transformer encoder blocks"
    )
    transformer_d_ff: int = Field(
        default=512,
        ge=128,
        le=2048,
        description="Transformer feedforward dimension"
    )
    transformer_dropout: float = Field(
        default=0.1,
        ge=0.0,
        le=0.5,
        description="Dropout rate for transformer"
    )
    
    class Config:
        use_enum_values = True


class AgentStatus(BaseModel):
    """Status of an agent"""
    name: str
    status: Literal["idle", "training", "trained", "failed"]
    is_trained: bool = False
    training_progress: float = 0.0
    last_trained: Optional[str] = None
    total_episodes: int = 0
    best_reward: Optional[float] = None
    config: Optional[AgentConfig] = None
    performance_metrics: Optional[dict] = None


# Predefined agent profiles for common trading styles
PRESET_AGENT_CONFIGS = {
    "conservative_swing": AgentConfig(
        name="conservative_swing",
        description="Conservative swing trader - low risk, medium holding period",
        holding_period=HoldingPeriod.SWING_MEDIUM,
        risk_profile=RiskProfile.CONSERVATIVE,
        trading_style=TradingStyle.TREND_FOLLOWING,
        max_position_size=0.15,
        max_positions=3,
        stop_loss_percent=0.03,
        take_profit_percent=0.08,
        broker_profile=BrokerProfile.DISCOUNT,
    ),
    "aggressive_momentum": AgentConfig(
        name="aggressive_momentum",
        description="Aggressive momentum trader - high risk, short holding period",
        holding_period=HoldingPeriod.SWING_SHORT,
        risk_profile=RiskProfile.AGGRESSIVE,
        trading_style=TradingStyle.MOMENTUM,
        max_position_size=0.35,
        max_positions=5,
        stop_loss_percent=0.07,
        take_profit_percent=0.15,
        broker_profile=BrokerProfile.DISCOUNT,
        ent_coef=0.02,  # More exploration
    ),
    "day_trader": AgentConfig(
        name="day_trader",
        description="Intraday trader - quick trades, mean reversion",
        holding_period=HoldingPeriod.INTRADAY,
        risk_profile=RiskProfile.MODERATE,
        trading_style=TradingStyle.MEAN_REVERSION,
        max_position_size=0.20,
        max_positions=10,
        stop_loss_percent=0.02,
        take_profit_percent=0.04,
        broker_profile=BrokerProfile.MARKET_MAKER,
        use_daily_data=False,
    ),
    "position_investor": AgentConfig(
        name="position_investor",
        description="Long-term position trader - low turnover, trend following",
        holding_period=HoldingPeriod.POSITION_LONG,
        risk_profile=RiskProfile.CONSERVATIVE,
        trading_style=TradingStyle.TREND_FOLLOWING,
        max_position_size=0.30,
        max_positions=4,
        stop_loss_percent=0.10,
        take_profit_percent=0.25,
        trailing_stop=True,
        trailing_stop_distance=0.05,
        broker_profile=BrokerProfile.PREMIUM,
        gamma=0.995,  # More weight on long-term rewards
    ),
    "balanced_trader": AgentConfig(
        name="balanced_trader",
        description="Balanced approach - moderate risk and holding period",
        holding_period=HoldingPeriod.SWING_SHORT,
        risk_profile=RiskProfile.MODERATE,
        trading_style=TradingStyle.MIXED,
        max_position_size=0.20,
        max_positions=5,
        stop_loss_percent=0.05,
        take_profit_percent=0.10,
        broker_profile=BrokerProfile.STANDARD,
    ),
}
