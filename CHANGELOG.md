# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **RL Training - Conv1d Tensor Size Mismatch** - Fixed tensor concatenation error in MultiScaleCNN
  - Error: `Sizes of tensors must match except in dimension 1. Expected size 60 but got size 61`
  - Root cause: Even kernel sizes (14) with manual padding calculation produced incorrect output length (61 instead of 60)
  - Solution: Changed all Conv1d layers to use `padding='same'` instead of manual padding values
  - PyTorch's 'same' padding automatically handles asymmetric padding for even kernel sizes
  - All convolution layers now consistently produce sequence length of 60, enabling successful concatenation
  - Updated documentation to explain padding strategy and avoid future issues
- **RL Training - Misleading GPU Warning** - Suppressed incorrect Stable Baselines3 warning about GPU usage
  - Warning claimed PPO is "primarily intended to run on the CPU" with MlpPolicy
  - This warning doesn't apply to custom Transformer+CNN architecture (~2.5-3M parameters)
  - Transformer architecture significantly benefits from GPU acceleration
  - Added targeted warning filter when using transformer architecture
  - Added GPU device logging (device name and VRAM) when GPU training is enabled
- **Transformer Architecture Shape Mismatch** - Fixed training crash with shape error `'[1, 60, 35]' is invalid for input of size 2105`
  - Root cause: Observation space includes 2100 temporal features (60×35) + 5 portfolio features = 2105 total
  - Previous code incorrectly used integer division `2105 // 60 = 35`, losing the 5 portfolio features
  - Solution: Split observations into temporal and portfolio features before processing
  - Added `n_portfolio_features` parameter (default: 5) to `TransformerFeaturesExtractor`
  - Portfolio features now processed through separate projection layer and concatenated with temporal features
  - Updated output dimension from 768 to 1024 (768 temporal + 256 portfolio features)
  - Updated parameter count logging to include new `portfolio_projection` layer
  - Fixes apply to both `forward()` and `get_regime_probs()` methods

### Added
- **Advanced Transformer-Enhanced PPO Architecture for RL Trading Agents** - New neural network architecture for superior trading performance
  - **Multi-Scale CNN Encoder**: Extracts features at different temporal scales (3, 5, 7, 14-day patterns)
  - **Transformer Encoder**: Self-attention mechanism for temporal awareness (4 blocks, 8-head attention)
  - **Market Regime Detector**: Classifies market phases (trend/range/volatile/crash)
  - **Multi-Scale Aggregation**: Combines short/medium/long-term perspectives (5/20/60 timesteps)
  - **Parameter Scale**: ~2.5-3M parameters vs ~300k for standard MLP architecture
  - **Backend Implementation**:
    - `rl-trading-service/app/networks/transformer_policy.py` - Core Transformer components
    - `rl-trading-service/app/networks/custom_features_extractor.py` - Stable Baselines3 integration
    - `rl-trading-service/app/agent_config.py` - New configuration fields (use_transformer_policy, transformer_d_model, etc.)
    - `rl-trading-service/app/trainer.py` - Automatic architecture selection with detailed logging
  - **Frontend UI**:
    - New checkbox in RL Agents Panel: "🚀 Use Advanced Transformer Architecture"
    - Collapsible advanced options panel for fine-tuning transformer parameters
    - Inline documentation explaining benefits and parameter counts
  - **Backward Compatible**: Existing MLP agents continue to work (default behavior unchanged)
  - **GPU Optimized**: Automatically uses CUDA when available
  - **Environment Variables**: Added DEFAULT_TRANSFORMER_* settings to .env.example

### Security
- **PyTorch Security Vulnerability (CVE-2025-32434)** - Upgraded PyTorch to >=2.6.0 to address critical security vulnerability
  - Updated `ml-service/requirements.txt` (torch>=2.6.0, torchvision>=0.21.0)
  - Updated `rl-trading-service/requirements.txt` (torch>=2.6.0, torchvision>=0.21.0)
  - Fixes FinBERT model loading error due to `torch.load` security restrictions

### Fixed
- **Authentication Error Handling** - Improved error messages and debugging for login/register issues
  - Enhanced CORS configuration with `allowedHeaders` and `credentials: true` for proper cookie support
  - Added detailed logging in auth endpoints for debugging login/register failures
  - PostgreSQL-specific error codes now return clearer messages (e.g., "Email already registered", "Database not properly initialized")
  - Frontend now shows more helpful messages when server is unreachable
  - Better distinction between network errors and authentication failures
- **Authentication Endpoints Not Working** - Fixed 400 Bad Request errors on login and register endpoints
  - CORS configuration was only allowing GET and OPTIONS methods
  - Added POST, PUT, DELETE methods to allowed CORS methods
  - Affects `/api/auth/register`, `/api/auth/login`, and other write endpoints

### Added
- **mediastack and NewsData.io Provider Integration** - Added two new news providers for expanded coverage
  - **mediastack Provider**: Multi-language news API with simple REST interface
    - `/api/mediastack/news` - Backend proxy endpoint with 5-minute caching
    - `mediastackProvider.ts` - Frontend TypeScript service
    - Supports keyword filtering and multi-language support
    - Free tier: ~100 calls/month
  - **NewsData.io Provider**: Multi-source news aggregator with comprehensive filtering
    - `/api/newsdata/news` - Backend proxy endpoint with 5-minute caching
    - `newsdataProvider.ts` - Frontend TypeScript service
    - Category filters and multi-language support
    - Free tier: ~200 requests/day
  - **Configuration Updates**: Added API key fields in both ApiConfigPanel and SettingsPage
    - New input fields with links to free API key registration
    - Integration into DataService for parallel news fetching
    - Added to available news sources list
    - API keys persist in localStorage and sync with server when authenticated
  - **Environment Variables**: Added VITE_MEDIASTACK_API_KEY and VITE_NEWSDATA_API_KEY to .env.example
- **New Provider Configuration in Settings Page** - Extended API Keys tab with new provider options
  - Organized into "Market Data APIs" and "News APIs" sections with visual indicators
  - Marketaux API Key field with description (sentiment analysis, multi-language support)
  - Financial Modeling Prep (FMP) API Key field
  - Tiingo API Key field (institutional news with historical archive)
  - German RSS Feeds toggle (Börse Frankfurt, BaFin, ECB, Bundesbank - no API key required)
  - All new fields sync with backend when user is authenticated
  - Added German and English translations for all new settings
