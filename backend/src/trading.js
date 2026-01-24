/**
 * Paper Trading / Stock Market Simulation Module
 * 
 * Handles virtual portfolios, orders, positions, and fee calculations.
 * All data is tenant-scoped (user_id based isolation).
 */

import { query, getClient } from './db.js';

// ============================================================================
// Constants & Fee Structures
// ============================================================================

/**
 * Broker fee profiles
 */
export const BROKER_PROFILES = {
  discount: {
    name: 'Discount Broker',
    description: 'Low-cost broker with minimal fees',
    stockCommission: { type: 'flat', flatFee: 1.00, percentageFee: 0, minimumFee: 1.00, maximumFee: 1.00 },
    spreadPercent: 0.10,
    cfdOvernight: { longRate: 0.015, shortRate: 0.015 },
    leverageLimits: { stock: 5, index: 20, forex: 30, crypto: 2 },
  },
  standard: {
    name: 'Standard Broker',
    description: 'Typical online broker with balanced fees',
    stockCommission: { type: 'mixed', flatFee: 4.95, percentageFee: 0.25, minimumFee: 4.95, maximumFee: 59.00 },
    spreadPercent: 0.15,
    cfdOvernight: { longRate: 0.02, shortRate: 0.02 },
    leverageLimits: { stock: 5, index: 20, forex: 30, crypto: 2 },
  },
  premium: {
    name: 'Premium Broker',
    description: 'Professional broker with best execution',
    stockCommission: { type: 'flat', flatFee: 9.90, percentageFee: 0, minimumFee: 9.90, maximumFee: 9.90 },
    spreadPercent: 0.05,
    cfdOvernight: { longRate: 0.025, shortRate: 0.025 },
    leverageLimits: { stock: 5, index: 20, forex: 30, crypto: 2 },
  },
  marketMaker: {
    name: 'Market Maker',
    description: 'Zero commission but wider spreads',
    stockCommission: { type: 'flat', flatFee: 0, percentageFee: 0, minimumFee: 0, maximumFee: 0 },
    spreadPercent: 0.30,
    cfdOvernight: { longRate: 0.03, shortRate: 0.03 },
    leverageLimits: { stock: 5, index: 20, forex: 30, crypto: 2 },
  },
};

/**
 * Product type configurations
 */
export const PRODUCT_TYPES = {
  stock: { 
    name: 'Stock',
    defaultLeverage: 1,
    maxLeverage: 1,
    marginRequired: 100, // 100% margin = no leverage
    overnightFee: false,
    canShort: false,
  },
  cfd: { 
    name: 'CFD',
    defaultLeverage: 5,
    maxLeverage: 30,
    marginRequired: null, // Calculated based on leverage
    overnightFee: true,
    canShort: true,
  },
  knockout: { 
    name: 'Knock-Out Certificate',
    defaultLeverage: 10,
    maxLeverage: 100,
    marginRequired: null,
    overnightFee: false, // Built into product price
    canShort: true,
    hasKnockout: true,
  },
  factor: { 
    name: 'Factor Certificate',
    defaultLeverage: 3,
    maxLeverage: 10,
    marginRequired: 100, // No margin, leverage is built-in
    overnightFee: false,
    canShort: true,
    dailyReset: true,
  },
};

/**
 * Default portfolio settings
 */
const DEFAULT_PORTFOLIO_SETTINGS = {
  initialCapital: 100000,
  currency: 'EUR',
  brokerProfile: 'standard',
  marginCallLevel: 100, // Margin call at 100%
  liquidationLevel: 50, // Liquidation at 50%
  maxPositionPercent: 25, // Max 25% in single position
  maxLeverage: 30,
};

// ============================================================================
// Database Schema Initialization
// ============================================================================

/**
 * Initialize trading-related database tables
 */
export async function initializeTradingSchema() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Portfolios table
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolios (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL DEFAULT 'Main Portfolio',
        initial_capital DECIMAL(15,2) NOT NULL DEFAULT 100000,
        cash_balance DECIMAL(15,2) NOT NULL DEFAULT 100000,
        currency VARCHAR(3) DEFAULT 'EUR',
        broker_profile VARCHAR(50) DEFAULT 'standard',
        settings JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, name)
      );
    `);

    // Positions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        
        symbol VARCHAR(20) NOT NULL,
        product_type VARCHAR(20) DEFAULT 'stock',
        side VARCHAR(10) NOT NULL,
        
        quantity DECIMAL(15,4) NOT NULL,
        entry_price DECIMAL(15,4) NOT NULL,
        current_price DECIMAL(15,4),
        
        leverage DECIMAL(5,2) DEFAULT 1,
        margin_used DECIMAL(15,2),
        knockout_level DECIMAL(15,4),
        expiry_date DATE,
        
        stop_loss DECIMAL(15,4),
        take_profit DECIMAL(15,4),
        
        total_fees_paid DECIMAL(10,4) DEFAULT 0,
        total_overnight_fees DECIMAL(10,4) DEFAULT 0,
        days_held INTEGER DEFAULT 0,
        
        opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_overnight_charge TIMESTAMP WITH TIME ZONE,
        closed_at TIMESTAMP WITH TIME ZONE,
        close_reason VARCHAR(50),
        close_price DECIMAL(15,4),
        realized_pnl DECIMAL(15,4),
        
        is_open BOOLEAN DEFAULT true
      );
    `);

    // Orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
        
        symbol VARCHAR(20) NOT NULL,
        product_type VARCHAR(20) DEFAULT 'stock',
        order_type VARCHAR(20) NOT NULL,
        side VARCHAR(10) NOT NULL,
        
        quantity DECIMAL(15,4) NOT NULL,
        limit_price DECIMAL(15,4),
        stop_price DECIMAL(15,4),
        leverage DECIMAL(5,2) DEFAULT 1,
        knockout_level DECIMAL(15,4),
        
        stop_loss DECIMAL(15,4),
        take_profit DECIMAL(15,4),
        
        commission_fee DECIMAL(10,4) DEFAULT 0,
        spread_cost DECIMAL(10,4) DEFAULT 0,
        total_fees DECIMAL(10,4) DEFAULT 0,
        
        status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT,
        
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        filled_at TIMESTAMP WITH TIME ZONE,
        filled_price DECIMAL(15,4),
        cancelled_at TIMESTAMP WITH TIME ZONE
      );
    `);

    // Transactions table (trade history)
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
        
        transaction_type VARCHAR(30) NOT NULL,
        symbol VARCHAR(20),
        side VARCHAR(10),
        product_type VARCHAR(20),
        
        quantity DECIMAL(15,4),
        price DECIMAL(15,4),
        total_value DECIMAL(15,2),
        
        commission_fee DECIMAL(10,4) DEFAULT 0,
        spread_cost DECIMAL(10,4) DEFAULT 0,
        overnight_fee DECIMAL(10,4) DEFAULT 0,
        other_fees DECIMAL(10,4) DEFAULT 0,
        total_fees DECIMAL(10,4) DEFAULT 0,
        
        realized_pnl DECIMAL(15,4),
        cash_impact DECIMAL(15,2),
        balance_after DECIMAL(15,2),
        
        description TEXT,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Fee log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS fee_log (
        id SERIAL PRIMARY KEY,
        portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE CASCADE,
        position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        
        fee_type VARCHAR(30) NOT NULL,
        amount DECIMAL(10,4) NOT NULL,
        description TEXT,
        charged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Portfolio snapshots for performance tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id SERIAL PRIMARY KEY,
        portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE CASCADE,
        
        total_value DECIMAL(15,2),
        cash_balance DECIMAL(15,2),
        positions_value DECIMAL(15,2),
        unrealized_pnl DECIMAL(15,2),
        realized_pnl DECIMAL(15,2),
        total_fees_paid DECIMAL(10,4),
        margin_used DECIMAL(15,2),
        
        recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);
      CREATE INDEX IF NOT EXISTS idx_positions_portfolio_id ON positions(portfolio_id);
      CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
      CREATE INDEX IF NOT EXISTS idx_positions_is_open ON positions(is_open);
      CREATE INDEX IF NOT EXISTS idx_orders_portfolio_id ON orders(portfolio_id);
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_id ON transactions(portfolio_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_fee_log_portfolio_id ON fee_log(portfolio_id);
      CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_portfolio_id ON portfolio_snapshots(portfolio_id);
    `);

    // ========== BACKTESTING TABLES ==========
    
    // Backtest sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS backtest_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        current_date DATE NOT NULL,
        initial_capital DECIMAL(15,2) NOT NULL DEFAULT 100000,
        current_capital DECIMAL(15,2) NOT NULL DEFAULT 100000,
        broker_profile VARCHAR(50) DEFAULT 'standard',
        symbols JSONB DEFAULT '[]',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Backtest positions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS backtest_positions (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES backtest_sessions(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(20) NOT NULL,
        product_type VARCHAR(20) DEFAULT 'stock',
        side VARCHAR(10) NOT NULL,
        quantity DECIMAL(15,4) NOT NULL,
        entry_price DECIMAL(15,4) NOT NULL,
        current_price DECIMAL(15,4),
        leverage DECIMAL(5,2) DEFAULT 1,
        margin_used DECIMAL(15,2),
        stop_loss DECIMAL(15,4),
        take_profit DECIMAL(15,4),
        total_fees_paid DECIMAL(10,4) DEFAULT 0,
        realized_pnl DECIMAL(15,4),
        is_open BOOLEAN DEFAULT true,
        opened_at DATE,
        closed_at DATE
      );
    `);

    // Backtest orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS backtest_orders (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES backtest_sessions(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(20) NOT NULL,
        side VARCHAR(10) NOT NULL,
        product_type VARCHAR(20) DEFAULT 'stock',
        quantity DECIMAL(15,4) NOT NULL,
        price DECIMAL(15,4) NOT NULL,
        leverage DECIMAL(5,2) DEFAULT 1,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        executed_at DATE
      );
    `);

    // Backtest trades table
    await client.query(`
      CREATE TABLE IF NOT EXISTS backtest_trades (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES backtest_sessions(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES backtest_orders(id) ON DELETE SET NULL,
        position_id INTEGER REFERENCES backtest_positions(id) ON DELETE SET NULL,
        symbol VARCHAR(20) NOT NULL,
        side VARCHAR(10) NOT NULL,
        quantity DECIMAL(15,4) NOT NULL,
        price DECIMAL(15,4) NOT NULL,
        fees DECIMAL(10,4) DEFAULT 0,
        pnl DECIMAL(15,4),
        executed_at DATE
      );
    `);

    // Backtest snapshots table
    await client.query(`
      CREATE TABLE IF NOT EXISTS backtest_snapshots (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES backtest_sessions(id) ON DELETE CASCADE,
        snapshot_date DATE NOT NULL,
        total_value DECIMAL(15,2),
        cash_balance DECIMAL(15,2),
        unrealized_pnl DECIMAL(15,2),
        margin_used DECIMAL(15,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Backtest indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_backtest_sessions_user_id ON backtest_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_backtest_positions_session_id ON backtest_positions(session_id);
      CREATE INDEX IF NOT EXISTS idx_backtest_orders_session_id ON backtest_orders(session_id);
      CREATE INDEX IF NOT EXISTS idx_backtest_trades_session_id ON backtest_trades(session_id);
      CREATE INDEX IF NOT EXISTS idx_backtest_snapshots_session_id ON backtest_snapshots(session_id);
    `);

    await client.query('COMMIT');
    console.log('Trading database schema initialized successfully');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Trading schema initialization error:', e);
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// Fee Calculation Functions
// ============================================================================

