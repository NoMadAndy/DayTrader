# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-01-25

### Added
- **API-Datensparsamkeit** - Intelligentes Rate-Limiting für Provider mit Begrenzungen
  
  - **Rate-Limiter (Frontend)** - Per-Provider Quota-Tracking im Browser
    - Alpha Vantage: 25/Tag, 5/Min (sehr konservativ)
    - Twelve Data: 800/Tag, 8/Min
    - Finnhub: 60/Min (großzügig)
    - Yahoo Finance: Keine harten Limits
  
  - **Intelligentes Caching (Frontend)** - Provider-spezifische Cache-Dauern
    - Alpha Vantage: 5 Min (wegen strenger Limits)
    - Twelve Data: 3 Min
    - Finnhub/Yahoo: 1 Min
    - Historische Daten: 10 Min
  
  - **Request-Deduplizierung** - Identische gleichzeitige Anfragen werden zusammengeführt
  
  - **Automatischer Fallback** - Bei Rate-Limit wechselt zu anderem Provider
  
  - **API-Quota-Anzeige** - Neues UI-Widget zeigt verbleibendes Kontingent
    - Pro-Provider Fortschrittsbalken (täglich + pro Minute)
    - Warnung bei niedrigem Kontingent
    - In den Einstellungen unter "Datenquellen" sichtbar

- **Server-seitiger Cache (Backend)** - Datenbank-basierter Cache für alle Nutzer
  
  - **PostgreSQL Cache-Tabelle** - Persistenter Cache in `stock_data_cache`
    - Überlebt Server-Neustarts
    - Gemeinsam für alle Nutzer (Aktiendaten sind öffentlich)
    - Hit-Counter für Analyse
  
  - **Automatische Cache-Zeiten**:
    - Quotes: 1 Minute
    - Intraday-Charts: 5 Minuten
    - Tages-Charts: 1 Stunde
    - Firmeninfos: 24 Stunden
    - Symbol-Suche: 24 Stunden
  
  - **Cache-API-Endpoints**:
    - `GET /api/cache/stats` - Cache-Statistiken und Hit-Raten
    - `GET /api/cache/rate-limits` - Server-seitiger Rate-Limit-Status
    - `DELETE /api/cache/:symbol` - Manuelle Cache-Invalidierung
  
  - **Automatische Bereinigung** - Expired Entries alle 15 Min entfernt

## [1.4.2] - 2026-01-25

### Fixed
- **GPU/CUDA funktioniert jetzt in Docker** - Separates GPU-Dockerfile mit CUDA-PyTorch
  - Neues `ml-service/Dockerfile.gpu` basierend auf `nvidia/cuda:12.1.0-cudnn8-runtime`
  - `docker-compose.gpu.yml` verwendet jetzt das GPU-Dockerfile
  - CPU-Dockerfile (`Dockerfile.dev`) bleibt für Entwicklung ohne GPU
  - CUDA 12.1 kompatibel mit aktuellen NVIDIA-Treibern

## [1.4.1] - 2026-01-24

### Fixed
- **CUDA-Einstellung greift jetzt** - User-Setting "Use CUDA" wird nun an den ML-Service übergeben
  - `useCuda` wird beim Training-Request mitgesendet
  - ML-Service wählt Device (cuda/cpu) basierend auf User-Einstellung
  - Fallback auf CPU wenn CUDA nicht verfügbar aber angefordert

## [1.4.0] - 2026-01-24

### Added
- **Historisches Backtesting** - Handeln mit historischen Kursdaten
  
  - **Backtest-Sessions** - Erstelle Backtests mit beliebigem Zeitraum
    - Name, Startdatum, Enddatum und Startkapital konfigurierbar
    - Mehrere Sessions pro Benutzer möglich
    - Status-Tracking (aktiv/abgeschlossen)
  
  - **Zeitsimulation** - Spiele historische Kurse durch
    - Zeit vorspulen um 1 Tag, 1 Woche oder 1 Monat
    - Auto-Play-Modus für automatisches Durchspielen
    - Fortschrittsbalken zeigt aktuelle Position im Zeitraum
  
  - **Historisches Trading** - Kaufe und verkaufe zum historischen Preis
    - Market-Orders werden sofort zum historischen Kurs ausgeführt
    - Stop-Loss und Take-Profit werden bei Zeitfortschritt geprüft
    - Gebühren werden realistisch berechnet
  
  - **Backtest-Ergebnisse** - Detaillierte Performance-Analyse
    - Gesamtrendite, Netto-P&L, Gewinnrate
    - Max. Drawdown, Profit Factor
    - Equity-Kurve über den gesamten Zeitraum
    - Gewinner/Verlierer-Statistiken

