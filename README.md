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

## Docker Deployment

### Prerequisites

- Docker 20.10+
- Docker Compose v2 (included with Docker Desktop)

### Quick Start with Docker

**Development mode (with hot reload):**
```bash
# Start with hot reload - automatically rebuilds on code changes
docker compose up

# Or run in background
docker compose up -d
```

The application will be available at http://localhost:3000 (or your configured `APP_PORT`).
Code changes in `frontend/src` will trigger automatic hot reload.

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
