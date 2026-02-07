"""
Black-Scholes Warrant/Option Pricing Engine

Provides:
- Black-Scholes option pricing (European-style)
- Greeks calculation (Delta, Gamma, Theta, Vega, Rho)
- Implied volatility solver
- Warrant pricing with ratio adjustment
"""

import math
import numpy as np
from dataclasses import dataclass, asdict
from typing import Optional


# Standard normal CDF & PDF — use math.erf to avoid scipy dependency
def _norm_cdf(x: float) -> float:
    """Standard normal cumulative distribution function."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    """Standard normal probability density function."""
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


@dataclass
class GreeksResult:
    """Option Greeks"""
    delta: float  # Price sensitivity to underlying (0-1 for calls, -1-0 for puts)
    gamma: float  # Delta sensitivity to underlying
    theta: float  # Daily time decay (negative = losing value)
    vega: float   # Sensitivity to volatility (per 1% vol change)
    rho: float    # Sensitivity to interest rate


@dataclass
class WarrantPriceResult:
    """Complete warrant pricing result"""
    warrant_price: float       # Fair value of the warrant
    intrinsic_value: float     # Max(0, S-K) for calls, Max(0, K-S) for puts
    time_value: float          # warrant_price - intrinsic_value
    greeks: GreeksResult
    # Derived metrics
    moneyness: str             # 'ITM', 'ATM', 'OTM'
    leverage_ratio: float      # Effective leverage (omega)
    break_even: float          # Underlying price needed to break even at expiry
    days_to_expiry: float
    implied_annual_cost: float # Annualized cost of time value as %


def black_scholes_price(
    S: float,          # Current price of underlying
    K: float,          # Strike price
    T: float,          # Time to expiry in years
    r: float,          # Risk-free rate (annualized, e.g. 0.03 = 3%)
    sigma: float,      # Volatility (annualized, e.g. 0.30 = 30%)
    option_type: str = 'call',  # 'call' or 'put'
) -> float:
    """
    Calculate Black-Scholes option price.
    
    Returns the theoretical fair price of a European option.
    """
    if T <= 0:
        # At expiry: intrinsic value only
        if option_type == 'call':
            return max(0.0, S - K)
        return max(0.0, K - S)
    
    if sigma <= 0 or S <= 0:
        return 0.0
    
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    
    if option_type == 'call':
        price = S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        price = K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)
    
    return max(0.0, price)


def calculate_greeks(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: str = 'call',
) -> GreeksResult:
    """Calculate all Greeks for an option."""
    if T <= 0 or sigma <= 0 or S <= 0:
        # At expiry, delta is 0 or 1
        if option_type == 'call':
            delta = 1.0 if S > K else 0.0
        else:
            delta = -1.0 if S < K else 0.0
        return GreeksResult(delta=delta, gamma=0.0, theta=0.0, vega=0.0, rho=0.0)
    
    sqrt_T = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    
    nd1 = _norm_pdf(d1)
    
    # Delta
    if option_type == 'call':
        delta = _norm_cdf(d1)
    else:
        delta = _norm_cdf(d1) - 1.0
    
    # Gamma (same for calls and puts)
    gamma = nd1 / (S * sigma * sqrt_T)
    
    # Theta (per calendar day)
    theta_annual = -(S * nd1 * sigma) / (2.0 * sqrt_T)
    if option_type == 'call':
        theta_annual -= r * K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        theta_annual += r * K * math.exp(-r * T) * _norm_cdf(-d2)
    theta = theta_annual / 365.0  # Per day
    
    # Vega (per 1% change in volatility)
    vega = S * sqrt_T * nd1 / 100.0
    
    # Rho (per 1% change in interest rate)
    if option_type == 'call':
        rho = K * T * math.exp(-r * T) * _norm_cdf(d2) / 100.0
    else:
        rho = -K * T * math.exp(-r * T) * _norm_cdf(-d2) / 100.0
    
    return GreeksResult(
        delta=round(delta, 6),
        gamma=round(gamma, 6),
        theta=round(theta, 6),
        vega=round(vega, 6),
        rho=round(rho, 6),
    )


def implied_volatility(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: str = 'call',
    max_iterations: int = 100,
    tolerance: float = 1e-6,
) -> Optional[float]:
    """
    Calculate implied volatility using Newton-Raphson method.
    
    Returns None if convergence fails.
    """
    if T <= 0 or market_price <= 0:
        return None
    
    # Initial guess
    sigma = 0.30
    
    for _ in range(max_iterations):
        price = black_scholes_price(S, K, T, r, sigma, option_type)
        diff = price - market_price
        
        if abs(diff) < tolerance:
            return round(sigma, 6)
        
        # Vega for Newton step
        sqrt_T = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
        vega = S * sqrt_T * _norm_pdf(d1)
        
        if vega < 1e-10:
            break
        
        sigma -= diff / vega
        sigma = max(0.01, min(5.0, sigma))  # Clamp to reasonable range
    
    return round(sigma, 6) if 0.01 < sigma < 5.0 else None


def price_warrant(
    S: float,                    # Underlying stock price
    K: float,                    # Strike price
    T_days: float,               # Days to expiry
    sigma: float = 0.30,         # Annualized volatility
    r: float = 0.03,             # Risk-free rate (ECB rate ~3%)
    option_type: str = 'call',   # 'call' or 'put'
    ratio: float = 0.1,          # Bezugsverhältnis (0.1 = 10 warrants per share)
) -> WarrantPriceResult:
    """
    Price a warrant (Optionsschein) with full Greeks.
    
    A warrant is an option with a ratio adjustment.
    Warrant Price = Black-Scholes Price × ratio
    """
    T = max(T_days / 365.0, 0.0)
    
    # Black-Scholes for the underlying option
    bs_price = black_scholes_price(S, K, T, r, sigma, option_type)
    greeks = calculate_greeks(S, K, T, r, sigma, option_type)
    
    # Apply ratio
    warrant_price = bs_price * ratio
    
    # Intrinsic value
    if option_type == 'call':
        intrinsic = max(0.0, S - K) * ratio
    else:
        intrinsic = max(0.0, K - S) * ratio
    
    time_value = max(0.0, warrant_price - intrinsic)
    
    # Moneyness
    if option_type == 'call':
        if S > K * 1.02:
            moneyness = 'ITM'
        elif S < K * 0.98:
            moneyness = 'OTM'
        else:
            moneyness = 'ATM'
    else:
        if S < K * 0.98:
            moneyness = 'ITM'
        elif S > K * 1.02:
            moneyness = 'OTM'
        else:
            moneyness = 'ATM'
    
    # Effective leverage (omega)
    if warrant_price > 0:
        leverage_ratio = abs(greeks.delta) * S * ratio / warrant_price
    else:
        leverage_ratio = 0.0
    
    # Break-even at expiry
    if option_type == 'call':
        break_even = K + warrant_price / ratio
    else:
        break_even = K - warrant_price / ratio
    
    # Annualized cost of time value (premium over intrinsic)
    if intrinsic > 0 and T > 0:
        implied_annual_cost = (time_value / intrinsic) * (1.0 / T) * 100.0
    else:
        implied_annual_cost = 0.0
    
    # Adjust greeks for ratio
    adjusted_greeks = GreeksResult(
        delta=round(greeks.delta * ratio, 6),
        gamma=round(greeks.gamma * ratio, 6),
        theta=round(greeks.theta * ratio, 6),
        vega=round(greeks.vega * ratio, 6),
        rho=round(greeks.rho * ratio, 6),
    )
    
    return WarrantPriceResult(
        warrant_price=round(warrant_price, 4),
        intrinsic_value=round(intrinsic, 4),
        time_value=round(time_value, 4),
        greeks=adjusted_greeks,
        moneyness=moneyness,
        leverage_ratio=round(leverage_ratio, 2),
        break_even=round(break_even, 4),
        days_to_expiry=T_days,
        implied_annual_cost=round(implied_annual_cost, 2),
    )


def to_dict(result: WarrantPriceResult) -> dict:
    """Convert WarrantPriceResult to JSON-serializable dict."""
    d = asdict(result)
    return d