- **Neue API-Endpunkte für Backtesting**
  - `POST /api/trading/backtest/session` - Backtest-Session erstellen
  - `GET /api/trading/backtest/sessions` - Alle Sessions abrufen
  - `GET /api/trading/backtest/session/:id` - Session-Details mit Positionen
  - `POST /api/trading/backtest/order` - Order im Backtest ausführen
  - `POST /api/trading/backtest/position/:id/close` - Position schließen
  - `POST /api/trading/backtest/session/:id/advance` - Zeit vorspulen
  - `GET /api/trading/backtest/session/:id/results` - Ergebnisse abrufen
  - `DELETE /api/trading/backtest/session/:id` - Session löschen

- **Neue Komponenten**
  - `BacktestPage` - Vollständige Backtesting-Oberfläche
  - Navigation-Eintrag "Backtest" mit Uhr-Icon

- **Neue Datenbank-Tabellen**
  - `backtest_sessions` - Backtest-Sessions mit Konfiguration
  - `backtest_positions` - Positionen innerhalb eines Backtests
  - `backtest_orders` - Orders innerhalb eines Backtests
  - `backtest_trades` - Ausgeführte Trades
  - `backtest_snapshots` - Equity-Kurve Snapshots

- **ML Settings greifen jetzt beim Training**
  - Einstellungen werden aus localStorage gelesen
  - Parameter (Epochen, Lernrate, Sequenzlänge, Vorhersagetage) werden an ML-Service übergeben
  - ML-Service nutzt übergebene Parameter statt nur Environment-Defaults
  - ML Settings werden pro User in PostgreSQL gespeichert

- **Erweiterte Trading-Features für Börsenspiel**
  
  - **Limit- und Stop-Orders** - Neben Market-Orders können nun auch Limit-, Stop- und Stop-Limit-Orders erstellt werden
    - Neue Order-Typ-Auswahl im Trading-Formular
    - Pending Orders werden in der TradingPage angezeigt
    - Orders können storniert werden (reserviertes Cash wird zurückerstattet)
  
  - **Automatische Order-Ausführung** - Stop-Loss, Take-Profit und Knock-Out werden automatisch ausgeführt
    - Backend-Logik für Trigger-Prüfung (`checkPendingOrders`, `checkPositionTriggers`)
    - Margin-Call und Zwangsliquidation bei kritischem Margin-Level
  
  - **Portfolio Equity-Kurve** - Grafische Darstellung der Portfolio-Entwicklung
    - EquityChart-Komponente mit interaktivem SVG-Liniendiagramm
    - Tägliche Snapshots werden automatisch um 22:00 UTC gespeichert
    - 90-Tage-Historie in der Portfolio-Übersicht
  
  - **Leaderboard / Rangliste** - Wettbewerb zwischen Tradern
    - Neue Seite `/leaderboard` mit globaler Rangliste
    - Sortierung nach Rendite (%)
    - Zeitfilter: Gesamt, Monat, Woche, Tag
    - Eigener Rang und Statistiken
    - Navigation über "Rangliste" im Hauptmenü

- **Neue API-Endpunkte**
  - `POST /api/trading/order/pending` - Pending Order erstellen
  - `DELETE /api/trading/order/:id` - Order stornieren
  - `GET /api/trading/portfolio/:id/orders/pending` - Pending Orders abrufen
  - `PUT /api/trading/position/:id/levels` - SL/TP einer Position ändern
  - `POST /api/trading/check-triggers` - Trigger-Prüfung manuell auslösen
  - `GET /api/trading/portfolio/:id/equity-curve` - Equity-Kurve abrufen
  - `GET /api/trading/leaderboard` - Globales Leaderboard
  - `GET /api/trading/leaderboard/rank` - Eigener Rang

- **Neue Komponenten**
  - `EquityChart` - Portfolio-Wert-Verlauf als Liniendiagramm
  - `PendingOrders` - Anzeige und Stornierung ausstehender Orders
  - `LeaderboardPage` - Vollständige Ranglisten-Seite

- **Watchlist-Trading Integration**
  - "Handeln"-Button direkt in der Watchlist für schnellen Trade-Zugang
  - Navigation zur Trading-Seite mit vorausgewähltem Symbol
  - Symbol wird aus URL-Parameter gelesen (`/trading?symbol=AAPL`)

- **Position-Management UI**
  - Stop-Loss und Take-Profit können für offene Positionen bearbeitet werden
  - Inline-Bearbeitungsformular in der Positionsliste

- **Automatisches Trigger-Polling**
  - Frontend prüft alle 60 Sekunden Preise und Trigger
  - Automatische Benachrichtigung bei ausgelösten SL/TP/Knockout
  - Live-Aktualisierung der Position-P&L mit aktuellen Kursen

