# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Data Freshness Indicator** - Neuer Indikator zeigt Alter aller Daten
  - Farbcodierte Anzeige: Grün (aktuell), Gelb (nicht ganz aktuell), Rot (veraltet)
  - Separate Schwellwerte für verschiedene Datentypen:
    - Kurse: <5min grün, <30min gelb, >30min rot
    - News: <15min grün, <1h gelb, >1h rot
    - ML-Modelle: <24h grün, <7d gelb, >7d rot
  - Klick öffnet Detail-Dropdown mit allen Datenquellen
  - "Alle Daten aktualisieren" Button für synchronen Refresh
  - Icons 📊 (Kurse), 📰 (News), 🤖 (ML) zeigen Status auf einen Blick
- **Hamburger Menu** - Neues Hauptmenü links oben ersetzt das Zahnrad-Icon
  - API Settings mit allen Provider-Konfigurationen
  - Data Source Auswahl direkt im Menü
  - ML Settings für Training-Parameter (Epochen, Lernrate, Sequenzlänge, etc.)
  - Technical Analysis Info mit Erklärung aller Indikatoren
  - Changelog-Anzeige mit aktuellen Änderungen
  - Login/Registrierung für Benutzerkonten
  - 6 Tabs für übersichtliche Navigation
- **User-spezifische Einstellungen** - Alle Einstellungen pro User in der Datenbank
  - ML-Settings (Sequenzlänge, Vorhersage-Tage, Epochen, Lernrate)
  - GPU/CUDA und FinBERT Vorladen Optionen
  - API-Keys werden serverseitig synchronisiert
  - Einstellungen werden geräteübergreifend gespeichert
- **PostgreSQL Database** - Persistente Datenbankanbindung für Benutzereinstellungen
  - User-Tabelle mit sicherer Passwort-Hashung (PBKDF2)
  - Session-Management mit Token-basierter Authentifizierung
  - User Settings für Präferenzen und API-Keys
  - Custom Symbols pro Benutzer synchronisiert
  - Automatische Schema-Migration beim Start
- **User Authentication** - Vollständiges Authentifizierungssystem
  - Registrierung mit E-Mail-Validierung
  - Login mit Session-Token (7 Tage gültig)
  - Automatisches Cleanup abgelaufener Sessions
  - Auth-Status-Check für UI-Anpassung
- **User Settings Sync** - Serverseitige Einstellungsspeicherung
  - API-Keys werden verschlüsselt gespeichert (wenn eingeloggt)
  - Custom Symbols werden mit dem Konto synchronisiert
  - Fallback auf localStorage wenn nicht eingeloggt
- **Combined Trading Signals** - Trading-Signale kombinieren jetzt alle Datenquellen für präzisere Empfehlungen
  - Multi-Quellen-Analyse: News-Sentiment + Technische Indikatoren + ML-Preisprognosen
  - Adaptive Gewichtung je nach Zeitraum:
    - Kurzfristig (1h): 55% Sentiment, 35% Technisch, 10% ML
    - Täglich: 40% Sentiment, 40% Technisch, 20% ML
    - Wöchentlich: 25% Sentiment, 45% Technisch, 30% ML
    - Langfristig: 15% Sentiment, 45% Technisch, 40% ML
  - Beitrag jeder Datenquelle pro Signal sichtbar (📰 News, 📊 Technisch, 🤖 ML)
  - Intelligentes Reasoning basierend auf Quellenübereinstimmung
  - Automatische Normalisierung bei fehlenden Datenquellen
- **Trading Signal Summary** - Aggregierte Kauf-/Verkaufsempfehlungen basierend auf News-Sentiment
  - Signale für 4 Haltedauern: 1 Stunde (Scalping), 1 Tag (Daytrading), Wochen (Swing), Langfristig (Investment)
  - Gewichtete Sentiment-Aggregation (neuere News haben mehr Gewicht)
  - Momentum-Analyse (Trend der Stimmungsänderung)
  - Volatilitätsindikator (Streuung der Meinungen)
  - 5-Stufen-Signale: Stark Kaufen, Kaufen, Halten, Verkaufen, Stark Verkaufen
  - Visuelle Score-Balken und Begründungen pro Zeitraum
  - Disclaimer für nicht-Anlageberatung
