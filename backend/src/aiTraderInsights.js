/**
 * AI Trader Insights Module
 * 
 * Generates auto-generated insights about trader performance, signal accuracy,
 * and trading patterns. Provides actionable recommendations.
 */

import { query } from './db.js';
import { calculateSignalAccuracy } from './aiTraderSignalAccuracy.js';

// ============================================================================
// Insights Generation
// ============================================================================

/**
 * Generate insights for an AI trader
 * @param {number} traderId - AI Trader ID
 * @param {object} context - Additional context for insight generation
 * @returns {Promise<Array<string>>} Array of insight strings
 */
export async function generateInsights(traderId, context = {}) {
  const insights = [];

  try {
    // Get trader info
    const traderResult = await query(
      'SELECT * FROM ai_traders WHERE id = $1',
      [traderId]
    );
    const trader = traderResult.rows[0];
    
    if (!trader) {
      return insights;
    }

    // Calculate recent signal accuracy
    const accuracy7Days = await calculateSignalAccuracy(traderId, 7);
    const accuracy30Days = await calculateSignalAccuracy(traderId, 30);

    // Get recent performance
    const recentTradesResult = await query(
      `SELECT decision_type, symbol, outcome_pnl, outcome_pnl_percent, 
              ml_score, rl_score, sentiment_score, technical_score
       FROM ai_trader_decisions
       WHERE ai_trader_id = $1
       AND timestamp >= NOW() - INTERVAL '7 days'
       AND executed = true
       AND outcome_pnl IS NOT NULL
       ORDER BY timestamp DESC`,
      [traderId]
    );
    const recentTrades = recentTradesResult.rows;

    // 1. Signal Accuracy Insights
    if (accuracy7Days.ml.accuracy !== null && accuracy30Days.ml.accuracy !== null) {
      const mlDiff = (accuracy7Days.ml.accuracy - accuracy30Days.ml.accuracy) * 100;
      if (Math.abs(mlDiff) > 5) {
        if (mlDiff > 0) {
          insights.push(`🎯 ML-Signale waren diese Woche ${mlDiff.toFixed(0)}% akkurater als der Durchschnitt`);
        } else {
          insights.push(`⚠️ ML-Signale waren diese Woche ${Math.abs(mlDiff).toFixed(0)}% weniger akkurat als üblich`);
        }
      }
    }

    if (accuracy7Days.rl.accuracy !== null && accuracy30Days.rl.accuracy !== null) {
      const rlDiff = (accuracy7Days.rl.accuracy - accuracy30Days.rl.accuracy) * 100;
      if (Math.abs(rlDiff) > 5) {
        if (rlDiff < -5) {
          insights.push(`📉 RL-Agent hatte Schwierigkeiten im aktuellen Marktumfeld`);
        } else if (rlDiff > 5) {
          insights.push(`📈 RL-Agent zeigt starke Performance diese Woche`);
        }
      }
    }

    if (accuracy7Days.sentiment.accuracy !== null && accuracy7Days.sentiment.accuracy < 0.5) {
      insights.push(`📰 News-Sentiment führte zu mehreren ungenauen Signalen diese Woche`);
    }

    if (accuracy7Days.technical.accuracy !== null && accuracy7Days.technical.accuracy > 0.7) {
      insights.push(`⚡ Technical-Indikatoren sind aktuell sehr akkurat`);
    }

    // 2. Performance Insights - Only if we have meaningful data
    if (context.bestTrade && context.bestTrade.pnl_percent > 5 && context.bestTrade.symbol !== 'TEST') {
      insights.push(
        `⚡ Beste Performance bei ${context.bestTrade.symbol}: +${context.bestTrade.pnl_percent.toFixed(1)}% in ${context.bestTrade.holding_days} Tagen`
      );
    }

    // Only show worst trade if it's significant AND not test data
    if (context.worstTrade && context.worstTrade.pnl_percent < -3 && 
        context.worstTrade.symbol !== 'TEST' && 
        Math.abs(context.worstTrade.pnl_percent) < 30) {  // Ignore outliers
      insights.push(
        `⚠️ Größter Verlust bei ${context.worstTrade.symbol}: ${context.worstTrade.pnl_percent.toFixed(1)}%`
      );
    }

    // 3. Win Rate Insights - Only if we have enough data
    const totalOutcomes = (context.winningTrades || 0) + (context.losingTrades || 0);
    if (context.winRate !== null && context.winRate !== undefined && totalOutcomes >= 3) {
      if (context.winRate > 70) {
        insights.push(`🎯 Sehr hohe Win-Rate: ${context.winRate.toFixed(0)}% (${totalOutcomes} Trades)`);
      } else if (context.winRate < 40 && context.winRate > 0) {
        insights.push(`⚠️ Niedrige Win-Rate: ${context.winRate.toFixed(0)}% - Überprüfung der Strategie empfohlen`);
      }
    }

    // 4. Drawdown Warnings
    const maxDrawdown = parseFloat(trader.max_drawdown || 0);
    const riskTolerance = trader.personality?.risk?.maxDrawdown || 20;
    
    if (maxDrawdown > riskTolerance * 0.7) {
      insights.push(
        `⚠️ Max Drawdown nähert sich dem Limit (${maxDrawdown.toFixed(1)}% von ${riskTolerance}%)`
      );
    }

    // 5. Symbol-specific insights
    if (recentTrades.length > 0) {
      const symbolPerformance = {};
      recentTrades.forEach(trade => {
        if (!symbolPerformance[trade.symbol]) {
          symbolPerformance[trade.symbol] = { trades: 0, totalPnl: 0 };
        }
        symbolPerformance[trade.symbol].trades++;
        symbolPerformance[trade.symbol].totalPnl += parseFloat(trade.outcome_pnl || 0);
      });

      const bestSymbol = Object.entries(symbolPerformance)
        .sort((a, b) => b[1].totalPnl - a[1].totalPnl)[0];
      
      if (bestSymbol && bestSymbol[1].totalPnl > 0 && bestSymbol[1].trades >= 2) {
        insights.push(`💰 ${bestSymbol[0]} zeigt starke Performance (${bestSymbol[1].trades} Trades)`);
      }
    }

    // 6. Signal Weight Recommendations
    if (accuracy7Days.technical.accuracy !== null && accuracy7Days.technical.accuracy > 0.75) {
      const currentWeight = trader.personality?.signals?.weights?.technical || 0.25;
      if (currentWeight < 0.35) {
        insights.push(`💡 Empfehlung: Technical-Gewicht erhöhen (aktuell sehr akkurat)`);
      }
    }

    if (accuracy7Days.sentiment.accuracy !== null && accuracy7Days.sentiment.accuracy < 0.4) {
      const currentWeight = trader.personality?.signals?.weights?.sentiment || 0.25;
      if (currentWeight > 0.15) {
        insights.push(`💡 Empfehlung: Sentiment-Gewicht reduzieren (aktuell wenig akkurat)`);
      }
    }

    // 7. Trading Activity Insights - Check actual executed trades
    const executedTradesResult = await query(
      `SELECT COUNT(*) as count FROM ai_trader_decisions
       WHERE ai_trader_id = $1
       AND executed = true
       AND decision_type IN ('buy', 'sell', 'short', 'close')
       AND timestamp >= NOW() - INTERVAL '7 days'`,
      [traderId]
    );
    const executedThisWeek = parseInt(executedTradesResult.rows[0]?.count || 0);
    
    if (executedThisWeek === 0 && trader.status === 'running') {
      insights.push(`⏸️ Keine Trades diese Woche ausgeführt - Marktbedingungen erfüllen möglicherweise nicht die Kriterien`);
    } else if (executedThisWeek >= 5) {
      insights.push(`📊 Aktiver Handel: ${executedThisWeek} Trades diese Woche`);
    } else if (executedThisWeek > 0) {
      insights.push(`📊 ${executedThisWeek} Trade${executedThisWeek > 1 ? 's' : ''} diese Woche ausgeführt`);
    }

    // 8. P&L Insights from context
    if (context.pnlPercent !== null && context.pnlPercent !== undefined) {
      if (context.pnlPercent > 3) {
        insights.push(`🎉 Starker Handelstag: +${context.pnlPercent.toFixed(2)}%`);
      } else if (context.pnlPercent < -2) {
        insights.push(`📉 Herausfordernder Handelstag: ${context.pnlPercent.toFixed(2)}%`);
      }
    }

    // 9. Learning Mode Insights
    if (trader.personality?.learning?.enabled) {
      insights.push(`🧠 Lern-Modus aktiv: Signalgewichte werden automatisch angepasst`);
    }

    // Limit to most relevant insights
    return insights.slice(0, 8);

  } catch (error) {
    console.error('Error generating insights:', error);
    return insights;
  }
}

