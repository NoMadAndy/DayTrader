"""
AI Trader Decision Engine

Main decision engine that aggregates all signal sources and makes trading decisions.
Includes adaptive thresholds, risk checks, position sizing, and stop-loss/take-profit calculations.

Enhanced with:
- Churn filter (trade frequency control)
- Graduated take-profits (tiered profit-taking)
- Market regime detection (dynamic weight adjustment)
- Multi-timeframe analysis (signal confirmation)
- Correlation filter (position diversification)
- Smart order routing (optimal timing)
- Earnings calendar awareness
- Sector rotation analysis
- RL ensemble support (majority voting)
- Improved Kelly criterion
"""

from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field
from datetime import datetime
import os
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
    stop_loss_percent: float = 0.05  # 5% stop loss (used in 'fixed' mode)
    use_take_profit: bool = True
    take_profit_percent: float = 0.10  # 10% take profit (used in 'fixed' mode)
    sl_tp_mode: str = 'dynamic'  # 'dynamic' (ATR-based) or 'fixed' (static %)
    atr_period: int = 14  # ATR lookback period
    atr_sl_multiplier: float = 1.5  # SL = ATR × multiplier
    min_risk_reward: float = 2.0  # TP = SL-distance × R:R
    max_holding_days: Optional[int] = 30
    
    # Trading Horizon (affects decision sensitivity)
    trading_horizon: str = 'day'  # 'scalping', 'day', 'swing', 'position'
    target_holding_hours: int = 8  # Target holding period in hours
    max_holding_hours: int = 24  # Max holding period in hours
    
    # Short Selling
    allow_short_selling: bool = False  # Enable short selling (sell without position)
    max_short_positions: int = 3  # Maximum number of short positions
    max_short_exposure: float = 0.30  # Max 30% of portfolio in short positions
    
    # Warrant Trading (Optionsscheine)
    allow_warrants: bool = False  # Enable warrant trading (future feature)
    warrant_max_position_pct: float = 0.05  # Max 5% of portfolio per warrant position
    warrant_min_days_to_expiry: int = 30  # Minimum days to expiry for new positions
    warrant_preferred_type: str = 'call'  # 'call', 'put', or 'both'
    
    # Broker Profile (fees during execution are calculated backend-side)
    broker_profile: str = 'flatex'  # 'flatex', 'ingdiba', 'discount', 'standard', 'premium'
    
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

    # === NEW: Churn Filter (Trade Frequency Control) ===
    churn_filter_enabled: bool = True
    churn_cost_multiplier: float = 3.0  # Expected return must be Nx transaction costs
    churn_max_trades_per_symbol_hour: int = 2
    churn_max_trades_per_day: int = 20
    churn_cooldown_minutes: int = 15

    # === NEW: Graduated Take-Profit ===
    graduated_tp_enabled: bool = True
    graduated_tp_tier1_close_pct: float = 0.33  # Close 33% at tier 1
    graduated_tp_tier1_target_pct: float = 0.02  # +2% for tier 1
    graduated_tp_tier2_close_pct: float = 0.33  # Close 33% at tier 2
    graduated_tp_tier2_target_pct: float = 0.04  # +4% for tier 2
    graduated_tp_trailing_distance: float = 0.03  # 3% trailing for remainder
    graduated_tp_use_atr: bool = True  # Use ATR for tier targets

    # === NEW: Market Regime Detection ===
    regime_detection_enabled: bool = True
    regime_weight_adjustment: bool = True  # Auto-adjust weights by regime
    regime_max_weight_shift: float = 0.15  # Max weight adjustment per regime

    # === NEW: Multi-Timeframe Analysis ===
    multi_timeframe_enabled: bool = True
    multi_timeframe_confirmation_required: bool = False  # Require 2+ timeframe confirmation

    # === NEW: Correlation Filter ===
    correlation_filter_enabled: bool = True
    max_same_sector_positions: int = 3
    max_sector_exposure_pct: float = 0.40

    # === NEW: Smart Order Routing ===
    smart_order_routing_enabled: bool = True
    prefer_limit_orders: bool = True
    limit_order_offset_pct: float = 0.05

    # === NEW: Earnings Calendar ===
    earnings_awareness_enabled: bool = True
    earnings_pre_days: int = 5  # Days before earnings to reduce size
    earnings_avoid_day_before: bool = True

    # === NEW: Sector Rotation ===
    sector_rotation_enabled: bool = True

    # === NEW: RL Ensemble ===
    ensemble_enabled: bool = False  # Disabled by default (requires multiple agents)
    ensemble_min_agreement: float = 0.6

    # === NEW: Dynamic Confidence Threshold ===
    dynamic_confidence_enabled: bool = True
    confidence_lookback_trades: int = 50  # Trades to consider for dynamic threshold


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
        self.http_client = httpx.AsyncClient(timeout=30.0, headers={'X-Internal-Service-Token': os.environ.get('INTERNAL_SERVICE_TOKEN', '')})
        self.consecutive_losses = 0
        self.consecutive_wins = 0
        self._trade_history: list = []  # Recent trade outcomes for streak tracking

        # === NEW: Initialize enhancement modules ===
        from .churn_filter import ChurnFilter
        from .graduated_take_profit import GraduatedTakeProfitManager
        from .market_regime import MarketRegimeDetector, MultiTimeframeAnalyzer
        from .correlation_filter import CorrelationFilter
        from .smart_order import SmartOrderRouter, EarningsCalendar, SectorRotationAnalyzer
        from .rl_ensemble import RLEnsemble

        # Churn Filter
        self.churn_filter = ChurnFilter(
            cost_multiplier=config.churn_cost_multiplier,
            max_trades_per_symbol_per_hour=config.churn_max_trades_per_symbol_hour,
            max_total_trades_per_day=config.churn_max_trades_per_day,
            rapid_trade_cooldown_minutes=config.churn_cooldown_minutes,
        ) if config.churn_filter_enabled else None

        # Graduated Take-Profit Manager
        self.tp_manager = GraduatedTakeProfitManager(
            default_atr_multiplier=config.atr_sl_multiplier,
            tier1_close_pct=config.graduated_tp_tier1_close_pct,
            tier1_target_pct=config.graduated_tp_tier1_target_pct,
            tier2_close_pct=config.graduated_tp_tier2_close_pct,
            tier2_target_pct=config.graduated_tp_tier2_target_pct,
            tier3_trailing_distance=config.graduated_tp_trailing_distance,
            use_atr_for_tiers=config.graduated_tp_use_atr,
        ) if config.graduated_tp_enabled else None

        # Market Regime Detector
        self.regime_detector = MarketRegimeDetector() if config.regime_detection_enabled else None

        # Multi-Timeframe Analyzer
        self.mtf_analyzer = MultiTimeframeAnalyzer() if config.multi_timeframe_enabled else None

        # Correlation Filter
        self.correlation_filter = CorrelationFilter(
            max_same_sector_positions=config.max_same_sector_positions,
            max_sector_exposure_pct=config.max_sector_exposure_pct,
        ) if config.correlation_filter_enabled else None

        # Smart Order Router
        self.order_router = SmartOrderRouter(
            use_limit_orders=config.prefer_limit_orders,
            limit_offset_pct=config.limit_order_offset_pct,
        ) if config.smart_order_routing_enabled else None

        # Earnings Calendar
        self.earnings_calendar = EarningsCalendar() if config.earnings_awareness_enabled else None

        # Sector Rotation
        self.sector_rotation = SectorRotationAnalyzer() if config.sector_rotation_enabled else None

        # RL Ensemble
        self.ensemble = RLEnsemble(
            min_agreement_ratio=config.ensemble_min_agreement,
        ) if config.ensemble_enabled else None

        # Dynamic confidence tracking
        self._confidence_history: List[Dict] = []  # {confidence, was_profitable}
    
    async def analyze_symbol(
        self,
        symbol: str,
        market_data: Dict,
        portfolio_state: Optional[Dict] = None
    ) -> TradingDecision:
        """
        Analyze a symbol and make a trading decision.

        Enhanced pipeline:
        1. Aggregate signals from all sources
        2. Market regime detection & weight adjustment
        3. Multi-timeframe confirmation
        4. Calculate adaptive threshold (with dynamic confidence)
        5. Determine decision type
        6. Churn filter check
        7. Correlation filter check
        8. Earnings calendar check
        9. Position sizing (with improved Kelly & sector rotation)
        10. Graduated SL/TP with ATR-based stops
        11. Smart order routing
        12. Risk checks
        13. Build decision

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

        prices = market_data.get('prices', [])
        current_price = market_data.get('current_price', 0)
        enhancement_details = {}

        # === STEP 1: Market Regime Detection ===
        regime_analysis = None
        if self.regime_detector and prices:
            regime_analysis = self.regime_detector.detect_regime(prices)
            enhancement_details['market_regime'] = {
                'regime': regime_analysis.regime.value,
                'confidence': regime_analysis.confidence,
                'trend_strength': regime_analysis.trend_strength,
                'volatility_level': regime_analysis.volatility_level,
            }

            # Adjust signal weights based on regime
            if self.config.regime_weight_adjustment and regime_analysis.confidence > 0.5:
                base_weights = {
                    'ml_weight': self.config.ml_weight,
                    'rl_weight': self.config.rl_weight,
                    'sentiment_weight': self.config.sentiment_weight,
                    'technical_weight': self.config.technical_weight,
                }
                regime_weights = self.regime_detector.get_regime_adjusted_weights(
                    regime_analysis, base_weights
                )
                # Temporarily adjust aggregator weights
                self.signal_aggregator.config.ml_weight = regime_weights.ml_weight
                self.signal_aggregator.config.rl_weight = regime_weights.rl_weight
                self.signal_aggregator.config.sentiment_weight = regime_weights.sentiment_weight
                self.signal_aggregator.config.technical_weight = regime_weights.technical_weight
                enhancement_details['regime_weights'] = {
                    'ml': regime_weights.ml_weight,
                    'rl': regime_weights.rl_weight,
                    'sentiment': regime_weights.sentiment_weight,
                    'technical': regime_weights.technical_weight,
                    'reason': regime_weights.adjustment_reason,
                }

        # === STEP 2: Aggregate signals from all sources ===
        aggregated = await self.signal_aggregator.aggregate_signals(
            symbol=symbol,
            market_data=market_data,
            portfolio_state=portfolio_state,
            rl_agent_name=self.config.rl_agent_name
        )

        # Restore original weights if they were adjusted
        if self.regime_detector and self.config.regime_weight_adjustment:
            self.signal_aggregator.config.ml_weight = self.config.ml_weight
            self.signal_aggregator.config.rl_weight = self.config.rl_weight
            self.signal_aggregator.config.sentiment_weight = self.config.sentiment_weight
            self.signal_aggregator.config.technical_weight = self.config.technical_weight

        # === STEP 3: Multi-Timeframe Confirmation ===
        mtf_multiplier = 1.0
        if self.mtf_analyzer and prices:
            mtf_analysis = self.mtf_analyzer.analyze_multi_timeframe(prices)
            mtf_multiplier = self.mtf_analyzer.get_confidence_multiplier(mtf_analysis)
            enhancement_details['multi_timeframe'] = {
                'alignment': mtf_analysis['alignment'],
                'confirmation_level': mtf_analysis['confirmation_level'],
                'confidence_multiplier': mtf_multiplier,
            }

            # Boost or reduce confidence based on timeframe alignment
            aggregated.confidence = min(1.0, aggregated.confidence * mtf_multiplier)

            # If multi-timeframe confirmation is required and not aligned
            if (self.config.multi_timeframe_confirmation_required and
                    mtf_analysis['confirmation_level'] < 2):
                # Reduce score for entries (not exits)
                positions = portfolio_state.get('positions', {})
                if symbol not in positions:
                    aggregated.weighted_score *= 0.5  # Halve score without confirmation

        # === STEP 4: Calculate adaptive threshold (enhanced with dynamic confidence) ===
        threshold = self._calculate_adaptive_threshold(aggregated, portfolio_state)

        # Dynamic confidence adjustment based on recent trade accuracy
        if self.config.dynamic_confidence_enabled and self._confidence_history:
            recent = self._confidence_history[-self.config.confidence_lookback_trades:]
            if len(recent) >= 10:
                # Calculate optimal threshold from past trades
                profitable = [h for h in recent if h.get('was_profitable', False)]
                if profitable:
                    avg_profitable_confidence = np.mean([h['confidence'] for h in profitable])
                    # Blend: 70% current threshold + 30% historical optimal
                    threshold = threshold * 0.7 + avg_profitable_confidence * 0.3
                    enhancement_details['dynamic_threshold'] = {
                        'adjusted_threshold': threshold,
                        'avg_profitable_confidence': float(avg_profitable_confidence),
                        'sample_size': len(recent),
                    }

        # Soft gate: allow trades below the hard threshold but scale position size down.
        # Rationale: Sprint-2 ensemble disagreement penalty pushed many valid signals just
        # below the 0.65 threshold. Rather than dropping them entirely, trade them with
        # reduced size so the edge-filter remains intact but capital exposure is
        # risk-adjusted.
        soft_band = 0.15
        soft_threshold = max(0.3, threshold - soft_band)
        self._current_hard_threshold = threshold
        self._current_soft_threshold = soft_threshold

        # === STEP 5: Determine decision type ===
        decision_type = self._determine_decision_type(
            aggregated,
            threshold,
            portfolio_state,
            symbol
        )

        # === STEP 6: Churn Filter ===
        if self.churn_filter and decision_type in ('buy', 'short'):
            # Estimate expected return from signal score
            expected_return = abs(aggregated.weighted_score) * 5  # Rough: score * 5%
            churn_result = self.churn_filter.check_trade(
                symbol=symbol,
                expected_return_pct=expected_return,
                trade_type=decision_type,
                confidence=aggregated.confidence,
                horizon=self.config.trading_horizon,
            )
            enhancement_details['churn_filter'] = {
                'allowed': churn_result.allowed,
                'reason': churn_result.reason,
                'expected_return': churn_result.expected_return_pct,
                'min_required': churn_result.min_required_return_pct,
            }
            if not churn_result.allowed:
                decision_type = 'skip'

        # === STEP 7: Correlation Filter ===
        if self.correlation_filter and decision_type in ('buy', 'short'):
            positions = portfolio_state.get('positions', {})
            portfolio_value = portfolio_state.get('total_value', self.config.initial_budget)
            position_size_est = self.config.initial_budget * (self.config.fixed_position_percent or 0.10)

            corr_result = self.correlation_filter.check_new_position(
                symbol=symbol,
                position_value=position_size_est,
                current_positions=positions,
                portfolio_value=portfolio_value,
            )
            enhancement_details['correlation_filter'] = {
                'allowed': corr_result.allowed,
                'reason': corr_result.reason,
                'same_sector_count': corr_result.same_sector_count,
                'sector_exposure': corr_result.sector_exposure_pct,
                'effective_positions': corr_result.effective_positions,
            }
            if not corr_result.allowed:
                decision_type = 'skip'

        # === STEP 8: Earnings Calendar ===
        earnings_scale = 1.0
        if self.earnings_calendar and decision_type in ('buy', 'short'):
            earnings_info = self.earnings_calendar.check_earnings_proximity(symbol)
            earnings_scale = self.earnings_calendar.get_position_scale_factor(earnings_info)
            enhancement_details['earnings'] = {
                'recommendation': earnings_info.recommendation,
                'days_until': earnings_info.days_until_earnings,
                'position_scale': earnings_scale,
            }
            if earnings_scale == 0.0:
                decision_type = 'skip'

        # === STEP 9: Position sizing (enhanced with sector rotation & Kelly) ===
        position_size, quantity = self._calculate_position_size(
            decision_type,
            current_price,
            aggregated.confidence,
            portfolio_state,
            market_data=market_data
        )

        # Apply earnings scale
        if earnings_scale < 1.0 and position_size > 0:
            position_size *= earnings_scale
            quantity = int(quantity * earnings_scale) if quantity else 0

        # Apply sector rotation preference
        if self.sector_rotation and decision_type in ('buy', 'short'):
            from .correlation_filter import SECTOR_MAP
            sector_pref = self.sector_rotation.get_symbol_preference(symbol, SECTOR_MAP)
            if sector_pref != 1.0:
                position_size *= sector_pref
                quantity = int(quantity * sector_pref) if quantity else 0
                enhancement_details['sector_rotation'] = {
                    'preference': sector_pref,
                    'sector': SECTOR_MAP.get(symbol, 'unknown'),
                }

        # === STEP 10: Graduated SL/TP ===
        stop_loss, take_profit = self._calculate_sl_tp(
            decision_type,
            current_price,
            market_data
        )

        # Create graduated TP config for new positions
        if self.tp_manager and decision_type in ('buy', 'short'):
            atr_val = self._calculate_atr(prices, self.config.atr_period) if prices else None
            direction = 'long' if decision_type == 'buy' else 'short'
            tp_config = self.tp_manager.create_position_config(
                symbol=symbol,
                entry_price=current_price,
                direction=direction,
                atr=atr_val,
            )
            enhancement_details['graduated_tp'] = {
                'stop_loss': tp_config.stop_loss_price,
                'tier1_target': tp_config.tiers[0].target_pct * 100 if tp_config.tiers else 0,
                'tier2_target': tp_config.tiers[1].target_pct * 100 if len(tp_config.tiers) > 1 else 0,
                'trailing_distance': tp_config.trailing_stop_distance_pct * 100,
            }
            # Use graduated SL instead of fixed
            stop_loss = tp_config.stop_loss_price

        # === STEP 11: Smart Order Routing ===
        if self.order_router and decision_type in ('buy', 'short'):
            urgency = 'high' if aggregated.confidence > 0.85 else 'normal'
            order_advice = self.order_router.get_order_advice(
                symbol=symbol,
                current_price=current_price,
                trade_type=decision_type,
                urgency=urgency,
            )
            enhancement_details['smart_order'] = {
                'order_type': order_advice.order_type,
                'limit_price': order_advice.limit_price,
                'timing_quality': order_advice.timing_quality,
                'intraday_pattern': order_advice.intraday_pattern,
                'spread_estimate': order_advice.spread_estimate_pct,
            }

        # === STEP 12: Risk checks ===
        risk_result = await self.risk_manager.check_all(
            symbol=symbol,
            decision_type=decision_type,
            position_size=position_size,
            quantity=quantity,
            current_portfolio=portfolio_state
        )

        # Apply risk-based position scaling
        if risk_result.position_scale_factor < 1.0 and quantity != 0:
            position_size = position_size * risk_result.position_scale_factor
            quantity = int(quantity * risk_result.position_scale_factor)
            if abs(quantity) < 1:
                quantity = 1 if quantity > 0 else -1 if quantity < 0 else 0

        # === STEP 13: Build reasoning (enhanced) ===
        reasoning = self._build_reasoning(
            aggregated,
            threshold,
            decision_type,
            risk_result,
            portfolio_state
        )
        # Add enhancement details to reasoning
        reasoning['enhancements'] = enhancement_details

        # Create summary
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

        # Record trade in churn filter if executed
        if self.churn_filter and decision_type in ('buy', 'sell', 'short', 'close'):
            self.churn_filter.record_trade(
                symbol=symbol,
                trade_type=decision_type,
                price=current_price,
                quantity=abs(quantity) if quantity else 0,
            )

        return decision

    def check_graduated_take_profit(self, symbol: str, current_price: float) -> Optional[Dict]:
        """
        Check graduated take-profit levels for an existing position.
        Should be called periodically for all open positions.

        Args:
            symbol: Trading symbol
            current_price: Current market price

        Returns:
            Dict with action if TP triggered, None otherwise
        """
        if not self.tp_manager:
            return None

        result = self.tp_manager.check_price(symbol, current_price)
        if result['action'] != 'none':
            return result
        return None
    
    def record_trade_outcome(self, profit: float, confidence: float = 0.5):
        """
        Record a trade outcome for win/loss streak tracking and dynamic confidence.

        Args:
            profit: Trade profit (positive = win, negative = loss)
            confidence: Signal confidence when trade was entered
        """
        if profit is None:
            return
        self._trade_history.append(profit)
        if len(self._trade_history) > 100:
            self._trade_history = self._trade_history[-100:]

        if profit > 0:
            self.consecutive_wins += 1
            self.consecutive_losses = 0
        elif profit < 0:
            self.consecutive_losses += 1
            self.consecutive_wins = 0

        # Track confidence for dynamic threshold adjustment
        self._confidence_history.append({
            'confidence': confidence,
            'was_profitable': profit > 0,
            'profit': profit,
            'timestamp': datetime.now().isoformat(),
        })
        if len(self._confidence_history) > 200:
            self._confidence_history = self._confidence_history[-200:]
    
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
        
        # Adjust based on consecutive wins (prevent overconfidence)
        if self.consecutive_wins >= 5:
            threshold += 0.03 * (self.consecutive_wins - 4)  # Slight increase
        
        # Adjust based on drawdown level (graduated)
        max_value = portfolio_state.get('max_value') or self.config.initial_budget
        current_value = portfolio_state.get('total_value') or self.config.initial_budget
        if max_value > 0:
            drawdown = (max_value - current_value) / max_value
            max_dd = self.config.max_drawdown if self.config.max_drawdown else 0.15
            dd_ratio = drawdown / max_dd
            if dd_ratio > 0.5:
                # At 50%+ of max drawdown, raise threshold
                threshold += 0.05 * (dd_ratio - 0.5) * 2  # Up to +0.05 at 100%
        
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
        
        # Soft gate: allow trades down to soft_threshold; position size is scaled
        # down in _calculate_position_size based on (confidence - soft) / (hard - soft).
        soft_threshold = getattr(self, '_current_soft_threshold', threshold)
        if confidence < soft_threshold:
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
            # Break-even awareness: adjust close thresholds based on fee impact
            entry_price = position.get('entryPrice') or position.get('entry_price', 0)
            current_price_val = portfolio_state.get('positions', {}).get(symbol, {}).get('currentPrice') or entry_price
            total_fees = position.get('totalFeesPaid') or position.get('total_fees_paid', 0)
            fee_per_share = total_fees / position_quantity if position_quantity > 0 else 0
            break_even = entry_price + fee_per_share  # Long: need price above entry + fees
            
            # If we're below break-even, be more aggressive about closing (avoid deeper losses)
            # If we're above break-even, be more patient (let winners run)
            below_break_even = current_price_val < break_even if entry_price > 0 else False
            be_adjustment = 0.05 if below_break_even else -0.05  # Shift sell threshold
            
            # We have a LONG position
            if score < ht['sell_strong'] + be_adjustment:  # Strong bearish signal (horizon-adjusted)
                return 'sell'  # Sell the long position
            elif score < ht['sell_weak'] + be_adjustment:  # Weak bearish/neutral (horizon-adjusted)
                return 'close'  # Just close position
            else:
                return 'hold'  # Keep long position
                
        elif has_short_position:
            # Break-even awareness for short positions
            entry_price = position.get('entryPrice') or position.get('entry_price', 0)
            current_price_val = portfolio_state.get('positions', {}).get(symbol, {}).get('currentPrice') or entry_price
            total_fees = position.get('totalFeesPaid') or position.get('total_fees_paid', 0)
            fee_per_share = total_fees / position_quantity if position_quantity > 0 else 0
            break_even = entry_price - fee_per_share  # Short: need price below entry - fees
            
            above_break_even = current_price_val > break_even if entry_price > 0 else False
            be_adjustment = -0.05 if above_break_even else 0.05
            
            # We have a SHORT position (inverse thresholds)
            if score > -(ht['sell_strong'] + be_adjustment):  # Strong bullish signal - bad for short
                return 'close'  # Close the short (buy to cover)
            elif score > -(ht['sell_weak'] + be_adjustment):  # Weak bullish signal
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
        portfolio_state: Dict,
        market_data: Optional[Dict] = None
    ) -> tuple:
        """
        Calculate position size and quantity.
        
        Includes drawdown-based scaling and ATR-based volatility sizing.
        
        Args:
            decision_type: Type of decision
            current_price: Current stock price
            confidence: Signal confidence
            portfolio_state: Current portfolio state
            market_data: Market data (for ATR-based sizing)
            
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
            # Enhanced Kelly Criterion using rolling trade history
            # Kelly = (p * b - q) / b where p=win prob, q=loss prob, b=win/loss ratio
            recent_trades = self._trade_history[-50:] if self._trade_history else []

            if len(recent_trades) >= 10:
                # Use actual win rate and payoff ratio from recent trades
                wins = [t for t in recent_trades if t > 0]
                losses = [t for t in recent_trades if t < 0]
                win_prob = len(wins) / len(recent_trades)
                avg_win = np.mean(wins) if wins else 1.0
                avg_loss = abs(np.mean(losses)) if losses else 1.0
                win_loss_ratio = avg_win / avg_loss if avg_loss > 0 else 2.0
            else:
                # Fallback to confidence-based estimate
                win_prob = (confidence + 1) / 2
                win_loss_ratio = 2.0

            loss_prob = 1 - win_prob
            kelly_pct = (win_prob * win_loss_ratio - loss_prob) / win_loss_ratio
            kelly_pct = max(0, kelly_pct) * kelly_fraction  # Use fraction

            # Auto Half-Kelly in high volatility (VIX proxy via regime)
            if (hasattr(self, 'regime_detector') and self.regime_detector and
                    hasattr(self.regime_detector, '_regime_history') and
                    self.regime_detector._regime_history):
                from .market_regime import MarketRegime
                last_regime = self.regime_detector._regime_history[-1]
                if last_regime in (MarketRegime.HIGH_VOLATILITY, MarketRegime.CRASH):
                    kelly_pct *= 0.5  # Half-Kelly in volatile markets

            position_size = initial_budget * kelly_pct
        
        elif self.config.position_sizing == 'volatility':
            # ATR-inverse sizing: trade smaller in volatile markets, larger in calm ones
            # Target a fixed risk amount per trade relative to portfolio
            prices = (market_data or {}).get('prices', [])
            atr = self._calculate_atr(prices, self.config.atr_period) if prices else None
            
            if atr and atr > 0 and current_price > 0:
                atr_pct = atr / current_price
                # Target risk: 1% of portfolio per trade
                target_risk_pct = 0.01 * confidence  # Scale with confidence
                # Position = (portfolio * target_risk) / ATR%
                position_size = min(
                    initial_budget * target_risk_pct / max(atr_pct, 0.005),
                    initial_budget * fixed_position_percent * 2  # Cap at 2x base
                )
            else:
                # Fallback: confidence-scaled fixed
                position_size = initial_budget * fixed_position_percent * confidence
        
        else:
            position_size = initial_budget * fixed_position_percent
        
        # NOTE: Drawdown-based position scaling is handled by RiskManager._check_drawdown_graduated()
        # which sets risk_result.position_scale_factor. Applied in analyze_symbol() after risk checks.
        # This avoids double-scaling which would over-reduce positions.
        
        # === Loss Streak Scaling ===
        # Reduce positions after consecutive losses
        if self.consecutive_losses >= 3:
            streak_scale = max(0.30, 1.0 - (self.consecutive_losses - 2) * 0.15)
            position_size *= streak_scale
        
        # Soft-confidence scaling: if confidence is in the soft band (below hard
        # threshold but above soft floor), reduce size linearly. At hard threshold
        # the scale is 1.0; at the soft floor it approaches 0.
        hard_thr = getattr(self, '_current_hard_threshold', None)
        soft_thr = getattr(self, '_current_soft_threshold', None)
        if hard_thr is not None and soft_thr is not None and confidence < hard_thr:
            band = max(hard_thr - soft_thr, 1e-6)
            conf_scale = max(0.0, (confidence - soft_thr) / band)
            position_size *= conf_scale

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
    
    @staticmethod
    def _calculate_atr(prices: list, period: int = 14) -> Optional[float]:
        """
        Calculate Average True Range from OHLCV price data.
        
        Args:
            prices: List of dicts with 'high', 'low', 'close' keys
            period: ATR lookback period
            
        Returns:
            ATR value or None if insufficient data
        """
        if not prices or len(prices) < period + 1:
            return None
        
        true_ranges = []
        for i in range(1, len(prices)):
            high = prices[i].get('high', 0)
            low = prices[i].get('low', 0)
            prev_close = prices[i - 1].get('close', 0)
            
            if not all([high, low, prev_close]):
                continue
            
            tr = max(
                high - low,
                abs(high - prev_close),
                abs(low - prev_close)
            )
            true_ranges.append(tr)
        
        if len(true_ranges) < period:
            return None
        
        # Simple moving average of last `period` true ranges
        return sum(true_ranges[-period:]) / period
    
    def _calculate_sl_tp(
        self,
        decision_type: str,
        current_price: float,
        market_data: Optional[Dict] = None
    ) -> tuple:
        """
        Calculate stop-loss and take-profit levels.
        
        Supports two modes:
        - 'dynamic': ATR-based (adapts to volatility). SL = ATR × multiplier,
          TP = SL-distance × risk:reward ratio.
        - 'fixed': Static percentage (legacy behavior).
        
        Args:
            decision_type: 'buy' or 'short'
            current_price: Current stock price
            market_data: Market data dict with 'prices' list (for ATR calculation)
            
        Returns:
            Tuple of (stop_loss, take_profit)
        """
        if decision_type not in ['buy', 'short']:
            return (None, None)
        
        mode = self.config.sl_tp_mode
        
        # === DYNAMIC MODE: ATR-based SL/TP ===
        if mode == 'dynamic' and market_data:
            prices = market_data.get('prices', [])
            atr = self._calculate_atr(prices, self.config.atr_period)
            
            if atr and atr > 0:
                sl_distance = atr * self.config.atr_sl_multiplier
                tp_distance = sl_distance * self.config.min_risk_reward
                
                # Clamp: SL min 0.5%, max 15% of price; TP min 1%, max 30%
                sl_distance = max(current_price * 0.005, min(sl_distance, current_price * 0.15))
                tp_distance = max(current_price * 0.01, min(tp_distance, current_price * 0.30))
                
                stop_loss = None
                take_profit = None
                
                if decision_type == 'buy':
                    if self.config.use_stop_loss:
                        stop_loss = current_price - sl_distance
                    if self.config.use_take_profit:
                        take_profit = current_price + tp_distance
                elif decision_type == 'short':
                    if self.config.use_stop_loss:
                        stop_loss = current_price + sl_distance
                    if self.config.use_take_profit:
                        take_profit = current_price - tp_distance
                
                sl_pct = (sl_distance / current_price) * 100
                tp_pct = (tp_distance / current_price) * 100
                rr = tp_distance / sl_distance if sl_distance > 0 else 0
                print(f"   📐 Dynamic SL/TP: ATR=${atr:.2f} → SL={sl_pct:.1f}% TP={tp_pct:.1f}% R:R={rr:.1f}")
                
                return (stop_loss, take_profit)
            else:
                print(f"   ⚠️ ATR not available (need {self.config.atr_period + 1} candles), falling back to fixed SL/TP")
        
        # === FIXED MODE: Static percentage SL/TP ===
        stop_loss_percent = self.config.stop_loss_percent if self.config.stop_loss_percent is not None else 0.05
        take_profit_percent = self.config.take_profit_percent if self.config.take_profit_percent is not None else 0.10
        
        stop_loss = None
        take_profit = None
        
        if decision_type == 'buy':
            if self.config.use_stop_loss:
                stop_loss = current_price * (1 - stop_loss_percent)
            if self.config.use_take_profit:
                take_profit = current_price * (1 + take_profit_percent)
        elif decision_type == 'short':
            if self.config.use_stop_loss:
                stop_loss = current_price * (1 + stop_loss_percent)
            if self.config.use_take_profit:
                take_profit = current_price * (1 - take_profit_percent)
        
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
        # Surface current price at top level for debug visibility — vorher
        # steckte es nur in signals.ml.details.current_price, was beim Durch-
        # klicken von Skip-Reasons unsichtbar war. Bevorzuge ML-Details (immer
        # gesetzt wenn ML-Signal generiert wurde), Fallback technical/sentiment.
        current_price = None
        for sig_details in (aggregated.ml_details, aggregated.technical_details,
                            aggregated.sentiment_details):
            if isinstance(sig_details, dict):
                current_price = sig_details.get('current_price') or current_price
            if current_price:
                break

        return {
            'current_price': current_price,
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
    
    def get_enhancement_status(self) -> Dict[str, Any]:
        """Get status of all enhancement modules"""
        status = {}
        status['churn_filter'] = {
            'enabled': self.churn_filter is not None,
            'stats': self.churn_filter.get_stats() if self.churn_filter else None,
        }
        status['graduated_tp'] = {
            'enabled': self.tp_manager is not None,
            'active_positions': len(self.tp_manager.get_all_positions()) if self.tp_manager else 0,
        }
        status['market_regime'] = {
            'enabled': self.regime_detector is not None,
            'current_regime': (
                self.regime_detector._regime_history[-1].value
                if self.regime_detector and self.regime_detector._regime_history
                else None
            ),
        }
        status['multi_timeframe'] = {'enabled': self.mtf_analyzer is not None}
        status['correlation_filter'] = {'enabled': self.correlation_filter is not None}
        status['smart_order_routing'] = {'enabled': self.order_router is not None}
        status['earnings_calendar'] = {'enabled': self.earnings_calendar is not None}
        status['sector_rotation'] = {
            'enabled': self.sector_rotation is not None,
            'analysis': (
                self.sector_rotation.analyze_rotation().__dict__
                if self.sector_rotation and self.sector_rotation._sector_returns
                else None
            ),
        }
        status['ensemble'] = {
            'enabled': self.ensemble is not None,
            'member_stats': self.ensemble.get_member_stats() if self.ensemble else None,
        }
        status['dynamic_confidence'] = {
            'enabled': self.config.dynamic_confidence_enabled,
            'history_size': len(self._confidence_history),
        }
        return status

    async def close(self):
        """Cleanup resources"""
        await self.http_client.aclose()
        await self.signal_aggregator.close()
        await self.risk_manager.close()
