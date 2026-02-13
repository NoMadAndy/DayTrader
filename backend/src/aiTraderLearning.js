/**
 * AI Trader Adaptive Learning Module
 * 
 * Implements adaptive weight adjustment based on signal accuracy.
 * Automatically adjusts signal weights to optimize performance when learning mode is enabled.
 */

import { query, getClient } from './db.js';
import { calculateSignalAccuracy } from './aiTraderSignalAccuracy.js';
import logger from './logger.js';

// ============================================================================
// Adaptive Weight Adjustment
// ============================================================================

/**
 * Adjust signal weights based on accuracy
 * @param {number} traderId - AI Trader ID
 * @returns {Promise<object>} Result with old and new weights
 */
export async function adjustSignalWeights(traderId) {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');

    // Get trader
    const traderResult = await client.query(
      'SELECT * FROM ai_traders WHERE id = $1',
      [traderId]
    );
    const trader = traderResult.rows[0];
    
    if (!trader) {
      throw new Error('Trader not found');
    }

    const personality = trader.personality || {};
    const learning = personality.learning || {};
    
    // Check if learning is enabled
    if (!learning.enabled || !learning.updateWeights) {
      await client.query('ROLLBACK');
      return {
        adjusted: false,
        reason: 'Learning mode not enabled or weight adjustment disabled',
      };
    }

    // Check minimum trades requirement
    const minTrades = learning.minTradesBeforeAdjust || 20;
    const tradesResult = await client.query(
      `SELECT COUNT(*) as count
       FROM ai_trader_decisions
       WHERE ai_trader_id = $1
       AND executed = true
       AND outcome_was_correct IS NOT NULL`,
      [traderId]
    );
    
    const totalTrades = parseInt(tradesResult.rows[0]?.count || 0);
    
    if (totalTrades < minTrades) {
      await client.query('ROLLBACK');
      return {
        adjusted: false,
        reason: `Not enough trades (${totalTrades}/${minTrades})`,
      };
    }

    // Calculate signal accuracy
    const accuracyDays = learning.accuracyWindow || 30;
    const accuracy = await calculateSignalAccuracy(traderId, accuracyDays);

    // Get current weights
    const currentWeights = personality.signals?.weights || {
      ml: 0.25,
      rl: 0.25,
      sentiment: 0.25,
      technical: 0.25,
    };

    // Calculate new weights based on accuracy
    const maxWeightChange = learning.maxWeightChange || 0.05;
    const newWeights = calculateNewWeights(currentWeights, accuracy, maxWeightChange);

    // Ensure weights sum to 1.0
    const weightsSum = Object.values(newWeights).reduce((sum, w) => sum + w, 0);
    if (Math.abs(weightsSum - 1.0) > 0.001) {
      // Normalize weights
      Object.keys(newWeights).forEach(key => {
        newWeights[key] = newWeights[key] / weightsSum;
      });
    }

    // Check if weights actually changed significantly
    const hasSignificantChange = Object.keys(currentWeights).some(key => 
      Math.abs(newWeights[key] - currentWeights[key]) >= 0.01
    );

    if (!hasSignificantChange) {
      await client.query('ROLLBACK');
      return {
        adjusted: false,
        reason: 'No significant weight changes needed',
        currentWeights,
        accuracy: accuracy.overall,
      };
    }

    // Update trader personality with new weights
    const updatedPersonality = {
      ...personality,
      signals: {
        ...personality.signals,
        weights: newWeights,
      },
    };

    await client.query(
      `UPDATE ai_traders 
       SET personality = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(updatedPersonality), traderId]
    );

    // Log weight adjustment in history
    await client.query(
      `INSERT INTO ai_trader_weight_history (
        ai_trader_id, old_weights, new_weights, reason, accuracy_snapshot
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        traderId,
        JSON.stringify(currentWeights),
        JSON.stringify(newWeights),
        'adaptive_learning',
        JSON.stringify(accuracy),
      ]
    );

    await client.query('COMMIT');
    
    logger.info(`Adjusted weights for trader ${traderId}:`, {
      old: currentWeights,
      new: newWeights,
    });

    return {
      adjusted: true,
      oldWeights: currentWeights,
      newWeights,
      accuracy: accuracy.overall,
      reason: 'Weights adjusted based on signal accuracy',
    };

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error adjusting signal weights:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Calculate new weights based on accuracy
 * @param {object} currentWeights - Current signal weights
 * @param {object} accuracy - Accuracy metrics
 * @param {number} maxChange - Maximum weight change per adjustment
 * @returns {object} New weights
 */
function calculateNewWeights(currentWeights, accuracy, maxChange) {
  const signals = ['ml', 'rl', 'sentiment', 'technical'];
  const newWeights = { ...currentWeights };

  // Calculate performance score for each signal
  const scores = {};
  let totalScore = 0;
  
  signals.forEach(signal => {
    const signalAccuracy = accuracy[signal]?.accuracy;
    if (signalAccuracy !== null && signalAccuracy !== undefined) {
      // Score based on accuracy (0.5 = neutral, higher is better)
      scores[signal] = Math.max(0.1, signalAccuracy);
      totalScore += scores[signal];
    } else {
      // No data, keep current weight
      scores[signal] = currentWeights[signal];
      totalScore += scores[signal];
    }
  });

  // Calculate target weights based on scores
  const targetWeights = {};
  signals.forEach(signal => {
    targetWeights[signal] = scores[signal] / totalScore;
  });

  // Apply gradual adjustment with max change limit
  signals.forEach(signal => {
    const currentWeight = currentWeights[signal];
    const targetWeight = targetWeights[signal];
    const delta = targetWeight - currentWeight;
    
    // Limit change to maxChange
    const adjustedDelta = Math.max(-maxChange, Math.min(maxChange, delta));
    newWeights[signal] = Math.max(0.05, Math.min(0.50, currentWeight + adjustedDelta));
  });

  return newWeights;
}

/**
 * Get weight adjustment history
 * @param {number} traderId - AI Trader ID
 * @param {number} limit - Max number of records
 * @returns {Promise<Array>} Weight history
 */
export async function getWeightHistory(traderId, limit = 20) {
  const result = await query(
    `SELECT * FROM ai_trader_weight_history
     WHERE ai_trader_id = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [traderId, limit]
  );
  return result.rows;
}

/**
 * Get AI traders with learning enabled
 * @returns {Promise<Array>} List of traders
 */
export async function getTradersWithLearningEnabled() {
  const result = await query(
    `SELECT id, name, personality
     FROM ai_traders
     WHERE status IN ('running', 'paused')
     AND personality->>'learning' IS NOT NULL`
  );
  
  return result.rows.filter(trader => {
    const learning = trader.personality?.learning;
    return learning?.enabled === true && learning?.updateWeights === true;
  });
}

/**
 * Manually adjust weights (for testing or manual override)
 * @param {number} traderId - AI Trader ID
 * @param {object} newWeights - New weight configuration
 * @param {string} reason - Reason for adjustment
 * @returns {Promise<object>} Result
 */
export async function manuallyAdjustWeights(traderId, newWeights, reason = 'manual_adjustment') {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');

    // Validate weights
    const signals = ['ml', 'rl', 'sentiment', 'technical'];
    const weightsSum = signals.reduce((sum, signal) => sum + (newWeights[signal] || 0), 0);
    
    if (Math.abs(weightsSum - 1.0) > 0.01) {
      throw new Error('Weights must sum to 1.0');
    }

    // Get current trader
    const traderResult = await client.query(
      'SELECT * FROM ai_traders WHERE id = $1',
      [traderId]
    );
    const trader = traderResult.rows[0];
    
    if (!trader) {
      throw new Error('Trader not found');
    }

    const personality = trader.personality || {};
    const currentWeights = personality.signals?.weights || {};

    // Update personality
    const updatedPersonality = {
      ...personality,
      signals: {
        ...personality.signals,
        weights: newWeights,
      },
    };

    await client.query(
      `UPDATE ai_traders 
       SET personality = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(updatedPersonality), traderId]
    );

    // Log in history
    await client.query(
      `INSERT INTO ai_trader_weight_history (
        ai_trader_id, old_weights, new_weights, reason, accuracy_snapshot
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        traderId,
        JSON.stringify(currentWeights),
        JSON.stringify(newWeights),
        reason,
        null,
      ]
    );

    await client.query('COMMIT');
    
    return {
      success: true,
      oldWeights: currentWeights,
      newWeights,
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
