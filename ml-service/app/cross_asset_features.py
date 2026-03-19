"""
Cross-Asset Feature Provider

Fetches market-wide and sector data to enrich LSTM/Transformer feature sets.
All fetching is optional — if it fails, models continue with the original 23 features.

Data sources (via yfinance, already in requirements.txt):
  - ^GSPC  : S&P 500 returns (market beta proxy)
  - ^VIX   : Fear/volatility index
  - ^TNX   : US 10-Year Treasury yield (macro)
  - DX-Y.NYB : US Dollar Index return
  - Sector ETFs: XLK, XLF, XLE, XLV, XLY, XLP, XLI, EWG (mapped per symbol)
"""

import logging
import time
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Symbol → Sector ETF mapping
# ---------------------------------------------------------------------------
SECTOR_ETF_MAP: Dict[str, str] = {
    # Technology
    "AAPL": "XLK", "MSFT": "XLK", "GOOG": "XLK", "GOOGL": "XLK", "META": "XLK",
    "NVDA": "XLK", "AMD": "XLK", "INTC": "XLK", "CRM": "XLK", "ADBE": "XLK",
    # Financials
    "JPM": "XLF", "BAC": "XLF", "GS": "XLF", "MS": "XLF", "WFC": "XLF",
    # Healthcare
    "JNJ": "XLV", "UNH": "XLV", "PFE": "XLV", "ABBV": "XLV", "MRK": "XLV",
    # Energy
    "XOM": "XLE", "CVX": "XLE", "COP": "XLE",
    # Consumer Discretionary
    "AMZN": "XLY", "TSLA": "XLY", "NKE": "XLY", "MCD": "XLY",
    # Consumer Staples
    "KO": "XLP", "PG": "XLP", "WMT": "XLP", "COST": "XLP",
    # Industrials
    "BA": "XLI", "CAT": "XLI", "GE": "XLI",
    # German stocks (use Germany ETF as proxy)
    "SAP.DE": "EWG", "SIE.DE": "EWG", "ALV.DE": "EWG", "BAS.DE": "EWG",
}
DEFAULT_SECTOR_ETF = "SPY"

# Tickers to always fetch (market-wide)
_MARKET_TICKERS = ["^GSPC", "^VIX", "^TNX", "DX-Y.NYB"]


class CrossAssetFeatureProvider:
    """
    Fetches cross-asset market data aligned to a target stock's date index.

    Features returned:
      - sp500_return      : S&P 500 daily % return
      - vix_level         : VIX normalised to [0, 1] by dividing by 100
      - us10y_yield       : 10Y Treasury yield as decimal (e.g. 0.045)
      - usd_index_return  : Dollar Index daily % return
      - sector_etf_return : Sector ETF daily % return

    All fetching is TTL-cached in memory (default: 1 hour).
    """

    def __init__(self, cache_ttl_seconds: int = 3600) -> None:
        self.cache_ttl_seconds = cache_ttl_seconds
        # cache: ticker → (fetch_time, DataFrame with 'Close' column)
        self._cache: Dict[str, Tuple[float, pd.DataFrame]] = {}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _is_cached(self, ticker: str) -> bool:
        if ticker not in self._cache:
            return False
        fetch_time, _ = self._cache[ticker]
        return (time.time() - fetch_time) < self.cache_ttl_seconds

    def _fetch_ticker(self, ticker: str, start: str, end: str) -> Optional[pd.DataFrame]:
        """Download close prices for *ticker*, returning a single-column DataFrame."""
        if self._is_cached(ticker):
            _, df = self._cache[ticker]
            return df

        try:
            raw = yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
            if raw.empty:
                logger.warning(f"CrossAssetFeatureProvider: no data for {ticker}")
                return None

            # yfinance ≥0.2 may return MultiIndex columns
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = raw.columns.droplevel(1)

            df = raw[["Close"]].copy()
            df.index = pd.to_datetime(df.index)
            self._cache[ticker] = (time.time(), df)
            return df
        except Exception as exc:
            logger.warning(f"CrossAssetFeatureProvider: failed to fetch {ticker}: {exc}")
            return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_cross_asset_features(
        self,
        symbol: str,
        dates: pd.DatetimeIndex,
    ) -> Optional[pd.DataFrame]:
        """
        Return a DataFrame of cross-asset features aligned to *dates*.

        Columns:
          sp500_return, vix_level, us10y_yield,
          usd_index_return, sector_etf_return

        Returns None if fetching fails entirely.
        """
        if dates is None or len(dates) == 0:
            return None

        # Determine date range for fetching (with a small buffer)
        start_date = (dates.min() - pd.Timedelta(days=10)).strftime("%Y-%m-%d")
        end_date = (dates.max() + pd.Timedelta(days=2)).strftime("%Y-%m-%d")

        sector_etf = SECTOR_ETF_MAP.get(symbol.upper(), DEFAULT_SECTOR_ETF)
        all_tickers = _MARKET_TICKERS + [sector_etf]

        frames: Dict[str, Optional[pd.DataFrame]] = {}
        for ticker in all_tickers:
            frames[ticker] = self._fetch_ticker(ticker, start_date, end_date)

        # If all fetches failed, bail out
        if all(v is None for v in frames.values()):
            logger.warning(f"CrossAssetFeatureProvider: all fetches failed for {symbol}")
            return None

        # Build feature frame
        result = pd.DataFrame(index=dates)
        result.index = pd.to_datetime(result.index).normalize()

        # S&P 500 daily return
        sp500 = frames.get("^GSPC")
        if sp500 is not None:
            sp500 = sp500.copy()
            sp500.index = pd.to_datetime(sp500.index).normalize()
            sp500_return = sp500["Close"].pct_change()
            result["sp500_return"] = sp500_return.reindex(result.index)
        else:
            result["sp500_return"] = 0.0

        # VIX level (normalised)
        vix = frames.get("^VIX")
        if vix is not None:
            vix = vix.copy()
            vix.index = pd.to_datetime(vix.index).normalize()
            result["vix_level"] = (vix["Close"] / 100.0).reindex(result.index)
        else:
            result["vix_level"] = 0.0

        # US 10Y yield (^TNX is quoted in percentage, e.g. 4.5 → 0.045)
        tnx = frames.get("^TNX")
        if tnx is not None:
            tnx = tnx.copy()
            tnx.index = pd.to_datetime(tnx.index).normalize()
            result["us10y_yield"] = (tnx["Close"] / 100.0).reindex(result.index)
        else:
            result["us10y_yield"] = 0.0

        # USD Index daily return
        usd = frames.get("DX-Y.NYB")
        if usd is not None:
            usd = usd.copy()
            usd.index = pd.to_datetime(usd.index).normalize()
            usd_return = usd["Close"].pct_change()
            result["usd_index_return"] = usd_return.reindex(result.index)
        else:
            result["usd_index_return"] = 0.0

        # Sector ETF daily return
        sector = frames.get(sector_etf)
        if sector is not None:
            sector = sector.copy()
            sector.index = pd.to_datetime(sector.index).normalize()
            sector_return = sector["Close"].pct_change()
            result["sector_etf_return"] = sector_return.reindex(result.index)
        else:
            result["sector_etf_return"] = 0.0

        # Handle missing values: forward-fill, then backward-fill, then 0
        result = result.ffill().bfill().fillna(0.0)

        logger.info(
            f"CrossAssetFeatureProvider: fetched {len(result.columns)} cross-asset "
            f"features for {symbol} ({len(result)} rows)"
        )
        return result