/**
 * Calculate trading fees for an order
 */
export function calculateFees(params) {
  const { productType, side, quantity, price, leverage = 1, brokerProfile = 'standard' } = params;
  const broker = BROKER_PROFILES[brokerProfile] || BROKER_PROFILES.standard;
  
  const notionalValue = quantity * price;
  const leveragedValue = notionalValue * leverage;
  
  // Commission calculation
  let commission = 0;
  const comm = broker.stockCommission;
  
  if (comm.type === 'flat') {
    commission = comm.flatFee;
  } else if (comm.type === 'percentage') {
    commission = Math.max(comm.minimumFee, Math.min(comm.maximumFee, notionalValue * (comm.percentageFee / 100)));
  } else if (comm.type === 'mixed') {
    const percentagePart = notionalValue * (comm.percentageFee / 100);
    commission = Math.max(comm.minimumFee, Math.min(comm.maximumFee, comm.flatFee + percentagePart));
  }
  
  // Spread cost
  const spreadCost = notionalValue * (broker.spreadPercent / 100);
  
  // Total fees
  const totalFees = commission + spreadCost;
  
  // Effective price (including spread)
  const effectivePrice = side === 'buy' 
    ? price * (1 + broker.spreadPercent / 200) 
    : price * (1 - broker.spreadPercent / 200);
  
  // Break-even move required
  const breakEvenMove = ((totalFees * 2) / notionalValue) * 100; // *2 for round trip
  
  // Margin required for leveraged products
  let marginRequired = notionalValue;
  if (productType === 'cfd' || productType === 'knockout') {
    marginRequired = leveragedValue / leverage;
  }
  
  return {
    commission,
    spreadCost,
    totalFees,
    effectivePrice,
    breakEvenMove,
    marginRequired,
    notionalValue,
    leveragedValue,
  };
}

/**
 * Calculate overnight fee for a position
 */
export function calculateOvernightFee(position, brokerProfile = 'standard') {
  const broker = BROKER_PROFILES[brokerProfile] || BROKER_PROFILES.standard;
  const product = PRODUCT_TYPES[position.product_type];
  
  if (!product?.overnightFee) {
    return 0;
  }
  
  const notionalValue = position.quantity * position.current_price * position.leverage;
  const rate = position.side === 'long' 
    ? broker.cfdOvernight.longRate 
    : broker.cfdOvernight.shortRate;
  
  return (notionalValue * rate) / 100;
}

/**
 * Calculate liquidation price for leveraged position
 */
export function calculateLiquidationPrice(position) {
  const { entry_price, leverage, side, margin_used } = position;
  
  if (leverage <= 1) return null;
  
  // Liquidation when losses equal margin (simplified)
  const maxLossPercent = (1 / leverage) * 100;
  
  if (side === 'long') {
    return entry_price * (1 - maxLossPercent / 100);
  } else {
    return entry_price * (1 + maxLossPercent / 100);
  }
}

// ============================================================================
// Portfolio Functions
// ============================================================================

/**
 * Get or create default portfolio for user
 */
export async function getOrCreatePortfolio(userId, portfolioName = 'Main Portfolio') {
  try {
    // Try to get existing portfolio
    let result = await query(
      `SELECT * FROM portfolios WHERE user_id = $1 AND name = $2`,
      [userId, portfolioName]
    );
    
    if (result.rows.length > 0) {
      return formatPortfolio(result.rows[0]);
    }
    
    // Create new portfolio
    result = await query(
      `INSERT INTO portfolios (user_id, name, initial_capital, cash_balance, settings)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING *`,
      [userId, portfolioName, DEFAULT_PORTFOLIO_SETTINGS.initialCapital, JSON.stringify(DEFAULT_PORTFOLIO_SETTINGS)]
    );
    
    return formatPortfolio(result.rows[0]);
  } catch (e) {
    console.error('Get/create portfolio error:', e);
    throw e;
  }
}

/**
 * Get all portfolios for user
 */
export async function getUserPortfolios(userId) {
  try {
    const result = await query(
      `SELECT * FROM portfolios WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    return result.rows.map(formatPortfolio);
  } catch (e) {
    console.error('Get portfolios error:', e);
    throw e;
  }
}

/**
 * Get portfolio by ID (with user validation)
 */
export async function getPortfolio(portfolioId, userId) {
  try {
    const result = await query(
      `SELECT * FROM portfolios WHERE id = $1 AND user_id = $2`,
      [portfolioId, userId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return formatPortfolio(result.rows[0]);
  } catch (e) {
    console.error('Get portfolio error:', e);
    throw e;
  }
}

/**
 * Update portfolio settings
 */
export async function updatePortfolioSettings(portfolioId, userId, settings) {
  try {
    const result = await query(
      `UPDATE portfolios 
       SET settings = settings || $3::jsonb, 
           broker_profile = COALESCE($4, broker_profile),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [portfolioId, userId, JSON.stringify(settings), settings.brokerProfile]
    );
    
    return result.rows.length > 0 ? formatPortfolio(result.rows[0]) : null;
  } catch (e) {
    console.error('Update portfolio settings error:', e);
    throw e;
  }
}

/**
 * Set initial capital and reset portfolio
 * This changes the starting capital and resets all positions
 * @param {number} portfolioId
 * @param {number} userId
 * @param {number} newCapital - New initial capital amount (min: 1000, max: 10000000)
 */
