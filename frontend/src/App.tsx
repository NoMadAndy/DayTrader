import { useState, useMemo } from 'react';
import { StockChart, ForecastPanel, StockSelector, IndicatorControls, DataSourceSelector, NewsPanel, ApiConfigPanel } from './components';
import { DataServiceProvider, useStockData, useDataService } from './hooks';
import { generateForecast } from './utils/forecast';

// Build info from Vite config
declare const __BUILD_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

function AppContent() {
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const { data: stockData, isLoading, source, refetch } = useStockData(selectedSymbol);
  const { preferredSource } = useDataService();

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                  DayTrader AI
                </h1>
              </div>
              <span className="text-xs text-gray-500 hidden sm:block">Technical Analysis Platform</span>
            </div>
            <div className="flex items-center gap-3">
              <StockSelector selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} />
              <ApiConfigPanel />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-96">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">Loading analysis...</p>
            </div>
          </div>
        ) : stockData && forecast ? (
          <>
            {/* Price Header */}
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold">{stockData.symbol}</h2>
                    <span className="text-gray-400">{stockData.name}</span>
                    {preferredSource !== 'mock' && (
                      <span className="px-2 py-0.5 bg-green-600/20 text-green-400 text-xs rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        Live ({source})
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-4xl font-bold">${currentPrice.toFixed(2)}</span>
                    <span className={`text-lg font-semibold ${priceChange.value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {priceChange.value >= 0 ? '+' : ''}{priceChange.value.toFixed(2)} ({priceChange.percent >= 0 ? '+' : ''}{priceChange.percent.toFixed(2)}%)
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    onClick={refetch}
                    className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-gray-400 hover:text-white transition-colors"
                    title="Refresh data"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Last updated: {new Date().toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Indicator Controls */}
            <div className="mb-6">
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

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Chart */}
              <div className="lg:col-span-2 bg-slate-800/50 rounded-xl p-6 border border-slate-700">
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

              {/* Forecast Panel */}
              <div className="lg:col-span-1">
                <ForecastPanel forecast={forecast} currentPrice={currentPrice} />
              </div>
            </div>

            {/* News and Data Source Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
              {/* News Panel */}
              <div className="lg:col-span-2">
                <NewsPanel symbol={selectedSymbol} />
              </div>

              {/* Data Source Selector */}
              <div className="lg:col-span-1">
                <DataSourceSelector />
              </div>
            </div>

            {/* Technical Analysis Documentation */}
            <div className="mt-6 bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <h3 className="text-xl font-bold mb-4">Technical Analysis Methods Used</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-400 mb-2">Trend Indicators</h4>
                  <ul className="text-sm text-gray-300 space-y-1">
                    <li>• <strong>SMA (Simple Moving Average):</strong> Average price over N periods</li>
                    <li>• <strong>EMA (Exponential MA):</strong> Weighted average favoring recent prices</li>
                  </ul>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <h4 className="font-semibold text-purple-400 mb-2">Momentum Indicators</h4>
                  <ul className="text-sm text-gray-300 space-y-1">
                    <li>• <strong>RSI:</strong> Measures overbought/oversold (0-100)</li>
                    <li>• <strong>MACD:</strong> Trend-following momentum indicator</li>
                    <li>• <strong>Stochastic:</strong> Compares close to price range</li>
                  </ul>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <h4 className="font-semibold text-amber-400 mb-2">Volatility & Volume</h4>
                  <ul className="text-sm text-gray-300 space-y-1">
                    <li>• <strong>Bollinger Bands:</strong> Volatility bands around SMA</li>
                    <li>• <strong>ATR:</strong> Average True Range for volatility</li>
                    <li>• <strong>OBV/VWAP:</strong> Volume-based indicators</li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-96">
            <p className="text-gray-400">No data available for {selectedSymbol}</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-700/50 mt-8 py-6">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
            <div>
              <p>⚠️ <strong>Disclaimer:</strong> This is for educational/testing purposes only. Not financial advice.</p>
            </div>
            <div className="flex items-center gap-4">
              <span>v{__BUILD_VERSION__}</span>
              <span>•</span>
              <span>{__BUILD_COMMIT__}</span>
              <span>•</span>
              <span>{new Date(__BUILD_TIME__).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <DataServiceProvider>
      <AppContent />
    </DataServiceProvider>
  );
}

export default App;

