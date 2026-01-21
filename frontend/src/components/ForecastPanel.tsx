import type { ForecastResult, TrendSignal } from '../types/stock';

interface ForecastPanelProps {
  forecast: ForecastResult;
  currentPrice: number;
}

function SignalBadge({ signal }: { signal: TrendSignal }) {
  const colors = {
    STRONG_BUY: 'bg-green-500 text-white',
    BUY: 'bg-green-400/80 text-white',
    NEUTRAL: 'bg-gray-500 text-white',
    SELL: 'bg-red-400/80 text-white',
    STRONG_SELL: 'bg-red-500 text-white',
  };

  const labels = {
    STRONG_BUY: 'Strong Buy',
    BUY: 'Buy',
    NEUTRAL: 'Neutral',
    SELL: 'Sell',
    STRONG_SELL: 'Strong Sell',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${colors[signal]}`}>
      {labels[signal]}
    </span>
  );
}

function SignalIcon({ signal }: { signal: TrendSignal }) {
  if (signal === 'STRONG_BUY' || signal === 'BUY') {
    return (
      <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    );
  }
  if (signal === 'STRONG_SELL' || signal === 'SELL') {
    return (
      <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
    </svg>
  );
}

export function ForecastPanel({ forecast, currentPrice }: ForecastPanelProps) {
  const priceChange = forecast.priceTarget - currentPrice;
  const priceChangePercent = (priceChange / currentPrice) * 100;

  return (
    <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">AI Forecast</h2>
        <SignalBadge signal={forecast.overallSignal} />
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">Current Price</div>
          <div className="text-white text-xl font-bold">${currentPrice.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">Price Target</div>
          <div className={`text-xl font-bold ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ${forecast.priceTarget.toFixed(2)}
            <span className="text-sm ml-1">
              ({priceChange >= 0 ? '+' : ''}{priceChangePercent.toFixed(1)}%)
            </span>
          </div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">Support Level</div>
          <div className="text-green-400 text-xl font-bold">${forecast.supportLevel.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">Resistance Level</div>
          <div className="text-red-400 text-xl font-bold">${forecast.resistanceLevel.toFixed(2)}</div>
        </div>
      </div>

      {/* Confidence Meter */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-400 text-sm">Indicator Agreement</span>
          <span className="text-white font-semibold">{forecast.confidence}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${
              forecast.confidence >= 70 ? 'bg-green-500' : 
              forecast.confidence >= 40 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${forecast.confidence}%` }}
          />
        </div>
      </div>

      {/* Summary */}
      <div className="bg-slate-900/50 rounded-lg p-4 mb-6">
        <h3 className="text-white font-semibold mb-2">Analysis Summary</h3>
        <p className="text-gray-300 text-sm leading-relaxed">{forecast.summary}</p>
      </div>

      {/* Indicator Details */}
      <div>
        <h3 className="text-white font-semibold mb-3">Technical Indicators</h3>
        <div className="space-y-3">
          {forecast.indicators.map((indicator, index) => (
            <div key={index} className="bg-slate-900/50 rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <SignalIcon signal={indicator.signal} />
                  <span className="text-white font-medium">{indicator.name}</span>
                </div>
                <SignalBadge signal={indicator.signal} />
              </div>
              <div className="text-gray-400 text-sm mb-2">{indicator.value}</div>
              <p className="text-gray-300 text-sm">{indicator.explanation}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
