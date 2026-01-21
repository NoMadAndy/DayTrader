/**
 * Technical Analysis Indicators
 * 
 * This module implements common technical analysis indicators used in day trading:
 * 
 * TREND INDICATORS:
 * - SMA (Simple Moving Average): Calculates the average price over a specified period
 * - EMA (Exponential Moving Average): Weighted average giving more importance to recent prices
 * 
 * MOMENTUM INDICATORS:
 * - RSI (Relative Strength Index): Measures speed and magnitude of price changes (0-100)
 * - MACD (Moving Average Convergence Divergence): Shows relationship between two EMAs
 * - Stochastic Oscillator: Compares closing price to price range over a period
 * 
 * VOLATILITY INDICATORS:
 * - Bollinger Bands: Shows volatility with bands around a moving average
 * - ATR (Average True Range): Measures market volatility
 * 
 * VOLUME INDICATORS:
 * - OBV (On-Balance Volume): Uses volume flow to predict price changes
 * - VWAP (Volume Weighted Average Price): Average price weighted by volume
 */

import type { OHLCV, IndicatorValue, MACDValue, BollingerBandsValue, StochasticValue } from '../types/stock';

/**
 * Simple Moving Average (SMA)
 * Calculates the arithmetic mean of prices over a specified period.
 * Used to identify trend direction and potential support/resistance levels.
 */
export function calculateSMA(data: OHLCV[], period: number): IndicatorValue[] {
  const result: IndicatorValue[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({
      time: data[i].time,
      value: sum / period
    });
  }
  
  return result;
}

/**
 * Exponential Moving Average (EMA)
 * Gives more weight to recent prices, making it more responsive to new information.
 * Formula: EMA = (Price × k) + (Previous EMA × (1 − k))
 * where k = 2 / (period + 1)
 */
export function calculateEMA(data: OHLCV[], period: number): IndicatorValue[] {
  const result: IndicatorValue[] = [];
  const k = 2 / (period + 1);
  
  // Start with SMA for first EMA value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  let ema = sum / period;
  result.push({ time: data[period - 1].time, value: ema });
  
  // Calculate subsequent EMAs
  for (let i = period; i < data.length; i++) {
    ema = (data[i].close * k) + (ema * (1 - k));
    result.push({ time: data[i].time, value: ema });
  }
  
  return result;
}

/**
 * Relative Strength Index (RSI)
 * Measures the speed and magnitude of recent price changes.
 * Values range from 0-100:
 * - RSI > 70: Overbought condition (potential sell signal)
 * - RSI < 30: Oversold condition (potential buy signal)
 */