/**
 * Get insights for display - always generates fresh
 * @param {number} traderId - AI Trader ID
 * @returns {Promise<Array<string>>} Array of recent insights
 */
export async function getInsights(traderId) {
  try {
    // Always generate fresh insights for real-time accuracy
    return await generateInsights(traderId);
  } catch (error) {
    console.error('Error getting insights:', error);
    return [];
  }
}

// ============================================================================
// Persistent Insights Management
// ============================================================================

/**
 * Store a persistent insight in the database
 * @param {number} traderId - AI Trader ID
 * @param {string} insightType - Type: 'trend', 'timing', 'signal', 'risk'
 * @param {string} title - Short insight title
 * @param {string} description - Detailed description
 * @param {object} data - Additional data
 * @param {string} severity - 'info', 'warning', 'critical'
 * @param {Date|null} expiresAt - Optional expiration date
 * @returns {Promise<object>} Created insight
 */
export async function createPersistentInsight(
  traderId,
  insightType,
  title,
  description = null,
  data = null,
  severity = 'info',
  expiresAt = null
) {
  // Validate traderId
  if (!Number.isInteger(traderId) || traderId <= 0) {
    throw new Error('Invalid traderId: must be a positive integer');
  }

  // Validate insightType
  const validInsightTypes = ['trend', 'timing', 'signal', 'risk'];
  if (!validInsightTypes.includes(insightType)) {
    throw new Error(`Invalid insightType: must be one of ${validInsightTypes.join(', ')}`);
  }

  // Validate severity
  const validSeverities = ['info', 'warning', 'critical'];
  if (!validSeverities.includes(severity)) {
    throw new Error(`Invalid severity: must be one of ${validSeverities.join(', ')}`);
  }

  try {
    const result = await query(
      `INSERT INTO ai_trader_insights 
       (ai_trader_id, insight_type, title, description, data, severity, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        traderId,
        insightType,
        title,
        description,
        data != null ? JSON.stringify(data) : null,
        severity,
        expiresAt,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error creating persistent insight:', error);
    throw error;
  }
}

/**
 * Get persistent insights for a trader
 * @param {number} traderId - AI Trader ID
 * @param {boolean} activeOnly - Only return active insights
 * @returns {Promise<Array>} Array of insights
 */
export async function getPersistentInsights(traderId, activeOnly = true) {
  // Validate traderId
  if (!Number.isInteger(traderId) || traderId <= 0) {
    throw new Error('Invalid traderId: must be a positive integer');
  }

  try {
    const params = [traderId];
    let queryText = `
      SELECT * FROM ai_trader_insights
      WHERE ai_trader_id = $1
    `;
    
    if (activeOnly) {
      queryText += ` AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())`;
    }
    
    queryText += ` ORDER BY created_at DESC`;
    
    const result = await query(queryText, params);
    return result.rows;
  } catch (error) {
    console.error('Error getting persistent insights:', error);
    return [];
  }
}

/**
 * Deactivate an insight
 * @param {number} insightId - Insight ID
 * @returns {Promise<boolean>} Success status
 */
export async function deactivateInsight(insightId) {
  // Validate insightId
  if (!Number.isInteger(insightId) || insightId <= 0) {
    throw new Error('Invalid insightId: must be a positive integer');
  }

  try {
    const result = await query(
      `UPDATE ai_trader_insights
       SET is_active = false
       WHERE id = $1`,
      [insightId]
    );
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error deactivating insight:', error);
    return false;
  }
}

/**
 * Clean up expired insights
 * @returns {Promise<number>} Number of insights cleaned up
 */
export async function cleanupExpiredInsights() {
  try {
    const result = await query(
      `UPDATE ai_trader_insights
       SET is_active = false
       WHERE is_active = true
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`
    );
    return result.rowCount;
  } catch (error) {
    console.error('Error cleaning up expired insights:', error);
    return 0;
  }
}
