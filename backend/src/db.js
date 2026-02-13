/**
 * PostgreSQL Database Connection Module
 * 
 * Handles database connection pooling and provides helper functions
 * for tenant-scoped queries.
 */

import pg from 'pg';
import logger from './logger.js';
const { Pool } = pg;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20, // Max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Log pool errors
pool.on('error', (err) => {
  logger.error('Unexpected database pool error:', err);
});

/**
 * Execute a query with parameters
 * @param {string} text - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.info('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
  return result;
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<pg.PoolClient>}
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Initialize database schema
 * Creates all necessary tables if they don't exist
 */
export async function initializeDatabase() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        username VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT true
      );
    `);

    // Create sessions table for token management
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) UNIQUE NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        user_agent VARCHAR(500),
        ip_address VARCHAR(45)
      );
    `);

    // Create user_settings table for preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        preferred_data_source VARCHAR(50) DEFAULT 'yahoo',
        api_keys JSONB DEFAULT '{}',
        ui_preferences JSONB DEFAULT '{}',
        ml_settings JSONB DEFAULT '{"sequenceLength": 60, "forecastDays": 14, "epochs": 100, "learningRate": 0.001, "useCuda": false, "preloadFinbert": false}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Add ml_settings column if it doesn't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_settings' AND column_name = 'ml_settings') THEN
          ALTER TABLE user_settings ADD COLUMN ml_settings JSONB DEFAULT '{"sequenceLength": 60, "forecastDays": 14, "epochs": 100, "learningRate": 0.001, "useCuda": false, "preloadFinbert": false}';
        END IF;
      END $$;
    `);

    // Create custom_symbols table for user's custom stock symbols
    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_symbols (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(20) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, symbol)
      );
    `);

    // Create historical_prices table for cached long-term price data
    // This data is shared across all users for consistency
    await client.query(`
      CREATE TABLE IF NOT EXISTS historical_prices (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        date DATE NOT NULL,
        open DECIMAL(15, 4) NOT NULL,
        high DECIMAL(15, 4) NOT NULL,
        low DECIMAL(15, 4) NOT NULL,
        close DECIMAL(15, 4) NOT NULL,
        volume BIGINT DEFAULT 0,
        adj_close DECIMAL(15, 4),
        source VARCHAR(50) DEFAULT 'yahoo',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, date)
      );
    `);

    // Create indexes for better query performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_custom_symbols_user_id ON custom_symbols(user_id);
      CREATE INDEX IF NOT EXISTS idx_historical_prices_symbol ON historical_prices(symbol);
      CREATE INDEX IF NOT EXISTS idx_historical_prices_symbol_date ON historical_prices(symbol, date);
      CREATE INDEX IF NOT EXISTS idx_historical_prices_date ON historical_prices(date);
    `);

    await client.query('COMMIT');
    logger.info('Database schema initialized successfully');
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('Database initialization error:', e);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions() {
  try {
    const result = await query(
      'DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP'
    );
    if (result.rowCount > 0) {
      logger.info(`Cleaned up ${result.rowCount} expired sessions`);
    }
  } catch (e) {
    logger.error('Session cleanup error:', e);
  }
}

/**
 * Check database health
 * @returns {Promise<boolean>}
 */
export async function checkHealth() {
  try {
    await query('SELECT 1');
    return true;
  } catch (e) {
    logger.error('Database health check failed:', e);
    return false;
  }
}

export default {
  query,
  getClient,
  initializeDatabase,
  cleanupExpiredSessions,
  checkHealth,
  pool,
};
