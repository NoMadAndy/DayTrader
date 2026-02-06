/**
 * AI Trader Module
 * 
 * Manages AI trading agents with their own portfolios, decision history,
 * and performance tracking. AI traders appear in the leaderboard alongside
 * human traders.
 */

import { query, getClient } from './db.js';

// ============================================================================
// Trading Time Helper Functions
// ============================================================================

/**
 * Check if current time is within trading hours for a given personality/schedule.
 * Mirrors the logic from rl-trading-service/app/ai_trader_scheduler.py
 * 
 * @param {object} personality - Trader personality configuration
 * @returns {boolean} True if within trading hours
 */
export function isWithinTradingTime(personality) {
  const scheduleConfig = personality?.schedule || DEFAULT_PERSONALITY.schedule;
  
  // If scheduling is disabled, always return true
  if (!scheduleConfig.enabled || !scheduleConfig.tradingHoursOnly) {
    return true;
  }
  
  try {
    // Get current time in the configured timezone
    const timezone = scheduleConfig.timezone || 'Europe/Berlin';
    const now = new Date();
    
    // Convert to target timezone using Intl API
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    // weekday format from 'en-US' locale returns 'Mon', 'Tue', etc. (3 letters)
    const weekdayRaw = parts.find(p => p.type === 'weekday')?.value || '';
    const weekday = weekdayRaw.toLowerCase().substring(0, 3);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    
    // Check day of week
    const tradingDays = scheduleConfig.tradingDays || ['mon', 'tue', 'wed', 'thu', 'fri'];
    if (!tradingDays.includes(weekday)) {
      return false;
    }
    
    // Parse trading hours with validation
    const startTime = scheduleConfig.tradingStart || '09:00';
    const endTime = scheduleConfig.tradingEnd || '17:30';
    
    if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(endTime)) {
      console.error('Invalid time format in schedule config:', { startTime, endTime });
      return false;
    }
    
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    // Validate parsed time values
    if (isNaN(startHour) || isNaN(startMinute) || isNaN(endHour) || isNaN(endMinute) ||
        startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23 ||
        startMinute < 0 || startMinute > 59 || endMinute < 0 || endMinute > 59) {
      console.error('Invalid time values in schedule config');
      return false;
    }
    
    // Add buffers (avoid market open/close) from personality
    const avoidOpen = scheduleConfig.avoidMarketOpenMinutes || 15;
    const avoidClose = scheduleConfig.avoidMarketCloseMinutes || 15;
    
    // Calculate start time with buffer
    let effectiveStartMinute = startMinute + avoidOpen;
    let effectiveStartHour = startHour;
    if (effectiveStartMinute >= 60) {
      effectiveStartHour += Math.floor(effectiveStartMinute / 60);
      effectiveStartMinute = effectiveStartMinute % 60;
    }
    
    // Calculate end time with buffer
    let effectiveEndMinute = endMinute - avoidClose;
    let effectiveEndHour = endHour;
    if (effectiveEndMinute < 0) {
      effectiveEndHour -= 1;
      effectiveEndMinute += 60;
    }
    
    // Convert current time to minutes since midnight
    const currentMinutes = hour * 60 + minute;
    const startMinutes = effectiveStartHour * 60 + effectiveStartMinute;
    const endMinutes = effectiveEndHour * 60 + effectiveEndMinute;
    
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } catch (e) {
    console.error('Error checking trading time:', e);
    // On error, default to false for safety
    return false;
  }
}

/**
 * Enhance trader object with trading_time field and status_message.
 * 
 * @param {object} trader - Trader object from database
 * @returns {object} Enhanced trader object
 */
function enhanceTraderWithTradingTime(trader) {
  if (!trader) return trader;
  
  // Add trading_time field based on current schedule
  trader.trading_time = isWithinTradingTime(trader.personality);
  
  // Update status_message if running but not in trading time
  if (trader.status === 'running' && !trader.trading_time && !trader.status_message) {
    trader.status_message = 'Wartet auf Handelszeit';
  }
  
  return trader;
}

/**
 * Format trader object for API response (snake_case to camelCase).
 * 
 * @param {object} trader - Trader object from database
 * @returns {object} Formatted trader object for API response
 */
