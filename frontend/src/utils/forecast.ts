/**
 * AI-Powered Forecast Engine
 * 
 * This module combines multiple technical indicators to generate
 * a comprehensive market forecast with documented reasoning.
 * 
 * The forecast considers:
 * 1. Trend Analysis (SMA, EMA crossovers)
 * 2. Momentum Analysis (RSI, MACD, Stochastic)
 * 3. Volatility Analysis (Bollinger Bands, ATR)
 * 4. Volume Analysis (OBV, VWAP)
 * 5. Support/Resistance Levels
 */

import type { OHLCV, TrendSignal, IndicatorAnalysis, ForecastResult } from '../types/stock';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateATR,
  calculateOBV,
  calculateVWAP,
  findSupportResistance
} from './indicators';

/**
 * Convert a numeric score (-2 to 2) to a TrendSignal
 */
function scoreToSignal(score: number): TrendSignal {
  if (score >= 1.5) return 'STRONG_BUY';
  if (score >= 0.5) return 'BUY';
  if (score <= -1.5) return 'STRONG_SELL';
  if (score <= -0.5) return 'SELL';
  return 'NEUTRAL';
}

/**
 * Convert a TrendSignal to a numeric score
 */
function signalToScore(signal: TrendSignal): number {
  switch (signal) {
    case 'STRONG_BUY': return 2;
    case 'BUY': return 1;
    case 'NEUTRAL': return 0;
    case 'SELL': return -1;
    case 'STRONG_SELL': return -2;
  }
}

/**
 * Analyze Moving Average Crossovers
 */
function analyzeTrend(data: OHLCV[]): IndicatorAnalysis {
  const sma20 = calculateSMA(data, 20);
  const sma50 = calculateSMA(data, 50);
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  
  const currentPrice = data[data.length - 1].close;
  const latestSMA20 = sma20[sma20.length - 1]?.value ?? currentPrice;
  const latestSMA50 = sma50[sma50.length - 1]?.value ?? currentPrice;
  const latestEMA12 = ema12[ema12.length - 1]?.value ?? currentPrice;
  const latestEMA26 = ema26[ema26.length - 1]?.value ?? currentPrice;
  
  let score = 0;
  const explanations: string[] = [];
  
  // Price vs SMA20
  if (currentPrice > latestSMA20) {
    score += 0.5;
    explanations.push('Price above 20-day SMA indicates short-term uptrend');
  } else {
    score -= 0.5;
    explanations.push('Price below 20-day SMA indicates short-term downtrend');
  }
  
  // SMA20 vs SMA50 (Golden/Death Cross)
  if (latestSMA20 > latestSMA50) {
    score += 1;
    explanations.push('20-day SMA above 50-day SMA (Golden Cross pattern)');
  } else {
    score -= 1;
    explanations.push('20-day SMA below 50-day SMA (Death Cross pattern)');
  }
  
  // EMA crossover
  if (latestEMA12 > latestEMA26) {
    score += 0.5;
    explanations.push('12-day EMA above 26-day EMA shows bullish momentum');
  } else {
    score -= 0.5;
    explanations.push('12-day EMA below 26-day EMA shows bearish momentum');
  }
  
  return {
    name: 'Trend Analysis (Moving Averages)',
    description: 'Analyzes price trends using SMA and EMA crossovers',
    signal: scoreToSignal(score),
    value: `SMA20: ${latestSMA20.toFixed(2)}, SMA50: ${latestSMA50.toFixed(2)}`,
    explanation: explanations.join('. ') + '.'
  };
}

/**
 * Analyze RSI
 */
function analyzeRSI(data: OHLCV[]): IndicatorAnalysis {
  const rsi = calculateRSI(data);
  const latestRSI = rsi[rsi.length - 1]?.value ?? 50;
  
  let score = 0;
  let explanation = '';
  
  if (latestRSI > 80) {
    score = -2;
    explanation = `RSI at ${latestRSI.toFixed(1)} indicates extreme overbought conditions. High probability of price correction or reversal. Consider taking profits.`;
  } else if (latestRSI > 70) {
    score = -1;
    explanation = `RSI at ${latestRSI.toFixed(1)} indicates overbought conditions. Momentum may be weakening. Watch for reversal signals.`;
  } else if (latestRSI < 20) {
    score = 2;
    explanation = `RSI at ${latestRSI.toFixed(1)} indicates extreme oversold conditions. High probability of bounce or reversal. Consider accumulating.`;
  } else if (latestRSI < 30) {
    score = 1;
    explanation = `RSI at ${latestRSI.toFixed(1)} indicates oversold conditions. Potential buying opportunity approaching.`;
  } else if (latestRSI > 50) {
    score = 0.5;
    explanation = `RSI at ${latestRSI.toFixed(1)} shows positive momentum without extreme conditions. Bullish bias.`;
  } else {
    score = -0.5;
    explanation = `RSI at ${latestRSI.toFixed(1)} shows negative momentum without extreme conditions. Bearish bias.`;
  }
  
  return {
    name: 'RSI (Relative Strength Index)',
    description: 'Measures momentum on a scale of 0-100',
    signal: scoreToSignal(score),
    value: latestRSI.toFixed(1),
    explanation
  };
}

