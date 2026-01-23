/**
 * Trading Signal Aggregation
 * 
 * Aggregates multiple data sources into actionable trading signals
 * for different holding periods: 1 hour, 1 day, weeks, and long-term.
 * 
 * Data Sources:
 * - News Sentiment (keyword + optional FinBERT)
 * - Technical Indicators (RSI, MACD, Bollinger, Stochastic, SMA/EMA)
 * - ML Price Predictions (LSTM)
 */

import type { SentimentResult } from './sentimentAnalysis';
import type { ForecastResult, TrendSignal, OHLCV } from '../types/stock';

export type SignalStrength = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export interface TradingSignal {
  signal: SignalStrength;
  score: number; // -100 to 100
  confidence: number; // 0 to 1
  reasoning: string;
}

export interface SignalContribution {
  source: 'sentiment' | 'technical' | 'ml';
  score: number;
  weight: number;
  description: string;
}

export interface TradingSignalSummary {
  hourly: TradingSignal;    // 1 hour - sehr kurzfristig/Scalping
  daily: TradingSignal;     // 1 Tag - Daytrading
  weekly: TradingSignal;    // Mehrere Wochen - Swing Trading
  longTerm: TradingSignal;  // Langfristig - Investment
  overallBias: 'bullish' | 'bearish' | 'neutral';
  newsCount: number;
  avgSentiment: number;
  volatilityIndicator: 'low' | 'medium' | 'high';
  // Neue Felder für kombinierte Analyse
  dataSourcesUsed: string[];
  contributions?: {
    hourly: SignalContribution[];
    daily: SignalContribution[];
    weekly: SignalContribution[];
    longTerm: SignalContribution[];
  };
}

// ML Prediction Interface (von mlService)
export interface MLPredictionInput {
  date: string;
  day: number;
  predicted_price: number;
  confidence: number;
  change_pct: number;
}

// Gewichtungen pro Zeitraum
// Kurzfristig: News wichtiger (Reaktivität)
// Langfristig: Technische Analyse & ML wichtiger (Trends)
const WEIGHTS = {
  hourly: { sentiment: 0.55, technical: 0.35, ml: 0.10 },
  daily: { sentiment: 0.40, technical: 0.40, ml: 0.20 },
  weekly: { sentiment: 0.25, technical: 0.45, ml: 0.30 },
  longTerm: { sentiment: 0.15, technical: 0.45, ml: 0.40 }
};

interface NewsItemWithTimestamp {
  sentimentResult: SentimentResult;
  datetime: number;
}

/**
 * Combined input for multi-source signal calculation
 */
export interface CombinedSignalInput {
  newsItems: NewsItemWithTimestamp[];
  forecast?: ForecastResult;
  stockData?: OHLCV[];
  mlPredictions?: MLPredictionInput[];
  currentPrice?: number;
}

/**
 * Convert TrendSignal to numeric score (-100 to 100)
 */
function trendSignalToScore(signal: TrendSignal): number {
  switch (signal) {
    case 'STRONG_BUY': return 75;
    case 'BUY': return 35;
    case 'NEUTRAL': return 0;
    case 'SELL': return -35;
    case 'STRONG_SELL': return -75;
    default: return 0;
  }
}

/**
 * Calculate technical indicator score from ForecastResult
 */