- **Multi-Source News Integration for FinBERT Analysis** - Extended news aggregation with new data providers
  - **Backend RSS Feed Support**: New RSS parser integration with endpoints for German financial sources
    - `/api/rss/feeds` - List available RSS feed configurations
    - `/api/rss/feed/:feedId` - Fetch news from specific feed (boerse-frankfurt, bafin, ecb, bundesbank)
    - `/api/rss/all` - Aggregate news from all RSS feeds
  - **Marketaux Provider**: Finance-specific news API with multi-language support and sentiment data
    - `/api/marketaux/news` - Proxy endpoint for Marketaux API
  - **Financial Modeling Prep (FMP) Provider**: Comprehensive financial news with ticker-specific filtering
    - `/api/fmp/news/stock` - Stock-specific news
    - `/api/fmp/news/general` - General market news
  - **Tiingo Provider**: Institutional-grade news API with historical archive
    - `/api/tiingo/news` - News endpoint with ticker filtering
  - **Frontend Provider Services**: New TypeScript services for all providers
    - `rssProvider.ts` - RSS feed integration
    - `marketauxProvider.ts` - Marketaux API client
    - `fmpProvider.ts` - FMP API client
    - `tiingoProvider.ts` - Tiingo API client
  - **Enhanced DataService**: Parallel news fetching from all configured providers
    - All news sources now feed into unified news aggregation
    - Automatic deduplication by headline
    - Results sorted by recency and limited to prevent overwhelm
  - **API Configuration Panel Updates**: New API key inputs for Marketaux, FMP, Tiingo
    - Organized into Market Data and News API sections
    - RSS Feeds toggle (enabled by default, no API key required)
    - Links to free API key registration for all providers
- **Financial Data Providers Documentation** - Comprehensive research documentation for additional news and data providers
  - Created `docs/DATA_PROVIDERS.md` with detailed provider information
  - Finance-specific APIs with free tiers: Marketaux, Alpha Vantage News, FMP, Tiingo, EODHD, Alpaca, Benzinga
  - General News APIs: NewsAPI.org, mediastack, TheNewsAPI, NewsData.io, NewsAPI.ai
  - German RSS feeds: Börse Frankfurt, BaFin, Bundesbank, ECB/EZB, BMF, BAFA
  - Open data sources: GDELT
  - Integration priorities and implementation patterns
  - Environment variable templates for new providers

### Changed
- **Watchlist Desktop Layout Redesign** - Kompakte Tabellenansicht für bessere Platzausnutzung auf Desktop
  - Neue horizontale Tabellenansicht mit Spalten: Symbol, Kurs, Signal, Quellen, Perioden, Aktionen
  - Company Info (KGV, Marktkapitalisierung, Dividende) inline dargestellt als Badges
  - Alle Perioden (1h, 1d, 1w, Long) gleichzeitig sichtbar ohne Scrollen
  - Signal-Quellen-Breakdown übersichtlicher angeordnet
  - Bessere Nutzung des horizontalen Platzes auf großen Bildschirmen
  - Mobile Ansicht bleibt als vertikales Karten-Layout erhalten (responsive)
- **Watchlist Layout Redesign** - Übersichtlichere Darstellung mit optimaler Platznutzung
  - Standard-Sortierung ist jetzt nach Score (höchster zuerst) statt alphabetisch
  - Interaktive Quellen-Filter (Tech, News, ML, RL) direkt im Header anklickbar
  - Scores aktualisieren sich dynamisch basierend auf ausgewählten Quellen
  - Signal-Quellen werden prominenter angezeigt
  - Verbesserte Legende mit klaren Score-Schwellenwerten (≥50, ≥20, ±19, ≤-20, ≤-50)

## [1.12.10] - 2026-01-28

### Changed
- **Desktop Watchlist: Redesign des Handeln-Buttons** - Der kleine Icon-Button rechts wurde durch einen prominenten "Handeln" Button ersetzt
  - Neuer Button mit 💹 Emoji und "Handeln" Text für bessere Erkennbarkeit
  - Klick öffnet Dropdown mit Quick-Trade-Funktionalität (wie auf dem Dashboard)
  - Dropdown enthält: Portfolio-Guthaben, Buy/Short Toggle, Produkttyp-Auswahl (Aktie/CFD), Menge, Vorschau und Ausführen-Button
  - Link zur vollständigen Trading-Seite im Dropdown
  - Konsistentes Verhalten mit dem Dashboard Quick-Trade

## [1.12.9] - 2026-01-28

### Fixed
- **Mobile Watchlist: Doppelter Handeln-Button entfernt** - Der kleine Trade-Button rechts in der Übersicht ist jetzt auf mobilen Geräten ausgeblendet, da er bereits im ausklappbaren Bereich vorhanden ist

## [1.12.8] - 2026-01-28

### Fixed
- **RL-Agenten werden jetzt in der Watchlist korrekt geladen** - Signale von trainierten RL-Agenten fließen nun in die kombinierten Trading-Signale ein
  - Aktiviert `enableRLAgents: true` in der Signal-Konfiguration
  - Korrigiert `action_probabilities` Mapping für RL-Service Response (buy_small/medium/large → buy)
  - Verbesserte Cache-Validierung: Cache wird nur verwendet wenn er erweiterte Quellen (ML/RL/News) enthält
  - Erhöht Timeout für Signal-Promises auf 15s mit individuellen Timeouts
- **News werden jetzt für alle Aktien in der Watchlist geladen** - Finnhub News-Anfragen werden nicht mehr durch Frontend Rate-Limit blockiert
  - Entfernt `checkAndRecordRequest` für News (Backend cached bereits 5 Minuten)
  - NewsAPI nur als Fallback wenn weniger als 3 News von Finnhub vorhanden
  - Backend verwendet Default-Datumswerte wenn from/to nicht übergeben werden

