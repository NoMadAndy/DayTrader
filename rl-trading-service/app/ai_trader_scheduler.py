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
        
        # Self-training status tracking
        self.self_training_status: Dict[int, Dict[str, Any]] = {}
        
        # Cooldown tracking: {trader_id: {symbol: datetime_of_last_close}}
        self.close_cooldowns: Dict[int, Dict[str, datetime]] = {}
        # Cooldown period after closing a position (prevent immediate re-buy)
        self.cooldown_minutes = 30
    
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
                
                # Check SL/TP for existing positions first
                closed_symbols = await self._check_sl_tp_exits(trader_id, portfolio_state, config)
                
                # Analyze each symbol
                for symbol in config.symbols:
                    try:
                        # Skip symbols that were just closed (cooldown)
                        if symbol in closed_symbols:
                            print(f"⏳ Skipping {symbol} - just closed via SL/TP")
                            continue
                        
                        # Check cooldown from previous closes
                        if self._is_on_cooldown(trader_id, symbol):
                            continue
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
                        
                        # Execute trade if applicable (buy, sell, short, close)
                        if decision.decision_type in ['buy', 'sell', 'short', 'close'] and decision.risk_checks_passed:
                            executed = await self._execute_trade(trader_id, decision)
                            if executed:
                                await self._mark_decision_executed(trader_id, decision)
                                # Set cooldown after closing to prevent immediate re-buy
                                if decision.decision_type in ['sell', 'close']:
                                    self._set_cooldown(trader_id, symbol)
                        
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
        
        # Initialize training status
        agent_name = config.rl_agent_name or f"trader_{trader_id}_agent"
        self.self_training_status[trader_id] = {
            'is_training': True,
            'status': 'starting',
            'agent_name': agent_name,
            'progress': 0,
            'timesteps': 0,
            'total_timesteps': config.self_training_timesteps,
            'started_at': now.isoformat(),
            'symbols': [],
            'message': 'Preparing training data...'
        }
        
        try:
            # Fetch historical data for randomly selected symbols
            import pandas as pd
            import random
            from .agent_config import AgentConfig
            from .indicators import prepare_data_for_training
            
            training_data = {}
            
            # Shuffle symbols for varied training
            available_symbols = list(config.symbols)
            random.shuffle(available_symbols)
            selected_symbols = []  # Will be populated as data is loaded
            print(f"   🔍 Looking for training data from {len(available_symbols)} available symbols...")
            
            self.self_training_status[trader_id]['message'] = 'Searching for training data...'
            self.self_training_status[trader_id]['progress'] = 10
            
            # Try to load data for symbols, with fallback to more symbols if needed
            symbols_tried = 0
            max_symbols_to_try = min(len(available_symbols), 10)  # Try up to 10 symbols
            
            while len(training_data) < 3 and symbols_tried < max_symbols_to_try:
                symbol = available_symbols[symbols_tried]
                symbols_tried += 1
                
                try:
                    # Try with 5y period first for more data
                    for period in ['5y', '2y', '1y']:
                        response = await self.http_client.get(
                            f"{self.backend_url}/api/yahoo/chart/{symbol}",
                            params={'period': period, 'interval': '1d'}
                        )
                        
                        if response.status_code != 200:
                            continue
                        
                        data = response.json()
                        
                        # Parse Yahoo raw data format
                        quotes = []
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
                                    # Skip None values
                                    if closes[i] is None or opens[i] is None:
                                        continue
                                    quotes.append({
                                        'timestamp': timestamps[i] * 1000,
                                        'open': opens[i],
                                        'high': highs[i],
                                        'low': lows[i],
                                        'close': closes[i],
                                        'volume': volumes[i] if volumes[i] else 0
                                    })
                        
                        if len(quotes) >= 200:
                            df = prepare_data_for_training(quotes)
                            if df is not None and len(df) >= 200:
                                training_data[symbol] = df
                                selected_symbols.append(symbol) if symbol not in selected_symbols else None
                                print(f"   📊 Loaded {len(df)} data points for {symbol} ({period})")
                                self.self_training_status[trader_id]['progress'] = 10 + (len(training_data) / 3) * 10
                                self.self_training_status[trader_id]['symbols'] = list(training_data.keys())
                                break  # Got enough data, move to next symbol
                        else:
                            print(f"   ⚠️ Only {len(quotes)} points for {symbol} ({period}), trying longer period...")
                            
                except Exception as e:
                    print(f"   ⚠️ Failed to load data for {symbol}: {e}")
                    continue
            
            # Update selected symbols to actual loaded ones
            selected_symbols = list(training_data.keys())
            
            if not training_data:
                print(f"   ❌ No training data available for trader {trader_id}")
                self.self_training_status[trader_id] = {
                    'is_training': False,
                    'status': 'failed',
                    'message': 'No training data available',
                    'agent_name': agent_name,
                }
                return
            
            # Create agent config
            agent_config = AgentConfig(
                name=agent_name,
                initial_balance=config.initial_budget,
                max_position_size=config.max_position_size,
                stop_loss_pct=config.stop_loss_percent,
                take_profit_pct=config.take_profit_percent,
            )
            
            # Update status for training phase
            self.self_training_status[trader_id]['status'] = 'training'
            self.self_training_status[trader_id]['message'] = f'Training on {len(training_data)} symbols...'
            self.self_training_status[trader_id]['progress'] = 20
            
            # Run training with progress callback
            def progress_callback(progress_data: dict):
                timesteps = progress_data.get('timesteps', 0)
                total = progress_data.get('total_timesteps', 1)
                mean_reward = progress_data.get('mean_reward', 0)
                progress_pct = progress_data.get('progress', 0)
                
                # Map 0-1 progress to 20-95%
                display_progress = 20 + (progress_pct * 75)
                self.self_training_status[trader_id]['progress'] = min(display_progress, 95)
                self.self_training_status[trader_id]['timesteps'] = timesteps
                self.self_training_status[trader_id]['total_timesteps'] = total
                self.self_training_status[trader_id]['current_reward'] = mean_reward
                self.self_training_status[trader_id]['message'] = f'Training... {timesteps:,}/{total:,} steps'
            
            result = await self.trainer.train_agent(
                agent_name=agent_name,
                config=agent_config,
                training_data=training_data,
                total_timesteps=config.self_training_timesteps,
                progress_callback=progress_callback,
                continue_training=True,  # Always continue from existing model to improve over time
            )
            
            # Check if training was successful
            # The trainer returns metadata dict on success, raises exception on failure
            if result and isinstance(result, dict):
                # Extract metrics from the result
                performance_metrics = result.get('performance_metrics', {})
                mean_return = performance_metrics.get('mean_return_pct', 0)
                best_reward = result.get('best_reward', 0)
                cumulative_timesteps = result.get('cumulative_timesteps', config.self_training_timesteps)
                training_sessions = result.get('training_sessions', 1)
                continued = result.get('continued_from_previous', False)
                
                training_type = "continue" if continued else "fresh"
                print(f"   ✅ Trader {trader_id} self-training complete ({training_type})! Mean return: {mean_return:.2f}%")
                if continued:
                    print(f"   📊 Cumulative experience: {cumulative_timesteps:,} timesteps over {training_sessions} sessions")
                
                # Update training status - complete
                self.self_training_status[trader_id] = {
                    'is_training': False,
                    'status': 'complete',
                    'agent_name': agent_name,
                    'progress': 100,
                    'timesteps': config.self_training_timesteps,
                    'total_timesteps': config.self_training_timesteps,
                    'cumulative_timesteps': cumulative_timesteps,
                    'training_sessions': training_sessions,
                    'continued_training': continued,
                    'final_reward': best_reward,
                    'mean_return_pct': mean_return,
                    'completed_at': datetime.now().isoformat(),
                    'message': f'Training complete! Return: {mean_return:.2f}% (Total: {cumulative_timesteps:,} steps)',
                    'symbols': selected_symbols,
                    'training_duration': result.get('training_duration_seconds', 0),
                }
                
                # Persist training result to backend
                training_started = self.self_training_status[trader_id].get('started_at', datetime.now().isoformat())
                try:
                    await self.http_client.post(
                        f"{self.backend_url}/api/ai-traders/{trader_id}/training-history",
                        json={
                            'agent_name': agent_name,
                            'training_type': 'continue_training' if continued else 'self_training',
                            'status': 'completed',
                            'started_at': training_started,
                            'completed_at': datetime.now().isoformat(),
                            'duration_seconds': result.get('training_duration_seconds', 0),
                            'total_timesteps': config.self_training_timesteps,
                            'cumulative_timesteps': cumulative_timesteps,
                            'training_sessions': training_sessions,
                            'continued_from_previous': continued,
                            'final_reward': best_reward,
                            'mean_reward': best_reward,
                            'best_reward': best_reward,
                            'mean_return_pct': mean_return,
                            'max_return_pct': performance_metrics.get('max_return_pct', 0),
                            'min_return_pct': performance_metrics.get('min_return_pct', 0),
                            'episodes_completed': result.get('total_episodes', 0),
                            'cumulative_episodes': result.get('cumulative_episodes', 0),
                            'symbols_trained': selected_symbols,
                            'metadata': {
                                'performance_metrics': performance_metrics,
                                'continued_training': continued,
                                'cumulative_timesteps': cumulative_timesteps,
                                'training_sessions': training_sessions,
                            }
                        }
                    )
                    print(f"   📝 Training result persisted to database")
                except Exception as e:
                    print(f"   ⚠️ Failed to persist training result: {e}")
                
                # Also send event notification
                try:
                    event_msg = f'Continue training complete. Return: {mean_return:.2f}% (Total: {cumulative_timesteps:,} steps)' if continued else f'Self-training complete. Return: {mean_return:.2f}%'
                    await self.http_client.post(
                        f"{self.backend_url}/api/ai-traders/{trader_id}/events",
                        json={
                            'event_type': 'self_training_complete',
                            'message': event_msg,
                            'data': {
                                'agent_name': agent_name,
                                'timesteps': config.self_training_timesteps,
                                'cumulative_timesteps': cumulative_timesteps,
                                'training_sessions': training_sessions,
                                'continued_training': continued,
                                'mean_return_pct': mean_return,
                            }
                        }
                    )
                except Exception:
                    pass  # Ignore notification errors
            else:
                print(f"   ❌ Trader {trader_id} self-training returned unexpected result")
                self.self_training_status[trader_id] = {
                    'is_training': False,
                    'status': 'failed',
                    'agent_name': agent_name,
                    'message': 'Training returned unexpected result',
                    'symbols': selected_symbols,
                }
                
        except Exception as e:
            print(f"   ❌ Error during self-training for trader {trader_id}: {e}")
            self.self_training_status[trader_id] = {
                'is_training': False,
                'status': 'error',
                'message': str(e),
            }
    
    def get_self_training_status(self, trader_id: int) -> Optional[Dict[str, Any]]:
        """
        Get the current self-training status for a trader.
        
        Args:
            trader_id: Trader ID
            
        Returns:
            Status dictionary or None
        """
        return self.self_training_status.get(trader_id)
    
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
    
    async def _check_sl_tp_exits(
        self, 
        trader_id: int, 
        portfolio_state: Dict,
        config: AITraderConfig
    ) -> set:
        """
        Check if any positions have hit their stop-loss or take-profit levels.
        
        This is especially important for scalping where quick exits are needed.
        
        Args:
            trader_id: Trader ID
            portfolio_state: Current portfolio state with positions
            config: AITraderConfig instance
            
        Returns:
            Set of symbols that were closed (for cooldown in current cycle)
        """
        positions = portfolio_state.get('positions', {})
        closed_symbols = set()
        
        for symbol, pos in positions.items():
            try:
                current_price = pos.get('current_price', 0)
                stop_loss = pos.get('stop_loss')
                take_profit = pos.get('take_profit')
                side = pos.get('side', 'long')
                quantity = pos.get('quantity', 0)
                
                if not current_price or quantity == 0:
                    continue
                
                should_close = False
                close_reason = None
                
                # Check Stop-Loss
                if stop_loss:
                    if side == 'long' and current_price <= stop_loss:
                        should_close = True
                        close_reason = 'stop_loss'
                        print(f"🛑 Trader {trader_id}: {symbol} hit STOP-LOSS @ ${current_price:.2f} (SL: ${stop_loss:.2f})")
                    elif side == 'short' and current_price >= stop_loss:
                        should_close = True
                        close_reason = 'stop_loss'
                        print(f"🛑 Trader {trader_id}: {symbol} hit STOP-LOSS @ ${current_price:.2f} (SL: ${stop_loss:.2f})")
                
                # Check Take-Profit
                if take_profit and not should_close:
                    if side == 'long' and current_price >= take_profit:
                        should_close = True
                        close_reason = 'take_profit'
                        print(f"🎯 Trader {trader_id}: {symbol} hit TAKE-PROFIT @ ${current_price:.2f} (TP: ${take_profit:.2f})")
                    elif side == 'short' and current_price <= take_profit:
                        should_close = True
                        close_reason = 'take_profit'
                        print(f"🎯 Trader {trader_id}: {symbol} hit TAKE-PROFIT @ ${current_price:.2f} (TP: ${take_profit:.2f})")
                
                # Execute close if needed
                if should_close:
                    # Create a synthetic close decision
                    decision = TradingDecision(
                        symbol=symbol,
                        decision_type='close',
                        confidence=1.0,  # Automatic SL/TP exit
                        weighted_score=0,
                        ml_score=None,
                        rl_score=None,
                        sentiment_score=None,
                        technical_score=None,
                        signal_agreement='strong',
                        reasoning={
                            'trigger': close_reason,
                            'trigger_price': stop_loss if close_reason == 'stop_loss' else take_profit,
                            'current_price': current_price,
                            'side': side
                        },
                        summary_short=f"{close_reason.upper()}: Closing {side} {symbol} @ ${current_price:.2f}",
                        quantity=abs(quantity),
                        price=current_price,
                        stop_loss=stop_loss,
                        take_profit=take_profit,
                        risk_checks_passed=True,  # SL/TP exits bypass risk checks
                        risk_warnings=[],
                        risk_blockers=[],
                        market_context={},
                        portfolio_snapshot=portfolio_state,
                        timestamp=datetime.now()
                    )
                    
                    # Log and execute
                    await self._log_decision(trader_id, decision)
                    executed = await self._execute_trade(trader_id, decision)
                    if executed:
                        await self._mark_decision_executed(trader_id, decision)
                        closed_symbols.add(symbol)
                        # Record cooldown to prevent immediate re-buy
                        self._set_cooldown(trader_id, symbol)
                        
            except Exception as e:
                print(f"Error checking SL/TP for {symbol}: {e}")
                continue
        
        return closed_symbols
    
    def _is_on_cooldown(self, trader_id: int, symbol: str) -> bool:
        """Check if a symbol is on cooldown after a recent close."""
        cooldowns = self.close_cooldowns.get(trader_id, {})
        last_close = cooldowns.get(symbol)
        if last_close is None:
            return False
        elapsed = (datetime.now() - last_close).total_seconds() / 60
        if elapsed < self.cooldown_minutes:
            return True
        # Cooldown expired, remove it
        del cooldowns[symbol]
        return False
    
    def _set_cooldown(self, trader_id: int, symbol: str):
        """Set cooldown for a symbol after closing a position."""
        if trader_id not in self.close_cooldowns:
            self.close_cooldowns[trader_id] = {}
        self.close_cooldowns[trader_id][symbol] = datetime.now()
        print(f"⏳ Trader {trader_id}: {symbol} on {self.cooldown_minutes}min cooldown after close")
    
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
    
    async def _execute_trade(self, trader_id: int, decision: TradingDecision) -> bool:
        """
        Execute a trading decision.
        
        Args:
            trader_id: Trader ID
            decision: TradingDecision instance
            
        Returns:
            True if trade was executed successfully
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
                return True
            else:
                print(f"Failed to execute trade: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"Error executing trade: {e}")
            return False
    
    async def _mark_decision_executed(self, trader_id: int, decision: TradingDecision):
        """
        Mark a decision as executed in the backend.
        
        Args:
            trader_id: Trader ID
            decision: TradingDecision instance
        """
        try:
            # Mark the most recent decision for this symbol as executed
            response = await self.http_client.patch(
                f"{self.backend_url}/api/ai-traders/{trader_id}/decisions/mark-executed",
                json={
                    'symbol': decision.symbol,
                    'decision_type': decision.decision_type,
                    'timestamp': decision.timestamp.isoformat()
                }
            )
            
            if response.status_code not in [200, 204]:
                print(f"Failed to mark decision as executed: {response.status_code}")
                
        except Exception as e:
            print(f"Error marking decision as executed: {e}")
    
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
