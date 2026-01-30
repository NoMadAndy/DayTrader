# DayTrader AI

A modern, AI-powered stock technical analysis platform for day trading education and testing.

## Features

- 📊 **Interactive Charts**: TradingView-style candlestick charts with real-time interaction
- 📈 **Technical Indicators**:
  - Trend: SMA (20, 50), EMA (12, 26)
  - Momentum: RSI, MACD, Stochastic Oscillator
  - Volatility: Bollinger Bands, ATR
  - Volume: OBV, VWAP
- 🤖 **AI-Powered Forecasting**: Weighted analysis of multiple indicators with confidence scoring
- 📱 **Modern, Responsive UI**: Works on desktop and mobile devices
- 📝 **Documented Analysis**: Each forecast explains the reasoning behind signals
- 🌐 **Real-Time Data**: Connect to multiple market data providers (Finnhub, Alpha Vantage, Twelve Data, Yahoo Finance)
- 📰 **Financial News**: Integrated news feeds with sentiment analysis
- 🔐 **User Accounts**: Optional login/registration for settings persistence
- 📋 **Watchlist**: Personal watchlist with trading signals for all positions
- 🧭 **Multi-Page Navigation**: Dedicated pages for Dashboard, Watchlist, Settings, Info, and Changelog
- 🎮 **Paper Trading**: Stock market simulation with virtual money (see below)
- 🤖 **RL Trading Agents**: Deep Reinforcement Learning virtual traders (see below)
- 🏆 **Trading Leaderboard**: Compete with other traders and AI agents (see below)
- 🤖 **AI Live Trader** (Phase 4): Complete AI trading platform with reporting, analytics & adaptive learning (see below)

## AI Live Trader (Phase 4 - COMPLETED ✅)

**Status**: All Phases Complete - Production Ready

AI Live Trader is now a complete autonomous trading system with real-time monitoring, comprehensive reporting, signal accuracy tracking, and adaptive learning capabilities!

### How to Access

1. **Login** to your account
2. Click **"Live AI"** in the navigation bar (🤖 icon)
3. Click **"+ New AI Trader"** to create a new trader
4. Configure your trader's personality (name, risk tolerance, initial capital, watchlist)
5. After creation, you'll be redirected to the trader's dashboard

### Phase 4 Features (Latest - Implemented)

- **📊 Daily Reports**: Automated performance reports generated after market close
  - Portfolio value tracking (start/end/P&L)
  - Trading statistics (trades, positions, win rate)
  - Best/worst trade highlights
  - Signal accuracy breakdown
  - Auto-generated insights

- **🎯 Signal Accuracy Tracking**: Real-time performance metrics for each signal source
  - ML, RL, Sentiment, and Technical signal accuracy
  - Historical trends and comparisons
  - Visual accuracy charts

- **🧠 Adaptive Learning**: Automatic weight optimization based on performance
  - Gradual weight adjustment (max 5% per cycle)
  - Weekly automatic adjustments (Sunday 00:00)
  - Weight history tracking
  - Manual override capability

- **💡 Performance Insights**: Auto-generated recommendations
  - Signal performance analysis
  - Drawdown warnings
  - Strategy recommendations
  - Market condition insights

- **📈 Analytics Dashboard**: Comprehensive analytics interface
  - Signal accuracy charts
  - Weight management panel
  - Performance trends

### Phase 3 Features (Implemented)

- **🔴 Live SSE Streaming**: Real-time event broadcasting via Server-Sent Events
  - Individual trader streams (`/api/stream/ai-trader/:id`)
  - All traders stream (`/api/stream/ai-traders`)
  - Automatic reconnection with 5-second retry
  - Heartbeat mechanism (30-second intervals)
  - Event buffering (last 100 events)

- **📊 AI Trader Dashboard Page**: Complete monitoring interface
  - Real-time status card with Start/Stop/Pause controls
  - Portfolio overview (Cash, Total Value, P&L)
  - Live activity feed with event history
  - Open positions display with unrealized P&L
  - Recent decisions with expandable reasoning

- **🎨 UI Components**:
  - `AITraderCard` - Status display with control buttons
  - `AITraderActivityFeed` - Live scrolling event stream
  - `TradeReasoningCard` - Expandable decision analysis
  - `SignalBreakdown` - Visual signal scores and confidence

- **🏆 Enhanced Leaderboard**: Clickable AI trader entries linking to dashboard

- **⚡ Event Types**: 
  - `status_changed` - Trader status updates (running/paused/stopped)
  - `analyzing` - Market analysis progress
  - `decision_made` - Trading decisions with reasoning
  - `trade_executed` - Order executions
  - `position_closed` - Position closures with P&L
  - `error` - Error notifications

### Previous Phases

