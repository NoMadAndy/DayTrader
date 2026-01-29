/**
 * Settings Page
 * 
 * Combined settings for API keys, ML configuration, and data sources.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDataService } from '../hooks';
import { useSettings, type Language, type Currency } from '../contexts';
import { DataSourceSelector } from '../components/DataSourceSelector';
import { ApiQuotaDisplay } from '../components/ApiQuotaDisplay';
import { SignalSourceSettingsPanel } from '../components/SignalSourceSettings';
import { subscribeToAuth, getAuthState, logout, checkAuthStatus, type AuthState } from '../services/authService';
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
  enableRssFeeds: boolean;
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
    enableRssFeeds: true, // RSS feeds enabled by default (no API key required)
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

type SettingsTab = 'api' | 'data-source' | 'ml' | 'signals' | 'auth' | 'preferences';

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
              enableRssFeeds: enableRss,
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
      enableRssFeeds: config.enableRssFeeds,
      preferredSource: config.finnhubApiKey ? 'finnhub' : 
                       config.twelveDataApiKey ? 'twelveData' :
                       config.alphaVantageApiKey ? 'alphaVantage' : 'yahoo',
    };
    setConfig(serviceConfig);
  }, [setConfig]);

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
          enableRssFeeds: localConfig.enableRssFeeds ? 'true' : 'false',
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
      enableRssFeeds: true,
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
      label: t('settings.apiKeys'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      ),
    },
    {
      id: 'data-source',
      label: t('settings.dataSources'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
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
                    <label className="block text-sm text-gray-400 mb-2">
                      {t('settings.newsApiKey')}
                      <a href="https://newsapi.org/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                        {t('settings.freeRegister')}
                      </a>
                    </label>
                    <input
                      type="password"
                      value={localConfig.newsApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, newsApiKey: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      placeholder={t('settings.enterKey')}
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      {t('settings.marketauxKey')}
                      <a href="https://www.marketaux.com/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                        {t('settings.freeRegister')}
                      </a>
                    </label>
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
                    <label className="block text-sm text-gray-400 mb-2">
                      {t('settings.fmpKey')}
                      <a href="https://financialmodelingprep.com/developer" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                        {t('settings.freeRegister')}
                      </a>
                    </label>
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
                    <label className="block text-sm text-gray-400 mb-2">
                      {t('settings.tiingoKey')}
                      <a href="https://api.tiingo.com/account/api/token" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                        {t('settings.freeRegister')}
                      </a>
                    </label>
                    <p className="text-xs text-gray-500 mb-2">{t('settings.tiingoDesc')}</p>
                    <input
                      type="password"
                      value={localConfig.tiingoApiKey}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, tiingoApiKey: e.target.value }))}
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
            </div>
          )}

          {/* Data Source Tab */}
          {activeTab === 'data-source' && (
            <div className="space-y-6">
              <p className="text-gray-400 mb-4">
                {t('settings.selectDataSource')}
              </p>
              <DataSourceSelector />
              
              {/* API Quota Display */}
              <div className="mt-6">
                <h3 className="text-lg font-medium text-white mb-3">{t('settings.apiUsage')}</h3>
                <p className="text-gray-400 text-sm mb-4">
                  {t('settings.apiUsageDesc')}
                </p>
                <ApiQuotaDisplay />
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
        </div>
      </div>
    </div>
  );
}
