# RL Trading Service

Deep Reinforcement Learning service for training virtual trading agents.

## Overview

This service implements a complete RL-based trading system that:

1. **Trains Virtual Traders**: Uses Proximal Policy Optimization (PPO) to train agents
2. **Simulates Realistic Trading**: Includes transaction costs, spreads, and risk management
3. **Supports Multiple Strategies**: Configure agents for different holding periods and risk profiles
4. **Provides Trading Signals**: Trained agents generate buy/sell/hold recommendations

## Features

### Agent Configuration

Each agent can be configured with:

| Parameter | Description | Options |
|-----------|-------------|---------|
| **Holding Period** | Target trade duration | scalping, intraday, swing_short, swing_medium, position_short, position_medium, position_long, investor |
| **Risk Profile** | Risk appetite | conservative, moderate, aggressive, very_aggressive |
| **Trading Style** | Strategy approach | trend_following, mean_reversion, momentum, breakout, contrarian, mixed |
| **Broker Profile** | Fee structure | discount, standard, premium, marketMaker |
| **Max Position Size** | Max portfolio % per position | 1% - 100% |
| **Stop Loss** | Auto-close losing positions | 1% - 50% |
| **Take Profit** | Auto-close winning positions | 1% - 100% |
| **Trailing Stop** | Dynamic stop loss | Enable/disable with distance |

### Preset Agents

| Preset | Description |
|--------|-------------|
| `conservative_swing` | Low risk, medium holding period, trend following |
| `aggressive_momentum` | High risk, short holds, momentum based |
| `day_trader` | Intraday mean reversion strategy |
| `position_investor` | Long-term trend following with trailing stops |
| `balanced_trader` | Moderate risk and holding period |

## API Endpoints

### Health & Info
- `GET /health` - Service health check
- `GET /info` - Service information and device status

### Agent Management
- `GET /agents` - List all agents
- `GET /agents/{name}` - Get agent status
- `DELETE /agents/{name}` - Delete an agent
- `GET /presets` - List preset configurations

### Training
- `POST /train` - Train agent with provided data
- `POST /train/from-backend` - Train using data from backend
- `GET /train/status/{name}` - Check training progress

### Signals
- `POST /signal` - Get signal from single agent
- `POST /signals/multi` - Get signals from multiple agents
- `GET /signal/{name}/quick?symbol=AAPL` - Quick signal with auto data fetch

### Configuration Options
- `GET /options/holding-periods`
- `GET /options/risk-profiles`
- `GET /options/trading-styles`
- `GET /options/broker-profiles`

## Training Example

```bash
# Train a new agent
curl -X POST http://localhost:8001/train/from-backend \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "my_trader",
    "config": {
      "name": "my_trader",
      "holding_period": "swing_short",
      "risk_profile": "moderate",
      "trading_style": "momentum",
      "initial_balance": 100000,
      "stop_loss_percent": 0.05,
      "take_profit_percent": 0.10
    },
    "symbols": ["AAPL", "MSFT", "GOOGL"],
    "days": 365,
    "total_timesteps": 100000
  }'
```

## Getting Signals

```bash
# Quick signal
curl "http://localhost:8001/signal/my_trader/quick?symbol=AAPL"

# Multi-agent consensus
curl -X POST http://localhost:8001/signals/multi \
  -H "Content-Type: application/json" \
  -d '{
    "agent_names": ["conservative_swing", "aggressive_momentum"],
    "data": [...ohlcv_data...]
  }'
```

## Docker

### CPU (default)
```bash
docker compose up rl-trading-service
```

### GPU (NVIDIA)
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up rl-trading-service
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_CUDA` | false | Enable GPU acceleration |
| `MODEL_DIR` | /app/models | Directory for saved models |
| `CHECKPOINT_DIR` | /app/checkpoints | Directory for training checkpoints |
| `DEFAULT_TIMESTEPS` | 100000 | Default training timesteps |
| `DEFAULT_LEARNING_RATE` | 0.0003 | Default learning rate |
| `ML_SERVICE_URL` | http://ml-service:8000 | ML service URL |
| `BACKEND_URL` | http://backend:3001 | Backend service URL |

## Technical Details

### Observation Space

The agent observes:
- 60-period window of OHLCV data and technical indicators (2100 features: 60 timesteps × 35 features)
  - Technical indicators: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ADX, Stochastic, CCI, MFI, etc.
- Portfolio state (5 features): cash ratio, position ratio, unrealized P&L, holding ratio, current drawdown
- Total observation dimension: 2105 features (2100 temporal + 5 portfolio)

### Action Space

Discrete actions:
- **HOLD** (0): No action
- **BUY_SMALL** (1): Buy 10% of available capital
- **BUY_MEDIUM** (2): Buy 25% of available capital
- **BUY_LARGE** (3): Buy 50% of available capital
- **SELL_SMALL** (4): Sell 25% of position
- **SELL_MEDIUM** (5): Sell 50% of position
- **SELL_ALL** (6): Close entire position

### Reward Function

Rewards are based on:
1. **Portfolio returns** - Primary reward signal
2. **Holding period alignment** - Bonus for matching target duration
3. **Risk-adjusted returns** - Sharpe-like penalty for drawdowns
4. **Stop loss/Take profit** - Penalties/bonuses for risk management
5. **Win rate** - Bonus for profitable trades

## Model Persistence

Trained models are saved to `/app/models/{agent_name}/`:
- `model.zip` - PPO model weights
- `vec_normalize.pkl` - Observation normalization stats
- `metadata.json` - Training config and metrics

Models persist across container restarts via Docker volumes.
