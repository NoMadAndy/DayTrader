"""
Graduated Take-Profit System

Implements tiered profit-taking to lock in partial gains while
allowing remaining position to capture larger moves:
- Tier 1: Close 33% at +2% (or 1x ATR)
- Tier 2: Close 33% at +4% (or 2x ATR)
- Tier 3: Remaining with trailing stop

Also includes dynamic ATR-based stop-loss calculation.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class TakeProfitTier:
    """A single take-profit tier"""
    percentage_to_close: float  # 0.33 = 33% of position
    target_pct: float           # Price move % to trigger (e.g., 0.02 = 2%)
    triggered: bool = False
    triggered_at: Optional[float] = None
    triggered_time: Optional[datetime] = None


@dataclass
class GraduatedSLTP:
    """Complete graduated stop-loss and take-profit configuration for a position"""
    symbol: str
    entry_price: float
    direction: str  # 'long' or 'short'

    # Dynamic ATR-based stop-loss
    stop_loss_price: float = 0.0
    atr_value: float = 0.0
    atr_multiplier: float = 2.0

    # Trailing stop for final tier
    trailing_stop_active: bool = False
    trailing_stop_price: float = 0.0
    highest_price_since_entry: float = 0.0
    lowest_price_since_entry: float = float('inf')
    trailing_stop_distance_pct: float = 0.03  # 3% trailing distance

    # Take-profit tiers
    tiers: List[TakeProfitTier] = field(default_factory=list)

    # Track how much of original position remains
    remaining_position_pct: float = 1.0


class GraduatedTakeProfitManager:
    """
    Manages graduated take-profit and dynamic stop-loss for positions.

    Features:
    - ATR-based dynamic stop-loss (adapts to volatility)
    - 3-tier take-profit system
    - Trailing stop for final tier
    - Support for long and short positions
    """

    def __init__(
        self,
        default_atr_multiplier: float = 2.0,
        tier1_close_pct: float = 0.33,
        tier1_target_pct: float = 0.02,
        tier2_close_pct: float = 0.33,
        tier2_target_pct: float = 0.04,
        tier3_trailing_distance: float = 0.03,
        use_atr_for_tiers: bool = True,
    ):
        self.default_atr_multiplier = default_atr_multiplier
        self.tier1_close_pct = tier1_close_pct
        self.tier1_target_pct = tier1_target_pct
        self.tier2_close_pct = tier2_close_pct
        self.tier2_target_pct = tier2_target_pct
        self.tier3_trailing_distance = tier3_trailing_distance
        self.use_atr_for_tiers = use_atr_for_tiers

        # Active position configs
        self._positions: Dict[str, GraduatedSLTP] = {}

    def create_position_config(
        self,
        symbol: str,
        entry_price: float,
        direction: str = 'long',
        atr: Optional[float] = None,
        atr_multiplier: Optional[float] = None,
    ) -> GraduatedSLTP:
        """
        Create graduated SL/TP configuration for a new position.

        Args:
            symbol: Trading symbol
            entry_price: Entry price
            direction: 'long' or 'short'
            atr: Current ATR value (for dynamic levels)
            atr_multiplier: Override default ATR multiplier for stop-loss
        """
        mult = atr_multiplier or self.default_atr_multiplier

        # Calculate ATR-based stop-loss
        if atr and atr > 0:
            sl_distance = atr * mult
            # Clamp: min 0.5%, max 15% of price
            sl_distance = max(entry_price * 0.005, min(sl_distance, entry_price * 0.15))

            if direction == 'long':
                stop_loss_price = entry_price - sl_distance
            else:
                stop_loss_price = entry_price + sl_distance

            # ATR-based tier targets
            if self.use_atr_for_tiers:
                tier1_target = (atr * 1.0) / entry_price  # 1x ATR
                tier2_target = (atr * 2.0) / entry_price  # 2x ATR
                trailing_dist = (atr * 1.5) / entry_price  # 1.5x ATR
            else:
                tier1_target = self.tier1_target_pct
                tier2_target = self.tier2_target_pct
                trailing_dist = self.tier3_trailing_distance
        else:
            # Fallback to fixed percentages
            sl_distance = entry_price * 0.05  # 5% default
            if direction == 'long':
                stop_loss_price = entry_price - sl_distance
            else:
                stop_loss_price = entry_price + sl_distance
            tier1_target = self.tier1_target_pct
            tier2_target = self.tier2_target_pct
            trailing_dist = self.tier3_trailing_distance

        # Clamp tier targets to reasonable ranges
        tier1_target = max(0.005, min(tier1_target, 0.10))  # 0.5% - 10%
        tier2_target = max(tier1_target + 0.005, min(tier2_target, 0.20))  # Above tier1, max 20%
        trailing_dist = max(0.01, min(trailing_dist, 0.10))  # 1% - 10%

        # Create tiers
        tiers = [
            TakeProfitTier(
                percentage_to_close=self.tier1_close_pct,
                target_pct=tier1_target,
            ),
            TakeProfitTier(
                percentage_to_close=self.tier2_close_pct,
                target_pct=tier2_target,
            ),
            # Tier 3: Remaining position managed by trailing stop
        ]

        config = GraduatedSLTP(
            symbol=symbol,
            entry_price=entry_price,
            direction=direction,
            stop_loss_price=stop_loss_price,
            atr_value=atr or 0.0,
            atr_multiplier=mult,
            trailing_stop_distance_pct=trailing_dist,
            highest_price_since_entry=entry_price,
            lowest_price_since_entry=entry_price,
            tiers=tiers,
        )

        self._positions[symbol] = config

        sl_pct = abs(stop_loss_price - entry_price) / entry_price * 100
        logger.info(
            f"Graduated SL/TP for {symbol} ({direction}): "
            f"SL={stop_loss_price:.2f} ({sl_pct:.1f}%), "
            f"TP1={tier1_target*100:.1f}%, TP2={tier2_target*100:.1f}%, "
            f"Trailing={trailing_dist*100:.1f}%"
        )

        return config

    def check_price(
        self,
        symbol: str,
        current_price: float,
    ) -> Dict:
        """
        Check current price against graduated SL/TP levels.

        Args:
            symbol: Trading symbol
            current_price: Current market price

        Returns:
            Dict with action recommendations:
            {
                'action': 'none' | 'stop_loss' | 'take_profit_tier' | 'trailing_stop',
                'close_pct': float,  # Percentage of position to close
                'tier': int,         # Which tier triggered (1, 2, 3)
                'reason': str
            }
        """
        if symbol not in self._positions:
            return {'action': 'none', 'close_pct': 0, 'tier': 0, 'reason': 'No position config'}

        config = self._positions[symbol]

        # Update high/low tracking
        if current_price > config.highest_price_since_entry:
            config.highest_price_since_entry = current_price
        if current_price < config.lowest_price_since_entry:
            config.lowest_price_since_entry = current_price

        # Calculate current move percentage
        if config.direction == 'long':
            move_pct = (current_price - config.entry_price) / config.entry_price
        else:
            move_pct = (config.entry_price - current_price) / config.entry_price

        # 1. Check stop-loss first
        if config.direction == 'long' and current_price <= config.stop_loss_price:
            self.remove_position(symbol)
            return {
                'action': 'stop_loss',
                'close_pct': 1.0,
                'tier': 0,
                'reason': f"Stop-loss hit at {config.stop_loss_price:.2f} (ATR-based)"
            }
        elif config.direction == 'short' and current_price >= config.stop_loss_price:
            self.remove_position(symbol)
            return {
                'action': 'stop_loss',
                'close_pct': 1.0,
                'tier': 0,
                'reason': f"Stop-loss hit at {config.stop_loss_price:.2f} (ATR-based)"
            }

        # 2. Check trailing stop (for tier 3 / remaining position)
        if config.trailing_stop_active:
            if config.direction == 'long':
                config.trailing_stop_price = config.highest_price_since_entry * (1 - config.trailing_stop_distance_pct)
                if current_price <= config.trailing_stop_price:
                    self.remove_position(symbol)
                    return {
                        'action': 'trailing_stop',
                        'close_pct': config.remaining_position_pct,
                        'tier': 3,
                        'reason': f"Trailing stop hit at {config.trailing_stop_price:.2f}"
                    }
            else:
                config.trailing_stop_price = config.lowest_price_since_entry * (1 + config.trailing_stop_distance_pct)
                if current_price >= config.trailing_stop_price:
                    self.remove_position(symbol)
                    return {
                        'action': 'trailing_stop',
                        'close_pct': config.remaining_position_pct,
                        'tier': 3,
                        'reason': f"Trailing stop hit at {config.trailing_stop_price:.2f}"
                    }

        # 3. Check take-profit tiers (only in profit direction)
        if move_pct > 0:
            for i, tier in enumerate(config.tiers):
                if not tier.triggered and move_pct >= tier.target_pct:
                    tier.triggered = True
                    tier.triggered_at = current_price
                    tier.triggered_time = datetime.now()

                    # Reduce remaining position
                    close_pct = tier.percentage_to_close * config.remaining_position_pct
                    config.remaining_position_pct -= close_pct

                    # Activate trailing stop after last fixed tier
                    if i == len(config.tiers) - 1:
                        config.trailing_stop_active = True
                        # Move stop to break-even after tier 2
                        config.stop_loss_price = config.entry_price
                    elif i == 0:
                        # After tier 1: move stop to reduce loss
                        if config.direction == 'long':
                            # Move stop up to halfway between entry and current
                            new_sl = config.entry_price + (current_price - config.entry_price) * 0.3
                            config.stop_loss_price = max(config.stop_loss_price, new_sl)
                        else:
                            new_sl = config.entry_price - (config.entry_price - current_price) * 0.3
                            config.stop_loss_price = min(config.stop_loss_price, new_sl)

                    return {
                        'action': 'take_profit_tier',
                        'close_pct': close_pct,
                        'tier': i + 1,
                        'reason': f"Take-profit tier {i+1} hit at {move_pct*100:.1f}% move"
                    }

        return {'action': 'none', 'close_pct': 0, 'tier': 0, 'reason': 'No action needed'}

    def remove_position(self, symbol: str):
        """Remove position tracking"""
        self._positions.pop(symbol, None)

    def get_position_config(self, symbol: str) -> Optional[GraduatedSLTP]:
        """Get current position config"""
        return self._positions.get(symbol)

    def get_all_positions(self) -> Dict[str, GraduatedSLTP]:
        """Get all active position configs"""
        return dict(self._positions)


def calculate_dynamic_atr_stop(
    prices: list,
    entry_price: float,
    direction: str = 'long',
    atr_period: int = 14,
    atr_multiplier: float = 2.0,
) -> Tuple[float, float]:
    """
    Calculate ATR-based stop-loss level.

    Args:
        prices: List of dicts with 'high', 'low', 'close' keys
        entry_price: Entry price of position
        direction: 'long' or 'short'
        atr_period: ATR lookback period
        atr_multiplier: Multiplier for ATR distance

    Returns:
        Tuple of (stop_loss_price, atr_value)
    """
    if not prices or len(prices) < atr_period + 1:
        # Fallback: 5% fixed stop
        if direction == 'long':
            return entry_price * 0.95, 0.0
        return entry_price * 1.05, 0.0

    # Calculate ATR
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

    if len(true_ranges) < atr_period:
        if direction == 'long':
            return entry_price * 0.95, 0.0
        return entry_price * 1.05, 0.0

    atr = sum(true_ranges[-atr_period:]) / atr_period
    sl_distance = atr * atr_multiplier

    # Clamp: min 0.5%, max 15%
    sl_distance = max(entry_price * 0.005, min(sl_distance, entry_price * 0.15))

    if direction == 'long':
        stop_loss = entry_price - sl_distance
    else:
        stop_loss = entry_price + sl_distance

    return stop_loss, atr
