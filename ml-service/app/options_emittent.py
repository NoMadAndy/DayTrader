"""
Emittenten-API Options/Warrants Provider

Fetches German warrants (Optionsscheine) from emittent APIs.
Primary source: Société Générale (sg-zertifikate.de)
Fallback: Other emittent APIs can be added modularly.

Returns standardized option entries compatible with the
OptionChainPanel frontend component.
"""

import logging
import httpx
from dataclasses import dataclass, asdict
from typing import Optional
from datetime import datetime, date

logger = logging.getLogger(__name__)

# SocGen product search API
SOCGEN_API_BASE = "https://www.sg-zertifikate.de/EmcWebApi/api/v1"
SOCGEN_SEARCH_URL = f"{SOCGEN_API_BASE}/search/derivatives"
SOCGEN_PRODUCT_SEARCH_URL = "https://www.sg-zertifikate.de/EmcWebApi/api/v2/product-search/search"

# Request timeout
REQUEST_TIMEOUT = 15.0


@dataclass
class EmittentWarrantEntry:
    """Standardized warrant entry from emittent data."""
    strike: float
    days: int
    optionType: str          # 'call' or 'put'
    expiryDate: str          # ISO date (YYYY-MM-DD)
    # Prices
    lastPrice: float
    bid: float
    ask: float
    spread: float            # bid-ask spread
    # Market identifiers
    wkn: str
    isin: str
    emittent: str
    productName: str
    # Warrant-specific
    ratio: float             # Bezugsverhältnis (e.g. 0.1 = 10:1)
    # Classification
    moneyness: str           # 'ITM', 'ATM', 'OTM'
    inTheMoney: bool
    # Source
    source: str = 'emittent'
    # Optional — not always available from emittent
    impliedVolatility: float = 0.0
    volume: int = 0
    openInterest: int = 0


def _classify_moneyness(strike: float, underlying: float, option_type: str) -> str:
    """Classify option as ITM/ATM/OTM."""
    if underlying <= 0:
        return 'ATM'
    ratio = strike / underlying
    if option_type == 'call':
        if ratio < 0.98:
            return 'ITM'
        elif ratio > 1.02:
            return 'OTM'
        return 'ATM'
    else:
        if ratio > 1.02:
            return 'ITM'
        elif ratio < 0.98:
            return 'OTM'
        return 'ATM'