export async function setInitialCapital(portfolioId, userId, newCapital) {
  // Validate capital amount
  if (typeof newCapital !== 'number' || isNaN(newCapital)) {
    throw new Error('Invalid capital amount');
  }
  if (newCapital < 1000) {
    throw new Error('Mindestkapital ist 1.000 €');
  }
  if (newCapital > 10000000) {
    throw new Error('Maximales Kapital ist 10.000.000 €');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get portfolio
    const portfolioResult = await client.query(
      `SELECT * FROM portfolios WHERE id = $1 AND user_id = $2`,
      [portfolioId, userId]
    );
    
    if (portfolioResult.rows.length === 0) {
      throw new Error('Portfolio not found');
    }
    
    const oldCapital = parseFloat(portfolioResult.rows[0].initial_capital);
    
    // Close all positions
    await client.query(
      `UPDATE positions SET is_open = false, closed_at = CURRENT_TIMESTAMP, close_reason = 'capital_change'
       WHERE portfolio_id = $1 AND is_open = true`,
      [portfolioId]
    );
    
    // Cancel pending orders
    await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
       WHERE portfolio_id = $1 AND status = 'pending'`,
      [portfolioId]
    );
    
    // Update initial capital and cash balance
    await client.query(
      `UPDATE portfolios 
       SET initial_capital = $3, 
           cash_balance = $3, 
           settings = settings || $4::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2`,
      [portfolioId, userId, newCapital, JSON.stringify({ initialCapital: newCapital })]
    );
    
    // Add transaction for capital change
    await client.query(
      `INSERT INTO transactions (portfolio_id, user_id, transaction_type, description, cash_impact, balance_after)
       VALUES ($1, $2, 'capital_change', $3, $4, $5)`,
      [
        portfolioId, 
        userId, 
        `Startkapital geändert: ${oldCapital.toFixed(2)} € → ${newCapital.toFixed(2)} €`,
        newCapital - oldCapital,
        newCapital
      ]
    );
    
    await client.query('COMMIT');
    
    return getPortfolio(portfolioId, userId);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Set initial capital error:', e);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Reset portfolio to initial state
 */
export async function resetPortfolio(portfolioId, userId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get portfolio
    const portfolioResult = await client.query(
      `SELECT * FROM portfolios WHERE id = $1 AND user_id = $2`,
      [portfolioId, userId]
    );
    
    if (portfolioResult.rows.length === 0) {
      throw new Error('Portfolio not found');
    }
    
    const portfolio = portfolioResult.rows[0];
    
    // Close all positions
    await client.query(
      `UPDATE positions SET is_open = false, closed_at = CURRENT_TIMESTAMP, close_reason = 'reset'
       WHERE portfolio_id = $1 AND is_open = true`,
      [portfolioId]
    );
    
    // Cancel pending orders
    await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
       WHERE portfolio_id = $1 AND status = 'pending'`,
      [portfolioId]
    );
    
    // Reset cash balance
    await client.query(
      `UPDATE portfolios SET cash_balance = initial_capital, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [portfolioId]
    );
    
    // Add reset transaction
    await client.query(
      `INSERT INTO transactions (portfolio_id, user_id, transaction_type, description, cash_impact, balance_after)
       VALUES ($1, $2, 'reset', 'Portfolio reset to initial capital', $3, $3)`,
      [portfolioId, userId, portfolio.initial_capital]
    );
    
    await client.query('COMMIT');
    
    return getPortfolio(portfolioId, userId);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Reset portfolio error:', e);
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// Position Functions
// ============================================================================

/**
 * Get open positions for portfolio
 */
export async function getOpenPositions(portfolioId, userId) {
  try {
    const result = await query(
      `SELECT * FROM positions 
       WHERE portfolio_id = $1 AND user_id = $2 AND is_open = true
       ORDER BY opened_at DESC`,
      [portfolioId, userId]
    );
    return result.rows.map(formatPosition);
  } catch (e) {
    console.error('Get positions error:', e);
    throw e;
  }
}

/**
 * Get all positions (including closed) for portfolio
 */
export async function getAllPositions(portfolioId, userId, limit = 100) {
  try {
    const result = await query(
      `SELECT * FROM positions 
       WHERE portfolio_id = $1 AND user_id = $2
       ORDER BY opened_at DESC
       LIMIT $3`,
      [portfolioId, userId, limit]
    );
    return result.rows.map(formatPosition);
  } catch (e) {
    console.error('Get all positions error:', e);
    throw e;
  }
}

/**
 * Update position price (for P&L calculation)
 */
export async function updatePositionPrice(positionId, userId, currentPrice) {
  try {
    const result = await query(
      `UPDATE positions SET current_price = $3
       WHERE id = $1 AND user_id = $2 AND is_open = true
       RETURNING *`,
      [positionId, userId, currentPrice]
    );
    return result.rows.length > 0 ? formatPosition(result.rows[0]) : null;
  } catch (e) {
    console.error('Update position price error:', e);
    throw e;
  }
}

// ============================================================================
// Order Functions
// ============================================================================

/**
 * Create and execute a market order
 */
export async function executeMarketOrder(params) {
  const { 
    userId, portfolioId, symbol, side, quantity, currentPrice,
    productType = 'stock', leverage = 1, stopLoss, takeProfit, knockoutLevel
  } = params;
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get portfolio
    const portfolioResult = await client.query(
      `SELECT * FROM portfolios WHERE id = $1 AND user_id = $2`,
      [portfolioId, userId]
    );
    
    if (portfolioResult.rows.length === 0) {
      throw new Error('Portfolio not found');
    }
    
    const portfolio = portfolioResult.rows[0];
    const brokerProfile = portfolio.broker_profile || 'standard';
    
    // Calculate fees
    const fees = calculateFees({
      productType,
      side,
      quantity,
      price: currentPrice,
      leverage,
      brokerProfile,
    });
    
    // Check if we have enough cash
    const requiredCash = side === 'buy' 
      ? fees.marginRequired + fees.totalFees 
      : fees.totalFees;
    
    if (parseFloat(portfolio.cash_balance) < requiredCash) {
      throw new Error(`Insufficient funds. Required: ${requiredCash.toFixed(2)}, Available: ${portfolio.cash_balance}`);
    }
    
    // For selling, check if we have the position
    if (side === 'sell' && productType === 'stock') {
      const existingPosition = await client.query(
        `SELECT * FROM positions 
         WHERE portfolio_id = $1 AND symbol = $2 AND side = 'long' AND is_open = true AND product_type = 'stock'`,
        [portfolioId, symbol]
      );
      
      if (existingPosition.rows.length === 0 || parseFloat(existingPosition.rows[0].quantity) < quantity) {
        throw new Error('Insufficient shares to sell');
      }
    }
    
    // Create order
    const orderResult = await client.query(
      `INSERT INTO orders (
        portfolio_id, user_id, symbol, product_type, order_type, side,
        quantity, leverage, knockout_level, stop_loss, take_profit,
        commission_fee, spread_cost, total_fees, status, filled_at, filled_price
      ) VALUES ($1, $2, $3, $4, 'market', $5, $6, $7, $8, $9, $10, $11, $12, $13, 'filled', CURRENT_TIMESTAMP, $14)
      RETURNING *`,
      [
        portfolioId, userId, symbol, productType, side,
        quantity, leverage, knockoutLevel, stopLoss, takeProfit,
        fees.commission, fees.spreadCost, fees.totalFees, fees.effectivePrice
      ]
    );
    
    const order = orderResult.rows[0];
    
    // Handle position creation/closing
    let position = null;
    let cashImpact = 0;
    let realizedPnl = 0;
    
    if (side === 'buy' || (side === 'short' && (productType === 'cfd' || productType === 'knockout'))) {
      // Open new position
      const positionSide = side === 'buy' ? 'long' : 'short';
      const liquidationPrice = calculateLiquidationPrice({
        entry_price: fees.effectivePrice,
        leverage,
        side: positionSide,
        margin_used: fees.marginRequired,
      });
      
      const positionResult = await client.query(
        `INSERT INTO positions (
          portfolio_id, user_id, symbol, product_type, side,
          quantity, entry_price, current_price, leverage, margin_used,
          knockout_level, stop_loss, take_profit, total_fees_paid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          portfolioId, userId, symbol, productType, positionSide,
          quantity, fees.effectivePrice, leverage, fees.marginRequired,
          knockoutLevel, stopLoss, takeProfit, fees.totalFees
        ]
      );
      
      position = formatPosition(positionResult.rows[0]);
      cashImpact = -(fees.marginRequired + fees.totalFees);
      
      // Update order with position reference
      await client.query(
        `UPDATE orders SET position_id = $1 WHERE id = $2`,
        [positionResult.rows[0].id, order.id]
      );
    } else if (side === 'sell') {
      // Close existing position
      const existingPosition = await client.query(
        `SELECT * FROM positions 
         WHERE portfolio_id = $1 AND symbol = $2 AND side = 'long' AND is_open = true AND product_type = $3
         ORDER BY opened_at
         LIMIT 1`,
        [portfolioId, symbol, productType]
      );
      
      if (existingPosition.rows.length > 0) {
        const pos = existingPosition.rows[0];
        const sellQuantity = Math.min(quantity, parseFloat(pos.quantity));
        const entryValue = sellQuantity * parseFloat(pos.entry_price);
        const exitValue = sellQuantity * fees.effectivePrice;
        realizedPnl = (exitValue - entryValue) * pos.leverage - fees.totalFees;
        cashImpact = exitValue - fees.totalFees;
        
        if (sellQuantity >= parseFloat(pos.quantity)) {
          // Close entire position
          await client.query(
            `UPDATE positions SET 
              is_open = false, closed_at = CURRENT_TIMESTAMP, close_reason = 'user',
              close_price = $3, realized_pnl = $4, total_fees_paid = total_fees_paid + $5
             WHERE id = $1 AND user_id = $2`,
            [pos.id, userId, fees.effectivePrice, realizedPnl, fees.totalFees]
          );
        } else {
          // Partial close
          await client.query(
            `UPDATE positions SET quantity = quantity - $3, total_fees_paid = total_fees_paid + $4
             WHERE id = $1 AND user_id = $2`,
            [pos.id, userId, sellQuantity, fees.totalFees]
          );
        }
        
        position = formatPosition(pos);
      }
    }
    
    // Update portfolio cash balance
    await client.query(
      `UPDATE portfolios SET cash_balance = cash_balance + $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [portfolioId, cashImpact]
    );
    
    // Get new balance
    const newBalanceResult = await client.query(
      `SELECT cash_balance FROM portfolios WHERE id = $1`,
      [portfolioId]
    );
    const newBalance = newBalanceResult.rows[0].cash_balance;
    
    // Create transaction record
    await client.query(
      `INSERT INTO transactions (
        portfolio_id, user_id, order_id, position_id, transaction_type,
        symbol, side, product_type, quantity, price, total_value,
        commission_fee, spread_cost, total_fees, realized_pnl, cash_impact, balance_after
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        portfolioId, userId, order.id, position?.id, side === 'buy' ? 'buy' : 'sell',
        symbol, side, productType, quantity, fees.effectivePrice, fees.notionalValue,
        fees.commission, fees.spreadCost, fees.totalFees, realizedPnl, cashImpact, newBalance
      ]
    );
    
    // Log fees
    if (fees.commission > 0) {
      await client.query(
        `INSERT INTO fee_log (portfolio_id, position_id, order_id, fee_type, amount, description)
         VALUES ($1, $2, $3, 'commission', $4, $5)`,
        [portfolioId, position?.id, order.id, fees.commission, `Commission for ${side} ${quantity} ${symbol}`]
      );
    }
    
    if (fees.spreadCost > 0) {
      await client.query(
        `INSERT INTO fee_log (portfolio_id, position_id, order_id, fee_type, amount, description)
         VALUES ($1, $2, $3, 'spread', $4, $5)`,
        [portfolioId, position?.id, order.id, fees.spreadCost, `Spread cost for ${side} ${quantity} ${symbol}`]
      );
    }
    
    await client.query('COMMIT');
    
    return {
      success: true,
      order: formatOrder(order),
      position,
      fees,
      cashImpact,
      realizedPnl,
      newBalance: parseFloat(newBalance),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Execute market order error:', e);
    return {
      success: false,
      error: e.message,
    };
  } finally {
    client.release();
  }
}

/**
 * Close a position
 */
