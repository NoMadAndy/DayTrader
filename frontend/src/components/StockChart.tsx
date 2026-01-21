import { useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType, LineSeries, CandlestickSeries, HistogramSeries, LineStyle } from 'lightweight-charts';
import type { IChartApi, CandlestickData, LineData, HistogramData, Time } from 'lightweight-charts';
import type { OHLCV, IndicatorValue, MACDValue, BollingerBandsValue } from '../types/stock';
import { calculateSMA, calculateEMA, calculateBollingerBands, calculateMACD, calculateRSI } from '../utils/indicators';

interface StockChartProps {
  data: OHLCV[];
  symbol: string;
  showSMA20?: boolean;
  showSMA50?: boolean;
  showEMA12?: boolean;
  showEMA26?: boolean;
  showBollingerBands?: boolean;
  showMACD?: boolean;
  showRSI?: boolean;
  showVolume?: boolean;
  supportLevel?: number;
  resistanceLevel?: number;
}

export function StockChart({
  data,
  symbol,
  showSMA20 = true,
  showSMA50 = true,
  showEMA12 = false,
  showEMA26 = false,
  showBollingerBands = false,
  showMACD = false,
  showRSI = false,
  showVolume = true,
  supportLevel,
  resistanceLevel,
}: StockChartProps) {
  const mainChartRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<HTMLDivElement>(null);
  
  const mainChartApiRef = useRef<IChartApi | null>(null);
  const rsiChartApiRef = useRef<IChartApi | null>(null);
  const macdChartApiRef = useRef<IChartApi | null>(null);

  const convertToChartData = useCallback((ohlcv: OHLCV[]): CandlestickData<Time>[] => {
    return ohlcv.map(d => ({
      time: d.time as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
  }, []);

  const convertIndicatorToLineData = useCallback((indicator: IndicatorValue[]): LineData<Time>[] => {
    return indicator.map(d => ({
      time: d.time as Time,
      value: d.value,
    }));
  }, []);

  useEffect(() => {
    if (!mainChartRef.current || data.length === 0) return;

    // Clean up existing charts safely
    try {
      mainChartApiRef.current?.remove();
    } catch {
      // Chart already disposed
    }
    try {
      rsiChartApiRef.current?.remove();
    } catch {
      // Chart already disposed
    }
    try {
      macdChartApiRef.current?.remove();
    } catch {
      // Chart already disposed
    }
    
    mainChartApiRef.current = null;
    rsiChartApiRef.current = null;
    macdChartApiRef.current = null;

    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(75, 85, 99, 0.3)' },
        horzLines: { color: 'rgba(75, 85, 99, 0.3)' },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        borderColor: 'rgba(75, 85, 99, 0.5)',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: 'rgba(75, 85, 99, 0.5)',
      },
    };

    // Main chart
    const mainChart = createChart(mainChartRef.current, {
      ...chartOptions,
      width: mainChartRef.current.clientWidth,
      height: showMACD || showRSI ? 300 : 400,
    });
    mainChartApiRef.current = mainChart;

    // Candlestick series
    const candlestickSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candlestickSeries.setData(convertToChartData(data));

    // Volume
    if (showVolume) {
      const volumeSeries = mainChart.addSeries(HistogramSeries, {
        color: '#3b82f6',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });
      const volumeData: HistogramData<Time>[] = data.map(d => ({
        time: d.time as Time,
        value: d.volume,
        color: d.close >= d.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      }));
      volumeSeries.setData(volumeData);
    }

    // SMA 20
    if (showSMA20 && data.length >= 20) {
      const sma20Series = mainChart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        title: 'SMA20',
      });
      const sma20Data = calculateSMA(data, 20);
      sma20Series.setData(convertIndicatorToLineData(sma20Data));
    }

    // SMA 50
    if (showSMA50 && data.length >= 50) {
      const sma50Series = mainChart.addSeries(LineSeries, {
        color: '#8b5cf6',
        lineWidth: 1,
        title: 'SMA50',
      });
      const sma50Data = calculateSMA(data, 50);
      sma50Series.setData(convertIndicatorToLineData(sma50Data));
    }

    // EMA 12
    if (showEMA12 && data.length >= 12) {
      const ema12Series = mainChart.addSeries(LineSeries, {
        color: '#06b6d4',
        lineWidth: 1,
        title: 'EMA12',
      });
      const ema12Data = calculateEMA(data, 12);
      ema12Series.setData(convertIndicatorToLineData(ema12Data));
    }

    // EMA 26
    if (showEMA26 && data.length >= 26) {
      const ema26Series = mainChart.addSeries(LineSeries, {
        color: '#ec4899',
        lineWidth: 1,
        title: 'EMA26',
      });
      const ema26Data = calculateEMA(data, 26);
      ema26Series.setData(convertIndicatorToLineData(ema26Data));
    }

    // Bollinger Bands
    if (showBollingerBands && data.length >= 20) {
      const bbData: BollingerBandsValue[] = calculateBollingerBands(data);
      
      const bbUpperSeries = mainChart.addSeries(LineSeries, {
        color: 'rgba(156, 163, 175, 0.6)',
        lineWidth: 1,
        title: 'BB Upper',
      });
      bbUpperSeries.setData(bbData.map(d => ({ time: d.time as Time, value: d.upper })));
      
      const bbMiddleSeries = mainChart.addSeries(LineSeries, {
        color: 'rgba(156, 163, 175, 0.8)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'BB Middle',
      });
      bbMiddleSeries.setData(bbData.map(d => ({ time: d.time as Time, value: d.middle })));
      
      const bbLowerSeries = mainChart.addSeries(LineSeries, {
        color: 'rgba(156, 163, 175, 0.6)',
        lineWidth: 1,
        title: 'BB Lower',
      });
      bbLowerSeries.setData(bbData.map(d => ({ time: d.time as Time, value: d.lower })));
    }

    // Support and Resistance lines
    if (supportLevel !== undefined) {
      const supportSeries = mainChart.addSeries(LineSeries, {
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: 'Support',
      });
      supportSeries.setData([
        { time: data[0].time as Time, value: supportLevel },
        { time: data[data.length - 1].time as Time, value: supportLevel },
      ]);
    }

    if (resistanceLevel !== undefined) {
      const resistanceSeries = mainChart.addSeries(LineSeries, {
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: 'Resistance',
      });
      resistanceSeries.setData([
        { time: data[0].time as Time, value: resistanceLevel },
        { time: data[data.length - 1].time as Time, value: resistanceLevel },
      ]);
    }

    mainChart.timeScale().fitContent();

    // RSI Chart
    if (showRSI && rsiChartRef.current && data.length >= 14) {
      const rsiChart = createChart(rsiChartRef.current, {
        ...chartOptions,
        width: rsiChartRef.current.clientWidth,
        height: 100,
      });
      rsiChartApiRef.current = rsiChart;

      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: '#8b5cf6',
        lineWidth: 2,
        title: 'RSI',
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
      });

      const rsiData = calculateRSI(data);
      rsiSeries.setData(convertIndicatorToLineData(rsiData));

      // Add overbought/oversold lines
      const overboughtSeries = rsiChart.addSeries(LineSeries, {
        color: 'rgba(239, 68, 68, 0.5)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
      });
      overboughtSeries.setData([
        { time: data[14].time as Time, value: 70 },
        { time: data[data.length - 1].time as Time, value: 70 },
      ]);

      const oversoldSeries = rsiChart.addSeries(LineSeries, {
        color: 'rgba(34, 197, 94, 0.5)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
      });
      oversoldSeries.setData([
        { time: data[14].time as Time, value: 30 },
        { time: data[data.length - 1].time as Time, value: 30 },
      ]);

      rsiChart.timeScale().fitContent();

      // Sync time scales
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
      });
    }

    // MACD Chart
    if (showMACD && macdChartRef.current && data.length >= 26) {
      const macdChart = createChart(macdChartRef.current, {
        ...chartOptions,
        width: macdChartRef.current.clientWidth,
        height: 120,
      });
      macdChartApiRef.current = macdChart;

      const macdData: MACDValue[] = calculateMACD(data);

      const macdLineSeries = macdChart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 2,
        title: 'MACD',
      });
      macdLineSeries.setData(macdData.map(d => ({ time: d.time as Time, value: d.macd })));

      const signalLineSeries = macdChart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 2,
        title: 'Signal',
      });
      signalLineSeries.setData(macdData.map(d => ({ time: d.time as Time, value: d.signal })));

      const histogramSeries = macdChart.addSeries(HistogramSeries, {
        title: 'Histogram',
      });
      const histogramData: HistogramData<Time>[] = macdData.map(d => ({
        time: d.time as Time,
        value: d.histogram,
        color: d.histogram >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)',
      }));
      histogramSeries.setData(histogramData);

      macdChart.timeScale().fitContent();

      // Sync time scales
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) macdChart.timeScale().setVisibleLogicalRange(range);
      });
    }

    // Handle resize
    const handleResize = () => {
      if (mainChartRef.current) {
        mainChart.applyOptions({ width: mainChartRef.current.clientWidth });
      }
      if (rsiChartRef.current && rsiChartApiRef.current) {
        rsiChartApiRef.current.applyOptions({ width: rsiChartRef.current.clientWidth });
      }
      if (macdChartRef.current && macdChartApiRef.current) {
        macdChartApiRef.current.applyOptions({ width: macdChartRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      try {
        mainChartApiRef.current?.remove();
      } catch {
        // Chart already disposed
      }
      try {
        rsiChartApiRef.current?.remove();
      } catch {
        // Chart already disposed
      }
      try {
        macdChartApiRef.current?.remove();
      } catch {
        // Chart already disposed
      }
      mainChartApiRef.current = null;
      rsiChartApiRef.current = null;
      macdChartApiRef.current = null;
    };
  }, [data, symbol, showSMA20, showSMA50, showEMA12, showEMA26, showBollingerBands, showMACD, showRSI, showVolume, supportLevel, resistanceLevel, convertToChartData, convertIndicatorToLineData]);

  return (
    <div className="w-full">
      <div className="text-sm text-gray-400 mb-2 flex items-center gap-4 flex-wrap">
        <span className="font-semibold text-white">{symbol}</span>
        {showSMA20 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500"></span> SMA20</span>}
        {showSMA50 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-500"></span> SMA50</span>}
        {showEMA12 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-cyan-500"></span> EMA12</span>}
        {showEMA26 && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-pink-500"></span> EMA26</span>}
        {supportLevel !== undefined && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500"></span> Support</span>}
        {resistanceLevel !== undefined && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500"></span> Resistance</span>}
      </div>
      <div ref={mainChartRef} className="w-full rounded-lg overflow-hidden" />
      {showRSI && (
        <div className="mt-2">
          <div className="text-xs text-gray-400 mb-1">RSI (14)</div>
          <div ref={rsiChartRef} className="w-full rounded-lg overflow-hidden" />
        </div>
      )}
      {showMACD && (
        <div className="mt-2">
          <div className="text-xs text-gray-400 mb-1">MACD (12, 26, 9)</div>
          <div ref={macdChartRef} className="w-full rounded-lg overflow-hidden" />
        </div>
      )}
    </div>
  );
}
