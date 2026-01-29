/**
 * News API Quota Display Component
 * 
 * Shows remaining API quota for each configured news provider.
 * Helps users understand their news API usage and avoid rate limits.
 */

import { useState, useEffect } from 'react';
import { useDataService } from '../hooks/useDataService';
import { NEWS_PROVIDER_RATE_LIMITS, type NewsProviderType } from '../services/rateLimiter';

interface QuotaInfo {
  daily: number;
  perMinute: number;
  config: typeof NEWS_PROVIDER_RATE_LIMITS[NewsProviderType];
}

const PROVIDER_DISPLAY_NAMES: Record<NewsProviderType, string> = {
  newsApi: 'NewsAPI',
  marketaux: 'Marketaux',
  fmp: 'FMP',
  tiingo: 'Tiingo',
  mediastack: 'mediastack',
  newsdata: 'NewsData.io',
  rss: 'RSS Feeds',
};

const PROVIDER_COLORS: Record<NewsProviderType, string> = {
  newsApi: '#10B981',
  marketaux: '#8B5CF6',
  fmp: '#F59E0B',
  tiingo: '#3B82F6',
  mediastack: '#EC4899',
  newsdata: '#14B8A6',
  rss: '#F97316',
};

export function NewsApiQuotaDisplay() {
  const { dataService } = useDataService();
  const [quotaInfo, setQuotaInfo] = useState<Record<string, QuotaInfo>>({});

  useEffect(() => {
    const updateQuota = () => {
      const info = dataService.getNewsProviderQuotaInfo();
      setQuotaInfo(info);
    };

    updateQuota();
    const interval = setInterval(updateQuota, 10000);
    return () => clearInterval(interval);
  }, [dataService]);

  const getQuotaPercentage = (remaining: number, total: number): number => {
    if (total === Infinity) return 100;
    return Math.round((remaining / total) * 100);
  };

  const getQuotaColor = (percentage: number): string => {
    if (percentage > 50) return '#22C55E';
    if (percentage > 20) return '#F59E0B';
    return '#EF4444';
  };

  const entries = Object.entries(quotaInfo) as [NewsProviderType, QuotaInfo][];
  
  if (entries.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <p className="text-sm text-gray-400">Keine News-Provider konfiguriert</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
        </svg>
        News Provider API Quota
      </h3>
      
      <div className="space-y-3">
        {entries.map(([source, info]) => {
          const dailyPct = getQuotaPercentage(info.daily, info.config.requestsPerDay);
          
          return (
            <div key={source}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <span 
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: PROVIDER_COLORS[source] }}
                  />
                  {PROVIDER_DISPLAY_NAMES[source]}
                </span>
                <span className="text-xs text-gray-400">
                  {info.config.requestsPerDay === Infinity 
                    ? '∞' 
                    : `${info.daily}/${info.config.requestsPerDay}`
                  } /Tag
                </span>
              </div>
              
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
              
              <div className="flex justify-between mt-1 text-[10px] text-gray-500">
                <span>{info.perMinute}/{info.config.requestsPerMinute} /min</span>
                <span>Cache: {Math.round(info.config.cacheDurationMs / 1000)}s</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
