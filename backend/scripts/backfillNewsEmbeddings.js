#!/usr/bin/env node
/**
 * Backfill historical news headlines from sentiment_archive into the
 * Qdrant `news` collection.
 *
 * Reads sources/news_headlines JSONB rows in chunks, embeds them via
 * ml-service /rag/ingest/news (which handles bge embedding + Qdrant upsert),
 * and is resumable via --since=<ISO-date> or --cursor-id=<int>.
 *
 * Usage:
 *   node scripts/backfillNewsEmbeddings.js [--since=2025-01-01] [--limit=10000] [--batch=64]
 *
 * IDs are stable hashes of (symbol, url|headline) so re-runs are idempotent.
 */

import crypto from 'crypto';
import { query } from '../src/db.js';
import logger from '../src/logger.js';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

function arg(name, fallback = null) {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.split('=')[1] : fallback;
}

function stableId(symbol, headline, url) {
  const key = `${symbol}|${url || headline}`;
  const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function toUnixSeconds(value, fallback) {
  if (!value) return fallback;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? Math.floor((ms > 1e12 ? ms : ms * 1000) / 1000) : fallback;
}

async function ingestBatch(items) {
  if (items.length === 0) return 0;
  const res = await fetch(`${ML_SERVICE_URL}/rag/ingest/news`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ml-service /rag/ingest/news ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.upserted || 0;
}

async function main() {
  const since = arg('since');
  const limit = parseInt(arg('limit', '50000'), 10);
  const batchSize = parseInt(arg('batch', '64'), 10);

  const where = ['1=1'];
  const params = [];
  if (since) {
    params.push(since);
    where.push(`analyzed_at >= $${params.length}`);
  }
  params.push(limit);
  const sql = `
    SELECT id, symbol, analyzed_at, sources
      FROM sentiment_archive
     WHERE ${where.join(' AND ')}
     ORDER BY analyzed_at ASC
     LIMIT $${params.length}
  `;

  logger.info(`[Backfill] Querying sentiment_archive (since=${since || 'all'}, limit=${limit})…`);
  const { rows } = await query(sql, params);
  logger.info(`[Backfill] ${rows.length} archive rows to scan`);

  const seenIds = new Set();
  let queued = [];
  let totalUpserted = 0;
  let totalSkipped = 0;
  let processedRows = 0;

  for (const row of rows) {
    processedRows += 1;
    const fallbackTs = Math.floor(new Date(row.analyzed_at).getTime() / 1000);
    const sources = Array.isArray(row.sources) ? row.sources : [];
    for (const s of sources) {
      const headline = s && s.headline;
      if (!headline) {
        totalSkipped += 1;
        continue;
      }
      const id = stableId(row.symbol, headline, s.url);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      queued.push({
        id,
        text: headline,
        payload: {
          symbol: String(row.symbol).toUpperCase(),
          published_at: toUnixSeconds(s.published, fallbackTs),
          url: s.url || null,
          source: s.source || s.provider || null,
          title: headline,
          sentiment_score: typeof s.sentiment_score === 'number' ? s.sentiment_score : null,
        },
      });
      if (queued.length >= batchSize) {
        totalUpserted += await ingestBatch(queued);
        queued = [];
        if (totalUpserted % 512 === 0) {
          logger.info(`[Backfill] progress: rows=${processedRows}/${rows.length} upserted=${totalUpserted}`);
        }
      }
    }
  }
  if (queued.length > 0) {
    totalUpserted += await ingestBatch(queued);
  }

  logger.info(`[Backfill] done. rows=${processedRows} unique_headlines=${seenIds.size} upserted=${totalUpserted} skipped=${totalSkipped}`);
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[Backfill] failed: ${err.stack || err.message}`);
  process.exit(1);
});