function calculateTechnicalScore(
  forecast: ForecastResult | undefined,
  _stockData: OHLCV[] | undefined,
  period: 'hourly' | 'daily' | 'weekly' | 'longTerm'
): { score: number; confidence: number; description: string } {
  if (!forecast || forecast.indicators.length === 0) {
    return { score: 0, confidence: 0, description: 'Keine technischen Daten' };
  }

  // Verschiedene Indikatoren für verschiedene Zeiträume gewichten
  const indicatorWeights: Record<string, Record<string, number>> = {
    hourly: {
      'RSI': 0.35,
      'MACD': 0.30,
      'Stochastic Oscillator': 0.25,
      'Bollinger Bands': 0.10,
      'Trend Analysis': 0.0
    },
    daily: {
      'RSI': 0.25,
      'MACD': 0.30,
      'Stochastic Oscillator': 0.15,
      'Bollinger Bands': 0.15,
      'Trend Analysis': 0.15
    },
    weekly: {
      'RSI': 0.15,
      'MACD': 0.25,
      'Stochastic Oscillator': 0.10,
      'Bollinger Bands': 0.20,
      'Trend Analysis': 0.30
    },
    longTerm: {
      'RSI': 0.10,
      'MACD': 0.20,
      'Stochastic Oscillator': 0.05,
      'Bollinger Bands': 0.25,
      'Trend Analysis': 0.40
    }
  };

  const weights = indicatorWeights[period];
  let totalScore = 0;
  let totalWeight = 0;
  const signals: string[] = [];

  forecast.indicators.forEach(indicator => {
    const weight = weights[indicator.name] ?? 0.1;
    if (weight > 0) {
      const score = trendSignalToScore(indicator.signal);
      totalScore += score * weight;
      totalWeight += weight;
      
      if (indicator.signal !== 'NEUTRAL') {
        signals.push(`${indicator.name}: ${indicator.signal === 'STRONG_BUY' || indicator.signal === 'BUY' ? '↑' : '↓'}`);
      }
    }
  });

  const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;
  const description = signals.length > 0 
    ? signals.slice(0, 3).join(', ')
    : 'Technisch neutral';

  return {
    score: finalScore,
    confidence: forecast.confidence,
    description
  };
}

/**
 * Calculate ML prediction score
 */
function calculateMLScore(
  predictions: MLPredictionInput[] | undefined,
  currentPrice: number | undefined,
  period: 'hourly' | 'daily' | 'weekly' | 'longTerm'
): { score: number; confidence: number; description: string } {
  if (!predictions || predictions.length === 0 || !currentPrice) {
    return { score: 0, confidence: 0, description: 'Keine ML-Vorhersagen' };
  }

  // Relevante Vorhersagen basierend auf Zeitraum auswählen
  const daysToConsider: Record<string, number[]> = {
    hourly: [1],           // Nur Tag 1
    daily: [1, 2],         // Tag 1-2
    weekly: [5, 7, 10],    // Tag 5-10
    longTerm: [10, 14, 21, 30] // Ab Tag 10
  };

  const relevantDays = daysToConsider[period];
  const relevantPredictions = predictions.filter(p => {
    const day = p.day;
    return relevantDays.some(d => Math.abs(day - d) <= 2);
  });

  if (relevantPredictions.length === 0) {
    // Fallback: Nehme die nächstgelegenen Vorhersagen
    const sortedByDay = [...predictions].sort((a, b) => a.day - b.day);
    if (period === 'hourly' || period === 'daily') {
      relevantPredictions.push(...sortedByDay.slice(0, 2));
    } else {
      relevantPredictions.push(...sortedByDay.slice(-3));
    }
  }

  if (relevantPredictions.length === 0) {
    return { score: 0, confidence: 0, description: 'Keine passenden ML-Vorhersagen' };
  }

  // Durchschnittliche Preisänderung und Konfidenz berechnen
  let totalChangePct = 0;
  let totalConfidence = 0;

  relevantPredictions.forEach(pred => {
    totalChangePct += pred.change_pct;
    totalConfidence += pred.confidence;
  });

  const avgChangePct = totalChangePct / relevantPredictions.length;
  const avgConfidence = totalConfidence / relevantPredictions.length;

  // Umrechnung: Prozentuale Änderung -> Score
  // ±5% = ±75 Score (starkes Signal)
  const score = Math.max(-100, Math.min(100, avgChangePct * 15));

  const direction = avgChangePct >= 0 ? 'steigend' : 'fallend';
  const magnitude = Math.abs(avgChangePct).toFixed(1);
  
  return {
    score,
    confidence: avgConfidence,
    description: `ML: ${direction} (${avgChangePct >= 0 ? '+' : ''}${magnitude}%)`
  };
}