export function calculateRSI(data: OHLCV[], period: number = 14): IndicatorValue[] {
  const result: IndicatorValue[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  // Calculate price changes
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // Calculate initial average gain/loss
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // Calculate RSI
  for (let i = period; i < data.length; i++) {
    if (i > period) {
      avgGain = ((avgGain * (period - 1)) + gains[i - 1]) / period;
      avgLoss = ((avgLoss * (period - 1)) + losses[i - 1]) / period;
    }
    
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    result.push({ time: data[i].time, value: rsi });
  }
  
  return result;
}

/**
 * Moving Average Convergence Divergence (MACD)
 * Shows the relationship between two exponential moving averages.
 * Components:
 * - MACD Line: 12-period EMA - 26-period EMA
 * - Signal Line: 9-period EMA of MACD Line
 * - Histogram: MACD Line - Signal Line
 * 
 * Buy signal: MACD crosses above signal line
 * Sell signal: MACD crosses below signal line
 */
export function calculateMACD(
  data: OHLCV[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDValue[] {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  const result: MACDValue[] = [];
  
  // Calculate MACD line
  const macdLine: IndicatorValue[] = [];
  const offset = slowPeriod - fastPeriod;
  
  for (let i = 0; i < slowEMA.length; i++) {
    const fastValue = fastEMA[i + offset];
    const slowValue = slowEMA[i];
    if (fastValue && slowValue) {
      macdLine.push({
        time: slowValue.time,
        value: fastValue.value - slowValue.value
      });
    }
  }
  
  // Calculate signal line (EMA of MACD)
  const k = 2 / (signalPeriod + 1);
  let signal = macdLine.slice(0, signalPeriod).reduce((a, b) => a + b.value, 0) / signalPeriod;
  
  for (let i = signalPeriod - 1; i < macdLine.length; i++) {
    if (i > signalPeriod - 1) {
      signal = (macdLine[i].value * k) + (signal * (1 - k));
    }
    
    result.push({
      time: macdLine[i].time,
      macd: macdLine[i].value,
      signal: signal,
      histogram: macdLine[i].value - signal
    });
  }
  
  return result;
}

/**
 * Bollinger Bands
 * Shows price volatility with bands around a moving average:
 * - Upper Band: SMA + (2 × Standard Deviation)
 * - Middle Band: 20-period SMA
 * - Lower Band: SMA - (2 × Standard Deviation)
 * 
 * Price near upper band: Potentially overbought
 * Price near lower band: Potentially oversold
 */
export function calculateBollingerBands(
  data: OHLCV[],
  period: number = 20,
  stdDev: number = 2
): BollingerBandsValue[] {
  const result: BollingerBandsValue[] = [];
  const sma = calculateSMA(data, period);
  
  for (let i = period - 1; i < data.length; i++) {
    const smaIndex = i - (period - 1);
    const middle = sma[smaIndex].value;
    
    // Calculate standard deviation
    let sumSquares = 0;
    for (let j = 0; j < period; j++) {
      sumSquares += Math.pow(data[i - j].close - middle, 2);
    }
    const std = Math.sqrt(sumSquares / period);
    
    result.push({
      time: data[i].time,
      upper: middle + (stdDev * std),
      middle: middle,
      lower: middle - (stdDev * std)
    });
  }
  
  return result;
}

/**
 * Stochastic Oscillator
 * Compares closing price to price range over a period.
 * - %K: (Current Close - Lowest Low) / (Highest High - Lowest Low) × 100
 * - %D: 3-period SMA of %K
 * 
 * Values > 80: Overbought
 * Values < 20: Oversold
 */
export function calculateStochastic(
  data: OHLCV[],
  kPeriod: number = 14,
  dPeriod: number = 3
): StochasticValue[] {
  const result: StochasticValue[] = [];
  const kValues: number[] = [];
  
  for (let i = kPeriod - 1; i < data.length; i++) {
    let lowestLow = Infinity;
    let highestHigh = -Infinity;
    
    for (let j = 0; j < kPeriod; j++) {
      lowestLow = Math.min(lowestLow, data[i - j].low);
      highestHigh = Math.max(highestHigh, data[i - j].high);
    }
    
    const k = highestHigh === lowestLow 
      ? 50 
      : ((data[i].close - lowestLow) / (highestHigh - lowestLow)) * 100;
    kValues.push(k);
    
    if (kValues.length >= dPeriod) {
      const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
      result.push({
        time: data[i].time,
        k: k,
        d: d
      });
    }
  }
  
  return result;
}

/**
 * Average True Range (ATR)
 * Measures market volatility by decomposing the entire range of an asset price.
 * Higher ATR = Higher volatility
 */
export function calculateATR(data: OHLCV[], period: number = 14): IndicatorValue[] {
  const result: IndicatorValue[] = [];
  const trueRanges: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }
  
  // Calculate initial ATR
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push({ time: data[period].time, value: atr });
  
  // Calculate subsequent ATRs using smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    result.push({ time: data[i + 1].time, value: atr });
  }
  
  return result;
}

/**
 * On-Balance Volume (OBV)
 * Uses volume flow to predict changes in stock price.
 * If close > previous close: OBV = Previous OBV + Volume
 * If close < previous close: OBV = Previous OBV - Volume
 */
export function calculateOBV(data: OHLCV[]): IndicatorValue[] {
  const result: IndicatorValue[] = [];
  let obv = 0;
  
  result.push({ time: data[0].time, value: obv });
  
  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i - 1].close) {
      obv += data[i].volume;
    } else if (data[i].close < data[i - 1].close) {
      obv -= data[i].volume;
    }
    result.push({ time: data[i].time, value: obv });
  }
  
  return result;
}

/**
 * Volume Weighted Average Price (VWAP)
 * Average price weighted by volume, used as a trading benchmark.
 * Price above VWAP: Bullish
 * Price below VWAP: Bearish
 */
export function calculateVWAP(data: OHLCV[]): IndicatorValue[] {
  const result: IndicatorValue[] = [];
  let cumulativeTPV = 0; // Typical Price × Volume
  let cumulativeVolume = 0;
  
  for (const candle of data) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
    
    result.push({
      time: candle.time,
      value: cumulativeVolume === 0 ? typicalPrice : cumulativeTPV / cumulativeVolume
    });
  }
  
  return result;
}

/**
 * Identify Support and Resistance Levels
 * Uses pivot points and local extrema to identify key price levels.
 */
export function findSupportResistance(data: OHLCV[], lookback: number = 10): { support: number; resistance: number } {
  if (data.length < lookback * 2) {
    const prices = data.map(d => d.close);
    return {
      support: Math.min(...prices),
      resistance: Math.max(...prices)
    };
  }
  
  const recentData = data.slice(-lookback * 3);
  const lows = recentData.map(d => d.low);
  const highs = recentData.map(d => d.high);
  
  // Find local minima and maxima
  const localMinima: number[] = [];
  const localMaxima: number[] = [];
  
  for (let i = 1; i < recentData.length - 1; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
      localMinima.push(lows[i]);
    }
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
      localMaxima.push(highs[i]);
    }
  }
  
  return {
    support: localMinima.length > 0 
      ? localMinima.reduce((a, b) => a + b, 0) / localMinima.length 
      : Math.min(...lows),
    resistance: localMaxima.length > 0 
      ? localMaxima.reduce((a, b) => a + b, 0) / localMaxima.length 
      : Math.max(...highs)
  };
}
