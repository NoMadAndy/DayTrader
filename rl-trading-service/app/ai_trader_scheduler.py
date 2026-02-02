"""
AI Trader Scheduler

Manages scheduled trading checks and executions for AI traders.
Runs trading loops at specified intervals and manages multiple traders.
Includes self-training capability during idle periods.
"""

import asyncio
from typing import Dict, Optional, Any
from datetime import datetime, time, timedelta
import httpx
import pytz

from .ai_trader_engine import AITraderEngine, AITraderConfig, TradingDecision
from .trainer import TradingAgentTrainer


class AITraderScheduler:
    """Scheduler for AI trading operations with self-training capability"""
    
    def __init__(self, backend_url: str = "http://backend:3001"):
        """
        Initialize scheduler.
        
        Args:
            backend_url: URL of backend service
        """
        self.backend_url = backend_url
        self.http_client = httpx.AsyncClient(timeout=30.0)
        self.engines: Dict[int, AITraderEngine] = {}
        self.running_tasks: Dict[int, asyncio.Task] = {}
        self.training_tasks: Dict[int, asyncio.Task] = {}
        self.last_training_time: Dict[int, datetime] = {}
        self.trainer = TradingAgentTrainer()
        self._shutdown = False
    
    async def start_trader(self, trader_id: int, config: AITraderConfig):
        """
        Start a trader with scheduled checks.
        
        Args:
            trader_id: Unique trader ID
            config: AITraderConfig instance
        """
        if trader_id in self.running_tasks:
            print(f"Trader {trader_id} is already running")
            return
        
        # Create engine
        engine = AITraderEngine(config, self.backend_url)
        self.engines[trader_id] = engine
        
        # Start trading loop
        task = asyncio.create_task(
            self._run_trader_loop(trader_id, engine, config)
        )
        self.running_tasks[trader_id] = task
        
        print(f"Started trader {trader_id} ({config.name})")
    
    async def stop_trader(self, trader_id: int):
        """
        Stop a running trader.
        
        Args:
            trader_id: Trader ID to stop
        """
        if trader_id not in self.running_tasks:
            print(f"Trader {trader_id} is not running")
            return
        
        # Cancel the task
        task = self.running_tasks[trader_id]
        task.cancel()
        
        try:
            await task
        except asyncio.CancelledError:
            pass
        
        # Cleanup
        del self.running_tasks[trader_id]
        
        if trader_id in self.engines:
            await self.engines[trader_id].close()
            del self.engines[trader_id]
        
        print(f"Stopped trader {trader_id}")
    
    async def _run_trader_loop(
        self,
        trader_id: int,
        engine: AITraderEngine,
        config: AITraderConfig
    ):
        """
        Main trading loop for a trader.
        
        Args:
            trader_id: Trader ID
            engine: AITraderEngine instance
            config: AITraderConfig instance
        """
        print(f"Trader {trader_id} loop started")
        
        try:
            while not self._shutdown:
                # Check if it's trading time
                if not self._is_trading_time(config):
                    # Not trading time - opportunity for self-training
                    if config.self_training_enabled:
                        await self._maybe_self_train(trader_id, config)
                    await asyncio.sleep(60)  # Check again in 1 minute
                    continue
                
                # Get portfolio state
                portfolio_state = await self._fetch_portfolio_state(trader_id)
                
                # Analyze each symbol
                for symbol in config.symbols:
                    try:
                        # Fetch market data
                        market_data = await self._fetch_market_data(symbol)
                        
                        if not market_data:
                            print(f"No market data for {symbol}, skipping")
                            continue
                        
                        # Analyze symbol
                        decision = await engine.analyze_symbol(
                            symbol,
                            market_data,
                            portfolio_state
                        )
                        
                        # Log decision
                        await self._log_decision(trader_id, decision)
                        
                        # Execute trade if applicable
                        if decision.decision_type in ['buy', 'sell'] and decision.risk_checks_passed:
                            await self._execute_trade(trader_id, decision)
                        
                    except Exception as e:
                        import traceback
                        print(f"Error analyzing {symbol} for trader {trader_id}: {e}")
                        print(f"Traceback: {traceback.format_exc()}")
                        continue
                
                # Wait for next check interval (in seconds)
                await asyncio.sleep(config.check_interval_seconds)
                
        except asyncio.CancelledError:
            print(f"Trader {trader_id} loop cancelled")
            raise
        except Exception as e:
            print(f"Error in trader {trader_id} loop: {e}")
    
    def _is_trading_time(self, config: AITraderConfig) -> bool:
        """
        Check if current time is within trading hours.
        
        Args:
            config: AITraderConfig instance
            
        Returns:
            True if within trading hours
        """
        if not config.schedule_enabled:
            return True
        
        try:
            tz = pytz.timezone(config.timezone)
            now = datetime.now(tz)
            
            # Check day of week
            weekday = now.strftime('%a').lower()
            if weekday not in config.trading_days:
                return False
            
            # Check time of day
            current_time = now.time()
            start_time = time.fromisoformat(config.trading_start)
            end_time = time.fromisoformat(config.trading_end)
            
            # Add buffers
            start_buffer = (
                datetime.combine(datetime.today(), start_time) + 
                timedelta(minutes=config.avoid_market_open)
            ).time()
            end_buffer = (
                datetime.combine(datetime.today(), end_time) - 
                timedelta(minutes=config.avoid_market_close)
            ).time()
            
            return start_buffer <= current_time <= end_buffer
            
        except Exception as e:
            print(f"Error checking trading time: {e}")
            return False
    
    async def _maybe_self_train(self, trader_id: int, config: AITraderConfig):
        """
        Perform self-training during idle periods.
        
        Args:
            trader_id: Trader ID
            config: AITraderConfig instance
        """
        # Check if enough time has passed since last training
        now = datetime.now()
        last_train = self.last_training_time.get(trader_id)
        
        if last_train:
            minutes_since_train = (now - last_train).total_seconds() / 60
            if minutes_since_train < config.self_training_interval_minutes:
                return  # Not time yet
        
        # Check if already training
        if trader_id in self.training_tasks and not self.training_tasks[trader_id].done():
            return  # Already training
        
        # Start self-training
        print(f"🎓 Trader {trader_id} starting self-training (idle period)...")
        self.last_training_time[trader_id] = now
        
        try:
            # Fetch historical data for all symbols
            import pandas as pd
            from .agent_config import AgentConfig
            from .indicators import prepare_data_for_training
            
            training_data = {}
            
            for symbol in config.symbols[:3]:  # Limit to 3 symbols for quick training
                try:
                    response = await self.http_client.get(
                        f"{self.backend_url}/api/yahoo/chart/{symbol}",
                        params={'period': '2y', 'interval': '1d'}
                    )
                    
                    if response.status_code == 200:
                        data = response.json()
                        quotes = data.get('quotes', [])
                        if len(quotes) >= 200:
                            df = prepare_data_for_training(quotes)
                            if df is not None and len(df) >= 200:
                                training_data[symbol] = df
                                print(f"   📊 Loaded {len(df)} data points for {symbol}")
                except Exception as e:
                    print(f"   ⚠️ Failed to load data for {symbol}: {e}")
                    continue
            
            if not training_data:
                print(f"   ❌ No training data available for trader {trader_id}")
                return
            
            # Create agent config
            agent_name = config.rl_agent_name or f"trader_{trader_id}_agent"
            agent_config = AgentConfig(
                name=agent_name,
                initial_balance=config.initial_budget,
                max_position_size=config.max_position_size,
                stop_loss_pct=config.stop_loss_percent,
                take_profit_pct=config.take_profit_percent,
            )
            
            # Run training
            result = await self.trainer.train_agent(
                agent_name=agent_name,
                config=agent_config,
                training_data=training_data,
                total_timesteps=config.self_training_timesteps,
            )
            
            if result.get('success', False):
                reward = result.get('final_reward', 0)
                print(f"   ✅ Trader {trader_id} self-training complete! Final reward: {reward:.2f}")
                
                # Notify backend about the training
                try:
                    await self.http_client.post(
                        f"{self.backend_url}/api/ai-traders/{trader_id}/events",
                        json={
                            'event_type': 'self_training_complete',
                            'message': f'Self-training complete. Reward: {reward:.2f}',
                            'data': {
                                'agent_name': agent_name,
                                'timesteps': config.self_training_timesteps,
                                'final_reward': reward,
                            }
                        }
                    )
                except Exception:
                    pass  # Ignore notification errors
            else:
                print(f"   ❌ Trader {trader_id} self-training failed: {result.get('error', 'Unknown error')}")
                
        except Exception as e:
            print(f"   ❌ Error during self-training for trader {trader_id}: {e}")
    
    async def _fetch_market_data(self, symbol: str) -> Optional[Dict]:
        """
        Fetch market data from backend.
        
        Args:
            symbol: Trading symbol
            
        Returns:
            Market data dictionary or None
        """
        try:
            # Fetch 1 year of data (250+ trading days)
            # ML needs: 50 points for SMA_50 indicator + 60 for sequence + buffer
            response = await self.http_client.get(
                f"{self.backend_url}/api/yahoo/chart/{symbol}",
                params={'period': '1y', 'interval': '1d'}
            )
            
            if response.status_code != 200:
                print(f"Failed to fetch data for {symbol}: {response.status_code}")
                return None
            
            data = response.json()
            
            # Extract OHLCV data
            prices = []
            if 'chart' in data and 'result' in data['chart']:
                results = data['chart']['result']
                if results and len(results) > 0:
                    result = results[0]
                    timestamps = result.get('timestamp', [])
                    quote = result.get('indicators', {}).get('quote', [{}])[0]
                    
                    opens = quote.get('open', [])
                    highs = quote.get('high', [])
                    lows = quote.get('low', [])
                    closes = quote.get('close', [])
                    volumes = quote.get('volume', [])
                    
                    for i in range(len(timestamps)):
                        prices.append({
                            'timestamp': timestamps[i] * 1000,  # Convert to ms
                            'open': opens[i] if i < len(opens) else 0,
                            'high': highs[i] if i < len(highs) else 0,
                            'low': lows[i] if i < len(lows) else 0,
                            'close': closes[i] if i < len(closes) else 0,
                            'volume': volumes[i] if i < len(volumes) else 0
                        })
            
            if not prices:
                return None
            
            # Get current price
            current_price = prices[-1]['close'] if prices else 0
            
            return {
                'symbol': symbol,
                'prices': prices,
                'current_price': current_price,
                'volume': prices[-1]['volume'] if prices else 0
            }
            
        except Exception as e:
            print(f"Error fetching market data for {symbol}: {e}")
            return None
    
    async def _fetch_portfolio_state(self, trader_id: int) -> Dict:
        """
        Fetch current portfolio state from backend.
        
        Args:
            trader_id: Trader ID
            
        Returns:
            Portfolio state dictionary
        """
        try:
            response = await self.http_client.get(
                f"{self.backend_url}/api/ai-traders/{trader_id}/portfolio"
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Failed to fetch portfolio for trader {trader_id}")
                return self._default_portfolio_state()
                
        except Exception as e:
            print(f"Error fetching portfolio state: {e}")
            return self._default_portfolio_state()
    
    def _default_portfolio_state(self) -> Dict:
        """Get default portfolio state"""
        return {
            'cash': 100000,
            'total_value': 100000,
            'total_invested': 0,
            'positions_count': 0,
            'positions': {},
            'daily_pnl': 0,
            'daily_pnl_pct': 0,
            'max_value': 100000
        }
    
    async def _log_decision(self, trader_id: int, decision: TradingDecision):
        """
        Log a trading decision to backend.
        
        Args:
            trader_id: Trader ID
            decision: TradingDecision instance
        """
        try:
            payload = {
                'symbol': decision.symbol,
                'decision_type': decision.decision_type,
                'confidence': decision.confidence,
                'weighted_score': decision.weighted_score,
                'ml_score': decision.ml_score,
                'rl_score': decision.rl_score,
                'sentiment_score': decision.sentiment_score,
                'technical_score': decision.technical_score,
                'signal_agreement': decision.signal_agreement,
                'reasoning': decision.reasoning,
                'summary': decision.summary_short,
                'quantity': decision.quantity,
                'price': decision.price,
                'stop_loss': decision.stop_loss,
                'take_profit': decision.take_profit,
                'risk_checks_passed': decision.risk_checks_passed,
                'risk_warnings': decision.risk_warnings,
                'risk_blockers': decision.risk_blockers,
                'timestamp': decision.timestamp.isoformat()
            }
            
            response = await self.http_client.post(
                f"{self.backend_url}/api/ai-traders/{trader_id}/decisions",
                json=payload
            )
            
            if response.status_code not in [200, 201]:
                print(f"Failed to log decision: {response.status_code}")
                
        except Exception as e:
            print(f"Error logging decision: {e}")
    
    async def _execute_trade(self, trader_id: int, decision: TradingDecision):
        """
        Execute a trading decision.
        
        Args:
            trader_id: Trader ID
            decision: TradingDecision instance
        """
        try:
            payload = {
                'symbol': decision.symbol,
                'action': decision.decision_type,
                'quantity': decision.quantity,
                'price': decision.price,
                'stop_loss': decision.stop_loss,
                'take_profit': decision.take_profit,
                'reasoning': decision.summary_short
            }
            
            response = await self.http_client.post(
                f"{self.backend_url}/api/ai-traders/{trader_id}/execute",
                json=payload
            )
            
            if response.status_code in [200, 201]:
                print(f"Trade executed for trader {trader_id}: {decision.decision_type} {decision.quantity} {decision.symbol} @ {decision.price}")
            else:
                print(f"Failed to execute trade: {response.status_code}")
                
        except Exception as e:
            print(f"Error executing trade: {e}")
    
    async def close(self):
        """Shutdown scheduler and cleanup"""
        self._shutdown = True
        
        # Stop all traders
        trader_ids = list(self.running_tasks.keys())
        for trader_id in trader_ids:
            await self.stop_trader(trader_id)
        
        # Close HTTP client
        await self.http_client.aclose()


# Global scheduler instance
scheduler: Optional[AITraderScheduler] = None


def get_scheduler() -> AITraderScheduler:
    """Get or create global scheduler instance"""
    global scheduler
    if scheduler is None:
        scheduler = AITraderScheduler()
    return scheduler
