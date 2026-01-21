/**
 * Stock data types for technical analysis
 */

export interface OHLCV {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockData {
  symbol: string;
  name: string;
  data: OHLCV[];
}

export interface IndicatorValue {
  time: number;
  value: number;
}

export interface MACDValue {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerBandsValue {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export interface StochasticValue {
  time: number;
  k: number;
  d: number;
}

export type TrendSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

export interface IndicatorAnalysis {
  name: string;
  description: string;
  signal: TrendSignal;
  value: string;
  explanation: string;
}

export interface ForecastResult {
  overallSignal: TrendSignal;
  confidence: number;
  priceTarget: number;
  supportLevel: number;
  resistanceLevel: number;
  indicators: IndicatorAnalysis[];
  summary: string;
}
