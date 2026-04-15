/**
 * Post-Trade Explanations Worker.
 *
 * For every closed AI-trader decision (ai_trader_decisions with a non-null
 * outcome_pnl), the worker assembles RAG context (news around the decision
 * window + the decision row's own features) and asks Haiku to produce a
 * short plain-language explanation.
 *
 * Poll-based: no enqueue API is needed — eligible decisions are discovered
 * by SQL. This also covers retroactive backfill when the feature is first
 * switched on.
 *
 * Config via ENV:
 *   ANTHROPIC_API_KEY               required for live generation (absent → status 'skipped_no_api_key')
 *   EXPLANATION_MODEL               default 'claude-haiku-4-5-20251001'
 *   EXPLANATION_MAX_PER_DAY         default 500 (hard safety cap)
 *   EXPLANATION_WORKER_INTERVAL_MS  default 15000
 *   EXPLANATION_WORKER_BATCH        default 5
 *   EXPLANATION_ENABLED             default 'true' (set 'false' to stop worker)
 *   ML_SERVICE_URL                  for /rag/search/news
 */

import Anthropic from '@anthropic-ai/sdk';
import { query, getClient } from './db.js';
import logger from './logger.js';

const MODEL = process.env.EXPLANATION_MODEL || 'claude-haiku-4-5-20251001';
const MAX_PER_DAY = parseInt(process.env.EXPLANATION_MAX_PER_DAY || '500', 10);
const INTERVAL_MS = parseInt(process.env.EXPLANATION_WORKER_INTERVAL_MS || '15000', 10);
const BATCH = parseInt(process.env.EXPLANATION_WORKER_BATCH || '5', 10);
const ENABLED = (process.env.EXPLANATION_ENABLED || 'true').toLowerCase() !== 'false';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:8000';
// Triviale Trades übersprungen — |pnl%| < Schwelle → keine Erklärung, kein API-Call.
const MIN_PNL_PERCENT = parseFloat(process.env.EXPLANATION_MIN_PNL_PERCENT || '0.5');
// in_progress-Rows, die älter als dieser Timeout sind, werden re-queued (Worker
// crashte mitten im Haiku-Call oder Container-Restart).
const STALE_MINUTES = parseInt(process.env.EXPLANATION_STALE_MINUTES || '10', 10);

const SYSTEM_PROMPT = `You are an equities trade analyst. Given a closed trade and the news/signal context present at the time of the decision, produce a concise 3–5 sentence explanation in German of why this trade closed with the observed outcome. Focus on: (1) what signals drove the entry/exit, (2) what news context was present, (3) whether the outcome matched the thesis. Avoid financial advice, avoid hedging language, do not speculate about future moves. Never invent numbers — if a field is missing, skip it.`;

let anthropic = null;
let workerTimer = null;

function getClient_() {
  if (anthropic) return anthropic;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export async function initializeTradeExplanations() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_explanations (
        id SERIAL PRIMARY KEY,
        decision_id INTEGER NOT NULL UNIQUE REFERENCES ai_trader_decisions(id) ON DELETE CASCADE,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        explanation TEXT,
        model VARCHAR(80),
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        generated_at TIMESTAMPTZ
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trade_explanations_status ON trade_explanations(status);
      CREATE INDEX IF NOT EXISTS idx_trade_explanations_created ON trade_explanations(created_at DESC);
    `);
    await client.query('COMMIT');
    logger.info('[TradeExplanations] Table initialized');
  } catch (e) {
    await client.query('ROLLBACK');
    if (!e.message.includes('already exists')) {
      logger.error(`[TradeExplanations] Init error: ${e.message}`);
    }
  } finally {
    client.release();
  }
}

async function countExplanationsToday() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM trade_explanations
      WHERE status IN ('ok','error')
        AND generated_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`
  );
  return rows[0]?.n || 0;
}

/**
 * Find closed decisions that don't yet have an explanation row.
 * Closed = decision_type is a close/sell variant AND outcome_pnl IS NOT NULL.
 */
