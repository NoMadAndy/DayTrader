"""
Unified Options Provider — Triple-Hybrid Architecture

Waterfall strategy:
  1. Yahoo Finance  — Real US options with bid/ask/volume/OI/IV
  2. Emittenten-API — German warrants (SocGen) with WKN/ISIN/bid/ask/ratio
  3. Black-Scholes  — Theoretical fallback (always works)

The provider returns a unified response with a `source` field indicating
which data source was used.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def fetch_options_chain(
    symbol: str,
    underlying_price: float,
    volatility: float = 0.30,
    risk_free_rate: float = 0.03,
    ratio: float = 0.1,
    force_source: Optional[str] = None,
) -> dict:
    """
    Fetch options/warrant chain using triple-hybrid waterfall.
    
    Args:
        symbol: Stock ticker (e.g. 'AAPL', 'SAP', 'SIE.DE')
        underlying_price: Current stock price
        volatility: Annualized vol (used for BS fallback)
        risk_free_rate: Risk-free rate (used for BS fallback)
        ratio: Bezugsverhältnis (used for BS fallback)
        force_source: Force a specific source ('yahoo', 'emittent', 'theoretical')
    
    Returns:
        Unified dict with:
          - success: bool
          - source: 'yahoo' | 'emittent' | 'theoretical'
          - source_priority: list of sources attempted
          - symbol, underlying_price
          - strikes, expiry_days
          - calls, puts (list of option/warrant entries)
          - Additional source-specific fields
    """
    sources_tried = []
    
    # 1. Yahoo Finance (if not forcing another source)
    if force_source in (None, 'yahoo'):
        try:
            from .options_yahoo import fetch_yahoo_options
            
            logger.info(f"Trying Yahoo Finance for {symbol}...")
            sources_tried.append('yahoo')
            
            result = await fetch_yahoo_options(symbol, underlying_price)
            if result and result.get("success"):
                result["source_priority"] = sources_tried
                logger.info(f"✓ Yahoo Finance: {len(result.get('calls', []))} calls, "
                           f"{len(result.get('puts', []))} puts")
                return result
            
            logger.info(f"✗ Yahoo Finance: no data for {symbol}")
        except Exception as e:
            logger.warning(f"✗ Yahoo Finance error: {e}")
    
    # 2. Emittenten-API / SocGen (if not forcing another source)
    if force_source in (None, 'emittent'):
        try:
            from .options_emittent import fetch_emittent_warrants
            
            logger.info(f"Trying Emittenten-API for {symbol}...")
            sources_tried.append('emittent')
            
            result = await fetch_emittent_warrants(symbol, underlying_price)
            if result and result.get("success"):
                result["source_priority"] = sources_tried
                logger.info(f"✓ Emittenten-API: {len(result.get('calls', []))} calls, "
                           f"{len(result.get('puts', []))} puts")
                return result
            
            logger.info(f"✗ Emittenten-API: no data for {symbol}")
        except Exception as e:
            logger.warning(f"✗ Emittenten-API error: {e}")
    
    # 3. Black-Scholes theoretical fallback (always works)
    sources_tried.append('theoretical')
    logger.info(f"Using Black-Scholes fallback for {symbol}")
    
    result = _generate_theoretical_chain(
        symbol=symbol,
        underlying_price=underlying_price,
        volatility=volatility,
        risk_free_rate=risk_free_rate,
        ratio=ratio,
    )
    result["source_priority"] = sources_tried
    return result


def _generate_theoretical_chain(
    symbol: str,
    underlying_price: float,
    volatility: float,
    risk_free_rate: float,
    ratio: float,
) -> dict:
    """
    Generate a theoretical chain using Black-Scholes.
    This is the existing functionality, repackaged in unified format.
    """
    from .warrant_pricing import price_warrant

    S = underlying_price
    sigma = volatility
    r = risk_free_rate

    # Auto-generate strikes: ±30% around ATM
    if S >= 500:
        step = 25
    elif S >= 100:
        step = 10
    elif S >= 50:
        step = 5
    elif S >= 10:
        step = 2
    else:
        step = 0.5

    center = round(S / step) * step
    strikes = []
    for i in range(-8, 9):
        k = round(center + i * step, 2)
        if k > 0:
            strikes.append(k)

    expiry_days = [14, 30, 60, 90, 180, 365]

    calls = []
    puts = []

    for days in expiry_days:
        for K in strikes:
            try:
                call_result = price_warrant(S, K, days, sigma, r, 'call', ratio)
                put_result = price_warrant(S, K, days, sigma, r, 'put', ratio)

                call_entry = {
                    "strike": K,
                    "days": days,
                    "optionType": "call",
                    "expiryDate": "",
                    "lastPrice": call_result.warrant_price,
                    "bid": 0,
                    "ask": 0,
                    "volume": 0,
                    "openInterest": 0,
                    "impliedVolatility": sigma,
                    "moneyness": call_result.moneyness,
                    "inTheMoney": call_result.moneyness == 'ITM',
                    "price": call_result.warrant_price,
                    "intrinsic": call_result.intrinsic_value,
                    "timeValue": call_result.time_value,
                    "delta": call_result.greeks.delta,
                    "gamma": call_result.greeks.gamma,
                    "theta": call_result.greeks.theta,
                    "vega": call_result.greeks.vega,
                    "leverage": call_result.leverage_ratio,
                    "breakEven": call_result.break_even,
                    "source": "theoretical",
                }
                put_entry = {
                    "strike": K,
                    "days": days,
                    "optionType": "put",
                    "expiryDate": "",
                    "lastPrice": put_result.warrant_price,
                    "bid": 0,
                    "ask": 0,
                    "volume": 0,
                    "openInterest": 0,
                    "impliedVolatility": sigma,
                    "moneyness": put_result.moneyness,
                    "inTheMoney": put_result.moneyness == 'ITM',
                    "price": put_result.warrant_price,
                    "intrinsic": put_result.intrinsic_value,
                    "timeValue": put_result.time_value,
                    "delta": put_result.greeks.delta,
                    "gamma": put_result.greeks.gamma,
                    "theta": put_result.greeks.theta,
                    "vega": put_result.greeks.vega,
                    "leverage": put_result.leverage_ratio,
                    "breakEven": put_result.break_even,
                    "source": "theoretical",
                }
                calls.append(call_entry)
                puts.append(put_entry)
            except Exception:
                pass

    return {
        "success": True,
        "source": "theoretical",
        "symbol": symbol,
        "underlying_price": S,
        "volatility": sigma,
        "ratio": ratio,
        "strikes": strikes,
        "expiry_days": expiry_days,
        "calls": calls,
        "puts": puts,
    }
