"""
Position Correlation Filter

Prevents concentration risk by:
- Calculating correlation between held positions
- Counting highly correlated positions as one effective position
- Tracking sector exposure
- Limiting exposure to correlated assets
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import numpy as np
import logging

logger = logging.getLogger(__name__)


# Sector mapping for common stocks
SECTOR_MAP = {
    # Technology
    'AAPL': 'technology', 'MSFT': 'technology', 'GOOGL': 'technology',
    'GOOG': 'technology', 'META': 'technology', 'AMZN': 'technology',
    'NVDA': 'technology', 'AMD': 'technology', 'INTC': 'technology',
    'CRM': 'technology', 'ORCL': 'technology', 'ADBE': 'technology',
    'CSCO': 'technology', 'IBM': 'technology', 'QCOM': 'technology',
    'TXN': 'technology', 'AVGO': 'technology', 'NOW': 'technology',
    'SHOP': 'technology', 'SQ': 'technology', 'PYPL': 'technology',
    'NFLX': 'technology',

    # Financial
    'JPM': 'financial', 'BAC': 'financial', 'GS': 'financial',
    'MS': 'financial', 'WFC': 'financial', 'C': 'financial',
    'V': 'financial', 'MA': 'financial', 'AXP': 'financial',
    'BRK.B': 'financial', 'SCHW': 'financial',

    # Healthcare
    'JNJ': 'healthcare', 'UNH': 'healthcare', 'PFE': 'healthcare',
    'ABBV': 'healthcare', 'MRK': 'healthcare', 'LLY': 'healthcare',
    'TMO': 'healthcare', 'ABT': 'healthcare', 'BMY': 'healthcare',
    'AMGN': 'healthcare', 'GILD': 'healthcare', 'MDT': 'healthcare',
    'MRNA': 'healthcare', 'BNTX': 'healthcare',

    # Consumer
    'TSLA': 'consumer', 'NKE': 'consumer', 'SBUX': 'consumer',
    'MCD': 'consumer', 'HD': 'consumer', 'LOW': 'consumer',
    'TGT': 'consumer', 'WMT': 'consumer', 'COST': 'consumer',
    'PG': 'consumer', 'KO': 'consumer', 'PEP': 'consumer',
    'DIS': 'consumer',

    # Energy
    'XOM': 'energy', 'CVX': 'energy', 'COP': 'energy',
    'SLB': 'energy', 'EOG': 'energy', 'OXY': 'energy',

    # Industrial
    'BA': 'industrial', 'CAT': 'industrial', 'GE': 'industrial',
    'HON': 'industrial', 'UPS': 'industrial', 'LMT': 'industrial',
    'RTX': 'industrial', 'DE': 'industrial',

    # Real Estate
    'AMT': 'real_estate', 'PLD': 'real_estate', 'SPG': 'real_estate',

    # Utilities
    'NEE': 'utilities', 'DUK': 'utilities', 'SO': 'utilities',

    # Communication
    'T': 'communication', 'VZ': 'communication', 'TMUS': 'communication',

    # Materials
    'LIN': 'materials', 'APD': 'materials', 'FCX': 'materials',
    'NEM': 'materials',
}


@dataclass
class CorrelationCheckResult:
    """Result of correlation filter check"""
    allowed: bool
    reason: str
    correlation_score: float = 0.0
    same_sector_count: int = 0
    sector_exposure_pct: float = 0.0
    effective_positions: int = 0
    details: Dict = None

    def __post_init__(self):
        if self.details is None:
            self.details = {}


class CorrelationFilter:
    """
    Filters trades to prevent concentration risk from correlated positions.

    Features:
    - Sector-based correlation detection
    - Price correlation analysis (when history available)
    - Effective position counting (highly correlated = 1 position)
    - Sector exposure limits
    """

    def __init__(
        self,
        max_same_sector_positions: int = 3,
        max_sector_exposure_pct: float = 0.40,
        correlation_threshold: float = 0.70,
        max_effective_positions: int = 10,
    ):
        self.max_same_sector_positions = max_same_sector_positions
        self.max_sector_exposure_pct = max_sector_exposure_pct
        self.correlation_threshold = correlation_threshold
        self.max_effective_positions = max_effective_positions

        # Price history cache for correlation calculation
        self._price_histories: Dict[str, List[float]] = {}

    def check_new_position(
        self,
        symbol: str,
        position_value: float,
        current_positions: Dict[str, Dict],
        portfolio_value: float,
    ) -> CorrelationCheckResult:
        """
        Check if adding a new position would create excessive correlation risk.

        Args:
            symbol: Symbol to add
            position_value: Value of new position
            current_positions: Current portfolio positions {symbol: {value, quantity, ...}}
            portfolio_value: Total portfolio value

        Returns:
            CorrelationCheckResult
        """
        if not current_positions:
            return CorrelationCheckResult(
                allowed=True,
                reason="First position, no correlation risk",
                effective_positions=1,
            )

        new_sector = SECTOR_MAP.get(symbol, 'unknown')

        # 1. Check sector concentration
        sector_counts: Dict[str, int] = {}
        sector_values: Dict[str, float] = {}

        for pos_symbol, pos_data in current_positions.items():
            sector = SECTOR_MAP.get(pos_symbol, 'unknown')
            sector_counts[sector] = sector_counts.get(sector, 0) + 1
            pos_val = pos_data.get('value', 0) or pos_data.get('market_value', 0) or 0
            sector_values[sector] = sector_values.get(sector, 0) + abs(pos_val)

        same_sector_count = sector_counts.get(new_sector, 0)

        if same_sector_count >= self.max_same_sector_positions:
            return CorrelationCheckResult(
                allowed=False,
                reason=f"Max {self.max_same_sector_positions} positions in {new_sector} sector reached ({same_sector_count} existing)",
                same_sector_count=same_sector_count,
                details={'sector': new_sector, 'sector_counts': sector_counts}
            )

        # 2. Check sector exposure percentage
        new_sector_value = sector_values.get(new_sector, 0) + position_value
        if portfolio_value > 0:
            sector_exposure = new_sector_value / portfolio_value
            if sector_exposure > self.max_sector_exposure_pct:
                return CorrelationCheckResult(
                    allowed=False,
                    reason=f"Sector {new_sector} exposure would be {sector_exposure*100:.1f}% (max {self.max_sector_exposure_pct*100:.0f}%)",
                    sector_exposure_pct=sector_exposure,
                    same_sector_count=same_sector_count,
                    details={'sector': new_sector, 'sector_values': sector_values}
                )

        # 3. Calculate effective positions (correlated positions count as fewer)
        effective_positions = self._calculate_effective_positions(
            symbol, current_positions
        )

        if effective_positions >= self.max_effective_positions:
            return CorrelationCheckResult(
                allowed=False,
                reason=f"Effective positions ({effective_positions}) would exceed limit ({self.max_effective_positions})",
                effective_positions=effective_positions,
                same_sector_count=same_sector_count,
            )

        # 4. Check price correlation (if history available)
        correlation_score = self._calculate_correlation(symbol, current_positions)

        return CorrelationCheckResult(
            allowed=True,
            reason="Position passes correlation checks",
            correlation_score=correlation_score,
            same_sector_count=same_sector_count,
            sector_exposure_pct=new_sector_value / portfolio_value if portfolio_value > 0 else 0,
            effective_positions=effective_positions,
            details={
                'sector': new_sector,
                'sector_counts': sector_counts,
                'correlation_with_portfolio': correlation_score,
            }
        )

    def _calculate_effective_positions(
        self,
        new_symbol: str,
        current_positions: Dict[str, Dict],
    ) -> int:
        """
        Calculate effective number of positions considering correlation.
        Highly correlated positions count as fewer effective positions.
        """
        symbols = list(current_positions.keys()) + [new_symbol]
        sectors = [SECTOR_MAP.get(s, 'unknown') for s in symbols]

        # Group by sector
        sector_groups: Dict[str, List[str]] = {}
        for s, sec in zip(symbols, sectors):
            if sec not in sector_groups:
                sector_groups[sec] = []
            sector_groups[sec].append(s)

        effective = 0
        for sector, group in sector_groups.items():
            if len(group) == 1:
                effective += 1
            else:
                # Correlated positions in same sector count as sqrt(n)
                # e.g., 4 tech stocks = 2 effective positions
                effective += np.sqrt(len(group))

        return int(np.ceil(effective))

    def _calculate_correlation(
        self,
        new_symbol: str,
        current_positions: Dict[str, Dict],
    ) -> float:
        """
        Calculate average correlation of new symbol with existing positions.
        Uses sector-based proxy if price history not available.
        """
        if not current_positions:
            return 0.0

        new_sector = SECTOR_MAP.get(new_symbol, 'unknown')
        correlations = []

        for pos_symbol in current_positions:
            pos_sector = SECTOR_MAP.get(pos_symbol, 'unknown')

            # Use price history if available
            if new_symbol in self._price_histories and pos_symbol in self._price_histories:
                new_prices = self._price_histories[new_symbol]
                pos_prices = self._price_histories[pos_symbol]
                min_len = min(len(new_prices), len(pos_prices))
                if min_len >= 20:
                    corr = np.corrcoef(new_prices[-min_len:], pos_prices[-min_len:])[0, 1]
                    correlations.append(abs(corr))
                    continue

            # Sector-based proxy correlation
            if new_sector == pos_sector:
                correlations.append(0.7)  # Same sector: assume ~70% correlation
            elif (new_sector in ('technology', 'communication') and
                  pos_sector in ('technology', 'communication')):
                correlations.append(0.5)  # Related sectors
            else:
                correlations.append(0.2)  # Different sectors: assume ~20%

        return float(np.mean(correlations)) if correlations else 0.0

    def update_price_history(self, symbol: str, prices: List[float]):
        """Update price history for a symbol (for correlation calculation)"""
        self._price_histories[symbol] = prices[-200:]  # Keep last 200 prices

    def get_sector(self, symbol: str) -> str:
        """Get sector for a symbol"""
        return SECTOR_MAP.get(symbol, 'unknown')

    def get_sector_exposure(self, positions: Dict[str, Dict], portfolio_value: float) -> Dict[str, float]:
        """Get current sector exposure breakdown"""
        sector_values: Dict[str, float] = {}

        for symbol, pos_data in positions.items():
            sector = SECTOR_MAP.get(symbol, 'unknown')
            pos_val = pos_data.get('value', 0) or pos_data.get('market_value', 0) or 0
            sector_values[sector] = sector_values.get(sector, 0) + abs(pos_val)

        if portfolio_value <= 0:
            return sector_values

        return {sector: val / portfolio_value for sector, val in sector_values.items()}
