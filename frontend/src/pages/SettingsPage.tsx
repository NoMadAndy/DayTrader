/**
 * Settings Page
 * 
 * Combined settings for API keys, ML configuration, and data sources.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDataService } from '../hooks';
import { useSettings, type Language, type Currency } from '../contexts';
import { DataSourceSelector } from '../components/DataSourceSelector';
import { SignalSourceSettingsPanel } from '../components/SignalSourceSettings';
import { subscribeToAuth, getAuthState, getAuthHeaders, logout, checkAuthStatus, type AuthState } from '../services/authService';
import { getUserSettings, updateUserSettings, DEFAULT_ML_SETTINGS, type MLSettings } from '../services/userSettingsService';
import { LoginForm } from '../components/LoginForm';
import { RegisterForm } from '../components/RegisterForm';
import type { DataServiceConfig } from '../services/dataService';

const STORAGE_KEY = 'daytrader_api_config';

interface ApiConfig {
  finnhubApiKey: string;
  alphaVantageApiKey: string;
  twelveDataApiKey: string;
  newsApiKey: string;
  // New provider keys
  marketauxApiKey: string;
  fmpApiKey: string;
  tiingoApiKey: string;
  mediastackApiKey: string;
  newsdataApiKey: string;
  enableRssFeeds: boolean;
  // Enable/disable toggles for news providers
  enableNewsApi: boolean;
  enableMarketaux: boolean;
  enableFmp: boolean;
  enableTiingo: boolean;
  enableMediastack: boolean;
  enableNewsdata: boolean;
}

function loadStoredConfig(): ApiConfig {
  const defaultConfig: ApiConfig = {
    finnhubApiKey: '',
    alphaVantageApiKey: '',
    twelveDataApiKey: '',
    newsApiKey: '',
    marketauxApiKey: '',
    fmpApiKey: '',
    tiingoApiKey: '',
    mediastackApiKey: '',
    newsdataApiKey: '',
    enableRssFeeds: true, // RSS feeds enabled by default (no API key required)
    enableNewsApi: true,
    enableMarketaux: true,
    enableFmp: true,
    enableTiingo: true,
    enableMediastack: true,
    enableNewsdata: true,
  };
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaultConfig, ...parsed };
    }
  } catch {
    console.warn('Failed to load stored API config');
  }
  return defaultConfig;
}

function saveConfig(config: ApiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.warn('Failed to save API config');
  }
}

type SettingsTab = 'api' | 'ml' | 'signals' | 'auth' | 'preferences' | 'system';

// ============================================================================
// System Status Interfaces
// ============================================================================

interface CacheStats {
  enabled: boolean;
  message?: string;
  total?: {
    total_entries: string;
    total_hits: string;
    cache_size: string;
  };
  byType?: Array<{
    cache_type: string;
    entries: string;
    total_hits: string;
  }>;
  rateLimits?: RateLimitStatus;
}

interface RateLimitStatus {
  [provider: string]: {
    requestsToday: number;
    requestsThisMinute: number;
    limitsPerDay: number | null;
    limitsPerMinute: number;
    remainingToday: number | null;
    remainingThisMinute: number;
    canRequest: boolean;
  };
}

interface JobStatus {
  isRunning: boolean;
  lastQuoteUpdate?: string;
  lastCacheCleanup?: string;
  nextQuoteUpdate?: string;
  config?: {
    quoteUpdateIntervalSeconds: number;
    cacheCleanupIntervalSeconds: number;
    quoteBatchSize: number;
    maxSymbolsPerCycle: number;
    defaultSymbols: string[];
  };
  stats?: {
    cycleCount: number;
    successfulUpdates: number;
    failedUpdates: number;
    lastError: string | null;
  };
}

interface StreamStats {
  activeConnections: number;
  quoteStreams?: {
    count: number;
    clients: Array<{
      clientId: string;
      symbols: string[];
      connectedAt: string;
    }>;
  };
  aiTraderStreams?: {
    count: number;
    clients: Array<{
      id: string;
      subscribedTraders: number[];
      lastActivity: number;
    }>;
  };
}

interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  version?: string;
  uptime?: number;
  error?: string;
}

export function SettingsPage() {
  const { setConfig } = useDataService();
  const { t, language, currency, setLanguage, setCurrency } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>('auth');
  const [localConfig, setLocalConfig] = useState<ApiConfig>(loadStoredConfig);
  const [saved, setSaved] = useState(false);
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [showRegister, setShowRegister] = useState(false);
  const [mlSettings, setMlSettings] = useState<MLSettings>({ ...DEFAULT_ML_SETTINGS });
  const [mlSettingsSaved, setMlSettingsSaved] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);
  
  // System Status State
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimitStatus | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [mlHealth, setMlHealth] = useState<ServiceHealth | null>(null);
  const [rlHealth, setRlHealth] = useState<ServiceHealth | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [lastSystemRefresh, setLastSystemRefresh] = useState<Date | null>(null);

  // Subscribe to auth state changes
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Load user settings when authenticated
  useEffect(() => {
    if (authState.isAuthenticated) {
      getUserSettings().then(settings => {
        if (settings) {
          setMlSettings(settings.mlSettings || { ...DEFAULT_ML_SETTINGS });
          if (settings.apiKeys && Object.keys(settings.apiKeys).length > 0) {
            // Parse enableRssFeeds - handle both string and boolean-like values from server
            // Server stores as Record<string, string>, but may return boolean-ish values
            const rssValue = settings.apiKeys.enableRssFeeds;
            const enableRss = rssValue === undefined || rssValue === 'true' || String(rssValue) === 'true';
            
            const serverConfig: ApiConfig = {
              finnhubApiKey: settings.apiKeys.finnhub || '',
              alphaVantageApiKey: settings.apiKeys.alphaVantage || '',
              twelveDataApiKey: settings.apiKeys.twelveData || '',
              newsApiKey: settings.apiKeys.newsApi || '',
              marketauxApiKey: settings.apiKeys.marketaux || '',
              fmpApiKey: settings.apiKeys.fmp || '',
              tiingoApiKey: settings.apiKeys.tiingo || '',
              mediastackApiKey: settings.apiKeys.mediastack || '',
              newsdataApiKey: settings.apiKeys.newsdata || '',
              enableRssFeeds: enableRss,
              enableNewsApi: settings.apiKeys.enableNewsApi !== 'false',
              enableMarketaux: settings.apiKeys.enableMarketaux !== 'false',
              enableFmp: settings.apiKeys.enableFmp !== 'false',
              enableTiingo: settings.apiKeys.enableTiingo !== 'false',
              enableMediastack: settings.apiKeys.enableMediastack !== 'false',
              enableNewsdata: settings.apiKeys.enableNewsdata !== 'false',
            };
            setLocalConfig(serverConfig);
            saveConfig(serverConfig);
            applyConfig(serverConfig);
          }
        }
      });
    }
  }, [authState.isAuthenticated]);

  const applyConfig = useCallback((config: ApiConfig) => {
    const serviceConfig: DataServiceConfig = {
      finnhubApiKey: config.finnhubApiKey || undefined,
      alphaVantageApiKey: config.alphaVantageApiKey || undefined,
      twelveDataApiKey: config.twelveDataApiKey || undefined,
      newsApiKey: config.newsApiKey || undefined,
      marketauxApiKey: config.marketauxApiKey || undefined,
      fmpApiKey: config.fmpApiKey || undefined,
      tiingoApiKey: config.tiingoApiKey || undefined,
      mediastackApiKey: config.mediastackApiKey || undefined,
      newsdataApiKey: config.newsdataApiKey || undefined,
      enableRssFeeds: config.enableRssFeeds,
      enableNewsApi: config.enableNewsApi,
      enableMarketaux: config.enableMarketaux,
      enableFmp: config.enableFmp,
      enableTiingo: config.enableTiingo,
      enableMediastack: config.enableMediastack,
      enableNewsdata: config.enableNewsdata,
      preferredSource: config.finnhubApiKey ? 'finnhub' : 
                       config.twelveDataApiKey ? 'twelveData' :
                       config.alphaVantageApiKey ? 'alphaVantage' : 'yahoo',
    };
    setConfig(serviceConfig);
  }, [setConfig]);

  // ============================================================================
  // System Status Functions
  // ============================================================================

  const fetchSystemStats = useCallback(async () => {
    setSystemLoading(true);
    
    try {
      const [cacheRes, jobRes, streamRes, mlRes, rlRes] = await Promise.allSettled([
        fetch('/api/cache/stats'),
        fetch('/api/jobs/status'),
        fetch('/api/stream/stats'),
        fetch('/api/ml/health'),
        fetch('/api/rl/health'),
      ]);

      if (cacheRes.status === 'fulfilled' && cacheRes.value.ok) {
        const data = await cacheRes.value.json();
        setCacheStats(data);
        // Rate limits are included in cache stats response
        if (data.rateLimits) {
          setRateLimits(data.rateLimits);
        }
      }
      
      if (jobRes.status === 'fulfilled' && jobRes.value.ok) {
        setJobStatus(await jobRes.value.json());
      }
      
      if (streamRes.status === 'fulfilled' && streamRes.value.ok) {
        setStreamStats(await streamRes.value.json());
      }
      
      if (mlRes.status === 'fulfilled') {
        if (mlRes.value.ok) {
          const data = await mlRes.value.json();
          setMlHealth({ status: 'healthy', ...data });
        } else {
          setMlHealth({ status: 'unhealthy', error: `HTTP ${mlRes.value.status}` });
        }
      } else {
        setMlHealth({ status: 'unknown', error: 'Service nicht erreichbar' });
      }
      
      if (rlRes.status === 'fulfilled') {
        if (rlRes.value.ok) {
          const data = await rlRes.value.json();
          setRlHealth({ status: 'healthy', ...data });
        } else {
          setRlHealth({ status: 'unhealthy', error: `HTTP ${rlRes.value.status}` });
        }
      } else {
        setRlHealth({ status: 'unknown', error: 'Service nicht erreichbar' });
      }
      
      setLastSystemRefresh(new Date());
    } catch (error) {
      console.error('Failed to fetch system stats:', error);
    } finally {
      setSystemLoading(false);
    }
  }, []);

  const triggerQuoteUpdate = async () => {
    if (!authState.user) {
      alert('Bitte einloggen um diese Aktion auszuführen');
      return;
    }
    try {
      const response = await fetch('/api/jobs/update-quotes', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
        },
      });
      if (response.ok) {
        setTimeout(fetchSystemStats, 1000);
      } else if (response.status === 401) {
        alert('Sitzung abgelaufen. Bitte neu einloggen.');
      }
    } catch (error) {
      console.error('Failed to trigger quote update:', error);
    }
  };

  // Load system stats when switching to system tab
  useEffect(() => {
    if (activeTab === 'system' && !lastSystemRefresh) {
      fetchSystemStats();
    }
  }, [activeTab, lastSystemRefresh, fetchSystemStats]);

  // Load rate limits when switching to API tab
  useEffect(() => {
    if (activeTab === 'api' && !rateLimits) {
      fetchSystemStats();
    }
  }, [activeTab, rateLimits, fetchSystemStats]);

  // Helper functions for system status display
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500';
      case 'unhealthy': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy': return '✅';
      case 'unhealthy': return '❌';
      default: return '⚠️';
    }
  };

  const handleSave = () => {
    saveConfig(localConfig);
    applyConfig(localConfig);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    
    if (authState.isAuthenticated) {
      updateUserSettings({
        apiKeys: {
          finnhub: localConfig.finnhubApiKey,
          alphaVantage: localConfig.alphaVantageApiKey,
          twelveData: localConfig.twelveDataApiKey,
          newsApi: localConfig.newsApiKey,
          marketaux: localConfig.marketauxApiKey,
          fmp: localConfig.fmpApiKey,
          tiingo: localConfig.tiingoApiKey,
          mediastack: localConfig.mediastackApiKey,
          newsdata: localConfig.newsdataApiKey,
          enableRssFeeds: localConfig.enableRssFeeds ? 'true' : 'false',
          enableNewsApi: localConfig.enableNewsApi ? 'true' : 'false',
          enableMarketaux: localConfig.enableMarketaux ? 'true' : 'false',
          enableFmp: localConfig.enableFmp ? 'true' : 'false',
          enableTiingo: localConfig.enableTiingo ? 'true' : 'false',
          enableMediastack: localConfig.enableMediastack ? 'true' : 'false',
          enableNewsdata: localConfig.enableNewsdata ? 'true' : 'false',
        },
      });
    }
  };

  const handleClear = () => {
    const empty: ApiConfig = {
      finnhubApiKey: '',
      alphaVantageApiKey: '',
      twelveDataApiKey: '',
      newsApiKey: '',
      marketauxApiKey: '',
      fmpApiKey: '',
      tiingoApiKey: '',
      mediastackApiKey: '',
      newsdataApiKey: '',
      enableRssFeeds: true,
      enableNewsApi: true,
      enableMarketaux: true,
      enableFmp: true,
      enableTiingo: true,
      enableMediastack: true,
      enableNewsdata: true,
    };
    setLocalConfig(empty);
    saveConfig(empty);
    setConfig({ preferredSource: 'yahoo', enableRssFeeds: true });
    
    if (authState.isAuthenticated) {
      updateUserSettings({ apiKeys: {} });
    }
  };

  const handleSaveMLSettings = async () => {
    try {
      localStorage.setItem('daytrader_ml_settings', JSON.stringify(mlSettings));
    } catch {
      console.warn('Failed to save ML settings locally');
    }
    
    if (authState.isAuthenticated) {
      await updateUserSettings({ mlSettings });
    }
    
    setMlSettingsSaved(true);
    setTimeout(() => setMlSettingsSaved(false), 2000);
  };

  const handleLogout = async () => {
    await logout();
  };

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    setPrefsSaved(true);
    setTimeout(() => setPrefsSaved(false), 2000);
  };

  const handleCurrencyChange = (curr: Currency) => {
    setCurrency(curr);
    setPrefsSaved(true);
    setTimeout(() => setPrefsSaved(false), 2000);
  };

  const hasAnyKey = localConfig.finnhubApiKey || localConfig.alphaVantageApiKey || 
                    localConfig.twelveDataApiKey || localConfig.newsApiKey ||
                    localConfig.marketauxApiKey || localConfig.fmpApiKey ||
                    localConfig.tiingoApiKey;

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'auth',
      label: authState.isAuthenticated ? t('nav.account') : t('nav.login'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      id: 'preferences',
      label: t('settings.preferences'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
    },
    {
      id: 'api',
      label: t('settings.apiKeys') + ' & ' + t('settings.dataSources'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      ),
    },
    {
      id: 'ml',
      label: t('settings.mlSettings'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: 'signals',
      label: t('settings.signalSources') || 'Signal-Quellen',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: 'system',
      label: t('settings.system') || 'System',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex-1 flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="text-3xl">⚙️</span>
          {t('settings.title')}
        </h1>
        <p className="text-gray-400 mt-2">
          {t('settings.subtitle')}
        </p>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden flex-1 flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-slate-700 bg-slate-900/30">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-2 py-3 px-3 sm:px-4 text-sm transition-colors flex-1 sm:flex-none ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800/50'
                  : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
              }`}
              title={tab.label}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-6 flex-1 overflow-y-auto">
          {/* Preferences Tab */}
          {activeTab === 'preferences' && (
            <div className="space-y-6">
              <p className="text-gray-400 mb-4">
                {language === 'de' ? 'Passe die Anzeige nach deinen Wünschen an.' : 'Customize the display to your preferences.'}
              </p>

              {/* Language Selection */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  {t('settings.language')}
                </label>
                <p className="text-xs text-gray-500 mb-3">{t('settings.languageDesc')}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleLanguageChange('de')}
                    className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                      language === 'de'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                    }`}
                  >
                    <span className="text-xl">🇩🇪</span>
                    {t('settings.german')}
                  </button>
                  <button
                    onClick={() => handleLanguageChange('en')}
                    className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                      language === 'en'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                    }`}
                  >
                    <span className="text-xl">🇬🇧</span>
                    {t('settings.english')}
                  </button>
                </div>
              </div>

              {/* Currency Selection */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  {t('settings.currency')}
                </label>
                <p className="text-xs text-gray-500 mb-3">{t('settings.currencyDesc')}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleCurrencyChange('USD')}
                    className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                      currency === 'USD'
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                    }`}
                  >
                    <span className="text-xl">$</span>
                    US Dollar (USD)
                  </button>
                  <button
                    onClick={() => handleCurrencyChange('EUR')}
                    className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                      currency === 'EUR'
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                    }`}
                  >
                    <span className="text-xl">€</span>
                    Euro (EUR)
                  </button>
                </div>
              </div>

              {prefsSaved && (
                <div className="mt-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-center">
                  {t('settings.saved')}
                </div>
              )}

              <div className="mt-6 p-4 bg-slate-900/50 rounded-lg">
                <h4 className="text-white font-medium mb-2">{language === 'de' ? 'Hinweis' : 'Note'}</h4>
                <p className="text-sm text-gray-400">
                  {language === 'de' 
                    ? 'Aktiensymbole und Börsenbegriffe bleiben in englischer Sprache, um Missverständnisse zu vermeiden. Währungskurse werden näherungsweise umgerechnet.'
                    : 'Stock symbols and exchange terms remain in English to avoid confusion. Currency rates are approximately converted.'}
                </p>
              </div>
            </div>
          )}

          {/* API Keys Tab */}
          {activeTab === 'api' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-3 h-3 rounded-full ${hasAnyKey ? 'bg-green-500' : 'bg-blue-500'}`} />
                <span className="text-sm text-gray-400">
                  {hasAnyKey ? t('settings.apiConfigured') : t('settings.yahooUsed')}
                </span>
              </div>

              {/* Market Data APIs Section */}
              <div className="border-b border-slate-700 pb-4">
                <h4 className="text-sm font-medium text-white mb-4 flex items-center">
                  <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                  {t('settings.marketDataApis')}
                </h4>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      {t('settings.finnhubKey')}
                      <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                        {t('settings.freeRegister')}
                      </a>
                    </label>
                    <input
                      type="password"
                      value={localConfig.finnhubApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, finnhubApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      {t('settings.alphaVantageKey')}
                      <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                        {t('settings.freeRegister')}
                      </a>
                    </label>
                    <input
                      type="password"
                      value={localConfig.alphaVantageApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, alphaVantageApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      {t('settings.twelveDataKey')}
                      <a href="https://twelvedata.com/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                        {t('settings.freeRegister')}
                      </a>
                    </label>
                    <input
                      type="password"
                      value={localConfig.twelveDataApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, twelveDataApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>
                </div>
              </div>

              {/* News APIs Section */}
              <div className="border-b border-slate-700 pb-4">
                <h4 className="text-sm font-medium text-white mb-4 flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  {t('settings.newsApis')}
                </h4>
                
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm text-gray-400">
                        {t('settings.newsApiKey')}
                        <a href="https://newsapi.org/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                          {t('settings.freeRegister')}
                        </a>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localConfig.enableNewsApi}
                          onChange={(e) => setLocalConfig(prev => ({ ...prev, enableNewsApi: e.target.checked }))}
                          className="w-4 h-4 rounded border-slate-600 text-blue-600"
                          disabled={!localConfig.newsApiKey}
                        />
                        <span className="text-xs text-gray-400">Aktiviert</span>
                      </label>
                    </div>
                    <input
                      type="password"
                      value={localConfig.newsApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, newsApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm text-gray-400">
                        {t('settings.marketauxKey')}
                        <a href="https://www.marketaux.com/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                          {t('settings.freeRegister')}
                        </a>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localConfig.enableMarketaux}
                          onChange={(e) => setLocalConfig(prev => ({ ...prev, enableMarketaux: e.target.checked }))}
                          className="w-4 h-4 rounded border-slate-600 text-blue-600"
                          disabled={!localConfig.marketauxApiKey}
                        />
                        <span className="text-xs text-gray-400">Aktiviert</span>
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{t('settings.marketauxDesc')}</p>
                    <input
                      type="password"
                      value={localConfig.marketauxApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, marketauxApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm text-gray-400">
                        {t('settings.fmpKey')}
                        <a href="https://financialmodelingprep.com/developer" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                          {t('settings.freeRegister')}
                        </a>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localConfig.enableFmp}
                          onChange={(e) => setLocalConfig(prev => ({ ...prev, enableFmp: e.target.checked }))}
                          className="w-4 h-4 rounded border-slate-600 text-blue-600"
                          disabled={!localConfig.fmpApiKey}
                        />
                        <span className="text-xs text-gray-400">Aktiviert</span>
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{t('settings.fmpDesc')}</p>
                    <input
                      type="password"
                      value={localConfig.fmpApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, fmpApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm text-gray-400">
                        {t('settings.tiingoKey')}
                        <a href="https://api.tiingo.com/account/api/token" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                          {t('settings.freeRegister')}
                        </a>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localConfig.enableTiingo}
                          onChange={(e) => setLocalConfig(prev => ({ ...prev, enableTiingo: e.target.checked }))}
                          className="w-4 h-4 rounded border-slate-600 text-blue-600"
                          disabled={!localConfig.tiingoApiKey}
                        />
                        <span className="text-xs text-gray-400">Aktiviert</span>
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{t('settings.tiingoDesc')}</p>
                    <input
                      type="password"
                      value={localConfig.tiingoApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, tiingoApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm text-gray-400">
                        mediastack API Key
                        <a href="https://mediastack.com/signup" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                          (Get free key - 100/month)
                        </a>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localConfig.enableMediastack}
                          onChange={(e) => setLocalConfig(prev => ({ ...prev, enableMediastack: e.target.checked }))}
                          className="w-4 h-4 rounded border-slate-600 text-blue-600"
                          disabled={!localConfig.mediastackApiKey}
                        />
                        <span className="text-xs text-gray-400">Aktiviert</span>
                      </label>
                    </div>
                    <input
                      type="password"
                      value={localConfig.mediastackApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, mediastackApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm text-gray-400">
                        NewsData.io API Key
                        <a href="https://newsdata.io/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                          (Get free key - 200/day)
                        </a>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localConfig.enableNewsdata}
                          onChange={(e) => setLocalConfig(prev => ({ ...prev, enableNewsdata: e.target.checked }))}
                          className="w-4 h-4 rounded border-slate-600 text-blue-600"
                          disabled={!localConfig.newsdataApiKey}
                        />
                        <span className="text-xs text-gray-400">Aktiviert</span>
                      </label>
                    </div>
                    <input
                      type="password"
                      value={localConfig.newsdataApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, newsdataApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>
                </div>
              </div>

              {/* German RSS Feeds Section */}
              <div className="pb-4">
                <h4 className="text-sm font-medium text-white mb-4 flex items-center">
                  <span className="w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                  {t('settings.rssFeeds')}
                  <span className="ml-2 text-xs text-gray-500">({t('settings.noApiKeyRequired')})</span>
                </h4>
                
                <label className="flex items-center gap-3 cursor-pointer p-3 bg-slate-900/50 rounded-lg border border-slate-600">
                  <input
                    type="checkbox"
                    checked={localConfig.enableRssFeeds}
                    onChange={(e) => setLocalConfig(prev => ({ ...prev, enableRssFeeds: e.target.checked }))}
                    className="w-5 h-5 rounded bg-slate-900 border-slate-600 text-blue-500 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-white">{t('settings.enableRssFeeds')}</span>
                    <p className="text-xs text-gray-500">{t('settings.rssFeedsDesc')}</p>
                  </div>
                </label>
              </div>

              {/* API Rate Limits - Live Status */}
              <div className="border-t border-slate-700 pt-4">
                <h4 className="text-sm font-medium text-white mb-4 flex items-center">
                  <span className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></span>
                  🚦 API Rate Limits
                  <button
                    onClick={fetchSystemStats}
                    className="ml-auto text-xs text-blue-400 hover:text-blue-300"
                  >
                    ↻ Aktualisieren
                  </button>
                </h4>
                
                {rateLimits ? (
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(rateLimits).map(([provider, limit]) => {
                      const remaining = limit.remainingThisMinute;
                      const total = limit.limitsPerMinute;
                      const percentage = total > 0 ? (remaining / total) * 100 : 100;
                      const isLow = percentage < 20;
                      
                      return (
                        <div key={provider} className="bg-slate-900/50 rounded p-2 border border-slate-700">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-medium capitalize">{provider}</span>
                            <span className={`text-[10px] ${isLow ? 'text-red-400' : 'text-gray-400'}`}>
                              {remaining}/{total}/min
                            </span>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-1">
                            <div 
                              className={`h-1 rounded-full transition-all ${
                                isLow ? 'bg-red-500' : percentage < 50 ? 'bg-yellow-500' : 'bg-green-500'
                              }`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          {limit.limitsPerDay && (
                            <div className="text-[10px] text-gray-500 mt-0.5">
                              Tag: {limit.remainingToday}/{limit.limitsPerDay}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-2 text-gray-500 text-xs">
                    <button onClick={fetchSystemStats} className="text-blue-400 hover:text-blue-300">
                      Klicken zum Laden
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleClear}
                  className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 font-medium transition-colors"
                >
                  {t('settings.clear')}
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors"
                >
                  {saved ? t('settings.saved') : t('settings.save')}
                </button>
              </div>

              <p className="text-xs text-gray-500 mt-4">
                {t('settings.keysStoredLocally')}
              </p>
              
              {/* Data Sources Section */}
              <div className="mt-8 pt-6 border-t border-slate-700">
                <h3 className="text-lg font-medium text-white mb-3">{t('settings.dataSources')}</h3>
                <p className="text-gray-400 text-sm mb-4">
                  {t('settings.selectDataSource')}
                </p>
                <DataSourceSelector />
              </div>
            </div>
          )}

          {/* ML Settings Tab */}
          {activeTab === 'ml' && (
            <div className="space-y-6">
              <p className="text-gray-400 mb-4">
                {t('settings.mlConfig')}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    {t('settings.sequenceLength')}
                  </label>
                  <input
                    type="number"
                    value={mlSettings.sequenceLength}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, sequenceLength: e.target.value === '' ? 0 : parseInt(e.target.value) || prev.sequenceLength }))}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!val || val < 30) setMlSettings(prev => ({ ...prev, sequenceLength: 30 }));
                      else if (val > 120) setMlSettings(prev => ({ ...prev, sequenceLength: 120 }));
                    }}
                    min={30}
                    max={120}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('settings.sequenceLengthDesc')}</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    {t('settings.forecastDays')}
                  </label>
                  <input
                    type="number"
                    value={mlSettings.forecastDays}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, forecastDays: e.target.value === '' ? 0 : parseInt(e.target.value) || prev.forecastDays }))}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!val || val < 1) setMlSettings(prev => ({ ...prev, forecastDays: 1 }));
                      else if (val > 30) setMlSettings(prev => ({ ...prev, forecastDays: 30 }));
                    }}
                    min={1}
                    max={30}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('settings.forecastDaysDesc')}</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    {t('settings.epochs')}
                  </label>
                  <input
                    type="number"
                    value={mlSettings.epochs}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, epochs: e.target.value === '' ? 0 : parseInt(e.target.value) || prev.epochs }))}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (!val || val < 10) setMlSettings(prev => ({ ...prev, epochs: 10 }));
                      else if (val > 500) setMlSettings(prev => ({ ...prev, epochs: 500 }));
                    }}
                    min={10}
                    max={500}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('settings.epochsDesc')}</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    {t('settings.learningRate')}
                  </label>
                  <input
                    type="number"
                    value={mlSettings.learningRate}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, learningRate: e.target.value === '' ? 0 : parseFloat(e.target.value) || prev.learningRate }))}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!val || val < 0.0001) setMlSettings(prev => ({ ...prev, learningRate: 0.0001 }));
                      else if (val > 0.1) setMlSettings(prev => ({ ...prev, learningRate: 0.1 }));
                    }}
                    min={0.0001}
                    max={0.1}
                    step={0.0001}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('settings.learningRateDesc')}</p>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-700">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Model Type
                  </label>
                  <select
                    value={mlSettings.modelType || 'lstm'}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, modelType: e.target.value as 'lstm' | 'transformer' }))}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="lstm">LSTM (Long Short-Term Memory)</option>
                    <option value="transformer">Transformer (Multi-Head Attention)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    LSTM: Bewährt, schnelleres Training. Transformer: Bessere Muster-Erkennung bei langen Sequenzen, mehr GPU-Speicher.
                  </p>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mlSettings.useCuda}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, useCuda: e.target.checked }))}
                    className="w-5 h-5 rounded bg-slate-900 border-slate-600 text-blue-500 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-white">{t('settings.useCuda')}</span>
                    <p className="text-xs text-gray-500">{t('settings.useCudaDesc')}</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mlSettings.preloadFinbert}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, preloadFinbert: e.target.checked }))}
                    className="w-5 h-5 rounded bg-slate-900 border-slate-600 text-blue-500 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-white">{t('settings.preloadFinbert')}</span>
                    <p className="text-xs text-gray-500">{t('settings.preloadFinbertDesc')}</p>
                  </div>
                </label>
              </div>

              <button
                onClick={handleSaveMLSettings}
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-medium transition-colors mt-4"
              >
                {mlSettingsSaved ? t('settings.mlSaved') : t('settings.saveML')}
              </button>
            </div>
          )}

          {/* Signal Sources Tab */}
          {activeTab === 'signals' && (
            <SignalSourceSettingsPanel />
          )}

          {/* Auth Tab */}
          {activeTab === 'auth' && (
            <div>
              {authState.isAuthenticated ? (
                <div className="space-y-6">
                  <div className="bg-slate-900/50 rounded-lg p-6">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white">
                        {authState.user?.username?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-white">{authState.user?.username}</h3>
                        <p className="text-gray-400">{authState.user?.email}</p>
                        <span className="text-xs text-green-400 bg-green-500/20 px-2 py-0.5 rounded-full">
                          {t('settings.loggedIn')}
                        </span>
                      </div>
                    </div>

                    <div className="text-sm text-gray-400 space-y-1">
                      <p>{t('settings.apiKeysSynced')}</p>
                      <p>{t('settings.customSymbolsSaved')}</p>
                      <p>{t('settings.mlSettingsAcross')}</p>
                    </div>
                  </div>

                  <button
                    onClick={handleLogout}
                    className="w-full py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 rounded-lg text-red-400 font-medium transition-colors"
                  >
                    {t('settings.logout')}
                  </button>
                </div>
              ) : (
                <div>
                  {showRegister ? (
                    <div>
                      <RegisterForm onSuccess={() => setShowRegister(false)} />
                      <p className="text-center text-gray-400 mt-4">
                        {t('settings.alreadyAccount')}{' '}
                        <button
                          onClick={() => setShowRegister(false)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          {t('settings.signIn')}
                        </button>
                      </p>
                    </div>
                  ) : (
                    <div>
                      <LoginForm />
                      <p className="text-center text-gray-400 mt-4">
                        {t('settings.noAccount')}{' '}
                        <button
                          onClick={() => setShowRegister(true)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          {t('settings.register')}
                        </button>
                      </p>
                    </div>
                  )}

                  <div className="mt-6 p-4 bg-slate-900/50 rounded-lg">
                    <h4 className="text-white font-medium mb-2">{t('settings.benefits')}</h4>
                    <ul className="text-sm text-gray-400 space-y-1">
                      <li>{t('settings.benefit1')}</li>
                      <li>{t('settings.benefit2')}</li>
                      <li>{t('settings.benefit3')}</li>
                      <li>{t('settings.benefit4')}</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* System Status Tab */}
          {activeTab === 'system' && (
            <div className="space-y-6">
              {/* Header with refresh button */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">System Status</h3>
                  <p className="text-sm text-gray-400">
                    {lastSystemRefresh 
                      ? `Letzte Aktualisierung: ${lastSystemRefresh.toLocaleTimeString('de-DE')}`
                      : 'Noch nicht geladen'}
                  </p>
                </div>
                <button
                  onClick={fetchSystemStats}
                  disabled={systemLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 rounded-lg transition-colors flex items-center gap-2 text-sm"
                >
                  {systemLoading ? (
                    <span className="animate-spin">⟳</span>
                  ) : (
                    <span>🔄</span>
                  )}
                  Aktualisieren
                </button>
              </div>

              {/* Service Health Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Backend Health */}
                <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-300">Backend API</h4>
                    <div className={`w-2.5 h-2.5 rounded-full ${cacheStats ? 'bg-green-500' : 'bg-red-500'}`} />
                  </div>
                  <div className="text-lg">{cacheStats ? '✅' : '❌'}</div>
                  <p className="text-xs text-gray-500">{cacheStats ? 'Erreichbar' : 'Nicht erreichbar'}</p>
                </div>

                {/* ML Service Health */}
                <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-300">ML Service</h4>
                    <div className={`w-2.5 h-2.5 rounded-full ${getHealthColor(mlHealth?.status || 'unknown')}`} />
                  </div>
                  <div className="text-lg">{getHealthIcon(mlHealth?.status || 'unknown')}</div>
                  <p className="text-xs text-gray-500">
                    {mlHealth?.status === 'healthy' 
                      ? mlHealth.uptime ? `Uptime: ${formatUptime(mlHealth.uptime)}` : 'Aktiv'
                      : mlHealth?.error || 'Unbekannt'}
                  </p>
                </div>

                {/* RL Service Health */}
                <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-300">RL Trading</h4>
                    <div className={`w-2.5 h-2.5 rounded-full ${getHealthColor(rlHealth?.status || 'unknown')}`} />
                  </div>
                  <div className="text-lg">{getHealthIcon(rlHealth?.status || 'unknown')}</div>
                  <p className="text-xs text-gray-500">
                    {rlHealth?.status === 'healthy'
                      ? rlHealth.uptime ? `Uptime: ${formatUptime(rlHealth.uptime)}` : 'Aktiv'
                      : rlHealth?.error || 'Unbekannt'}
                  </p>
                </div>

                {/* SSE Connections */}
                <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700" title="Anzahl Browser-Tabs mit aktiver SSE-Verbindung">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-300">Live-Streams</h4>
                    <div className={`w-2.5 h-2.5 rounded-full ${(streamStats?.activeConnections || 0) > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
                  </div>
                  <div className="text-lg">{streamStats?.activeConnections || 0}</div>
                  <p className="text-xs text-gray-500">
                    {streamStats?.aiTraderStreams?.count || 0} AI Trader, {streamStats?.quoteStreams?.count || 0} Quotes
                  </p>
                </div>
              </div>

              {/* Cache Statistics */}
              <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                <h4 className="font-medium text-white mb-3 flex items-center gap-2">
                  <span>💾</span> Cache-Statistiken
                </h4>
                
                {cacheStats?.enabled === false ? (
                  <div className="text-center py-4 text-gray-400">
                    <span className="text-2xl mb-2 block">📭</span>
                    <p className="text-sm">{cacheStats.message || 'Caching nicht aktiviert'}</p>
                  </div>
                ) : cacheStats?.total ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-800/50 rounded p-2">
                      <div className="text-xs text-gray-400">Einträge</div>
                      <div className="text-lg font-bold">{parseInt(cacheStats.total.total_entries).toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-800/50 rounded p-2">
                      <div className="text-xs text-gray-400">Speicher</div>
                      <div className="text-lg font-bold">{cacheStats.total.cache_size}</div>
                    </div>
                    <div className="bg-slate-800/50 rounded p-2">
                      <div className="text-xs text-gray-400">Cache Hits</div>
                      <div className="text-lg font-bold text-green-400">{parseInt(cacheStats.total.total_hits).toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-800/50 rounded p-2" title={cacheStats.byType?.map(t => t.cache_type).join(', ') || 'Keine'}>
                      <div className="text-xs text-gray-400">Cache-Typen</div>
                      <div className="text-lg font-bold">{cacheStats.byType?.length || 0}</div>
                      <div className="text-[10px] text-gray-500 truncate">
                        {cacheStats.byType?.map(t => t.cache_type).join(', ') || '-'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-400 text-sm">Laden...</div>
                )}
              </div>

              {/* Background Jobs */}
              <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                <h4 className="font-medium text-white mb-3 flex items-center gap-2">
                  <span>⚙️</span> Background Jobs
                </h4>
                
                {jobStatus ? (
                  <div className="bg-slate-800/50 rounded p-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h5 className="text-sm font-medium">Quote Update Job</h5>
                        <p className="text-xs text-gray-400">Aktualisiert Kursdaten alle {jobStatus.config?.quoteUpdateIntervalSeconds || 60}s</p>
                      </div>
                      <div className={`px-2 py-0.5 rounded text-xs ${
                        jobStatus.isRunning 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {jobStatus.isRunning ? '✓ Aktiv' : '⏸️ Gestoppt'}
                      </div>
                    </div>
                    
                    <div className="text-xs text-gray-400 space-y-1 mb-2">
                      {jobStatus.lastQuoteUpdate && (
                        <p>Letzte: {new Date(jobStatus.lastQuoteUpdate).toLocaleString('de-DE')}</p>
                      )}
                      {jobStatus.stats && (
                        <p>Updates: {jobStatus.stats.successfulUpdates?.toLocaleString()} erfolgreich, {jobStatus.stats.failedUpdates || 0} fehlgeschlagen</p>
                      )}
                      {jobStatus.nextQuoteUpdate && (
                        <p>Nächste: {new Date(jobStatus.nextQuoteUpdate).toLocaleTimeString('de-DE')}</p>
                      )}
                    </div>
                    
                    {authState.user && (
                      <button
                        onClick={triggerQuoteUpdate}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs transition-colors"
                        title="Löst sofort ein Kurs-Update für alle Watchlist-Symbole aus"
                      >
                        🔄 Jetzt Kurse aktualisieren
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-400 text-sm">Laden...</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
