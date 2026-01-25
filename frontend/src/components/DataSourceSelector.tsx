/**
 * Data Source Selector Component
 * 
 * Allows users to select their preferred data source and
 * displays the current data source status.
 */

import { useDataService } from '../hooks';
import type { DataSourceType } from '../services/types';

const SOURCE_LABELS: Record<DataSourceType, string> = {
  finnhub: '📈 Finnhub',
  alphaVantage: '📉 Alpha Vantage',
  twelveData: '📊 Twelve Data',
  yahoo: '🌐 Yahoo Finance',
};

const SOURCE_DESCRIPTIONS: Record<DataSourceType, string> = {
  finnhub: 'Real-time market data',
  alphaVantage: 'Free stock data API',
  twelveData: 'Financial data platform',
  yahoo: 'Yahoo Finance (may have CORS issues)',
};

interface DataSourceSelectorProps {
  collapsed?: boolean;
}

export function DataSourceSelector({ collapsed }: DataSourceSelectorProps) {
  const { availableSources, preferredSource, setPreferredSource } = useDataService();

  // When used inside a collapsible wrapper, render without its own container
  if (collapsed) {
    return (
      <>
        <div className="space-y-2">
          {availableSources.map((source) => (
            <button
              key={source}
              onClick={() => setPreferredSource(source)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                preferredSource === source
                  ? 'bg-blue-600/30 border border-blue-500/50 text-blue-300'
                  : 'bg-slate-700/30 border border-slate-600/50 text-gray-300 hover:bg-slate-700/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{SOURCE_LABELS[source]}</span>
                {preferredSource === source && (
                  <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{SOURCE_DESCRIPTIONS[source]}</p>
            </button>
          ))}
        </div>

        <div className="mt-3 p-2 bg-green-900/20 rounded-lg border border-green-700/30">
          <div className="flex items-center gap-2 text-green-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span>Live data enabled</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
        <h3 className="font-semibold text-white">Data Source</h3>
      </div>
      
      <div className="space-y-2">
        {availableSources.map((source) => (
          <button
            key={source}
            onClick={() => setPreferredSource(source)}
            className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
              preferredSource === source
                ? 'bg-blue-600/30 border border-blue-500/50 text-blue-300'
                : 'bg-slate-700/30 border border-slate-600/50 text-gray-300 hover:bg-slate-700/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{SOURCE_LABELS[source]}</span>
              {preferredSource === source && (
                <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{SOURCE_DESCRIPTIONS[source]}</p>
          </button>
        ))}
      </div>

      <div className="mt-3 p-2 bg-green-900/20 rounded-lg border border-green-700/30">
        <div className="flex items-center gap-2 text-green-400 text-xs">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>Live data enabled</span>
        </div>
      </div>
    </div>
  );
}
