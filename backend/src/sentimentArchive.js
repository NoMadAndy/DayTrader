/**
 * Sentiment Archive Service
 * 
 * Stores historical sentiment data persistently in the database.
 * This allows tracking sentiment trends over time and reduces API calls
 * for frequently analyzed symbols.
 * 
 * Data is shared across all users (sentiment is public market data).
 */

import { query, getClient } from './db.js';

/**
 * Initialize the sentiment archive table
 */
export async function initializeSentimentArchive() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Create sentiment_archive table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sentiment_archive (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL,
        sentiment VARCHAR(20) NOT NULL,
        score DECIMAL(6, 4) NOT NULL,
        confidence DECIMAL(6, 4) NOT NULL,
        news_count INTEGER DEFAULT 0,
        positive_count INTEGER DEFAULT 0,
        negative_count INTEGER DEFAULT 0,
        neutral_count INTEGER DEFAULT 0,
        sources JSONB DEFAULT '[]',
        news_headlines JSONB DEFAULT '[]',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(symbol, analyzed_at)
      );
    `);
    
    // Create indexes for efficient querying
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sentiment_archive_symbol ON sentiment_archive(symbol);
      CREATE INDEX IF NOT EXISTS idx_sentiment_archive_analyzed_at ON sentiment_archive(analyzed_at);
      CREATE INDEX IF NOT EXISTS idx_sentiment_archive_symbol_date ON sentiment_archive(symbol, analyzed_at DESC);
    `);
    
    await client.query('COMMIT');
    console.log('[SentimentArchive] Table initialized successfully');
  } catch (e) {
    await client.query('ROLLBACK');
    // Table might already exist, which is fine
    if (!e.message.includes('already exists')) {
      console.error('[SentimentArchive] Initialization error:', e.message);
    }
  } finally {
    client.release();
  }
}

/**
 * Archive a sentiment analysis result
 * @param {Object} sentimentData - The sentiment analysis result
 * @returns {Promise<boolean>} Success status
 */
export async function archiveSentiment(sentimentData) {
  try {
    const {
      symbol,
      sentiment,
      score,
      confidence,
      news_count = 0,
      positive_count = 0,
      negative_count = 0,
      neutral_count = 0,
      sources = [],
    } = sentimentData;
    
    // Round to nearest hour for deduplication (avoid too many entries)
    const analyzedAt = new Date();
    analyzedAt.setMinutes(0, 0, 0);
    
    // Extract headlines from sources
    const headlines = sources.map(s => s.headline).filter(Boolean);
    
    await query(
      `INSERT INTO sentiment_archive 
       (symbol, analyzed_at, sentiment, score, confidence, news_count, positive_count, negative_count, neutral_count, sources, news_headlines)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (symbol, analyzed_at) DO UPDATE SET
         sentiment = EXCLUDED.sentiment,
         score = EXCLUDED.score,
         confidence = EXCLUDED.confidence,
         news_count = EXCLUDED.news_count,
         positive_count = EXCLUDED.positive_count,
         negative_count = EXCLUDED.negative_count,
         neutral_count = EXCLUDED.neutral_count,
         sources = EXCLUDED.sources,
         news_headlines = EXCLUDED.news_headlines`,
      [
        symbol.toUpperCase(),
        analyzedAt.toISOString(),
        sentiment,
        score,
        confidence,
        news_count,
        positive_count,
        negative_count,
        neutral_count,
        JSON.stringify(sources),
        JSON.stringify(headlines),
      ]
    );
    
    console.log(`[SentimentArchive] Archived sentiment for ${symbol}: ${sentiment} (${score})`);
    return true;
  } catch (e) {
    console.error('[SentimentArchive] Error archiving sentiment:', e.message);
    return false;
  }
}

/**
 * Get archived sentiment history for a symbol
 * @param {string} symbol - Stock symbol
 * @param {number} days - Number of days of history (default 30)
 * @returns {Promise<Array>} Array of sentiment records
 */
export async function getSentimentHistory(symbol, days = 30) {
  try {
    const result = await query(
      `SELECT symbol, analyzed_at, sentiment, score, confidence, news_count,
              positive_count, negative_count, neutral_count, sources
       FROM sentiment_archive
       WHERE symbol = $1 
         AND analyzed_at >= NOW() - INTERVAL '1 day' * $2
       ORDER BY analyzed_at DESC`,
      [symbol.toUpperCase(), days]
    );
    
    return result.rows.map(row => ({
      symbol: row.symbol,
      analyzedAt: row.analyzed_at,
      sentiment: row.sentiment,
      score: parseFloat(row.score),
      confidence: parseFloat(row.confidence),
      newsCount: row.news_count,
      positiveCount: row.positive_count,
      negativeCount: row.negative_count,
      neutralCount: row.neutral_count,
      sources: row.sources || [],
    }));
  } catch (e) {
    console.error('[SentimentArchive] Error getting history:', e.message);
    return [];
  }
}

/**
 * Get latest archived sentiment for a symbol
 * @param {string} symbol - Stock symbol
 * @returns {Promise<Object|null>} Latest sentiment record or null
 */