- **FinBERT ML Sentiment Analysis** - Enhanced news sentiment with transformer-based analysis
  - ProsusAI/finbert model for accurate financial sentiment classification
  - REST API endpoints: `/api/ml/sentiment/analyze` and `/api/ml/sentiment/analyze/batch`
  - CUDA/GPU acceleration for fast batch processing
  - Toggle between FinBERT (🤖) and keyword-based (📝) analysis in UI
  - Automatic fallback to keyword analysis when ML service unavailable
  - Lazy model loading to reduce startup time (optional PRELOAD_FINBERT env)
- **News Sentiment Analysis** - Financial news now includes sentiment tags (Bullish/Bearish/Neutral)
  - Keyword-based sentiment analysis optimized for financial news
  - Domain-specific word lists (150+ positive/negative financial terms)
  - Negation handling and intensity modifiers for accurate scoring
  - Visual sentiment tags with emoji indicators (📈 Bullish, 📉 Bearish, ➖ Neutral)
  - Sentiment summary in news panel header showing distribution
  - Detected keywords displayed for transparency
- **Custom Stock Symbols** - Users can now add and manage custom stock/ticker symbols
  - Add new symbols via the stock selector dropdown
  - Custom symbols are persisted in localStorage
  - Visual distinction for custom symbols (green badge)
  - Remove custom symbols with delete button
  - Works with both mock data and live API providers
- **ML-based Price Prediction Service** - New Python/PyTorch service for LSTM-based stock price predictions
  - Multi-layer LSTM neural network trained on historical OHLCV data
  - Automatic technical indicator calculation (20+ features)
  - CUDA/GPU acceleration support for fast training
  - REST API endpoints for training, prediction, and model management
  - Background training with progress tracking
  - 14-day price forecast with confidence intervals
  - Model persistence (save/load trained models)
- **ML Forecast Panel** in frontend to display AI predictions alongside technical analysis
- **Backend proxy** for ML service requests

### Fixed
- **Production deployment: Fixed container port mapping** - Frontend container was mapping to Vite dev server port (5173) instead of nginx production port (80), causing 500 errors on `/api/*` endpoints because requests weren't being proxied to the backend
- **Docker Compose port conflict** - Moved `ports` and `healthcheck` from base `docker-compose.yml` to override files to prevent array merging that caused duplicate port bindings
- **Development API proxy** - Changed `VITE_API_BASE_URL` from `localhost:3001` to `backend:3001` so the Vite proxy can reach the backend container via Docker's internal DNS
- **API keys not restored on page reload** - DataServiceProvider now loads stored API keys from localStorage on initialization, so news and other API-dependent features work immediately after page reload

### Added
- **Backend proxy server for Yahoo Finance API**
  - Node.js/Express backend service to avoid CORS issues
  - Proxy endpoints for Yahoo Finance chart and search APIs
  - Health check and version endpoints
  - Docker containerization with production and development Dockerfiles
  - nginx reverse proxy configuration to route `/api` requests to backend
  - Vite dev server proxy for local development
  - Backend service auto-starts with `docker compose up`
- **Backend proxy for NewsAPI** - Added `/api/news/everything` endpoint to proxy NewsAPI requests, because NewsAPI's free tier requires server-side requests (returns 426 from browser)

### Changed
- **UI Vereinfachung** - Data Source und Technical Analysis Methods Panels aus Hauptansicht entfernt
  - Beide Funktionen sind jetzt im Hamburger-Menü verfügbar
  - Übersichtlichere Hauptansicht mit Fokus auf Charts und Signale
- **Yahoo Finance is now the default data source** - Changed from mock data to Yahoo Finance as the default provider since it requires no API key and provides real market data
- Yahoo Finance provider now uses backend proxy instead of direct API calls

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