/**
 * Calculate trading signals from news sentiment data
 */
export function calculateTradingSignals(
  newsItems: NewsItemWithTimestamp[]
): TradingSignalSummary {
  // Wrapper für Rückwärtskompatibilität
  return calculateCombinedTradingSignals({ newsItems });
}

/**
 * Calculate combined trading signals from all available data sources
 * 
 * Combines:
 * - News Sentiment (time-weighted)
 * - Technical Indicators (RSI, MACD, Bollinger, etc.)
 * - ML Price Predictions (LSTM)
 */
export function calculateCombinedTradingSignals(
  input: CombinedSignalInput
): TradingSignalSummary {
  const { newsItems, forecast, stockData, mlPredictions, currentPrice } = input;
  
  if (newsItems.length === 0 && !forecast && !mlPredictions) {
    return createNeutralSummary();
  }

  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;
  const ONE_WEEK = 7 * ONE_DAY;

  // Kategorisiere News nach Alter
  const recentNews = newsItems.filter(n => now - n.datetime < ONE_HOUR);
  const todayNews = newsItems.filter(n => now - n.datetime < ONE_DAY);
  const weekNews = newsItems.filter(n => now - n.datetime < ONE_WEEK);
  const allNews = newsItems;

  // Track which data sources are used
  const dataSourcesUsed: string[] = [];
  if (newsItems.length > 0) dataSourcesUsed.push('News-Sentiment');
  if (forecast) dataSourcesUsed.push('Technische Analyse');
  if (mlPredictions && mlPredictions.length > 0) dataSourcesUsed.push('ML-Prognose');

  // Contributions tracking
  const contributions: TradingSignalSummary['contributions'] = {
    hourly: [],
    daily: [],
    weekly: [],
    longTerm: []
  };

  // Berechne gewichtete Sentiments (neuere News haben mehr Gewicht)
  const calculateWeightedSentiment = (items: NewsItemWithTimestamp[], decayFactor: number = 0.5) => {
    if (items.length === 0) return { score: 0, confidence: 0 };
    
    let totalWeight = 0;
    let weightedScore = 0;
    let weightedConfidence = 0;
    
    items.forEach(item => {
      const age = now - item.datetime;
      const weight = Math.exp(-age * decayFactor / ONE_DAY);
      totalWeight += weight;
      weightedScore += item.sentimentResult.score * weight;
      weightedConfidence += item.sentimentResult.confidence * weight;
    });
    
    return {
      score: weightedScore / totalWeight,
      confidence: weightedConfidence / totalWeight
    };
  };

  // Berechne Sentiment-Volatilität (Streuung der Meinungen)
  const calculateVolatility = (items: NewsItemWithTimestamp[]): 'low' | 'medium' | 'high' => {
    if (items.length < 2) return 'low';
    
    const scores = items.map(i => i.sentimentResult.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev < 0.3) return 'low';
    if (stdDev < 0.6) return 'medium';
    return 'high';
  };

  // Berechne Momentum (Trend der Stimmung)
  const calculateMomentum = (items: NewsItemWithTimestamp[]): number => {
    if (items.length < 3) return 0;
    
    // Sortiere nach Zeit (älteste zuerst)
    const sorted = [...items].sort((a, b) => a.datetime - b.datetime);
    const half = Math.floor(sorted.length / 2);
    
    const olderHalf = sorted.slice(0, half);
    const newerHalf = sorted.slice(half);
    
    const olderAvg = olderHalf.reduce((s, i) => s + i.sentimentResult.score, 0) / olderHalf.length;
    const newerAvg = newerHalf.reduce((s, i) => s + i.sentimentResult.score, 0) / newerHalf.length;
    
    return newerAvg - olderAvg; // Positiv = verbessernd, Negativ = verschlechternd
  };

  const volatility = calculateVolatility(allNews);
  const momentum = calculateMomentum(todayNews.length > 2 ? todayNews : allNews);
  
  // Gesamt-Durchschnitt
  const avgSentiment = allNews.length > 0 
    ? allNews.reduce((s, i) => s + i.sentimentResult.score, 0) / allNews.length 
    : 0;

  // === Helper: Kombiniere Scores mit Gewichtung ===
  const combineScores = (
    period: 'hourly' | 'daily' | 'weekly' | 'longTerm',
    sentimentScore: number,
    sentimentConfidence: number,
    sentimentDescription: string
  ): { score: number; confidence: number; contributions: SignalContribution[] } => {
    const weights = WEIGHTS[period];
    const periodContributions: SignalContribution[] = [];
    
    let totalScore = 0;
    let totalConfidence = 0;
    let activeWeightSum = 0;

    // Sentiment
    if (newsItems.length > 0) {
      const sentimentContrib = sentimentScore * 100;
      totalScore += sentimentContrib * weights.sentiment;
      totalConfidence += sentimentConfidence * weights.sentiment;
      activeWeightSum += weights.sentiment;
      
      periodContributions.push({
        source: 'sentiment',
        score: Math.round(sentimentContrib),
        weight: weights.sentiment,
        description: sentimentDescription
      });
    }

    // Technical
    if (forecast) {
      const technical = calculateTechnicalScore(forecast, stockData, period);
      totalScore += technical.score * weights.technical;
      totalConfidence += technical.confidence * weights.technical;
      activeWeightSum += weights.technical;
      
      periodContributions.push({
        source: 'technical',
        score: Math.round(technical.score),
        weight: weights.technical,
        description: technical.description
      });
    }

    // ML Predictions
    if (mlPredictions && mlPredictions.length > 0) {
      const ml = calculateMLScore(mlPredictions, currentPrice, period);
      totalScore += ml.score * weights.ml;
      totalConfidence += ml.confidence * weights.ml;
      activeWeightSum += weights.ml;
      
      periodContributions.push({
        source: 'ml',
        score: Math.round(ml.score),
        weight: weights.ml,
        description: ml.description
      });
    }

    // Normalisiere auf aktive Gewichte
    const normalizedScore = activeWeightSum > 0 ? totalScore / activeWeightSum : 0;
    const normalizedConfidence = activeWeightSum > 0 ? totalConfidence / activeWeightSum : 0;

    return {
      score: normalizedScore,
      confidence: normalizedConfidence,
      contributions: periodContributions
    };
  };

  // === Generiere Reasoning ===
  const generateReasoning = (
    _period: 'hourly' | 'daily' | 'weekly' | 'longTerm',
    contribs: SignalContribution[],
    newsSpecificReasoning: string
  ): string => {
    if (contribs.length === 0) return newsSpecificReasoning;
    
    if (contribs.length === 1) {
      return `${contribs[0].description}`;
    }

    // Finde dominanten Faktor
    const sorted = [...contribs].sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight));
    const dominant = sorted[0];
    
    const sourceNames: Record<string, string> = {
      sentiment: 'News',
      technical: 'Technisch',
      ml: 'ML'
    };

    const agreementCount = contribs.filter(c => 
      (c.score >= 0 && sorted[0].score >= 0) || (c.score < 0 && sorted[0].score < 0)
    ).length;

    if (agreementCount === contribs.length) {
      return `Alle Quellen übereinstimmend (${sourceNames[dominant.source]} führend: ${dominant.description})`;
    } else if (agreementCount >= contribs.length / 2) {
      return `Mehrheit ${dominant.score >= 0 ? 'positiv' : 'negativ'} (${dominant.description})`;
    } else {
      return `Gemischte Signale - ${sourceNames[dominant.source]}: ${dominant.description}`;
    }
  };

  // === HOURLY Signal (1 Stunde) ===
  const hourlyData = recentNews.length > 0 ? recentNews : todayNews.slice(0, 3);
  const hourlySentiment = calculateWeightedSentiment(hourlyData, 2);
  const hourlyNewsDescription = volatility === 'high' 
    ? 'Hohe News-Volatilität'
    : momentum > 0.2 ? 'Positives Momentum' : momentum < -0.2 ? 'Negatives Momentum' : 'Stabile News';
  
  const hourlyCombined = combineScores('hourly', 
    hourlySentiment.score + momentum * 0.4, 
    hourlySentiment.confidence * (volatility === 'high' ? 0.7 : 1),
    hourlyNewsDescription
  );
  contributions.hourly = hourlyCombined.contributions;
  
  const hourly = createSignal(
    hourlyCombined.score,
    hourlyCombined.confidence,
    generateReasoning('hourly', hourlyCombined.contributions, hourlyNewsDescription)
  );

  // === DAILY Signal (1 Tag) ===
  const dailySentiment = calculateWeightedSentiment(todayNews.length > 0 ? todayNews : allNews, 1);
  const dailyNewsDescription = todayNews.length === 0 
    ? 'Keine aktuellen News'
    : dailySentiment.score > 0.3 ? 'Positive Tagespresse' 
    : dailySentiment.score < -0.3 ? 'Negative Tagespresse' : 'Gemischte News';
  
  const dailyCombined = combineScores('daily',
    dailySentiment.score,
    dailySentiment.confidence * (todayNews.length > 3 ? 1 : 0.8),
    dailyNewsDescription
  );
  contributions.daily = dailyCombined.contributions;
  
  const daily = createSignal(
    dailyCombined.score,
    dailyCombined.confidence,
    generateReasoning('daily', dailyCombined.contributions, dailyNewsDescription)
  );

  // === WEEKLY Signal (Mehrere Wochen) ===
  const weeklySentiment = calculateWeightedSentiment(weekNews.length > 0 ? weekNews : allNews, 0.3);
  const weeklyMomentum = calculateMomentum(weekNews);
  const weeklyNewsDescription = weeklyMomentum > 0.15 
    ? 'Stimmung verbessert sich' 
    : weeklyMomentum < -0.15 ? 'Stimmung verschlechtert sich' : 'Stabile Wochenstimmung';
  
  const weeklyCombined = combineScores('weekly',
    weeklySentiment.score * 0.7 + weeklyMomentum * 0.3,
    weeklySentiment.confidence * (weekNews.length > 5 ? 1 : 0.75),
    weeklyNewsDescription
  );
  contributions.weekly = weeklyCombined.contributions;
  
  const weekly = createSignal(
    weeklyCombined.score,
    weeklyCombined.confidence,
    generateReasoning('weekly', weeklyCombined.contributions, weeklyNewsDescription)
  );

  // === LONG-TERM Signal (Langfristig) ===
  const longTermSentiment = calculateWeightedSentiment(allNews, 0.1);
  const consistencyBonus = volatility === 'low' ? 0.1 : volatility === 'high' ? -0.1 : 0;
  const longTermNewsDescription = allNews.length < 5 
    ? 'Begrenzte Datenbasis'
    : volatility === 'high' ? 'Hohe Unsicherheit' 
    : longTermSentiment.score > 0.2 ? 'Positives Gesamtbild' 
    : longTermSentiment.score < -0.2 ? 'Kritische Grundstimmung' : 'Ausgewogen';
  
  const longTermCombined = combineScores('longTerm',
    longTermSentiment.score + consistencyBonus,
    longTermSentiment.confidence * 0.9,
    longTermNewsDescription
  );
  contributions.longTerm = longTermCombined.contributions;
  
  const longTerm = createSignal(
    longTermCombined.score,
    longTermCombined.confidence,
    generateReasoning('longTerm', longTermCombined.contributions, longTermNewsDescription)
  );

  // Overall Bias
  const overallScore = (hourly.score + daily.score + weekly.score + longTerm.score) / 4;
  const overallBias: 'bullish' | 'bearish' | 'neutral' = 
    overallScore > 15 ? 'bullish' : overallScore < -15 ? 'bearish' : 'neutral';

  return {
    hourly,
    daily,
    weekly,
    longTerm,
    overallBias,
    newsCount: allNews.length,
    avgSentiment: Math.round(avgSentiment * 100) / 100,
    volatilityIndicator: volatility,
    dataSourcesUsed,
    contributions
  };
}

