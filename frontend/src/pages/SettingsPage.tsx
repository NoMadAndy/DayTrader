/**
 * Settings Page
 * 
 * Combined settings for API keys, ML configuration, and data sources.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDataService } from '../hooks';
import { DataSourceSelector } from '../components/DataSourceSelector';
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

type SettingsTab = 'api' | 'data-source' | 'ml' | 'auth';

export function SettingsPage() {
  const { setConfig } = useDataService();
  const [activeTab, setActiveTab] = useState<SettingsTab>('auth');
  const [localConfig, setLocalConfig] = useState<ApiConfig>(loadStoredConfig);
  const [saved, setSaved] = useState(false);
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [showRegister, setShowRegister] = useState(false);
  const [mlSettings, setMlSettings] = useState<MLSettings>({ ...DEFAULT_ML_SETTINGS });
  const [mlSettingsSaved, setMlSettingsSaved] = useState(false);

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

  const hasAnyKey = localConfig.finnhubApiKey || localConfig.alphaVantageApiKey || 
                    localConfig.twelveDataApiKey || localConfig.newsApiKey;

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'auth',
      label: authState.isAuthenticated ? 'Konto' : 'Login',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      id: 'api',
      label: 'API Keys',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      ),
    },
    {
      id: 'data-source',
      label: 'Datenquellen',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
      ),
    },
    {
      id: 'ml',
      label: 'ML Settings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex-1 flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="text-3xl">⚙️</span>
          Einstellungen
        </h1>
        <p className="text-gray-400 mt-2">
          API-Schlüssel, Datenquellen und ML-Konfiguration
        </p>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-slate-700 bg-slate-900/30 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 py-3 px-4 text-sm transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800/50'
                  : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* API Keys Tab */}
          {activeTab === 'api' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-3 h-3 rounded-full ${hasAnyKey ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-sm text-gray-400">
                  {hasAnyKey ? 'API-Schlüssel konfiguriert' : 'Keine API-Schlüssel konfiguriert (Mock-Daten werden verwendet)'}
                </span>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Finnhub API Key
                  <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                    (Kostenlos registrieren)
                  </a>
                </label>
                <input
                  type="password"
                  value={localConfig.finnhubApiKey}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, finnhubApiKey: e.target.value }))}
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="Finnhub API-Schlüssel eingeben"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Alpha Vantage API Key
                  <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                    (Kostenlos registrieren)
                  </a>
                </label>
                <input
                  type="password"
                  value={localConfig.alphaVantageApiKey}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, alphaVantageApiKey: e.target.value }))}
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="Alpha Vantage API-Schlüssel eingeben"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Twelve Data API Key
                  <a href="https://twelvedata.com/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                    (Kostenlos registrieren)
                  </a>
                </label>
                <input
                  type="password"
                  value={localConfig.twelveDataApiKey}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, twelveDataApiKey: e.target.value }))}
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="Twelve Data API-Schlüssel eingeben"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  NewsAPI Key
                  <a href="https://newsapi.org/register" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:text-blue-300">
                    (Kostenlos registrieren)
                  </a>
                </label>
                <input
                  type="password"
                  value={localConfig.newsApiKey}
                  onChange={(e) => setLocalConfig(prev => ({ ...prev, newsApiKey: e.target.value }))}
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="NewsAPI-Schlüssel eingeben"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleClear}
                  className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 font-medium transition-colors"
                >
                  Alle löschen
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors"
                >
                  {saved ? '✓ Gespeichert!' : 'Speichern & Anwenden'}
                </button>
              </div>

              <p className="text-xs text-gray-500 mt-4">
                API-Schlüssel werden lokal gespeichert. Bei Anmeldung werden sie mit deinem Konto synchronisiert.
              </p>
            </div>
          )}

          {/* Data Source Tab */}
          {activeTab === 'data-source' && (
            <div>
              <p className="text-gray-400 mb-4">
                Wähle deine bevorzugte Datenquelle für Aktienkurse.
              </p>
              <DataSourceSelector />
            </div>
          )}

          {/* ML Settings Tab */}
          {activeTab === 'ml' && (
            <div className="space-y-6">
              <p className="text-gray-400 mb-4">
                Konfiguriere die Parameter für das Machine Learning Modell.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Sequenzlänge (Tage)
                  </label>
                  <input
                    type="number"
                    value={mlSettings.sequenceLength}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, sequenceLength: parseInt(e.target.value) || 60 }))}
                    min={30}
                    max={120}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Anzahl der Tage für die Eingabesequenz (30-120)</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Vorhersage-Tage
                  </label>
                  <input
                    type="number"
                    value={mlSettings.forecastDays}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, forecastDays: parseInt(e.target.value) || 14 }))}
                    min={1}
                    max={30}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Anzahl der Tage für die Vorhersage (1-30)</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Epochen
                  </label>
                  <input
                    type="number"
                    value={mlSettings.epochs}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, epochs: parseInt(e.target.value) || 100 }))}
                    min={10}
                    max={500}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Trainings-Epochen (10-500)</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    Lernrate
                  </label>
                  <input
                    type="number"
                    value={mlSettings.learningRate}
                    onChange={(e) => setMlSettings(prev => ({ ...prev, learningRate: parseFloat(e.target.value) || 0.001 }))}
                    min={0.0001}
                    max={0.1}
                    step={0.0001}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Lernrate für das Training (0.0001-0.1)</p>
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
                    <span className="text-white">GPU/CUDA verwenden</span>
                    <p className="text-xs text-gray-500">Beschleunigt Training wenn NVIDIA GPU verfügbar</p>
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
                    <span className="text-white">FinBERT vorladen</span>
                    <p className="text-xs text-gray-500">Lädt Sentiment-Modell beim Start (mehr RAM, schnellere Analyse)</p>
                  </div>
                </label>
              </div>

              <button
                onClick={handleSaveMLSettings}
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg text-white font-medium transition-colors mt-4"
              >
                {mlSettingsSaved ? '✓ ML-Einstellungen gespeichert!' : 'ML-Einstellungen speichern'}
              </button>
            </div>
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
                          ✓ Eingeloggt
                        </span>
                      </div>
                    </div>

                    <div className="text-sm text-gray-400 space-y-1">
                      <p>✓ API-Schlüssel werden synchronisiert</p>
                      <p>✓ Custom Symbols werden gespeichert</p>
                      <p>✓ ML-Einstellungen geräteübergreifend</p>
                    </div>
                  </div>

                  <button
                    onClick={handleLogout}
                    className="w-full py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 rounded-lg text-red-400 font-medium transition-colors"
                  >
                    Abmelden
                  </button>
                </div>
              ) : (
                <div>
                  {showRegister ? (
                    <div>
                      <RegisterForm onSuccess={() => setShowRegister(false)} />
                      <p className="text-center text-gray-400 mt-4">
                        Bereits ein Konto?{' '}
                        <button
                          onClick={() => setShowRegister(false)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          Anmelden
                        </button>
                      </p>
                    </div>
                  ) : (
                    <div>
                      <LoginForm />
                      <p className="text-center text-gray-400 mt-4">
                        Noch kein Konto?{' '}
                        <button
                          onClick={() => setShowRegister(true)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          Registrieren
                        </button>
                      </p>
                    </div>
                  )}

                  <div className="mt-6 p-4 bg-slate-900/50 rounded-lg">
                    <h4 className="text-white font-medium mb-2">Vorteile eines Kontos:</h4>
                    <ul className="text-sm text-gray-400 space-y-1">
                      <li>• API-Schlüssel geräteübergreifend synchronisieren</li>
                      <li>• Custom Symbols speichern</li>
                      <li>• ML-Einstellungen beibehalten</li>
                      <li>• Watchlist zwischen Geräten teilen</li>
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
