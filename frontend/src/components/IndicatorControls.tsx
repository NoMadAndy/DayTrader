interface IndicatorControlsProps {
  showSMA20: boolean;
  showSMA50: boolean;
  showEMA12: boolean;
  showEMA26: boolean;
  showBollingerBands: boolean;
  showMACD: boolean;
  showRSI: boolean;
  showVolume: boolean;
  onToggle: (indicator: string, value: boolean) => void;
}

export function IndicatorControls({
  showSMA20,
  showSMA50,
  showEMA12,
  showEMA26,
  showBollingerBands,
  showMACD,
  showRSI,
  showVolume,
  onToggle,
}: IndicatorControlsProps) {
  const indicators = [
    { key: 'showSMA20', label: 'SMA 20', value: showSMA20, color: 'bg-amber-500' },
    { key: 'showSMA50', label: 'SMA 50', value: showSMA50, color: 'bg-violet-500' },
    { key: 'showEMA12', label: 'EMA 12', value: showEMA12, color: 'bg-cyan-500' },
    { key: 'showEMA26', label: 'EMA 26', value: showEMA26, color: 'bg-pink-500' },
    { key: 'showBollingerBands', label: 'Bollinger Bands', value: showBollingerBands, color: 'bg-gray-400' },
    { key: 'showMACD', label: 'MACD', value: showMACD, color: 'bg-blue-500' },
    { key: 'showRSI', label: 'RSI', value: showRSI, color: 'bg-purple-500' },
    { key: 'showVolume', label: 'Volume', value: showVolume, color: 'bg-blue-400' },
  ];

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
      <h3 className="text-white font-semibold mb-3">Chart Indicators</h3>
      <div className="flex flex-wrap gap-2">
        {indicators.map((indicator) => (
          <button
            key={indicator.key}
            onClick={() => onToggle(indicator.key, !indicator.value)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              indicator.value
                ? 'bg-slate-700 text-white'
                : 'bg-slate-900/50 text-gray-400 hover:bg-slate-700/50'
            }`}
          >
            <span className={`w-3 h-3 rounded-full ${indicator.value ? indicator.color : 'bg-gray-600'}`} />
            {indicator.label}
          </button>
        ))}
      </div>
    </div>
  );
}