### Changed
- **Watchlist Trading-Signale immer aktiv** - Signale werden jetzt IMMER beim Laden der Watchlist berechnet
  - Entfernt Abhängigkeit vom "Extended Signals" Modus
  - Alle Signalquellen (Tech, News, ML, RL) werden automatisch geladen
  - Progressive Fortschrittsanzeige während des Ladens (0-100%)
  
### Improved
- **Verbesserte Signal-Darstellung in der Watchlist**
  - Prominente Score-Anzeige im Signal-Badge (+32, -15, etc.)
  - Klare Signal-Quellen-Badges: 📊Tech, 📰News, 🤖ML, 🎯RL mit jeweiligem Score
  - Signal-Legende für Datenquellen (Tech/News/ML/RL) im Header
  
### Added
- **Mobile-optimierte Watchlist-Ansicht**
  - Tap-to-expand Funktionalität auf Mobilgeräten
  - Kompakte Standard-Ansicht mit expandierbaren Details
  - Schnellaktionen (Handeln/Entfernen) im erweiterten Bereich
  - Alle Zeitperioden (1h/1d/1w/LT) als klickbare Buttons mit Score
  
### Fixed (earlier)
- **Watchlist lädt Signale erst beim Klick** - Behoben: Signale werden jetzt automatisch beim Öffnen geladen

## [1.12.7] - 2026-01-28

### Fixed
- **cancelOrder falsche Gebührenberechnung** (Backend) - brokerProfile wird jetzt korrekt aus der Datenbank gelesen
  - Verhindert falsche Rückerstattungsbeträge beim Stornieren von pending Orders
  - Behebt Cash-Diskrepanzen im Portfolio nach Order-Stornierung
- **checkPendingOrders Race Condition** (Backend) - Doppelausführung von Orders verhindert
  - Orders werden jetzt mit Status 'executing' gesperrt bevor sie ausgeführt werden
  - Bei Fehlschlag wird Order zurück auf 'pending' gesetzt mit Fehlermeldung
  - Verhindert doppelte Trades bei gleichzeitigen Preischecks
- **useAutoRefresh Stale Interval** (Frontend) - Verwendet jetzt Refs für isPaused und interval
  - Verhindert veraltete Werte in setInterval-Callbacks
  - Intervall-Änderungen werden korrekt erkannt und angewendet
- **TradingPortfolioPage Stale Positions** (Frontend) - openPositions nutzt jetzt Ref-Pattern
  - Trigger-Check verwendet immer aktuelle Positionsliste
  - Behebt Problem wo neue Positionen nicht sofort im Preischeck enthalten waren

## [1.12.6] - 2026-01-28

### Fixed
- **Stale Closure in WatchlistPanel** - Watchlist-Preisrefresh nutzt jetzt Refs statt veraltete Closures
  - Symbole werden nun korrekt aktualisiert auch nach Hinzufügen/Entfernen von Einträgen
- **News-Fingerprint Logik** - Korrigierter Vergleich für News-Änderungserkennung
  - Verwendet jetzt konsistenten String-Fingerprint statt gemischte Typen
  - Vermeidet unnötige Timestamp-Updates bei jedem Render
- **Race Condition bei RL-Signalen** - Verhindert veraltete Signale bei schnellem Symbol-Wechsel
  - Symbol-Check nach async Response hinzugefügt
  - Automatisches Leeren von ML/RL-Daten bei Symbol-Wechsel
- **EUR/USD Wechselkurs dynamisch** - Kurs wird jetzt live vom API geladen
  - Automatische Aktualisierung alle 5 Minuten
  - Fallback auf 0.92 bei API-Fehler
  - `formatCurrencyValue()` nutzt jetzt den echten Kurs statt festen Wert

## [1.12.5] - 2026-01-28

### Fixed
- **RL-Signale in Watchlist Extended-Modus** - RL-Agenten-Signale werden jetzt korrekt geladen
  - Extended-Modus aktiviert jetzt ALLE Signalquellen (News, ML, RL) unabhängig von Einzeleinstellungen
  - Timeout für Signal-Laden auf 15 Sekunden erhöht
  - Debug-Logging hinzugefügt für bessere Fehlerbehebung

## [1.12.4] - 2026-01-27

### Added
- **📋 Erweiterte Watchlist-Signale** - News, ML & RL Signale optional in der Watchlist laden
  - **Neue Einstellungssektion**: "Watchlist-Einstellungen" in den Signalquellen-Einstellungen
  - **Toggle "Erweiterte Signale"**: Aktiviert das Laden von News-Sentiment, ML-Prognosen und RL-Signalen für alle Watchlist-Symbole
  - **Konfigurierbare Cache-Dauer**: 5-60 Minuten (Standard: 15 Min), um API-Aufrufe zu reduzieren
  - **Auto-Refresh Intervall**: 0-300 Sekunden einstellbar
  - **Server-seitiges Caching**: PostgreSQL-basierter Cache für berechnete Signale
    - Neue Backend-Endpoints: `/api/watchlist/signals/:symbol` (GET/POST/DELETE)
    - Batch-Endpoint: `/api/watchlist/signals/batch` für effizientes Laden mehrerer Symbole
    - TTL-basierter Cache mit konfigurierbarer Ablaufzeit
  - **Visual Indicator**: "✨ Extended" Badge in der Watchlist-Überschrift zeigt aktivierten Modus
  - **Graceful Fallback**: Bei Timeout oder Fehlern werden nur verfügbare Daten angezeigt

### Changed
- **WatchlistPanel**: Zeigt jetzt alle aktivierten Signalquellen wenn "Erweiterte Signale" aktiv ist
- **SignalSourceBadges**: Zeigt News 📰, ML 🤖 und RL 🎯 Badges wenn entsprechende Daten vorhanden sind

## [1.12.3] - 2026-01-27

