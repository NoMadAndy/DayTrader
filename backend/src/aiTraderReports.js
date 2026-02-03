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

    // Get portfolio ID for this trader
    const traderResult = await client.query(
      'SELECT portfolio_id FROM ai_traders WHERE id = $1',
      [traderId]
    );
    const portfolioId = traderResult.rows[0]?.portfolio_id;
    
    if (!portfolioId) {
      throw new Error(`No portfolio found for trader ${traderId}`);
    }

    // Get initial capital from portfolio
    const portfolioResult = await client.query(
      'SELECT initial_capital, cash_balance FROM portfolios WHERE id = $1',
      [portfolioId]
    );
    const initialCapital = parseFloat(portfolioResult.rows[0]?.initial_capital || 100000);
    const currentCash = parseFloat(portfolioResult.rows[0]?.cash_balance || 0);

    // Count positions opened on this day
    const positionsOpenedResult = await client.query(
      `SELECT COUNT(*) as count, 
              COALESCE(SUM(quantity * entry_price), 0) as total_invested
       FROM positions
       WHERE portfolio_id = $1 
       AND opened_at::date = $2::date`,
      [portfolioId, reportDateStr]
    );
    const positionsOpened = parseInt(positionsOpenedResult.rows[0]?.count || 0);
    const totalInvestedToday = parseFloat(positionsOpenedResult.rows[0]?.total_invested || 0);

    // Count positions closed on this day
    const positionsClosedResult = await client.query(
      `SELECT COUNT(*) as count,
              COALESCE(SUM(realized_pnl), 0) as realized_pnl,
              COUNT(*) FILTER (WHERE realized_pnl > 0) as winning,
              COUNT(*) FILTER (WHERE realized_pnl < 0) as losing,
              COALESCE(AVG(realized_pnl) FILTER (WHERE realized_pnl > 0), 0) as avg_win,
              COALESCE(AVG(realized_pnl) FILTER (WHERE realized_pnl < 0), 0) as avg_loss
       FROM positions
       WHERE portfolio_id = $1 
       AND closed_at::date = $2::date
       AND is_open = false`,
      [portfolioId, reportDateStr]
    );
    const positionsClosed = parseInt(positionsClosedResult.rows[0]?.count || 0);
    const realizedPnl = parseFloat(positionsClosedResult.rows[0]?.realized_pnl || 0);
    const winningTrades = parseInt(positionsClosedResult.rows[0]?.winning || 0);
    const losingTrades = parseInt(positionsClosedResult.rows[0]?.losing || 0);
    const avgWin = positionsClosedResult.rows[0]?.avg_win ? parseFloat(positionsClosedResult.rows[0].avg_win) : null;
    const avgLoss = positionsClosedResult.rows[0]?.avg_loss ? parseFloat(positionsClosedResult.rows[0].avg_loss) : null;
    
    const winRate = positionsClosed > 0 
      ? (winningTrades / positionsClosed) * 100 
      : null;

    // Get best and worst trades closed today
    const bestWorstResult = await client.query(
      `SELECT symbol, realized_pnl, 
              (realized_pnl / (quantity * entry_price) * 100) as pnl_percent,
              EXTRACT(DAY FROM closed_at - opened_at) as holding_days
       FROM positions
       WHERE portfolio_id = $1 
       AND closed_at::date = $2::date
       AND is_open = false
       ORDER BY realized_pnl DESC`,
      [portfolioId, reportDateStr]
    );
    
    let bestTrade = null;
    let worstTrade = null;
    
    if (bestWorstResult.rows.length > 0) {
      const best = bestWorstResult.rows[0];
      if (best.realized_pnl > 0) {
        bestTrade = {
          symbol: best.symbol,
          pnl: parseFloat(best.realized_pnl),
          pnl_percent: parseFloat(best.pnl_percent),
          holding_days: parseInt(best.holding_days || 0),
        };
      }
      
      const worst = bestWorstResult.rows[bestWorstResult.rows.length - 1];
      if (worst.realized_pnl < 0) {
        worstTrade = {
          symbol: worst.symbol,
          pnl: parseFloat(worst.realized_pnl),
          pnl_percent: parseFloat(worst.pnl_percent),
          holding_days: parseInt(worst.holding_days || 0),
        };
      }
    }

    // Calculate current portfolio value (cash + open positions)
    const openPositionsResult = await client.query(
      `SELECT symbol, quantity, entry_price, current_price, side,
              CASE 
                WHEN side = 'short' THEN quantity * (entry_price - current_price)
                ELSE quantity * (current_price - entry_price)
              END as unrealized_pnl,
              CASE 
                WHEN side = 'short' THEN ((entry_price - current_price) / entry_price * 100)
                ELSE ((current_price - entry_price) / entry_price * 100)
              END as unrealized_pnl_percent
       FROM positions
       WHERE portfolio_id = $1
       AND is_open = true`,
      [portfolioId]
    );
    const openPositions = openPositionsResult.rows;
    
    const openPositionsValue = openPositions.reduce((sum, p) => 
      sum + (parseFloat(p.quantity) * parseFloat(p.current_price)), 0
    );
    const unrealizedPnl = openPositions.reduce((sum, p) => 
      sum + parseFloat(p.unrealized_pnl || 0), 0
    );

    // Calculate portfolio values
    const currentValue = currentCash + openPositionsValue;
    
    // For start value, we need to estimate what it was at the start of the day
    // Check if this was the first day with any positions opened for this trader
    const firstPositionResult = await client.query(
      `SELECT MIN(opened_at::date) as first_date 
       FROM positions 
       WHERE portfolio_id = $1`,
      [portfolioId]
    );
    const firstTradingDate = firstPositionResult.rows[0]?.first_date;
    const isFirstTradingDay = firstTradingDate && 
      new Date(firstTradingDate).toISOString().split('T')[0] === reportDateStr;
    
    let startValue, endValue;
    
    if (isFirstTradingDay) {
      // First trading day: started with initial capital, ended with current value minus unrealized changes
      startValue = initialCapital;
      endValue = initialCapital; // On first day, no realized P&L yet, just positions opened
    } else {
      // Subsequent days: estimate based on current state
      // End value is current portfolio value
      endValue = currentValue;
      // Start value is end value minus today's realized P&L
      startValue = endValue - realizedPnl;
    }
    
    const pnl = realizedPnl; // Only count realized P&L for the day
    const pnlPercent = startValue > 0 ? (pnl / startValue) * 100 : 0;
    
    // Fees paid today (from closed positions)
    const feesResult = await client.query(
      `SELECT COALESCE(SUM(total_fees_paid), 0) as fees
       FROM positions
       WHERE portfolio_id = $1 
       AND (opened_at::date = $2::date OR closed_at::date = $2::date)`,
      [portfolioId, reportDateStr]
    );
    const feesPaid = parseFloat(feesResult.rows[0]?.fees || 0);

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

    // Total trades = positions opened + positions closed
    const tradesExecuted = positionsOpened + positionsClosed;

    // Calculate signal accuracy for the day
    const signalAccuracy = await calculateSignalAccuracy(traderId, 1); // 1 day

    // Generate insights
    const insights = await generateInsights(traderId, {
      date: reportDate,
      trades: [],
      signalAccuracy,
      pnl,
      pnlPercent,
      winRate,
      bestTrade,
      worstTrade,
      positionsOpened,
      positionsClosed,
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
    
    // Get portfolio cash balance
    const portfolioResult = await queryFn(
      `SELECT cash_balance, initial_capital
       FROM portfolios 
       WHERE id = $1`,
      [portfolioId]
    );
    
    if (!portfolioResult.rows[0]) {
      return null;
    }
    
    const cashBalance = parseFloat(portfolioResult.rows[0].cash_balance || 0);
    
    // Get total value of open positions
    const positionsResult = await queryFn(
      `SELECT COALESCE(SUM(quantity * current_price), 0) as positions_value
       FROM positions
       WHERE portfolio_id = $1 AND is_open = true`,
      [portfolioId]
    );
    
    const positionsValue = parseFloat(positionsResult.rows[0]?.positions_value || 0);
    
    return cashBalance + positionsValue;
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