#### Phase 1 Features (Implemented)

- **Database Schema**: Complete infrastructure for AI traders, decisions, and reporting
- **Backend API**: RESTful endpoints for AI trader management
- **Frontend Integration**: TypeScript types and API client
- **Leaderboard Integration**: AI traders compete alongside humans with special indicators

### AI Trader Components

- **Personality Configuration**: Customizable risk tolerance, capital allocation, and trading preferences
- **Signal Integration**: Weighted combination of ML, RL, sentiment, and technical analysis
- **Decision Logging**: Complete audit trail of all trading decisions with reasoning
- **Performance Tracking**: Real-time metrics including win rate, P&L, and drawdown
- **Daily Reports**: Automated performance summaries and insights (Phase 4)
- **Signal Accuracy**: Real-time tracking of signal source performance (Phase 4)
- **Adaptive Learning**: Automatic weight optimization based on accuracy (Phase 4)
- **Analytics Dashboard**: Comprehensive reporting and insights interface (Phase 4)

## Trading Leaderboard

Compete in a global trading competition! The leaderboard shows rankings of all paper trading participants by total return.

### Features

- **Filter Options**: View all traders, only humans, or only AI agents
- **AI Trader Indicators**: Special badges and avatars for AI traders
- **Performance Metrics**: Total return %, win rate, trade count
- **Your Rank**: See your current ranking and compare with others
- **Timeframe Selection**: View rankings for all-time, monthly, weekly, or daily performance

### How to Participate

1. **Login** and create your paper trading portfolio
2. **Execute trades** to appear in the leaderboard
3. **Track progress** and compete with other traders and AI agents
4. **Filter results** to see how you rank against humans or AI traders

## Paper Trading / Börsenspiel

Trade with virtual money to test your strategies without real risk!

### Features

- **100,000€ Virtual Starting Capital**
- **Multiple Product Types**:
  - Stocks (no leverage)
  - CFDs (up to 1:30 leverage)
  - Knock-Out Certificates (up to 1:100 leverage)
  - Factor Certificates (2x-10x daily leverage)
- **Realistic Trading Fees**:
  - Commission fees (flat or percentage-based)
  - Spread costs
  - Overnight fees for leveraged positions
- **Broker Profiles** with different fee structures:
  - Discount (low fees)
  - Standard (typical online broker)
  - Premium (best execution)
  - Market Maker (zero commission, wider spreads)
- **Risk Management**:
  - Stop-Loss and Take-Profit orders
  - Margin monitoring with warnings
  - Liquidation price display for leveraged positions
- **Performance Tracking**:
  - Win rate statistics
  - P&L breakdown
  - Fee analysis
  - Transaction history

### How to Use

1. **Login** (required for paper trading)
2. Navigate to **Paper Trading** page
3. Select a symbol and product type
4. Set quantity, leverage (if applicable), and optional stop-loss/take-profit
5. Review fees and click **Buy** or **Short**
6. Monitor your positions and close them anytime
7. Check your **Portfolio** page for performance metrics

### Regulatory Compliance (Simulated)

The simulation follows ESMA retail leverage limits:
- Forex: 1:30 max
- Major Indices: 1:20 max
- Stocks: 1:5 max
- Crypto: 1:2 max

## RL Trading Agents / Deep Learning Trader

Train virtual traders using Deep Reinforcement Learning that learn from historical market data!

### Features

- **PPO Algorithm**: State-of-the-art Proximal Policy Optimization
- **Advanced Transformer Architecture** (Optional): ~2.5-3M parameter neural network with:
  - Multi-scale CNN for temporal feature extraction (3, 5, 7, 14-day patterns)
  - Self-attention mechanism for temporal awareness
  - Market regime detection (trend/range/volatile/crash)
  - Multi-scale temporal aggregation (short/medium/long-term)
- **Configurable Agent Profiles**:
  - **Holding Periods**: Scalping, Intraday, Swing (1-7 days), Position (weeks/months), Investor
  - **Risk Profiles**: Conservative, Moderate, Aggressive, Very Aggressive
  - **Trading Styles**: Trend Following, Mean Reversion, Momentum, Breakout, Contrarian
  - **Broker Profiles**: Realistic fee structures matching Paper Trading
- **Technical Indicator Input**: 20+ indicators as observation features
- **Backtesting-based Training**: Agents are rewarded for profitable trades
- **GPU Acceleration**: CUDA support for faster training
- **Persistent Models**: Trained models saved and available as "advisors"

### Preset Agents

| Preset | Risk | Holding | Style |
|--------|------|---------|-------|
| Conservative Swing | Low | 3-7 days | Trend Following |
| Aggressive Momentum | High | 1-3 days | Momentum |
| Day Trader | Moderate | Intraday | Mean Reversion |
| Position Investor | Low | 1-3 months | Trend Following |

