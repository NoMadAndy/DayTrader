"""
FastAPI Application for RL Trading Service

Provides REST API endpoints for:
- Creating and configuring trading agents
- Training agents on historical data
- Getting trading signals from trained agents
- Managing agent lifecycle (list, delete, status)
- Health and status checks
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from collections import deque
import asyncio
from contextlib import asynccontextmanager
import logging
import httpx
import json
import math
import sys

from .config import settings
from .trainer import trainer, TradingAgentTrainer
from .agent_config import (
    AgentConfig, AgentStatus, HoldingPeriod, RiskProfile,
    TradingStyle, BrokerProfile, PRESET_AGENT_CONFIGS
)
from .indicators import prepare_data_for_training

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Training status tracking
training_tasks: Dict[str, dict] = {}

# Training logs storage - keeps last 500 log lines per agent
training_logs: Dict[str, deque] = {}
MAX_LOG_LINES = 500


def add_training_log(agent_name: str, message: str, level: str = "info"):
    """Add a log entry for a training session"""
    if agent_name not in training_logs:
        training_logs[agent_name] = deque(maxlen=MAX_LOG_LINES)
    
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "message": message
    }
    training_logs[agent_name].append(log_entry)


def clear_training_logs(agent_name: str):
    """Clear logs for an agent"""
    if agent_name in training_logs:
        training_logs[agent_name].clear()


async def resume_running_traders():
    """Resume all traders that were running before service restart."""
    logger.info("resume_running_traders: Starting task...")
    try:
        # Wait a bit for backend to be ready
        await asyncio.sleep(2)
        logger.info("resume_running_traders: Checking for traders...")
        
        backend_url = settings.backend_url or "http://backend:3001"
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Fetch all AI traders from backend
            logger.info(f"resume_running_traders: Fetching from {backend_url}/api/ai-traders")
            response = await client.get(f"{backend_url}/api/ai-traders")
            logger.info(f"resume_running_traders: Response status: {response.status_code}")
            if response.status_code != 200:
                logger.warning(f"Could not fetch AI traders: {response.status_code}")
                return
            
            traders = response.json()
            running_traders = [t for t in traders if t.get('status') == 'running']
            
            if not running_traders:
                logger.info("resume_running_traders: No running traders to resume")
                return
            
            logger.info(f"resume_running_traders: Found {len(running_traders)} running traders to resume")
            
            from .ai_trader_scheduler import get_scheduler
            from .ai_trader_engine import AITraderConfig
            import dataclasses
            
            sched = get_scheduler()
            valid_fields = {f.name for f in dataclasses.fields(AITraderConfig)}
            
            for trader in running_traders:
                trader_id = trader.get('id')
                personality = trader.get('personality', {})
                
                try:
                    # Extract signal weights
                    signal_weights = personality.get('signals', {}).get('weights', {})
                    risk = personality.get('risk', {})
                    schedule = personality.get('schedule', {})
                    capital = personality.get('capital', {})
                    trading = personality.get('trading', {})
                    ml = personality.get('ml', {})
                    rl = personality.get('rl', {})
                    
                    # Build config from personality - include ALL fields
                    config = {
                        'symbols': personality.get('watchlist', {}).get('symbols', []),
                        # Schedule settings
                        'schedule_enabled': schedule.get('enabled', True),
                        'check_interval_seconds': schedule.get('checkIntervalSeconds', 60),
                        'trading_start': schedule.get('tradingStart', '09:00'),
                        'trading_end': schedule.get('tradingEnd', '17:30'),
                        'timezone': schedule.get('timezone', 'Europe/Berlin'),
                        'trading_days': schedule.get('tradingDays', ['mon', 'tue', 'wed', 'thu', 'fri']),
                        'avoid_market_open': schedule.get('avoidMarketOpenMinutes', 15),
                        'avoid_market_close': schedule.get('avoidMarketCloseMinutes', 15),
                        # Signal weights
                        'ml_weight': signal_weights.get('ml', 0.25),
                        'rl_weight': signal_weights.get('rl', 0.25),
                        'sentiment_weight': signal_weights.get('sentiment', 0.25),
                        'technical_weight': signal_weights.get('technical', 0.25),
                        # Decision settings
                        'min_confidence': trading.get('minConfidence', 0.65),
                        'require_multiple_confirmation': personality.get('signals', {}).get('requireMultipleConfirmation', False),
                        'min_signal_agreement': personality.get('signals', {}).get('minSignalAgreement', 'weak'),
                        'rl_agent_name': personality.get('rlAgentName'),
                        'max_positions': trading.get('maxOpenPositions', 5),
                        # Capital settings
                        'initial_budget': capital.get('initialBudget', 100000),
                        'max_position_size': (capital.get('maxPositionSize', 25) / 100),  # Convert from % to decimal
                        'reserve_cash': (capital.get('reserveCashPercent', 10) / 100),  # Convert from % to decimal
                        # Risk settings
                        'risk_tolerance': risk.get('tolerance', 'moderate'),
                        'max_drawdown': (risk.get('maxDrawdown', 15) / 100),
                        'stop_loss_percent': (risk.get('stopLossPercent', 5) / 100),
                        'take_profit_percent': (risk.get('takeProfitPercent', 10) / 100),
                        # ML settings
                        'auto_train_ml': ml.get('autoTrain', True),
                        # Self-training config
                        'self_training_enabled': rl.get('selfTrainingEnabled', True),
                        'self_training_interval_minutes': rl.get('selfTrainingIntervalMinutes', 60),
                        'self_training_timesteps': rl.get('selfTrainingTimesteps', 10000),
                        # Short selling config
                        'allow_short_selling': risk.get('allowShortSelling', False),
                        'max_short_positions': risk.get('maxShortPositions', 3),
                        'max_short_exposure': risk.get('maxShortExposure', 0.30),
                    }
                    
                    logger.info(f"resume_running_traders: Config for trader {trader_id}: rl_agent_name={config.get('rl_agent_name')}, symbols={len(config.get('symbols', []))} items")
                    
                    # Filter to valid fields
                    filtered_config = {
                        k: v for k, v in config.items() 
                        if k in valid_fields and k not in ('trader_id', 'name')
                    }
                    
                    trader_config = AITraderConfig(
                        trader_id=trader_id,
                        name=trader.get('name', f'Trader-{trader_id}'),
                        **filtered_config
                    )
                    
                    await sched.start_trader(trader_id, trader_config)
                    logger.info(f"Resumed trader {trader_id} ({trader.get('name')})")
                    
                except Exception as e:
                    logger.error(f"Failed to resume trader {trader_id}: {e}")
            
    except Exception as e:
        logger.error(f"Error resuming running traders: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    logger.info(f"Starting {settings.service_name} v{settings.version}")
    logger.info(f"Device: {settings.device_info}")
    logger.info("Scheduling auto-resume of traders...")
    
    # Create the resume task - it will run after we yield
    resume_task = asyncio.create_task(_delayed_resume())
    
    yield
    
    # Cancel the resume task if it's still running
    if not resume_task.done():
        resume_task.cancel()
    
    logger.info("Shutting down RL Trading Service")


async def _delayed_resume():
    """Resume traders after a delay to let the server fully start."""
    try:
        await asyncio.sleep(5)
        await resume_running_traders()
    except asyncio.CancelledError:
        logger.info("Resume task cancelled during shutdown")
    except Exception as e:
        logger.error(f"Resume task failed: {e}")


app = FastAPI(
    title="DayTrader RL Trading Service",
    description="Deep Reinforcement Learning service for training virtual trading agents",
    version=settings.version,
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Middleware to disable caching for all API responses
@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# ============== Pydantic Models ==============

class OHLCVData(BaseModel):
    """Single OHLCV data point"""
    timestamp: int = Field(..., description="Unix timestamp in milliseconds")
    open: float
    high: float
    low: float
    close: float
    volume: float


class TrainRequest(BaseModel):
    """Request to train an agent"""
    agent_name: str = Field(..., description="Unique name for the agent")
    config: AgentConfig = Field(..., description="Agent configuration")
    data: Dict[str, List[OHLCVData]] = Field(
        ..., 
        description="Training data per symbol: {symbol: [OHLCV...]}"
    )
    total_timesteps: Optional[int] = Field(
        default=100000,
        ge=10000,
        le=10000000,
        description="Total training timesteps"
    )


class TrainFromBackendRequest(BaseModel):
    """Request to train using data from backend"""
    agent_name: str = Field(..., description="Unique name for the agent")
    config: AgentConfig = Field(..., description="Agent configuration")
    symbols: List[str] = Field(
        default=["AAPL", "MSFT", "GOOGL"],
        description="Symbols to fetch and train on"
    )
    days: int = Field(
        default=365,
        ge=30,
        le=3650,
        description="Days of historical data to fetch"
    )
    total_timesteps: Optional[int] = Field(
        default=100000,
        ge=10000,
        le=10000000,
        description="Total training timesteps"
    )


class SignalRequest(BaseModel):
    """Request for trading signal"""
    agent_name: str = Field(..., description="Name of the agent to query")
    data: List[OHLCVData] = Field(
        ...,
        description="Recent OHLCV data (at least 100 points)"
    )


class MultiSignalRequest(BaseModel):
    """Request signals from multiple agents"""
    agent_names: List[str] = Field(..., description="List of agent names")
    data: List[OHLCVData] = Field(..., description="Recent OHLCV data")


class SignalResponse(BaseModel):
    """Trading signal response"""
    signal: str = Field(..., description="buy, sell, or hold")
    action: str = Field(..., description="Specific action taken")
    strength: str = Field(..., description="weak, moderate, or strong")
    confidence: float = Field(..., description="Confidence score 0-1")
    action_probabilities: Dict[str, float] = Field(..., description="All action probabilities")
    agent_name: str
    agent_style: str
    holding_period: str


# ============== Health Endpoints ==============

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": settings.version,
        "commit": settings.commit,
        "build_time": settings.build_time,
        "device_info": settings.device_info,
    }


@app.get("/info")
async def service_info():
    """Get service information"""
    return {
        "service": settings.service_name,
        "version": settings.version,
        "commit": settings.commit,
        "build_time": settings.build_time,
        "device": settings.device,
        "device_info": settings.device_info,
        "model_dir": settings.model_dir,
        "agents_count": len(trainer.list_agents()),
    }


# ============== Agent Management ==============

@app.get("/agents", response_model=List[AgentStatus])
async def list_agents():
    """List all trading agents"""
    return trainer.list_agents()


@app.get("/agents/{agent_name}", response_model=AgentStatus)
async def get_agent(agent_name: str):
    """Get status of a specific agent"""
    status = trainer.get_agent_status(agent_name)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Agent not found: {agent_name}")
    return status


@app.delete("/agents/{agent_name}")
async def delete_agent(agent_name: str):
    """Delete a trading agent"""
    if trainer.delete_agent(agent_name):
        return {"message": f"Agent {agent_name} deleted successfully"}
    raise HTTPException(status_code=404, detail=f"Agent not found: {agent_name}")


@app.get("/presets")
async def list_presets():
    """List available preset agent configurations"""
    return {
        name: config.model_dump()
        for name, config in PRESET_AGENT_CONFIGS.items()
    }


@app.get("/presets/{preset_name}")
async def get_preset(preset_name: str):
    """Get a specific preset configuration"""
    preset = PRESET_AGENT_CONFIGS.get(preset_name)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"Preset not found: {preset_name}")
    return preset.model_dump()


# ============== Training Endpoints ==============

@app.post("/train")
async def train_agent(request: TrainRequest, background_tasks: BackgroundTasks):
    """
    Start training an agent with provided data.
    
    Training runs in the background. Use /train/status/{agent_name} to check progress.
    """
    agent_name = request.agent_name
    
    # Check if already training
    if agent_name in training_tasks and training_tasks[agent_name].get("status") == "training":
        raise HTTPException(
            status_code=409,
            detail=f"Agent {agent_name} is already training"
        )
    
    # Prepare training data
    training_data = {}
    for symbol, ohlcv_list in request.data.items():
        df_data = [d.model_dump() for d in ohlcv_list]
        try:
            df = prepare_data_for_training(df_data)
            training_data[symbol] = df
        except Exception as e:
            logger.warning(f"Failed to prepare data for {symbol}: {e}")
    
    if not training_data:
        raise HTTPException(status_code=400, detail="No valid training data provided")
    
    # Initialize training status and clear old logs
    clear_training_logs(agent_name)
    training_tasks[agent_name] = {
        "status": "starting",
        "progress": 0,
        "started_at": datetime.now().isoformat(),
    }
    
    # Define progress callback
    def update_progress(info: dict):
        # Sanitize float values before storing
        mean_reward = info.get("mean_reward", 0)
        best_reward = info.get("best_reward")
        
        # Ensure JSON-safe values
        if mean_reward is not None and not math.isfinite(mean_reward):
            mean_reward = 0.0
        if best_reward is not None and not math.isfinite(best_reward):
            best_reward = None
        
        training_tasks[agent_name].update({
            "status": "training",
            "progress": info["progress"],
            "timesteps": info["timesteps"],
            "episodes": info["episodes"],
            "mean_reward": mean_reward,
            "best_reward": best_reward,
        })
    
    # Define log callback
    def log_message(message: str, level: str = "info"):
        add_training_log(agent_name, message, level)
    
    def run_training_task():
        """Synchronous wrapper that runs the async training in a new event loop"""
        async def train_async():
            try:
                result = await trainer.train_agent(
                    agent_name=agent_name,
                    config=request.config,
                    training_data=training_data,
                    total_timesteps=request.total_timesteps,
                    progress_callback=update_progress,
                    log_callback=log_message,
                )
                training_tasks[agent_name].update({
                    "status": "completed",
                    "progress": 1.0,
                    "completed_at": datetime.now().isoformat(),
                    "result": result,
                })
            except Exception as e:
                logger.error(f"Training failed: {e}")
                add_training_log(agent_name, f"Training failed: {str(e)}", "error")
                training_tasks[agent_name].update({
                    "status": "failed",
                    "error": str(e),
                })
        
        asyncio.run(train_async())
    
    # Start training in background thread
    background_tasks.add_task(run_training_task)
    
    return {
        "message": f"Training started for agent: {agent_name}",
        "agent_name": agent_name,
        "status": "starting",
        "symbols": list(training_data.keys()),
        "total_timesteps": request.total_timesteps,
    }


@app.post("/train/from-backend")
async def train_from_backend(request: TrainFromBackendRequest, background_tasks: BackgroundTasks):
    """
    Train an agent by fetching historical data from the backend service.
    
    This is a convenience endpoint that fetches data automatically.
    """
    agent_name = request.agent_name
    
    # Check if already training
    if agent_name in training_tasks and training_tasks[agent_name].get("status") == "training":
        raise HTTPException(
            status_code=409,
            detail=f"Agent {agent_name} is already training"
        )
    
    # Clear old logs and initialize status
    clear_training_logs(agent_name)
    training_tasks[agent_name] = {
        "status": "fetching_data",
        "progress": 0,
        "started_at": datetime.now().isoformat(),
    }
    
    # Log callback for this agent
    def log_message(message: str, level: str = "info"):
        add_training_log(agent_name, message, level)
    
    def run_training_task():
        """Synchronous wrapper that runs the async training in a new event loop"""
        async def fetch_and_train():
            try:
                training_data = {}
                
                # Calculate date range
                from datetime import timedelta
                end_date = datetime.now().strftime("%Y-%m-%d")
                start_date = (datetime.now() - timedelta(days=request.days)).strftime("%Y-%m-%d")
                
                log_message(f"📥 Fetching data for {len(request.symbols)} symbol(s)...")
                log_message(f"   Date range: {start_date} to {end_date}")
                
                # Fetch data from backend for each symbol
                async with httpx.AsyncClient(timeout=60.0) as client:
                    for symbol in request.symbols:
                        try:
                            log_message(f"   Fetching {symbol}...")
                            response = await client.get(
                                f"{settings.backend_url}/api/historical-prices/{symbol}",
                                params={"startDate": start_date, "endDate": end_date}
                            )
                            if response.status_code == 200:
                                data = response.json()
                                if data.get("prices"):
                                    df = prepare_data_for_training(data["prices"])
                                    training_data[symbol] = df
                                    log_message(f"   ✓ {symbol}: {len(df)} data points")
                                    logger.info(f"Fetched {len(df)} rows for {symbol}")
                            else:
                                log_message(f"   ⚠️ {symbol}: HTTP {response.status_code}", "warning")
                        except Exception as e:
                            log_message(f"   ⚠️ Failed to fetch {symbol}: {e}", "warning")
                            logger.warning(f"Failed to fetch {symbol}: {e}")
                
                if not training_data:
                    log_message("❌ Could not fetch any training data", "error")
                    training_tasks[agent_name].update({
                        "status": "failed",
                        "error": "Could not fetch any training data",
                    })
                    return
                
                training_tasks[agent_name]["status"] = "training"
                
                def update_progress(info: dict):
                    # Sanitize float values before storing
                    mean_reward = info.get("mean_reward", 0)
                    best_reward = info.get("best_reward")
                    
                    # Ensure JSON-safe values
                    if mean_reward is not None and not math.isfinite(mean_reward):
                        mean_reward = 0.0
                    if best_reward is not None and not math.isfinite(best_reward):
                        best_reward = None
                    
                    training_tasks[agent_name].update({
                        "progress": info["progress"],
                        "timesteps": info["timesteps"],
                        "episodes": info["episodes"],
                        "mean_reward": mean_reward,
                        "best_reward": best_reward,
                    })
                
                result = await trainer.train_agent(
                    agent_name=agent_name,
                    config=request.config,
                    training_data=training_data,
                    total_timesteps=request.total_timesteps,
                    progress_callback=update_progress,
                    log_callback=log_message,
                )
                
                training_tasks[agent_name].update({
                    "status": "completed",
                    "progress": 1.0,
                    "completed_at": datetime.now().isoformat(),
                    "result": result,
                })
                
            except Exception as e:
                logger.error(f"Training failed: {e}")
                log_message(f"❌ Training failed: {str(e)}", "error")
                training_tasks[agent_name].update({
                    "status": "failed",
                    "error": str(e),
                })
        
        # Run async function in a new event loop
        asyncio.run(fetch_and_train())
    
    # Start training in background thread
    background_tasks.add_task(run_training_task)
    
    return {
        "message": f"Training started for agent: {agent_name}",
        "agent_name": agent_name,
        "status": "fetching_data",
        "symbols": request.symbols,
        "days": request.days,
        "total_timesteps": request.total_timesteps,
    }


@app.get("/train/status/{agent_name}")
async def get_training_status(agent_name: str):
    """Get training status for an agent"""
    if agent_name not in training_tasks:
        # Check if model exists (completed before)
        status = trainer.get_agent_status(agent_name)
        if status:
            return {
                "agent_name": agent_name,
                "status": status.status,
                "is_trained": status.is_trained,
            }
        raise HTTPException(status_code=404, detail=f"No training found for: {agent_name}")
    
    return {
        "agent_name": agent_name,
        **training_tasks[agent_name]
    }


@app.get("/train/logs/{agent_name}")
async def get_training_logs(agent_name: str, since: Optional[int] = None):
    """
    Get training logs for an agent.
    
    Args:
        agent_name: Name of the agent
        since: Optional index to get logs since (for incremental updates)
    
    Returns logs as a list, newest last.
    """
    if agent_name not in training_logs:
        return {"agent_name": agent_name, "logs": [], "total": 0}
    
    logs = list(training_logs[agent_name])
    
    if since is not None and since >= 0:
        logs = logs[since:]
    
    return {
        "agent_name": agent_name,
        "logs": logs,
        "total": len(training_logs[agent_name])
    }


@app.get("/train/logs/{agent_name}/stream")
async def stream_training_logs(agent_name: str):
    """
    Stream training logs via Server-Sent Events (SSE).
    
    Connect to this endpoint to receive real-time log updates during training.
    """
    async def event_generator():
        last_sent = 0
        
        while True:
            # Check if training is still active
            status = training_tasks.get(agent_name, {}).get("status", "unknown")
            
            # Send new logs
            if agent_name in training_logs:
                logs = list(training_logs[agent_name])
                new_logs = logs[last_sent:]
                
                for log in new_logs:
                    data = json.dumps(log)
                    yield f"data: {data}\n\n"
                    last_sent += 1
            
            # Send progress update
            if agent_name in training_tasks:
                progress_data = {
                    "type": "progress",
                    **training_tasks[agent_name]
                }
                yield f"data: {json.dumps(progress_data)}\n\n"
            
            # End stream if training is done
            if status in ("completed", "failed"):
                yield f"data: {json.dumps({'type': 'end', 'status': status})}\n\n"
                break
            
            await asyncio.sleep(0.5)  # Poll every 500ms
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ============== Signal/Prediction Endpoints ==============

@app.post("/signal", response_model=SignalResponse)
async def get_signal(request: SignalRequest):
    """
    Get a trading signal from a trained agent.
    
    Requires at least 100 data points for accurate signals.
    """
    if len(request.data) < 100:
        raise HTTPException(
            status_code=400,
            detail="At least 100 data points required for signal generation"
        )
    
    # Prepare data
    df_data = [d.model_dump() for d in request.data]
    df = prepare_data_for_training(df_data)
    
    # Get signal
    result = trainer.get_trading_signal(request.agent_name, df)
    
    if "error" in result and result.get("confidence", 0) == 0:
        raise HTTPException(status_code=404, detail=result["error"])
    
    
    return result


@app.post("/signal/explain")
async def get_signal_with_explanation(request: SignalRequest):
    """
    Get a trading signal with detailed, data-based explanation.
    
    This endpoint provides HONEST explanations - no hallucinations:
    - What market data the model actually observed
    - Which features had the strongest influence (measured via perturbation)
    - The probability distribution across all actions
    - The agent's training configuration and optimization goals
    
    Requires at least 100 data points for accurate signals.
    """
    if len(request.data) < 100:
        raise HTTPException(
            status_code=400,
            detail="At least 100 data points required for signal generation"
        )
    
    # Prepare data
    df_data = [d.model_dump() for d in request.data]
    df = prepare_data_for_training(df_data)
    
    # Get signal with explanation
    result = trainer.get_signal_with_explanation(request.agent_name, df)
    
    if "error" in result and result.get("confidence", 0) == 0:
        raise HTTPException(status_code=404, detail=result["error"])
    
    return result


@app.post("/signals/multi")
async def get_multi_signals(request: MultiSignalRequest):
    """
    Get trading signals from multiple agents.
    
    Useful for ensemble predictions or comparing different strategies.
    """
    if len(request.data) < 100:
        raise HTTPException(
            status_code=400,
            detail="At least 100 data points required for signal generation"
        )
    
    # Prepare data once
    df_data = [d.model_dump() for d in request.data]
    df = prepare_data_for_training(df_data)
    
    # Get signals from all agents
    signals = {}
    for agent_name in request.agent_names:
        signals[agent_name] = trainer.get_trading_signal(agent_name, df)
    
    # Calculate consensus
    buy_votes = sum(1 for s in signals.values() if s.get("signal") == "buy")
    sell_votes = sum(1 for s in signals.values() if s.get("signal") == "sell")
    hold_votes = sum(1 for s in signals.values() if s.get("signal") == "hold")
    
    total = len(signals)
    if total > 0:
        if buy_votes > sell_votes and buy_votes > hold_votes:
            consensus = "buy"
            consensus_strength = buy_votes / total
        elif sell_votes > buy_votes and sell_votes > hold_votes:
            consensus = "sell"
            consensus_strength = sell_votes / total
        else:
            consensus = "hold"
            consensus_strength = hold_votes / total
    else:
        consensus = "hold"
        consensus_strength = 0
    
    # Average confidence
    avg_confidence = sum(
        s.get("confidence", 0) for s in signals.values()
    ) / max(len(signals), 1)
    
    return {
        "signals": signals,
        "consensus": {
            "signal": consensus,
            "strength": consensus_strength,
            "confidence": avg_confidence,
            "votes": {
                "buy": buy_votes,
                "sell": sell_votes,
                "hold": hold_votes,
            }
        },
        "agents_queried": len(request.agent_names),
        "agents_responded": len(signals),
    }


@app.get("/signal/{agent_name}/quick")
async def get_quick_signal(agent_name: str, symbol: str = "AAPL"):
    """
    Get a quick signal by fetching recent data from backend.
    
    Convenience endpoint that handles data fetching automatically.
    """
    try:
        # Calculate date range (120 days)
        from datetime import timedelta
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=120)).strftime("%Y-%m-%d")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{settings.backend_url}/api/historical-prices/{symbol}",
                params={"startDate": start_date, "endDate": end_date}
            )
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail="Failed to fetch data from backend"
                )
            
            data = response.json()
            if not data.get("prices"):
                raise HTTPException(
                    status_code=404,
                    detail=f"No data available for {symbol}"
                )
            
            df = prepare_data_for_training(data["prices"])
            result = trainer.get_trading_signal(agent_name, df)
            
            return {
                "symbol": symbol,
                **result
            }
            
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Backend connection error: {e}")


# ============== Configuration Options ==============

@app.get("/options/holding-periods")
async def get_holding_periods():
    """Get available holding period options"""
    return [
        {"value": hp.value, "label": hp.name.replace("_", " ").title()}
        for hp in HoldingPeriod
    ]


@app.get("/options/risk-profiles")
async def get_risk_profiles():
    """Get available risk profile options"""
    return [
        {"value": rp.value, "label": rp.name.replace("_", " ").title()}
        for rp in RiskProfile
    ]


@app.get("/options/trading-styles")
async def get_trading_styles():
    """Get available trading style options"""
    return [
        {"value": ts.value, "label": ts.name.replace("_", " ").title()}
        for ts in TradingStyle
    ]


@app.get("/options/broker-profiles")
async def get_broker_profiles():
    """Get available broker profile options"""
    return [
        {"value": bp.value, "label": bp.name.replace("_", " ").title()}
        for bp in BrokerProfile
    ]


# ============== AI Trader Decision Engine Endpoints ==============

from .ai_trader_scheduler import get_scheduler
from .ai_trader_engine import AITraderConfig, AITraderEngine


@app.post("/ai-trader/start/{trader_id}")
async def start_ai_trader(trader_id: int, config: dict):
    """
    Start an AI trader with scheduled trading checks.
    
    Args:
        trader_id: Unique trader ID
        config: Configuration dictionary
        
    Returns:
        Status and trader ID
    """
    try:
        # Get valid AITraderConfig field names
        import dataclasses
        valid_fields = {f.name for f in dataclasses.fields(AITraderConfig)}
        
        # Filter config to only include valid fields, excluding trader_id and name
        filtered_config = {
            k: v for k, v in config.items() 
            if k in valid_fields and k not in ('trader_id', 'name')
        }
        
        # Log any ignored fields for debugging
        ignored_fields = set(config.keys()) - valid_fields - {'name'}
        if ignored_fields:
            logger.warning(f"Ignoring unknown config fields for trader {trader_id}: {ignored_fields}")
        
        # Create config from dict
        trader_config = AITraderConfig(
            trader_id=trader_id,
            name=config.get('name', f'Trader-{trader_id}'),
            **filtered_config
        )
        
        # Start trader
        sched = get_scheduler()
        await sched.start_trader(trader_id, trader_config)
        
        return {
            "status": "started",
            "trader_id": trader_id,
            "name": trader_config.name
        }
        
    except Exception as e:
        logger.error(f"Error starting trader {trader_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ai-trader/stop/{trader_id}")
async def stop_ai_trader(trader_id: int):
    """
    Stop a running AI trader.
    
    Args:
        trader_id: Trader ID to stop
        
    Returns:
        Status message
    """
    try:
        sched = get_scheduler()
        await sched.stop_trader(trader_id)
        
        return {
            "status": "stopped",
            "trader_id": trader_id
        }
        
    except Exception as e:
        logger.error(f"Error stopping trader {trader_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ai-trader/{trader_id}/self-training-status")
async def get_self_training_status(trader_id: int):
    """
    Get the current self-training status for an AI trader.
    
    Args:
        trader_id: Trader ID
        
    Returns:
        Training status with progress, message, etc.
    """
    try:
        sched = get_scheduler()
        status = sched.get_self_training_status(trader_id)
        
        if status is None:
            return {
                "trader_id": trader_id,
                "is_training": False,
                "status": "idle",
                "message": "No training in progress or recent training data"
            }
        
        return {
            "trader_id": trader_id,
            **status
        }
        
    except Exception as e:
        logger.error(f"Error getting self-training status for trader {trader_id}: {e}")
        return {
            "trader_id": trader_id,
            "is_training": False,
            "status": "error",
            "message": str(e)
        }


@app.post("/ai-trader/analyze")
async def analyze_symbol_once(request: dict):
    """
    Perform a one-time analysis of a symbol (for testing/debugging).
    
    Args:
        request: Dict with 'symbol', 'config' (optional), 'market_data' (optional)
        
    Returns:
        Trading decision with all details
    """
    try:
        symbol = request.get('symbol')
        if not symbol:
            raise HTTPException(status_code=400, detail="Symbol is required")
        
        # Create config
        config_dict = request.get('config', {})
        config = AITraderConfig(
            trader_id=0,
            name="test",
            **config_dict
        )
        
        # Create engine
        engine = AITraderEngine(config)
        
        try:
            # Get market data
            market_data = request.get('market_data')
            if not market_data:
                # Fetch from backend
                sched = get_scheduler()
                market_data = await sched._fetch_market_data(symbol)
                
                if not market_data:
                    raise HTTPException(
                        status_code=404,
                        detail=f"No market data available for {symbol}"
                    )
            
            # Analyze
            decision = await engine.analyze_symbol(symbol, market_data)
            
            return {
                'symbol': decision.symbol,
                'decision': decision.decision_type,
                'confidence': decision.confidence,
                'weighted_score': decision.weighted_score,
                'signals': {
                    'ml': decision.ml_score,
                    'rl': decision.rl_score,
                    'sentiment': decision.sentiment_score,
                    'technical': decision.technical_score
                },
                'agreement': decision.signal_agreement,
                'summary': decision.summary_short,
                'reasoning': decision.reasoning,
                'risk_passed': decision.risk_checks_passed,
                'risk_warnings': decision.risk_warnings,
                'risk_blockers': decision.risk_blockers,
                'quantity': decision.quantity,
                'price': decision.price,
                'stop_loss': decision.stop_loss,
                'take_profit': decision.take_profit,
                'timestamp': decision.timestamp.isoformat()
            }
            
        finally:
            await engine.close()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in analyze_symbol_once: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    logger.info("Shutting down AI Trader scheduler...")
    try:
        sched = get_scheduler()
        await sched.close()
    except Exception as e:
        logger.error(f"Error during scheduler shutdown: {e}")
