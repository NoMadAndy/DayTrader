# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Real-time market data integration**
  - Multi-provider data service with automatic fallback
  - Finnhub API integration (quotes, candles, company news)
  - Alpha Vantage API integration (quotes, daily data)
  - Twelve Data API integration (quotes, time series)
  - Yahoo Finance integration (no API key required)
  - Unified data service that orchestrates multiple providers
  - Data caching with configurable duration
  - Symbol search across all providers
- **Financial news integration**
  - NewsAPI integration for stock-related news
  - Finnhub company news support
  - News panel component with time-ago formatting
  - News images and source attribution
- **API configuration UI**
  - In-app API key configuration panel
  - LocalStorage persistence for API keys
  - Environment variable support for API keys
  - Visual indicator for live data status
- **Data source selector**
  - UI to switch between data sources (mock, Finnhub, Alpha Vantage, Twelve Data, Yahoo Finance)
  - Live data indicator badge on price header
  - Refresh button to reload data
- **React hooks for data fetching**
  - `useStockData` for historical candle data
  - `useQuote` for real-time quotes with auto-refresh
  - `useNews` for stock news
  - `useSymbolSearch` for symbol lookup
  - `DataServiceProvider` context for app-wide configuration
- Updated .env.example with API key configuration
- Updated README with real-time data documentation
- **Docker Compose v2 deployment support**
  - Multi-stage Dockerfile for optimized production builds
  - Development Dockerfile with Vite hot reload
  - docker-compose.yml for standard deployment
  - docker-compose.override.yml for development with auto-rebuild on code changes
  - docker-compose.prod.yml for production deployment
  - nginx configuration with gzip, security headers, and SPA routing
  - Health checks for container orchestration
  - .dockerignore for optimized build context
- **AI-powered stock technical analysis WebApp**
  - React/TypeScript frontend with Vite
  - Interactive TradingView-style candlestick charts (lightweight-charts)
  - Technical indicators: SMA, EMA, RSI, MACD, Bollinger Bands, Stochastic, ATR, OBV, VWAP
  - AI forecast engine with weighted indicator analysis
  - Support and resistance level detection
  - Indicator confidence scoring
  - Documented reasoning for each analysis
- Modern, responsive UI with Tailwind CSS
- Stock selector with 8 popular stocks (AAPL, GOOGL, MSFT, AMZN, TSLA, NVDA, META, JPM)
- Toggle controls for chart indicators
- Build info visible in footer (version, commit, build time)
- README.md with project documentation and setup instructions
- CHANGELOG.md for tracking changes
- .env.example for environment variable documentation
- .gitignore to prevent committing sensitive files