export async function closePosition(positionId, userId, currentPrice, reason = 'user') {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get position
    const posResult = await client.query(
      `SELECT p.*, pf.broker_profile, pf.cash_balance
       FROM positions p
       JOIN portfolios pf ON p.portfolio_id = pf.id
       WHERE p.id = $1 AND p.user_id = $2 AND p.is_open = true`,
      [positionId, userId]
    );
    
    if (posResult.rows.length === 0) {
      throw new Error('Position not found or already closed');
    }
    
    const pos = posResult.rows[0];
    const fees = calculateFees({
      productType: pos.product_type,
      side: pos.side === 'long' ? 'sell' : 'buy',
      quantity: parseFloat(pos.quantity),
      price: currentPrice,
      leverage: parseFloat(pos.leverage),
      brokerProfile: pos.broker_profile,
    });
    
    // Calculate P&L
    const entryValue = parseFloat(pos.quantity) * parseFloat(pos.entry_price);
    const exitValue = parseFloat(pos.quantity) * fees.effectivePrice;
    const pnlMultiplier = pos.side === 'long' ? 1 : -1;
    const grossPnl = (exitValue - entryValue) * pnlMultiplier * parseFloat(pos.leverage);
    const realizedPnl = grossPnl - fees.totalFees;
    
    // Cash returned
    const cashImpact = parseFloat(pos.margin_used) + realizedPnl;
    
    // Close position
    await client.query(
      `UPDATE positions SET 
        is_open = false, closed_at = CURRENT_TIMESTAMP, close_reason = $3,
        close_price = $4, realized_pnl = $5, total_fees_paid = total_fees_paid + $6
       WHERE id = $1 AND user_id = $2`,
      [positionId, userId, reason, fees.effectivePrice, realizedPnl, fees.totalFees]
    );
    
    // Update portfolio balance
    await client.query(
      `UPDATE portfolios SET cash_balance = cash_balance + $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [pos.portfolio_id, cashImpact]
    );
    
    // Get new balance
    const newBalanceResult = await client.query(
      `SELECT cash_balance FROM portfolios WHERE id = $1`,
      [pos.portfolio_id]
    );
    const newBalance = newBalanceResult.rows[0].cash_balance;
    
    // Create transaction
    await client.query(
      `INSERT INTO transactions (
        portfolio_id, user_id, position_id, transaction_type,
        symbol, side, product_type, quantity, price, total_value,
        commission_fee, spread_cost, total_fees, realized_pnl, cash_impact, balance_after
      ) VALUES ($1, $2, $3, 'close', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        pos.portfolio_id, userId, positionId,
        pos.symbol, pos.side === 'long' ? 'sell' : 'buy', pos.product_type,
        pos.quantity, fees.effectivePrice, exitValue,
        fees.commission, fees.spreadCost, fees.totalFees,
        realizedPnl, cashImpact, newBalance
      ]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      realizedPnl,
      fees: fees.totalFees,
      cashImpact,
      newBalance: parseFloat(newBalance),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Close position error:', e);
    return {
      success: false,
      error: e.message,
    };
  } finally {
    client.release();
  }
}

/**
 * Process overnight fees for all open leveraged positions
 */
export async function processOvernightFees() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get all open CFD positions that haven't been charged today
    const positions = await client.query(
      `SELECT p.*, pf.broker_profile, pf.cash_balance
       FROM positions p
       JOIN portfolios pf ON p.portfolio_id = pf.id
       WHERE p.is_open = true 
         AND p.product_type IN ('cfd')
         AND (p.last_overnight_charge IS NULL OR p.last_overnight_charge < CURRENT_DATE)`
    );
    
    for (const pos of positions.rows) {
      const fee = calculateOvernightFee(pos, pos.broker_profile);
      
      if (fee > 0) {
        // Charge fee
        await client.query(
          `UPDATE positions SET 
            total_overnight_fees = total_overnight_fees + $2,
            days_held = days_held + 1,
            last_overnight_charge = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [pos.id, fee]
        );
        
        // Deduct from portfolio
        await client.query(
          `UPDATE portfolios SET cash_balance = cash_balance - $2
           WHERE id = $1`,
          [pos.portfolio_id, fee]
        );
        
        // Log fee
        await client.query(
          `INSERT INTO fee_log (portfolio_id, position_id, fee_type, amount, description)
           VALUES ($1, $2, 'overnight', $3, $4)`,
          [pos.portfolio_id, pos.id, fee, `Overnight fee for ${pos.symbol} CFD position`]
        );
        
        // Transaction record
        await client.query(
          `INSERT INTO transactions (
            portfolio_id, user_id, position_id, transaction_type,
            symbol, overnight_fee, total_fees, cash_impact, description
           ) VALUES ($1, $2, $3, 'overnight_fee', $4, $5, $5, $6, $7)`,
          [
            pos.portfolio_id, pos.user_id, pos.id, pos.symbol,
            fee, -fee, `Daily overnight fee for ${pos.symbol}`
          ]
        );
      }
    }
    
    await client.query('COMMIT');
    console.log(`Processed overnight fees for ${positions.rows.length} positions`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Process overnight fees error:', e);
  } finally {
    client.release();
  }
}

// ============================================================================
// Transaction History Functions
// ============================================================================

/**
 * Get transaction history
 */
export async function getTransactionHistory(portfolioId, userId, limit = 50, offset = 0) {
  try {
    const result = await query(
      `SELECT * FROM transactions 
       WHERE portfolio_id = $1 AND user_id = $2
       ORDER BY executed_at DESC
       LIMIT $3 OFFSET $4`,
      [portfolioId, userId, limit, offset]
    );
    return result.rows.map(formatTransaction);
  } catch (e) {
    console.error('Get transactions error:', e);
    throw e;
  }
}

/**
 * Get fee summary
 */
export async function getFeeSummary(portfolioId, userId) {
  try {
    const result = await query(
      `SELECT 
        fee_type,
        SUM(amount) as total_amount,
        COUNT(*) as count
       FROM fee_log
       WHERE portfolio_id = $1
       GROUP BY fee_type`,
      [portfolioId]
    );
    
    const summary = {
      commission: 0,
      spread: 0,
      overnight: 0,
      other: 0,
      total: 0,
    };
    
    for (const row of result.rows) {
      const amount = parseFloat(row.total_amount);
      summary[row.fee_type] = amount;
      summary.total += amount;
    }
    
    return summary;
  } catch (e) {
    console.error('Get fee summary error:', e);
    throw e;
  }
}

// ============================================================================
// Performance Metrics Functions
// ============================================================================

/**
 * Calculate portfolio performance metrics
 */
export async function getPortfolioMetrics(portfolioId, userId) {
  try {
    const portfolio = await getPortfolio(portfolioId, userId);
    if (!portfolio) {
      throw new Error('Portfolio not found');
    }
    
    const positions = await getOpenPositions(portfolioId, userId);
    const feeSummary = await getFeeSummary(portfolioId, userId);
    
    // Calculate positions value and unrealized P&L
    let positionsValue = 0;
    let unrealizedPnl = 0;
    let marginUsed = 0;
    
    for (const pos of positions) {
      const currentValue = pos.quantity * (pos.currentPrice || pos.entryPrice);
      const entryValue = pos.quantity * pos.entryPrice;
      const pnlMultiplier = pos.side === 'long' ? 1 : -1;
      
      positionsValue += pos.marginUsed;
      unrealizedPnl += (currentValue - entryValue) * pnlMultiplier * pos.leverage;
      marginUsed += pos.marginUsed;
    }
    
    // Get realized P&L from closed positions
    const realizedResult = await query(
      `SELECT COALESCE(SUM(realized_pnl), 0) as realized_pnl
       FROM positions
       WHERE portfolio_id = $1 AND user_id = $2 AND is_open = false`,
      [portfolioId, userId]
    );
    const realizedPnl = parseFloat(realizedResult.rows[0].realized_pnl);
    
    // Get trade stats
    const statsResult = await query(
      `SELECT 
        COUNT(*) as total_trades,
        COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) as winning_trades,
        COUNT(CASE WHEN realized_pnl < 0 THEN 1 END) as losing_trades,
        COALESCE(AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END), 0) as avg_win,
        COALESCE(AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END), 0) as avg_loss
       FROM positions
       WHERE portfolio_id = $1 AND user_id = $2 AND is_open = false`,
      [portfolioId, userId]
    );
    const stats = statsResult.rows[0];
    
    const totalValue = portfolio.cashBalance + positionsValue + unrealizedPnl;
    const totalReturn = ((totalValue - portfolio.initialCapital) / portfolio.initialCapital) * 100;
    const grossPnl = realizedPnl + unrealizedPnl + feeSummary.total;
    const netPnl = realizedPnl + unrealizedPnl;
    const winRate = stats.total_trades > 0 
      ? (parseInt(stats.winning_trades) / parseInt(stats.total_trades)) * 100 
      : 0;
    
    // Margin level calculation
    const marginLevel = marginUsed > 0 ? (totalValue / marginUsed) * 100 : null;
    const freeMargin = portfolio.cashBalance;
    
    return {
      portfolioId,
      totalValue,
      cashBalance: portfolio.cashBalance,
      positionsValue,
      marginUsed,
      freeMargin,
      marginLevel,
      
      unrealizedPnl,
      realizedPnl,
      grossPnl,
      netPnl,
      totalReturn,
      
      totalFees: feeSummary.total,
      feeBreakdown: feeSummary,
      
      totalTrades: parseInt(stats.total_trades),
      winningTrades: parseInt(stats.winning_trades),
      losingTrades: parseInt(stats.losing_trades),
      winRate,
      avgWin: parseFloat(stats.avg_win),
      avgLoss: parseFloat(stats.avg_loss),
      
      isMarginWarning: marginLevel !== null && marginLevel < 150,
      isLiquidationRisk: marginLevel !== null && marginLevel < 100,
    };
  } catch (e) {
    console.error('Get portfolio metrics error:', e);
    throw e;
  }
}

/**
 * Save portfolio snapshot for historical tracking
 */
export async function savePortfolioSnapshot(portfolioId) {
  try {
    const metricsResult = await query(
      `SELECT user_id FROM portfolios WHERE id = $1`,
      [portfolioId]
    );
    
    if (metricsResult.rows.length === 0) return;
    
    const metrics = await getPortfolioMetrics(portfolioId, metricsResult.rows[0].user_id);
    
    await query(
      `INSERT INTO portfolio_snapshots (
        portfolio_id, total_value, cash_balance, positions_value,
        unrealized_pnl, realized_pnl, total_fees_paid, margin_used
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        portfolioId, metrics.totalValue, metrics.cashBalance, metrics.positionsValue,
        metrics.unrealizedPnl, metrics.realizedPnl, metrics.totalFees, metrics.marginUsed
      ]
    );
  } catch (e) {
    console.error('Save snapshot error:', e);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatPortfolio(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    initialCapital: parseFloat(row.initial_capital),
    cashBalance: parseFloat(row.cash_balance),
    currency: row.currency,
    brokerProfile: row.broker_profile,
    settings: row.settings || {},
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatPosition(row) {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    userId: row.user_id,
    symbol: row.symbol,
    productType: row.product_type,
    side: row.side,
    quantity: parseFloat(row.quantity),
    entryPrice: parseFloat(row.entry_price),
    currentPrice: row.current_price ? parseFloat(row.current_price) : null,
    leverage: parseFloat(row.leverage),
    marginUsed: row.margin_used ? parseFloat(row.margin_used) : null,
    knockoutLevel: row.knockout_level ? parseFloat(row.knockout_level) : null,
    expiryDate: row.expiry_date,
    stopLoss: row.stop_loss ? parseFloat(row.stop_loss) : null,
    takeProfit: row.take_profit ? parseFloat(row.take_profit) : null,
    totalFeesPaid: parseFloat(row.total_fees_paid || 0),
    totalOvernightFees: parseFloat(row.total_overnight_fees || 0),
    daysHeld: row.days_held || 0,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    closePrice: row.close_price ? parseFloat(row.close_price) : null,
    realizedPnl: row.realized_pnl ? parseFloat(row.realized_pnl) : null,
    isOpen: row.is_open,
  };
}

function formatOrder(row) {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    userId: row.user_id,
    positionId: row.position_id,
    symbol: row.symbol,
    productType: row.product_type,
    orderType: row.order_type,
    side: row.side,
    quantity: parseFloat(row.quantity),
    limitPrice: row.limit_price ? parseFloat(row.limit_price) : null,
    stopPrice: row.stop_price ? parseFloat(row.stop_price) : null,
    leverage: parseFloat(row.leverage),
    knockoutLevel: row.knockout_level ? parseFloat(row.knockout_level) : null,
    stopLoss: row.stop_loss ? parseFloat(row.stop_loss) : null,
    takeProfit: row.take_profit ? parseFloat(row.take_profit) : null,
    commissionFee: parseFloat(row.commission_fee || 0),
    spreadCost: parseFloat(row.spread_cost || 0),
    totalFees: parseFloat(row.total_fees || 0),
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    filledAt: row.filled_at,
    filledPrice: row.filled_price ? parseFloat(row.filled_price) : null,
    cancelledAt: row.cancelled_at,
  };
}