### How to Use

1. Navigate to **RL Agents** page
2. Click **+ New Agent** and configure parameters (or choose a preset)
3. *(Optional)* Enable **"🚀 Use Advanced Transformer Architecture"** for superior performance
4. Start training with historical data from your preferred symbols
5. Monitor training progress in real-time
6. Once trained, agents appear as **RL Advisors** in Trading Signals
7. View consensus signals from multiple trained agents

### GPU Training

For faster training with NVIDIA GPUs:

```bash
# Start with GPU support
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

Requires NVIDIA drivers and nvidia-container-toolkit installed.

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/NoMadAndy/DayTrader.git
cd DayTrader

# Install dependencies
cd frontend
npm install

# Start development server
npm run dev
```

### Building for Production

```bash
cd frontend
npm run build
```

## Real-Time Data Configuration

DayTrader supports multiple market data providers. By default, the app uses Yahoo Finance (requires no API key) for real-time data. To use other providers or configure API keys:

### Option 1: Configure API Keys via UI

1. Click the ☰ hamburger menu icon in the top left
2. Navigate to "API Settings" tab
3. Enter your API keys for the data providers you want to use
4. Click "Save & Apply"
5. Keys are stored locally in your browser (or synced if logged in)

### Option 2: Configure via Environment Variables

Create a `.env` file in the `frontend` directory:

```bash
# Copy the example file
cp .env.example .env
```

Add your API keys:

```bash
# Finnhub - Real-time stock quotes and news
# Get your free key at: https://finnhub.io/register
VITE_FINNHUB_API_KEY=your_finnhub_api_key

# Alpha Vantage - Stock data API
# Get your free key at: https://www.alphavantage.co/support/#api-key
VITE_ALPHA_VANTAGE_API_KEY=your_alpha_vantage_api_key

# Twelve Data - Financial data platform
# Get your free key at: https://twelvedata.com/register
VITE_TWELVE_DATA_API_KEY=your_twelve_data_api_key

# NewsAPI - Financial news
# Get your free key at: https://newsapi.org/register
VITE_NEWS_API_KEY=your_newsapi_key

# Preferred data source (yahoo, finnhub, alphaVantage, twelveData)
# Default is 'yahoo' (requires no API key)
VITE_PREFERRED_DATA_SOURCE=yahoo
```

### Supported Data Providers

| Provider | API Key Required | Features | Free Tier Limits |
|----------|-----------------|----------|------------------|
| **Yahoo Finance** | No | Quotes, Historical Data | Default (no key needed) |
| **Finnhub** | Yes | Quotes, Candles, News | 60 calls/min |
| **Alpha Vantage** | Yes | Quotes, Daily Data | 5 calls/min, 500/day |
| **Twelve Data** | Yes | Quotes, Time Series | 8 calls/min, 800/day |

### Additional Data Providers (Research)

For a comprehensive list of additional financial news and data providers that can be integrated (including German sources and free RSS feeds), see:

📚 **[docs/DATA_PROVIDERS.md](docs/DATA_PROVIDERS.md)**

This documentation covers:
- Finance-specific News APIs with free tiers (Marketaux, FMP, Tiingo, mediastack, NewsData.io)
- General News APIs with business/finance filters
- German RSS feeds (Börse Frankfurt, BaFin, Bundesbank, ECB/EZB, BMF)
- Open data sources (GDELT)
- Integration priorities and implementation patterns

## User Authentication & Settings

DayTrader supports optional user accounts with PostgreSQL for persisting settings:

### Features
- **User Registration/Login**: Create an account to sync settings across devices
- **Persistent Settings**: API keys and preferences stored securely on server
- **Custom Symbols**: Your custom stock symbols sync with your account
- **Session Management**: Secure token-based authentication (7-day sessions)

### Database Setup

The PostgreSQL database is optional. Without it, all settings are stored locally in your browser.

To enable user accounts, set the following in your `.env` file:

```bash
# PostgreSQL Configuration
POSTGRES_DB=daytrader
POSTGRES_USER=daytrader
POSTGRES_PASSWORD=your_secure_password_here
```

The database schema is created automatically on first startup.

## Architecture