export function formatTraderForApi(trader) {
  if (!trader) return null;
  
  return {
    id: trader.id,
    portfolioId: trader.portfolio_id,
    name: trader.name,
    avatar: trader.avatar || '🤖',
    description: trader.description,
    personality: trader.personality,
    status: trader.status,
    statusMessage: trader.status_message,
    tradingTime: trader.trading_time,
    createdAt: trader.created_at,
    updatedAt: trader.updated_at,
    startedAt: trader.started_at,
    stoppedAt: trader.stopped_at,
    lastDecisionAt: trader.last_decision_at,
    lastTradeAt: trader.last_trade_at,
    totalDecisions: trader.total_decisions || 0,
    tradesExecuted: trader.trades_executed || 0,
    winningTrades: trader.winning_trades || 0,
    losingTrades: trader.losing_trades || 0,
    totalPnl: parseFloat(trader.total_pnl || 0),
    bestTradePnl: trader.best_trade_pnl ? parseFloat(trader.best_trade_pnl) : null,
    worstTradePnl: trader.worst_trade_pnl ? parseFloat(trader.worst_trade_pnl) : null,
    currentStreak: trader.current_streak || 0,
    maxDrawdown: parseFloat(trader.max_drawdown || 0),
  };
}

// ============================================================================
// Default Personality Configuration
// ============================================================================

export const DEFAULT_PERSONALITY = {
  capital: {
    initialBudget: 100000,
    maxPositionSize: 25,
    reserveCashPercent: 10,
  },
  risk: {
    tolerance: 'moderate',
    maxDrawdown: 20,
    stopLossPercent: 5,
    takeProfitPercent: 10,
  },
  signals: {
    weights: {
      ml: 0.25,
      rl: 0.25,
      sentiment: 0.25,
      technical: 0.25,
    },
    minAgreement: 0.6,
  },
  trading: {
    minConfidence: 0.6,
    maxOpenPositions: 5,
    diversification: true,
  },
  schedule: {
    enabled: true,
    checkIntervalMinutes: 15,
    tradingHoursOnly: true,
    timezone: 'Europe/Berlin',
    tradingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    tradingStart: '09:00',
    tradingEnd: '17:30',
    avoidMarketOpenMinutes: 15,
    avoidMarketCloseMinutes: 15,
  },
  watchlist: {
    symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'],
    autoUpdate: false,
    useFullWatchlist: false,  // If true, use user's entire watchlist
  },
  sentiment: {
    enabled: true,
    minScore: 0.5,
  },
  learning: {
    enabled: false,
    updateWeights: false,
  },
};

// ============================================================================
// Database Schema Initialization
// ============================================================================

/**
 * Initialize AI Trader database schema
 */
