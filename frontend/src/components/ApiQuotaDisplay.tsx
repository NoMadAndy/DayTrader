/**
 * API Quota Display Component
 * 
 * Shows remaining API quota for each configured provider.
 * Helps users understand their API usage and avoid rate limits.
 */

import { useState, useEffect } from 'react';
import { useDataService } from '../hooks/useDataService';
import type { DataSourceType } from '../services/types';
import { PROVIDER_RATE_LIMITS } from '../services/rateLimiter';

interface QuotaInfo {
  daily: number;
  perMinute: number;
  config: typeof PROVIDER_RATE_LIMITS[DataSourceType];
}

const PROVIDER_DISPLAY_NAMES: Record<DataSourceType, string> = {
  finnhub: 'Finnhub',
  alphaVantage: 'Alpha Vantage',
  twelveData: 'Twelve Data',
  yahoo: 'Yahoo Finance'
};

const PROVIDER_COLORS: Record<DataSourceType, string> = {
  finnhub: '#00D4AA',
  alphaVantage: '#FFB800',
  twelveData: '#6366F1',
  yahoo: '#7C3AED'
};

export function ApiQuotaDisplay() {
  const { dataService, preferredSource } = useDataService();
  const [quotaInfo, setQuotaInfo] = useState<Record<string, QuotaInfo>>({});

  useEffect(() => {
    // Initial load
    const updateQuota = () => {
      const info = dataService.getQuotaInfo();
      setQuotaInfo(info);
    };

    updateQuota();

    // Subscribe to rate limiter updates
    const rateLimiter = dataService.getRateLimiter();
    const unsubscribe = rateLimiter.subscribe(() => {
      updateQuota();
    });

    // Update every 10 seconds
    const interval = setInterval(updateQuota, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [dataService]);

  const getQuotaPercentage = (remaining: number, total: number): number => {
    if (total === Infinity) return 100;
    return Math.round((remaining / total) * 100);
  };

  const getQuotaColor = (percentage: number): string => {
    if (percentage > 50) return '#22C55E'; // green
    if (percentage > 20) return '#F59E0B'; // yellow
    return '#EF4444'; // red
  };

  const entries = Object.entries(quotaInfo) as [DataSourceType, QuotaInfo][];
  
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        API Quota
      </h3>
      
      <div className="space-y-3">
        {entries.map(([source, info]) => {
          const dailyPct = getQuotaPercentage(info.daily, info.config.requestsPerDay);
          const isPreferred = source === preferredSource;
          
          return (
            <div key={source} className={`${isPreferred ? 'bg-gray-700/50 rounded p-2 -mx-2' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <span 
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: PROVIDER_COLORS[source] }}
                  />
                  {PROVIDER_DISPLAY_NAMES[source]}
                  {isPreferred && (
                    <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1 rounded">
                      aktiv
                    </span>
                  )}
                </span>
                <span className="text-xs text-gray-400">
                  {info.config.requestsPerDay === Infinity 
                    ? '∞' 
                    : `${info.daily}/${info.config.requestsPerDay}`
                  } /Tag
                </span>
              </div>
              
              {/* Daily quota bar */}
              {info.config.requestsPerDay !== Infinity && (
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full transition-all duration-300"
                    style={{ 
                      width: `${dailyPct}%`,
                      backgroundColor: getQuotaColor(dailyPct)
                    }}
                  />
                </div>
              )}
              
              {/* Per-minute info */}
              <div className="flex justify-between mt-1 text-[10px] text-gray-500">
                <span>{info.perMinute}/{info.config.requestsPerMinute} /min</span>
                <span>Cache: {Math.round(info.config.cacheDurationMs / 1000)}s</span>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Legend */}
      <div className="mt-3 pt-3 border-t border-gray-700 text-[10px] text-gray-500">
        <p>💡 Daten werden gecached um API-Aufrufe zu minimieren.</p>
      </div>
    </div>
  );
}

/**
 * Compact version for header/navbar
 */
export function ApiQuotaCompact() {
  const { dataService, preferredSource } = useDataService();
  const [quotaInfo, setQuotaInfo] = useState<Record<string, QuotaInfo>>({});

  useEffect(() => {
    const updateQuota = () => {
      const info = dataService.getQuotaInfo();
      setQuotaInfo(info);
    };

    updateQuota();
    const rateLimiter = dataService.getRateLimiter();
    const unsubscribe = rateLimiter.subscribe(() => updateQuota());
    const interval = setInterval(updateQuota, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [dataService]);

  // Show only preferred source
  const info = quotaInfo[preferredSource];
  if (!info) return null;

  const config = PROVIDER_RATE_LIMITS[preferredSource];
  const dailyPct = config.requestsPerDay === Infinity 
    ? 100 
    : Math.round((info.daily / config.requestsPerDay) * 100);

  const getStatusColor = (pct: number) => {
    if (pct > 50) return 'text-green-400';
    if (pct > 20) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400">
      <span 
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: PROVIDER_COLORS[preferredSource] }}
      />
      <span className={getStatusColor(dailyPct)}>
        {config.requestsPerDay === Infinity ? '∞' : `${info.daily}`}
      </span>
    </div>
  );
}
