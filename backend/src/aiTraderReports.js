/**
 * AI Trader Daily Reports Module
 * 
 * Handles generation and management of daily performance reports for AI traders.
 * Reports include trading statistics, signal accuracy, and auto-generated insights.
 */

import { query, getClient } from './db.js';
import { calculateSignalAccuracy } from './aiTraderSignalAccuracy.js';
import { generateInsights } from './aiTraderInsights.js';

// ============================================================================
// Daily Report Generation
// ============================================================================

/**
 * Generate daily report for an AI trader
 * @param {number} traderId - AI Trader ID
 * @param {Date} date - Report date (defaults to today)
 * @returns {Promise<object>} Generated report
 */
export async function generateDailyReport(traderId, date = new Date()) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Normalize date to start of day
    const reportDate = new Date(date);
    reportDate.setHours(0, 0, 0, 0);
    const reportDateStr = reportDate.toISOString().split('T')[0];

    // Get start and end of day timestamps
    const startOfDay = new Date(reportDate);
    const endOfDay = new Date(reportDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get portfolio snapshots for start and end of day
    const portfolioStart = await getPortfolioValueAtTime(traderId, startOfDay, client);
    const portfolioEnd = await getPortfolioValueAtTime(traderId, endOfDay, client);

    // Calculate P&L
    const startValue = portfolioStart || 0;
    const endValue = portfolioEnd || 0;
    const pnl = endValue - startValue;
    const pnlPercent = startValue > 0 ? (pnl / startValue) * 100 : 0;

    // Get day's trades
    const tradesResult = await client.query(
      `SELECT d.*, o.fee, o.total_cost, o.total_proceeds
       FROM ai_trader_decisions d
       LEFT JOIN orders o ON d.order_id = o.id
       WHERE d.ai_trader_id = $1 
       AND d.timestamp >= $2 
       AND d.timestamp <= $3
       AND d.executed = true
       ORDER BY d.timestamp`,
      [traderId, startOfDay, endOfDay]
    );
    const trades = tradesResult.rows;

    // Calculate trading statistics
    const tradesExecuted = trades.length;
    const feesPaid = trades.reduce((sum, t) => sum + (parseFloat(t.fee) || 0), 0);

    // Positions opened/closed
    const positionsOpened = trades.filter(t => t.decision_type === 'buy').length;
    const positionsClosed = trades.filter(t => t.decision_type === 'sell' || t.decision_type === 'close').length;

    // Win/Loss statistics from closed positions
    const closedTrades = trades.filter(t => 
      t.decision_type === 'close' || t.decision_type === 'sell'
    );
    
    const winningTrades = closedTrades.filter(t => {
      const pnl = t.outcome_pnl || 0;
      return pnl > 0;
    }).length;
    
    const losingTrades = closedTrades.filter(t => {
      const pnl = t.outcome_pnl || 0;
      return pnl < 0;
    }).length;

    const winRate = closedTrades.length > 0 
      ? (winningTrades / closedTrades.length) * 100 
      : null;

    // Average win/loss
    const wins = closedTrades.filter(t => (t.outcome_pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.outcome_pnl || 0) < 0);
    
    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + (t.outcome_pnl || 0), 0) / wins.length
      : null;
    
    const avgLoss = losses.length > 0
      ? losses.reduce((sum, t) => sum + (t.outcome_pnl || 0), 0) / losses.length
      : null;

    // Best and worst trades
    let bestTrade = null;
    let worstTrade = null;
    
    if (closedTrades.length > 0) {
      const sorted = [...closedTrades].sort((a, b) => 
        (b.outcome_pnl || 0) - (a.outcome_pnl || 0)
      );
      
      if (sorted[0] && sorted[0].outcome_pnl > 0) {
        bestTrade = {
          symbol: sorted[0].symbol,
          pnl: sorted[0].outcome_pnl,
          pnl_percent: sorted[0].outcome_pnl_percent,
          holding_days: sorted[0].outcome_holding_days,
        };
      }
      
      if (sorted[sorted.length - 1] && sorted[sorted.length - 1].outcome_pnl < 0) {
        worstTrade = {
          symbol: sorted[sorted.length - 1].symbol,
          pnl: sorted[sorted.length - 1].outcome_pnl,
          pnl_percent: sorted[sorted.length - 1].outcome_pnl_percent,
          holding_days: sorted[sorted.length - 1].outcome_holding_days,
        };
      }
    }

    // Get all decisions (including non-executed)
    const decisionsResult = await client.query(
      `SELECT COUNT(*) as count
       FROM ai_trader_decisions
       WHERE ai_trader_id = $1 
       AND timestamp >= $2 
       AND timestamp <= $3`,
      [traderId, startOfDay, endOfDay]
    );
    const decisionsAnalyzed = parseInt(decisionsResult.rows[0]?.count || 0);

    // Calculate signal accuracy for the day
    const signalAccuracy = await calculateSignalAccuracy(traderId, 1); // 1 day

    // Get open positions at end of day
    const openPositionsResult = await client.query(
      `SELECT symbol, quantity, avg_price, current_price, unrealized_pnl, unrealized_pnl_percent
       FROM positions
       WHERE portfolio_id = (SELECT portfolio_id FROM ai_traders WHERE id = $1)
       AND status = 'open'
       AND updated_at <= $2`,
      [traderId, endOfDay]
    );
    const openPositions = openPositionsResult.rows;

    // Generate insights
    const insights = await generateInsights(traderId, {
      date: reportDate,
      trades,
      signalAccuracy,
      pnl,
      pnlPercent,
      winRate,
      bestTrade,
      worstTrade,
    });

    // Insert or update report
    const reportResult = await client.query(
      `INSERT INTO ai_trader_daily_reports (
        ai_trader_id, report_date,
        start_value, end_value, pnl, pnl_percent, fees_paid,
        checks_performed, decisions_analyzed, trades_executed,
        positions_opened, positions_closed,
        winning_trades, losing_trades, win_rate,
        avg_win, avg_loss, best_trade, worst_trade,
        signal_accuracy, open_positions, insights
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
      ON CONFLICT (ai_trader_id, report_date)
      DO UPDATE SET
        start_value = EXCLUDED.start_value,
        end_value = EXCLUDED.end_value,
        pnl = EXCLUDED.pnl,
        pnl_percent = EXCLUDED.pnl_percent,
        fees_paid = EXCLUDED.fees_paid,
        checks_performed = EXCLUDED.checks_performed,
        decisions_analyzed = EXCLUDED.decisions_analyzed,
        trades_executed = EXCLUDED.trades_executed,
        positions_opened = EXCLUDED.positions_opened,
        positions_closed = EXCLUDED.positions_closed,
        winning_trades = EXCLUDED.winning_trades,
        losing_trades = EXCLUDED.losing_trades,
        win_rate = EXCLUDED.win_rate,
        avg_win = EXCLUDED.avg_win,
        avg_loss = EXCLUDED.avg_loss,
        best_trade = EXCLUDED.best_trade,
        worst_trade = EXCLUDED.worst_trade,
        signal_accuracy = EXCLUDED.signal_accuracy,
        open_positions = EXCLUDED.open_positions,
        insights = EXCLUDED.insights
      RETURNING *`,
      [
        traderId, reportDateStr,
        startValue, endValue, pnl, pnlPercent, feesPaid,
        0, // checks_performed - would need separate tracking
        decisionsAnalyzed, tradesExecuted,
        positionsOpened, positionsClosed,
        winningTrades, losingTrades, winRate,
        avgWin, avgLoss, 
        bestTrade ? JSON.stringify(bestTrade) : null,
        worstTrade ? JSON.stringify(worstTrade) : null,
        JSON.stringify(signalAccuracy),
        JSON.stringify(openPositions),
        insights,
      ]
    );

    await client.query('COMMIT');
    console.log(`Generated daily report for trader ${traderId} on ${reportDateStr}`);
    return reportResult.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error generating daily report:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get portfolio value at a specific time
 * @param {number} traderId - AI Trader ID
 * @param {Date} timestamp - Time to check
 * @param {object} client - Database client (optional)
 * @returns {Promise<number>} Portfolio value
 */
