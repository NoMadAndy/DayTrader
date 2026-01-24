/**
 * Data Freshness Indicator Component
 * 
 * Shows the age of different data sources (financial data, news, ML models)
 * with color coding based on freshness. Clicking refreshes all data.
 */

import { useState, useEffect, useMemo } from 'react';

export interface DataTimestamps {
  financial?: Date | null;
  news?: Date | null;
  mlModel?: Date | null;
}

interface DataFreshnessIndicatorProps {
  timestamps: DataTimestamps;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

type FreshnessLevel = 'fresh' | 'stale' | 'old' | 'unknown';

interface FreshnessConfig {
  level: FreshnessLevel;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}

const FRESHNESS_CONFIGS: Record<FreshnessLevel, FreshnessConfig> = {
  fresh: {
    level: 'fresh',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    borderColor: 'border-green-500/30',
    label: 'Aktuell',
  },
  stale: {
    level: 'stale',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    borderColor: 'border-yellow-500/30',
    label: 'Nicht ganz aktuell',
  },
  old: {
    level: 'old',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/30',
    label: 'Veraltet',
  },
  unknown: {
    level: 'unknown',
    color: 'text-gray-400',
    bgColor: 'bg-slate-700/50',
    borderColor: 'border-slate-600',
    label: 'Unbekannt',
  },
};

// Thresholds in milliseconds
const THRESHOLDS = {
  financial: {
    fresh: 5 * 60 * 1000,    // 5 minutes
    stale: 30 * 60 * 1000,   // 30 minutes
  },
  news: {
    fresh: 15 * 60 * 1000,   // 15 minutes
    stale: 60 * 60 * 1000,   // 1 hour
  },
  mlModel: {
    fresh: 24 * 60 * 60 * 1000,    // 24 hours
    stale: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

function getAgeInMs(timestamp: Date | null | undefined): number | null {
  if (!timestamp) return null;
  return Date.now() - timestamp.getTime();
}

function getFreshnessLevel(
  ageMs: number | null,
  thresholds: { fresh: number; stale: number }
): FreshnessLevel {
  if (ageMs === null) return 'unknown';
  if (ageMs < thresholds.fresh) return 'fresh';
  if (ageMs < thresholds.stale) return 'stale';
  return 'old';
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return '—';
  
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatFullAge(ageMs: number | null): string {
  if (ageMs === null) return 'Noch nicht geladen';
  
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
  if (hours > 0) return `vor ${hours} Stunde${hours > 1 ? 'n' : ''}`;
  if (minutes > 0) return `vor ${minutes} Minute${minutes > 1 ? 'n' : ''}`;
  return 'gerade eben';
}

export function DataFreshnessIndicator({ 
  timestamps, 
  onRefresh, 
  isRefreshing = false 
}: DataFreshnessIndicatorProps) {
  // Force re-render every 10 seconds to update ages
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const dataItems = useMemo(() => {
    const financialAge = getAgeInMs(timestamps.financial);
    const newsAge = getAgeInMs(timestamps.news);
    const mlAge = getAgeInMs(timestamps.mlModel);

    return [
      {
        label: 'Kurse',
        icon: '📊',
        age: financialAge,
        freshness: getFreshnessLevel(financialAge, THRESHOLDS.financial),
      },
      {
        label: 'News',
        icon: '📰',
        age: newsAge,
        freshness: getFreshnessLevel(newsAge, THRESHOLDS.news),
      },
      {
        label: 'ML',
        icon: '🤖',
        age: mlAge,
        freshness: getFreshnessLevel(mlAge, THRESHOLDS.mlModel),
      },
    ];
  }, [timestamps]);

  // Overall freshness is the worst of all sources
  const overallFreshness = useMemo(() => {
    const levels: FreshnessLevel[] = dataItems.map(d => d.freshness);
    if (levels.includes('old')) return 'old';
    if (levels.includes('stale')) return 'stale';
    if (levels.includes('unknown')) return 'unknown';
    return 'fresh';
  }, [dataItems]);

  const overallConfig = FRESHNESS_CONFIGS[overallFreshness];

  // Find oldest timestamp for display
  const oldestAge = useMemo(() => {
    const ages = dataItems.map(d => d.age).filter((a): a is number => a !== null);
    if (ages.length === 0) return null;
    return Math.max(...ages);
  }, [dataItems]);

  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (showDetails) {
            onRefresh();
            setShowDetails(false);
          } else {
            setShowDetails(true);
          }
        }}
        disabled={isRefreshing}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
          isRefreshing 
            ? 'bg-slate-700/50 border-slate-600 cursor-wait' 
            : `${overallConfig.bgColor} ${overallConfig.borderColor} hover:brightness-110`
        }`}
        title={showDetails ? 'Klicken zum Aktualisieren' : 'Klicken für Details'}
      >
        {isRefreshing ? (
          <svg className="w-4 h-4 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className={`w-4 h-4 ${overallConfig.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
        
        <div className="flex items-center gap-1.5">
          {dataItems.map((item) => (
            <span
              key={item.label}
              className={`text-xs ${FRESHNESS_CONFIGS[item.freshness].color}`}
              title={`${item.label}: ${formatFullAge(item.age)}`}
            >
              {item.icon}
            </span>
          ))}
        </div>

        <span className={`text-sm font-medium ${overallConfig.color}`}>
          {isRefreshing ? 'Lädt...' : formatAge(oldestAge)}
        </span>
      </button>

      {/* Dropdown Details */}
      {showDetails && !isRefreshing && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowDetails(false)} 
          />
          <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 rounded-xl border border-slate-700 shadow-xl z-50 overflow-hidden">
            <div className="p-3 border-b border-slate-700 bg-slate-900/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">Daten-Aktualität</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${overallConfig.bgColor} ${overallConfig.color}`}>
                  {overallConfig.label}
                </span>
              </div>
            </div>

            <div className="p-3 space-y-2">
              {dataItems.map(item => {
                const config = FRESHNESS_CONFIGS[item.freshness];
                return (
                  <div 
                    key={item.label}
                    className={`flex items-center justify-between p-2 rounded-lg ${config.bgColor}`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{item.icon}</span>
                      <span className="text-sm text-gray-300">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${config.color}`}>
                        {formatFullAge(item.age)}
                      </span>
                      <div className={`w-2 h-2 rounded-full ${
                        item.freshness === 'fresh' ? 'bg-green-400' :
                        item.freshness === 'stale' ? 'bg-yellow-400' :
                        item.freshness === 'old' ? 'bg-red-400' : 'bg-gray-400'
                      }`} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 border-t border-slate-700">
              <button
                onClick={() => {
                  onRefresh();
                  setShowDetails(false);
                }}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Alle Daten aktualisieren
              </button>
            </div>

            <div className="px-3 pb-3">
              <div className="text-xs text-gray-500 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span>Kurse: &lt;5min, News: &lt;15min, ML: &lt;24h</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" />
                  <span>Kurse: &lt;30min, News: &lt;1h, ML: &lt;7d</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  <span>Älter als oben genannte Zeiten</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
