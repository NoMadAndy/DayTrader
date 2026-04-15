/**
 * Unit tests for providerCall quota + cache logic.
 *
 * We stub db.query (which stockCache uses internally for getCached /
 * getStaleCached / setCache / rate-limit persistence) and drive the whole
 * gate through the real providerCall entrypoint. No live Postgres needed.
 *
 * Run: cd backend && node --test tests/providerCall.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import db from '../src/db.js';
import * as stockCache from '../src/stockCache.js';
import { providerCall, ProviderQuotaError } from '../src/providerCall.js';

/** Builds a db.query stub that returns fixed rows depending on SQL shape. */
function stubDb({ cachedRow = null, staleRow = null } = {}) {
  db.query = async (sql /*, params */) => {
    const s = String(sql);
    if (s.includes('UPDATE stock_data_cache') && s.includes('hit_count = hit_count + 1')) {
      return { rows: cachedRow ? [cachedRow] : [], rowCount: cachedRow ? 1 : 0 };
    }
    if (s.includes('FROM stock_data_cache') && s.includes('ORDER BY created_at DESC')) {
      return { rows: staleRow ? [staleRow] : [], rowCount: staleRow ? 1 : 0 };
    }
    // All other queries (inserts, upserts, hydrate) are no-ops.
    return { rows: [], rowCount: 0 };
  };
}

async function resetCounters() {
  // Reload-from-DB with empty rows zeroes everything.
  db.query = async () => ({ rows: [], rowCount: 0 });
  await stockCache.loadRateLimitStateFromDB();
}

describe('providerCall', () => {
  beforeEach(async () => { await resetCounters(); });

  it('throws ProviderQuotaError when perDay is exhausted and no stale cache', async () => {
    for (let i = 0; i < 25; i++) await stockCache.recordRequest('alphaVantage');
    stubDb({ cachedRow: null, staleRow: null });

    await assert.rejects(
      () =>
        providerCall('alphaVantage', async () => ({ ok: true }), {
          cacheKey: 'test:av:missing',
          cacheType: 'quote',
          source: 'alphavantage',
          ttlSeconds: 60,
        }),
      ProviderQuotaError
    );
  });

  it('serves stale cache when quota blocks and allowStale=true', async () => {
    for (let i = 0; i < 25; i++) await stockCache.recordRequest('alphaVantage');
    stubDb({
      cachedRow: null,
      staleRow: {
        data: { price: 123 },
        source: 'alphavantage',
        created_at: new Date(Date.now() - 3600_000),
        expires_at: new Date(Date.now() - 1800_000),
      },
    });

    const res = await providerCall('alphaVantage', async () => ({ ok: true }), {
      cacheKey: 'test:av:stale',
      cacheType: 'quote',
      source: 'alphavantage',
      ttlSeconds: 60,
      allowStale: true,
    });
    assert.equal(res.stale, true);
    assert.equal(res.fromCache, true);
    assert.deepEqual(res.data, { price: 123 });
  });

  it('returns fresh cache without calling fetchFn', async () => {
    stubDb({
      cachedRow: { data: { fresh: true }, source: 'alphavantage', created_at: new Date() },
    });
    let called = false;
    const res = await providerCall('alphaVantage', async () => {
      called = true;
      return { never: 'called' };
    }, {
      cacheKey: 'test:av:fresh',
      cacheType: 'quote',
      source: 'alphavantage',
      ttlSeconds: 60,
    });
    assert.equal(res.fromCache, true);
    assert.deepEqual(res.data, { fresh: true });
    assert.equal(called, false);
  });

  it('executes fetchFn when quota ok and cache miss', async () => {
    stubDb({ cachedRow: null, staleRow: null });
    let calls = 0;
    const res = await providerCall('twelveData', async () => {
      calls++;
      return { live: true };
    }, {
      cacheKey: 'test:td:live',
      cacheType: 'quote',
      source: 'twelvedata',
      ttlSeconds: 60,
    });
    assert.equal(res.fromCache, false);
    assert.deepEqual(res.data, { live: true });
    assert.equal(calls, 1);
  });

  it('throws ProviderQuotaError when allowStale=false even if stale exists', async () => {
    for (let i = 0; i < 25; i++) await stockCache.recordRequest('alphaVantage');
    stubDb({
      cachedRow: null,
      staleRow: {
        data: { price: 1 },
        source: 'alphavantage',
        created_at: new Date(Date.now() - 3600_000),
        expires_at: new Date(Date.now() - 1800_000),
      },
    });

    await assert.rejects(
      () =>
        providerCall('alphaVantage', async () => ({ ok: true }), {
          cacheKey: 'test:av:nostale',
          cacheType: 'quote',
          source: 'alphavantage',
          ttlSeconds: 60,
          allowStale: false,
        }),
      ProviderQuotaError
    );
  });

  it('validates required options', async () => {
    await assert.rejects(() => providerCall('alphaVantage', async () => ({}), {}), /cacheKey required/);
    await assert.rejects(
      () => providerCall('alphaVantage', async () => ({}), { cacheKey: 'x' }),
      /cacheType required/
    );
    await assert.rejects(
      () => providerCall('alphaVantage', async () => ({}), { cacheKey: 'x', cacheType: 'quote' }),
      /source required/
    );
    await assert.rejects(
      () => providerCall('alphaVantage', async () => ({}), { cacheKey: 'x', cacheType: 'quote', source: 'av' }),
      /ttlSeconds/
    );
  });
});

describe('stockCache.checkQuota', () => {
  beforeEach(async () => { await resetCounters(); });

  it('returns ok=true for unknown provider', () => {
    const r = stockCache.checkQuota('doesNotExist');
    assert.equal(r.ok, true);
    assert.equal(r.reason, null);
  });

  it('returns perDay when daily cap reached', async () => {
    for (let i = 0; i < 25; i++) await stockCache.recordRequest('alphaVantage');
    const r = stockCache.checkQuota('alphaVantage');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'perDay');
  });

  it('returns perMonth when monthly cap reached (mediastack)', async () => {
    for (let i = 0; i < 500; i++) await stockCache.recordRequest('mediastack');
    const r = stockCache.checkQuota('mediastack');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'perMonth');
  });
});

describe('stockCache.getRateLimitStatus', () => {
  beforeEach(async () => { await resetCounters(); });

  it('exposes all configured providers with shape', () => {
    const status = stockCache.getRateLimitStatus();
    for (const p of ['alphaVantage', 'twelveData', 'finnhub', 'yahoo', 'newsdata', 'marketaux', 'fmp', 'tiingo', 'mediastack']) {
      assert.ok(status[p], `missing provider ${p}`);
      assert.ok('usedToday' in status[p]);
      assert.ok('remainingToday' in status[p]);
      assert.ok('blockedToday' in status[p]);
      assert.ok('staleServedToday' in status[p]);
    }
  });
});
