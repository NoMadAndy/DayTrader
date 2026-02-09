/**
 * Data Freshness Indicator Component
 * 
 * Shows how fresh the displayed data is.
 */

interface DataFreshnessIndicatorProps {
  lastUpdate?: Date | string | null;
  staleThresholdMs?: number;
}

export function DataFreshnessIndicator({ 
  lastUpdate, 
  staleThresholdMs = 60000 
}: DataFreshnessIndicatorProps) {
  if (!lastUpdate) {
    return (
      <span className="text-xs text-gray-500">Keine Daten</span>
    );
  }
  
  const updateTime = typeof lastUpdate === 'string' ? new Date(lastUpdate) : lastUpdate;
  const ageMs = Date.now() - updateTime.getTime();
  const isStale = ageMs > staleThresholdMs;
  
  const formatAge = (ms: number) => {
    if (ms < 60000) return 'Gerade eben';
    if (ms < 3600000) return `vor ${Math.floor(ms / 60000)} Min`;
    return `vor ${Math.floor(ms / 3600000)} Std`;
  };
  
  return (
    <span className={`text-xs ${isStale ? 'text-yellow-400' : 'text-green-400'}`}>
      {isStale ? '⚠️ ' : '✓ '}{formatAge(ageMs)}
    </span>
  );
}

export default DataFreshnessIndicator;