async function getPortfolioValueAtTime(traderId, timestamp, client = null) {
  const queryFn = client ? client.query.bind(client) : query;
  
  try {
    // Get the portfolio_id for this trader
    const traderResult = await queryFn(
      'SELECT portfolio_id FROM ai_traders WHERE id = $1',
      [traderId]
    );
    
    if (!traderResult.rows[0] || !traderResult.rows[0].portfolio_id) {
      return null;
    }
    
    const portfolioId = traderResult.rows[0].portfolio_id;
    
    // Get portfolio value (cash + positions value)
    const portfolioResult = await queryFn(
      `SELECT cash_balance, total_value 
       FROM portfolios 
       WHERE id = $1`,
      [portfolioId]
    );
    
    if (!portfolioResult.rows[0]) {
      return null;
    }
    
    return parseFloat(portfolioResult.rows[0].total_value || portfolioResult.rows[0].cash_balance || 0);
  } catch (error) {
    console.error('Error getting portfolio value:', error);
    return null;
  }
}

// ============================================================================
// Report Retrieval
// ============================================================================

/**
 * Get all reports for an AI trader
 * @param {number} traderId - AI Trader ID
 * @param {number} limit - Max number of reports
 * @param {number} offset - Pagination offset
 * @returns {Promise<Array>} List of reports
 */
export async function getReports(traderId, limit = 30, offset = 0) {
  const result = await query(
    `SELECT * FROM ai_trader_daily_reports
     WHERE ai_trader_id = $1
     ORDER BY report_date DESC
     LIMIT $2 OFFSET $3`,
    [traderId, limit, offset]
  );
  return result.rows;
}

/**
 * Get report for a specific date
 * @param {number} traderId - AI Trader ID
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<object|null>} Report or null
 */
export async function getReportByDate(traderId, date) {
  const result = await query(
    `SELECT * FROM ai_trader_daily_reports
     WHERE ai_trader_id = $1 AND report_date = $2`,
    [traderId, date]
  );
  return result.rows[0] || null;
}

/**
 * Get running AI traders (for scheduled report generation)
 * @returns {Promise<Array>} List of running AI traders
 */
export async function getRunningAITraders() {
  const result = await query(
    `SELECT id, name FROM ai_traders WHERE status = 'running'`
  );
  return result.rows;
}
