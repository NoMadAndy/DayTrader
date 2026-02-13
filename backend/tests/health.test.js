/**
 * Backend smoke tests using Node.js built-in test runner
 * Run with: node --test backend/tests/
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

describe('Backend Health', () => {
  it('GET /health returns 200', async () => {
    const res = await fetch(`${BACKEND_URL}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.ok(data.version);
  });

  it('health response contains version 1.39.0', async () => {
    const res = await fetch(`${BACKEND_URL}/health`);
    const data = await res.json();
    assert.match(data.version, /^1\.39/);
  });
});

describe('Backend API Endpoints', () => {
  it('GET / returns 404 (no root handler)', async () => {
    const res = await fetch(`${BACKEND_URL}/`);
    assert.equal(res.status, 404);
  });

  it('health response has required fields', async () => {
    const res = await fetch(`${BACKEND_URL}/health`);
    const data = await res.json();
    assert.ok(data.timestamp, 'Missing timestamp');
    assert.ok(data.database, 'Missing database status');
    assert.ok(data.commit !== undefined, 'Missing commit');
    assert.ok(data.buildTime, 'Missing buildTime');
  });
});