### Added
- **📚 Umfassendes Info-Handbuch** - Komplett überarbeitete Hilfe-Seite
  - **Übersichtliche Einleitung**: Was macht die App? 4 Kernfunktionen einfach erklärt
  - **Trading-Signale verstehen**: 5-Stufen-Signal-Skala mit farbcodierten Karten
  - **Zeiträume erklärt**: Unterschiede zwischen 1h/1d/1w/Long mit Gewichtungs-Übersicht
  - **News Sentiment Analyse**: FinBERT-Funktionsweise mit Beispiel-Output
  - **Technische Indikatoren**: RSI, MACD, Bollinger, SMA/EMA mit visuellen Skalen
  - **ML-Vorhersage (LSTM)**: Schritt-für-Schritt wie das Modell funktioniert
  - **RL-Agenten**: Was ist Reinforcement Learning + alle 6 vortrainierten Agenten
  - **Watchlist-Features**: Signalquellen und Zeitraum-Filter erklärt
  - **Backtesting**: Metriken einfach erklärt (Sharpe Ratio, Drawdown, Win Rate)
  - **Paper Trading**: Virtuelles Portfolio und Leaderboard
  - **Glossar**: 8 wichtige Trading-Begriffe mit Farbcodierung
  - Alle Sektionen einklappbar für bessere Übersicht
  - Mobile-optimiertes Design

## [1.12.2] - 2026-01-27

### Added
- **📊 Datenquellen-Toggles im Dashboard** - Signal-Quellen direkt im Trading Signal Panel ein-/ausschalten
  - Neues Zahnrad-Icon im Trading Signal Panel Header
  - Aufklappbare Toggle-Leiste mit vier Quellen: News 📰, Technisch 📊, ML-Prognose 🤖, RL-Agent 🎯
  - Nicht verfügbare Quellen werden ausgegraut angezeigt
  - Änderungen werden sofort angewendet und persistent gespeichert
  - Kein Wechsel zur Einstellungsseite mehr nötig

- **🔍 RL-Agent Erklärbarkeit (Explainability)** - Neuer `/signal/explain` API-Endpoint
  - Erklärt **ehrlich und datenbasiert** warum ein RL-Agent seine Entscheidung getroffen hat
  - Keine Halluzinationen - nur tatsächliche Daten und gemessene Feature-Einflüsse
  - Liefert:
    - **Wahrscheinlichkeitsverteilung**: Wie wahrscheinlich waren Buy/Sell/Hold
    - **Feature Importance**: Welche technischen Indikatoren den größten Einfluss hatten (via Perturbation-Analyse)
    - **Marktindikatoren**: Aktuelle Werte von RSI, MACD, ADX, etc.
    - **Agent-Kontext**: Risikoprofil, Trading-Stil, Ziel-Haltedauer
    - **Disclaimer**: Ehrlicher Hinweis zu den Grenzen der Interpretierbarkeit

- **🎯 Interaktive Agent-Erklärungen im RLAdvisorPanel**
  - Klick auf einen Agenten zeigt ausklappbares Detail-Panel
  - **Wahrscheinlichkeitsbalken**: Visuelle Darstellung Buy/Hold/Sell

- **📋 Signal-Quellen in der Watchlist**
  - **Desktop**: Neue "Quellen"-Zeile zeigt alle Signalquellen mit Score (📊 Tech, 📰 News, 🤖 ML, 🎯 RL)
  - **Mobile**: Kompakte Mini-Indikatoren neben dem Signal-Badge (↑↑/↑/→/↓/↓↓)
  - Farbcodierung: Grün = bullish, Rot = bearish, Grau = neutral
  - Tooltip zeigt Details bei Hover
  - Erweiterte Legende erklärt die Quellen-Icons
  - **Top-Einflussfaktoren**: Balkendiagramm zeigt welche Features die Entscheidung am meisten beeinflusst haben
  - **Aktuelle Marktdaten**: Die konkreten Werte von RSI, MACD, ADX etc.
  - **Agent-Profil**: Trading-Stil, Risikoprofil, Haltedauer, Broker-Profil

### Fixed
- **RL-Signale im Trading Signal Panel** - "Keine gültigen RL-Signale" behoben
  - Root Cause: RL Service gibt detaillierte Action-Wahrscheinlichkeiten zurück (`buy_small`, `buy_medium`, `buy_large`, `sell_small`, `sell_medium`, `sell_all`, `hold`), aber Frontend erwartete aggregierte Werte (`buy`, `sell`, `hold`)
  - Fix: DashboardPage.tsx aggregiert jetzt die detaillierten Wahrscheinlichkeiten korrekt:
    - `buy` = `buy_small` + `buy_medium` + `buy_large`
    - `sell` = `sell_small` + `sell_medium` + `sell_all`
    - `hold` = `hold`
  - RL-Agenten-Signale werden jetzt korrekt im Trading Signal Panel angezeigt

- **RL-Signale wechseln nicht mehr zufällig alle paar Sekunden**
  - Root Cause 1: RL-Model verwendete `deterministic=False` bei der Inferenz, was bei jedem Aufruf unterschiedliche Aktionen basierend auf Wahrscheinlichkeiten lieferte
  - Root Cause 2: Environment startete bei jedem `reset()` an einer zufälligen Position in den Daten
  - Root Cause 3: Frontend lud RL-Signale bei jeder `stockData`-Referenzänderung neu (auch wenn Daten identisch waren)
  - Fix 1: `trainer.py` verwendet jetzt `deterministic=True` für konsistente Signale
  - Fix 2: Neuer `inference_mode` in `TradingEnvironment` - startet immer am Ende der Daten für aktuelle Markt-Signale
  - Fix 3: `DashboardPage.tsx` verwendet Fingerprint-Vergleich und lädt RL-Signale nur bei echten Datenänderungen neu
  - **Ergebnis**: Mehrere API-Aufrufe mit identischen Daten liefern jetzt exakt dieselben Signale

- **RL-Agent Toggle kann wieder eingeschaltet werden**
  - Bug: RL Toggle konnte deaktiviert, aber nicht wieder aktiviert werden
  - Root Cause: `available`-Prop hing von geladenen RL-Signalen ab (`rlSignals.length > 0`). Beim Deaktivieren wurden Signale geleert → Toggle wurde als "nicht verfügbar" markiert
  - Fix: `available` hängt jetzt nur vom Service-Status ab (`rlServiceAvailable`), nicht von den aktuell geladenen Daten

## [1.12.1] - 2026-01-27

