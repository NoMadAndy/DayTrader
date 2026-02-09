/**
 * AI Trader Weight History Chart
 * 
 * Chart showing the history of signal weight changes.
 */

interface WeightHistoryEntry {
  timestamp: string;
  ml: number;
  rl: number;
  sentiment: number;
  technical: number;
}

interface AITraderWeightHistoryChartProps {
  history: WeightHistoryEntry[];
}

export function AITraderWeightHistoryChart({ history }: AITraderWeightHistoryChartProps) {
  if (!history || history.length === 0) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Gewichtungs-Verlauf</h3>
        <p className="text-sm text-gray-500 text-center py-4">Keine Historie verfügbar</p>
      </div>
    );
  }
  
  const latest = history[history.length - 1];
  
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4">
      <h3 className="text-sm font-medium text-gray-400 mb-3">Aktuelle Gewichtungen</h3>
      <div className="space-y-2">
        {[
          { label: 'ML', value: latest.ml, color: 'bg-blue-500' },
          { label: 'RL', value: latest.rl, color: 'bg-purple-500' },
          { label: 'Sentiment', value: latest.sentiment, color: 'bg-green-500' },
          { label: 'Technical', value: latest.technical, color: 'bg-yellow-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-20">{label}</span>
            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div 
                className={`h-full ${color} transition-all`}
                style={{ width: `${value * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium w-12 text-right">{(value * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-2">{history.length} Einträge im Verlauf</p>
    </div>
  );
}

export default AITraderWeightHistoryChart;
