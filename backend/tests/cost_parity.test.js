/**
 * Cost-Parity-Regression: Backend trading.js vs. RL-Env trading_env.py
 *
 * Both services must agree on broker fees for identical trades, otherwise
 * a backtest in one service will diverge from live execution in the other.
 * This test locks the contract for the `standard` profile using hand-computed
 * expected values (matching the BROKER_FEES/BROKER_PROFILES tables).
 *
 * If you change either fee config, update the expected numbers below AND
 * keep them synced — the drift itself is the bug.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFees, BROKER_PROFILES } from '../src/trading.js';

describe('calculateFees — standard profile', () => {
  const profile = BROKER_PROFILES.standard;

  it('matches hand-computed fee for 1000 USD buy (below min_fee floor)', () => {
    const fees = calculateFees({
      productType: 'stock', side: 'buy', quantity: 10, price: 100,
      leverage: 1, brokerProfile: 'standard',
    });
    // notional = 1000, mixed: 4.95 + 1000*0.0025 = 7.45
    // commission = clamp(4.95..59, 7.45) = 7.45
    // spread = 1000 * 0.0015 = 1.50
    assert.equal(fees.commission.toFixed(2), '7.45');
    assert.equal(fees.spreadCost.toFixed(2), '1.50');
    assert.equal(fees.totalFees.toFixed(2), '8.95');
  });

  it('hits the min-fee floor at very small notional', () => {
    const fees = calculateFees({
      productType: 'stock', side: 'buy', quantity: 1, price: 50,
      leverage: 1, brokerProfile: 'standard',
    });
    // notional = 50, mixed: 4.95 + 50*0.0025 = 5.075
    // commission = clamp(4.95..59, 5.075) = 5.075
    // spread = 50 * 0.0015 = 0.075
    assert.equal(fees.commission.toFixed(4), '5.0750');
    assert.equal(fees.totalFees.toFixed(4), '5.1500');
  });

  it('hits the max-fee ceiling at large notional', () => {
    // To trigger max: mixed component must exceed 59.
    // 4.95 + notional*0.0025 > 59  ⇒  notional > 21620
    const fees = calculateFees({
      productType: 'stock', side: 'buy', quantity: 1, price: 30000,
      leverage: 1, brokerProfile: 'standard',
    });
    // notional = 30000, mixed candidate 4.95 + 75 = 79.95, clamped to 59
    assert.equal(fees.commission.toFixed(2), '59.00');
    // spread = 30000 * 0.0015 = 45
    assert.equal(fees.spreadCost.toFixed(2), '45.00');
    assert.equal(fees.totalFees.toFixed(2), '104.00');
  });

  it('effectivePrice includes half-spread on each side', () => {
    const buy = calculateFees({ productType: 'stock', side: 'buy', quantity: 10, price: 100, leverage: 1, brokerProfile: 'standard' });
    const sell = calculateFees({ productType: 'stock', side: 'sell', quantity: 10, price: 100, leverage: 1, brokerProfile: 'standard' });
    // spread 0.15% → half-spread 0.075%
    assert.equal(buy.effectivePrice.toFixed(5),  (100 * 1.00075).toFixed(5));
    assert.equal(sell.effectivePrice.toFixed(5), (100 * 0.99925).toFixed(5));
  });

  it('standard profile table matches RL-env BROKER_FEES[standard]', () => {
    // These values are hand-synced with rl-trading-service/app/trading_env.py::BROKER_FEES.
    // If either side changes, update BOTH and this test.
    assert.equal(profile.stockCommission.flatFee, 4.95);
    assert.equal(profile.stockCommission.percentageFee, 0.25);
    assert.equal(profile.stockCommission.minimumFee, 4.95);
    assert.equal(profile.stockCommission.maximumFee, 59.00);
    assert.equal(profile.stockCommission.type, 'mixed');
    assert.equal(profile.spreadPercent, 0.15);
    // RL-env side uses decimal fractions, backend uses percent values; the
    // conversion rule is `rl.percentage_fee = backend.percentageFee / 100`,
    // `rl.spread_pct = backend.spreadPercent / 100`. Same math, different unit.
  });
});

describe('calculateFees — ingdiba profile (with exchangeFee)', () => {
  it('includes the 2.05 exchangeFee on top of commission', () => {
    const fees = calculateFees({
      productType: 'stock', side: 'buy', quantity: 10, price: 100,
      leverage: 1, brokerProfile: 'ingdiba',
    });
    // notional = 1000. mixed: 5.30 + 2.50 = 7.80, clamp(10.70..75.50) = 10.70
    // + exchangeFee 2.05 → commission = 12.75
    // spread = 1000 * 0.0005 = 0.50
    assert.equal(fees.commission.toFixed(2), '12.75');
    assert.equal(fees.totalFees.toFixed(2), '13.25');
  });
});

describe('calculateFees — round-trip break-even', () => {
  it('reports correct break-even move for round-trip', () => {
    const fees = calculateFees({ productType: 'stock', side: 'buy', quantity: 10, price: 100, leverage: 1, brokerProfile: 'standard' });
    // totalFees = 8.95 per side. Round-trip fees = 17.90 on 1000 notional.
    // breakEvenMove = 17.90 / 1000 * 100 = 1.79%
    assert.equal(fees.breakEvenMove.toFixed(2), '1.79');
  });
});
