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

    // 2. Performance Insights
    if (context.bestTrade && context.bestTrade.pnl_percent > 5) {
      insights.push(
        `⚡ Beste Performance bei ${context.bestTrade.symbol}: +${context.bestTrade.pnl_percent.toFixed(1)}% in ${context.bestTrade.holding_days} Tagen`
      );
    }

    if (context.worstTrade && context.worstTrade.pnl_percent < -3) {
      insights.push(
        `⚠️ Größter Verlust bei ${context.worstTrade.symbol}: ${context.worstTrade.pnl_percent.toFixed(1)}%`
      );
    }

    // 3. Win Rate Insights
    if (context.winRate !== null && context.winRate !== undefined) {
      if (context.winRate > 70) {
        insights.push(`🎯 Sehr hohe Win-Rate: ${context.winRate.toFixed(0)}%`);
      } else if (context.winRate < 40) {
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

    // 7. Trading Activity Insights
    const tradesThisWeek = recentTrades.length;
    if (tradesThisWeek === 0) {
      insights.push(`⏸️ Keine Trades diese Woche - Marktbedingungen erfüllen möglicherweise nicht die Kriterien`);
    } else if (tradesThisWeek > 10) {
      insights.push(`📊 Hohe Handelsaktivität: ${tradesThisWeek} Trades diese Woche`);
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
 * Get insights for display
 * @param {number} traderId - AI Trader ID
 * @returns {Promise<Array<string>>} Array of recent insights
 */
export async function getInsights(traderId) {
  try {
    // Get the most recent daily report
    const reportResult = await query(
      `SELECT insights FROM ai_trader_daily_reports
       WHERE ai_trader_id = $1
       ORDER BY report_date DESC
       LIMIT 1`,
      [traderId]
    );

    if (reportResult.rows.length > 0 && reportResult.rows[0].insights) {
      return reportResult.rows[0].insights;
    }

    // If no report exists, generate fresh insights
    return await generateInsights(traderId);
  } catch (error) {
    console.error('Error getting insights:', error);
    return [];
  }
}
