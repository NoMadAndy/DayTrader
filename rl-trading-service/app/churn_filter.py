"""
Trade Frequency Control (Churn Filter)

Prevents excessive trading by:
- Enforcing minimum expected return vs transaction costs (3x rule)
- Tracking trade frequency per symbol
- Implementing cooldown periods after rapid trades
- Calculating break-even thresholds based on broker fees
"""

from dataclasses import dataclass, field
from typing import Dict, Optional, List
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


@dataclass
class TradeRecord:
    """Record of a single trade for churn tracking"""
    symbol: str
    timestamp: datetime
    trade_type: str  # 'buy', 'sell', 'short', 'close'
    price: float
    quantity: int
    fees: float


@dataclass
class ChurnCheckResult:
    """Result of churn filter check"""
    allowed: bool
    reason: str
    expected_return_pct: float = 0.0
    min_required_return_pct: float = 0.0
    trades_last_hour: int = 0
    trades_last_day: int = 0
    cooldown_remaining_seconds: int = 0


class ChurnFilter:
    """
    Prevents excessive trading that erodes profits through transaction costs.

    Rules:
    1. Expected return must be >= 3x transaction costs
    2. Max trades per symbol per hour (configurable)
    3. Max total trades per day (configurable)
    4. Cooldown after rapid consecutive trades on same symbol
    """

    def __init__(
        self,
        cost_multiplier: float = 3.0,
        max_trades_per_symbol_per_hour: int = 2,
        max_total_trades_per_day: int = 20,
        rapid_trade_cooldown_minutes: int = 15,
        broker_fee_pct: float = 0.15,  # Average broker fee as % of trade value
        spread_pct: float = 0.10,      # Average spread cost as %
    ):
        self.cost_multiplier = cost_multiplier
        self.max_trades_per_symbol_per_hour = max_trades_per_symbol_per_hour
        self.max_total_trades_per_day = max_total_trades_per_day
        self.rapid_trade_cooldown_minutes = rapid_trade_cooldown_minutes
        self.broker_fee_pct = broker_fee_pct
        self.spread_pct = spread_pct

        # Trade history for tracking
        self._trade_history: List[TradeRecord] = []
        self._last_trade_per_symbol: Dict[str, datetime] = {}
        self._rapid_trade_count: Dict[str, int] = {}  # trades within cooldown window

    def check_trade(
        self,
        symbol: str,
        expected_return_pct: float,
        trade_type: str = 'buy',
        confidence: float = 0.5,
    ) -> ChurnCheckResult:
        """
        Check if a trade should be allowed based on churn filters.

        Args:
            symbol: Trading symbol
            expected_return_pct: Expected return as percentage (e.g., 2.0 for 2%)
            trade_type: Type of trade ('buy', 'sell', 'short')
            confidence: Signal confidence (0-1)

        Returns:
            ChurnCheckResult indicating if trade is allowed
        """
        now = datetime.now()

        # Always allow closing/selling existing positions
        if trade_type in ('sell', 'close', 'cover'):
            return ChurnCheckResult(
                allowed=True,
                reason="Closing positions always allowed"
            )

        # 1. Check expected return vs costs
        total_round_trip_cost = (self.broker_fee_pct + self.spread_pct) * 2  # Buy + sell
        min_required_return = total_round_trip_cost * self.cost_multiplier

        # Adjust expected return by confidence
        adjusted_expected_return = expected_return_pct * confidence

        if adjusted_expected_return < min_required_return:
            return ChurnCheckResult(
                allowed=False,
                reason=f"Expected return {adjusted_expected_return:.2f}% < {min_required_return:.2f}% (3x costs)",
                expected_return_pct=adjusted_expected_return,
                min_required_return_pct=min_required_return
            )

        # 2. Check trades per symbol per hour
        one_hour_ago = now - timedelta(hours=1)
        symbol_trades_last_hour = sum(
            1 for t in self._trade_history
            if t.symbol == symbol and t.timestamp > one_hour_ago
            and t.trade_type in ('buy', 'short')
        )

        if symbol_trades_last_hour >= self.max_trades_per_symbol_per_hour:
            return ChurnCheckResult(
                allowed=False,
                reason=f"Max {self.max_trades_per_symbol_per_hour} trades/hour for {symbol} reached",
                trades_last_hour=symbol_trades_last_hour
            )

        # 3. Check total trades per day
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        total_trades_today = sum(
            1 for t in self._trade_history
            if t.timestamp > day_start
            and t.trade_type in ('buy', 'short')
        )

        if total_trades_today >= self.max_total_trades_per_day:
            return ChurnCheckResult(
                allowed=False,
                reason=f"Max {self.max_total_trades_per_day} trades/day reached",
                trades_last_day=total_trades_today
            )

        # 4. Check rapid trade cooldown
        if symbol in self._last_trade_per_symbol:
            time_since_last = (now - self._last_trade_per_symbol[symbol]).total_seconds()
            cooldown_seconds = self.rapid_trade_cooldown_minutes * 60

            if time_since_last < cooldown_seconds:
                remaining = int(cooldown_seconds - time_since_last)
                return ChurnCheckResult(
                    allowed=False,
                    reason=f"Cooldown active for {symbol}: {remaining}s remaining",
                    cooldown_remaining_seconds=remaining
                )

        return ChurnCheckResult(
            allowed=True,
            reason="Trade passes all churn filters",
            expected_return_pct=adjusted_expected_return,
            min_required_return_pct=min_required_return,
            trades_last_hour=symbol_trades_last_hour,
            trades_last_day=total_trades_today
        )

    def record_trade(self, symbol: str, trade_type: str, price: float, quantity: int, fees: float = 0):
        """Record a trade for history tracking"""
        now = datetime.now()

        record = TradeRecord(
            symbol=symbol,
            timestamp=now,
            trade_type=trade_type,
            price=price,
            quantity=quantity,
            fees=fees
        )
        self._trade_history.append(record)

        if trade_type in ('buy', 'short'):
            self._last_trade_per_symbol[symbol] = now

        # Cleanup old history (keep last 7 days)
        cutoff = now - timedelta(days=7)
        self._trade_history = [t for t in self._trade_history if t.timestamp > cutoff]

    def get_stats(self) -> Dict:
        """Get current churn filter statistics"""
        now = datetime.now()
        one_hour_ago = now - timedelta(hours=1)
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        return {
            'trades_last_hour': sum(1 for t in self._trade_history if t.timestamp > one_hour_ago),
            'trades_today': sum(1 for t in self._trade_history if t.timestamp > day_start),
            'total_fees_today': sum(
                t.fees for t in self._trade_history if t.timestamp > day_start
            ),
            'active_cooldowns': {
                symbol: int((self.rapid_trade_cooldown_minutes * 60 - (now - ts).total_seconds()))
                for symbol, ts in self._last_trade_per_symbol.items()
                if (now - ts).total_seconds() < self.rapid_trade_cooldown_minutes * 60
            }
        }
