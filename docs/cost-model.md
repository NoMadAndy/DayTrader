# Transaktionskosten & P&L-Konventionen

Dieses Dokument hält das Kostenmodell fest, das sowohl vom Live-Trading (Node-Backend) als auch vom RL-Backtesting (Python-Env) verwendet wird. Kern: **beide Seiten müssen identisch rechnen**, sonst driften Live-P&L und RL-Agent-Reward auseinander und Backtests werden wertlos.

## Quelle der Wahrheit

| Schicht | Datei | Funktion |
|---|---|---|
| Backend Live-Trading | [backend/src/trading.js:504](../backend/src/trading.js#L504) | `calculateFees()` |
| RL Backtest-Env | [rl-trading-service/app/trading_env.py:495](../rl-trading-service/app/trading_env.py#L495) | `_calculate_transaction_cost()` |
| Regressions-Anker | [backend/tests/cost_parity.test.js](../backend/tests/cost_parity.test.js) | Parity-Tests |

Die beiden Fee-Tabellen sind numerisch identisch (siehe „Einheitenkonvention" unten). Änderungen müssen an **beiden** Stellen erfolgen, der Parity-Test prüft das Mapping.

## Broker-Profile

| Profil | Flat | Pct | Min | Max | Exchange | Spread |
|---|---|---|---|---|---|---|
| `discount` | 1.00 | 0 | 1.00 | 1.00 | 0 | 0.10% |
| `standard` | 4.95 | 0.25% | 4.95 | 59.00 | 0 | 0.15% |
| `premium` | 9.90 | 0 | 9.90 | 9.90 | 0 | 0.05% |
| `marketMaker` | 0 | 0 | 0 | 0 | 0 | 0.30% |
| `flatex` | 8.50 | 0 | 8.50 | 8.50 | 0 | 0.05% |
| `ingdiba` | 5.30 | 0.25% | 10.70 | 75.50 | 2.05 | 0.05% |

## Formel

Für jeden Trade mit Notional `N = quantity × price`:

```
commission_raw = flat + N × (pct/100)
commission     = clamp(min, max, commission_raw) + exchange
spread_cost    = N × (spread/100) × spread_multiplier
total_fees     = commission + spread_cost
```

`spread_multiplier = 3` für Warrants, sonst 1. Round-Trip-Kosten = 2 × total_fees.

Executed-Price ist der Mid-Price ± halber Spread:
```
effective_price_buy  = price × (1 + spread/2/100)
effective_price_sell = price × (1 − spread/2/100)
```

## Einheitenkonvention

- **Backend** (`trading.js`): `percentageFee` und `spreadPercent` sind als **Prozent** gespeichert (z. B. 0.25 = 0.25 %).
- **RL-Env** (`trading_env.py`): `percentage_fee` und `spread_pct` sind als **Dezimal** gespeichert (z. B. 0.0025 = 0.25 %).
- Mapping: `rl.value = backend.value / 100`.

Der Parity-Test dokumentiert die Umrechnung explizit.

## P&L-Konvention in Reports

`positions.realized_pnl` wird bei Close berechnet als:

```
realized_pnl = (exit_value − entry_value) × leverage − total_fees
```

→ **realized_pnl ist immer netto** (Fees bereits abgezogen).

`ai_trader_daily_reports.pnl` aggregiert `SUM(realized_pnl)` und ist daher ebenfalls netto. Die Spalte `fees_paid` ist rein informativ.

Die Reader-Funktionen [getReports](../backend/src/aiTraderReports.js) und [getReportByDate](../backend/src/aiTraderReports.js) reichern jedes Report-Objekt on-the-fly mit drei abgeleiteten Feldern an, damit API-Konsumenten Transparenz haben:

| Feld | Berechnung | Bedeutung |
|---|---|---|
| `net_pnl` | `pnl` | Alias für Klarheit |
| `gross_pnl` | `pnl + fees_paid` | Theoretische P&L ohne Broker-Kosten |
| `gross_pnl_percent` | `gross_pnl / start_value × 100` | dito in Prozent |
| `pnl_is_net` | `true` | explizites Vertrags-Flag |

Die DB bleibt unverändert — keine Migration, `pnl` ist die Single-Source-of-Truth.

## Was NICHT im Modell ist

- **Overnight/Finanzierungskosten** für gehebelte CFDs: separate Funktion [calculateOvernightFee](../backend/src/trading.js), siehe `cfdOvernight`-Raten pro Profil. Werden in `positions.total_overnight_fees` akkumuliert, nicht in `total_fees_paid`.
- **Steuern / Abgeltungssteuer**: nicht modelliert. Reports sind Brutto vor Steuer.
- **Währungs-Konvertierung**: Alle Beträge in USD. EUR-Profile (flatex, ingdiba) sind bereits umgerechnet (Stand ~2024 ≈ 1.08 USD/EUR).
- **Slippage über Spread hinaus**: nicht explizit modelliert. Der halbe-Spread-Offset in `effective_price` fängt die Ausführungslücke ab.

## Änderung des Modells

1. Tabelle in **beiden** Dateien ändern (`trading.js`, `trading_env.py`).
2. [cost_parity.test.js](../backend/tests/cost_parity.test.js) aktualisieren (hand-berechnete Soll-Werte).
3. Falls Live-Positions existieren: historische `realized_pnl` **nicht** re-berechnen — neues Modell gilt nur für zukünftige Closes.
4. CHANGELOG-Eintrag mit Begründung der Änderung (Pricing-Update des Brokers, Umrechnungskurs, …).
