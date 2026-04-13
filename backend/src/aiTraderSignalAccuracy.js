/**
 * AI Trader Signal Accuracy Module
 * 
 * Calculates and tracks accuracy of different signal sources (ML, RL, Sentiment, Technical).
 * Accuracy is determined by comparing signal predictions with actual trade outcomes.
 */

import { query } from './db.js';
import logger from './logger.js';

// ============================================================================
// Rank-IC helpers
// ============================================================================

// Fractional ranks with tie handling (average rank for ties) — mirrors
// scipy.stats.rankdata(method='average'). Returns ranks starting at 1.
function rankWithTies(values) {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && indexed[j + 1].v === indexed[k].v) j += 1;
    const avgRank = (k + j) / 2 + 1; // 1-based average
    for (let m = k; m <= j; m += 1) ranks[indexed[m].i] = avgRank;
    k = j + 1;
  }
  return ranks;
}

// Spearman rank correlation between two numeric arrays. Returns null when
// fewer than 3 valid pairs or when variance is zero on either side (signal
// is noise-free of informative variation).
export function rankIC(scores, returns) {
  if (!Array.isArray(scores) || !Array.isArray(returns)) return null;
  const xs = [];
  const ys = [];
  for (let i = 0; i < scores.length; i += 1) {
    const x = Number(scores[i]);
    const y = Number(returns[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  if (xs.length < 3) return null;
  const rx = rankWithTies(xs);
  const ry = rankWithTies(ys);
  const n = rx.length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  if (denom === 0) return null;
  return num / denom;
}

// ============================================================================
// Signal Accuracy Calculation
// ============================================================================

/**
 * Calculate signal accuracy for an AI trader
 * @param {number} traderId - AI Trader ID
 * @param {number} days - Number of days to analyze (default: 30)
 * @returns {Promise<object>} Accuracy metrics per signal source
 */
export async function calculateSignalAccuracy(traderId, days = 30) {
  try {
    // Get date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all decisions with outcomes in the date range
    const result = await query(
      `SELECT 
        decision_type,
        ml_score,
        rl_score,
        sentiment_score,
        technical_score,
        outcome_was_correct,
        outcome_pnl
       FROM ai_trader_decisions
       WHERE ai_trader_id = $1
       AND timestamp >= $2
       AND timestamp <= $3
       AND executed = true
       AND outcome_was_correct IS NOT NULL
       ORDER BY timestamp DESC`,
      [traderId, startDate, endDate]
    );

    const decisions = result.rows;

    if (decisions.length === 0) {
      return {
        ml: { accuracy: null, totalSignals: 0, correct: 0, incorrect: 0 },
        rl: { accuracy: null, totalSignals: 0, correct: 0, incorrect: 0 },
        sentiment: { accuracy: null, totalSignals: 0, correct: 0, incorrect: 0 },
        technical: { accuracy: null, totalSignals: 0, correct: 0, incorrect: 0 },
        overall: { accuracy: null, totalTrades: 0, correct: 0, incorrect: 0 },
      };
    }

    // Calculate accuracy for each signal source
    const mlSignals = decisions.filter(d => d.ml_score !== null);
    const rlSignals = decisions.filter(d => d.rl_score !== null);
    const sentimentSignals = decisions.filter(d => d.sentiment_score !== null);
    const technicalSignals = decisions.filter(d => d.technical_score !== null);

    // For each signal, determine if it was "correct" based on:
    // - If the signal was positive (> 0.5) and the trade was profitable
    // - If the signal was negative (< 0.5) and avoided a loss
    // - outcome_was_correct field directly indicates correctness

    const mlStats = calculateSignalStats(mlSignals, 'ml_score');
    const rlStats = calculateSignalStats(rlSignals, 'rl_score');
    const sentimentStats = calculateSignalStats(sentimentSignals, 'sentiment_score');
    const technicalStats = calculateSignalStats(technicalSignals, 'technical_score');

    // Overall accuracy
    const correctDecisions = decisions.filter(d => d.outcome_was_correct === true).length;
    const incorrectDecisions = decisions.filter(d => d.outcome_was_correct === false).length;
    const overallAccuracy = decisions.length > 0 
      ? (correctDecisions / decisions.length) 
      : null;

    return {
      ml: {
        accuracy: mlStats.accuracy,
        totalSignals: mlStats.total,
        correct: mlStats.correct,
        incorrect: mlStats.incorrect,
        ic: mlStats.ic,
      },
      rl: {
        accuracy: rlStats.accuracy,
        totalSignals: rlStats.total,
        correct: rlStats.correct,
        incorrect: rlStats.incorrect,
        ic: rlStats.ic,
      },
      sentiment: {
        accuracy: sentimentStats.accuracy,
        totalSignals: sentimentStats.total,
        correct: sentimentStats.correct,
        incorrect: sentimentStats.incorrect,
        ic: sentimentStats.ic,
      },
      technical: {
        accuracy: technicalStats.accuracy,
        totalSignals: technicalStats.total,
        correct: technicalStats.correct,
        incorrect: technicalStats.incorrect,
        ic: technicalStats.ic,
      },
      overall: {
        accuracy: overallAccuracy,
        totalTrades: decisions.length,
        correct: correctDecisions,
        incorrect: incorrectDecisions,
      },
    };
  } catch (error) {
    logger.error('Error calculating signal accuracy:', error);
    throw error;
  }
}

/**
 * Calculate statistics for a specific signal source
 * @param {Array} signals - Array of decisions with the signal
 * @param {string} scoreField - Field name for the score
 * @returns {object} Statistics
 */
function calculateSignalStats(signals, scoreField) {
  if (signals.length === 0) {
    return { accuracy: null, total: 0, correct: 0, incorrect: 0, ic: null };
  }

  const correct = signals.filter(s => s.outcome_was_correct === true).length;
  const incorrect = signals.filter(s => s.outcome_was_correct === false).length;
  const accuracy = signals.length > 0 ? (correct / signals.length) : null;

  // Rank-IC: wie stark korreliert der rohe Score mit dem tatsächlichen Return?
  // Win-Rate (binär, schwellen-abhängig) fängt keine Degradation ab, solange
  // die Schwelle die Hälfte der Trades korrekt klassifiziert. IC tut das.
  const scores = signals.map(s => s[scoreField]);
  const pnls = signals.map(s => s.outcome_pnl);
  const ic = rankIC(scores, pnls);

  return {
    accuracy,
    total: signals.length,
    correct,
    incorrect,
    ic,
  };
}

/**
 * Get signal accuracy trend over time
 * @param {number} traderId - AI Trader ID
 * @param {number} days - Number of days to analyze
 * @param {number} interval - Interval in days for grouping
 * @returns {Promise<Array>} Array of accuracy data points over time
 */
export async function getSignalAccuracyTrend(traderId, days = 30, interval = 7) {
  const trend = [];
  const periods = Math.ceil(days / interval);
  
  for (let i = 0; i < periods; i++) {
    const endDaysAgo = i * interval;
    const startDaysAgo = (i + 1) * interval;
    
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - endDaysAgo);
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - startDaysAgo);
    
    const accuracy = await calculateSignalAccuracyForPeriod(traderId, startDate, endDate);
    
    trend.unshift({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      ...accuracy,
    });
  }
  
  return trend;
}

/**
 * Calculate signal accuracy for a specific time period
 * @param {number} traderId - AI Trader ID
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<object>} Accuracy metrics
 */
async function calculateSignalAccuracyForPeriod(traderId, startDate, endDate) {
  const result = await query(
    `SELECT
      decision_type,
      ml_score,
      rl_score,
      sentiment_score,
      technical_score,
      outcome_was_correct,
      outcome_pnl
     FROM ai_trader_decisions
     WHERE ai_trader_id = $1
     AND timestamp >= $2
     AND timestamp <= $3
     AND executed = true
     AND outcome_was_correct IS NOT NULL`,
    [traderId, startDate, endDate]
  );

  const decisions = result.rows;

  if (decisions.length === 0) {
    return {
      ml: { accuracy: null, ic: null },
      rl: { accuracy: null, ic: null },
      sentiment: { accuracy: null, ic: null },
      technical: { accuracy: null, ic: null },
      overall: null,
    };
  }

  const mlStats = calculateSignalStats(decisions.filter(d => d.ml_score !== null), 'ml_score');
  const rlStats = calculateSignalStats(decisions.filter(d => d.rl_score !== null), 'rl_score');
  const sentimentStats = calculateSignalStats(decisions.filter(d => d.sentiment_score !== null), 'sentiment_score');
  const technicalStats = calculateSignalStats(decisions.filter(d => d.technical_score !== null), 'technical_score');

  const overallAccuracy = decisions.length > 0
    ? decisions.filter(d => d.outcome_was_correct === true).length / decisions.length
    : null;

  return {
    ml: { accuracy: mlStats.accuracy, ic: mlStats.ic },
    rl: { accuracy: rlStats.accuracy, ic: rlStats.ic },
    sentiment: { accuracy: sentimentStats.accuracy, ic: sentimentStats.ic },
    technical: { accuracy: technicalStats.accuracy, ic: technicalStats.ic },
    overall: overallAccuracy,
  };
}