### Fixed
- **TrainingConsole Codespace-Kompatibilität** - Training-Logs werden jetzt über Backend-Proxy (`/api/rl/train/logs`) abgerufen statt direkt an localhost:8001
  - Funktioniert jetzt korrekt in GitHub Codespaces und anderen Remote-Umgebungen
  - Neuer Proxy-Endpoint im Backend für Training-Logs

## [1.12.0] - 2026-01-27

### Added
- **📺 Live Training Console** - Echtzeitanzeige des Trainingsfortschritts für RL Agents
  - Aufklappbare Konsole mit detaillierten Training-Logs
  - Live-Fortschrittsbalken mit Prozentanzeige und Timestep-Zähler
  - Farbkodierte Log-Level (Info, Warning, Error, Success)
  - Auto-Scroll mit manueller Überschreibung
  - Episode-Tracking mit Reward-Anzeige
  - Best-Reward-Meilensteine werden hervorgehoben
  - Konsole bleibt nach Training für Review sichtbar

### Changed
- **Verbessertes Training-Feedback**: Backend sendet detaillierte Logs während des gesamten Trainingsprozesses
  - Datenabholung wird protokolliert
  - Modell-Architektur und Hyperparameter werden angezeigt
  - Fortschritt in 1%-Schritten mit Mean Reward
  - Evaluierungs-Ergebnisse nach Trainingsende

### Technical
- Neuer `/train/logs/{agent_name}` Endpoint für Training-Logs abrufen
- Neuer `/train/logs/{agent_name}/stream` SSE-Endpoint für Live-Streaming
- `TrainingConsole` React-Komponente für aufklappbare Log-Anzeige
- Log-Callback-System im Trainer für strukturierte Logging

## [1.11.0] - 2026-01-27

### Added
- **🤖 RL Trading Service** - Neuer Deep Reinforcement Learning Service für automatisiertes Trading
  - **Trainierbare virtuelle Trader**: PPO-Algorithmus (Proximal Policy Optimization) lernt aus historischen Marktdaten
  - **Konfigurierbare Agent-Profile**:
    - Haltezeiträume: Scalping, Intraday, Swing (1-7 Tage), Position (Wochen/Monate), Investor
    - Risikoprofile: Conservative, Moderate, Aggressive, Very Aggressive
    - Trading-Stile: Trend Following, Mean Reversion, Momentum, Breakout, Contrarian, Mixed
    - Broker-Profile mit realistischen Gebühren (Discount, Standard, Premium, Market Maker)
  - **Backtesting-basiertes Training**: Agents werden für profitable Trades belohnt
  - **Risk Management**: Stop-Loss, Take-Profit, Trailing Stop automatisch berücksichtigt
  - **Technische Indikatoren**: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ADX, Stochastik, etc.
  - **CUDA/GPU-Unterstützung**: Schnelleres Training mit NVIDIA GPUs
  - **Persistente Modelle**: Trainierte Modelle bleiben über Container-Neustarts erhalten

- **RL Agents Page** - Neue dedizierte Seite für Agent-Management (`/rl-agents`)
  - Übersicht aller trainierten Agents mit Leistungsmetriken
  - Agent-Erstellung mit Preset-Auswahl (Conservative Swing, Aggressive Momentum, Day Trader, Position Investor)
  - Echtzeit-Training-Fortschrittsanzeige mit Live-Updates
  - Performance-Metriken: Durchschnittliche Rendite, Max/Min Return, Win Rate
  - **Symbol-Auswahl**: Symbole aus Datenbank (historische Daten) und eigener Watchlist wählbar

- **RL Advisor Panel** - Trading-Signale von trainierten Agents
  - Konsens-Signal aus mehreren Agents
  - Individuelle Signale mit Konfidenz und Stärke
  - Integration in Dashboard und Trading-Signale

- **🎯 Signal-Quellen-Auswahl** - Neue Einstellungsseite für Trading-Signale
  - **Auswählbare Datenquellen**:
    - 📰 News-Sentiment: Stimmungsanalyse aus Nachrichten
    - 📊 Technische Analyse: RSI, MACD, Bollinger, Stochastik
    - 🤖 ML-Prognose: LSTM-basierte Preisvorhersagen
    - 🎯 RL-Agenten: Signale von trainierten RL-Modellen
  - **Agent-Selektor**: Wähle welche trainierten Agents für Signale verwendet werden
  - **Dynamische Gewichtung**: Gewichte werden automatisch je nach Zeitrahmen angepasst
  - **Einstellungen → Signal-Quellen**: Neuer Tab in den Einstellungen

- **Frontend Service** - Neuer `rlTradingService.ts` für RL-API-Kommunikation
  - Agent-Verwaltung (Liste, Status, Löschen)
  - Training starten und überwachen
  - Signale abrufen (einzeln, multi-agent, quick)
  - Konfigurationsoptionen für UI

- **Backend Proxy** - RL Trading Service Proxy-Endpunkte
  - `/api/rl/health`, `/api/rl/info` - Service-Status
  - `/api/rl/agents` - Agent-Verwaltung
  - `/api/rl/train` - Training starten
  - `/api/rl/signal` - Signale abrufen

### Changed
- **Docker Compose** erweitert mit `rl-trading-service` Container
- **GPU Compose** erweitert für RL-Service CUDA-Unterstützung
- **Navigation** um "RL Agents" Link erweitert
- **TradingSignalPanel** zeigt jetzt auch RL-Agent-Signale (🎯) in der Legende

### Technical Details
- Eigener Docker-Container mit Stable Baselines3 + PyTorch
- Gymnasium-kompatible Trading-Umgebung
- 7 diskrete Aktionen: Hold, Buy (Small/Medium/Large), Sell (Small/Medium/All)
- Observation: 60-Perioden Fenster mit OHLCV + Indikatoren + Portfolio-Status
- Reward: Portfolio-Rendite + Holding-Period-Alignment + Risk-Adjusted Returns

## [1.10.0] - 2026-01-27

