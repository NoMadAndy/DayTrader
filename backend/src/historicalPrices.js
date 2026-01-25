/**
 * Historical Prices Service
 * 
 * Manages long-term historical price data in the database.
 * Data is shared across all users for consistency in backtesting.
 * 
 * Data source: Yahoo Finance (supports up to 20+ years of data via download)
 */

import { query, getClient } from './db.js';
import fetch from 'node-fetch';

// Yahoo Finance download URL for full historical data
const YAHOO_DOWNLOAD_URL = 'https://query1.finance.yahoo.com/v7/finance/download';

/**
 * Get historical prices from database
 * @param {string} symbol - Stock symbol
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of price records
 */
export async function getHistoricalPrices(symbol, startDate, endDate) {
  const result = await query(
    `SELECT date, open, high, low, close, volume
     FROM historical_prices
     WHERE symbol = $1 AND date >= $2 AND date <= $3
     ORDER BY date ASC`,
    [symbol.toUpperCase(), startDate, endDate]
  );
  
  return result.rows.map(row => ({
    date: row.date.toISOString().split('T')[0],
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseInt(row.volume) || 0,
  }));
}

/**
 * Check if historical data exists for a symbol and date range
 * @param {string} symbol - Stock symbol
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<{hasData: boolean, existingDates: number, requiredDates: number}>}
 */
export async function checkHistoricalDataAvailability(symbol, startDate, endDate) {
  // Count existing records
  const countResult = await query(
    `SELECT COUNT(*) as count
     FROM historical_prices
     WHERE symbol = $1 AND date >= $2 AND date <= $3`,
    [symbol.toUpperCase(), startDate, endDate]
  );
  
  const existingDates = parseInt(countResult.rows[0].count);
  
  // Estimate required trading days (roughly 252 per year, minus weekends/holidays)
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  const estimatedTradingDays = Math.ceil(daysDiff * 0.7); // ~70% are trading days
  
  // Consider data available if we have at least 80% of expected trading days
  const hasData = existingDates >= estimatedTradingDays * 0.8;
  
  return {
    hasData,
    existingDates,
    requiredDates: estimatedTradingDays,
  };
}

/**
 * Fetch historical data from Yahoo Finance and store in database
 * Uses the download endpoint which provides full history (20+ years)
 * @param {string} symbol - Stock symbol
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<{success: boolean, recordsInserted: number, error?: string}>}
 */
export async function fetchAndStoreHistoricalData(symbol, startDate, endDate) {
  const upperSymbol = symbol.toUpperCase();
  
  try {
    // Convert dates to Unix timestamps
    const period1 = Math.floor(new Date(startDate).getTime() / 1000);
    const period2 = Math.floor(new Date(endDate).getTime() / 1000) + 86400; // +1 day to include end date
    
    // Fetch from Yahoo Finance download endpoint (CSV format, supports full history)
    const url = `${YAHOO_DOWNLOAD_URL}/${upperSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
    
    console.log(`[HistoricalPrices] Fetching ${upperSymbol} from ${startDate} to ${endDate}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[HistoricalPrices] Yahoo Finance error: ${response.status} - ${errorText}`);
      return { success: false, recordsInserted: 0, error: `Yahoo Finance error: ${response.status}` };
    }
    
    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    
    if (lines.length < 2) {
      return { success: false, recordsInserted: 0, error: 'No data returned from Yahoo Finance' };
    }
    
    // Parse CSV (skip header)
    // Format: Date,Open,High,Low,Close,Adj Close,Volume
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 7) {
        const [date, open, high, low, close, adjClose, volume] = parts;
        
        // Skip if any value is null or invalid
        if (open === 'null' || high === 'null' || low === 'null' || close === 'null') {
          continue;
        }
        
        records.push({
          date,
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          adjClose: parseFloat(adjClose),
          volume: parseInt(volume) || 0,
        });
      }
    }
    
    if (records.length === 0) {
      return { success: false, recordsInserted: 0, error: 'No valid price records found' };
    }
    
    console.log(`[HistoricalPrices] Parsed ${records.length} records for ${upperSymbol}`);
    
    // Batch insert into database using upsert
    const client = await getClient();
    let insertedCount = 0;
    
    try {
      await client.query('BEGIN');
      
      // Insert in batches of 1000
      const batchSize = 1000;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        
        // Build multi-row insert with ON CONFLICT DO UPDATE
        const values = [];
        const placeholders = [];
        let paramIndex = 1;
        
        for (const record of batch) {
          placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`);
          values.push(
            upperSymbol,
            record.date,
            record.open,
            record.high,
            record.low,
            record.close,
            record.volume,
            record.adjClose
          );
          paramIndex += 8;
        }
        
        const insertQuery = `
          INSERT INTO historical_prices (symbol, date, open, high, low, close, volume, adj_close)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (symbol, date) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            adj_close = EXCLUDED.adj_close
        `;
        
        const result = await client.query(insertQuery, values);
        insertedCount += batch.length;
      }
      
      await client.query('COMMIT');
      console.log(`[HistoricalPrices] Stored ${insertedCount} records for ${upperSymbol}`);
      
      return { success: true, recordsInserted: insertedCount };
    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error(`[HistoricalPrices] Database error:`, dbError);
      return { success: false, recordsInserted: 0, error: dbError.message };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`[HistoricalPrices] Fetch error:`, error);
    return { success: false, recordsInserted: 0, error: error.message };
  }
}

/**
 * Get symbols with available historical data
 * @returns {Promise<Array>} List of symbols with data range info
 */
export async function getAvailableSymbols() {
  const result = await query(
    `SELECT symbol, MIN(date) as min_date, MAX(date) as max_date, COUNT(*) as record_count
     FROM historical_prices
     GROUP BY symbol
     ORDER BY symbol`
  );
  
  return result.rows.map(row => ({
    symbol: row.symbol,
    minDate: row.min_date.toISOString().split('T')[0],
    maxDate: row.max_date.toISOString().split('T')[0],
    recordCount: parseInt(row.record_count),
  }));
}

/**
 * Delete historical data for a symbol
 * @param {string} symbol - Stock symbol
 * @returns {Promise<number>} Number of deleted records
 */
export async function deleteHistoricalData(symbol) {
  const result = await query(
    'DELETE FROM historical_prices WHERE symbol = $1',
    [symbol.toUpperCase()]
  );
  return result.rowCount;
}

export default {
  getHistoricalPrices,
  checkHistoricalDataAvailability,
  fetchAndStoreHistoricalData,
  getAvailableSymbols,
  deleteHistoricalData,
};
