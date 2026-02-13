/**
 * User Settings Module
 * 
 * Handles user preferences, custom symbols, and API key storage.
 * All data is tenant-scoped (user_id based isolation).
 */

import { query, getClient } from './db.js';
import logger from './logger.js';

/**
 * Get user settings
 * @param {number} userId - User ID
 * @returns {Promise<object>}
 */
// Default ML settings
const DEFAULT_ML_SETTINGS = {
  sequenceLength: 60,
  forecastDays: 14,
  epochs: 100,
  learningRate: 0.001,
  useCuda: true,
  preloadFinbert: false,
};

export async function getUserSettings(userId) {
  try {
    const result = await query(
      `SELECT preferred_data_source, api_keys, ui_preferences, ml_settings, created_at, updated_at
       FROM user_settings WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Create default settings if not exist
      await query(
        `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
      return {
        preferredDataSource: 'yahoo',
        apiKeys: {},
        uiPreferences: {},
        mlSettings: { ...DEFAULT_ML_SETTINGS },
      };
    }

    const settings = result.rows[0];
    return {
      preferredDataSource: settings.preferred_data_source,
      apiKeys: settings.api_keys || {},
      uiPreferences: settings.ui_preferences || {},
      mlSettings: settings.ml_settings || { ...DEFAULT_ML_SETTINGS },
      createdAt: settings.created_at,
      updatedAt: settings.updated_at,
    };
  } catch (e) {
    logger.error('Get user settings error:', e);
    throw e;
  }
}

/**
 * Update user settings
 * @param {number} userId - User ID
 * @param {object} updates - Settings to update
 * @returns {Promise<object>}
 */
export async function updateUserSettings(userId, updates) {
  try {
    const setClauses = [];
    const values = [userId];
    let paramIndex = 2;

    if (updates.preferredDataSource !== undefined) {
      setClauses.push(`preferred_data_source = $${paramIndex++}`);
      values.push(updates.preferredDataSource);
    }

    if (updates.apiKeys !== undefined) {
      setClauses.push(`api_keys = $${paramIndex++}`);
      values.push(JSON.stringify(updates.apiKeys));
    }

    if (updates.uiPreferences !== undefined) {
      setClauses.push(`ui_preferences = $${paramIndex++}`);
      values.push(JSON.stringify(updates.uiPreferences));
    }

    if (updates.mlSettings !== undefined) {
      setClauses.push(`ml_settings = $${paramIndex++}`);
      values.push(JSON.stringify(updates.mlSettings));
    }

    if (setClauses.length === 0) {
      return getUserSettings(userId);
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');

    const result = await query(
      `UPDATE user_settings SET ${setClauses.join(', ')} 
       WHERE user_id = $1 
       RETURNING preferred_data_source, api_keys, ui_preferences, ml_settings, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      // Settings don't exist, create them
      await query(
        `INSERT INTO user_settings (user_id, preferred_data_source, api_keys, ui_preferences, ml_settings)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          updates.preferredDataSource || 'yahoo',
          JSON.stringify(updates.apiKeys || {}),
          JSON.stringify(updates.uiPreferences || {}),
          JSON.stringify(updates.mlSettings || DEFAULT_ML_SETTINGS),
        ]
      );
      return getUserSettings(userId);
    }

    const settings = result.rows[0];
    return {
      preferredDataSource: settings.preferred_data_source,
      apiKeys: settings.api_keys || {},
      uiPreferences: settings.ui_preferences || {},
      mlSettings: settings.ml_settings || { ...DEFAULT_ML_SETTINGS },
      updatedAt: settings.updated_at,
    };
  } catch (e) {
    logger.error('Update user settings error:', e);
    throw e;
  }
}

/**
 * Get custom symbols for a user
 * @param {number} userId - User ID
 * @returns {Promise<Array>}
 */
export async function getCustomSymbols(userId) {
  try {
    const result = await query(
      `SELECT id, symbol, name, created_at FROM custom_symbols 
       WHERE user_id = $1 ORDER BY symbol`,
      [userId]
    );

    return result.rows.map(row => ({
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      createdAt: row.created_at,
      isCustom: true,
    }));
  } catch (e) {
    logger.error('Get custom symbols error:', e);
    throw e;
  }
}

/**
 * Add a custom symbol for a user
 * @param {number} userId - User ID
 * @param {string} symbol - Stock symbol
 * @param {string} name - Stock name
 * @returns {Promise<object>}
 */
export async function addCustomSymbol(userId, symbol, name) {
  try {
    // Validate symbol
    const cleanSymbol = symbol.trim().toUpperCase();
    if (cleanSymbol.length === 0 || cleanSymbol.length > 20) {
      return { success: false, error: 'Invalid symbol length' };
    }

    // Check if symbol already exists for this user
    const existing = await query(
      `SELECT id FROM custom_symbols WHERE user_id = $1 AND symbol = $2`,
      [userId, cleanSymbol]
    );

    if (existing.rows.length > 0) {
      return { success: false, error: 'Symbol already exists' };
    }

    const result = await query(
      `INSERT INTO custom_symbols (user_id, symbol, name) 
       VALUES ($1, $2, $3) 
       RETURNING id, symbol, name, created_at`,
      [userId, cleanSymbol, name || cleanSymbol]
    );

    return {
      success: true,
      symbol: {
        id: result.rows[0].id,
        symbol: result.rows[0].symbol,
        name: result.rows[0].name,
        createdAt: result.rows[0].created_at,
        isCustom: true,
      },
    };
  } catch (e) {
    logger.error('Add custom symbol error:', e);
    return { success: false, error: 'Failed to add symbol' };
  }
}

/**
 * Remove a custom symbol for a user
 * @param {number} userId - User ID
 * @param {string} symbol - Stock symbol to remove
 * @returns {Promise<boolean>}
 */
export async function removeCustomSymbol(userId, symbol) {
  try {
    const result = await query(
      `DELETE FROM custom_symbols WHERE user_id = $1 AND symbol = $2`,
      [userId, symbol.toUpperCase()]
    );
    return result.rowCount > 0;
  } catch (e) {
    logger.error('Remove custom symbol error:', e);
    return false;
  }
}

/**
 * Sync custom symbols from localStorage (for migration from local to server storage)
 * @param {number} userId - User ID
 * @param {Array} symbols - Array of {symbol, name} objects
 * @returns {Promise<{added: number, skipped: number}>}
 */
export async function syncCustomSymbols(userId, symbols) {
  let added = 0;
  let skipped = 0;

  for (const { symbol, name } of symbols) {
    const result = await addCustomSymbol(userId, symbol, name);
    if (result.success) {
      added++;
    } else {
      skipped++;
    }
  }

  return { added, skipped };
}

export default {
  getUserSettings,
  updateUserSettings,
  getCustomSymbols,
  addCustomSymbol,
  removeCustomSymbol,
  syncCustomSymbols,
};