/**
 * Create a trading signal from score and confidence
 */
function createSignal(score: number, confidence: number, reasoning: string): TradingSignal {
  // Clamp score to -100 to 100
  const clampedScore = Math.max(-100, Math.min(100, score));
  
  let signal: SignalStrength;
  if (clampedScore >= 50) {
    signal = 'STRONG_BUY';
  } else if (clampedScore >= 20) {
    signal = 'BUY';
  } else if (clampedScore <= -50) {
    signal = 'STRONG_SELL';
  } else if (clampedScore <= -20) {
    signal = 'SELL';
  } else {
    signal = 'HOLD';
  }

  return {
    signal,
    score: Math.round(clampedScore),
    confidence: Math.round(confidence * 100) / 100,
    reasoning
  };
}

/**
 * Create neutral summary when no data available
 */
function createNeutralSummary(): TradingSignalSummary {
  const neutralSignal: TradingSignal = {
    signal: 'HOLD',
    score: 0,
    confidence: 0,
    reasoning: 'Keine Daten verfügbar'
  };

  return {
    hourly: neutralSignal,
    daily: neutralSignal,
    weekly: neutralSignal,
    longTerm: neutralSignal,
    overallBias: 'neutral',
    newsCount: 0,
    avgSentiment: 0,
    volatilityIndicator: 'low',
    dataSourcesUsed: [],
    contributions: undefined
  };
}

