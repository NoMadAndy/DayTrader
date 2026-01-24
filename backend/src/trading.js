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
};