/**
 * Analyze MACD
 */
function analyzeMACD(data: OHLCV[]): IndicatorAnalysis {
  const macd = calculateMACD(data);
  if (macd.length < 2) {
    return {
      name: 'MACD',
      description: 'Moving Average Convergence Divergence',
      signal: 'NEUTRAL',
      value: 'N/A',
      explanation: 'Insufficient data to calculate MACD.'
    };
  }
  
  const latest = macd[macd.length - 1];
  const previous = macd[macd.length - 2];
  
  let score = 0;
  const explanations: string[] = [];
  
  // MACD vs Signal line
  if (latest.macd > latest.signal) {
    score += 1;
    explanations.push('MACD above signal line indicates bullish momentum');
  } else {
    score -= 1;
    explanations.push('MACD below signal line indicates bearish momentum');
  }
  
  // Crossover detection
  if (previous.macd <= previous.signal && latest.macd > latest.signal) {
    score += 1;
    explanations.push('Bullish crossover detected (MACD crossed above signal)');
  } else if (previous.macd >= previous.signal && latest.macd < latest.signal) {
    score -= 1;
    explanations.push('Bearish crossover detected (MACD crossed below signal)');
  }
  
  // Histogram trend
  if (latest.histogram > previous.histogram) {
    score += 0.5;
    explanations.push('Histogram increasing shows strengthening momentum');
  } else {
    score -= 0.5;
    explanations.push('Histogram decreasing shows weakening momentum');
  }
  
  return {
    name: 'MACD',
    description: 'Moving Average Convergence Divergence',
    signal: scoreToSignal(score),
    value: `MACD: ${latest.macd.toFixed(3)}, Signal: ${latest.signal.toFixed(3)}`,
    explanation: explanations.join('. ') + '.'
  };
}

/**
 * Analyze Bollinger Bands
 */
function analyzeBollingerBands(data: OHLCV[]): IndicatorAnalysis {
  const bb = calculateBollingerBands(data);
  const latest = bb[bb.length - 1];
  const currentPrice = data[data.length - 1].close;
  
  if (!latest) {
    return {
      name: 'Bollinger Bands',
      description: 'Volatility bands around moving average',
      signal: 'NEUTRAL',
      value: 'N/A',
      explanation: 'Insufficient data for Bollinger Bands calculation.'
    };
  }
  
  const bandWidth = latest.upper - latest.lower;
  const percentB = ((currentPrice - latest.lower) / bandWidth) * 100;
  
  let score = 0;
  let explanation = '';
  
  if (currentPrice > latest.upper) {
    score = -1.5;
    explanation = `Price (${currentPrice.toFixed(2)}) above upper band (${latest.upper.toFixed(2)}) indicates overbought conditions. Price typically returns to the mean.`;
  } else if (currentPrice < latest.lower) {
    score = 1.5;
    explanation = `Price (${currentPrice.toFixed(2)}) below lower band (${latest.lower.toFixed(2)}) indicates oversold conditions. Potential bounce expected.`;
  } else if (percentB > 80) {
    score = -0.5;
    explanation = `Price in upper 20% of bands (%B: ${percentB.toFixed(1)}). Approaching resistance, caution advised.`;
  } else if (percentB < 20) {
    score = 0.5;
    explanation = `Price in lower 20% of bands (%B: ${percentB.toFixed(1)}). Approaching support, potential bounce.`;
  } else {
    score = 0;
    explanation = `Price within normal range (%B: ${percentB.toFixed(1)}). No extreme conditions detected.`;
  }
  
  return {
    name: 'Bollinger Bands',
    description: 'Volatility bands around 20-period SMA',
    signal: scoreToSignal(score),
    value: `Upper: ${latest.upper.toFixed(2)}, Mid: ${latest.middle.toFixed(2)}, Lower: ${latest.lower.toFixed(2)}`,
    explanation
  };
}

/**
 * Analyze Stochastic Oscillator
 */