async def _fetch_socgen_warrants(
    symbol: str,
    underlying_price: float,
    option_type: Optional[str] = None,
) -> Optional[list]:
    """
    Fetch warrants from Société Générale product search API.
    
    The SocGen API accepts underlying names/ISINs and returns
    matching structured products including Optionsscheine.
    """
    try:
        # SocGen V2 product search
        params = {
            "underlying": symbol,
            "productCategory": "Optionsschein",
            "issuers": "SG",
            "pageSize": 100,
            "sortField": "strike",
            "sortDirection": "asc",
        }
        
        if option_type:
            params["optionType"] = "Call" if option_type == 'call' else "Put"
        
        headers = {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; DayTrader/1.0)",
        }
        
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.get(
                SOCGEN_PRODUCT_SEARCH_URL,
                params=params,
                headers=headers,
            )
            
            if response.status_code != 200:
                logger.warning(f"SocGen API returned {response.status_code} for {symbol}")
                return None
            
            data = response.json()
        
        # Parse response — structure varies, handle common patterns
        products = data.get("products", data.get("results", data.get("data", [])))
        if not products:
            logger.info(f"No SocGen warrants found for {symbol}")
            return None
        
        today = date.today()
        entries = []
        
        for product in products:
            try:
                # Extract fields — field names vary by API version
                strike = float(product.get("strike", product.get("basispreis", 0)))
                if strike <= 0:
                    continue
                
                wkn = str(product.get("wkn", product.get("WKN", "")))
                isin = str(product.get("isin", product.get("ISIN", "")))
                name = str(product.get("name", product.get("productName", "")))
                
                # Option type
                otype_raw = str(product.get("optionType", product.get("typ", "call"))).lower()
                otype = "call" if "call" in otype_raw else "put"
                
                # Expiry
                expiry_raw = product.get("maturity", product.get("laufzeit", product.get("expiryDate", "")))
                if isinstance(expiry_raw, str) and expiry_raw:
                    try:
                        # Try ISO format first
                        expiry_date = datetime.fromisoformat(expiry_raw.replace("Z", "+00:00")).date()
                    except ValueError:
                        try:
                            expiry_date = datetime.strptime(expiry_raw[:10], "%Y-%m-%d").date()
                        except ValueError:
                            try:
                                expiry_date = datetime.strptime(expiry_raw[:10], "%d.%m.%Y").date()
                            except ValueError:
                                continue
                else:
                    continue
                
                days_to_expiry = max(0, (expiry_date - today).days)
                if days_to_expiry == 0:
                    continue  # Skip expired warrants
                
                # Prices
                bid = float(product.get("bid", product.get("geld", 0)) or 0)
                ask = float(product.get("ask", product.get("brief", 0)) or 0)
                last = float(product.get("lastPrice", product.get("kurs", 0)) or 0)
                if last <= 0:
                    last = (bid + ask) / 2 if bid > 0 and ask > 0 else bid or ask
                
                # Ratio (Bezugsverhältnis)
                ratio_raw = product.get("ratio", product.get("bezugsverhaeltnis", 1))
                ratio = float(ratio_raw) if ratio_raw else 1.0
                if ratio > 1:
                    ratio = 1.0 / ratio  # Normalize: 10:1 → 0.1
                
                spread = round(ask - bid, 4) if ask > 0 and bid > 0 else 0.0
                moneyness = _classify_moneyness(strike, underlying_price, otype)
                itm = moneyness == 'ITM'
                
                # IV if available
                iv = float(product.get("impliedVolatility", product.get("iv", 0)) or 0)
                
                entries.append(asdict(EmittentWarrantEntry(
                    strike=round(strike, 2),
                    days=days_to_expiry,
                    optionType=otype,
                    expiryDate=expiry_date.isoformat(),
                    lastPrice=round(last, 4),
                    bid=round(bid, 4),
                    ask=round(ask, 4),
                    spread=round(spread, 4),
                    wkn=wkn,
                    isin=isin,
                    emittent="Société Générale",
                    productName=name,
                    ratio=ratio,
                    moneyness=moneyness,
                    inTheMoney=itm,
                    impliedVolatility=round(iv, 4),
                    source='emittent',
                )))
            except Exception as e:
                logger.debug(f"Skipping SocGen product: {e}")
                continue
        
        return entries if entries else None
    
    except httpx.TimeoutException:
        logger.warning(f"SocGen API timeout for {symbol}")
        return None
    except httpx.ConnectError:
        logger.warning(f"SocGen API connection error for {symbol}")
        return None
    except Exception as e:
        logger.error(f"SocGen API error for {symbol}: {e}")
        return None


async def fetch_emittent_warrants(
    symbol: str,
    underlying_price: float = 0,
    option_type: Optional[str] = None,
) -> Optional[dict]:
    """
    Fetch warrants from emittent APIs (currently: Société Générale).
    
    Returns dict with:
      - success: bool
      - source: 'emittent'
      - symbol: str
      - underlying_price: float
      - emittent: str
      - calls: list[EmittentWarrantEntry as dict]
      - puts: list[EmittentWarrantEntry as dict]
      - strikes: list[float] (sorted unique)
      - expiry_days: list[int] (sorted unique)
    
    Returns None if no warrants found.
    """
    entries = await _fetch_socgen_warrants(symbol, underlying_price, option_type)
    
    if not entries:
        return None
    
    calls = [e for e in entries if e['optionType'] == 'call']
    puts = [e for e in entries if e['optionType'] == 'put']
    
    all_strikes = sorted(set(e['strike'] for e in entries))
    all_expiry_days = sorted(set(e['days'] for e in entries))
    
    logger.info(f"Emittent warrants for {symbol}: {len(calls)} calls, {len(puts)} puts, "
                f"{len(all_strikes)} strikes, {len(all_expiry_days)} expiries")
    
    return {
        "success": True,
        "source": "emittent",
        "symbol": symbol,
        "underlying_price": underlying_price,
        "emittent": "Société Générale",
        "strikes": all_strikes,
        "expiry_days": all_expiry_days,
        "calls": calls,
        "puts": puts,
    }
