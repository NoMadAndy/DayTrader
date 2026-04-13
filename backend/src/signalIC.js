/**
 * Signal IC (Information Coefficient) Tracker
 *
 * Ziel: Signal-Degradation sichtbar machen, bevor sie P&L kostet. Rank-IC pro
 * Quelle (sentiment, ml, rl, technical) gegen Next-Bar-Return. Schreibt raw
 * scores mit Timestamp — realized_return wird nachträglich via Daily-Job aus
 * historical_prices aufgelöst.
 */

import { query } from './db.js';
import logger from './logger.js';
import { rankIC } from './aiTraderSignalAccuracy.js';

/**
 * Log a single signal score. Non-blocking — errors are swallowed so the caller
 * pipeline (z.B. /api/ml/sentiment) nicht wegen Logging-Problemen failed.
 * @param {string} source - 'sentiment' | 'ml' | 'rl' | 'technical'
 * @param {string} symbol
 * @param {number} score - Raw score (z.B. -1..1 für Sentiment)
 * @param {Date|number} [scoreAt] - Default: now
 * @param {number} [horizon] - Return-Horizon in Tagesbars (Default 1)
 */
export async function logSignalScore(source, symbol, score, scoreAt = null, horizon = 1) {
  try {
    const ts = scoreAt instanceof Date
      ? scoreAt
      : scoreAt
        ? new Date(scoreAt)
        : new Date();
    await query(
      `INSERT INTO signal_ic (signal_source, symbol, score, score_at, return_horizon_bars)
       VALUES ($1, $2, $3, $4, $5)`,
      [source, symbol.toUpperCase(), score, ts, horizon],
    );
  } catch (e) {
    logger.warn(`[SignalIC] log failed for ${source}/${symbol}: ${e.message}`);
  }
}

/**
 * Resolve realized_return for pending entries by looking up the close price
 * `horizon` trading-days after score_at from historical_prices. Idempotent —
 * entries with non-null realized_return are skipped.
 * @returns {Promise<{updated: number, skipped: number}>}
 */
export async function backfillRealizedReturns() {
  try {
    const pending = await query(
      `SELECT id, symbol, score_at, return_horizon_bars
         FROM signal_ic
        WHERE realized_return IS NULL
          AND score_at < NOW() - INTERVAL '1 day' * (return_horizon_bars + 1)
        ORDER BY score_at
        LIMIT 5000`,
    );
    let updated = 0;
    let skipped = 0;
    for (const row of pending.rows) {
      const scoreDate = new Date(row.score_at);
      const entryBar = await query(
        `SELECT close FROM historical_prices
          WHERE symbol = $1 AND date <= $2::date
          ORDER BY date DESC LIMIT 1`,
        [row.symbol, scoreDate.toISOString().split('T')[0]],
      );
      const exitBar = await query(
        `SELECT close FROM historical_prices
          WHERE symbol = $1 AND date > $2::date
          ORDER BY date ASC LIMIT 1 OFFSET $3`,
        [row.symbol, scoreDate.toISOString().split('T')[0], Math.max(0, row.return_horizon_bars - 1)],
      );
      const entry = parseFloat(entryBar.rows[0]?.close);
      const exit = parseFloat(exitBar.rows[0]?.close);
      if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0) {
        skipped += 1;
        continue;
      }
      const ret = (exit - entry) / entry;
      await query(
        `UPDATE signal_ic SET realized_return = $1 WHERE id = $2`,
        [ret, row.id],
      );
      updated += 1;
    }
    if (updated + skipped > 0) {
      logger.info(`[SignalIC] backfill: ${updated} updated, ${skipped} skipped (no price data)`);
    }
    return { updated, skipped };
  } catch (e) {
    logger.error(`[SignalIC] backfill error: ${e.message}`);
    return { updated: 0, skipped: 0, error: e.message };
  }
}

/**
 * Aggregate Rank-IC over a time window. Ungrouped → globale IC; grouped by
 * symbol → eine Zeile pro Symbol.
 * @param {object} opts
 * @param {string} [opts.source]        - Filter auf Signalquelle
 * @param {number} [opts.days=30]
 * @param {boolean} [opts.bySymbol=false]
 */
export async function getIC({ source = null, days = 30, bySymbol = false } = {}) {
  const params = [days];
  let whereSource = '';
  if (source) {
    params.push(source);
    whereSource = `AND signal_source = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT signal_source, symbol, score, realized_return
       FROM signal_ic
      WHERE score_at >= NOW() - INTERVAL '1 day' * $1
        AND realized_return IS NOT NULL
        ${whereSource}
      ORDER BY score_at`,
    params,
  );

  if (rows.length === 0) return { days, source, bySymbol, data: [], n: 0 };

  if (!bySymbol) {
    // Global IC across all (source, symbol) pairs in window
    const sources = new Set(rows.map(r => r.signal_source));
    const data = [];
    for (const src of sources) {
      const slice = rows.filter(r => r.signal_source === src);
      const ic = rankIC(
        slice.map(r => Number(r.score)),
        slice.map(r => Number(r.realized_return)),
      );
      data.push({ source: src, n: slice.length, ic });
    }
    return { days, source, bySymbol, data, n: rows.length };
  }

  // Per (source, symbol) — only report buckets with >= 5 observations
  const buckets = new Map();
  for (const r of rows) {
    const key = `${r.signal_source}|${r.symbol}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const data = [];
  for (const [key, slice] of buckets) {
    if (slice.length < 5) continue;
    const [src, sym] = key.split('|');
    const ic = rankIC(
      slice.map(r => Number(r.score)),
      slice.map(r => Number(r.realized_return)),
    );
    data.push({ source: src, symbol: sym, n: slice.length, ic });
  }
  data.sort((a, b) => (b.ic || 0) - (a.ic || 0));
  return { days, source, bySymbol, data, n: rows.length };
}

export default { logSignalScore, backfillRealizedReturns, getIC };