function analyzeStochastic(data: OHLCV[]): IndicatorAnalysis {
  const stoch = calculateStochastic(data);
  if (stoch.length < 2) {
    return {
      name: 'Stochastic Oscillator',
      description: 'Momentum indicator comparing closing price to price range',
      signal: 'NEUTRAL',
      value: 'N/A',
      explanation: 'Insufficient data for Stochastic calculation.'
    };
  }
  
  const latest = stoch[stoch.length - 1];
  const previous = stoch[stoch.length - 2];
  
  let score = 0;
  const explanations: string[] = [];
  
  // Overbought/Oversold
  if (latest.k > 80 && latest.d > 80) {
    score -= 1;
    explanations.push(`%K (${latest.k.toFixed(1)}) and %D (${latest.d.toFixed(1)}) both above 80 indicate overbought conditions`);
  } else if (latest.k < 20 && latest.d < 20) {
    score += 1;
    explanations.push(`%K (${latest.k.toFixed(1)}) and %D (${latest.d.toFixed(1)}) both below 20 indicate oversold conditions`);
  }
  
  // Crossover
  if (previous.k <= previous.d && latest.k > latest.d) {
    score += 1;
    explanations.push('Bullish crossover: %K crossed above %D');
  } else if (previous.k >= previous.d && latest.k < latest.d) {
    score -= 1;
    explanations.push('Bearish crossover: %K crossed below %D');
  }
  
  return {
    name: 'Stochastic Oscillator',
    description: 'Compares closing price to price range over 14 periods',
    signal: scoreToSignal(score),
    value: `%K: ${latest.k.toFixed(1)}, %D: ${latest.d.toFixed(1)}`,
    explanation: explanations.length > 0 ? explanations.join('. ') + '.' : 'No significant signals detected.'
  };
}

/**
 * Analyze Volume (OBV and VWAP)
 */
function analyzeVolume(data: OHLCV[]): IndicatorAnalysis {
  const obv = calculateOBV(data);
  const vwap = calculateVWAP(data);
  const currentPrice = data[data.length - 1].close;
  const latestVWAP = vwap[vwap.length - 1]?.value ?? currentPrice;
  
  // OBV trend (last 5 periods)
  const recentOBV = obv.slice(-5);
  const obvTrend = recentOBV.length >= 2 
    ? recentOBV[recentOBV.length - 1].value - recentOBV[0].value 
    : 0;
  
  let score = 0;
  const explanations: string[] = [];
  
  // Price vs VWAP
  if (currentPrice > latestVWAP) {
    score += 0.5;
    explanations.push(`Price (${currentPrice.toFixed(2)}) above VWAP (${latestVWAP.toFixed(2)}) indicates bullish sentiment`);
  } else {
    score -= 0.5;
    explanations.push(`Price (${currentPrice.toFixed(2)}) below VWAP (${latestVWAP.toFixed(2)}) indicates bearish sentiment`);
  }
  
  // OBV trend
  if (obvTrend > 0) {
    score += 0.5;
    explanations.push('Rising OBV confirms buying pressure');
  } else {
    score -= 0.5;
    explanations.push('Falling OBV indicates selling pressure');
  }
  
  return {
    name: 'Volume Analysis (OBV & VWAP)',
    description: 'Analyzes volume flow and volume-weighted price',
    signal: scoreToSignal(score),
    value: `VWAP: ${latestVWAP.toFixed(2)}`,
    explanation: explanations.join('. ') + '.'
  };
}

/**
 * Analyze Volatility (ATR)
 */
function analyzeVolatility(data: OHLCV[]): IndicatorAnalysis {
  const atr = calculateATR(data);
  const latestATR = atr[atr.length - 1]?.value ?? 0;
  const currentPrice = data[data.length - 1].close;
  const atrPercent = (latestATR / currentPrice) * 100;
  
  // Calculate average ATR for comparison
  const avgATR = atr.slice(-20).reduce((a, b) => a + b.value, 0) / Math.min(atr.length, 20);
  
  let volatilityLevel: string;
  let explanation: string;
  
  if (latestATR > avgATR * 1.5) {
    volatilityLevel = 'HIGH';
    explanation = `ATR (${latestATR.toFixed(2)}, ${atrPercent.toFixed(2)}%) is 50% above average. High volatility period - consider wider stops and smaller position sizes.`;
  } else if (latestATR < avgATR * 0.5) {
    volatilityLevel = 'LOW';
    explanation = `ATR (${latestATR.toFixed(2)}, ${atrPercent.toFixed(2)}%) is below average. Low volatility often precedes significant price moves.`;
  } else {
    volatilityLevel = 'NORMAL';
    explanation = `ATR (${latestATR.toFixed(2)}, ${atrPercent.toFixed(2)}%) is within normal range. Standard trading conditions.`;
  }
  
  return {
    name: 'Volatility (ATR)',
    description: 'Average True Range measures price volatility',
    signal: 'NEUTRAL',
    value: `ATR: ${latestATR.toFixed(2)} (${atrPercent.toFixed(2)}%) - ${volatilityLevel}`,
    explanation
  };
}

