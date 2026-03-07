"""
Smart Order Routing and Intraday Pattern Detection

Features:
- Optimal trade timing (avoid high-spread periods)
- Limit order preference over market orders
- Intraday pattern detection (Opening Range Breakout, Power Hour)
- Earnings calendar awareness
- Sector rotation analysis
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from datetime import datetime, time, timedelta
import pytz
import logging

logger = logging.getLogger(__name__)


@dataclass
class OrderRoutingAdvice:
    """Advice for order execution"""
    order_type: str  # 'market', 'limit', 'delay'
    limit_price: Optional[float] = None
    delay_minutes: int = 0
    reason: str = ""
    spread_estimate_pct: float = 0.0
    timing_quality: str = "normal"  # 'poor', 'normal', 'good', 'excellent'
    intraday_pattern: Optional[str] = None


@dataclass
class EarningsInfo:
    """Earnings event information"""
    symbol: str
    earnings_date: Optional[datetime] = None
    days_until_earnings: Optional[int] = None
    is_pre_earnings: bool = False  # Within 5 days before earnings
    is_post_earnings: bool = False  # Within 3 days after earnings
    recommendation: str = "normal"  # 'reduce', 'avoid', 'opportunity', 'normal'


@dataclass
class SectorRotationSignal:
    """Sector rotation analysis result"""
    strongest_sectors: List[str]
    weakest_sectors: List[str]
    sector_momentum: Dict[str, float]
    rotation_direction: str  # 'risk_on', 'risk_off', 'neutral'
    recommendation: str


class SmartOrderRouter:
    """
    Optimizes order execution timing and type.

    Reduces slippage and spread costs by:
    - Avoiding high-spread periods (market open/close)
    - Preferring limit orders when appropriate
    - Using intraday patterns for better entry timing
    """

    def __init__(
        self,
        timezone: str = "US/Eastern",
        use_limit_orders: bool = True,
        limit_offset_pct: float = 0.05,  # Place limit 0.05% from current
    ):
        self.timezone = timezone
        self.use_limit_orders = use_limit_orders
        self.limit_offset_pct = limit_offset_pct

    def get_order_advice(
        self,
        symbol: str,
        current_price: float,
        trade_type: str,  # 'buy' or 'short'
        urgency: str = 'normal',  # 'low', 'normal', 'high'
    ) -> OrderRoutingAdvice:
        """
        Get smart order routing advice.

        Args:
            symbol: Trading symbol
            current_price: Current market price
            trade_type: 'buy' or 'short'
            urgency: How urgent is the trade

        Returns:
            OrderRoutingAdvice with execution recommendations
        """
        try:
            tz = pytz.timezone(self.timezone)
            now = datetime.now(tz)
            current_time = now.time()
        except Exception:
            now = datetime.now()
            current_time = now.time()

        # Analyze timing quality
        timing = self._analyze_timing(current_time)

        # Determine order type
        if urgency == 'high' or timing['quality'] == 'excellent':
            order_type = 'market'
            limit_price = None
            delay = 0
        elif timing['quality'] == 'poor':
            if urgency == 'low':
                order_type = 'delay'
                limit_price = None
                delay = timing['delay_minutes']
            else:
                # Use limit order to mitigate spread
                order_type = 'limit'
                if trade_type == 'buy':
                    limit_price = current_price * (1 - self.limit_offset_pct / 100)
                else:
                    limit_price = current_price * (1 + self.limit_offset_pct / 100)
                delay = 0
        elif self.use_limit_orders and urgency != 'high':
            order_type = 'limit'
            if trade_type == 'buy':
                limit_price = current_price * (1 - self.limit_offset_pct / 100 * 0.5)
            else:
                limit_price = current_price * (1 + self.limit_offset_pct / 100 * 0.5)
            delay = 0
        else:
            order_type = 'market'
            limit_price = None
            delay = 0

        # Detect intraday pattern
        pattern = self._detect_intraday_pattern(current_time)

        return OrderRoutingAdvice(
            order_type=order_type,
            limit_price=round(limit_price, 2) if limit_price else None,
            delay_minutes=delay,
            reason=timing['reason'],
            spread_estimate_pct=timing['spread_estimate'],
            timing_quality=timing['quality'],
            intraday_pattern=pattern,
        )

    def _analyze_timing(self, current_time: time) -> Dict:
        """Analyze current time for trade timing quality"""
        # US Market hours: 9:30 - 16:00 Eastern
        market_open = time(9, 30)
        market_close = time(16, 0)

        # Poor timing periods (high spreads)
        first_15min = time(9, 45)
        last_15min = time(15, 45)
        lunch_start = time(12, 0)
        lunch_end = time(13, 0)

        # Excellent timing periods (good liquidity)
        mid_morning_start = time(10, 0)
        mid_morning_end = time(11, 30)
        power_hour_start = time(15, 0)

        if current_time < market_open or current_time > market_close:
            return {
                'quality': 'poor',
                'reason': 'Outside market hours',
                'spread_estimate': 0.5,
                'delay_minutes': 0,
            }
        elif current_time < first_15min:
            return {
                'quality': 'poor',
                'reason': 'First 15 minutes after market open - high spreads',
                'spread_estimate': 0.3,
                'delay_minutes': int((datetime.combine(datetime.today(), first_15min) -
                                      datetime.combine(datetime.today(), current_time)).seconds / 60),
            }
        elif current_time > last_15min:
            return {
                'quality': 'poor',
                'reason': 'Last 15 minutes before close - high spreads',
                'spread_estimate': 0.25,
                'delay_minutes': 0,  # Don't delay, market closing
            }
        elif lunch_start <= current_time <= lunch_end:
            return {
                'quality': 'normal',
                'reason': 'Lunch hour - lower volume',
                'spread_estimate': 0.15,
                'delay_minutes': 0,
            }
        elif mid_morning_start <= current_time <= mid_morning_end:
            return {
                'quality': 'excellent',
                'reason': 'Mid-morning - best liquidity',
                'spread_estimate': 0.08,
                'delay_minutes': 0,
            }
        elif current_time >= power_hour_start:
            return {
                'quality': 'good',
                'reason': 'Power hour - high volume',
                'spread_estimate': 0.10,
                'delay_minutes': 0,
            }
        else:
            return {
                'quality': 'normal',
                'reason': 'Normal trading period',
                'spread_estimate': 0.12,
                'delay_minutes': 0,
            }

    def _detect_intraday_pattern(self, current_time: time) -> Optional[str]:
        """Detect known intraday patterns"""
        if time(9, 30) <= current_time <= time(10, 0):
            return "opening_range"
        elif time(10, 0) <= current_time <= time(10, 30):
            return "opening_range_breakout"
        elif time(12, 0) <= current_time <= time(13, 30):
            return "midday_mean_reversion"
        elif time(15, 0) <= current_time <= time(16, 0):
            return "power_hour"
        return None


class EarningsCalendar:
    """
    Tracks earnings dates and adjusts trading behavior around earnings.

    Rules:
    - 5 days before earnings: Reduce position size by 50%
    - 1 day before earnings: Avoid new positions
    - 1-3 days after earnings: Look for Post-Earnings Drift opportunities
    """

    def __init__(self):
        # Cache of known earnings dates
        self._earnings_dates: Dict[str, datetime] = {}
        self._pre_earnings_days: int = 5
        self._post_earnings_days: int = 3

    def update_earnings_date(self, symbol: str, earnings_date: datetime):
        """Update earnings date for a symbol"""
        self._earnings_dates[symbol] = earnings_date

    def check_earnings_proximity(self, symbol: str) -> EarningsInfo:
        """
        Check if a symbol is near an earnings date.

        Returns:
            EarningsInfo with recommendations
        """
        if symbol not in self._earnings_dates:
            return EarningsInfo(
                symbol=symbol,
                recommendation='normal'
            )

        earnings_date = self._earnings_dates[symbol]
        now = datetime.now()
        days_diff = (earnings_date - now).days

        is_pre = 0 < days_diff <= self._pre_earnings_days
        is_post = -self._post_earnings_days <= days_diff <= 0

        if days_diff <= 1 and days_diff > 0:
            recommendation = 'avoid'  # Day before earnings
        elif is_pre:
            recommendation = 'reduce'  # Reduce position size
        elif is_post:
            recommendation = 'opportunity'  # Post-earnings drift
        else:
            recommendation = 'normal'

        return EarningsInfo(
            symbol=symbol,
            earnings_date=earnings_date,
            days_until_earnings=days_diff,
            is_pre_earnings=is_pre,
            is_post_earnings=is_post,
            recommendation=recommendation,
        )

    def get_position_scale_factor(self, earnings_info: EarningsInfo) -> float:
        """
        Get position size scale factor based on earnings proximity.

        Returns:
            Scale factor (0.0 - 1.0)
        """
        if earnings_info.recommendation == 'avoid':
            return 0.0  # Don't open new positions
        elif earnings_info.recommendation == 'reduce':
            # Scale down: closer to earnings = smaller position
            days = earnings_info.days_until_earnings or self._pre_earnings_days
            return max(0.3, days / self._pre_earnings_days)
        elif earnings_info.recommendation == 'opportunity':
            return 1.0  # Normal sizing for post-earnings
        return 1.0


class SectorRotationAnalyzer:
    """
    Analyzes sector rotation to identify strongest sectors.

    Uses relative strength ranking to focus trading on
    sectors with the best momentum.
    """

    # Sector ETF proxies (for reference)
    SECTOR_ETFS = {
        'technology': 'XLK',
        'financial': 'XLF',
        'healthcare': 'XLV',
        'consumer': 'XLY',
        'energy': 'XLE',
        'industrial': 'XLI',
        'utilities': 'XLU',
        'real_estate': 'XLRE',
        'communication': 'XLC',
        'materials': 'XLB',
    }

    def __init__(self):
        # Sector performance tracking
        self._sector_returns: Dict[str, List[float]] = {}

    def update_sector_performance(self, sector: str, daily_return: float):
        """Update sector performance tracking"""
        if sector not in self._sector_returns:
            self._sector_returns[sector] = []
        self._sector_returns[sector].append(daily_return)
        if len(self._sector_returns[sector]) > 60:
            self._sector_returns[sector] = self._sector_returns[sector][-60:]

    def analyze_rotation(self) -> SectorRotationSignal:
        """
        Analyze sector rotation and rank sectors.

        Returns:
            SectorRotationSignal with strongest/weakest sectors
        """
        if not self._sector_returns:
            return SectorRotationSignal(
                strongest_sectors=[],
                weakest_sectors=[],
                sector_momentum={},
                rotation_direction='neutral',
                recommendation='Insufficient data for sector rotation analysis'
            )

        # Calculate momentum for each sector (20-day cumulative return)
        momentum: Dict[str, float] = {}
        for sector, returns in self._sector_returns.items():
            if len(returns) >= 10:
                recent = returns[-20:] if len(returns) >= 20 else returns
                momentum[sector] = sum(recent)
            else:
                momentum[sector] = 0.0

        # Sort by momentum
        sorted_sectors = sorted(momentum.items(), key=lambda x: x[1], reverse=True)

        strongest = [s[0] for s in sorted_sectors[:3]]
        weakest = [s[0] for s in sorted_sectors[-3:]]

        # Determine rotation direction
        risk_on_sectors = {'technology', 'consumer', 'financial'}
        risk_off_sectors = {'utilities', 'healthcare', 'real_estate'}

        strong_set = set(strongest)
        if strong_set & risk_on_sectors:
            direction = 'risk_on'
        elif strong_set & risk_off_sectors:
            direction = 'risk_off'
        else:
            direction = 'neutral'

        return SectorRotationSignal(
            strongest_sectors=strongest,
            weakest_sectors=weakest,
            sector_momentum=momentum,
            rotation_direction=direction,
            recommendation=f"Favor {', '.join(strongest)}. Avoid {', '.join(weakest)}."
        )

    def get_symbol_preference(self, symbol: str, sector_map: Dict[str, str]) -> float:
        """
        Get a preference score for a symbol based on its sector's performance.

        Args:
            symbol: Trading symbol
            sector_map: Mapping of symbols to sectors

        Returns:
            Preference multiplier (0.5 - 1.5)
        """
        sector = sector_map.get(symbol, 'unknown')

        if sector not in self._sector_returns or len(self._sector_returns[sector]) < 10:
            return 1.0

        recent = self._sector_returns[sector][-20:]
        momentum = sum(recent)

        # Map momentum to preference: strong positive = 1.5x, strong negative = 0.5x
        if momentum > 0.05:
            return min(1.5, 1.0 + momentum * 5)
        elif momentum < -0.05:
            return max(0.5, 1.0 + momentum * 5)
        return 1.0