### Added
- **Mehrsprachige Benutzeroberfläche** - Deutsch und Englisch wählbar
  - Neue Einstellungsseite "Darstellung" mit Sprach- und Währungsauswahl
  - Alle UI-Texte übersetzt (Navigation, Einstellungen, Trading, Dashboard, Watchlist, Leaderboard)
  - LoginForm und RegisterForm vollständig übersetzt
  - Fehlermeldungen und Bestätigungen in beiden Sprachen
  - Aktienbegriffe und Symbole bleiben englisch, um Missverständnisse zu vermeiden
  - Sprache wird lokal gespeichert und mit Account synchronisiert
  - Standard: Deutsch

- **Währungsumrechnung** - Anzeige in USD oder EUR
  - Alle Preise, Werte und Beträge werden in der gewählten Währung angezeigt
  - Automatische USD→EUR Umrechnung (ca. 0.92 Wechselkurs)
  - Betrifft: Trading-Seite, Portfolio-Übersicht, Dashboard, Leaderboard, Quick Trade
  - Standard: US Dollar (USD)

- **SettingsContext** - Zentraler Context für Benutzereinstellungen
  - `useSettings()` Hook für React-Komponenten
  - `formatCurrencyValue()` Export für Service-Funktionen
  - `getCurrentCurrency()` für direkte Abfrage der Währung
  - Persistenz via localStorage und Server-Sync

### Changed
- **Settings-Seite reorganisiert** - Neuer Tab "Darstellung" zwischen Konto und API Keys
- **Navigation übersetzt** - Alle Navigationspunkte verwenden jetzt Übersetzungsschlüssel
- **formatCurrency globalisiert** - tradingService und companyInfoService nutzen jetzt globale Einstellung
- **Seitenkomponenten aktualisiert** - WatchlistPage, DashboardPage, LeaderboardPage, TradingPortfolioPage verwenden jetzt t() und formatCurrency()

## [1.9.1] - 2026-01-27

### Added
- **Dynamisches Changelog** - Changelog wird jetzt live vom Backend geladen
  - Neuer `/api/changelog` Endpoint parst CHANGELOG.md automatisch
  - Version, Commit und Build-Zeit werden vom Server bereitgestellt
  - Keine manuellen statischen Updates mehr nötig
- **Version aus package.json** - Backend und Frontend lesen Version automatisch
  - Keine hartcodierten Versionen mehr in Dockerfiles oder Configs

### Fixed
- **Mobile Browser Zoom** - Input-Felder zoomen nicht mehr beim Fokussieren
  - Schriftgröße auf 16px für Mobile (iOS Safari Zoom-Prevention)
  - Betrifft: StockSelector Suchfeld und Symbol-Hinzufügen-Formular

## [1.9.0] - 2026-01-27

### Added
- **Quick Trade Dropdown auf Dashboard** - Schnelles Handeln direkt vom Dashboard aus
  - Sticky Button neben StockSelector zum sofortigen Trading
  - Dropdown zeigt verfügbares Guthaben und aktuellen Kurs
  - Kauf/Short-Auswahl mit Produkttyp (Aktie/CFD) und Mengenfeld
  - Order-Vorschau mit Gesamtbetrag vor Ausführung
  - Erfolgsmeldung mit neuem Kontostand nach Trade

### Changed
- **Mobile-optimierte UI** - Verbesserte Responsivität für alle Hauptkomponenten
  - Trading-Tabs von 5 auf 3 reduziert (Handeln, Übersicht, Einstellungen)
  - Einstellungs-Tab nutzt volle Breite auf Mobilgeräten
  - Chart-Indikatoren jetzt integriert im Chart-Panel (immer sichtbar, nicht mehr ausklappbar)
  - Standard-Indikatoren aktiviert: Bollinger Bands, MACD, RSI, Volume
- **Quick Trade Dropdown-Position** - Fixed-Positionierung auf Mobile für volle Viewport-Breite

### Fixed
- **Mobile Input-Bug behoben** - Letzte Ziffer in Zahlenfeldern kann jetzt gelöscht werden
  - Mengenfelder im Trading verwenden jetzt String-State mit onBlur-Validierung
  - ML-Einstellungsfelder (Epochs, Tage) ebenfalls korrigiert
  - Gilt für: TradingPortfolioPage, SettingsPage, HamburgerMenu

## [1.8.0] - 2026-01-26

### Changed
- **Paper Trading & Portfolio zu einer Seite zusammengeführt**
  - Neue kombinierte "Trading"-Seite mit Tab-Navigation
  - Tabs: Handeln, Positionen, Übersicht, Historie, Einstellungen
  - Übersichtlicheres Layout mit Portfolio-Summary im Header
  - Offene Positionen direkt neben Order-Panel sichtbar
  - Alte separate Seiten entfernt (TradingPage, PortfolioPage)
  - Navigation vereinfacht: Ein "Trading"-Menüpunkt statt zwei
- **Konsistente Seitenbreiten** - Leaderboard jetzt mit gleicher Breite wie andere Seiten
- **StockSelector im Dashboard um 20px nach oben verschoben** für bessere Platzierung

### Fixed
- **Symbol-Wechsel beim Trading repariert** - Wenn man über die Watchlist zum Trading kommt, kann man jetzt wieder andere Aktien auswählen

### Added
- **Erweiterter StockSelector mit Live-Kursen und Indikatoren**
  - Button zeigt jetzt aktuellen Kurs und Tagesänderung direkt an
  - Dropdown-Liste zeigt für jedes Symbol: Kurs, Änderung %, Market Cap, P/E Ratio, Volumen
  - Visuelle 52-Wochen-Range-Anzeige mit aktuellem Kurs als Marker
  - Automatische Kurs-Aktualisierung alle 30 Sekunden wenn Dropdown geöffnet
- **Integrierte Daten-Aktualitätsanzeige im StockSelector**
  - Freshness-Icons (📊 Kurse, 📰 News, 🤖 ML) direkt sichtbar mit Farbcodierung
  - Grün = aktuell, Gelb = etwas veraltet, Rot = alt
  - Refresh-Button zum Aktualisieren aller Daten mit einem Klick
  - Zeigt Alter der ältesten Datenquelle an (z.B. "2m", "15m")
- **Sticky-Header unter Navigation**
  - StockSelector bleibt beim Scrollen sichtbar (unter der Navigation)
  - Halbtransparenter Hintergrund mit Blur-Effekt