/**
 * Get display properties for a signal
 */
export function getSignalDisplay(signal: SignalStrength): {
  label: string;
  labelDe: string;
  emoji: string;
  color: string;
  bgColor: string;
} {
  switch (signal) {
    case 'STRONG_BUY':
      return {
        label: 'Strong Buy',
        labelDe: 'Stark Kaufen',
        emoji: '🚀',
        color: 'text-green-400',
        bgColor: 'bg-green-500/20'
      };
    case 'BUY':
      return {
        label: 'Buy',
        labelDe: 'Kaufen',
        emoji: '📈',
        color: 'text-green-400',
        bgColor: 'bg-green-500/15'
      };
    case 'HOLD':
      return {
        label: 'Hold',
        labelDe: 'Halten',
        emoji: '➖',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/15'
      };
    case 'SELL':
      return {
        label: 'Sell',
        labelDe: 'Verkaufen',
        emoji: '📉',
        color: 'text-red-400',
        bgColor: 'bg-red-500/15'
      };
    case 'STRONG_SELL':
      return {
        label: 'Strong Sell',
        labelDe: 'Stark Verkaufen',
        emoji: '🔻',
        color: 'text-red-400',
        bgColor: 'bg-red-500/20'
      };
  }
}

/**
 * Get time period labels
 */
export function getTimePeriodLabel(period: 'hourly' | 'daily' | 'weekly' | 'longTerm'): {
  label: string;
  description: string;
} {
  switch (period) {
    case 'hourly':
      return { label: '1 Stunde', description: 'Scalping / Kurzfristig' };
    case 'daily':
      return { label: '1 Tag', description: 'Daytrading' };
    case 'weekly':
      return { label: 'Wochen', description: 'Swing Trading' };
    case 'longTerm':
      return { label: 'Langfristig', description: 'Investment' };
  }
}
