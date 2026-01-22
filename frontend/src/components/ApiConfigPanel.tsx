/**
 * API Configuration Panel Component
 * 
 * Allows users to configure their API keys for data providers.
 * Keys are stored in localStorage for persistence.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDataService } from '../hooks';
import type { DataServiceConfig } from '../services/dataService';

const STORAGE_KEY = 'daytrader_api_config';

interface ApiConfig {
  finnhubApiKey: string;
  alphaVantageApiKey: string;
  twelveDataApiKey: string;
  newsApiKey: string;
}

function isValidApiConfig(obj: unknown): obj is ApiConfig {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as Record<string, unknown>).finnhubApiKey === 'string' &&
    typeof (obj as Record<string, unknown>).alphaVantageApiKey === 'string' &&
    typeof (obj as Record<string, unknown>).twelveDataApiKey === 'string' &&
    typeof (obj as Record<string, unknown>).newsApiKey === 'string'
  );
}

function loadStoredConfig(): ApiConfig {
  const defaultConfig: ApiConfig = {
    finnhubApiKey: '',
    alphaVantageApiKey: '',
    twelveDataApiKey: '',
    newsApiKey: '',
  };
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isValidApiConfig(parsed)) {
        return parsed;
      }
      console.warn('Invalid stored API config format, using defaults');
    }
  } catch (e) {
    console.warn('Failed to load stored API config:', e);
  }
  return defaultConfig;
}

function saveConfig(config: ApiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Failed to save API config:', e);
  }
}

// Get initial merged config from env and localStorage
function getInitialConfig(): ApiConfig {
  const stored = loadStoredConfig();
  const envConfig = {
    finnhubApiKey: (import.meta.env.VITE_FINNHUB_API_KEY as string) || '',
    alphaVantageApiKey: (import.meta.env.VITE_ALPHA_VANTAGE_API_KEY as string) || '',
    twelveDataApiKey: (import.meta.env.VITE_TWELVE_DATA_API_KEY as string) || '',
    newsApiKey: (import.meta.env.VITE_NEWS_API_KEY as string) || '',
  };
  
  return {
    finnhubApiKey: envConfig.finnhubApiKey || stored.finnhubApiKey,
    alphaVantageApiKey: envConfig.alphaVantageApiKey || stored.alphaVantageApiKey,
    twelveDataApiKey: envConfig.twelveDataApiKey || stored.twelveDataApiKey,
    newsApiKey: envConfig.newsApiKey || stored.newsApiKey,
  };
}

export function ApiConfigPanel() {
  const { setConfig } = useDataService();
  const [isOpen, setIsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<ApiConfig>(getInitialConfig);
  const [saved, setSaved] = useState(false);
  const hasAppliedInitialRef = useRef(false);

  const applyConfig = useCallback((config: ApiConfig) => {
    const serviceConfig: DataServiceConfig = {
      finnhubApiKey: config.finnhubApiKey || undefined,
      alphaVantageApiKey: config.alphaVantageApiKey || undefined,
      twelveDataApiKey: config.twelveDataApiKey || undefined,
      newsApiKey: config.newsApiKey || undefined,
      preferredSource: config.finnhubApiKey ? 'finnhub' : 
                       config.twelveDataApiKey ? 'twelveData' :
                       config.alphaVantageApiKey ? 'alphaVantage' : 'mock',
    };
    setConfig(serviceConfig);
  }, [setConfig]);

  // Apply initial config on mount (only once)
  useEffect(() => {
    if (!hasAppliedInitialRef.current) {
      hasAppliedInitialRef.current = true;
      const initial = getInitialConfig();
      if (initial.finnhubApiKey || initial.alphaVantageApiKey || initial.twelveDataApiKey) {
        applyConfig(initial);
      }
    }
  }, [applyConfig]);

  const handleSave = () => {
    saveConfig(localConfig);
    applyConfig(localConfig);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    const empty = {
      finnhubApiKey: '',
      alphaVantageApiKey: '',
      twelveDataApiKey: '',
      newsApiKey: '',
    };
    setLocalConfig(empty);
    saveConfig(empty);
    setConfig({ preferredSource: 'mock' });
  };

  const hasAnyKey = localConfig.finnhubApiKey || localConfig.alphaVantageApiKey || 
                    localConfig.twelveDataApiKey || localConfig.newsApiKey;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-lg transition-colors ${
          hasAnyKey 
            ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30' 
            : 'bg-slate-700/50 text-gray-400 hover:bg-slate-700'
        }`}
        title="Configure API Keys"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)} 
          />
          <div className="absolute right-0 top-full mt-2 w-96 bg-slate-800 rounded-xl border border-slate-700 shadow-xl z-50 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">API Configuration</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded hover:bg-slate-700 text-gray-400"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Finnhub API Key
                  <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                    (Get free key)
                  </a>
                </label>
                <input
                  type="password"
                  value={localConfig.finnhubApiKey}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, finnhubApiKey: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Enter Finnhub API key"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Alpha Vantage API Key
                  <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                    (Get free key)
                  </a>
                </label>
                <input
                  type="password"
                  value={localConfig.alphaVantageApiKey}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, alphaVantageApiKey: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Enter Alpha Vantage API key"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Twelve Data API Key
                  <a href="https://twelvedata.com/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                    (Get free key)
                  </a>
                </label>
                <input
                  type="password"
                  value={localConfig.twelveDataApiKey}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, twelveDataApiKey: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Enter Twelve Data API key"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  NewsAPI Key
                  <a href="https://newsapi.org/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                    (Get free key)
                  </a>
                </label>
                <input
                  type="password"
                  value={localConfig.newsApiKey}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, newsApiKey: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Enter NewsAPI key"
                />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={handleSave}
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                  saved 
                    ? 'bg-green-600 text-white' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {saved ? '✓ Saved!' : 'Save & Apply'}
              </button>
              <button
                onClick={handleClear}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-gray-300 font-medium transition-colors"
              >
                Clear All
              </button>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Keys are stored locally in your browser. You can also set them via environment variables (VITE_FINNHUB_API_KEY, etc).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
