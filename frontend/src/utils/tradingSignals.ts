/**
 * Trading Signal Aggregation
 * 
 * Aggregates multiple data sources into actionable trading signals
 * for different holding periods: 1 hour, 1 day, weeks, and long-term.
 * 
 * Data Sources:
 * - News Sentiment (keyword + optional FinBERT)
 * - Technical Indicators (RSI, MACD, Bollinger, Stochastic, SMA/EMA)
 * - ML Price Predictions (LSTM / Transformer)
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
  source: 'sentiment' | 'technical' | 'ml' | 'rl';
  score: number;
  weight: number;
  effectiveWeight: number; // Tatsächliches Gewicht nach Agreement-Anpassung
  description: string;
  agreement: 'strong' | 'moderate' | 'weak' | 'conflicting'; // Übereinstimmung mit anderen Indikatoren
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

// RL Agent Signal Interface
export interface RLSignalInput {
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  action_probabilities: {
    buy: number;
    sell: number;
    hold: number;
  };
  agent_name: string;
  agent_style?: string;
  holding_period?: string;
}

// Signal Source Configuration
export interface SignalSourceConfig {
  enableSentiment: boolean;
  enableTechnical: boolean;
  enableMLPrediction: boolean;
  enableRLAgents: boolean;
  customWeights?: {
    sentiment: number;
    technical: number;
    ml: number;
    rl: number;
  } | null;
}

export const DEFAULT_SIGNAL_CONFIG: SignalSourceConfig = {
  enableSentiment: true,
  enableTechnical: true,
  enableMLPrediction: true,
  enableRLAgents: true,  // RL Agents enabled by default
  customWeights: null,
};

// Gewichtungen pro Zeitraum (ohne RL)
// Kurzfristig: News wichtiger (Reaktivität)
// Langfristig: Technische Analyse & ML wichtiger (Trends)
const BASE_WEIGHTS = {
  hourly: { sentiment: 0.55, technical: 0.35, ml: 0.10 },
  daily: { sentiment: 0.40, technical: 0.40, ml: 0.20 },
  weekly: { sentiment: 0.25, technical: 0.45, ml: 0.30 },
  longTerm: { sentiment: 0.15, technical: 0.45, ml: 0.40 }
};

// Gewichtungen mit RL-Agenten (RL ersetzt teilweise ML)
const RL_WEIGHTS = {
  hourly: { sentiment: 0.45, technical: 0.30, ml: 0.05, rl: 0.20 },
  daily: { sentiment: 0.30, technical: 0.30, ml: 0.15, rl: 0.25 },
  weekly: { sentiment: 0.20, technical: 0.35, ml: 0.20, rl: 0.25 },
  longTerm: { sentiment: 0.10, technical: 0.35, ml: 0.30, rl: 0.25 }
};

/**
 * Get weights based on enabled sources
 */
function getWeights(
  period: 'hourly' | 'daily' | 'weekly' | 'longTerm',
  config: SignalSourceConfig
): { sentiment: number; technical: number; ml: number; rl: number } {
  // Use custom weights if provided
  if (config.customWeights) {
    return config.customWeights;
  }
  
  // Use RL weights if RL is enabled, otherwise base weights
  if (config.enableRLAgents) {
    return RL_WEIGHTS[period];
  }
  
  return { ...BASE_WEIGHTS[period], rl: 0 };
}

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
  // RL Agent signals (new)
  rlSignals?: RLSignalInput[];
  // Signal source configuration
  signalConfig?: SignalSourceConfig;
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
 * Calculate RL agent signal score
 */