### Fixed
- PostgreSQL reserved keyword conflict (`current_date` → `simulation_date`)
- BacktestPage modal and trading panel input styling (white on white text)
- HTML validation error: nested buttons in StockSelector

## [1.3.0] - 2026-01-20

### Added
- **Paper Trading / Börsenspiel** - Vollständige Trading-Simulation mit virtuellem Geld
  - **Virtuelles Portfolio** mit 100.000€ Startkapital
  - **Mehrere Produkttypen**: Aktien, CFDs, Knock-Out Zertifikate, Faktor-Zertifikate
  - **Realistische Handelsgebühren**: Kommissionen, Spreads, Overnight-Gebühren
  - **Hebelprodukte** mit bis zu 1:30 Hebel (ESMA-konform)
  - **Margin-System** mit Margin-Warnung und Liquidationsrisiko-Anzeige
  
- **Trading-Seite** (`/trading`)
  - Interaktive Order-Eingabe mit Live-Kostenvorschau
  - Symbol-Auswahl mit Echtzeit-Kursen
  - Produkttyp-Wahl (Aktie/CFD/Knockout/Faktor)
  - Hebel-Slider für CFDs und Hebelprodukte
  - Stop-Loss und Take-Profit Eingabe
  - Detaillierte Gebührenvorschau (Kommission, Spread, Break-Even)
  - Offene Positionen mit Live-P&L
  - Liquidations-Preis Anzeige für gehebelte Positionen
  
- **Portfolio-Seite** (`/portfolio`)
  - Übersicht: Gesamtwert, Bargeld, P&L-Anzeige
  - Trading-Statistiken: Win-Rate, Ø Gewinn/Verlust
  - Gebühren-Aufschlüsselung nach Typ
  - Positionshistorie (offen & geschlossen)
  - Transaktions-Historie
  - Broker-Profil Auswahl
  - Portfolio-Reset Funktion

- **Broker-Profile** mit unterschiedlichen Gebührenstrukturen
  - **Discount**: 1€ flat, 0.1% Spread
  - **Standard**: 4.95€ + 0.25%, 0.15% Spread
  - **Premium**: 9.90€ flat, 0.05% Spread
  - **Market Maker**: 0€ Kommission, 0.30% Spread

- **Backend Trading-Modul** (`backend/src/trading.js`)
  - Neue Datenbank-Tabellen: portfolios, positions, orders, transactions, fee_log
  - Gebühren-Berechnung für alle Produkttypen
  - Overnight-Fee Verarbeitung (täglich um Mitternacht)
  - Portfolio-Metriken und Performance-Tracking
  - Tenant-isolierte Datenhaltung

- **Trading API-Endpoints**
  - `GET /api/trading/broker-profiles` - Broker-Konfigurationen
  - `GET /api/trading/product-types` - Produkttyp-Konfigurationen
  - `POST /api/trading/calculate-fees` - Gebührenberechnung
  - `GET/POST /api/trading/portfolio` - Portfolio-Verwaltung
  - `GET/POST /api/trading/portfolio/:id/positions` - Positionen
  - `POST /api/trading/order/market` - Market Orders
  - `POST /api/trading/position/:id/close` - Position schließen
  - `GET /api/trading/portfolio/:id/transactions` - Transaktionshistorie
  - `GET /api/trading/portfolio/:id/metrics` - Performance-Metriken

### Changed
- Navigation erweitert mit "Paper Trading" und "Portfolio" Menüpunkten

## [1.3.0] - 2026-01-24

### Added
- **Multi-Provider Datenaggregation** - Unternehmensdaten werden von allen verfügbaren Quellen zusammengeführt
  - Yahoo Finance: Preisdaten, 52-Wochen-Range, Volumen, Unternehmensname
  - Finnhub (API-Key erforderlich): Unternehmensprofil (Marktkapitalisierung, Branche, ISIN), Finanzkennzahlen (KGV, Dividendenrendite, Beta)
  - Alpha Vantage (API-Key erforderlich): Unternehmensübersicht (Name, Sektor, KGV, EPS, Marktkapitalisierung)
  - Twelve Data (API-Key erforderlich): Echtzeit-Kurse
  - Automatischer Fallback: Wenn eine Quelle keine Daten hat, werden andere abgefragt
  - Datenquellen-Anzeige: Zeigt an, von welchen Providern die Daten stammen
  - **Hinweis**: Für vollständige Fundamentaldaten (KGV, Marktkapitalisierung, Dividenden) werden Finnhub oder Alpha Vantage API-Keys benötigt
