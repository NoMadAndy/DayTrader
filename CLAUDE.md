# DayTrader AI — Claude Instructions

Multi-Service Trading-Plattform: Node/Express Backend, React/Vite Frontend, Python FastAPI ML-Service (FinBERT/Transformers), Python RL-Trading-Service (PyTorch/Gym).

## Architektur (Map)

| Service | Pfad | Tech | Zweck |
|---|---|---|---|
| Backend | [backend/src/](backend/src/) | Node 18+, Express, pg | API-Proxy, Auth, SSE-Streaming, Trade-Persistenz |
| Frontend | [frontend/src/](frontend/src/) | React+TS, Vite | UI, Charts, News |
| ML | [ml-service/app/](ml-service/app/) | FastAPI, PyTorch, FinBERT | Sentiment, Ensemble, Drift-Detection |
| RL | [rl-trading-service/app/](rl-trading-service/app/) | FastAPI, Stable-Baselines-style, Gym | RL-Agents, Live-Trading-Engine |

Start: `docker-compose up`. Dev-Overrides in [docker-compose.override.yml](docker-compose.override.yml).

## Kern-Dateien

- Trading-Engine: [rl-trading-service/app/ai_trader_engine.py](rl-trading-service/app/ai_trader_engine.py)
- Signal-Aggregation: [rl-trading-service/app/ai_trader_signals.py](rl-trading-service/app/ai_trader_signals.py)
- Backend-Orchestrator: [backend/src/aiTrader.js](backend/src/aiTrader.js)
- Sentiment-Pipeline: [ml-service/app/sentiment.py](ml-service/app/sentiment.py), [backend/src/sentimentArchive.js](backend/src/sentimentArchive.js)
- News-Provider: [frontend/src/services/newsApiProvider.ts](frontend/src/services/newsApiProvider.ts), [frontend/src/services/newsdataProvider.ts](frontend/src/services/newsdataProvider.ts)

## Arbeitsweise

**Finanz-/Trading-Code ist sicherheitskritisch.** Fehler kosten echtes (oder Paper-)Geld und verfälschen Backtests.

1. **Keine stillen Default-Werte** bei Returns, Preisen, Positions-Größen. Lieber hart fehlschlagen als 0 annehmen.
2. **Zeitzonen explizit** (UTC in DB, Market-TZ nur in Presentation). Nie naive datetimes mischen.
3. **Look-ahead-Bias prüfen**: Bei jeder Feature-/Signal-Änderung fragen: „Nutzt das Daten, die zum Entscheidungszeitpunkt noch nicht da waren?"
4. **Scaler/Fitting nur auf Train-Fold** — nie auf Full-Dataset. Siehe [rl-trading-service CHANGELOG](CHANGELOG.md) (Sprint zu Scaler-Leakage).
5. **Walk-Forward-CV** statt Random-Split für alle Model-Evaluationen.
6. **P&L- und Win-Rate-Änderungen** immer mit Backtest-Zahlen vorher/nachher belegen.

## Conventions

- **Python**: Type Hints, `dataclasses` für Results, `logging.getLogger(__name__)`. Keine Prints.
- **JS**: ESM (`type: module`), async/await, Winston für Logs ([backend/src/logger.js](backend/src/logger.js)).
- **TS Frontend**: Funktionale Components, strikte Typen, kein `any` ohne Kommentar.
- **Errors an Systemgrenzen validieren** (API-Input, externe Responses), intern vertrauen.
- **Keine Kommentare** die den Code paraphrasieren. Nur WHY, wenn nicht offensichtlich.

## Tests & Verifikation

- Backend: `cd backend && npm test`
- Frontend-Typecheck: `cd frontend && npx tsc -b`
- UI-E2E: Playwright via MCP (siehe unten) — manueller Smoke-Test bei UI-Änderungen Pflicht.
- ML/RL: pytest in jeweiligem Service.

**Vor „fertig"**: Bei UI-Änderungen tatsächlich im Browser klicken (Playwright-MCP). Typecheck ≠ Feature-Test.

## Scraping / News-Pipeline — bekannte Baustellen

Vor Änderungen an News/Sentiment diese Punkte prüfen (siehe vorherige Analyse):

- FinBERT trunkiert bei 512 Tokens — bei langen Artikeln Chunking nutzen
- News-API-Keys gehören ins Backend, nicht ins Frontend-Bundle
- Dedup via Embeddings vor Sentiment-Aggregation (5× gleiche Story = 5× Bias)
- Freshness-Decay: `weight = exp(-Δt/τ)` für alte News
- IC/Rank-IC der Sentiment-Signale tracken, sonst taub für Degradation

