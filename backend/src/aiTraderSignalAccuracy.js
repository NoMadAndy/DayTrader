/**
 * AI Trader Signal Accuracy Module
 * 
 * Calculates and tracks accuracy of different signal sources (ML, RL, Sentiment, Technical).
 * Accuracy is determined by comparing signal predictions with actual trade outcomes.
 */

import { query } from './db.js';
import logger from './logger.js';

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
      },
      rl: {
        accuracy: rlStats.accuracy,
        totalSignals: rlStats.total,
        correct: rlStats.correct,
        incorrect: rlStats.incorrect,
      },
      sentiment: {
        accuracy: sentimentStats.accuracy,
        totalSignals: sentimentStats.total,
        correct: sentimentStats.correct,
        incorrect: sentimentStats.incorrect,
      },
      technical: {
        accuracy: technicalStats.accuracy,
        totalSignals: technicalStats.total,
        correct: technicalStats.correct,
        incorrect: technicalStats.incorrect,
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
    return { accuracy: null, total: 0, correct: 0, incorrect: 0 };
  }

  // Use outcome_was_correct as the primary indicator
  const correct = signals.filter(s => s.outcome_was_correct === true).length;
  const incorrect = signals.filter(s => s.outcome_was_correct === false).length;
  const accuracy = signals.length > 0 ? (correct / signals.length) : null;

  return {
    accuracy,
    total: signals.length,
    correct,
    incorrect,
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
      outcome_was_correct
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
      ml: null,
      rl: null,
      sentiment: null,
      technical: null,
      overall: null,
    };
  }

  const mlSignals = decisions.filter(d => d.ml_score !== null);
  const rlSignals = decisions.filter(d => d.rl_score !== null);
  const sentimentSignals = decisions.filter(d => d.sentiment_score !== null);
  const technicalSignals = decisions.filter(d => d.technical_score !== null);

  const mlAccuracy = mlSignals.length > 0
    ? mlSignals.filter(s => s.outcome_was_correct === true).length / mlSignals.length
    : null;
  
  const rlAccuracy = rlSignals.length > 0
    ? rlSignals.filter(s => s.outcome_was_correct === true).length / rlSignals.length
    : null;
  
  const sentimentAccuracy = sentimentSignals.length > 0
    ? sentimentSignals.filter(s => s.outcome_was_correct === true).length / sentimentSignals.length
    : null;
  
  const technicalAccuracy = technicalSignals.length > 0
    ? technicalSignals.filter(s => s.outcome_was_correct === true).length / technicalSignals.length
    : null;

  const overallAccuracy = decisions.length > 0
    ? decisions.filter(d => d.outcome_was_correct === true).length / decisions.length
    : null;

  return {
    ml: mlAccuracy,
    rl: rlAccuracy,
    sentiment: sentimentAccuracy,
    technical: technicalAccuracy,
    overall: overallAccuracy,
  };
}