function formatTransaction(row) {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    orderId: row.order_id,
    positionId: row.position_id,
    transactionType: row.transaction_type,
    symbol: row.symbol,
    side: row.side,
    productType: row.product_type,
    quantity: row.quantity ? parseFloat(row.quantity) : null,
    price: row.price ? parseFloat(row.price) : null,
    totalValue: row.total_value ? parseFloat(row.total_value) : null,
    commissionFee: parseFloat(row.commission_fee || 0),
    spreadCost: parseFloat(row.spread_cost || 0),
    overnightFee: parseFloat(row.overnight_fee || 0),
    otherFees: parseFloat(row.other_fees || 0),
    totalFees: parseFloat(row.total_fees || 0),
    realizedPnl: row.realized_pnl ? parseFloat(row.realized_pnl) : null,
    cashImpact: row.cash_impact ? parseFloat(row.cash_impact) : null,
    balanceAfter: row.balance_after ? parseFloat(row.balance_after) : null,
    description: row.description,
    executedAt: row.executed_at,
  };
}

// ============================================================================
// Limit & Stop Order Functions
// ============================================================================

/**
 * Create a pending limit or stop order
 */
export async function createPendingOrder(params) {
  const { 
    userId, portfolioId, symbol, side, quantity, 
    orderType, // 'limit', 'stop', 'stop_limit'
    limitPrice, stopPrice,
    productType = 'stock', leverage = 1, stopLoss, takeProfit, knockoutLevel
  } = params;
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Validate order type and prices
    if (orderType === 'limit' && !limitPrice) {
      throw new Error('Limit price required for limit order');
    }
    if (orderType === 'stop' && !stopPrice) {
      throw new Error('Stop price required for stop order');
    }
    if (orderType === 'stop_limit' && (!limitPrice || !stopPrice)) {
      throw new Error('Both limit and stop price required for stop-limit order');
    }
    
    // Get portfolio
    const portfolioResult = await client.query(
      `SELECT * FROM portfolios WHERE id = $1 AND user_id = $2`,
      [portfolioId, userId]
    );
    
    if (portfolioResult.rows.length === 0) {
      throw new Error('Portfolio not found');
    }
    
    const portfolio = portfolioResult.rows[0];
    const brokerProfile = portfolio.broker_profile || 'standard';
    
    // Calculate estimated fees (using limit/stop price)
    const estimatePrice = limitPrice || stopPrice;
    const fees = calculateFees({
      productType,
      side,
      quantity,
      price: estimatePrice,
      leverage,
      brokerProfile,
    });
    
    // Reserve margin for the order
    const requiredCash = side === 'buy' 
      ? fees.marginRequired + fees.totalFees 
      : fees.totalFees;
    
    if (parseFloat(portfolio.cash_balance) < requiredCash) {
      throw new Error(`Insufficient funds. Required: ${requiredCash.toFixed(2)}, Available: ${portfolio.cash_balance}`);
    }
    
    // Create pending order
    const orderResult = await client.query(
      `INSERT INTO orders (
        portfolio_id, user_id, symbol, product_type, order_type, side,
        quantity, limit_price, stop_price, leverage, knockout_level, 
        stop_loss, take_profit, commission_fee, spread_cost, total_fees, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'pending')
      RETURNING *`,
      [
        portfolioId, userId, symbol, productType, orderType, side,
        quantity, limitPrice, stopPrice, leverage, knockoutLevel,
        stopLoss, takeProfit, fees.commission, fees.spreadCost, fees.totalFees
      ]
    );
    
    // Reserve cash for the order
    await client.query(
      `UPDATE portfolios SET cash_balance = cash_balance - $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [portfolioId, requiredCash]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      order: formatOrder(orderResult.rows[0]),
      reservedCash: requiredCash,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Create pending order error:', e);
    return {
      success: false,
      error: e.message,
    };
  } finally {
    client.release();
  }
}

/**
 * Cancel a pending order
 */
export async function cancelOrder(orderId, userId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get order
    const orderResult = await client.query(
      `SELECT o.*, p.id as portfolio_id FROM orders o
       JOIN portfolios p ON o.portfolio_id = p.id
       WHERE o.id = $1 AND o.user_id = $2 AND o.status = 'pending'`,
      [orderId, userId]
    );
    
    if (orderResult.rows.length === 0) {
      throw new Error('Order not found or not pending');
    }
    
    const order = orderResult.rows[0];
    
    // Calculate reserved cash to return
    const fees = calculateFees({
      productType: order.product_type,
      side: order.side,
      quantity: parseFloat(order.quantity),
      price: order.limit_price || order.stop_price,
      leverage: parseFloat(order.leverage),
    });
    
    const reservedCash = order.side === 'buy' 
      ? fees.marginRequired + fees.totalFees 
      : fees.totalFees;
    
    // Cancel order
    await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [orderId]
    );
    
    // Return reserved cash
    await client.query(
      `UPDATE portfolios SET cash_balance = cash_balance + $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [order.portfolio_id, reservedCash]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      returnedCash: reservedCash,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Cancel order error:', e);
    return {
      success: false,
      error: e.message,
    };
  } finally {
    client.release();
  }
}

/**
 * Get pending orders for a portfolio
 */
export async function getPendingOrders(portfolioId, userId) {
  try {
    const result = await query(
      `SELECT * FROM orders 
       WHERE portfolio_id = $1 AND user_id = $2 AND status = 'pending'
       ORDER BY created_at DESC`,
      [portfolioId, userId]
    );
    return result.rows.map(formatOrder);
  } catch (e) {
    console.error('Get pending orders error:', e);
    throw e;
  }
}

/**
 * Check and execute pending orders based on current prices
 * Call this with live price data to trigger limit/stop orders
 */
export async function checkPendingOrders(priceUpdates) {
  // priceUpdates: { symbol: currentPrice, ... }
  const client = await getClient();
  const executedOrders = [];
  
  try {
    // Get all pending orders for symbols with price updates
    const symbols = Object.keys(priceUpdates);
    if (symbols.length === 0) return executedOrders;
    
    const pendingOrders = await client.query(
      `SELECT o.*, p.broker_profile, p.cash_balance
       FROM orders o
       JOIN portfolios p ON o.portfolio_id = p.id
       WHERE o.status = 'pending' AND o.symbol = ANY($1)`,
      [symbols]
    );
    
    for (const order of pendingOrders.rows) {
      const currentPrice = priceUpdates[order.symbol];
      if (!currentPrice) continue;
      
      let shouldExecute = false;
      
      // Check if order should be triggered
      if (order.order_type === 'limit') {
        if (order.side === 'buy' && currentPrice <= parseFloat(order.limit_price)) {
          shouldExecute = true;
        } else if ((order.side === 'sell' || order.side === 'short') && currentPrice >= parseFloat(order.limit_price)) {
          shouldExecute = true;
        }
      } else if (order.order_type === 'stop') {
        if (order.side === 'buy' && currentPrice >= parseFloat(order.stop_price)) {
          shouldExecute = true;
        } else if ((order.side === 'sell' || order.side === 'short') && currentPrice <= parseFloat(order.stop_price)) {
          shouldExecute = true;
        }
      } else if (order.order_type === 'stop_limit') {
        // Stop-limit: first check stop trigger, then limit condition
        const stopTriggered = (order.side === 'buy' && currentPrice >= parseFloat(order.stop_price)) ||
                             ((order.side === 'sell' || order.side === 'short') && currentPrice <= parseFloat(order.stop_price));
        if (stopTriggered) {
          const limitMet = (order.side === 'buy' && currentPrice <= parseFloat(order.limit_price)) ||
                          ((order.side === 'sell' || order.side === 'short') && currentPrice >= parseFloat(order.limit_price));
          shouldExecute = limitMet;
        }
      }
      
      if (shouldExecute) {
        // Execute the order as a market order at current price
        const result = await executeMarketOrder({
          userId: order.user_id,
          portfolioId: order.portfolio_id,
          symbol: order.symbol,
          side: order.side,
          quantity: parseFloat(order.quantity),
          currentPrice,
          productType: order.product_type,
          leverage: parseFloat(order.leverage),
          stopLoss: order.stop_loss ? parseFloat(order.stop_loss) : undefined,
          takeProfit: order.take_profit ? parseFloat(order.take_profit) : undefined,
          knockoutLevel: order.knockout_level ? parseFloat(order.knockout_level) : undefined,
        });
        
        if (result.success) {
          // Update original pending order status
          await client.query(
            `UPDATE orders SET status = 'filled', filled_at = CURRENT_TIMESTAMP, filled_price = $2
             WHERE id = $1`,
            [order.id, currentPrice]
          );
          executedOrders.push({ orderId: order.id, ...result });
        }
      }
    }
    
    return executedOrders;
  } catch (e) {
    console.error('Check pending orders error:', e);
    return executedOrders;
  } finally {
    client.release();
  }
}