## Was NICHT tun

- Keine `--no-verify`, kein Force-Push auf main
- Keine Secrets committen (`.env.old` liegt untracked — nicht stagen)
- Keine neuen Abstraktionen ohne konkreten zweiten Use-Case
- Keine Markdown-/Doku-Dateien ohne expliziten Auftrag
- Keine destruktiven Trading-Ops ohne Bestätigung (DB-Trade-Löschung, Strategy-Reset)

## Werkzeuge / MCPs / Hooks

**Hardware** (Dev-Maschine, ggf. identisch mit Live):
- **GPU**: NVIDIA RTX 2080 Super 8 GB, CUDA aktiv. FinBERT ([ml-service/app/sentiment.py](ml-service/app/sentiment.py)) und RL-Training ([rl-trading-service/app/trainer.py](rl-trading-service/app/trainer.py)) nutzen sie automatisch (`torch.cuda.is_available()`). Performance-Tests und Modell-Loads dürfen GPU belegen.
- **VRAM-Budget**: 8 GB ist knapp — nicht gleichzeitig FinBERT + großes RL-Training laden. Bei OOM zuerst Batch-Size reduzieren, dann CPU-Fallback.

**MCP-Server** (konfiguriert in [.mcp.json](.mcp.json), projektweit, alle über `npx`):
- **`playwright`** (`mcp__playwright__*`) — **headless** Browser-Automation. **Proaktiv nutzen** zum Testen von Frontend-Änderungen statt nur curl/typecheck. Dev-URL: `http://localhost:5173` (Vite). Golden-Path + Console-Check Pflicht vor „fertig".
- **`chrome-devtools`** (`mcp__chrome-devtools__*`) — headless Chrome via DevTools-Protokoll für Performance-Profiling, Network-Inspektion, Chart-Rendering-Debugging.
- **`context7`** (`mcp__context7__*`) — aktuelle Library-Doku (FastAPI, PyTorch, Stable-Baselines, React, Vite, Express, pg, Transformers, finbert, gym). **Nutze ihn statt zu raten** bei API-Unklarheiten.
- **`sequential-thinking`** (`mcp__sequential-thinking__*`) — strukturiertes Reasoning für komplexe Diagnosen (z. B. „warum hat Signal X gestern negativ abgeschnitten?").
- **`fetch`** (`mcp__fetch__*`) — externe News-/Marktdaten-APIs inspizieren ohne Browser.
- **`filesystem`** — zweites Working-Dir falls nötig.
- **`postgres`** — direkter Read-Access auf die DayTrader-DB. Connection-String in `.mcp.json` bei abweichendem Setup anpassen. **Keine `DELETE`/`UPDATE` ohne Bestätigung.**

**Browser-Setup (Headless-Server)**: `--headless=true` und `--no-sandbox` gesetzt. Falls Chromium fehlt: `npx playwright install chromium`. Bei neuer Chromium-Version bleibt `.mcp.json` stabil, weil `npx` immer frisch zieht.

**Bewusst nicht im Repo**: GitHub-MCP (`gh` CLI tut es), Figma-MCP (kein Bedarf).

**Health-Check**: `claude mcp list` muss alle Server als `✓ Connected` zeigen.

**Hooks** (empfohlen, siehe [.claude/settings.json](.claude/settings.json)):
- **PostToolUse Edit/Write auf `*.py`**: `ruff check --fix --quiet $FILE && ruff format --quiet $FILE`
- **PostToolUse Edit/Write auf `frontend/**/*.{ts,tsx}`**: `cd frontend && npx prettier --write $FILE && npx eslint --fix $FILE`
- **PreCommit**: Backend `npm test`, ML/RL `pytest -x`, Frontend `npx tsc -b`. Blockt Commit bei Fehlern.

**Skills** (per `Skill`-Tool):
- `simplify` — Quality/Reuse-Review nach größeren Änderungen
- `update-config` — Settings/Hooks pflegen
- `claude-api` — Anthropic-SDK-Hilfe (für LLM-gestützte Post-Trade-Analyse)
- `loop` / `schedule` — wiederkehrende Checks (z. B. nächtlicher Backtest)

**Subagents** in [.claude/agents/](.claude/agents/):
- `trade-safety-reviewer` — Look-ahead, Scaler-Leakage, Order-Lifecycle
- `scraper-auditor` — News-Pipeline, Dedup, Freshness-Decay, IC-Tracking
- `backtest-reviewer` — Walk-Forward, Kosten, Survivorship, Metric-Honesty
- `ui-smoke-tester` — Playwright-basierte E2E-Verifikation

**Slash-Commands**: `/verify-ui`, `/review-trade-safety`

**Wenn ein Tool fehlt**: `claude mcp add <name> …` oder Eintrag in `.mcp.json`. CLAUDE.md bei jeder Installation aktualisieren.

## Arbeitsweise (permanente Anweisungen)

- **User Experience hat höchste Priorität**: Reihenfolge **(1) Korrektheit/Sicherheit bei Trades, (2) Fehlerfreiheit, (3) Geschwindigkeit, (4) UI-Qualität**. Trading-Safety schlägt UX — ein schnelles UI mit falschen P&L-Zahlen ist wertlos.
- **Ein Punkt nach dem anderen**: Frag nach, welcher Task als nächstes ansteht, wenn unklar. Andere Tasks im Blick halten, aber nicht vermischen.
- **Bei Unklarheiten fragen**: Lieber einmal mehr nachfragen als Annahmen über Trading-Logik oder Datenflüsse raten.
- **Gewissenhaft planen**: Bei >3 Dateien, neuem Feature, Refactoring oder Änderungen an Trading-Engine/Signal-Aggregation zuerst Plan erstellen (EnterPlanMode). Seiteneffekte und bestehende Patterns prüfen.
- **Gesamtkonzept im Blick**: Vor Implementierung [CHANGELOG.md](CHANGELOG.md) und [docs/](docs/) überfliegen, verwandte Punkte zusammen lösen.
- **Sauber versionieren**: Bei Frontend-Änderungen `?v=N` in [frontend/index.html](frontend/index.html) UND `CACHE_NAME` in [frontend/public/sw.js](frontend/public/sw.js) hochzählen.
- **Immer testen**: Playwright-MCP für UI, `npm test` für Backend, `pytest` für Python-Services. Bei Trading-Änderungen zusätzlich `@trade-safety-reviewer`.
- **Sauberer Code & sauberes Repo**: Keine Code-Leichen, keine Duplikate, keine abgebrochenen Experimente. Vor jedem Commit: „Ist alles im Diff wirklich nötig?"
- **Keine Secrets committen**: `.env*` steht in `.gitignore` — `.env.old` untracked lassen.
- **API-Kosten minimieren**: Cache, lokale Daten, günstigeres Modell (Haiku) prüfen bevor Opus/Sonnet gerufen wird. Prompt-Caching für wiederkehrende Kontexte nutzen.
- **Konfigurierbarkeit**: Neue Schwellen/Gewichte/Intervalle als Setting oder ENV exponieren, nicht hardcoden.
- **Changelog pflegen**: [CHANGELOG.md](CHANGELOG.md) ist User-sichtbar. Jede funktionale Änderung bekommt Eintrag unter `[Unreleased]` (Added/Changed/Fixed/Removed). Bei Version-Bump Sektion mit Datum versiegeln.
- **Dokumentation pflegen**: Bei relevanten Änderungen prüfen ob [README.md](README.md), CLAUDE.md, `docs/` oder API-Doku (`/docs`) nachzuziehen sind.
- **Tools auf dem Laufenden halten**: Wenn ein Skill/MCP/Plugin den Task erleichtert → installieren + Eintrag in CLAUDE.md.
- **Immer pushen**: Nach jedem Feature/Fix `git push` — aber niemals mit `--force` auf `main` ohne explizite Zustimmung.
- **Live-System**: https://daytrader.macherwerkstatt.cc — kann direkt gegen diese URL getestet werden (Playwright-MCP + curl). Bei UI-Änderungen nach Deploy dort verifizieren, nicht nur lokal.
- **ToDos**: [docs/ToDo.md](docs/ToDo.md) ist die zentrale Aufgabenliste (versioniert im Repo). **Eingangskorb** ganz oben — nach jedem User-Prompt prüfen und neue Wünsche einsortieren. Andys Originaltext NIE löschen, nur mit `→ verschoben nach …`-Spur in Zielsektion umziehen. Erledigt-Markierung: `> **✓ vN**: Kurz was gemacht wurde — Datei/Modul.` Lange Details gehören in Commit-Message, nicht in ToDo.
