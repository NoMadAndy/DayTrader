"""
AI Trader Decision Engine

Main decision engine that aggregates all signal sources and makes trading decisions.
Includes adaptive thresholds, risk checks, position sizing, and stop-loss/take-profit calculations.
"""

from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field
from datetime import datetime
import httpx
import numpy as np


@dataclass
class AITraderConfig:
    """Configuration for AI Trader"""
    trader_id: int
    name: str
    
    # Capital Management
    initial_budget: float = 100000
    max_position_size: float = 0.25  # 25% of budget per position
    max_total_exposure: float = 0.80  # 80% total market exposure
    max_positions: int = 10
    reserve_cash: float = 0.10  # Keep 10% in cash
    
    # Risk Management
    risk_tolerance: str = 'moderate'  # 'conservative', 'moderate', 'aggressive'
    max_daily_loss: float = 0.05  # 5% max daily loss
    max_drawdown: float = 0.15  # 15% max drawdown
    max_consecutive_losses: int = 5
    cooldown_after_loss: int = 30  # Minutes to wait after consecutive losses
    
    # Signal Weights
    ml_weight: float = 0.30
    rl_weight: float = 0.30
    sentiment_weight: float = 0.20
    technical_weight: float = 0.20
    rl_agent_name: Optional[str] = None
    
    # Decision Thresholds
    min_confidence: float = 0.65
    adaptive_threshold: bool = True
    require_multiple_confirmation: bool = True
    min_signal_agreement: str = 'moderate'  # 'weak', 'moderate', 'strong'
    
    # Position Sizing
    position_sizing: str = 'fixed'  # 'fixed', 'kelly', 'volatility'
    fixed_position_percent: float = 0.10  # 10% of budget
    kelly_fraction: float = 0.25  # 25% of Kelly criterion
    max_position_pct: float = 0.10  # Alias for fixed_position_percent (from backend)
    max_portfolio_risk: float = 0.20  # Max total portfolio risk
    
    # Stop Loss & Take Profit
    use_stop_loss: bool = True
    stop_loss_percent: float = 0.05  # 5% stop loss
    use_take_profit: bool = True
    take_profit_percent: float = 0.10  # 10% take profit
    max_holding_days: Optional[int] = 30
    
    # Trading Horizon (affects decision sensitivity)
    trading_horizon: str = 'day'  # 'scalping', 'day', 'swing', 'position'
    target_holding_hours: int = 8  # Target holding period in hours
    max_holding_hours: int = 24  # Max holding period in hours
    
    # Short Selling
    allow_short_selling: bool = False  # Enable short selling (sell without position)
    max_short_positions: int = 3  # Maximum number of short positions
    max_short_exposure: float = 0.30  # Max 30% of portfolio in short positions
    
    # ML Auto-Training
    auto_train_ml: bool = True  # Automatically train ML models if missing
    ml_training_period: str = "2y"  # Period of data to use for training
    
    # Self-Training during Idle
    self_training_enabled: bool = True  # Enable self-training when idle
    self_training_interval_minutes: int = 60  # How often to self-train (when idle)
    self_training_timesteps: int = 10000  # Training steps per self-training session
    
    # Schedule
    schedule_enabled: bool = True
    trading_days: List[str] = field(default_factory=lambda: ['mon', 'tue', 'wed', 'thu', 'fri'])
    trading_start: str = "09:00"
    trading_end: str = "17:30"
    timezone: str = "Europe/Berlin"
    check_interval_seconds: int = 60  # Seconds between checks
    avoid_market_open: int = 15  # Minutes after market open
    avoid_market_close: int = 15  # Minutes before market close
    
    # Market Conditions
    pause_on_high_vix: float = 30  # Pause trading if VIX > 30
    
    # Trading Symbols
    symbols: List[str] = field(default_factory=lambda: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'])


@dataclass
class TradingDecision:
    """Result of a trading decision"""
    symbol: str
    decision_type: str  # 'buy', 'sell', 'hold', 'close', 'skip', 'short'
    confidence: float
    weighted_score: float
    
    # Individual signal scores
    ml_score: float
    rl_score: float
    sentiment_score: float
    technical_score: float
    signal_agreement: str
    
    # Decision details
    reasoning: Dict[str, Any]
    summary_short: str
    
    # Trade parameters (if buy/sell)
    quantity: Optional[int] = None
    price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    
    # Risk assessment
    risk_checks_passed: bool = True
    risk_warnings: List[str] = field(default_factory=list)
    risk_blockers: List[str] = field(default_factory=list)
    
    # Context
    market_context: Dict[str, Any] = field(default_factory=dict)
    portfolio_snapshot: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)