// ============================================================================
// Stop-Loss, Take-Profit & Knock-Out Automation
// ============================================================================

/**
 * Check all open positions for stop-loss, take-profit, and knock-out triggers
 * Call this with live price data
 */
export async function checkPositionTriggers(priceUpdates) {
  // priceUpdates: { symbol: currentPrice, ... }
  const client = await getClient();
  const triggeredPositions = [];
  
  try {
    const symbols = Object.keys(priceUpdates);
    if (symbols.length === 0) return triggeredPositions;
    
    // Get all open positions for symbols with price updates
    const positions = await client.query(
      `SELECT p.*, pf.broker_profile
       FROM positions p
       JOIN portfolios pf ON p.portfolio_id = pf.id
       WHERE p.is_open = true AND p.symbol = ANY($1)`,
      [symbols]
    );
    
    for (const pos of positions.rows) {
      const currentPrice = priceUpdates[pos.symbol];
      if (!currentPrice) continue;
      
      let triggerReason = null;
      
      // Check Knock-Out (highest priority)
      if (pos.knockout_level) {
        const knockoutLevel = parseFloat(pos.knockout_level);
        if (pos.side === 'long' && currentPrice <= knockoutLevel) {
          triggerReason = 'knockout';
        } else if (pos.side === 'short' && currentPrice >= knockoutLevel) {
          triggerReason = 'knockout';
        }
      }
      
      // Check Stop-Loss
      if (!triggerReason && pos.stop_loss) {
        const stopLoss = parseFloat(pos.stop_loss);
        if (pos.side === 'long' && currentPrice <= stopLoss) {
          triggerReason = 'stop_loss';
        } else if (pos.side === 'short' && currentPrice >= stopLoss) {
          triggerReason = 'stop_loss';
        }
      }
      
      // Check Take-Profit
      if (!triggerReason && pos.take_profit) {
        const takeProfit = parseFloat(pos.take_profit);
        if (pos.side === 'long' && currentPrice >= takeProfit) {
          triggerReason = 'take_profit';
        } else if (pos.side === 'short' && currentPrice <= takeProfit) {
          triggerReason = 'take_profit';
        }
      }
      
      // Check Liquidation (margin call)
      if (!triggerReason && parseFloat(pos.leverage) > 1) {
        const liquidationPrice = calculateLiquidationPrice(pos);
        if (liquidationPrice) {
          if (pos.side === 'long' && currentPrice <= liquidationPrice) {
            triggerReason = 'margin_call';
          } else if (pos.side === 'short' && currentPrice >= liquidationPrice) {
            triggerReason = 'margin_call';
          }
        }
      }
      
      if (triggerReason) {
        // Close the position
        const closePrice = triggerReason === 'knockout' ? parseFloat(pos.knockout_level) : currentPrice;
        const result = await closePosition(pos.id, pos.user_id, closePrice, triggerReason);
        
        if (result.success) {
          triggeredPositions.push({
            positionId: pos.id,
            symbol: pos.symbol,
            reason: triggerReason,
            closePrice,
            realizedPnl: result.realizedPnl,
          });
        }
      }
    }
    
    return triggeredPositions;
  } catch (e) {
    console.error('Check position triggers error:', e);
    return triggeredPositions;
  } finally {
    client.release();
  }
}

/**
 * Update position stop-loss and take-profit levels
 */
export async function updatePositionLevels(positionId, userId, { stopLoss, takeProfit }) {
  try {
    const result = await query(
      `UPDATE positions 
       SET stop_loss = COALESCE($3, stop_loss),
           take_profit = COALESCE($4, take_profit)
       WHERE id = $1 AND user_id = $2 AND is_open = true
       RETURNING *`,
      [positionId, userId, stopLoss, takeProfit]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Position not found');
    }
    
    return formatPosition(result.rows[0]);
  } catch (e) {
    console.error('Update position levels error:', e);
    throw e;
  }
}

// ============================================================================
// Portfolio Equity Curve & Snapshots
// ============================================================================

/**
 * Get equity curve data (portfolio value over time)
 */
export async function getEquityCurve(portfolioId, userId, days = 30) {
  try {
    // Verify ownership
    const portfolio = await getPortfolio(portfolioId, userId);
    if (!portfolio) {
      throw new Error('Portfolio not found');
    }
    
    const result = await query(
      `SELECT 
        DATE(recorded_at) as date,
        AVG(total_value) as total_value,
        AVG(cash_balance) as cash_balance,
        AVG(positions_value) as positions_value,
        AVG(unrealized_pnl) as unrealized_pnl,
        AVG(realized_pnl) as realized_pnl,
        AVG(margin_used) as margin_used
       FROM portfolio_snapshots
       WHERE portfolio_id = $1 AND recorded_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(recorded_at)
       ORDER BY date ASC`,
      [portfolioId]
    );
    
    // If no snapshots, return current state as single point
    if (result.rows.length === 0) {
      const metrics = await getPortfolioMetrics(portfolioId, userId);
      return [{
        date: new Date().toISOString().split('T')[0],
        totalValue: metrics.totalValue,
        cashBalance: metrics.cashBalance,
        positionsValue: metrics.positionsValue,
        unrealizedPnl: metrics.unrealizedPnl,
        realizedPnl: metrics.realizedPnl,
        marginUsed: metrics.marginUsed,
      }];
    }
    
    return result.rows.map(row => ({
      date: row.date,
      totalValue: parseFloat(row.total_value),
      cashBalance: parseFloat(row.cash_balance),
      positionsValue: parseFloat(row.positions_value || 0),
      unrealizedPnl: parseFloat(row.unrealized_pnl || 0),
      realizedPnl: parseFloat(row.realized_pnl || 0),
      marginUsed: parseFloat(row.margin_used || 0),
    }));
  } catch (e) {
    console.error('Get equity curve error:', e);
    throw e;
  }
}

/**
 * Save daily portfolio snapshots for all portfolios
 * Should be called once daily (e.g., at market close)
 */
