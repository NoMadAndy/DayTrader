"""
Yahoo Finance Options Chain Provider

Fetches real US options data (calls + puts) for a given symbol.
Uses yfinance for reliable access to Yahoo Finance data.

Returns standardized option chain format compatible with the
OptionChainPanel frontend component.
"""

import logging
import math
from dataclasses import dataclass, asdict
from typing import Optional
from datetime import datetime, date

logger = logging.getLogger(__name__)


def _safe_float(val, default: float = 0.0) -> float:
    """Safely convert a value to float, handling NaN/None."""
    if val is None:
        return default
    try:
        f = float(val)
        return default if math.isnan(f) or math.isinf(f) else f
    except (ValueError, TypeError):
        return default


def _safe_int(val, default: int = 0) -> int:
    """Safely convert a value to int, handling NaN/None."""
    if val is None:
        return default
    try:
        f = float(val)
        return default if math.isnan(f) or math.isinf(f) else int(f)
    except (ValueError, TypeError):
        return default


@dataclass
class RealOptionEntry:
    """Standardized option entry from real market data."""
    strike: float
    days: int
    optionType: str          # 'call' or 'put'
    expiryDate: str          # ISO date (YYYY-MM-DD)
    # Prices
    lastPrice: float
    bid: float
    ask: float
    # Market data
    volume: int
    openInterest: int
    impliedVolatility: float
    # Classification
    moneyness: str           # 'ITM', 'ATM', 'OTM'
    inTheMoney: bool
    # Identifier
    contractSymbol: str
    # Source
    source: str = 'yahoo'


def _classify_moneyness(strike: float, underlying: float, option_type: str) -> str:
    """Classify option as ITM/ATM/OTM."""
    ratio = strike / underlying if underlying > 0 else 1.0
    if option_type == 'call':
        if ratio < 0.98:
            return 'ITM'
        elif ratio > 1.02:
            return 'OTM'
        return 'ATM'
    else:  # put
        if ratio > 1.02:
            return 'ITM'
        elif ratio < 0.98:
            return 'OTM'
        return 'ATM'


async def fetch_yahoo_options(symbol: str, underlying_price: float = 0) -> Optional[dict]:
    """
    Fetch real options chain from Yahoo Finance.
    
    Returns dict with:
      - success: bool
      - source: 'yahoo'
      - underlying_price: float
      - expiry_dates: list[str]
      - calls: list[RealOptionEntry as dict]
      - puts: list[RealOptionEntry as dict]
      - strikes: list[float] (sorted unique)
      - expiry_days: list[int] (sorted unique)
    
    Returns None if yfinance is not available or symbol has no options.
    """
    try:
        import yfinance as yf
    except ImportError:
        logger.warning("yfinance not installed — Yahoo options unavailable")
        return None

    try:
        ticker = yf.Ticker(symbol)
        
        # Check if options are available
        try:
            expiry_dates = ticker.options
        except Exception:
            logger.info(f"No options available for {symbol} on Yahoo Finance")
            return None
        
        if not expiry_dates or len(expiry_dates) == 0:
            logger.info(f"No expiry dates found for {symbol}")
            return None
        
        # Get underlying price if not provided
        if underlying_price <= 0:
            try:
                info = ticker.fast_info
                underlying_price = getattr(info, 'last_price', 0) or getattr(info, 'previous_close', 0) or 0
            except Exception:
                pass
        
        # Limit to first 6 expiry dates to avoid excessive API calls
        selected_expiries = list(expiry_dates[:6])
        
        today = date.today()
        all_calls = []
        all_puts = []
        all_strikes = set()
        all_expiry_days = set()
        
        for expiry_str in selected_expiries:
            try:
                chain = ticker.option_chain(expiry_str)
            except Exception as e:
                logger.warning(f"Failed to fetch chain for {symbol} {expiry_str}: {e}")
                continue
            
            expiry_date = datetime.strptime(expiry_str, '%Y-%m-%d').date()
            days_to_expiry = max(0, (expiry_date - today).days)
            all_expiry_days.add(days_to_expiry)
            
            # Process calls
            if chain.calls is not None and len(chain.calls) > 0:
                for _, row in chain.calls.iterrows():
                    strike = _safe_float(row.get('strike', 0))
                    if strike <= 0:
                        continue
                    all_strikes.add(strike)
                    
                    iv = _safe_float(row.get('impliedVolatility', 0))
                    last = _safe_float(row.get('lastPrice', 0))
                    bid = _safe_float(row.get('bid', 0))
                    ask = _safe_float(row.get('ask', 0))
                    vol = _safe_int(row.get('volume', 0))
                    oi = _safe_int(row.get('openInterest', 0))
                    itm = bool(row.get('inTheMoney', False))
                    contract = str(row.get('contractSymbol', ''))
                    
                    moneyness = _classify_moneyness(strike, underlying_price, 'call')
                    
                    all_calls.append(asdict(RealOptionEntry(
                        strike=strike,
                        days=days_to_expiry,
                        optionType='call',
                        expiryDate=expiry_str,
                        lastPrice=round(last, 4),
                        bid=round(bid, 4),
                        ask=round(ask, 4),
                        volume=vol,
                        openInterest=oi,
                        impliedVolatility=round(iv, 4),
                        moneyness=moneyness,
                        inTheMoney=itm,
                        contractSymbol=contract,
                        source='yahoo',
                    )))
            
            # Process puts
            if chain.puts is not None and len(chain.puts) > 0:
                for _, row in chain.puts.iterrows():
                    strike = _safe_float(row.get('strike', 0))
                    if strike <= 0:
                        continue
                    all_strikes.add(strike)
                    
                    iv = _safe_float(row.get('impliedVolatility', 0))
                    last = _safe_float(row.get('lastPrice', 0))
                    bid = _safe_float(row.get('bid', 0))
                    ask = _safe_float(row.get('ask', 0))
                    vol = _safe_int(row.get('volume', 0))
                    oi = _safe_int(row.get('openInterest', 0))
                    itm = bool(row.get('inTheMoney', False))
                    contract = str(row.get('contractSymbol', ''))
                    
                    moneyness = _classify_moneyness(strike, underlying_price, 'put')
                    
                    all_puts.append(asdict(RealOptionEntry(
                        strike=strike,
                        days=days_to_expiry,
                        optionType='put',
                        expiryDate=expiry_str,
                        lastPrice=round(last, 4),
                        bid=round(bid, 4),
                        ask=round(ask, 4),
                        volume=vol,
                        openInterest=oi,
                        impliedVolatility=round(iv, 4),
                        moneyness=moneyness,
                        inTheMoney=itm,
                        contractSymbol=contract,
                        source='yahoo',
                    )))
        
        if not all_calls and not all_puts:
            logger.info(f"No option entries found for {symbol}")
            return None
        
        sorted_strikes = sorted(all_strikes)
        sorted_expiry_days = sorted(all_expiry_days)
        
        logger.info(f"Yahoo options for {symbol}: {len(all_calls)} calls, {len(all_puts)} puts, "
                     f"{len(sorted_strikes)} strikes, {len(sorted_expiry_days)} expiries")
        
        return {
            "success": True,
            "source": "yahoo",
            "symbol": symbol,
            "underlying_price": underlying_price,
            "expiry_dates": selected_expiries,
            "strikes": sorted_strikes,
            "expiry_days": sorted_expiry_days,
            "calls": all_calls,
            "puts": all_puts,
        }
    
    except Exception as e:
        logger.error(f"Yahoo options error for {symbol}: {e}")
        return None