class AITraderEngine:
    """Main AI Trading Decision Engine"""
    
    def __init__(self, config: AITraderConfig, backend_url: str = "http://backend:3001"):
        """
        Initialize AI Trader Engine.
        
        Args:
            config: AITraderConfig instance
            backend_url: URL of backend service
        """
        self.config = config
        self.backend_url = backend_url
        
        # Import here to avoid circular imports
        from .ai_trader_signals import SignalAggregator
        from .ai_trader_risk import RiskManager
        
        self.signal_aggregator = SignalAggregator(config)
        self.risk_manager = RiskManager(config)
        self.http_client = httpx.AsyncClient(timeout=30.0)
        self.consecutive_losses = 0
    
    async def analyze_symbol(
        self,
        symbol: str,
        market_data: Dict,
        portfolio_state: Optional[Dict] = None
    ) -> TradingDecision:
        """
        Analyze a symbol and make a trading decision.
        
        Args:
            symbol: Trading symbol
            market_data: Market data including OHLCV
            portfolio_state: Current portfolio state (optional)
            
        Returns:
            TradingDecision with complete analysis
        """
        # Default portfolio state if not provided
        if portfolio_state is None:
            portfolio_state = {
                'cash': self.config.initial_budget,
                'total_value': self.config.initial_budget,
                'total_invested': 0,
                'positions_count': 0,
                'positions': {},
                'daily_pnl': 0,
                'daily_pnl_pct': 0,
                'max_value': self.config.initial_budget
            }
        
        # 1. Aggregate signals from all sources
        aggregated = await self.signal_aggregator.aggregate_signals(
            symbol=symbol,
            market_data=market_data,
            portfolio_state=portfolio_state,
            rl_agent_name=self.config.rl_agent_name
        )
        
        # 2. Calculate adaptive threshold
        threshold = self._calculate_adaptive_threshold(aggregated, portfolio_state)
        
        # 3. Determine decision type
        decision_type = self._determine_decision_type(
            aggregated,
            threshold,
            portfolio_state,
            symbol
        )
        
        # 4. Calculate position size
        current_price = market_data.get('current_price', 0)
        position_size, quantity = self._calculate_position_size(
            decision_type,
            current_price,
            aggregated.confidence,
            portfolio_state
        )
        
        # 5. Calculate stop-loss and take-profit
        stop_loss, take_profit = self._calculate_sl_tp(
            decision_type,
            current_price
        )
        
        # 6. Run risk checks
        risk_result = await self.risk_manager.check_all(
            symbol=symbol,
            decision_type=decision_type,
            position_size=position_size,
            quantity=quantity,
            current_portfolio=portfolio_state
        )
        
        # 7. Build reasoning
        reasoning = self._build_reasoning(
            aggregated,
            threshold,
            decision_type,
            risk_result,
            portfolio_state
        )
        
        # 8. Create summary
        summary = self._create_summary(
            symbol,
            decision_type,
            aggregated,
            risk_result
        )
        
        # Create decision object
        decision = TradingDecision(
            symbol=symbol,
            decision_type=decision_type,
            confidence=aggregated.confidence,
            weighted_score=aggregated.weighted_score,
            ml_score=aggregated.ml_score,
            rl_score=aggregated.rl_score,
            sentiment_score=aggregated.sentiment_score,
            technical_score=aggregated.technical_score,
            signal_agreement=aggregated.agreement,
            reasoning=reasoning,
            summary_short=summary,
            quantity=quantity if decision_type in ['buy', 'sell', 'short'] else None,
            price=current_price if decision_type in ['buy', 'sell', 'short'] else None,
            stop_loss=stop_loss,
            take_profit=take_profit,
            risk_checks_passed=risk_result.all_passed,
            risk_warnings=risk_result.warnings,
            risk_blockers=risk_result.blockers,
            market_context=aggregated.market_context,
            portfolio_snapshot=portfolio_state,
            timestamp=datetime.now()
        )
        
        return decision
    
    def _calculate_adaptive_threshold(
        self,
        aggregated,
        portfolio_state: Dict
    ) -> float:
        """
        Calculate adaptive decision threshold based on market conditions.
        
        Args:
            aggregated: AggregatedSignal instance
            portfolio_state: Current portfolio state
            
        Returns:
            Threshold value for decision making
        """
        # Use default if min_confidence is None
        min_confidence = self.config.min_confidence if self.config.min_confidence is not None else 0.65
        
        if not self.config.adaptive_threshold:
            return min_confidence
        
        # Start with base threshold
        threshold = min_confidence
        
        # Adjust based on signal agreement
        if aggregated.agreement == 'weak':
            threshold += 0.05
        elif aggregated.agreement == 'mixed':
            threshold += 0.10
        
        # Adjust based on portfolio performance
        daily_pnl_pct = portfolio_state.get('daily_pnl_pct') or 0
        if daily_pnl_pct < -2:  # Losing day
            threshold += 0.10
        
        # Adjust based on consecutive losses
        if self.consecutive_losses >= 3:
            threshold += 0.05 * (self.consecutive_losses - 2)
        
        # Adjust based on VIX (if available in market context)
        # This would be fetched in real implementation
        
        # Cap threshold
        threshold = min(threshold, 0.90)
        
        return threshold
    
    def _get_horizon_thresholds(self) -> Dict[str, float]:
        """
        Get decision thresholds based on trading horizon.
        
        Scalping requires more sensitive exit signals for quick trades.
        Position trading is more tolerant of temporary drawdowns.
        
        Returns:
            Dict with threshold values for the current horizon
        """
        horizon = self.config.trading_horizon
        
        # Thresholds: (sell_strong, sell_weak, buy_strong, short_trigger)
        thresholds = {
            'scalping': {
                'sell_strong': -0.10,    # Sell on small bearish signal
                'sell_weak': 0.05,       # Close on neutral/slightly positive
                'buy_strong': 0.15,      # Buy on smaller bullish signal
                'short_trigger': -0.12,  # Low bar for scalping shorts
            },
            'day': {
                'sell_strong': -0.20,    # Default day trading
                'sell_weak': 0.0,        # Close on neutral
                'buy_strong': 0.25,
                'short_trigger': -0.20,  # Same as sell_strong
            },
            'swing': {
                'sell_strong': -0.35,    # More tolerant
                'sell_weak': -0.10,
                'buy_strong': 0.30,
                'short_trigger': -0.28,  # Moderate threshold
            },
            'position': {
                'sell_strong': -0.45,    # Very tolerant of volatility
                'sell_weak': -0.20,
                'buy_strong': 0.35,
                'short_trigger': -0.35,  # Strong conviction needed
            }
        }
        
        return thresholds.get(horizon, thresholds['day'])
    
    def _determine_decision_type(
        self,
        aggregated,
        threshold: float,
        portfolio_state: Dict,
        symbol: str
    ) -> str:
        """
        Determine the trading decision type.
        
        Decision sensitivity adapts to trading horizon:
        - Scalping: Quick exits, small profit targets
        - Day: Moderate sensitivity
        - Swing/Position: More tolerant of fluctuations
        
        Args:
            aggregated: AggregatedSignal instance
            threshold: Decision threshold
            portfolio_state: Current portfolio state
            symbol: Trading symbol
            
        Returns:
            Decision type: 'buy', 'sell', 'hold', 'close', 'skip', 'short'
        """
        score = aggregated.weighted_score
        confidence = aggregated.confidence
        
        # Get horizon-specific thresholds
        ht = self._get_horizon_thresholds()
        
        # Check if we have an existing position
        positions = portfolio_state.get('positions') or {}
        position = positions.get(symbol) or {}
        position_quantity = position.get('quantity') or 0
        position_side = position.get('side', '')
        # Use 'side' field for detection because quantity is always positive in portfolio API
        has_long_position = position_quantity > 0 and position_side != 'short'
        has_short_position = position_quantity > 0 and position_side == 'short'
        
        # Enforce minimum holding time before allowing close/sell (except SL/TP which bypass engine)
        if (has_long_position or has_short_position) and position.get('opened_at'):
            try:
                opened_at = datetime.fromisoformat(position['opened_at'].replace('Z', '+00:00'))
                # Make opened_at offset-naive if comparing with naive datetime
                if opened_at.tzinfo is not None:
                    opened_at = opened_at.replace(tzinfo=None)
                minutes_held = (datetime.now() - opened_at).total_seconds() / 60
                # Minimum holding: 15 min for scalping, 30 min for day, 60 min for swing/position
                min_hold = {'scalping': 15, 'day': 30, 'swing': 60, 'position': 120}
                min_hold_minutes = min_hold.get(self.config.trading_horizon, 30)
                if minutes_held < min_hold_minutes:
                    return 'hold'  # Too early to close
            except (ValueError, TypeError):
                pass  # If parsing fails, proceed normally
        
        # If confidence below threshold, skip
        if confidence < threshold:
            return 'skip'
        
        # Check signal agreement requirement
        if self.config.require_multiple_confirmation:
            agreement_level = {'weak': 0, 'moderate': 1, 'strong': 2}
            min_level = agreement_level.get(self.config.min_signal_agreement, 1)
            actual_level = agreement_level.get(aggregated.agreement, 0)
            
            if actual_level < min_level:
                return 'skip'
        
        # Make decision based on score, position, and horizon thresholds
        if has_long_position:
            # We have a LONG position
            if score < ht['sell_strong']:  # Strong bearish signal (horizon-adjusted)
                return 'sell'  # Sell the long position
            elif score < ht['sell_weak']:  # Weak bearish/neutral (horizon-adjusted)
                return 'close'  # Just close position
            else:
                return 'hold'  # Keep long position
                
        elif has_short_position:
            # We have a SHORT position (inverse thresholds)
            if score > -ht['sell_strong']:  # Strong bullish signal - bad for short
                return 'close'  # Close the short (buy to cover)
            elif score > -ht['sell_weak']:  # Weak bullish signal
                return 'close'  # Close to limit losses
            else:
                return 'hold'  # Keep short position
                
        else:
            # NO position - consider opening one
            if score > ht['buy_strong']:  # Strong bullish signal (horizon-adjusted)
                return 'buy'
            elif score > 0:  # Weak bullish signal
                if confidence > threshold + 0.10:  # Need higher confidence
                    return 'buy'
                else:
                    return 'hold'
            elif score < ht['short_trigger']:  # Strong bearish signal (horizon-adjusted)
                # Check if short selling is allowed
                if self.config.allow_short_selling:
                    if self._can_open_short(portfolio_state, symbol):
                        return 'short'  # Open short position
                return 'hold'
            elif score < ht['short_trigger'] + 0.10:  # Moderate bearish signal
                if self.config.allow_short_selling and confidence > threshold + 0.15:
                    if self._can_open_short(portfolio_state, symbol):
                        return 'short'
                return 'hold'
            else:
                return 'hold'
    
    def _can_open_short(self, portfolio_state: Dict, symbol: str) -> bool:
        """
        Check if we can open a new short position.
        
        Args:
            portfolio_state: Current portfolio state
            symbol: Symbol to short
            
        Returns:
            True if short position can be opened
        """
        positions = portfolio_state.get('positions', {})
        
        # Count existing short positions (use 'side' field, not quantity sign)
        short_count = sum(1 for p in positions.values() if p.get('side') == 'short')
        if short_count >= (self.config.max_short_positions or 3):
            return False
        
        # Check short exposure (use 'side' field)
        total_value = portfolio_state.get('total_value') or 100000
        short_exposure = sum(
            abs(p.get('market_value', 0) or 0) 
            for p in positions.values() 
            if p.get('side') == 'short'
        )
        
        max_short_exposure = self.config.max_short_exposure if self.config.max_short_exposure is not None else 0.30
        if total_value > 0 and short_exposure / total_value > max_short_exposure:
            return False
        
        return True
    
    def _calculate_position_size(
        self,
        decision_type: str,
        current_price: float,
        confidence: float,
        portfolio_state: Dict
    ) -> tuple:
        """
        Calculate position size and quantity.
        
        Args:
            decision_type: Type of decision
            current_price: Current stock price
            confidence: Signal confidence
            portfolio_state: Current portfolio state
            
        Returns:
            Tuple of (position_size_dollars, quantity_shares)
            For short positions, quantity is negative.
        """
        if decision_type not in ['buy', 'sell', 'short']:
            return (0, 0)
        
        if current_price <= 0:
            return (0, 0)
        
        # Use defaults if config values are None
        initial_budget = self.config.initial_budget if self.config.initial_budget is not None else 100000
        fixed_position_percent = self.config.fixed_position_percent if self.config.fixed_position_percent is not None else 0.10
        max_position_size = self.config.max_position_size if self.config.max_position_size is not None else 0.25
        kelly_fraction = self.config.kelly_fraction if self.config.kelly_fraction is not None else 0.25
        
        cash = portfolio_state.get('cash', initial_budget)
        
        if self.config.position_sizing == 'fixed':
            # Fixed percentage of budget
            position_size = initial_budget * fixed_position_percent
        
        elif self.config.position_sizing == 'kelly':
            # Kelly Criterion (simplified)
            # Kelly = (p * b - q) / b where p=win prob, q=loss prob, b=win/loss ratio
            win_prob = (confidence + 1) / 2  # Convert confidence to probability
            loss_prob = 1 - win_prob
            win_loss_ratio = 2.0  # Assume 2:1 reward/risk
            
            kelly_pct = (win_prob * win_loss_ratio - loss_prob) / win_loss_ratio
            kelly_pct = max(0, kelly_pct) * kelly_fraction  # Use fraction
            
            position_size = initial_budget * kelly_pct
        
        elif self.config.position_sizing == 'volatility':
            # Volatility-based sizing (simplified)
            # Use confidence as inverse volatility proxy
            vol_factor = confidence
            base_size = initial_budget * fixed_position_percent
            position_size = base_size * vol_factor
        
        else:
            position_size = initial_budget * fixed_position_percent
        
        # For short positions, use a smaller position size (more conservative)
        if decision_type == 'short':
            position_size = position_size * 0.7  # 30% smaller than long positions
        
        # Ensure position size doesn't exceed available cash
        position_size = min(position_size, cash * 0.95)  # Keep some buffer
        
        # Ensure position size doesn't exceed max position size
        max_position = initial_budget * max_position_size
        position_size = min(position_size, max_position)
        
        # Calculate quantity
        quantity = int(position_size / current_price)
        
        # For short positions, return negative quantity
        if decision_type == 'short':
            quantity = -quantity
        
        # Recalculate actual position size based on whole shares
        actual_position_size = abs(quantity) * current_price
        
        return (actual_position_size, quantity)
    
    def _calculate_sl_tp(
        self,
        decision_type: str,
        current_price: float
    ) -> tuple:
        """
        Calculate stop-loss and take-profit levels.
        
        Args:
            decision_type: Type of decision
            current_price: Current stock price
            
        Returns:
            Tuple of (stop_loss, take_profit)
        """
        if decision_type not in ['buy', 'short']:
            return (None, None)
        
        # Use defaults if config values are None
        stop_loss_percent = self.config.stop_loss_percent if self.config.stop_loss_percent is not None else 0.05
        take_profit_percent = self.config.take_profit_percent if self.config.take_profit_percent is not None else 0.10
        
        stop_loss = None
        take_profit = None
        
        if decision_type == 'buy':
            # Long position: stop-loss below, take-profit above
            if self.config.use_stop_loss:
                stop_loss = current_price * (1 - stop_loss_percent)
            if self.config.use_take_profit:
                take_profit = current_price * (1 + take_profit_percent)
        elif decision_type == 'short':
            # Short position: stop-loss above, take-profit below (inverted)
            if self.config.use_stop_loss:
                stop_loss = current_price * (1 + stop_loss_percent)  # Stop above
            if self.config.use_take_profit:
                take_profit = current_price * (1 - take_profit_percent)  # Target below
        
        return (stop_loss, take_profit)
    
    def _build_reasoning(
        self,
        aggregated,
        threshold: float,
        decision_type: str,
        risk_result,
        portfolio_state: Dict
    ) -> Dict[str, Any]:
        """
        Build detailed reasoning for the decision.
        
        Args:
            aggregated: AggregatedSignal instance
            threshold: Decision threshold
            decision_type: Type of decision
            risk_result: RiskCheckResult instance
            portfolio_state: Portfolio state
            
        Returns:
            Dictionary with reasoning details
        """
        return {
            'weighted_score': aggregated.weighted_score,
            'threshold': threshold,
            'confidence': aggregated.confidence,
            'agreement': aggregated.agreement,
            'signals': {
                'ml': {
                    'score': aggregated.ml_score,
                    'weight': self.config.ml_weight,
                    'details': aggregated.ml_details
                },
                'rl': {
                    'score': aggregated.rl_score,
                    'weight': self.config.rl_weight,
                    'details': aggregated.rl_details
                },
                'sentiment': {
                    'score': aggregated.sentiment_score,
                    'weight': self.config.sentiment_weight,
                    'details': aggregated.sentiment_details
                },
                'technical': {
                    'score': aggregated.technical_score,
                    'weight': self.config.technical_weight,
                    'details': aggregated.technical_details
                }
            },
            'risk_checks': {
                'passed': risk_result.all_passed,
                'passed_count': risk_result.passed_count,
                'total_count': risk_result.total_count,
                'checks': risk_result.checks
            },
            'portfolio': {
                'cash': portfolio_state.get('cash') or 0,
                'total_value': portfolio_state.get('total_value') or 0,
                'positions_count': portfolio_state.get('positions_count') or 0,
                'daily_pnl_pct': portfolio_state.get('daily_pnl_pct') or 0
            }
        }
    
    def _create_summary(
        self,
        symbol: str,
        decision_type: str,
        aggregated,
        risk_result
    ) -> str:
        """
        Create short summary of decision.
        
        Args:
            symbol: Trading symbol
            decision_type: Type of decision
            aggregated: AggregatedSignal instance
            risk_result: RiskCheckResult instance
            
        Returns:
            Short summary string
        """
        if decision_type == 'skip':
            reason = 'low confidence' if aggregated.confidence < self.config.min_confidence else 'weak agreement'
            return f"{symbol}: Skip - {reason}"
        
        elif decision_type == 'buy':
            if risk_result.all_passed:
                return f"{symbol}: BUY - Strong bullish signals ({aggregated.agreement} agreement, {aggregated.confidence:.0%} confidence)"
            else:
                return f"{symbol}: BUY blocked - Risk checks failed"
        
        elif decision_type == 'short':
            if risk_result.all_passed:
                return f"{symbol}: SHORT - Strong bearish signals ({aggregated.agreement} agreement, {aggregated.confidence:.0%} confidence)"
            else:
                return f"{symbol}: SHORT blocked - Risk checks failed"
        
        elif decision_type == 'sell':
            return f"{symbol}: SELL - Closing long position due to bearish signals ({aggregated.agreement} agreement)"
        
        elif decision_type == 'close':
            return f"{symbol}: CLOSE position - Weak opposing signal"
        
        else:  # hold
            return f"{symbol}: HOLD - No strong signal"
    
    async def close(self):
        """Cleanup resources"""
        await self.http_client.aclose()
        await self.signal_aggregator.close()
        await self.risk_manager.close()
