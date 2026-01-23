/**
 * Trading Signal Aggregation
 * 
 * Aggregates sentiment analysis results into actionable trading signals
 * for different holding periods: 1 hour, 1 day, weeks, and long-term.
 */

import type { SentimentResult } from './sentimentAnalysis';

export type SignalStrength = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export interface TradingSignal {
  signal: SignalStrength;
  score: number; // -100 to 100
  confidence: number; // 0 to 1
  reasoning: string;
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
}

interface NewsItemWithTimestamp {
  sentimentResult: SentimentResult;
  datetime: number;
}

/**
 * Calculate trading signals from news sentiment data
 */
export function calculateTradingSignals(
  newsItems: NewsItemWithTimestamp[]
): TradingSignalSummary {
  if (newsItems.length === 0) {
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
  const avgSentiment = allNews.reduce((s, i) => s + i.sentimentResult.score, 0) / allNews.length;

  // === HOURLY Signal (1 Stunde) ===
  // Fokus: Aktuelle News, hohe Reaktivität, Momentum wichtig
  const hourlyData = recentNews.length > 0 ? recentNews : todayNews.slice(0, 3);
  const hourlySentiment = calculateWeightedSentiment(hourlyData, 2); // Schneller Verfall
  const hourlyScore = (hourlySentiment.score * 0.6 + momentum * 0.4) * 100;
  const hourly = createSignal(
    hourlyScore,
    hourlySentiment.confidence * (volatility === 'high' ? 0.7 : 1),
    volatility === 'high' 
      ? 'Hohe Volatilität - Vorsicht bei kurzfristigen Positionen'
      : momentum > 0.2 
        ? 'Positives Momentum in aktuellen News' 
        : momentum < -0.2 
          ? 'Negatives Momentum - kurzfristiger Druck möglich'
          : 'Neutrale kurzfristige Stimmung'
  );

  // === DAILY Signal (1 Tag) ===
  // Fokus: Tages-Sentiment, Volatilität berücksichtigen
  const dailySentiment = calculateWeightedSentiment(todayNews.length > 0 ? todayNews : allNews, 1);
  const dailyScore = dailySentiment.score * 100;
  const daily = createSignal(
    dailyScore,
    dailySentiment.confidence * (todayNews.length > 3 ? 1 : 0.8),
    todayNews.length === 0 
      ? 'Keine aktuellen News - basiert auf älteren Daten'
      : dailyScore > 30 
        ? 'Überwiegend positive Berichterstattung heute'
        : dailyScore < -30 
          ? 'Überwiegend negative Berichterstattung heute'
          : 'Gemischte Nachrichtenlage'
  );

  // === WEEKLY Signal (Mehrere Wochen) ===
  // Fokus: Trend über Zeit, Konsistenz der Stimmung
  const weeklySentiment = calculateWeightedSentiment(weekNews.length > 0 ? weekNews : allNews, 0.3);
  const weeklyMomentum = calculateMomentum(weekNews);
  const weeklyScore = (weeklySentiment.score * 0.7 + weeklyMomentum * 0.3) * 100;
  const weekly = createSignal(
    weeklyScore,
    weeklySentiment.confidence * (weekNews.length > 5 ? 1 : 0.75),
    weeklyMomentum > 0.15 
      ? 'Stimmung verbessert sich über die Woche'
      : weeklyMomentum < -0.15 
        ? 'Stimmung verschlechtert sich - Trend beobachten'
        : volatility === 'low' 
          ? 'Stabile Nachrichtenlage - geringes Überraschungspotenzial'
          : 'Volatile Nachrichtenlage - erhöhtes Risiko'
  );

  // === LONG-TERM Signal (Langfristig) ===
  // Fokus: Gesamtbild, fundamentale Stimmung, weniger reaktiv
  const longTermSentiment = calculateWeightedSentiment(allNews, 0.1); // Langsamer Verfall
  const consistencyBonus = volatility === 'low' ? 0.1 : volatility === 'high' ? -0.1 : 0;
  const longTermScore = (longTermSentiment.score + consistencyBonus) * 100;
  const longTerm = createSignal(
    longTermScore,
    longTermSentiment.confidence * 0.9, // Langfristig immer etwas konservativer
    allNews.length < 5 
      ? 'Begrenzte Datenbasis - mehr News für bessere Einschätzung'
      : volatility === 'high' 
        ? 'Hohe Unsicherheit - Investitionsentscheidung sorgfältig prüfen'
        : longTermScore > 20 
          ? 'Positives Gesamtbild in der Berichterstattung'
          : longTermScore < -20 
            ? 'Kritische Grundstimmung - Risiken beachten'
            : 'Ausgewogene Berichterstattung'
  );

  // Overall Bias
  const overallScore = (hourlyScore + dailyScore + weeklyScore + longTermScore) / 4;
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
    volatilityIndicator: volatility
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
    reasoning: 'Keine News-Daten verfügbar'
  };

  return {
    hourly: neutralSignal,
    daily: neutralSignal,
    weekly: neutralSignal,
    longTerm: neutralSignal,
    overallBias: 'neutral',
    newsCount: 0,
    avgSentiment: 0,
    volatilityIndicator: 'low'
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
