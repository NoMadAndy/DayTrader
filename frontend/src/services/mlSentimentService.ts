/**
 * ML Sentiment Service
 * 
 * Client for the FinBERT-based sentiment analysis API in the ML service.
 * Falls back to local keyword-based analysis if ML service is unavailable.
 */

import { analyzeSentiment as analyzeLocal, type SentimentResult } from '../utils/sentimentAnalysis';
import { log } from '../utils/logger';

const ML_SENTIMENT_API = '/api/ml/sentiment';

export interface MLSentimentResult {
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;
  confidence: number;
  probabilities: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

export interface MLSentimentStatus {
  loaded: boolean;
  error: string | null;
  device: string | null;
  model_name: string;
}

let mlServiceAvailable: boolean | null = null;

/**
 * Check if ML sentiment service is available
 */
export async function checkMLSentimentAvailable(): Promise<boolean> {
  if (mlServiceAvailable !== null) {
    return mlServiceAvailable;
  }
  
  try {
    const response = await fetch(`${ML_SENTIMENT_API}/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (response.ok) {
      const status: MLSentimentStatus = await response.json();
      mlServiceAvailable = true;
      log.info('ML Sentiment service available:', status);
      return true;
    }
  } catch (error) {
    log.info('ML Sentiment service not available, using local analysis');
  }
  
  mlServiceAvailable = false;
  return false;
}

/**
 * Get ML sentiment service status
 */
export async function getMLSentimentStatus(): Promise<MLSentimentStatus | null> {
  try {
    const response = await fetch(`${ML_SENTIMENT_API}/status`);
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Service not available
  }
  return null;
}

/**
 * Analyze sentiment using ML service (FinBERT)
 */
export async function analyzeMLSentiment(text: string): Promise<MLSentimentResult | null> {
  try {
    const response = await fetch(`${ML_SENTIMENT_API}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    if (data.success && data.result) {
      return data.result;
    }
  } catch (error) {
    log.error('ML sentiment analysis failed:', error);
  }
  
  return null;
}

/**
 * Analyze multiple texts in batch using ML service
 */
export async function analyzeMLSentimentBatch(texts: string[]): Promise<(MLSentimentResult | null)[]> {
  try {
    const response = await fetch(`${ML_SENTIMENT_API}/analyze/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    
    if (!response.ok) {
      return texts.map(() => null);
    }
    
    const data = await response.json();
    if (data.success) {
      return data.results;
    }
  } catch (error) {
    log.error('ML batch sentiment analysis failed:', error);
  }
  
  return texts.map(() => null);
}

/**
 * Analyze sentiment with ML fallback to local
 * 
 * Tries ML service first, falls back to local keyword-based analysis
 */
export async function analyzeSentimentWithFallback(
  text: string,
  preferML: boolean = true
): Promise<SentimentResult & { source: 'ml' | 'local' }> {
  if (preferML) {
    const mlResult = await analyzeMLSentiment(text);
    if (mlResult) {
      return {
        sentiment: mlResult.sentiment,
        score: mlResult.score,
        confidence: mlResult.confidence,
        keywords: { positive: [], negative: [] }, // ML doesn't return keywords
        source: 'ml',
      };
    }
  }
  
  // Fallback to local analysis
  const localResult = analyzeLocal(text);
  return {
    ...localResult,
    source: 'local',
  };
}

/**
 * Batch analyze with ML fallback to local
 */
export async function analyzeBatchWithFallback(
  texts: string[],
  preferML: boolean = true
): Promise<(SentimentResult & { source: 'ml' | 'local' })[]> {
  if (preferML) {
    // Check if ML service is available first
    const available = await checkMLSentimentAvailable();
    
    if (available) {
      const mlResults = await analyzeMLSentimentBatch(texts);
      
      // Process results, falling back to local for failed items
      return mlResults.map((mlResult, index) => {
        if (mlResult) {
          return {
            sentiment: mlResult.sentiment,
            score: mlResult.score,
            confidence: mlResult.confidence,
            keywords: { positive: [], negative: [] },
            source: 'ml' as const,
          };
        }
        
        // Fallback to local for this item
        const localResult = analyzeLocal(texts[index]);
        return {
          ...localResult,
          source: 'local' as const,
        };
      });
    }
  }
  
  // All local analysis
  return texts.map(text => ({
    ...analyzeLocal(text),
    source: 'local' as const,
  }));
}

/**
 * Reset ML service availability cache (for retry after error)
 */
export function resetMLServiceCache(): void {
  mlServiceAvailable = null;
}
