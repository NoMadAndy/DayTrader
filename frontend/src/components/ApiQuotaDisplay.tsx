/**
 * API Quota Display Components
 * 
 * Shows API usage quota information.
 */

interface ApiQuotaDisplayProps {
  used?: number;
  limit?: number;
  label?: string;
}

export function ApiQuotaDisplay({ used = 0, limit = 100, label = 'API Quota' }: ApiQuotaDisplayProps) {
  const percentage = limit > 0 ? (used / limit) * 100 : 0;
  const isWarning = percentage > 80;
  const isDanger = percentage > 95;
  
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-400">{label}</span>
        <span className={`text-sm font-medium ${isDanger ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-green-400'}`}>
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div 
          className={`h-full transition-all ${isDanger ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500'}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function ApiQuotaCompact({ used = 0, limit = 100 }: Omit<ApiQuotaDisplayProps, 'label'>) {
  const percentage = limit > 0 ? (used / limit) * 100 : 0;
  const isDanger = percentage > 95;
  const isWarning = percentage > 80;
  
  return (
    <span className={`text-xs ${isDanger ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-gray-400'}`}>
      API: {used}/{limit}
    </span>
  );
}

export default ApiQuotaDisplay;
