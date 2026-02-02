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
            blockers=blockers
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
        max_position = self.config.initial_budget * self.config.max_position_size
        passed = position_size <= max_position
        
        return RiskCheck(
            name="Position Size",
            category="position",
            passed=passed,
            value=f"${position_size:,.0f}",
            limit=f"${max_position:,.0f}",
            description=f"Position size must not exceed {self.config.max_position_size*100:.0f}% of budget",
            severity='blocker' if not passed else 'info'
        )
    
    def _check_max_positions(self, current_portfolio: Dict, decision_type: str) -> RiskCheck:
        """Check if we've reached max number of positions"""
        current_positions = current_portfolio.get('positions_count', 0)
        
        # Only block if trying to open a new position
        if decision_type == 'buy':
            passed = current_positions < self.config.max_positions
        else:
            passed = True
        
        return RiskCheck(
            name="Max Positions",
            category="position",
            passed=passed,
            value=str(current_positions),
            limit=str(self.config.max_positions),
            description=f"Cannot exceed {self.config.max_positions} open positions",
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
        positions = current_portfolio.get('positions', {})
        current_exposure = positions.get(symbol, {}).get('value', 0)
        total_exposure = current_exposure + new_position_size
        
        # Max 25% per symbol (same as max_position_size)
        max_symbol_exposure = self.config.initial_budget * self.config.max_position_size
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
        total_invested = current_portfolio.get('total_invested', 0)
        
        # Add new position if buying
        if decision_type == 'buy':
            total_invested += new_position_size
        
        max_exposure = self.config.initial_budget * self.config.max_total_exposure
        passed = total_invested <= max_exposure
        
        return RiskCheck(
            name="Total Exposure",
            category="exposure",
            passed=passed,
            value=f"${total_invested:,.0f}",
            limit=f"${max_exposure:,.0f}",
            description=f"Total exposure must not exceed {self.config.max_total_exposure*100:.0f}% of budget",
            severity='blocker' if not passed else 'info'
        )
    
    def _check_cash_reserve(self, position_size: float, current_portfolio: Dict) -> RiskCheck:
        """Check if we maintain minimum cash reserve"""
        cash = current_portfolio.get('cash', self.config.initial_budget)
        min_reserve = self.config.initial_budget * self.config.reserve_cash
        
        # After buying, will we still have enough cash?
        remaining_cash = cash - position_size
        passed = remaining_cash >= min_reserve
        
        return RiskCheck(
            name="Cash Reserve",
            category="liquidity",
            passed=passed,
            value=f"${remaining_cash:,.0f}",
            limit=f"${min_reserve:,.0f}",
            description=f"Must maintain {self.config.reserve_cash*100:.0f}% cash reserve",
            severity='blocker' if not passed else 'info'
        )
    
    def _check_daily_loss(self, current_portfolio: Dict) -> RiskCheck:
        """Check if daily loss limit exceeded"""
        daily_pnl = current_portfolio.get('daily_pnl', 0)
        daily_pnl_pct = current_portfolio.get('daily_pnl_pct', 0)
        
        max_loss_pct = self.config.max_daily_loss * 100
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
        max_value = current_portfolio.get('max_value', self.config.initial_budget)
        current_value = current_portfolio.get('total_value', self.config.initial_budget)
        
        drawdown = (max_value - current_value) / max_value if max_value > 0 else 0
        max_dd = self.config.max_drawdown * 100
        passed = drawdown < self.config.max_drawdown
        
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
        if not self.config.schedule_enabled:
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
            tz = pytz.timezone(self.config.timezone)
            now = datetime.now(tz)
            
            # Check day of week
            weekday = now.strftime('%a').lower()
            if weekday not in self.config.trading_days:
                return RiskCheck(
                    name="Trading Hours",
                    category="schedule",
                    passed=False,
                    value=weekday,
                    limit=", ".join(self.config.trading_days),
                    description="Today is not a trading day",
                    severity='blocker'
                )
            
            # Check time of day
            current_time = now.time()
            start_time = time.fromisoformat(self.config.trading_start)
            end_time = time.fromisoformat(self.config.trading_end)
            
            # Add market open/close buffers
            from datetime import timedelta
            start_buffer = (datetime.combine(datetime.today(), start_time) + 
                          timedelta(minutes=self.config.avoid_market_open)).time()
            end_buffer = (datetime.combine(datetime.today(), end_time) - 
                        timedelta(minutes=self.config.avoid_market_close)).time()
            
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
    
    def _check_cooldown(self) -> RiskCheck:
        """Check if in cooldown period after consecutive losses"""
        # This would need to track consecutive losses in the portfolio state
        # For now, we'll implement a basic version
        consecutive_losses = self.config.__dict__.get('_consecutive_losses', 0)
        
        if consecutive_losses >= self.config.max_consecutive_losses:
            # Check if cooldown period has passed
            # This is simplified - in production, track last loss timestamp
            passed = False
            description = f"Cooldown active after {consecutive_losses} consecutive losses"
            severity = 'blocker'
        else:
            passed = True
            description = f"{consecutive_losses}/{self.config.max_consecutive_losses} consecutive losses"
            severity = 'info'
        
        return RiskCheck(
            name="Loss Cooldown",
            category="protection",
            passed=passed,
            value=str(consecutive_losses),
            limit=str(self.config.max_consecutive_losses),
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
                
                passed = vix_level < self.config.pause_on_high_vix
                
                return RiskCheck(
                    name="VIX Level",
                    category="market",
                    passed=passed,
                    value=f"{vix_level:.2f}",
                    limit=f"<{self.config.pause_on_high_vix:.0f}",
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
                    limit=f"<{self.config.pause_on_high_vix:.0f}",
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
                limit=f"<{self.config.pause_on_high_vix:.0f}",
                description=f"Error fetching VIX: {e}",
                severity='info'
            )
    
    async def close(self):
        """Cleanup resources"""
        await self.http_client.aclose()