export async function saveDailySnapshots() {
  const client = await getClient();
  try {
    // Get all active portfolios
    const portfolios = await client.query(
      `SELECT id, user_id FROM portfolios WHERE is_active = true`
    );
    
    let savedCount = 0;
    for (const portfolio of portfolios.rows) {
      try {
        await savePortfolioSnapshot(portfolio.id);
        savedCount++;
      } catch (e) {
        console.error(`Failed to save snapshot for portfolio ${portfolio.id}:`, e);
      }
    }
    
    console.log(`Saved ${savedCount} portfolio snapshots`);
    return savedCount;
  } catch (e) {
    console.error('Save daily snapshots error:', e);
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// Leaderboard Functions
// ============================================================================

/**
 * Get global leaderboard by total return
 */
export async function getLeaderboard(limit = 50, timeframe = 'all') {
  try {
    let timeCondition = '';
    if (timeframe === 'day') {
      timeCondition = "AND ps.recorded_at >= NOW() - INTERVAL '1 day'";
    } else if (timeframe === 'week') {
      timeCondition = "AND ps.recorded_at >= NOW() - INTERVAL '7 days'";
    } else if (timeframe === 'month') {
      timeCondition = "AND ps.recorded_at >= NOW() - INTERVAL '30 days'";
    }
    
    // Calculate returns based on snapshots or current state
    const result = await query(
      `WITH portfolio_stats AS (
        SELECT 
          p.id as portfolio_id,
          p.name,
          p.initial_capital,
          u.username,
          COALESCE(
            (SELECT total_value FROM portfolio_snapshots 
             WHERE portfolio_id = p.id 
             ORDER BY recorded_at DESC LIMIT 1),
            p.cash_balance
          ) as current_value,
          (SELECT COUNT(*) FROM positions WHERE portfolio_id = p.id AND is_open = false) as total_trades,
          (SELECT COUNT(*) FROM positions WHERE portfolio_id = p.id AND is_open = false AND realized_pnl > 0) as winning_trades
        FROM portfolios p
        JOIN users u ON p.user_id = u.id
        WHERE p.is_active = true
      )
      SELECT 
        portfolio_id,
        name,
        username,
        initial_capital,
        current_value,
        total_trades,
        winning_trades,
        ((current_value - initial_capital) / initial_capital * 100) as total_return_pct,
        CASE WHEN total_trades > 0 
          THEN (winning_trades::float / total_trades * 100) 
          ELSE 0 
        END as win_rate
      FROM portfolio_stats
      WHERE total_trades > 0
      ORDER BY total_return_pct DESC
      LIMIT $1`,
      [limit]
    );
    
    return result.rows.map((row, index) => ({
      rank: index + 1,
      portfolioId: row.portfolio_id,
      name: row.name,
      username: row.username,
      initialCapital: parseFloat(row.initial_capital),
      currentValue: parseFloat(row.current_value),
      totalReturnPct: parseFloat(row.total_return_pct || 0),
      totalTrades: parseInt(row.total_trades),
      winningTrades: parseInt(row.winning_trades),
      winRate: parseFloat(row.win_rate || 0),
    }));
  } catch (e) {
    console.error('Get leaderboard error:', e);
    throw e;
  }
}

/**
 * Get user's rank in leaderboard
 */
export async function getUserRank(userId) {
  try {
    const result = await query(
      `WITH ranked_portfolios AS (
        SELECT 
          p.id,
          p.user_id,
          COALESCE(
            (SELECT total_value FROM portfolio_snapshots 
             WHERE portfolio_id = p.id 
             ORDER BY recorded_at DESC LIMIT 1),
            p.cash_balance
          ) as current_value,
          p.initial_capital,
          ROW_NUMBER() OVER (
            ORDER BY (
              COALESCE(
                (SELECT total_value FROM portfolio_snapshots 
                 WHERE portfolio_id = p.id 
                 ORDER BY recorded_at DESC LIMIT 1),
                p.cash_balance
              ) - p.initial_capital
            ) / p.initial_capital DESC
          ) as rank
        FROM portfolios p
        WHERE p.is_active = true
          AND EXISTS (SELECT 1 FROM positions WHERE portfolio_id = p.id AND is_open = false)
      )
      SELECT rank, current_value, initial_capital,
             ((current_value - initial_capital) / initial_capital * 100) as total_return_pct
      FROM ranked_portfolios
      WHERE user_id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const totalParticipants = await query(
      `SELECT COUNT(DISTINCT p.id) as count
       FROM portfolios p
       WHERE p.is_active = true
         AND EXISTS (SELECT 1 FROM positions WHERE portfolio_id = p.id AND is_open = false)`
    );
    
    return {
      rank: parseInt(result.rows[0].rank),
      totalParticipants: parseInt(totalParticipants.rows[0].count),
      currentValue: parseFloat(result.rows[0].current_value),
      totalReturnPct: parseFloat(result.rows[0].total_return_pct || 0),
    };
  } catch (e) {
    console.error('Get user rank error:', e);
    throw e;
  }
}

// ============================================================================
// Backtesting / Historical Trading Functions
// ============================================================================

/**
 * Create a new backtest session with historical data
 */
export async function createBacktestSession(params) {
  const { 
    userId, 
    name, 
    startDate, 
    endDate,
    initialCapital = 100000,
    brokerProfile = 'standard',
    symbols = []
  } = params;
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Create backtest session
    const result = await client.query(
      `INSERT INTO backtest_sessions 
         (user_id, name, start_date, end_date, current_date, initial_capital, current_capital, broker_profile, symbols, status)
       VALUES ($1, $2, $3, $4, $3, $5, $5, $6, $7, 'active')
       RETURNING *`,
      [userId, name, startDate, endDate, initialCapital, brokerProfile, JSON.stringify(symbols)]
    );
    
    await client.query('COMMIT');
    
    return formatBacktestSession(result.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Create backtest session error:', e);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Get a backtest session by ID
 */
export async function getBacktestSession(sessionId, userId) {
  const result = await query(
    `SELECT * FROM backtest_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  // Get positions and orders for this session
  const [positions, orders, trades] = await Promise.all([
    query(`SELECT * FROM backtest_positions WHERE session_id = $1 ORDER BY opened_at DESC`, [sessionId]),
    query(`SELECT * FROM backtest_orders WHERE session_id = $1 ORDER BY created_at DESC`, [sessionId]),
    query(`SELECT * FROM backtest_trades WHERE session_id = $1 ORDER BY executed_at DESC`, [sessionId]),
  ]);
  
  const session = formatBacktestSession(result.rows[0]);
  session.positions = positions.rows.map(formatBacktestPosition);
  session.orders = orders.rows.map(formatBacktestOrder);
  session.trades = trades.rows.map(formatBacktestTrade);
  
  return session;
}

/**
 * Get all backtest sessions for a user
 */
export async function getUserBacktestSessions(userId) {
  const result = await query(
    `SELECT bs.*, 
       COUNT(DISTINCT bp.id) FILTER (WHERE bp.is_open = true) as open_positions,
       COUNT(DISTINCT bt.id) as total_trades
     FROM backtest_sessions bs
     LEFT JOIN backtest_positions bp ON bp.session_id = bs.id
     LEFT JOIN backtest_trades bt ON bt.session_id = bs.id
     WHERE bs.user_id = $1
     GROUP BY bs.id
     ORDER BY bs.created_at DESC`,
    [userId]
  );
  
  return result.rows.map(row => ({
    ...formatBacktestSession(row),
    openPositions: parseInt(row.open_positions || 0),
    totalTrades: parseInt(row.total_trades || 0),
  }));
}

/**
 * Execute an order in backtest mode
 */
export async function executeBacktestOrder(params) {
  const { 
    sessionId, 
    userId, 
    symbol, 
    side, 
    quantity, 
    price, // Historical price at current_date
    productType = 'stock',
    leverage = 1,
    stopLoss,
    takeProfit,
  } = params;
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get session
    const sessionResult = await client.query(
      `SELECT * FROM backtest_sessions WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [sessionId, userId]
    );
    
    if (sessionResult.rows.length === 0) {
      throw new Error('Backtest session not found or not active');
    }
    
    const session = sessionResult.rows[0];
    const brokerProfile = session.broker_profile || 'standard';
    
    // Calculate fees
    const fees = calculateFees({
      productType,
      side,
      quantity,
      price,
      leverage,
      brokerProfile,
    });
    
    // Check if we have enough capital
    const totalCost = fees.marginRequired + fees.totalFees;
    if (totalCost > parseFloat(session.current_capital)) {
      throw new Error(`Nicht genügend Kapital. Benötigt: €${totalCost.toFixed(2)}, Verfügbar: €${session.current_capital}`);
    }
    
    // Create order
    const orderResult = await client.query(
      `INSERT INTO backtest_orders 
         (session_id, user_id, symbol, side, product_type, quantity, price, leverage, status, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'filled', $9)
       RETURNING *`,
      [sessionId, userId, symbol, side, productType, quantity, price, leverage, session.current_date]
    );
    
    const order = orderResult.rows[0];
    
    // Create position
    const positionSide = side === 'buy' ? 'long' : 'short';
    const positionResult = await client.query(
      `INSERT INTO backtest_positions 
         (session_id, user_id, symbol, product_type, side, quantity, entry_price, current_price, 
          leverage, margin_used, stop_loss, take_profit, total_fees_paid, is_open, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, true, $13)
       RETURNING *`,
      [sessionId, userId, symbol, productType, positionSide, quantity, price, 
       leverage, fees.marginRequired, stopLoss, takeProfit, fees.totalFees, session.current_date]
    );
    
    // Record trade
    await client.query(
      `INSERT INTO backtest_trades 
         (session_id, user_id, order_id, position_id, symbol, side, quantity, price, fees, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [sessionId, userId, order.id, positionResult.rows[0].id, symbol, side, quantity, price, fees.totalFees, session.current_date]
    );
    
    // Update session capital
    const newCapital = parseFloat(session.current_capital) - totalCost;
    await client.query(
      `UPDATE backtest_sessions SET current_capital = $1 WHERE id = $2`,
      [newCapital, sessionId]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      order: formatBacktestOrder(order),
      position: formatBacktestPosition(positionResult.rows[0]),
      fees,
      newCapital,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Execute backtest order error:', e);
    return { success: false, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * Close a backtest position
 */
export async function closeBacktestPosition(positionId, userId, closePrice) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get position
    const posResult = await client.query(
      `SELECT bp.*, bs.broker_profile, bs.current_date
       FROM backtest_positions bp
       JOIN backtest_sessions bs ON bs.id = bp.session_id
       WHERE bp.id = $1 AND bp.user_id = $2 AND bp.is_open = true`,
      [positionId, userId]
    );
    
    if (posResult.rows.length === 0) {
      throw new Error('Position not found or already closed');
    }
    
    const position = posResult.rows[0];
    
    // Calculate P&L
    const entryPrice = parseFloat(position.entry_price);
    const quantity = parseFloat(position.quantity);
    const leverage = parseFloat(position.leverage);
    
    let pnl;
    if (position.side === 'long') {
      pnl = (closePrice - entryPrice) * quantity * leverage;
    } else {
      pnl = (entryPrice - closePrice) * quantity * leverage;
    }
    
    // Calculate closing fees
    const fees = calculateFees({
      productType: position.product_type,
      side: position.side === 'long' ? 'sell' : 'buy',
      quantity,
      price: closePrice,
      leverage,
      brokerProfile: position.broker_profile,
    });
    
    const netPnl = pnl - fees.totalFees;
    const totalFees = parseFloat(position.total_fees_paid) + fees.totalFees;
    
    // Close position
    await client.query(
      `UPDATE backtest_positions 
       SET is_open = false, current_price = $1, realized_pnl = $2, total_fees_paid = $3, closed_at = $4
       WHERE id = $5`,
      [closePrice, netPnl, totalFees, position.current_date, positionId]
    );
    
    // Update session capital
    const returnedCapital = parseFloat(position.margin_used) + netPnl;
    await client.query(
      `UPDATE backtest_sessions 
       SET current_capital = current_capital + $1
       WHERE id = $2`,
      [returnedCapital, position.session_id]
    );
    
    // Record trade
    await client.query(
      `INSERT INTO backtest_trades 
         (session_id, user_id, position_id, symbol, side, quantity, price, fees, pnl, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [position.session_id, userId, positionId, position.symbol, 
       position.side === 'long' ? 'sell' : 'buy', quantity, closePrice, fees.totalFees, netPnl, position.current_date]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      realizedPnl: netPnl,
      closingFees: fees.totalFees,
      totalFees,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Close backtest position error:', e);
    return { success: false, error: e.message };
  } finally {
    client.release();
  }
}

/**
 * Advance backtest time to a new date
 * Returns price data that should be fetched by frontend for the new date
 */
export async function advanceBacktestTime(sessionId, userId, newDate, priceUpdates = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get session
    const sessionResult = await client.query(
      `SELECT * FROM backtest_sessions WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [sessionId, userId]
    );
    
    if (sessionResult.rows.length === 0) {
      throw new Error('Backtest session not found or not active');
    }
    
    const session = sessionResult.rows[0];
    
    // Check if new date is within range
    if (new Date(newDate) > new Date(session.end_date)) {
      // Session complete
      await client.query(
        `UPDATE backtest_sessions SET status = 'completed', current_date = $1 WHERE id = $2`,
        [session.end_date, sessionId]
      );
      await client.query('COMMIT');
      return { success: true, completed: true, message: 'Backtest abgeschlossen!' };
    }
    
    // Get open positions
    const positionsResult = await client.query(
      `SELECT * FROM backtest_positions WHERE session_id = $1 AND is_open = true`,
      [sessionId]
    );
    
    const triggeredPositions = [];
    
    // Check SL/TP for each position with price updates
    for (const pos of positionsResult.rows) {
      const currentPrice = priceUpdates[pos.symbol];
      if (!currentPrice) continue;
      
      // Update position price
      await client.query(
        `UPDATE backtest_positions SET current_price = $1 WHERE id = $2`,
        [currentPrice, pos.id]
      );
      
      // Check stop-loss
      if (pos.stop_loss) {
        const sl = parseFloat(pos.stop_loss);
        if ((pos.side === 'long' && currentPrice <= sl) || (pos.side === 'short' && currentPrice >= sl)) {
          // Close at stop-loss
          const closeResult = await closeBacktestPositionInternal(client, pos, sl, userId);
          triggeredPositions.push({ 
            ...closeResult, 
            symbol: pos.symbol, 
            reason: 'stop_loss',
            triggerPrice: sl
          });
        }
      }
      
      // Check take-profit
      if (pos.take_profit) {
        const tp = parseFloat(pos.take_profit);
        if ((pos.side === 'long' && currentPrice >= tp) || (pos.side === 'short' && currentPrice <= tp)) {
          // Close at take-profit
          const closeResult = await closeBacktestPositionInternal(client, pos, tp, userId);
          triggeredPositions.push({ 
            ...closeResult, 
            symbol: pos.symbol, 
            reason: 'take_profit',
            triggerPrice: tp
          });
        }
      }
    }
    
    // Update session date
    await client.query(
      `UPDATE backtest_sessions SET current_date = $1 WHERE id = $2`,
      [newDate, sessionId]
    );
    
    // Save snapshot
    const metricsResult = await client.query(
      `SELECT current_capital FROM backtest_sessions WHERE id = $1`,
      [sessionId]
    );
    
    const openPositionsResult = await client.query(
      `SELECT SUM((current_price - entry_price) * quantity * leverage * 
                  CASE WHEN side = 'long' THEN 1 ELSE -1 END) as unrealized_pnl,
              SUM(margin_used) as margin_used
       FROM backtest_positions WHERE session_id = $1 AND is_open = true`,
      [sessionId]
    );
    
    const unrealizedPnl = parseFloat(openPositionsResult.rows[0]?.unrealized_pnl || 0);
    const marginUsed = parseFloat(openPositionsResult.rows[0]?.margin_used || 0);
    const currentCapital = parseFloat(metricsResult.rows[0].current_capital);
    const totalValue = currentCapital + marginUsed + unrealizedPnl;
    
    await client.query(
      `INSERT INTO backtest_snapshots (session_id, snapshot_date, total_value, cash_balance, unrealized_pnl, margin_used)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, newDate, totalValue, currentCapital, unrealizedPnl, marginUsed]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      newDate,
      triggeredPositions,
      metrics: {
        totalValue,
        cashBalance: currentCapital,
        unrealizedPnl,
        marginUsed,
      }
    };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Advance backtest time error:', e);
    return { success: false, error: e.message };
  } finally {
    client.release();
  }
}

// Internal helper for closing positions during time advance
async function closeBacktestPositionInternal(client, position, closePrice, userId) {
  const entryPrice = parseFloat(position.entry_price);
  const quantity = parseFloat(position.quantity);
  const leverage = parseFloat(position.leverage);
  
  let pnl;
  if (position.side === 'long') {
    pnl = (closePrice - entryPrice) * quantity * leverage;
  } else {
    pnl = (entryPrice - closePrice) * quantity * leverage;
  }
  
  const fees = calculateFees({
    productType: position.product_type,
    side: position.side === 'long' ? 'sell' : 'buy',
    quantity,
    price: closePrice,
    leverage,
    brokerProfile: 'standard',
  });
  
  const netPnl = pnl - fees.totalFees;
  const totalFees = parseFloat(position.total_fees_paid) + fees.totalFees;
  
  await client.query(
    `UPDATE backtest_positions 
     SET is_open = false, current_price = $1, realized_pnl = $2, total_fees_paid = $3, closed_at = CURRENT_DATE
     WHERE id = $4`,
    [closePrice, netPnl, totalFees, position.id]
  );
  
  const returnedCapital = parseFloat(position.margin_used) + netPnl;
  await client.query(
    `UPDATE backtest_sessions SET current_capital = current_capital + $1 WHERE id = $2`,
    [returnedCapital, position.session_id]
  );
  
  await client.query(
    `INSERT INTO backtest_trades 
       (session_id, user_id, position_id, symbol, side, quantity, price, fees, pnl, executed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)`,
    [position.session_id, userId, position.id, position.symbol, 
     position.side === 'long' ? 'sell' : 'buy', quantity, closePrice, fees.totalFees, netPnl]
  );
  
  return { positionId: position.id, realizedPnl: netPnl };
}

/**
 * Get backtest results and performance metrics
 */
export async function getBacktestResults(sessionId, userId) {
  const session = await getBacktestSession(sessionId, userId);
  if (!session) {
    return null;
  }
  
  // Get all snapshots for equity curve
  const snapshots = await query(
    `SELECT snapshot_date, total_value, cash_balance, unrealized_pnl 
     FROM backtest_snapshots 
     WHERE session_id = $1 
     ORDER BY snapshot_date`,
    [sessionId]
  );
  
  // Calculate metrics
  const closedPositions = session.positions.filter(p => !p.isOpen);
  const winners = closedPositions.filter(p => p.realizedPnl > 0);
  const losers = closedPositions.filter(p => p.realizedPnl <= 0);
  
  const totalPnl = closedPositions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0);
  const totalFees = session.positions.reduce((sum, p) => sum + (p.totalFeesPaid || 0), 0);
  
  const avgWin = winners.length > 0 
    ? winners.reduce((sum, p) => sum + p.realizedPnl, 0) / winners.length 
    : 0;
  const avgLoss = losers.length > 0 
    ? Math.abs(losers.reduce((sum, p) => sum + p.realizedPnl, 0) / losers.length) 
    : 0;
  
  return {
    session,
    equityCurve: snapshots.rows.map(s => ({
      date: s.snapshot_date,
      totalValue: parseFloat(s.total_value),
      cashBalance: parseFloat(s.cash_balance),
      unrealizedPnl: parseFloat(s.unrealized_pnl),
    })),
    metrics: {
      initialCapital: session.initialCapital,
      finalValue: session.currentCapital + session.positions
        .filter(p => p.isOpen)
        .reduce((sum, p) => sum + (p.marginUsed || 0) + ((p.currentPrice - p.entryPrice) * p.quantity * p.leverage * (p.side === 'long' ? 1 : -1)), 0),
      totalReturn: ((session.currentCapital - session.initialCapital) / session.initialCapital) * 100,
      totalTrades: closedPositions.length,
      winningTrades: winners.length,
      losingTrades: losers.length,
      winRate: closedPositions.length > 0 ? (winners.length / closedPositions.length) * 100 : 0,
      avgWin,
      avgLoss,
      profitFactor: avgLoss > 0 ? (avgWin * winners.length) / (avgLoss * losers.length) : 0,
      totalPnl,
      totalFees,
      netPnl: totalPnl - totalFees,
      maxDrawdown: calculateMaxDrawdown(snapshots.rows),
    }
  };
}

function calculateMaxDrawdown(snapshots) {
  if (snapshots.length < 2) return 0;
  
  let maxValue = parseFloat(snapshots[0].total_value);
  let maxDrawdown = 0;
  
  for (const snapshot of snapshots) {
    const value = parseFloat(snapshot.total_value);
    if (value > maxValue) {
      maxValue = value;
    }
    const drawdown = ((maxValue - value) / maxValue) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown;
}

/**
 * Delete a backtest session
 */
export async function deleteBacktestSession(sessionId, userId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Delete all related data
    await client.query(`DELETE FROM backtest_snapshots WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM backtest_trades WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM backtest_orders WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM backtest_positions WHERE session_id = $1`, [sessionId]);
    await client.query(`DELETE FROM backtest_sessions WHERE id = $1 AND user_id = $2`, [sessionId, userId]);
    
    await client.query('COMMIT');
    return { success: true };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Delete backtest session error:', e);
    return { success: false, error: e.message };
  } finally {
    client.release();
  }
}

// Formatter helpers for backtest objects
function formatBacktestSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    currentDate: row.current_date,
    initialCapital: parseFloat(row.initial_capital),
    currentCapital: parseFloat(row.current_capital),
    brokerProfile: row.broker_profile,
    symbols: typeof row.symbols === 'string' ? JSON.parse(row.symbols) : row.symbols,
    status: row.status,
    createdAt: row.created_at,
  };
}

function formatBacktestPosition(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    symbol: row.symbol,
    productType: row.product_type,
    side: row.side,
    quantity: parseFloat(row.quantity),
    entryPrice: parseFloat(row.entry_price),
    currentPrice: parseFloat(row.current_price || row.entry_price),
    leverage: parseFloat(row.leverage),
    marginUsed: parseFloat(row.margin_used || 0),
    stopLoss: row.stop_loss ? parseFloat(row.stop_loss) : null,
    takeProfit: row.take_profit ? parseFloat(row.take_profit) : null,
    totalFeesPaid: parseFloat(row.total_fees_paid || 0),
    realizedPnl: row.realized_pnl ? parseFloat(row.realized_pnl) : null,
    isOpen: row.is_open,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

function formatBacktestOrder(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    symbol: row.symbol,
    side: row.side,
    productType: row.product_type,
    quantity: parseFloat(row.quantity),
    price: parseFloat(row.price),
    leverage: parseFloat(row.leverage),
    status: row.status,
    createdAt: row.created_at,
    executedAt: row.executed_at,
  };
}

function formatBacktestTrade(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    orderId: row.order_id,
    positionId: row.position_id,
    symbol: row.symbol,
    side: row.side,
    quantity: parseFloat(row.quantity),
    price: parseFloat(row.price),
    fees: parseFloat(row.fees || 0),
    pnl: row.pnl ? parseFloat(row.pnl) : null,
    executedAt: row.executed_at,
  };
}

export default {
  BROKER_PROFILES,
  PRODUCT_TYPES,
  initializeTradingSchema,
  calculateFees,
  calculateOvernightFee,
  calculateLiquidationPrice,
  getOrCreatePortfolio,
  getUserPortfolios,
  getPortfolio,
  updatePortfolioSettings,
  setInitialCapital,
  resetPortfolio,
  getOpenPositions,
  getAllPositions,
  updatePositionPrice,
  executeMarketOrder,
  closePosition,
  processOvernightFees,
  getTransactionHistory,
  getFeeSummary,
  getPortfolioMetrics,
  savePortfolioSnapshot,
  // New features
  createPendingOrder,
  cancelOrder,
  getPendingOrders,
  checkPendingOrders,
  checkPositionTriggers,
  updatePositionLevels,
  getEquityCurve,
  saveDailySnapshots,
  getLeaderboard,
  getUserRank,
  // Backtesting features
  createBacktestSession,
  getBacktestSession,
  getUserBacktestSessions,
  executeBacktestOrder,
  closeBacktestPosition,
  advanceBacktestTime,
  getBacktestResults,
  deleteBacktestSession,
};
