/**
 * Dashboard Page
 * 
 * Main trading view with stock chart, forecasts, news, and trading signals.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { StockChart, ForecastPanel, MLForecastPanel, StockSelector, IndicatorControls, NewsPanel, TradingSignalPanel, DataFreshnessIndicator, type NewsItemWithSentiment, type DataTimestamps } from '../components';
import { useStockData, useDataService } from '../hooks';
import { generateForecast } from '../utils/forecast';

// ML Prediction type for trading signals
interface MLPrediction {
  date: string;
  day: number;
  predicted_price: number;
  confidence: number;
  change_pct: number;
}

interface DashboardPageProps {
  selectedSymbol: string;
  onSymbolChange: (symbol: string) => void;
}

export function DashboardPage({ selectedSymbol, onSymbolChange }: DashboardPageProps) {
  const { data: stockData, isLoading, source, refetch } = useStockData(selectedSymbol);
  const { preferredSource } = useDataService();

  // State for ML predictions (shared with NewsPanel for combined trading signals)
  const [mlPredictions, setMlPredictions] = useState<MLPrediction[] | null>(null);
  
  // State for news sentiment (from NewsPanel callback)
  const [newsWithSentiment, setNewsWithSentiment] = useState<NewsItemWithSentiment[]>([]);

  // Data freshness timestamps
  const [dataTimestamps, setDataTimestamps] = useState<DataTimestamps>({
    financial: null,
    news: null,
    mlModel: null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Refs for refresh callbacks from child components
  const newsRefreshRef = useRef<(() => void) | null>(null);
  const mlRefreshRef = useRef<(() => void) | null>(null);
  
  // Track last loaded data to detect actual changes
  const lastStockDataRef = useRef<string | null>(null);

  // Update financial data timestamp when stock data actually changes
  useEffect(() => {
    if (stockData && !isLoading) {
      // Create a simple fingerprint of the data
      const dataFingerprint = `${stockData.symbol}-${stockData.data.length}-${stockData.data[stockData.data.length - 1]?.close}`;
      
      if (lastStockDataRef.current !== dataFingerprint) {
        lastStockDataRef.current = dataFingerprint;
        setDataTimestamps(prev => ({
          ...prev,
          financial: new Date(),
        }));
      }
    }
  }, [stockData, isLoading]);

  // Track last news data to detect actual changes
  const lastNewsCountRef = useRef<number>(0);
  
  // Track last ML predictions to detect actual changes  
  const lastMLPredictionRef = useRef<string | null>(null);

  // Callback to receive ML predictions from MLForecastPanel
  const handleMLPredictionsChange = useCallback((predictions: MLPrediction[] | null) => {
    setMlPredictions(predictions);
    if (predictions && predictions.length > 0) {
      const predFingerprint = `${predictions[0].date}-${predictions[0].predicted_price}`;
      if (lastMLPredictionRef.current !== predFingerprint) {
        lastMLPredictionRef.current = predFingerprint;
        setDataTimestamps(prev => ({
          ...prev,
          mlModel: new Date(),
        }));
      }
    }
  }, []);

  // Callback to receive sentiment data from NewsPanel
  const handleSentimentChange = useCallback((items: NewsItemWithSentiment[]) => {
    setNewsWithSentiment(items);
    if (items.length > 0) {
      // Only update timestamp when news count changes or first item changes
      const newsFingerprint = `${items.length}-${items[0]?.headline?.substring(0, 20)}`;
      if (lastNewsCountRef.current !== items.length || newsFingerprint !== lastNewsCountRef.current.toString()) {
        lastNewsCountRef.current = items.length;
        setDataTimestamps(prev => ({
          ...prev,
          news: new Date(),
        }));
      }
    }
  }, []);

  // Callback to register news refresh function
  const handleNewsRefreshRegister = useCallback((refreshFn: () => void) => {
    newsRefreshRef.current = refreshFn;
  }, []);

  // Callback to register ML refresh function
  const handleMLRefreshRegister = useCallback((refreshFn: () => void) => {
    mlRefreshRef.current = refreshFn;
  }, []);

  // Unified refresh all data
  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Refresh financial data
      refetch();
      
      // Refresh news if callback registered
      if (newsRefreshRef.current) {
        newsRefreshRef.current();
      }
      
      // Refresh ML predictions if callback registered
      if (mlRefreshRef.current) {
        mlRefreshRef.current();
      }
    } finally {
      // Give some time for visual feedback
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  }, [refetch]);

  // Collapsible section states (default: collapsed)
  const [showIndicators, setShowIndicators] = useState(false);
  const [showChart, setShowChart] = useState(false);

  // Chart indicator toggles
  const [showSMA20, setShowSMA20] = useState(true);
  const [showSMA50, setShowSMA50] = useState(true);
  const [showEMA12, setShowEMA12] = useState(false);
  const [showEMA26, setShowEMA26] = useState(false);
  const [showBollingerBands, setShowBollingerBands] = useState(false);
  const [showMACD, setShowMACD] = useState(true);
  const [showRSI, setShowRSI] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  // Generate forecast when stock data changes (derived state)
  const forecast = useMemo(() => {
    if (stockData && stockData.data.length > 0) {
      return generateForecast(stockData.data);
    }
    return null;
  }, [stockData]);

  const handleIndicatorToggle = (indicator: string, value: boolean) => {
    switch (indicator) {
      case 'showSMA20': setShowSMA20(value); break;
      case 'showSMA50': setShowSMA50(value); break;
      case 'showEMA12': setShowEMA12(value); break;
      case 'showEMA26': setShowEMA26(value); break;
      case 'showBollingerBands': setShowBollingerBands(value); break;
      case 'showMACD': setShowMACD(value); break;
      case 'showRSI': setShowRSI(value); break;
      case 'showVolume': setShowVolume(value); break;
    }
  };

  const currentPrice = useMemo(() => {
    if (!stockData || stockData.data.length === 0) return 0;
    return stockData.data[stockData.data.length - 1].close;
  }, [stockData]);

  const priceChange = useMemo(() => {
    if (!stockData || stockData.data.length < 2) return { value: 0, percent: 0 };
    const current = stockData.data[stockData.data.length - 1].close;
    const previous = stockData.data[stockData.data.length - 2].close;
    const change = current - previous;
    const percent = (change / previous) * 100;
    return { value: change, percent };
  }, [stockData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Loading analysis...</p>
        </div>
      </div>
    );
  }

  if (!stockData || !forecast) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-400">No data available for {selectedSymbol}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex-1">
      {/* Price Header */}
      <div className="bg-slate-800/50 rounded-xl p-4 sm:p-6 border border-slate-700 mb-6">
        <div className="flex flex-col gap-4">
          {/* Top row: Stock Selector + Data Freshness */}
          <div className="flex items-center justify-between gap-2">
            <StockSelector selectedSymbol={selectedSymbol} onSelect={onSymbolChange} />
            <DataFreshnessIndicator 
              timestamps={dataTimestamps}
              onRefresh={handleRefreshAll}
              isRefreshing={isRefreshing}
            />
          </div>
          {/* Bottom row: Symbol info + Price */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-xl sm:text-2xl font-bold">{stockData.symbol}</h2>
              <span className="text-gray-400 text-sm sm:text-base truncate">{stockData.name}</span>
              {preferredSource !== 'mock' && (
                <span className="px-2 py-0.5 bg-green-600/20 text-green-400 text-xs rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live ({source})
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-2 sm:gap-3">
              <span className="text-3xl sm:text-4xl font-bold">${currentPrice.toFixed(2)}</span>
              <span className={`text-base sm:text-lg font-semibold ${priceChange.value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {priceChange.value >= 0 ? '+' : ''}{priceChange.value.toFixed(2)} ({priceChange.percent >= 0 ? '+' : ''}{priceChange.percent.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Trading Signals - Full Width at Top */}
      <TradingSignalPanel 
        newsItems={newsWithSentiment.map(item => ({
          sentimentResult: item.sentimentResult,
          datetime: item.datetime
        }))}
        symbol={selectedSymbol}
        className="mb-6"
        forecast={forecast ?? undefined}
        stockData={stockData?.data}
        mlPredictions={mlPredictions ?? undefined}
        currentPrice={currentPrice}
      />

      {/* AI Forecast and News Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 items-stretch">
        {/* Forecast Panels */}
        <div className="space-y-4">
          <ForecastPanel forecast={forecast} currentPrice={currentPrice} />
          <MLForecastPanel 
            symbol={selectedSymbol} 
            stockData={stockData?.data ?? []} 
            onPredictionsChange={handleMLPredictionsChange}
            onRefreshRegister={handleMLRefreshRegister}
          />
        </div>

        {/* News Panel */}
        <div className="h-full">
          <NewsPanel 
            symbol={selectedSymbol} 
            className="h-full"
            onSentimentChange={handleSentimentChange}
            onRefreshRegister={handleNewsRefreshRegister}
          />
        </div>
      </div>

      {/* Indicator Controls - Collapsible */}
      <div className="mb-6">
        <div className="bg-slate-800/50 rounded-xl border border-slate-700">
          <button
            onClick={() => setShowIndicators(!showIndicators)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <h3 className="text-white font-semibold">Chart Indicators</h3>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showIndicators ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showIndicators && (
            <div className="px-4 pb-4">
              <IndicatorControls
                showSMA20={showSMA20}
                showSMA50={showSMA50}
                showEMA12={showEMA12}
                showEMA26={showEMA26}
                showBollingerBands={showBollingerBands}
                showMACD={showMACD}
                showRSI={showRSI}
                showVolume={showVolume}
                onToggle={handleIndicatorToggle}
              />
            </div>
          )}
        </div>
      </div>

      {/* Chart - Collapsible, Full Width */}
      <div className="mb-6">
        <div className="bg-slate-800/50 rounded-xl border border-slate-700">
          <button
            onClick={() => setShowChart(!showChart)}
            className="w-full flex items-center justify-between p-6 text-left"
          >
            <h3 className="text-white font-semibold">Chart</h3>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showChart ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showChart && (
            <div className="px-6 pb-6">
              <StockChart
                data={stockData.data}
                symbol={stockData.symbol}
                showSMA20={showSMA20}
                showSMA50={showSMA50}
                showEMA12={showEMA12}
                showEMA26={showEMA26}
                showBollingerBands={showBollingerBands}
                showMACD={showMACD}
                showRSI={showRSI}
                showVolume={showVolume}
                supportLevel={forecast.supportLevel}
                resistanceLevel={forecast.resistanceLevel}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