- **Gemeinsames Caching für alle API-Provider** - User-API-Keys teilen Cache mit allen Nutzern
  - Neue Backend-Proxy-Endpoints für Finnhub, Alpha Vantage und Twelve Data
  - Alle API-Antworten werden in PostgreSQL gecached
  - Wenn User A Daten mit seinem API-Key holt, profitiert User B davon (kein erneuter API-Call nötig)
  - Reduziert API-Verbrauch plattformweit erheblich
  - API-Keys werden sicher als HTTP-Header übertragen (nicht in URL)
  - Cache-Hit-Logging zeigt welche Daten bereits im Cache waren
- **Server-Sent Events (SSE) für Echtzeit-Kursaktualisierungen** - GUI zeigt Kursänderungen sofort an
  - Neuer SSE-Endpoint `/api/stream/quotes` für Echtzeit-Streaming
  - Neue React-Hooks: `useRealTimeQuotes` und `useBackgroundJobsStatus`
  - Automatische Reconnection mit Exponential Backoff bei Verbindungsabbruch
  - Hintergrund-Jobs broadcasten Updates an alle verbundenen Clients
- **Company Info Panel restauriert & erweitert** - Dashboard zeigt jetzt wieder Unternehmensinfos am unteren Bildschirmrand
  - Instrumententyp-Erkennung: Aktie, ETF, Optionsschein/Turbo, Zertifikat, Future, CFD, Option, Anleihe
  - Farbcodierte Badge mit Icon für jeden Instrumententyp
  - Wertpapier-Kennungen: ISIN, WKN (automatisch aus deutscher ISIN abgeleitet), CUSIP
  - Derivat-spezifische Warnung mit Details: Hebel, Knock-Out-Level, Strike, Verfall, Basiswert, Overnight-Gebühren, Spread
  - Bestehendes: Marktkapitalisierung, KGV, Dividendenrendite, 52-Wochen-Bereich, Volumen, Beta

### Changed
- **Provider-Calls über Backend geroutet** - Alle externen API-Calls gehen jetzt über das Backend
  - Finnhub: `/api/finnhub/*` (quote, candles, profile, metrics, news, search)
  - Alpha Vantage: `/api/alphavantage/*` (quote, daily, intraday, overview, search)
  - Twelve Data: `/api/twelvedata/*` (quote, timeseries, search)
  - Vermeidet CORS-Probleme
  - Ermöglicht serverseitiges Caching für alle User

## [1.7.0] - 2026-01-25

### Added
- **Indicator Agreement** - Jeder Trading-Signal-Indikator zeigt jetzt sein Agreement mit anderen Quellen an
  - Visuelle Indikatoren: ● stark (grün), ◐ moderat (blau), ○ schwach (gelb), ⚠ widersprüchlich (rot)
  - Tags mit starkem Agreement haben grüne Umrandung, widersprüchliche haben gestrichelte rote Umrandung
  - Tooltip zeigt Original-Gewicht und effektives Gewicht nach Agreement-Anpassung
  - Legende in der Footer-Zeile erklärt die Symbole
- **Technical Indicator Agreement** - Auch im AI Forecast Panel zeigt jeder technische Indikator sein Agreement an
  - Jeder Indikator (RSI, MACD, Bollinger, etc.) zeigt Übereinstimmung mit anderen
  - Widersprüchliche Indikatoren erhalten gestrichelte rote Umrandung und Warnhinweis
  - Legende oben rechts im Indicator-Bereich
- **News Sentiment Agreement** - Im News Panel zeigt jede Nachricht ihr Agreement mit dem allgemeinen Sentiment
  - Jede News zeigt Übereinstimmung mit anderen News-Sentiments (●/◐/○/⚠)
  - Widersprüchliche News erhalten gestrichelte rote Umrandung
  - Agreement-Indikator im Sentiment-Tag sichtbar
  - Kompakte Legende im Header

### Changed
- **BREAKING: Mock-Daten komplett entfernt** - Die Anwendung zeigt jetzt nur noch echte, aktuelle Marktdaten an
  - Yahoo Finance ist der neue Standard-Provider (kein API-Key erforderlich)
  - Mock-Data-Option aus Datenquellen-Auswahl entfernt
  - Alle simulierten/erfundenen Daten aus der Codebasis entfernt
  - Bei API-Fehlern wird `null` zurückgegeben statt gefälschte Daten
  - Standard-Aktienliste (AAPL, MSFT, etc.) bleibt für Watchlist erhalten, Preise kommen live von APIs
- **Trading-Signal-Gewichtung** - Bei niedrigem Agreement zwischen Indikatoren wird deren Gewicht automatisch reduziert
  - Starke Übereinstimmung: 100% Gewichtung
  - Moderate Übereinstimmung: 85% Gewichtung
  - Schwache Übereinstimmung: 60% Gewichtung
  - Widersprüchliche Signale: 40% Gewichtung
- **Verbessertes Price Target** - Price Target zeigt jetzt immer eine sinnvolle Vorhersage
  - Bei NEUTRAL: Bewegung basierend auf Bias-Richtung und Volatilität (nicht mehr +0.0%)
  - Bei BUY/SELL: Differenzierte Ziele (40-60% Richtung Support/Resistance)
  - Bei STRONG_BUY/SELL: Aggressivere Ziele (70-90% Richtung Support/Resistance)
  - Sicherheitsbegrenzung: Max ±15% vom aktuellen Preis

### Fixed
- **ML Daten-Aktualität-Indikator** - Zeigt jetzt korrekt keinen Timestamp wenn kein Modell für das aktuelle Symbol trainiert ist
  - Vorher blieb der Timestamp vom letzten Symbol mit Modell erhalten
  - Jetzt wird der ML-Timestamp auf `null` gesetzt wenn kein Modell existiert oder der ML-Service nicht verfügbar ist

### Removed
- `mockData.ts` - Alle Mock-Datengenerierung entfernt
- `'mock'` Datenquelle aus dem Typ `DataSourceType`
- Mock-Fallback bei API-Fehlern (zeigt jetzt Fehlermeldung)
- Mock-bezogene UI-Elemente und Hinweise

## [1.6.3] - 2026-01-25