export async function initializeAITraderSchema() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Extend users table
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_system_user') THEN
          ALTER TABLE users ADD COLUMN is_system_user BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'user_type') THEN
          ALTER TABLE users ADD COLUMN user_type VARCHAR(20) DEFAULT 'human';
        END IF;
      END $$;
    `);

    // Create ai_traders table first (without portfolio_id reference initially)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_traders (
        id SERIAL PRIMARY KEY,
        portfolio_id INTEGER,
        
        name VARCHAR(100) NOT NULL UNIQUE,
        avatar VARCHAR(50) DEFAULT '🤖',
        description TEXT,
        
        personality JSONB NOT NULL DEFAULT '{}',
        
        status VARCHAR(20) DEFAULT 'stopped',
        status_message TEXT,
        
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        started_at TIMESTAMP WITH TIME ZONE,
        stopped_at TIMESTAMP WITH TIME ZONE,
        last_decision_at TIMESTAMP WITH TIME ZONE,
        last_trade_at TIMESTAMP WITH TIME ZONE,
        
        total_decisions INTEGER DEFAULT 0,
        trades_executed INTEGER DEFAULT 0,
        winning_trades INTEGER DEFAULT 0,
        losing_trades INTEGER DEFAULT 0,
        total_pnl DECIMAL(15,2) DEFAULT 0,
        best_trade_pnl DECIMAL(15,2),
        worst_trade_pnl DECIMAL(15,2),
        current_streak INTEGER DEFAULT 0,
        max_drawdown DECIMAL(5,2) DEFAULT 0
      );
    `);

    // Extend portfolios table to reference ai_traders
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'portfolios' AND column_name = 'ai_trader_id') THEN
          ALTER TABLE portfolios ADD COLUMN ai_trader_id INTEGER REFERENCES ai_traders(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add foreign key constraint to ai_traders.portfolio_id if not exists
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'ai_traders_portfolio_id_fkey' 
          AND table_name = 'ai_traders'
        ) THEN
          ALTER TABLE ai_traders 
          ADD CONSTRAINT ai_traders_portfolio_id_fkey 
          FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add signal_accuracy column for cumulative accuracy tracking (Phase 4)
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_traders' AND column_name = 'signal_accuracy') THEN
          ALTER TABLE ai_traders ADD COLUMN signal_accuracy JSONB DEFAULT '{"ml": null, "rl": null, "sentiment": null, "technical": null}';
        END IF;
      END $$;
    `);

    // Create ai_trader_decisions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_trader_decisions (
        id SERIAL PRIMARY KEY,
        ai_trader_id INTEGER REFERENCES ai_traders(id) ON DELETE CASCADE,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        symbol VARCHAR(20) NOT NULL,
        symbols_analyzed TEXT[],
        
        decision_type VARCHAR(20) NOT NULL,
        
        reasoning JSONB NOT NULL,
        
        executed BOOLEAN DEFAULT false,
        position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        execution_error TEXT,
        
        confidence DECIMAL(5,4),
        weighted_score DECIMAL(5,4),
        ml_score DECIMAL(5,4),
        rl_score DECIMAL(5,4),
        sentiment_score DECIMAL(5,4),
        technical_score DECIMAL(5,4),
        signal_agreement VARCHAR(20),
        
        summary_short TEXT,
        
        market_context JSONB,
        portfolio_snapshot JSONB,
        
        outcome_pnl DECIMAL(15,4),
        outcome_pnl_percent DECIMAL(8,4),
        outcome_holding_days INTEGER,
        outcome_was_correct BOOLEAN
      );
    `);

    // Create ai_trader_notification_prefs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_trader_notification_prefs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ai_trader_id INTEGER REFERENCES ai_traders(id) ON DELETE CASCADE,
        
        notify_trades BOOLEAN DEFAULT true,
        notify_position_opened BOOLEAN DEFAULT true,
        notify_position_closed BOOLEAN DEFAULT true,
        notify_stop_loss_triggered BOOLEAN DEFAULT true,
        notify_reasoning BOOLEAN DEFAULT false,
        notify_daily_summary BOOLEAN DEFAULT true,
        notify_weekly_summary BOOLEAN DEFAULT false,
        notify_significant_pnl BOOLEAN DEFAULT true,
        significant_pnl_threshold DECIMAL(5,2) DEFAULT 5.0,
        
        channel_browser BOOLEAN DEFAULT true,
        channel_browser_sound BOOLEAN DEFAULT true,
        channel_email BOOLEAN DEFAULT false,
        email_address VARCHAR(255),
        
        batch_notifications BOOLEAN DEFAULT true,
        batch_interval_minutes INTEGER DEFAULT 5,
        
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        UNIQUE(user_id, ai_trader_id)
      );
    `);

    // Create ai_trader_daily_reports table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_trader_daily_reports (
        id SERIAL PRIMARY KEY,
        ai_trader_id INTEGER REFERENCES ai_traders(id) ON DELETE CASCADE,
        report_date DATE NOT NULL,
        
        start_value DECIMAL(15,2),
        end_value DECIMAL(15,2),
        pnl DECIMAL(15,2),
        pnl_percent DECIMAL(8,4),
        fees_paid DECIMAL(10,4),
        
        checks_performed INTEGER DEFAULT 0,
        decisions_analyzed INTEGER DEFAULT 0,
        trades_executed INTEGER DEFAULT 0,
        positions_opened INTEGER DEFAULT 0,
        positions_closed INTEGER DEFAULT 0,
        
        winning_trades INTEGER DEFAULT 0,
        losing_trades INTEGER DEFAULT 0,
        win_rate DECIMAL(5,2),
        avg_win DECIMAL(15,2),
        avg_loss DECIMAL(15,2),
        best_trade JSONB,
        worst_trade JSONB,
        
        signal_accuracy JSONB,
        open_positions JSONB,
        insights TEXT[],
        
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        UNIQUE(ai_trader_id, report_date)
      );
    `);

    // Create ai_trader_weight_history table for tracking adaptive learning
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_trader_weight_history (
        id SERIAL PRIMARY KEY,
        ai_trader_id INTEGER REFERENCES ai_traders(id) ON DELETE CASCADE,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        old_weights JSONB NOT NULL,
        new_weights JSONB NOT NULL,
        
        reason TEXT,
        accuracy_snapshot JSONB
      );
    `);

    // Create ai_trader_insights table for persistent insights
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_trader_insights (
        id SERIAL PRIMARY KEY,
        ai_trader_id INTEGER REFERENCES ai_traders(id) ON DELETE CASCADE,
        insight_type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        data JSONB,
        severity VARCHAR(20) DEFAULT 'info',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE
      );
    `);

    // Create ai_trader_training_history table for persistent training records
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_trader_training_history (
        id SERIAL PRIMARY KEY,
        ai_trader_id INTEGER REFERENCES ai_traders(id) ON DELETE CASCADE,
        agent_name VARCHAR(100),
        training_type VARCHAR(50) DEFAULT 'self_training',
        status VARCHAR(20) NOT NULL DEFAULT 'started',
        
        started_at TIMESTAMP WITH TIME ZONE NOT NULL,
        completed_at TIMESTAMP WITH TIME ZONE,
        duration_seconds INTEGER,
        
        symbols_trained TEXT[],
        total_timesteps INTEGER,
        
        final_reward DECIMAL(12,4),
        mean_reward DECIMAL(12,4),
        best_reward DECIMAL(12,4),
        
        mean_return_pct DECIMAL(8,4),
        max_return_pct DECIMAL(8,4),
        min_return_pct DECIMAL(8,4),
        
        episodes_completed INTEGER,
        error_message TEXT,
        metadata JSONB,
        
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_traders_status ON ai_traders(status);
      CREATE INDEX IF NOT EXISTS idx_ai_traders_name ON ai_traders(name);
      CREATE INDEX IF NOT EXISTS idx_decisions_trader ON ai_trader_decisions(ai_trader_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON ai_trader_decisions(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_decisions_symbol ON ai_trader_decisions(symbol);
      CREATE INDEX IF NOT EXISTS idx_decisions_executed ON ai_trader_decisions(executed);
      CREATE INDEX IF NOT EXISTS idx_weight_history_trader ON ai_trader_weight_history(ai_trader_id);
      CREATE INDEX IF NOT EXISTS idx_weight_history_timestamp ON ai_trader_weight_history(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_insights_trader ON ai_trader_insights(ai_trader_id);
      CREATE INDEX IF NOT EXISTS idx_insights_type ON ai_trader_insights(insight_type);
      CREATE INDEX IF NOT EXISTS idx_insights_active ON ai_trader_insights(is_active);
      CREATE INDEX IF NOT EXISTS idx_insights_expires_at ON ai_trader_insights(expires_at);
      CREATE INDEX IF NOT EXISTS idx_training_history_trader ON ai_trader_training_history(ai_trader_id);
      CREATE INDEX IF NOT EXISTS idx_training_history_started ON ai_trader_training_history(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_training_history_status ON ai_trader_training_history(status);
    `);

    await client.query('COMMIT');
    console.log('AI Trader schema initialized successfully');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('AI Trader schema initialization error:', e);
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new AI Trader
 * @param {string} name - Unique name for the AI trader
 * @param {string} description - Description of the AI trader
 * @param {object} personality - Personality configuration (defaults to DEFAULT_PERSONALITY)
 * @returns {Promise<object>} Created AI trader
 */
export async function createAITrader(name, description, personality = DEFAULT_PERSONALITY) {
  const result = await query(
    `INSERT INTO ai_traders (name, description, personality, status)
     VALUES ($1, $2, $3, 'stopped')
     RETURNING *`,
    [name, description, JSON.stringify(personality)]
  );
  return result.rows[0];
}

/**
 * Get AI Trader by ID
 * @param {number} id - AI Trader ID
 * @returns {Promise<object|null>} AI trader or null with trading_time field
 */
export async function getAITrader(id) {
  const result = await query(
    'SELECT * FROM ai_traders WHERE id = $1',
    [id]
  );
  const trader = result.rows[0] || null;
  return enhanceTraderWithTradingTime(trader);
}

/**
 * Get all AI Traders
 * @returns {Promise<Array>} List of all AI traders with trading_time field
 */
export async function getAllAITraders() {
  const result = await query(
    'SELECT * FROM ai_traders ORDER BY created_at DESC'
  );
  
  // Enhance each trader with trading_time field
  return result.rows.map(trader => enhanceTraderWithTradingTime(trader));
}

/**
 * Update AI Trader
 * @param {number} id - AI Trader ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated AI trader
 */
export async function updateAITrader(id, updates) {
  const allowedFields = ['name', 'avatar', 'description', 'personality', 'status', 'status_message'];
  const setFields = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setFields.push(`${key} = $${paramIndex}`);
      values.push(key === 'personality' ? JSON.stringify(value) : value);
      paramIndex++;
    }
  }

  if (setFields.length === 0) {
    throw new Error('No valid fields to update');
  }

  setFields.push(`updated_at = NOW()`);
  values.push(id);

  const result = await query(
    `UPDATE ai_traders SET ${setFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Delete AI Trader
 * @param {number} id - AI Trader ID
 * @returns {Promise<boolean>} Success status
 */
export async function deleteAITrader(id) {
  const result = await query(
    'DELETE FROM ai_traders WHERE id = $1',
    [id]
  );
  return result.rowCount > 0;
}

// ============================================================================
// Status Control
// ============================================================================

/**
 * Start AI Trader
 * @param {number} id - AI Trader ID
 * @returns {Promise<object>} Updated AI trader
 */
export async function startAITrader(id) {
  const result = await query(
    `UPDATE ai_traders 
     SET status = 'running', started_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0];
}

/**
 * Stop AI Trader
 * @param {number} id - AI Trader ID
 * @returns {Promise<object>} Updated AI trader
 */
export async function stopAITrader(id) {
  const result = await query(
    `UPDATE ai_traders 
     SET status = 'stopped', stopped_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0];
}

/**
 * Pause AI Trader
 * @param {number} id - AI Trader ID
 * @returns {Promise<object>} Updated AI trader
 */
export async function pauseAITrader(id) {
  const result = await query(
    `UPDATE ai_traders 
     SET status = 'paused', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0];
}

// ============================================================================
// Decision Logging
// ============================================================================

/**
 * Log an AI trader decision
 * @param {number} aiTraderId - AI Trader ID
 * @param {object} decisionData - Decision details
 * @returns {Promise<object>} Created decision record
 */
export async function logDecision(aiTraderId, decisionData) {
  const {
    symbol,
    symbolsAnalyzed = [],
    decisionType,
    reasoning = {},
    executed = false,
    positionId = null,
    orderId = null,
    executionError = null,
    confidence = null,
    weightedScore = null,
    mlScore = null,
    rlScore = null,
    sentimentScore = null,
    technicalScore = null,
    signalAgreement = null,
    summaryShort = null,
    marketContext = {},
    portfolioSnapshot = {},
  } = decisionData;

  const result = await query(
    `INSERT INTO ai_trader_decisions (
      ai_trader_id, symbol, symbols_analyzed, decision_type, reasoning,
      executed, position_id, order_id, execution_error,
      confidence, weighted_score, ml_score, rl_score, sentiment_score,
      technical_score, signal_agreement, summary_short,
      market_context, portfolio_snapshot
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING *`,
    [
      aiTraderId, symbol, symbolsAnalyzed, decisionType, JSON.stringify(reasoning),
      executed, positionId, orderId, executionError,
      confidence, weightedScore, mlScore, rlScore, sentimentScore,
      technicalScore, signalAgreement, summaryShort,
      JSON.stringify(marketContext), JSON.stringify(portfolioSnapshot)
    ]
  );

  // Update trader's last_decision_at
  await query(
    `UPDATE ai_traders 
     SET last_decision_at = NOW(), total_decisions = total_decisions + 1
     WHERE id = $1`,
    [aiTraderId]
  );

  return result.rows[0];
}

/**
 * Get decisions for an AI trader
 * @param {number} aiTraderId - AI Trader ID
 * @param {number} limit - Max number of decisions to return
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Array>} List of decisions
 */
export async function getDecisions(aiTraderId, limit = 50, offset = 0) {
  const result = await query(
    `SELECT * FROM ai_trader_decisions 
     WHERE ai_trader_id = $1
     ORDER BY timestamp DESC
     LIMIT $2 OFFSET $3`,
    [aiTraderId, limit, offset]
  );
  return result.rows;
}

/**
 * Get a specific decision
 * @param {number} decisionId - Decision ID
 * @returns {Promise<object|null>} Decision or null
 */
export async function getDecision(decisionId) {
  const result = await query(
    'SELECT * FROM ai_trader_decisions WHERE id = $1',
    [decisionId]
  );
  return result.rows[0] || null;
}

// ============================================================================
// Outcome Tracking
// ============================================================================

/**
 * Update decision outcome when position is closed
 * @param {number} decisionId - Decision ID
 * @param {object} outcome - Outcome data
 * @returns {Promise<object>} Updated decision
 */
export async function updateDecisionOutcome(decisionId, outcome) {
  const {
    outcomePnl,
    outcomePnlPercent,
    outcomeHoldingDays,
    outcomeWasCorrect,
  } = outcome;

  const result = await query(
    `UPDATE ai_trader_decisions
     SET outcome_pnl = $1,
         outcome_pnl_percent = $2,
         outcome_holding_days = $3,
         outcome_was_correct = $4
     WHERE id = $5
     RETURNING *`,
    [outcomePnl, outcomePnlPercent, outcomeHoldingDays, outcomeWasCorrect, decisionId]
  );

  return result.rows[0];
}

/**
 * Update pending outcomes for closed positions
 * Finds decisions with closed positions that don't have outcomes yet
 * @returns {Promise<number>} Number of outcomes updated
 */
export async function updatePendingOutcomes() {
  try {
    // Find decisions with closed positions but no outcome
    const result = await query(
      `SELECT d.id, d.decision_type, d.ai_trader_id, d.timestamp,
              d.ml_score, d.rl_score, d.sentiment_score, d.technical_score,
              p.symbol, p.entry_price, p.exit_price, p.realized_pnl, 
              p.realized_pnl_percent, p.closed_at
       FROM ai_trader_decisions d
       JOIN positions p ON d.position_id = p.id
       WHERE d.executed = true
       AND d.outcome_pnl IS NULL
       AND p.status = 'closed'
       AND p.closed_at IS NOT NULL`
    );

    const decisions = result.rows;
    let updated = 0;

    for (const decision of decisions) {
      // Calculate holding days
      const entryDate = new Date(decision.timestamp);
      const exitDate = new Date(decision.closed_at);
      const holdingDays = Math.round((exitDate - entryDate) / (1000 * 60 * 60 * 24));

      // Determine if decision was correct
      // A buy decision is correct if P&L is positive
      // A sell/close decision is correct if it avoided further loss or captured gain
      const wasCorrect = determineDecisionCorrectness(
        decision.decision_type,
        parseFloat(decision.realized_pnl || 0),
        decision
      );

      // Update outcome
      await updateDecisionOutcome(decision.id, {
        outcomePnl: decision.realized_pnl,
        outcomePnlPercent: decision.realized_pnl_percent,
        outcomeHoldingDays: holdingDays,
        outcomeWasCorrect: wasCorrect,
      });

      updated++;
    }

    if (updated > 0) {
      console.log(`Updated ${updated} decision outcomes`);
    }

    return updated;
  } catch (error) {
    console.error('Error updating pending outcomes:', error);
    throw error;
  }
}

/**
 * Determine if a decision was correct based on the outcome
 * @param {string} decisionType - Type of decision (buy, sell, close, hold)
 * @param {number} pnl - Realized P&L
 * @param {object} decision - Full decision object
 * @returns {boolean} Whether the decision was correct
 */
function determineDecisionCorrectness(decisionType, pnl, decision) {
  // Simple heuristic: 
  // - Buy decisions are correct if they resulted in profit
  // - Sell/close decisions are correct if P&L is positive or limited loss
  // - This can be enhanced with more sophisticated logic
  
  if (decisionType === 'buy') {
    return pnl > 0;
  } else if (decisionType === 'sell' || decisionType === 'close') {
    // For close decisions, positive P&L means it was a good decision
    // Small losses might also be correct if they prevented bigger losses
    return pnl > 0 || (pnl > -100); // Allow small losses as "correct" risk management
  } else if (decisionType === 'hold') {
    // Hold decisions are harder to evaluate
    return true; // Neutral for now
  }
  
  return false;
}

// ============================================================================
// Portfolio Integration
// ============================================================================

/**
 * Create a portfolio for an AI trader
 * @param {number} aiTraderId - AI Trader ID
 * @param {number} initialCapital - Starting capital
 * @returns {Promise<object>} Created portfolio
 */
export async function createAITraderPortfolio(aiTraderId, initialCapital = 100000, brokerProfile = 'flatex') {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Create portfolio (without user_id since it's an AI trader)
    const portfolioResult = await client.query(
      `INSERT INTO portfolios (name, initial_capital, cash_balance, ai_trader_id, broker_profile)
       VALUES ($1, $2, $2, $3, $4)
       RETURNING *`,
      [`AI Trader Portfolio`, initialCapital, aiTraderId, brokerProfile]
    );
    const portfolio = portfolioResult.rows[0];

    // Update AI trader with portfolio_id
    await client.query(
      'UPDATE ai_traders SET portfolio_id = $1 WHERE id = $2',
      [portfolio.id, aiTraderId]
    );

    await client.query('COMMIT');
    return portfolio;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Get portfolio for an AI trader
 * @param {number} aiTraderId - AI Trader ID
 * @returns {Promise<object|null>} Portfolio or null
 */
export async function getAITraderPortfolio(aiTraderId) {
  const result = await query(
    'SELECT * FROM portfolios WHERE ai_trader_id = $1',
    [aiTraderId]
  );
  return result.rows[0] || null;
}

// ============================================================================
// Daily Reports
// ============================================================================

/**
 * Get daily reports for an AI trader
 * @param {number} aiTraderId - AI Trader ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} List of daily reports
 */
export async function getDailyReports(aiTraderId, startDate = null, endDate = null) {
  let sql = 'SELECT * FROM ai_trader_daily_reports WHERE ai_trader_id = $1';
  const params = [aiTraderId];

  if (startDate) {
    params.push(startDate);
    sql += ` AND report_date >= $${params.length}`;
  }

  if (endDate) {
    params.push(endDate);
    sql += ` AND report_date <= $${params.length}`;
  }

  sql += ' ORDER BY report_date DESC';

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Create a daily report for an AI trader
 * @param {number} aiTraderId - AI Trader ID
 * @param {object} reportData - Report data
 * @returns {Promise<object>} Created report
 */
export async function createDailyReport(aiTraderId, reportData) {
  const {
    reportDate,
    startValue,
    endValue,
    pnl,
    pnlPercent,
    feesPaid,
    checksPerformed = 0,
    decisionsAnalyzed = 0,
    tradesExecuted = 0,
    positionsOpened = 0,
    positionsClosed = 0,
    winningTrades = 0,
    losingTrades = 0,
    winRate = null,
    avgWin = null,
    avgLoss = null,
    bestTrade = null,
    worstTrade = null,
    signalAccuracy = null,
    openPositions = null,
    insights = [],
  } = reportData;

  const result = await query(
    `INSERT INTO ai_trader_daily_reports (
      ai_trader_id, report_date, start_value, end_value, pnl, pnl_percent, fees_paid,
      checks_performed, decisions_analyzed, trades_executed, positions_opened, positions_closed,
      winning_trades, losing_trades, win_rate, avg_win, avg_loss,
      best_trade, worst_trade, signal_accuracy, open_positions, insights
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    ON CONFLICT (ai_trader_id, report_date) DO UPDATE SET
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
      aiTraderId, reportDate, startValue, endValue, pnl, pnlPercent, feesPaid,
      checksPerformed, decisionsAnalyzed, tradesExecuted, positionsOpened, positionsClosed,
      winningTrades, losingTrades, winRate, avgWin, avgLoss,
      bestTrade ? JSON.stringify(bestTrade) : null,
      worstTrade ? JSON.stringify(worstTrade) : null,
      signalAccuracy ? JSON.stringify(signalAccuracy) : null,
      openPositions ? JSON.stringify(openPositions) : null,
      insights
    ]
  );

  return result.rows[0];
}

// ============================================================================
// Trader Statistics Updates
// ============================================================================

/**
 * Update trader statistics by counting from decisions table
 * This recalculates trades_executed, winning_trades, losing_trades, total_pnl
 * @param {number} traderId 
 */
export async function updateTraderStats(traderId) {
  // Count executed trades (buy, sell, short, close with executed=true)
  const countResult = await query(
    `SELECT 
       COUNT(*) FILTER (WHERE decision_type IN ('buy', 'sell', 'short', 'close')) as trades_executed,
       COUNT(*) FILTER (WHERE outcome_pnl IS NOT NULL AND outcome_pnl > 0) as winning_trades,
       COUNT(*) FILTER (WHERE outcome_pnl IS NOT NULL AND outcome_pnl < 0) as losing_trades,
       COALESCE(SUM(outcome_pnl_percent), 0) as total_pnl_percent
     FROM ai_trader_decisions 
     WHERE ai_trader_id = $1 AND executed = true`,
    [traderId]
  );
  
  const stats = countResult.rows[0];
  const tradesExecuted = parseInt(stats.trades_executed) || 0;
  const winningTrades = parseInt(stats.winning_trades) || 0;
  const losingTrades = parseInt(stats.losing_trades) || 0;
  const totalPnl = parseFloat(stats.total_pnl_percent) || 0;
  
  // Update the ai_traders table
  await query(
    `UPDATE ai_traders SET 
       trades_executed = $2,
       winning_trades = $3,
       losing_trades = $4,
       total_pnl = $5,
       updated_at = NOW()
     WHERE id = $1`,
    [traderId, tradesExecuted, winningTrades, losingTrades, totalPnl]
  );
  
  console.log(`[AI Trader] Updated stats for trader ${traderId}: ${tradesExecuted} trades, ${winningTrades} wins, ${losingTrades} losses, ${totalPnl.toFixed(2)}% P&L`);
}

// ============================================================================
// Training History Functions
// ============================================================================

/**
 * Record a training session
 * @param {number} traderId - AI Trader ID
 * @param {object} data - Training data
 * @returns {Promise<object>} Created training record
 */
export async function recordTrainingSession(traderId, data) {
  const result = await query(
    `INSERT INTO ai_trader_training_history (
       ai_trader_id, agent_name, training_type, status,
       started_at, completed_at, duration_seconds,
       symbols_trained, total_timesteps,
       final_reward, mean_reward, best_reward,
       mean_return_pct, max_return_pct, min_return_pct,
       episodes_completed, error_message, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      traderId,
      data.agent_name || null,
      data.training_type || 'self_training',
      data.status || 'completed',
      data.started_at,
      data.completed_at || null,
      data.duration_seconds != null ? Math.round(data.duration_seconds) : null,
      data.symbols_trained || null,
      data.total_timesteps || null,
      data.final_reward || null,
      data.mean_reward || null,
      data.best_reward || null,
      data.mean_return_pct || null,
      data.max_return_pct || null,
      data.min_return_pct || null,
      data.episodes_completed || null,
      data.error_message || null,
      data.metadata ? JSON.stringify(data.metadata) : null
    ]
  );
  return result.rows[0];
}

/**
 * Get training history for an AI trader
 * @param {number} traderId - AI Trader ID
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<Array>} Training history
 */
export async function getTrainingHistory(traderId, limit = 20) {
  const result = await query(
    `SELECT * FROM ai_trader_training_history 
     WHERE ai_trader_id = $1 
     ORDER BY started_at DESC 
     LIMIT $2`,
    [traderId, limit]
  );
  return result.rows;
}

/**
 * Get training statistics for an AI trader
 * @param {number} traderId - AI Trader ID
 * @returns {Promise<object>} Training statistics
 */
export async function getTrainingStats(traderId) {
  const result = await query(
    `SELECT 
       COUNT(*) as total_sessions,
       COUNT(*) FILTER (WHERE status = 'completed') as successful_sessions,
       COUNT(*) FILTER (WHERE status = 'failed') as failed_sessions,
       AVG(final_reward) FILTER (WHERE status = 'completed') as avg_reward,
       MAX(final_reward) FILTER (WHERE status = 'completed') as best_reward,
       AVG(mean_return_pct) FILTER (WHERE status = 'completed') as avg_return_pct,
       MAX(max_return_pct) FILTER (WHERE status = 'completed') as best_return_pct,
       SUM(total_timesteps) as total_timesteps_trained,
       SUM(duration_seconds) as total_training_time_seconds,
       MAX(started_at) as last_training,
       MIN(started_at) as first_training
     FROM ai_trader_training_history 
     WHERE ai_trader_id = $1`,
    [traderId]
  );
  
  const stats = result.rows[0];
  return {
    total_sessions: parseInt(stats.total_sessions) || 0,
    successful_sessions: parseInt(stats.successful_sessions) || 0,
    failed_sessions: parseInt(stats.failed_sessions) || 0,
    avg_reward: stats.avg_reward ? parseFloat(stats.avg_reward) : null,
    best_reward: stats.best_reward ? parseFloat(stats.best_reward) : null,
    avg_return_pct: stats.avg_return_pct ? parseFloat(stats.avg_return_pct) : null,
    best_return_pct: stats.best_return_pct ? parseFloat(stats.best_return_pct) : null,
    total_timesteps_trained: parseInt(stats.total_timesteps_trained) || null,
    total_training_time_seconds: parseInt(stats.total_training_time_seconds) || null,
    last_training: stats.last_training,
    first_training: stats.first_training
  };
}

// ============================================================================
// Exports
// ============================================================================

export default {
  initializeAITraderSchema,
  createAITrader,
  getAITrader,
  getAllAITraders,
  updateAITrader,
  deleteAITrader,
  startAITrader,
  stopAITrader,
  pauseAITrader,
  logDecision,
  getDecisions,
  getDecision,
  updateDecisionOutcome,
  updatePendingOutcomes,
  createAITraderPortfolio,
  getAITraderPortfolio,
  getDailyReports,
  createDailyReport,
  updateTraderStats,
  recordTrainingSession,
  getTrainingHistory,
  getTrainingStats,
  DEFAULT_PERSONALITY,
};
