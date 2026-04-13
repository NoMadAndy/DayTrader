# DayTrader — ToDo

Zentrale Aufgabenliste. Format und Regeln siehe [CLAUDE.md](../CLAUDE.md) Abschnitt „Arbeitsweise".

---

## 📥 Eingangskorb (Andys Wünsche)

> Neue Wünsche landen hier. Claude sortiert sie nach jedem Prompt in die passende Sektion unten ein und lässt eine `→ verschoben nach …`-Spur stehen, bis der Punkt erledigt ist.

- _(leer)_

---

## 🐞 Offene Bugs

- _(leer)_

---

## 🧱 Sammelpunkte / Initiativen

### Scraping- & Sentiment-Pipeline härten
Motivation: News-Signale sollen tradable sein, nicht nur Noise. Ausgangslage siehe erste Analyse in dieser Session.
- News-API-Keys vom Frontend ins Backend verlagern (Proxy + Redis-Cache)
- Semantic-Deduplikation via Embeddings vor Sentiment-Aggregation
- Freshness-Decay (`exp(-Δt/τ)`) auf News-Sentiment anwenden
- FinBERT-Chunking für Artikel > 512 Token statt hartem Truncate
- Quellen-Diversität: Reddit, SEC EDGAR 8-K, Earnings-Transcripts, X
- IC / Rank-IC des Sentiment-Signals gegen Next-Bar-Return tracken
- Event-Typ-Separation (Earnings vs Upgrade vs M&A vs Rumor)

### Claude-Verhalten / LLM-Integration
- Post-Trade-Explainability in [backend/src/aiTraderInsights.js](../backend/src/aiTraderInsights.js) mit LLM anreichern
- Prompt-Caching für wiederkehrende Kontexte (Marktregime, Ticker-Profile)
- RAG-artiger Speicher für historische Trades + Begründungen (Vektor-DB)
- Strukturierte Tool-Calls statt Freitext bei Signalgenerierung

### Backtest- & Evaluations-Hygiene
- Walk-Forward-CV als Default überall wo noch Random-Split läuft
- Transaktionskosten (Spread + Slippage + Fees) in allen Backtests
- Regime-aufgeteilte Performance-Metriken (Bull/Bear/Flat)
- Baseline-Vergleich (Buy-and-Hold, Random) in jedem Report

---

## ✨ Verbesserungen

- _(leer)_

---

## 🕒 Später / Nice-to-have

- _(leer)_

---

## ✅ Erledigt — Versionsverlauf

| Version | Datum | Highlight |
|---|---|---|
| — | 2026-04-13 | Claude-Setup: CLAUDE.md, .mcp.json (Playwright, Chrome-DevTools, Context7, Fetch, Postgres, Sequential-Thinking, Filesystem), 4 Subagents (trade-safety, scraper-auditor, backtest-reviewer, ui-smoke-tester), 2 Slash-Commands, docs/ToDo.md mit Eingangskorb |
