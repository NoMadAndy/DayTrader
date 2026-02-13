"""
Risk Management für AI Trader

Implements comprehensive risk checks including:
- Position sizing limits
- Exposure limits
- Loss limits
- Trading hour restrictions
- Market conditions (VIX)
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from datetime import datetime, time
import httpx
import pytz


@dataclass
class RiskCheck:
    """Single risk check result"""
    name: str
    category: str
    passed: bool
    value: str
    limit: str
    description: str
    severity: str  # 'blocker', 'warning', 'info'


@dataclass
class RiskCheckResult:
    """Aggregated result of all risk checks"""
    all_passed: bool
    passed_count: int
    total_count: int
    checks: List[Dict[str, Any]]
    warnings: List[str]
    blockers: List[str]
    position_scale_factor: float = 1.0  # 1.0 = full size, <1.0 = scaled down


class RiskManager:
    """Manages all risk checks for AI trading decisions"""
    
    def __init__(self, config):
        """
        Initialize risk manager.
        
        Args:
            config: AITraderConfig instance
        """
        self.config = config
        self.backend_url = "http://backend:3001"
        self.http_client = httpx.AsyncClient(timeout=30.0)
        
        # Pre-compute config values with defaults for null-safety
        self._initial_budget = config.initial_budget if config.initial_budget is not None else 100000
        self._max_position_size = config.max_position_size if config.max_position_size is not None else 0.25
        self._max_total_exposure = config.max_total_exposure if config.max_total_exposure is not None else 0.80
        self._max_positions = config.max_positions if config.max_positions is not None else 10
        self._reserve_cash = config.reserve_cash if config.reserve_cash is not None else 0.10
        self._max_daily_loss = config.max_daily_loss if config.max_daily_loss is not None else 0.05
        self._max_drawdown = config.max_drawdown if config.max_drawdown is not None else 0.15
        self._schedule_enabled = config.schedule_enabled if config.schedule_enabled is not None else True
        self._trading_start = config.trading_start if config.trading_start is not None else "09:00"
        self._trading_end = config.trading_end if config.trading_end is not None else "17:30"
        self._timezone = config.timezone if config.timezone is not None else "Europe/Berlin"
        self._avoid_market_open = config.avoid_market_open if config.avoid_market_open is not None else 15
        self._avoid_market_close = config.avoid_market_close if config.avoid_market_close is not None else 15
        self._pause_on_high_vix = config.pause_on_high_vix if config.pause_on_high_vix is not None else 30
        self._max_consecutive_losses = config.max_consecutive_losses if config.max_consecutive_losses is not None else 5
        self._trading_days = config.trading_days if config.trading_days is not None else ['mon', 'tue', 'wed', 'thu', 'fri']
    
    async def check_all(
        self, 
        symbol: str, 
        decision_type: str, 
        position_size: float,
        quantity: int,
        current_portfolio: Dict
    ) -> RiskCheckResult:
        """
        Run all risk checks.
        
        Args:
            symbol: Trading symbol
            decision_type: 'buy', 'sell', 'hold', 'close'
            position_size: Size of position in dollars
            quantity: Number of shares
            current_portfolio: Current portfolio state
            
        Returns:
            RiskCheckResult with all check results
        """
        checks = []
        
        # Run all checks
        checks.append(self._check_position_size(position_size))
        checks.append(self._check_max_positions(current_portfolio, decision_type))
        checks.append(self._check_symbol_exposure(symbol, position_size, current_portfolio))
        checks.append(self._check_total_exposure(position_size, current_portfolio, decision_type))
        checks.append(self._check_cash_reserve(position_size, current_portfolio))
        checks.append(self._check_daily_loss(current_portfolio))
        checks.append(self._check_max_drawdown(current_portfolio))
        checks.append(self._check_trading_hours())
        checks.append(self._check_cooldown())
        checks.append(await self._check_vix())
        
        # Graduated drawdown check (returns scale factor)
        dd_check, position_scale = self._check_drawdown_graduated(current_portfolio)
        
        checks.append(dd_check)
        
        # Aggregate results
        blockers = []
        warnings = []
        passed_count = 0
        
        for check in checks:
            if check.passed:
                passed_count += 1
            else:
                if check.severity == 'blocker':
                    blockers.append(f"{check.name}: {check.description}")
                elif check.severity == 'warning':
                    warnings.append(f"{check.name}: {check.description}")
        
        all_passed = len(blockers) == 0
        
        return RiskCheckResult(
            all_passed=all_passed,
            passed_count=passed_count,
            total_count=len(checks),
            checks=[self._check_to_dict(c) for c in checks],
            warnings=warnings,
            blockers=blockers,
            position_scale_factor=position_scale
        )
    
    def _check_to_dict(self, check: RiskCheck) -> Dict[str, Any]:
        """Convert RiskCheck to dictionary"""
        return {
            'name': check.name,
            'category': check.category,
            'passed': check.passed,
            'value': check.value,
            'limit': check.limit,
            'description': check.description,
            'severity': check.severity
        }
    
    def _check_position_size(self, position_size: float) -> RiskCheck:
        """Check if position size is within limits"""
        max_position = self._initial_budget * self._max_position_size
        passed = position_size <= max_position
        
        return RiskCheck(
            name="Position Size",
            category="position",
            passed=passed,
            value=f"${position_size:,.0f}",
            limit=f"${max_position:,.0f}",
            description=f"Position size must not exceed {self._max_position_size*100:.0f}% of budget",
            severity='blocker' if not passed else 'info'
        )
    
    def _check_max_positions(self, current_portfolio: Dict, decision_type: str) -> RiskCheck:
        """Check if we've reached max number of positions"""
        current_positions = current_portfolio.get('positions_count') or 0
        
        # Only block if trying to open a new position (buy or short)
        if decision_type in ('buy', 'short'):
            passed = current_positions < self._max_positions
        else:
            passed = True
        
        return RiskCheck(
            name="Max Positions",
            category="position",
            passed=passed,
            value=str(current_positions),
            limit=str(self._max_positions),
            description=f"Cannot exceed {self._max_positions} open positions",
            severity='blocker' if not passed else 'info'
        )
    
    def _check_symbol_exposure(
        self, 
        symbol: str, 
        new_position_size: float,
        current_portfolio: Dict
    ) -> RiskCheck:
        """Check if symbol exposure is within limits"""
        # Get current exposure to this symbol
        positions = current_portfolio.get('positions') or {}
        position_data = positions.get(symbol) or {}
        current_exposure = position_data.get('value') or 0
        total_exposure = current_exposure + new_position_size
        
        # Max 25% per symbol (same as max_position_size)
        max_symbol_exposure = self._initial_budget * self._max_position_size
        passed = total_exposure <= max_symbol_exposure
        
        return RiskCheck(
            name="Symbol Exposure",
            category="exposure",
            passed=passed,
            value=f"${total_exposure:,.0f}",
            limit=f"${max_symbol_exposure:,.0f}",
            description=f"Total exposure to {symbol} must not exceed 25% of budget",
            severity='blocker' if not passed else 'info'
        )
    
    def _check_total_exposure(
        self,
        new_position_size: float,
        current_portfolio: Dict,
        decision_type: str
    ) -> RiskCheck:
        """Check total portfolio exposure"""
        total_invested = current_portfolio.get('total_invested') or 0
        
        # Add new position if opening (buy or short)
        if decision_type in ('buy', 'short'):
            total_invested += new_position_size
        
        max_exposure = self._initial_budget * self._max_total_exposure
        passed = total_invested <= max_exposure
        
        return RiskCheck(
            name="Total Exposure",
            category="exposure",
            passed=passed,
            value=f"${total_invested:,.0f}",
            limit=f"${max_exposure:,.0f}",
            description=f"Total exposure must not exceed {self._max_total_exposure*100:.0f}% of budget",
            severity='blocker' if not passed else 'info'
        )
    
    def _check_cash_reserve(self, position_size: float, current_portfolio: Dict) -> RiskCheck:
        """Check if we maintain minimum cash reserve"""
        cash = current_portfolio.get('cash') or self._initial_budget
        min_reserve = self._initial_budget * self._reserve_cash
        
        # After buying, will we still have enough cash?
        remaining_cash = cash - position_size
        passed = remaining_cash >= min_reserve
        
        return RiskCheck(
            name="Cash Reserve",
            category="liquidity",
            passed=passed,
            value=f"${remaining_cash:,.0f}",
            limit=f"${min_reserve:,.0f}",
            description=f"Must maintain {self._reserve_cash*100:.0f}% cash reserve",
            severity='blocker' if not passed else 'info'
        )
    
    def _check_daily_loss(self, current_portfolio: Dict) -> RiskCheck:
        """Check if daily loss limit exceeded"""
        daily_pnl = current_portfolio.get('daily_pnl') or 0
        daily_pnl_pct = current_portfolio.get('daily_pnl_pct') or 0
        
        max_loss_pct = self._max_daily_loss * 100
        passed = daily_pnl_pct > -max_loss_pct
        
        return RiskCheck(
            name="Daily Loss",
            category="loss_limit",
            passed=passed,
            value=f"{daily_pnl_pct:.2f}%",
            limit=f"-{max_loss_pct:.1f}%",
            description=f"Daily loss must not exceed {max_loss_pct:.1f}%",
            severity='blocker' if not passed else 'warning'
        )
    
    def _check_max_drawdown(self, current_portfolio: Dict) -> RiskCheck:
        """Check if max drawdown exceeded"""
        max_value = current_portfolio.get('max_value') or self._initial_budget
        current_value = current_portfolio.get('total_value') or self._initial_budget
        
        drawdown = (max_value - current_value) / max_value if max_value > 0 else 0
        max_dd = self._max_drawdown * 100
        passed = drawdown < self._max_drawdown
        
        return RiskCheck(
            name="Max Drawdown",
            category="loss_limit",
            passed=passed,
            value=f"{drawdown*100:.2f}%",
            limit=f"{max_dd:.1f}%",
            description=f"Drawdown must not exceed {max_dd:.1f}%",
            severity='blocker' if not passed else 'warning'
        )
    
    def _check_trading_hours(self) -> RiskCheck:
        """Check if within trading hours"""
        if not self._schedule_enabled:
            return RiskCheck(
                name="Trading Hours",
                category="schedule",
                passed=True,
                value="Disabled",
                limit="N/A",
                description="Schedule checks disabled",
                severity='info'
            )
        
        try:
            tz = pytz.timezone(self._timezone)
            now = datetime.now(tz)
            
            # Check day of week
            weekday = now.strftime('%a').lower()
            if weekday not in self._trading_days:
                return RiskCheck(
                    name="Trading Hours",
                    category="schedule",
                    passed=False,
                    value=weekday,
                    limit=", ".join(self._trading_days),
                    description="Today is not a trading day",
                    severity='blocker'
                )
            
            # Check time of day
            current_time = now.time()
            start_time = time.fromisoformat(self._trading_start)
            end_time = time.fromisoformat(self._trading_end)
            
            # Add market open/close buffers
            from datetime import timedelta
            start_buffer = (datetime.combine(datetime.today(), start_time) + 
                          timedelta(minutes=self._avoid_market_open)).time()
            end_buffer = (datetime.combine(datetime.today(), end_time) - 
                        timedelta(minutes=self._avoid_market_close)).time()
            
            passed = start_buffer <= current_time <= end_buffer
            
            return RiskCheck(
                name="Trading Hours",
                category="schedule",
                passed=passed,
                value=current_time.strftime("%H:%M"),
                limit=f"{start_buffer.strftime('%H:%M')}-{end_buffer.strftime('%H:%M')}",
                description="Must trade within allowed hours (with buffers)",
                severity='blocker' if not passed else 'info'
            )
            
        except Exception as e:
            print(f"Error checking trading hours: {e}")
            return RiskCheck(
                name="Trading Hours",
                category="schedule",
                passed=False,
                value="Error",
                limit="N/A",
                description=f"Error checking trading hours: {e}",
                severity='warning'
            )
    
    def _check_drawdown_graduated(self, current_portfolio: Dict) -> tuple:
        """
        Graduated drawdown risk check with position scaling.
        
        Returns scaled position size recommendations:
        - 0-25% of max drawdown: No scaling (1.0x)
        - 25-50%: Warning, 75% position size
        - 50-75%: Warning, 50% position size
        - 75-100%: Severe warning, 30% position size
        - 100%+: Blocker (handled by _check_max_drawdown)
        
        Args:
            current_portfolio: Current portfolio state
            
        Returns:
            Tuple of (RiskCheck, scale_factor)
        """
        max_value = current_portfolio.get('max_value') or self._initial_budget
        current_value = current_portfolio.get('total_value') or self._initial_budget
        
        drawdown = (max_value - current_value) / max_value if max_value > 0 else 0
        dd_ratio = drawdown / self._max_drawdown if self._max_drawdown > 0 else 0
        
        if dd_ratio < 0.25:
            scale = 1.0
            severity = 'info'
            description = f"Drawdown {drawdown*100:.1f}% — minimal, full position sizing"
            passed = True
        elif dd_ratio < 0.50:
            scale = 0.75
            severity = 'warning'
            description = f"Drawdown {drawdown*100:.1f}% — moderate, reducing positions to 75%"
            passed = True
        elif dd_ratio < 0.75:
            scale = 0.50
            severity = 'warning'
            description = f"Drawdown {drawdown*100:.1f}% — elevated, reducing positions to 50%"
            passed = True
        else:
            scale = 0.30
            severity = 'warning'
            description = f"Drawdown {drawdown*100:.1f}% — severe, reducing positions to 30%"
            passed = True  # Not a blocker (that's _check_max_drawdown's job)
        
        check = RiskCheck(
            name="Drawdown Scaling",
            category="risk_scaling",
            passed=passed,
            value=f"{drawdown*100:.1f}% ({dd_ratio*100:.0f}% of limit)",
            limit=f"{self._max_drawdown*100:.1f}%",
            description=description,
            severity=severity
        )
        
        return check, scale
    
    def _check_cooldown(self) -> RiskCheck:
        """Check if in cooldown period after consecutive losses"""
        # This would need to track consecutive losses in the portfolio state
        # For now, we'll implement a basic version
        consecutive_losses = getattr(self.config, '_consecutive_losses', 0) or 0
        
        if consecutive_losses >= self._max_consecutive_losses:
            # Check if cooldown period has passed
            # This is simplified - in production, track last loss timestamp
            passed = False
            description = f"Cooldown active after {consecutive_losses} consecutive losses"
            severity = 'blocker'
        else:
            passed = True
            description = f"{consecutive_losses}/{self._max_consecutive_losses} consecutive losses"
            severity = 'info'
        
        return RiskCheck(
            name="Loss Cooldown",
            category="protection",
            passed=passed,
            value=str(consecutive_losses),
            limit=str(self._max_consecutive_losses),
            description=description,
            severity=severity
        )
    
    async def _check_vix(self) -> RiskCheck:
        """Check VIX level (market volatility)"""
        try:
            # Fetch VIX from backend using chart endpoint (quote doesn't work for VIX)
            import urllib.parse
            vix_symbol = urllib.parse.quote("^VIX", safe='')
            response = await self.http_client.get(
                f"{self.backend_url}/api/yahoo/chart/{vix_symbol}?period=1d"
            )
            
            if response.status_code == 200:
                data = response.json()
                # Chart endpoint returns data in chart.result[0].meta.regularMarketPrice
                chart_data = data.get('chart', {}).get('result', [{}])[0]
                vix_level = chart_data.get('meta', {}).get('regularMarketPrice', 0)
                
                passed = vix_level < self._pause_on_high_vix
                
                return RiskCheck(
                    name="VIX Level",
                    category="market",
                    passed=passed,
                    value=f"{vix_level:.2f}",
                    limit=f"<{self._pause_on_high_vix:.0f}",
                    description="High VIX indicates elevated market volatility",
                    severity='warning' if not passed else 'info'
                )
            else:
                # If we can't get VIX, don't block trading
                return RiskCheck(
                    name="VIX Level",
                    category="market",
                    passed=True,
                    value="N/A",
                    limit=f"<{self._pause_on_high_vix:.0f}",
                    description="Could not fetch VIX level",
                    severity='info'
                )
                
        except Exception as e:
            print(f"Error checking VIX: {e}")
            # Don't block trading if VIX check fails
            return RiskCheck(
                name="VIX Level",
                category="market",
                passed=True,
                value="Error",
                limit=f"<{self._pause_on_high_vix:.0f}",
                description=f"Error fetching VIX: {e}",
                severity='info'
            )
    
    async def close(self):
        """Cleanup resources"""
        await self.http_client.aclose()
