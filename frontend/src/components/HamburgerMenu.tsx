/**
 * Hamburger Menu Component
 * 
 * Main navigation menu with:
 * - API Settings
 * - Data Source selection
 * - ML & App Settings
 * - Technical Analysis Info
 * - Changelog
 * - Login/Registration
 */

import { useState, useEffect, useCallback } from 'react';
import { useDataService } from '../hooks';
import { subscribeToAuth, getAuthState, logout, checkAuthStatus, type AuthState, type AuthStatus } from '../services/authService';
import { getUserSettings, updateUserSettings, DEFAULT_ML_SETTINGS, type MLSettings } from '../services/userSettingsService';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ChangelogPanel } from './ChangelogPanel';
import { DataSourceSelector } from './DataSourceSelector';
import { WatchlistPanel } from './WatchlistPanel';
import type { DataServiceConfig } from '../services/dataService';

// Build info from Vite config
declare const __BUILD_VERSION__: string;

const STORAGE_KEY = 'daytrader_api_config';

interface ApiConfig {
  finnhubApiKey: string;
  alphaVantageApiKey: string;
  twelveDataApiKey: string;
  newsApiKey: string;
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

type MenuTab = 'watchlist' | 'api' | 'data-source' | 'settings' | 'technical' | 'changelog' | 'auth';

export function HamburgerMenu() {
  const { setConfig } = useDataService();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MenuTab>('watchlist');
  const [localConfig, setLocalConfig] = useState<ApiConfig>(loadStoredConfig);
  const [saved, setSaved] = useState(false);
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [mlSettings, setMlSettings] = useState<MLSettings>({ ...DEFAULT_ML_SETTINGS });
  const [mlSettingsSaved, setMlSettingsSaved] = useState(false);

  // Subscribe to auth state changes
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus().then(setAuthStatus);
  }, []);

  // Load user settings when authenticated
  useEffect(() => {
    if (authState.isAuthenticated) {
      getUserSettings().then(settings => {
        if (settings) {
          setMlSettings(settings.mlSettings || { ...DEFAULT_ML_SETTINGS });
          // Also load API keys from server if available
          if (settings.apiKeys && Object.keys(settings.apiKeys).length > 0) {
            const serverConfig: ApiConfig = {
              finnhubApiKey: settings.apiKeys.finnhub || '',
              alphaVantageApiKey: settings.apiKeys.alphaVantage || '',
              twelveDataApiKey: settings.apiKeys.twelveData || '',
              newsApiKey: settings.apiKeys.newsApi || '',
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
    
    // Sync to server if authenticated
    if (authState.isAuthenticated) {
      updateUserSettings({
        apiKeys: {
          finnhub: localConfig.finnhubApiKey,
          alphaVantage: localConfig.alphaVantageApiKey,
          twelveData: localConfig.twelveDataApiKey,
          newsApi: localConfig.newsApiKey,
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
    };
    setLocalConfig(empty);
    saveConfig(empty);
    setConfig({ preferredSource: 'yahoo' });
    
    // Sync to server if authenticated
    if (authState.isAuthenticated) {
      updateUserSettings({ apiKeys: {} });
    }
  };

  const handleSaveMLSettings = async () => {
    // Save locally
    try {
      localStorage.setItem('daytrader_ml_settings', JSON.stringify(mlSettings));
    } catch {
      console.warn('Failed to save ML settings locally');
    }
    
    // Save to server if authenticated
    if (authState.isAuthenticated) {
      await updateUserSettings({ mlSettings });
    }
    
    setMlSettingsSaved(true);
    setTimeout(() => setMlSettingsSaved(false), 2000);
  };

  const handleLogout = async () => {
    await logout();
  };

  const hasAnyKey = localConfig.finnhubApiKey || localConfig.alphaVantageApiKey || 
                    localConfig.twelveDataApiKey || localConfig.newsApiKey;

  const tabs: { id: MenuTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'watchlist',
      label: 'Watchlist',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      id: 'api',
      label: 'API',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      ),
    },
    {
      id: 'data-source',
      label: 'Daten',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'ML',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      id: 'technical',
      label: 'Info',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: 'changelog',
      label: 'Log',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'auth',
      label: authState.isAuthenticated ? 'Konto' : 'Login',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative">
      {/* Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-lg transition-colors ${
          isOpen 
            ? 'bg-blue-600/30 text-blue-400' 
            : hasAnyKey 
              ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
              : 'bg-slate-700/50 text-gray-400 hover:bg-slate-700'
        }`}
        title="Menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Menu Panel */}
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-black/50" 
            onClick={() => setIsOpen(false)} 
          />
          <div className="absolute left-0 top-full mt-2 w-[400px] max-h-[80vh] bg-slate-800 rounded-xl border border-slate-700 shadow-xl z-50 overflow-hidden flex flex-col">
            {/* Header with user info */}
            <div className="p-4 border-b border-slate-700 bg-slate-900/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-white">Menu</span>
                  <span className="text-xs text-gray-500">v{__BUILD_VERSION__}</span>
                </div>
                {authState.isAuthenticated && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">{authState.user?.email}</span>
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                  </div>
                )}
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-slate-700 bg-slate-900/30">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-3 px-2 text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800/50'
                      : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Watchlist Tab */}
              {activeTab === 'watchlist' && (
                <WatchlistPanel 
                  onSelectSymbol={(symbol) => {
                    // Close menu and navigate to symbol
                    setIsOpen(false);
                    // Emit custom event for symbol selection
                    window.dispatchEvent(new CustomEvent('selectSymbol', { detail: symbol }));
                  }}
                />
              )}

              {/* API Settings Tab */}
              {activeTab === 'api' && (
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

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleClear}
                      className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 text-sm transition-colors"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={handleSave}
                      className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition-colors"
                    >
                      {saved ? '✓ Saved!' : 'Save & Apply'}
                    </button>
                  </div>

                  <p className="text-xs text-gray-500 mt-2">
                    API keys are stored locally in your browser. They are never sent to our servers.
                  </p>
                </div>
              )}

              {/* Data Source Tab */}
              {activeTab === 'data-source' && (
                <DataSourceSelector collapsed />
              )}

              {/* Changelog Tab */}
              {activeTab === 'changelog' && (
                <ChangelogPanel />
              )}

              {/* ML Settings Tab */}
              {activeTab === 'settings' && (
                <div className="space-y-4">
                  <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                    <h4 className="text-white font-medium mb-3">ML Model Training</h4>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">
                          Sequenzlänge (Tage)
                        </label>
                        <input
                          type="number"
                          value={mlSettings.sequenceLength}
                          onChange={(e) => setMlSettings(prev => ({ ...prev, sequenceLength: parseInt(e.target.value) || 60 }))}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                          min={10}
                          max={200}
                        />
                        <p className="text-xs text-gray-500 mt-1">Anzahl historischer Tage für Vorhersage</p>
                      </div>
                      
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">
                          Vorhersage-Tage
                        </label>
                        <input
                          type="number"
                          value={mlSettings.forecastDays}
                          onChange={(e) => setMlSettings(prev => ({ ...prev, forecastDays: parseInt(e.target.value) || 14 }))}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                          min={1}
                          max={60}
                        />
                        <p className="text-xs text-gray-500 mt-1">Tage in die Zukunft prognostizieren</p>
                      </div>
                      
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">
                          Epochen
                        </label>
                        <input
                          type="number"
                          value={mlSettings.epochs}
                          onChange={(e) => setMlSettings(prev => ({ ...prev, epochs: parseInt(e.target.value) || 100 }))}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                          min={10}
                          max={500}
                        />
                        <p className="text-xs text-gray-500 mt-1">Training-Durchläufe (mehr = genauer, aber langsamer)</p>
                      </div>
                      
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">
                          Lernrate
                        </label>
                        <input
                          type="number"
                          value={mlSettings.learningRate}
                          onChange={(e) => setMlSettings(prev => ({ ...prev, learningRate: parseFloat(e.target.value) || 0.001 }))}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                          min={0.0001}
                          max={0.1}
                          step={0.0001}
                        />
                        <p className="text-xs text-gray-500 mt-1">Schrittgröße beim Lernen (0.001 empfohlen)</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                    <h4 className="text-white font-medium mb-3">GPU & Performance</h4>
                    
                    <div className="space-y-3">
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <span className="text-sm text-gray-300">CUDA/GPU aktivieren</span>
                          <p className="text-xs text-gray-500">Benötigt NVIDIA GPU mit CUDA-Unterstützung</p>
                        </div>
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={mlSettings.useCuda}
                            onChange={(e) => setMlSettings(prev => ({ ...prev, useCuda: e.target.checked }))}
                            className="sr-only"
                          />
                          <div className={`w-11 h-6 rounded-full transition-colors ${mlSettings.useCuda ? 'bg-blue-600' : 'bg-slate-600'}`}>
                            <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${mlSettings.useCuda ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
                          </div>
                        </div>
                      </label>
                      
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <span className="text-sm text-gray-300">FinBERT vorladen</span>
                          <p className="text-xs text-gray-500">Schnellere Sentiment-Analyse (~500MB RAM)</p>
                        </div>
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={mlSettings.preloadFinbert}
                            onChange={(e) => setMlSettings(prev => ({ ...prev, preloadFinbert: e.target.checked }))}
                            className="sr-only"
                          />
                          <div className={`w-11 h-6 rounded-full transition-colors ${mlSettings.preloadFinbert ? 'bg-blue-600' : 'bg-slate-600'}`}>
                            <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${mlSettings.preloadFinbert ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                  
                  <button
                    onClick={handleSaveMLSettings}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm font-medium transition-colors"
                  >
                    {mlSettingsSaved ? '✓ Gespeichert!' : 'Einstellungen speichern'}
                  </button>
                  
                  {!authState.isAuthenticated && (
                    <p className="text-xs text-yellow-400/70 text-center">
                      💡 Logge dich ein, um Einstellungen geräteübergreifend zu synchronisieren
                    </p>
                  )}
                </div>
              )}

              {/* Technical Analysis Info Tab */}
              {activeTab === 'technical' && (
                <div className="space-y-4">
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-blue-500/20">
                    <h4 className="font-semibold text-blue-400 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      Trend Indicators
                    </h4>
                    <ul className="text-sm text-gray-300 space-y-1">
                      <li>• <strong className="text-white">SMA (Simple Moving Average):</strong> Durchschnittspreis über N Perioden</li>
                      <li>• <strong className="text-white">EMA (Exponential MA):</strong> Gewichteter Durchschnitt, bevorzugt aktuelle Preise</li>
                    </ul>
                  </div>
                  
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-purple-500/20">
                    <h4 className="font-semibold text-purple-400 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Momentum Indicators
                    </h4>
                    <ul className="text-sm text-gray-300 space-y-1">
                      <li>• <strong className="text-white">RSI:</strong> Misst überkauft/überverkauft (0-100)</li>
                      <li>• <strong className="text-white">MACD:</strong> Trend-folgender Momentum-Indikator</li>
                      <li>• <strong className="text-white">Stochastic:</strong> Vergleicht Schluss mit Preisspanne</li>
                    </ul>
                  </div>
                  
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-amber-500/20">
                    <h4 className="font-semibold text-amber-400 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Volatility & Volume
                    </h4>
                    <ul className="text-sm text-gray-300 space-y-1">
                      <li>• <strong className="text-white">Bollinger Bands:</strong> Volatilitätsbänder um SMA</li>
                      <li>• <strong className="text-white">ATR:</strong> Average True Range für Volatilität</li>
                      <li>• <strong className="text-white">OBV/VWAP:</strong> Volumenbasierte Indikatoren</li>
                    </ul>
                  </div>
                  
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-green-500/20">
                    <h4 className="font-semibold text-green-400 mb-2 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      ML-basierte Analyse
                    </h4>
                    <ul className="text-sm text-gray-300 space-y-1">
                      <li>• <strong className="text-white">LSTM Neural Network:</strong> Deep Learning für Preisprognosen</li>
                      <li>• <strong className="text-white">FinBERT Sentiment:</strong> NLP für Nachrichtenanalyse</li>
                      <li>• <strong className="text-white">Multi-Source Signals:</strong> Kombinierte Datenquellen</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Auth Tab */}
              {activeTab === 'auth' && (
                <div>
                  {authStatus && !authStatus.authAvailable && (
                    <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
                      <p className="text-yellow-400 text-sm">
                        ⚠️ Authentifizierung ist nicht verfügbar. Die Datenbank ist nicht konfiguriert.
                      </p>
                      <p className="text-yellow-400/70 text-xs mt-1">
                        Einstellungen werden lokal im Browser gespeichert.
                      </p>
                    </div>
                  )}

                  {authState.isAuthenticated ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-slate-900/50 rounded-lg">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl">
                            {authState.user?.email?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-white font-medium">
                              {authState.user?.username || authState.user?.email}
                            </div>
                            <div className="text-gray-400 text-sm">{authState.user?.email}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-green-400 text-sm">
                          <span className="w-2 h-2 rounded-full bg-green-400" />
                          <span>Eingeloggt</span>
                        </div>
                      </div>

                      <button
                        onClick={handleLogout}
                        className="w-full py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm transition-colors"
                      >
                        Ausloggen
                      </button>
                    </div>
                  ) : authStatus?.authAvailable ? (
                    <div>
                      {showRegister ? (
                        <>
                          <RegisterForm onSuccess={() => setShowRegister(false)} />
                          <p className="text-center text-gray-400 text-sm mt-4">
                            Bereits registriert?{' '}
                            <button
                              onClick={() => setShowRegister(false)}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              Einloggen
                            </button>
                          </p>
                        </>
                      ) : (
                        <>
                          <LoginForm />
                          <p className="text-center text-gray-400 text-sm mt-4">
                            Noch kein Konto?{' '}
                            <button
                              onClick={() => setShowRegister(true)}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              Registrieren
                            </button>
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <p className="text-gray-400 text-sm">
                        Login/Registrierung erfordert eine Datenbankverbindung.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