export async function getLatestSentiment(symbol) {
  try {
    const result = await query(
      `SELECT symbol, analyzed_at, sentiment, score, confidence, news_count,
              positive_count, negative_count, neutral_count, sources
       FROM sentiment_archive
       WHERE symbol = $1
       ORDER BY analyzed_at DESC
       LIMIT 1`,
      [symbol.toUpperCase()]
    );
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      symbol: row.symbol,
      analyzedAt: row.analyzed_at,
      sentiment: row.sentiment,
      score: parseFloat(row.score),
      confidence: parseFloat(row.confidence),
      newsCount: row.news_count,
      positiveCount: row.positive_count,
      negativeCount: row.negative_count,
      neutralCount: row.neutral_count,
      sources: row.sources || [],
    };
  } catch (e) {
    console.error('[SentimentArchive] Error getting latest:', e.message);
    return null;
  }
}

/**
 * Get sentiment trend summary for a symbol
 * @param {string} symbol - Stock symbol
 * @param {number} days - Number of days to analyze
 * @returns {Promise<Object>} Trend summary
 */
export async function getSentimentTrend(symbol, days = 7) {
  try {
    const result = await query(
      `SELECT 
         COUNT(*) as total_entries,
         AVG(score) as avg_score,
         AVG(confidence) as avg_confidence,
         SUM(positive_count) as total_positive,
         SUM(negative_count) as total_negative,
         SUM(neutral_count) as total_neutral,
         MIN(score) as min_score,
         MAX(score) as max_score,
         MIN(analyzed_at) as earliest,
         MAX(analyzed_at) as latest
       FROM sentiment_archive
       WHERE symbol = $1 
         AND analyzed_at >= NOW() - INTERVAL '1 day' * $2`,
      [symbol.toUpperCase(), days]
    );
    
    if (result.rows.length === 0 || result.rows[0].total_entries === '0') {
      return { symbol: symbol.toUpperCase(), hasData: false };
    }
    
    const row = result.rows[0];
    const avgScore = parseFloat(row.avg_score) || 0;
    
    // Determine trend
    let trend = 'neutral';
    if (avgScore > 0.1) trend = 'bullish';
    else if (avgScore < -0.1) trend = 'bearish';
    
    return {
      symbol: symbol.toUpperCase(),
      hasData: true,
      days,
      totalEntries: parseInt(row.total_entries),
      avgScore: parseFloat(avgScore.toFixed(4)),
      avgConfidence: parseFloat((parseFloat(row.avg_confidence) || 0).toFixed(4)),
      minScore: parseFloat(row.min_score),
      maxScore: parseFloat(row.max_score),
      trend,
      totalPositive: parseInt(row.total_positive) || 0,
      totalNegative: parseInt(row.total_negative) || 0,
      totalNeutral: parseInt(row.total_neutral) || 0,
      dateRange: {
        earliest: row.earliest,
        latest: row.latest,
      },
    };
  } catch (e) {
    console.error('[SentimentArchive] Error getting trend:', e.message);
    return { symbol: symbol.toUpperCase(), hasData: false, error: e.message };
  }
}

/**
 * Get all symbols with archived sentiment data
 * @returns {Promise<Array>} List of symbols with data summary
 */
export async function getArchivedSymbols() {
  try {
    const result = await query(
      `SELECT 
         symbol,
         COUNT(*) as entry_count,
         MIN(analyzed_at) as earliest,
         MAX(analyzed_at) as latest,
         AVG(score) as avg_score
       FROM sentiment_archive
       GROUP BY symbol
       ORDER BY MAX(analyzed_at) DESC`
    );
    
    return result.rows.map(row => ({
      symbol: row.symbol,
      entryCount: parseInt(row.entry_count),
      earliest: row.earliest,
      latest: row.latest,
      avgScore: parseFloat((parseFloat(row.avg_score) || 0).toFixed(4)),
    }));
  } catch (e) {
    console.error('[SentimentArchive] Error getting symbols:', e.message);
    return [];
  }
}

/**
 * Clean up old sentiment archive entries
 * @param {number} daysToKeep - Keep entries from last N days (default 90)
 * @returns {Promise<number>} Number of deleted entries
 */
export async function cleanupOldEntries(daysToKeep = 90) {
  try {
    const result = await query(
      `DELETE FROM sentiment_archive 
       WHERE analyzed_at < NOW() - INTERVAL '1 day' * $1`,
      [daysToKeep]
    );
    
    if (result.rowCount > 0) {
      console.log(`[SentimentArchive] Cleaned up ${result.rowCount} old entries`);
    }
    
    return result.rowCount;
  } catch (e) {
    console.error('[SentimentArchive] Cleanup error:', e.message);
    return 0;
  }
}

export default {
  initializeSentimentArchive,
  archiveSentiment,
  getSentimentHistory,
  getLatestSentiment,
  getSentimentTrend,
  getArchivedSymbols,
  cleanupOldEntries,
};
