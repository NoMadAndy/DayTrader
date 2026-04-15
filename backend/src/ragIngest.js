/**
 * RAG ingest helpers — push live news into the Qdrant `news` collection
 * via the ml-service /rag/ingest endpoint.
 *
 * All calls are fire-and-forget: ingest must NEVER block the user-facing
 * sentiment/news response. Failures are logged at warn level only.
 */

import crypto from 'crypto';
import logger from './logger.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://ml-service:8000';
const RAG_INGEST_TIMEOUT_MS = parseInt(process.env.RAG_INGEST_TIMEOUT_MS || '4000', 10);

function stableId(symbol, item) {
  const key = `${symbol}|${item.url || item.headline}`;
  // UUID v5-style: hash → 32 hex chars formatted as UUID. Qdrant accepts UUID
  // strings as point ids and they stay stable across ingests, so re-runs
  // overwrite (idempotent) instead of producing duplicates.
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function toUnixSeconds(value) {
  if (!value) return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((ms > 1e12 ? ms : ms * 1000) / 1000);
}

/**
 * Push headlines for a symbol into the `news` collection.
 * @param {string} symbol
 * @param {Array<{headline:string,url?:string,source?:string,published?:string|number,sentiment_score?:number}>} sources
 * @param {Date} [analyzedAt]   fallback timestamp when item.published is missing
 */
export function ingestNewsHeadlines(symbol, sources, analyzedAt = new Date()) {
  if (!Array.isArray(sources) || sources.length === 0) return;

  const fallbackTs = Math.floor(analyzedAt.getTime() / 1000);
  const items = [];
  const seen = new Set();
  for (const s of sources) {
    if (!s || !s.headline) continue;
    const dedupKey = (s.url || s.headline).toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    items.push({
      id: stableId(symbol, s),
      text: s.headline,
      payload: {
        symbol: symbol.toUpperCase(),
        published_at: toUnixSeconds(s.published) ?? fallbackTs,
        url: s.url || null,
        source: s.source || s.provider || null,
        title: s.headline,
        sentiment_score: typeof s.sentiment_score === 'number' ? s.sentiment_score : null,
      },
    });
  }
  if (items.length === 0) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RAG_INGEST_TIMEOUT_MS);

  fetch(`${ML_SERVICE_URL}/rag/ingest/news`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
    signal: ctrl.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.warn(`[RAG] news ingest ${symbol} HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      logger.debug(`[RAG] news ingest ${symbol} ok (${items.length} items)`);
    })
    .catch((err) => {
      if (err.name === 'AbortError') {
        logger.warn(`[RAG] news ingest ${symbol} timeout after ${RAG_INGEST_TIMEOUT_MS}ms`);
      } else {
        logger.warn(`[RAG] news ingest ${symbol} failed: ${err.message}`);
      }
    })
    .finally(() => clearTimeout(timer));
}

export default { ingestNewsHeadlines };