### Added
- **Smart Default Symbol** - Dashboard zeigt automatisch die vielversprechendste Aktie
  - Analysiert alle Symbole in der Watchlist beim App-Start
  - Bewertet basierend auf kombinierten Trading-Signalen (täglich gewichtet)
  - Cache für 5 Minuten für schnelle Ladezeiten
  - Aktualisiert sich automatisch bei Login/Logout
  - Fallback auf AAPL wenn keine Daten verfügbar

## [1.6.2] - 2026-01-25

### Added
- **Langzeit-Historische Daten für Backtesting** - Unterstützt jetzt Backtests von 2000 bis heute
  
  - **Datenbankgestützte Preishistorie** - Historische Kursdaten werden in PostgreSQL gespeichert
    - Einmaliges Laden von Yahoo Finance (bis zu 20+ Jahre Daten)
    - Daten werden für alle Benutzer konsistent geteilt
    - Automatisches Laden bei erstem Zugriff auf einen Zeitraum
    - Schnelles Abrufen aus DB bei wiederholtem Zugriff
    
  - **Neue Backend-API Endpoints**
    - `GET /api/historical-prices/:symbol` - Historische Preise abrufen
    - `GET /api/historical-prices/:symbol/availability` - Verfügbarkeit prüfen
    - `GET /api/historical-prices/symbols/available` - Alle gecachten Symbole
    - `POST /api/historical-prices/:symbol/refresh` - Daten aktualisieren

- **Dashboard-Analyse im Backtesting** - Vollständige Marktanalyse für historische Daten
  
  - **Trading Signal Panel** - Kombinierte Handelssignale (Stündlich, Täglich, Wöchentlich, Langfristig)
    - Basiert auf technischen Indikatoren für den simulierten Zeitpunkt
    - Zeigt Bias (Bullish/Bearish/Neutral) und Volatilitäts-Indikator
    - Integriert ML-Predictions in die Signal-Berechnung
    
  - **AI Forecast Panel** - Preisprognosen für historische Daten
    - Generiert Preis-Targets basierend auf den Daten bis zum Simulationsdatum
    - Zeigt Support/Resistance-Levels, Konfidenz und Trend-Signal
    - Vollständige technische Indikator-Analyse
  
  - **ML Forecast Panel** - LSTM Neural Network Vorhersagen
    - Trainiert Modelle auf historischen Daten bis zum Simulationsdatum
    - Zeigt Preisprognosen für die nächsten Tage
    - GPU-Unterstützung wenn verfügbar
    - Predictions werden in Trading-Signale integriert
    
  - **Interaktiver Chart** - Vollständiger Candlestick-Chart wie im Dashboard
    - Alle technischen Indikatoren: SMA20/50, EMA12/26, Bollinger Bands, MACD, RSI, Volume
    - Support/Resistance-Linien aus der AI-Prognose
    - Zeigt nur Daten bis zum aktuellen Simulationsdatum (keine "Zukunft"-Daten)
    
  - **Indikator-Steuerung** - Toggle-Buttons für alle Chart-Indikatoren
    - Ein-/Ausblenden von Moving Averages, Bollinger Bands, Momentum-Indikatoren
    - Einstellungen bleiben während der Backtest-Session erhalten
    
  - **Collapsible Panels** - Aufklappbare Bereiche für bessere Übersicht
    - Analyse-Panel, Chart und Indikator-Steuerung einzeln auf-/zuklappbar
    - Spart Bildschirmplatz beim aktiven Trading

## [1.6.1] - 2026-01-25

### Fixed
- **Stabiles Client-seitiges Auto-Refresh** - Behebt Infinite-Loop-Bug
  - Neuer `useSimpleAutoRefresh` Hook mit stabilen Refs (keine Dependency-Loops)
  - Dashboard aktualisiert jede Sekunde
  - Watchlist/Portfolio aktualisieren alle 2 Sekunden (mehr Symbole)
  - Pausiert automatisch wenn Tab im Hintergrund (schont Ressourcen)
  - Belastet API nicht - nur Server-Cache wird abgefragt
  - Server-seitige Background Jobs aktualisieren weiterhin den Cache alle 60s

## [1.6.0] - 2026-01-25

### Added
- **Automatische Kurs-Aktualisierung** - Intelligentes Auto-Refresh-System
  
  - **Server-seitige Background Jobs** - Aktualisiert Kurse ohne Browser-Verbindung
    - Automatische Aktualisierung aller Watchlist-Symbole jede Minute
    - 10 Standard-Symbole (AAPL, MSFT, GOOGL, etc.) immer aktuell
    - Batch-Verarbeitung um APIs nicht zu überlasten
    - Cache-Bereinigung alle 5 Minuten
    - API-Endpoints: `GET /api/jobs/status`, `POST /api/jobs/update-quotes`
  
  - **Service Worker für Hintergrund-Updates** - Aktualisiert Kurse auch wenn Seite nicht fokussiert
    - Periodic Background Sync API (wenn vom Browser unterstützt)
    - Fallback auf regulären Background Sync
    - IndexedDB-Cache für Offline-Daten
  
  - **Intelligentes Polling basierend auf API-Kontingent**
    - Automatische Berechnung des optimalen Refresh-Intervalls
    - Berücksichtigt verbleibendes tägliches und minutenbasiertes Kontingent
    - Verwendet max. 50% der verfügbaren API-Calls für Auto-Refresh
  
  - **Visibility-API Integration**
    - Schnelleres Polling wenn Seite im Vordergrund
    - 3x langsameres Polling wenn Seite im Hintergrund
    - Sofortiges Update beim Zurückkehren zur Seite
  
  - **UI-Integration auf allen Seiten**
    - Dashboard: Zeigt Auto-Refresh-Intervall und Zeit bis zum nächsten Update
    - Watchlist: Grüner Indikator zeigt aktives Auto-Refresh
    - Portfolio: Positionen werden automatisch aktualisiert

### Changed
- Watchlist-Panel nutzt jetzt `useAutoRefresh` Hook statt nur manuellem Refresh
- Portfolio-Seite aktualisiert Positionswerte automatisch

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

## [1.2.0] - 2026-01-19

### Added
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