/**
 * Generate comprehensive forecast
 */
export function generateForecast(data: OHLCV[]): ForecastResult {
  if (data.length < 50) {
    return {
      overallSignal: 'NEUTRAL',
      confidence: 0,
      priceTarget: data[data.length - 1]?.close ?? 0,
      supportLevel: 0,
      resistanceLevel: 0,
      indicators: [],
      summary: 'Insufficient data for analysis. Need at least 50 data points.'
    };
  }
  
  // Run all analyses
  const indicators: IndicatorAnalysis[] = [
    analyzeTrend(data),
    analyzeRSI(data),
    analyzeMACD(data),
    analyzeBollingerBands(data),
    analyzeStochastic(data),
    analyzeVolume(data),
    analyzeVolatility(data)
  ];
  
  // Calculate weighted average score
  const weights = {
    'Trend Analysis (Moving Averages)': 2.0,
    'RSI (Relative Strength Index)': 1.5,
    'MACD': 1.5,
    'Bollinger Bands': 1.0,
    'Stochastic Oscillator': 1.0,
    'Volume Analysis (OBV & VWAP)': 1.0,
    'Volatility (ATR)': 0.5
  };
  
  let totalScore = 0;
  let totalWeight = 0;
  
  for (const indicator of indicators) {
    const weight = weights[indicator.name as keyof typeof weights] ?? 1;
    totalScore += signalToScore(indicator.signal) * weight;
    totalWeight += weight;
  }
  
  const averageScore = totalScore / totalWeight;
  const overallSignal = scoreToSignal(averageScore);
  
  // Calculate confidence (how many indicators agree)
  const buySignals = indicators.filter(i => ['STRONG_BUY', 'BUY'].includes(i.signal)).length;
  const sellSignals = indicators.filter(i => ['STRONG_SELL', 'SELL'].includes(i.signal)).length;
  const agreement = Math.max(buySignals, sellSignals) / indicators.length;
  const confidence = Math.round(agreement * 100);
  
  // Find support/resistance
  const { support, resistance } = findSupportResistance(data);
  const currentPrice = data[data.length - 1].close;
  
  // Calculate price target based on signal and support/resistance
  let priceTarget: number;
  if (overallSignal === 'STRONG_BUY' || overallSignal === 'BUY') {
    priceTarget = currentPrice + (resistance - currentPrice) * 0.7;
  } else if (overallSignal === 'STRONG_SELL' || overallSignal === 'SELL') {
    priceTarget = currentPrice - (currentPrice - support) * 0.7;
  } else {
    priceTarget = currentPrice;
  }
  
  // Generate summary
  const summaryParts: string[] = [];
  
  summaryParts.push(`Overall signal: ${overallSignal} with ${confidence}% indicator agreement.`);
  
  if (overallSignal === 'STRONG_BUY') {
    summaryParts.push('Multiple indicators show strong bullish signals. Consider long positions with appropriate risk management.');
  } else if (overallSignal === 'BUY') {
    summaryParts.push('Technical indicators lean bullish. Look for confirmation before entering positions.');
  } else if (overallSignal === 'STRONG_SELL') {
    summaryParts.push('Multiple indicators show strong bearish signals. Consider closing long positions or initiating shorts.');
  } else if (overallSignal === 'SELL') {
    summaryParts.push('Technical indicators lean bearish. Consider reducing exposure or setting tight stops.');
  } else {
    summaryParts.push('Mixed signals across indicators. Wait for clearer trend confirmation before trading.');
  }
  
  summaryParts.push(`Key levels: Support at ${support.toFixed(2)}, Resistance at ${resistance.toFixed(2)}.`);
  summaryParts.push(`Price target: ${priceTarget.toFixed(2)} based on current technical analysis.`);
  summaryParts.push('⚠️ This analysis is for educational purposes only. Always do your own research and consider risk management.');
  
  return {
    overallSignal,
    confidence,
    priceTarget,
    supportLevel: support,
    resistanceLevel: resistance,
    indicators,
    summary: summaryParts.join(' ')
  };
}