function calculateRLScore(
  rlSignals: RLSignalInput[] | undefined,
  period: 'hourly' | 'daily' | 'weekly' | 'longTerm'
): { score: number; confidence: number; description: string } {
  if (!rlSignals || rlSignals.length === 0) {
    return { score: 0, confidence: 0, description: 'Keine RL-Signale' };
  }

  // Filter agents based on holding period relevance (if available)
  const periodMap: Record<string, string[]> = {
    hourly: ['scalping', 'intraday'],
    daily: ['intraday', 'swing_short'],
    weekly: ['swing_short', 'swing_medium', 'position_short'],
    longTerm: ['position_medium', 'position_long', 'investor']
  };
  
  const relevantPeriods = periodMap[period];
  
  // Prefer agents with matching holding periods, but use all if none match
  let relevantSignals = rlSignals.filter(s => 
    s.holding_period && relevantPeriods.includes(s.holding_period)
  );
  
  if (relevantSignals.length === 0) {
    relevantSignals = rlSignals;
  }

  // Filter out signals with missing or invalid data
  const validSignals = relevantSignals.filter(s => 
    s.action_probabilities && 
    typeof s.action_probabilities.buy === 'number' &&
    typeof s.action_probabilities.sell === 'number' &&
    typeof s.confidence === 'number' &&
    !isNaN(s.confidence)
  );

  if (validSignals.length === 0) {
    return { score: 0, confidence: 0, description: 'Keine gültigen RL-Signale' };
  }

  // Calculate weighted average score from all relevant signals
  let totalScore = 0;
  let totalWeight = 0;
  const agentDescriptions: string[] = [];

  validSignals.forEach(signal => {
    const { action_probabilities, confidence } = signal;
    
    // Calculate score: buy = positive, sell = negative
    const buyProb = action_probabilities.buy || 0;
    const sellProb = action_probabilities.sell || 0;
    const netDirection = buyProb - sellProb;
    const signalScore = netDirection * 100 * confidence;
    
    // Weight by confidence
    totalScore += signalScore * confidence;
    totalWeight += confidence;
    
    // Build description
    const actionLabel = signal.signal === 'buy' ? '↑' : signal.signal === 'sell' ? '↓' : '→';
    agentDescriptions.push(`${signal.agent_name}: ${actionLabel}`);
  });

  const avgScore = totalWeight > 0 ? totalScore / totalWeight : 0;
  const avgConfidence = totalWeight > 0 ? totalWeight / validSignals.length : 0;
  
  // Ensure we never return NaN
  const finalScore = isNaN(avgScore) ? 0 : avgScore;
  const finalConfidence = isNaN(avgConfidence) ? 0 : avgConfidence;
  
  const description = agentDescriptions.length > 0
    ? `RL: ${agentDescriptions.slice(0, 2).join(', ')}${agentDescriptions.length > 2 ? ` (+${agentDescriptions.length - 2})` : ''}`
    : 'Keine relevanten RL-Agenten';

  return {
    score: Math.max(-100, Math.min(100, finalScore)),
    confidence: finalConfidence,
    description
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
 * - ML Price Predictions (LSTM / Transformer)
 * - RL Agent Signals (reinforcement learning)
 */
export function calculateCombinedTradingSignals(
  input: CombinedSignalInput
): TradingSignalSummary {
  const { 
    newsItems, 
    forecast, 
    stockData, 
    mlPredictions, 
    currentPrice,
    rlSignals,
    signalConfig = DEFAULT_SIGNAL_CONFIG 
  } = input;
  
  // Check if we have any data based on enabled sources
  const hasNews = newsItems.length > 0 && signalConfig.enableSentiment;
  const hasTechnical = !!forecast && signalConfig.enableTechnical;
  const hasML = !!(mlPredictions && mlPredictions.length > 0) && signalConfig.enableMLPrediction;
  const hasRL = !!(rlSignals && rlSignals.length > 0) && signalConfig.enableRLAgents;
  
  if (!hasNews && !hasTechnical && !hasML && !hasRL) {
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
  if (hasNews) dataSourcesUsed.push('News-Sentiment');
  if (hasTechnical) dataSourcesUsed.push('Technische Analyse');
  if (hasML) dataSourcesUsed.push('ML-Prognose');
  if (hasRL) dataSourcesUsed.push(`RL-Agenten (${rlSignals!.length})`);

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

  // === Helper: Berechne Agreement zwischen Scores ===
  const calculateAgreement = (
    score: number,
    otherScores: number[]
  ): 'strong' | 'moderate' | 'weak' | 'conflicting' => {
    if (otherScores.length === 0) return 'moderate'; // Kein Vergleich möglich
    
    const sameDirection = otherScores.filter(s => 
      (score >= 0 && s >= 0) || (score < 0 && s < 0)
    ).length;
    
    const agreementRatio = sameDirection / otherScores.length;
    
    // Prüfe auch Stärke der Übereinstimmung
    const avgOtherScore = otherScores.reduce((a, b) => a + b, 0) / otherScores.length;
    const strengthMatch = Math.abs(score - avgOtherScore) < 30;
    
    if (agreementRatio === 1 && strengthMatch) return 'strong';
    if (agreementRatio >= 0.5) return 'moderate';
    if (agreementRatio > 0) return 'weak';
    return 'conflicting';
  };

  // === Helper: Agreement-Faktor für Gewichtung ===
  const getAgreementFactor = (agreement: 'strong' | 'moderate' | 'weak' | 'conflicting'): number => {
    switch (agreement) {
      case 'strong': return 1.0;      // Volle Gewichtung
      case 'moderate': return 0.85;   // Leicht reduziert
      case 'weak': return 0.6;        // Deutlich reduziert
      case 'conflicting': return 0.4; // Stark reduziert
    }
  };

  // === Helper: Kombiniere Scores mit Gewichtung ===
  const combineScores = (
    period: 'hourly' | 'daily' | 'weekly' | 'longTerm',
    sentimentScore: number,
    sentimentConfidence: number,
    sentimentDescription: string
  ): { score: number; confidence: number; contributions: SignalContribution[] } => {
    const weights = getWeights(period, signalConfig);
    
    // Erst alle Scores sammeln
    const rawScores: { source: 'sentiment' | 'technical' | 'ml' | 'rl'; score: number; weight: number; confidence: number; description: string }[] = [];
    
    // Sentiment (if enabled)
    if (hasNews) {
      const sentimentContrib = sentimentScore * 100;
      rawScores.push({
        source: 'sentiment',
        score: sentimentContrib,
        weight: weights.sentiment,
        confidence: sentimentConfidence,
        description: sentimentDescription
      });
    }

    // Technical (if enabled)
    if (hasTechnical) {
      const technical = calculateTechnicalScore(forecast, stockData, period);
      rawScores.push({
        source: 'technical',
        score: technical.score,
        weight: weights.technical,
        confidence: technical.confidence,
        description: technical.description
      });
    }

    // ML Predictions (if enabled)
    if (hasML) {
      const ml = calculateMLScore(mlPredictions, currentPrice, period);
      rawScores.push({
        source: 'ml',
        score: ml.score,
        weight: weights.ml,
        confidence: ml.confidence,
        description: ml.description
      });
    }

    // RL Agent Signals (if enabled)
    if (hasRL) {
      const rl = calculateRLScore(rlSignals, period);
      rawScores.push({
        source: 'rl',
        score: rl.score,
        weight: weights.rl,
        confidence: rl.confidence,
        description: rl.description
      });
    }

    // Jetzt Agreement berechnen und effektive Gewichte anpassen
    const periodContributions: SignalContribution[] = [];
    let totalScore = 0;
    let totalConfidence = 0;
    let activeWeightSum = 0;

    rawScores.forEach((item, idx) => {
      const otherScores = rawScores.filter((_, i) => i !== idx).map(s => s.score);
      const agreement = calculateAgreement(item.score, otherScores);
      const agreementFactor = getAgreementFactor(agreement);
      const effectiveWeight = item.weight * agreementFactor;
      
      // Skip NaN values
      if (!isNaN(item.score) && !isNaN(effectiveWeight)) {
        totalScore += item.score * effectiveWeight;
        totalConfidence += item.confidence * effectiveWeight;
        activeWeightSum += effectiveWeight;
      }
      
      periodContributions.push({
        source: item.source,
        score: isNaN(item.score) ? 0 : Math.round(item.score),
        weight: item.weight,
        effectiveWeight: effectiveWeight,
        description: item.description,
        agreement
      });
    });

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