async function fetchEligibleBatch(limit) {
  const { rows } = await query(
    `SELECT d.id, d.symbol, d.timestamp, d.decision_type, d.reasoning,
            d.confidence, d.weighted_score, d.ml_score, d.rl_score,
            d.sentiment_score, d.technical_score, d.signal_agreement,
            d.summary_short, d.market_context, d.portfolio_snapshot,
            d.outcome_pnl, d.outcome_pnl_percent, d.outcome_holding_days,
            d.outcome_was_correct
       FROM ai_trader_decisions d
  LEFT JOIN trade_explanations te ON te.decision_id = d.id
      WHERE te.id IS NULL
        AND d.outcome_pnl IS NOT NULL
        AND (d.decision_type ILIKE 'close%' OR d.decision_type ILIKE 'sell%' OR d.decision_type = 'exit')
      ORDER BY d.timestamp DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function fetchNewsContext(symbol, decisionTs, k = 6) {
  const ts = Math.floor(new Date(decisionTs).getTime() / 1000);
  try {
    const res = await fetch(`${ML_SERVICE_URL}/rag/search/news`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `${symbol} market news`,
        k,
        filter: {
          symbol: symbol.toUpperCase(),
          published_at: { gte: ts - 2 * 3600, lt: ts + 900 },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.hits || []).map((h) => ({
      title: h.payload?.title || null,
      source: h.payload?.source || null,
      published_at: h.payload?.published_at || null,
      score: h.score,
    }));
  } catch (e) {
    logger.warn(`[TradeExplanations] news context fetch failed for ${symbol}: ${e.message}`);
    return [];
  }
}

function buildUserPrompt(decision, news) {
  const lines = [];
  lines.push(`Symbol: ${decision.symbol}`);
  lines.push(`Entscheidungszeit: ${new Date(decision.timestamp).toISOString()}`);
  lines.push(`Entscheidungstyp: ${decision.decision_type}`);
  if (decision.summary_short) lines.push(`Zusammenfassung: ${decision.summary_short}`);
  const scores = [];
  if (decision.ml_score != null) scores.push(`ML=${decision.ml_score}`);
  if (decision.rl_score != null) scores.push(`RL=${decision.rl_score}`);
  if (decision.sentiment_score != null) scores.push(`Sentiment=${decision.sentiment_score}`);
  if (decision.technical_score != null) scores.push(`Technisch=${decision.technical_score}`);
  if (scores.length) lines.push(`Signal-Scores: ${scores.join(', ')}`);
  if (decision.confidence != null) lines.push(`Konfidenz: ${decision.confidence}`);
  if (decision.signal_agreement) lines.push(`Signal-Übereinstimmung: ${decision.signal_agreement}`);
  if (decision.outcome_pnl != null) {
    lines.push(`Ergebnis-P&L: ${decision.outcome_pnl} (${decision.outcome_pnl_percent}%)`);
  }
  if (decision.outcome_holding_days != null) {
    lines.push(`Haltedauer: ${decision.outcome_holding_days} Tage`);
  }
  if (decision.outcome_was_correct != null) {
    lines.push(`Thesis bestätigt: ${decision.outcome_was_correct ? 'ja' : 'nein'}`);
  }
  if (decision.reasoning) {
    const r = typeof decision.reasoning === 'string' ? decision.reasoning : JSON.stringify(decision.reasoning);
    lines.push(`Reasoning-Snapshot: ${r.slice(0, 800)}`);
  }
  if (news.length) {
    lines.push('News-Kontext im Entscheidungsfenster (±2h):');
    news.slice(0, 6).forEach((n, i) => {
      lines.push(`  ${i + 1}. [${n.source || '?'}] ${n.title || ''}`);
    });
  } else {
    lines.push('News-Kontext im Entscheidungsfenster: keine relevanten Artikel gefunden.');
  }
  lines.push('');
  lines.push('Erkläre in 3–5 Sätzen, warum dieser Trade so ausging.');
  return lines.join('\n');
}

async function generateExplanation(decision) {
  const client = getClient_();
  if (!client) {
    return { status: 'skipped_no_api_key', explanation: null, usage: null };
  }
  const news = await fetchNewsContext(decision.symbol, decision.timestamp);
  const userPrompt = buildUserPrompt(decision, news);

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return {
    status: text ? 'ok' : 'error',
    explanation: text || null,
    usage: resp.usage || null,
  };
}

async function processDecision(decision) {
  // Gate 1 — überspringe triviale Trades ohne API-Call.
  const absPnlPct = Math.abs(Number(decision.outcome_pnl_percent) || 0);
  if (Number.isFinite(absPnlPct) && absPnlPct < MIN_PNL_PERCENT) {
    await query(
      `INSERT INTO trade_explanations (decision_id, status, model, generated_at)
       VALUES ($1, 'skipped_trivial', $2, CURRENT_TIMESTAMP)
       ON CONFLICT (decision_id) DO NOTHING`,
      [decision.id, MODEL]
    );
    logger.debug(`[TradeExplanations] skipped_trivial decision=${decision.id} pnl_pct=${absPnlPct}`);
    return;
  }

  // Insert placeholder row first to claim it (unique constraint on decision_id
  // prevents duplicate work if multiple workers ever run).
  try {
    await query(
      `INSERT INTO trade_explanations (decision_id, status, model)
       VALUES ($1, 'in_progress', $2)
       ON CONFLICT (decision_id) DO NOTHING`,
      [decision.id, MODEL]
    );
  } catch (e) {
    logger.warn(`[TradeExplanations] claim failed for decision ${decision.id}: ${e.message}`);
    return;
  }

  try {
    const { status, explanation, usage } = await generateExplanation(decision);
    await query(
      `UPDATE trade_explanations
          SET status = $2,
              explanation = $3,
              model = $4,
              input_tokens = $5,
              output_tokens = $6,
              cache_read_tokens = $7,
              error = NULL,
              generated_at = CURRENT_TIMESTAMP
        WHERE decision_id = $1`,
      [
        decision.id,
        status,
        explanation,
        MODEL,
        usage?.input_tokens || null,
        usage?.output_tokens || null,
        usage?.cache_read_input_tokens || null,
      ]
    );
    if (status === 'ok') {
      logger.info(`[TradeExplanations] ok decision=${decision.id} symbol=${decision.symbol} tokens=${usage?.input_tokens || 0}/${usage?.output_tokens || 0} cache_read=${usage?.cache_read_input_tokens || 0}`);
    } else {
      logger.info(`[TradeExplanations] ${status} decision=${decision.id}`);
    }
  } catch (e) {
    logger.error(`[TradeExplanations] error decision=${decision.id}: ${e.message}`);
    await query(
      `UPDATE trade_explanations
          SET status = 'error', error = $2, generated_at = CURRENT_TIMESTAMP
        WHERE decision_id = $1`,
      [decision.id, String(e.message || e).slice(0, 500)]
    ).catch(() => {});
  }
}

async function recoverStaleInProgress() {
  // Gate 3 — Zombie-Recovery: Rows die älter als STALE_MINUTES sind und noch
  // in_progress stehen wurden durch einen crashenden Call gelassen.
  // Löschen gibt die Decision zum Retry frei (UNIQUE + ON CONFLICT greift wieder).
  const { rowCount } = await query(
    `DELETE FROM trade_explanations
       WHERE status = 'in_progress'
         AND created_at < NOW() - ($1 || ' minutes')::interval
     RETURNING decision_id`,
    [STALE_MINUTES]
  );
  if (rowCount && rowCount > 0) {
    logger.warn(`[TradeExplanations] recovered ${rowCount} stale in_progress rows (>${STALE_MINUTES}min)`);
  }
}

async function tick() {
  try {
    await recoverStaleInProgress();
    const doneToday = await countExplanationsToday();
    const remaining = MAX_PER_DAY - doneToday;
    if (remaining <= 0) {
      logger.debug(`[TradeExplanations] daily cap reached (${doneToday}/${MAX_PER_DAY})`);
      return;
    }
    const batch = await fetchEligibleBatch(Math.min(BATCH, remaining));
    if (batch.length === 0) return;
    for (const decision of batch) {
      await processDecision(decision);
    }
  } catch (e) {
    logger.error(`[TradeExplanations] tick failed: ${e.message}`);
  }
}

/**
 * Aggregate token usage + status breakdown for monitoring API spend.
 * Returns counts and token sums for today / last 7 days / last 30 days.
 */
export async function getUsageStats() {
  const { rows } = await query(
    `WITH windows AS (
       SELECT 'today'::text AS window, date_trunc('day', CURRENT_TIMESTAMP) AS since
       UNION ALL SELECT '7d', CURRENT_TIMESTAMP - INTERVAL '7 days'
       UNION ALL SELECT '30d', CURRENT_TIMESTAMP - INTERVAL '30 days'
     )
     SELECT w.window,
            COUNT(*) FILTER (WHERE te.status = 'ok')                  AS ok_count,
            COUNT(*) FILTER (WHERE te.status = 'error')               AS error_count,
            COUNT(*) FILTER (WHERE te.status = 'skipped_trivial')     AS skipped_trivial,
            COUNT(*) FILTER (WHERE te.status = 'skipped_no_api_key')  AS skipped_no_key,
            COALESCE(SUM(te.input_tokens)      FILTER (WHERE te.status = 'ok'), 0)::bigint AS input_tokens,
            COALESCE(SUM(te.output_tokens)     FILTER (WHERE te.status = 'ok'), 0)::bigint AS output_tokens,
            COALESCE(SUM(te.cache_read_tokens) FILTER (WHERE te.status = 'ok'), 0)::bigint AS cache_read_tokens
       FROM windows w
  LEFT JOIN trade_explanations te ON te.generated_at >= w.since
   GROUP BY w.window
   ORDER BY CASE w.window WHEN 'today' THEN 1 WHEN '7d' THEN 2 ELSE 3 END`
  );
  return {
    model: MODEL,
    dailyCap: MAX_PER_DAY,
    minPnlPercent: MIN_PNL_PERCENT,
    windows: rows.map((r) => ({
      window: r.window,
      okCount: Number(r.ok_count),
      errorCount: Number(r.error_count),
      skippedTrivial: Number(r.skipped_trivial),
      skippedNoKey: Number(r.skipped_no_key),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheHitRate: r.input_tokens > 0
        ? Number((Number(r.cache_read_tokens) / Number(r.input_tokens)).toFixed(3))
        : null,
    })),
  };
}

export function startTradeExplanationsWorker() {
  if (!ENABLED) {
    logger.info('[TradeExplanations] worker disabled via EXPLANATION_ENABLED=false');
    return;
  }
  if (workerTimer) return;
  workerTimer = setInterval(tick, INTERVAL_MS);
  logger.info(`[TradeExplanations] worker started (model=${MODEL}, interval=${INTERVAL_MS}ms, cap=${MAX_PER_DAY}/day, api_key=${process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'})`);
  // First tick soon after start so UI isn't blank on fresh boot
  setTimeout(() => { tick().catch(() => {}); }, 3000);
}

export function stopTradeExplanationsWorker() {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
}

export async function getExplanationForDecision(decisionId) {
  const { rows } = await query(
    `SELECT decision_id, status, explanation, model, generated_at, error,
            input_tokens, output_tokens, cache_read_tokens
       FROM trade_explanations
      WHERE decision_id = $1`,
    [decisionId]
  );
  return rows[0] || null;
}

export default {
  initializeTradeExplanations,
  startTradeExplanationsWorker,
  stopTradeExplanationsWorker,
  getExplanationForDecision,
  getUsageStats,
};