- **Unternehmensname in Selector und Watchlist** - Namen werden von Datenanbietern geladen
  - StockSelector zeigt vollständigen Unternehmensnamen (z.B. "Apple Inc." statt "AAPL")
  - Watchlist zeigt ebenfalls den vollen Namen wenn verfügbar
  - Namen werden im Hintergrund geladen und automatisch aktualisiert
- **Erweiterte Unternehmenskennzahlen** - Neue Datenfelder hinzugefügt
  - Marktkapitalisierung in EUR und USD
  - KGV (P/E Ratio) mit Forward P/E
  - Dividendenrendite in Prozent
  - EPS (Earnings per Share)
  - Beta-Faktor
  - Branche und Sektor
  - ISIN und CUSIP Identifikatoren
- **Watchlist mit EUR-Preisen** - Preise werden jetzt auch in EUR angezeigt
  - Primärer Preis in EUR (grün), USD als Sekundärpreis
  - Marktkapitalisierung, KGV und Dividende werden angezeigt
  - Branche wird für jeden Titel angezeigt
  - Quellen-Indikator zeigt Anzahl der verwendeten Datenquellen
- **Company Info Panel** - Neues Panel im Dashboard mit Unternehmensinformationen
  - Preise werden in Euro (EUR) angezeigt, mit USD-Preis als Referenz
  - 52-Wochen Hoch/Tief mit visuellem Positionsindikator
  - Tagesvolumen
  - Börse und Währung
- **EUR/USD Wechselkurs** - Automatische Währungsumrechnung
  - Live-Kurs von Yahoo Finance
  - Caching für 5 Minuten um API-Limits zu schonen
  - Fallback-Kurs falls API nicht verfügbar
- **Watchlist-Integration im Dashboard** - StockSelector zeigt Watchlist-Symbole
  - Eingeloggte User sehen ihre Watchlist-Symbole
  - Nicht eingeloggte User sehen Standard-Symbole
- **Multi-Page Navigation** - App wurde von Single-Page auf Multi-Page Architektur umgestellt
  - React Router für Seitennavigation integriert
  - **Dashboard** (/) - Hauptansicht mit Charts, Prognosen und Trading-Signalen
  - **Watchlist** (/watchlist) - Eigene Seite für Watchlist-Verwaltung
  - **Einstellungen** (/settings) - Kombinierte Seite für API-Keys, ML, Datenquellen und Auth
  - **Info** (/info) - Ausführliche Erklärungen zur technischen Analyse
  - **Changelog** (/changelog) - Versionshistorie als eigene Seite
- **Navigation Bar** - Neue Navigationsleiste ersetzt das Hamburger-Menü
  - Logo und App-Name mit Versionsanzeige
  - Icon-basierte Navigation mit Labels auf größeren Bildschirmen
  - Aktiver Link wird hervorgehoben
  - Benutzer-Avatar und Quick-Login Zugang
  - Responsive Design für Mobile und Desktop

### Changed
- **HamburgerMenu** entfernt - Funktionalität auf eigene Seiten verteilt
- **Settings** - API-Keys, ML-Einstellungen, Datenquellen und Auth in einer kombinierten Seite
- **StockSelector** - Aus der Navigation entfernt, jetzt nur noch im Dashboard
- **Watchlist Symbolverwaltung** - Komplett überarbeitet
  - Nicht eingeloggte Benutzer: Sehen nur Standard-Symbole (AAPL, GOOGL, etc.) - kein Bearbeiten möglich
  - Eingeloggte Benutzer: Volle Kontrolle über eigene Symbolliste
  - Symbole werden von Server-Datenbank geladen (nicht mehr localStorage)
  - Add/Remove synchronisiert direkt mit Server-API
  - Keine "Custom"-Unterscheidung mehr - alle Symbole eines Users sind seine Symbole

### Fixed
- WatchlistPage verwendet jetzt Events für Symbol-Auswahl (kein Prop-Drilling mehr)

---

- **Watchlist Panel** - Neue Übersicht aller beobachteten Aktien im Hamburger-Menü
  - Zeigt alle Symbole mit aktuellem Preis und Änderung
  - Trading-Empfehlungen für 4 Haltedauern (1h, 1d, 1w, Long) pro Symbol
  - Farbcodierte Signale: 🚀 Starker Kauf, 📈 Kauf, ➡️ Halten, 📉 Verkauf, ⚠️ Starker Verkauf
  - Filter nach Haltedauer zum Vergleichen
  - Sortierung nach Name (A-Z) oder Score
  - Symbole hinzufügen/entfernen direkt in der Watchlist
  - Klick auf Symbol wechselt zur Detailansicht
  - Auto-Refresh aller Daten mit Batch-Verarbeitung
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