DayTrader consists of four services:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Browser      │────▶│    Frontend     │────▶│    Backend      │
│                 │     │  (nginx/vite)   │     │   (Node.js)     │
└─────────────────┘     │    Port 3000    │     │   Port 3001     │
                        └─────────────────┘     └────────┬────────┘
                               │                         │
                               │  /api/* requests        │
                               └─────────────────────────┤
                                                         │
                        ┌────────────────────────────────┼─────────────────────┐
                        │                                │                     │
                        ▼                                ▼                     ▼
              ┌─────────────────┐            ┌─────────────────┐    ┌─────────────────┐
              │  Yahoo Finance  │            │     NewsAPI     │    │   PostgreSQL    │
              │      API        │            │                 │    │   Port 5432     │
              └─────────────────┘            └─────────────────┘    │  (User Data)    │
                                                    │               └─────────────────┘
                                                    │
                                                    ▼
                                           ┌─────────────────┐
                                           │   ML Service    │
                                           │   (PyTorch)     │
                                           │   Port 8000     │
                                           │   CUDA/GPU      │
                                           └─────────────────┘
```

- **Frontend**: React SPA served by nginx (production) or Vite (development)
- **Backend**: Express.js proxy server that handles external API calls and user authentication
- **ML Service**: Python/FastAPI service with PyTorch LSTM model for price predictions
- **PostgreSQL**: Optional database for user accounts and settings persistence

## ML-Based Price Prediction

The ML Service provides LSTM-based stock price predictions using historical data:

### Features
- **LSTM Neural Network**: Multi-layer LSTM trained on 60 days of historical data
- **20+ Technical Indicators**: Automatically calculated features (RSI, MACD, Bollinger Bands, etc.)
- **14-Day Forecast**: Predictions with confidence intervals
- **GPU Acceleration**: CUDA support for fast training (falls back to CPU if not available)

### Usage

1. Select a stock in the frontend
2. Click "Train Model" in the ML Prediction panel
3. Wait for training to complete (progress is shown)
4. View predictions with confidence scores

### GPU Requirements (Optional)

For CUDA acceleration:
- NVIDIA GPU with CUDA Compute Capability 3.5+
- NVIDIA Driver 525.60.13+
- NVIDIA Container Toolkit (for Docker GPU passthrough)

```bash
# Install NVIDIA Container Toolkit (Ubuntu)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

## Docker Deployment

### Prerequisites

- Docker 20.10+
- Docker Compose v2 (included with Docker Desktop)

### Quick Start with Docker

**Development mode (with hot reload):**
```bash
# Start both frontend and backend with hot reload
docker compose up

# Or run in background
docker compose up -d
```

The application will be available at http://localhost:3000 (or your configured `APP_PORT`).
The backend API runs on port 3001 (or your configured `BACKEND_PORT`).
Code changes in `frontend/src` and `backend/src` will trigger automatic hot reload.

**Production mode:**
```bash
# Build and run production image
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

# With build info (recommended for CI/CD)
BUILD_VERSION=1.0.0 BUILD_COMMIT=$(git rev-parse --short HEAD) BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ") \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

### Docker Commands

```bash
# View logs
docker compose logs -f

# Stop services
docker compose down

# Rebuild and restart (after code changes in production)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

# Remove volumes and start fresh
docker compose down -v
```

### Automatic Redeployment

For development, `docker-compose.override.yml` is automatically loaded and provides:
- Hot reload via Vite dev server
- Source code mounted as volumes for instant updates
- No rebuild needed for code changes

For production with automatic redeployment, integrate with CI/CD:
1. On code push, CI rebuilds the Docker image
2. CD pulls new image and restarts the container
3. Zero-downtime deployment via container orchestration

## Configuration

All configuration is managed through environment variables. See `.env.example` for required variables and their descriptions.

### Build Information

Build info (version, commit, build time) is visible in the app footer. Environment variables:
- `BUILD_VERSION` - Application version
- `BUILD_COMMIT` - Git commit hash
- `BUILD_TIME` - Build timestamp

## Technical Analysis Methods

### Trend Indicators
- **SMA (Simple Moving Average)**: Average price over N periods
- **EMA (Exponential MA)**: Weighted average favoring recent prices

### Momentum Indicators
- **RSI (Relative Strength Index)**: Measures overbought/oversold conditions (0-100)
- **MACD**: Moving Average Convergence Divergence for trend following
- **Stochastic Oscillator**: Compares closing price to price range

### Volatility Indicators
- **Bollinger Bands**: Volatility bands around moving average
- **ATR (Average True Range)**: Measures market volatility

### Volume Indicators
- **OBV (On-Balance Volume)**: Volume flow prediction
- **VWAP**: Volume Weighted Average Price

## Development

### Commit Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `test:` - Test additions/changes
- `ci:` - CI/CD changes
- `build:` - Build system changes

Breaking changes should be marked with `!` (e.g., `feat!:`) or include `BREAKING CHANGE` in the commit body.

## Security

- Never commit secrets or credentials
- All data access is tenant-scoped for multi-tenant isolation
- Input validation and safe error handling are required

## Disclaimer

⚠️ **This application is for educational and testing purposes only. It does not constitute financial advice. Always do your own research and consider risk management before trading.**

## License

See LICENSE file for details.
