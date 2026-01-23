/**
 * Hamburger Menu Component
 * 
 * Main navigation menu with:
 * - API Settings
 * - Data Source selection
 * - Changelog
 * - Login/Registration
 */

import { useState, useEffect, useCallback } from 'react';
import { useDataService } from '../hooks';
import { subscribeToAuth, getAuthState, logout, checkAuthStatus, type AuthState, type AuthStatus } from '../services/authService';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ChangelogPanel } from './ChangelogPanel';
import { DataSourceSelector } from './DataSourceSelector';
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

type MenuTab = 'api' | 'data-source' | 'changelog' | 'auth';

export function HamburgerMenu() {
  const { setConfig } = useDataService();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MenuTab>('api');
  const [localConfig, setLocalConfig] = useState<ApiConfig>(loadStoredConfig);
  const [saved, setSaved] = useState(false);
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  // Subscribe to auth state changes
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus().then(setAuthStatus);
  }, []);

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
  };

  const handleLogout = async () => {
    await logout();
  };

  const hasAnyKey = localConfig.finnhubApiKey || localConfig.alphaVantageApiKey || 
                    localConfig.twelveDataApiKey || localConfig.newsApiKey;

  const tabs: { id: MenuTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'api',
      label: 'API Settings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      id: 'data-source',
      label: 'Data Source',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
      ),
    },
    {
      id: 'changelog',
      label: 'Changelog',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'auth',
      label: authState.isAuthenticated ? 'Account' : 'Login',
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
