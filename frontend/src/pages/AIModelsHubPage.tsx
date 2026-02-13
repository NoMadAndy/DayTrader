/**
 * AI & Models Hub Page
 * 
 * Unified page for managing ML Models, RL Agents, and Historical Data.
 * Combines functionality from MLModelsPage, RLAgentsPage, and HistoricalDataPage.
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuthState, getAuthHeaders, subscribeToAuth, type AuthState } from '../services/authService';
import { RLAgentsPanel } from '../components';
import { rlTradingService, type RLServiceHealth } from '../services/rlTradingService';
import { log } from '../utils/logger';

type AIHubTab = 'ml-models' | 'rl-agents' | 'historical-data';

// ============================================================================
// Interfaces
// ============================================================================

interface MLModel {
  symbol: string;
  modelType: string;
  trainedAt?: string;
  accuracy?: number;
  mse?: number;
  mae?: number;
  r2?: number;
  epochs?: number;
  dataPoints?: number;
  status: 'ready' | 'training' | 'error' | 'not_found';
  error?: string;
}

interface TrainingStatus {
  symbol: string;
  status: 'idle' | 'preparing' | 'training' | 'completed' | 'error';
  progress?: number;
  currentEpoch?: number;
  totalEpochs?: number;
  error?: string;
}

interface MLServiceInfo {
  status: string;
  version?: string;
  gpu_available?: boolean;
  device?: string;
  models_loaded?: number;
}

interface AvailableSymbol {
  symbol: string;
  name?: string;
  recordCount: number;
  dateRange?: {
    start: string;
    end: string;
  };
}

interface SymbolAvailability {
  symbol: string;
  available: boolean;
  recordCount?: number;
  startDate?: string;
  endDate?: string;
  status: 'available' | 'partial' | 'missing' | 'error';
}

// ============================================================================
// Main Component
// ============================================================================

export function AIModelsHubPage() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [activeTab, setActiveTab] = useState<AIHubTab>('ml-models');
  
  // ML Models State
  const [models, setModels] = useState<MLModel[]>([]);
  const [mlServiceInfo, setMlServiceInfo] = useState<MLServiceInfo | null>(null);
  const [mlLoading, setMlLoading] = useState(true);
  const [trainingStatus, setTrainingStatus] = useState<Record<string, TrainingStatus>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  
  // RL Agents State
  const [rlHealth, setRlHealth] = useState<RLServiceHealth | null>(null);
  
  // Historical Data State
  const [availableSymbols, setAvailableSymbols] = useState<AvailableSymbol[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [searchSymbol, setSearchSymbol] = useState('');
  const [checkResult, setCheckResult] = useState<SymbolAvailability | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);

  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  // ============================================================================
  // ML Models Functions
  // ============================================================================

  const fetchModels = useCallback(async () => {
    setMlLoading(true);
    try {
      const [modelsRes, healthRes] = await Promise.allSettled([
        fetch('/api/ml/models'),
        fetch('/api/ml/health'),
      ]);

      if (modelsRes.status === 'fulfilled' && modelsRes.value.ok) {
        const data = await modelsRes.value.json();
        // Map API response to MLModel interface
        const mappedModels: MLModel[] = (data.models || []).map((m: Record<string, unknown>) => ({
          symbol: m.symbol as string,
          modelType: ((m.metadata as Record<string, unknown>)?.model_type as string || 'LSTM').toUpperCase(),
          trainedAt: (m.metadata as Record<string, unknown>)?.trained_at as string | undefined,
          accuracy: (m.metadata as Record<string, unknown>)?.accuracy as number | undefined,
          mse: (m.metadata as Record<string, unknown>)?.final_val_loss as number | undefined,
          epochs: (m.metadata as Record<string, unknown>)?.epochs_completed as number | undefined,
          dataPoints: (m.metadata as Record<string, unknown>)?.data_points as number | undefined,
          status: m.is_trained ? 'ready' : 'not_found',
        }));
        setModels(mappedModels);
      }

      if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
        const data = await healthRes.value.json();
        setMlServiceInfo(data);
      }
    } catch (error) {
      log.error('Failed to fetch ML data:', error);
    } finally {
      setMlLoading(false);
    }
  }, []);

  const startTraining = async (symbol: string) => {
    if (!authState.user) {
      alert('Bitte einloggen um zu trainieren');
      return;
    }

    setTrainingStatus(prev => ({
      ...prev,
      [symbol]: { symbol, status: 'preparing' }
    }));

    try {
      const histResponse = await fetch(`/api/historical-prices/${encodeURIComponent(symbol)}?days=365`);
      if (!histResponse.ok) {
        throw new Error('Keine historischen Daten verfügbar');
      }
      const histData = await histResponse.json();

      const response = await fetch('/api/ml/train', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          symbol,
          prices: histData.prices,
          epochs: 100,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Training fehlgeschlagen');
      }

      setTrainingStatus(prev => ({
        ...prev,
        [symbol]: { symbol, status: 'training' }
      }));

      const pollStatus = async () => {
        try {
          const statusRes = await fetch(`/api/ml/train/${encodeURIComponent(symbol)}/status`);
          if (statusRes.ok) {
            const status = await statusRes.json();
            setTrainingStatus(prev => ({
              ...prev,
              [symbol]: { symbol, ...status }
            }));

            if (status.status === 'training') {
              setTimeout(pollStatus, 2000);
            } else if (status.status === 'completed') {
              fetchModels();
            }
          }
        } catch (err) {
          log.error('Status poll error:', err);
        }
      };

      pollStatus();
    } catch (error) {
      setTrainingStatus(prev => ({
        ...prev,
        [symbol]: { 
          symbol, 
          status: 'error', 
          error: error instanceof Error ? error.message : 'Unbekannter Fehler'
        }
      }));
    }
  };

  const deleteModel = async (symbol: string) => {
    if (!authState.user) return;

    try {
      const response = await fetch(`/api/ml/models/${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
        },
      });

      if (response.ok) {
        setModels(prev => prev.filter(m => m.symbol !== symbol));
        setDeleteConfirm(null);
      }
    } catch (error) {
      log.error('Delete failed:', error);
    }
  };

  // ============================================================================
  // RL Agents Functions
  // ============================================================================

  const loadRLHealth = useCallback(async () => {
    const healthData = await rlTradingService.getHealth();
    setRlHealth(healthData);
  }, []);

  // ============================================================================
  // Historical Data Functions
  // ============================================================================

  const fetchAvailableSymbols = useCallback(async () => {
    setHistLoading(true);
    try {
      const response = await fetch('/api/historical-prices/symbols/available');
      if (response.ok) {
        const data = await response.json();
        setAvailableSymbols(data.symbols || []);
      }
    } catch (error) {
      log.error('Failed to fetch available symbols:', error);
    } finally {
      setHistLoading(false);
    }
  }, []);

  const checkSymbolAvailability = async () => {
    if (!searchSymbol.trim()) return;
    
    setCheckLoading(true);
    setCheckResult(null);
    
    try {
      const response = await fetch(`/api/historical-prices/${encodeURIComponent(searchSymbol.toUpperCase())}/availability`);
      if (response.ok) {
        const data = await response.json();
        setCheckResult({
          symbol: searchSymbol.toUpperCase(),
          available: data.available,
          recordCount: data.recordCount,
          startDate: data.startDate,
          endDate: data.endDate,
          status: data.available 
            ? (data.recordCount > 200 ? 'available' : 'partial')
            : 'missing',
        });
      } else {
        setCheckResult({
          symbol: searchSymbol.toUpperCase(),
          available: false,
          status: 'missing',
        });
      }
    } catch {
      setCheckResult({
        symbol: searchSymbol.toUpperCase(),
        available: false,
        status: 'error',
      });
    } finally {
      setCheckLoading(false);
    }
  };

  const refreshSymbolData = async (symbol: string) => {
    if (!authState.user) {
      alert('Bitte einloggen um Daten zu aktualisieren');
      return;
    }
    
    setRefreshing(prev => ({ ...prev, [symbol]: true }));
    
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    try {
      const response = await fetch(`/api/historical-prices/${encodeURIComponent(symbol)}/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ startDate, endDate }),
      });
      
      if (response.ok) {
        await fetchAvailableSymbols();
        if (checkResult?.symbol === symbol) {
          await checkSymbolAvailability();
        }
      }
    } catch (error) {
      log.error(`Failed to refresh ${symbol}:`, error);
    } finally {
      setRefreshing(prev => ({ ...prev, [symbol]: false }));
    }
  };

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    if (activeTab === 'ml-models') {
      fetchModels();
    } else if (activeTab === 'rl-agents') {
      loadRLHealth();
    } else if (activeTab === 'historical-data') {
      fetchAvailableSymbols();
    }
  }, [activeTab, fetchModels, loadRLHealth, fetchAvailableSymbols]);

  // ============================================================================
  // Helper Functions
  // ============================================================================

  const getStatusBadge = (status: string, recordCount?: number) => {
    switch (status) {
      case 'available':
        return (
          <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs flex items-center gap-1">
            ✅ Vollständig {recordCount && <span className="text-gray-400">({recordCount})</span>}
          </span>
        );
      case 'partial':
        return (
          <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs flex items-center gap-1">
            ⚠️ Teilweise {recordCount && <span className="text-gray-400">({recordCount})</span>}
          </span>
        );
      case 'missing':
        return <span className="px-2 py-1 bg-gray-500/20 text-gray-400 rounded text-xs">📭 Nicht vorhanden</span>;
      default:
        return <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">❌ Fehler</span>;
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('de-DE');
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (!authState.isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-8">
        <div className="bg-slate-800/50 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">🧠 AI & Modelle</h2>
          <p className="text-slate-400 mb-4">
            Bitte einloggen um auf AI & Modelle zuzugreifen.
          </p>
          <a 
            href="/settings" 
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            Zum Login
          </a>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'ml-models' as const, label: 'ML Modelle', icon: '🧠', count: models.length },
    { id: 'rl-agents' as const, label: 'RL Agenten', icon: '🤖', count: null },
    { id: 'historical-data' as const, label: 'Historische Daten', icon: '📊', count: availableSymbols.length },
  ];

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex-1 flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
          <span className="text-2xl sm:text-3xl">🧠</span>
          AI & Modelle
        </h1>
        <p className="text-slate-400 mt-1">
          Machine Learning, Reinforcement Learning Agenten und Trainingsdaten verwalten
        </p>
      </div>

      {/* Service Status Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <div className="text-xs text-slate-400">ML Service</div>
          <div className={`text-sm font-bold ${mlServiceInfo?.status === 'healthy' ? 'text-green-400' : 'text-yellow-400'}`}>
            {mlServiceInfo?.status === 'healthy' ? '✓ Online' : '⏳ Laden...'}
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <div className="text-xs text-slate-400">RL Service</div>
          <div className={`text-sm font-bold ${rlHealth?.status === 'healthy' ? 'text-green-400' : 'text-yellow-400'}`}>
            {rlHealth?.status === 'healthy' ? '✓ Online' : '⏳ Laden...'}
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <div className="text-xs text-slate-400">Compute</div>
          <div className="text-sm font-bold text-white">
            {mlServiceInfo?.device === 'cuda' || rlHealth?.device_info?.device === 'cuda' ? '🚀 GPU' : '💻 CPU'}
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <div className="text-xs text-slate-400">Modelle geladen</div>
          <div className="text-sm font-bold text-white">
            {(mlServiceInfo?.models_loaded || 0) + models.length}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-700 mb-4 overflow-x-auto scrollbar-hide">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium transition-colors border-b-2 whitespace-nowrap flex-1 sm:flex-none justify-center sm:justify-start ${
              activeTab === tab.id
                ? 'border-blue-400 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <span>{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.id === 'ml-models' ? 'ML' : tab.id === 'rl-agents' ? 'RL' : 'Daten'}</span>
            {tab.count !== null && tab.count > 0 && (
              <span className="px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs bg-slate-700 rounded-full">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">
        {/* ML Models Tab */}
        {activeTab === 'ml-models' && (
          <div className="space-y-4">
            {mlLoading ? (
              <div className="text-center py-8 text-gray-400">
                <div className="animate-spin text-2xl mb-2">⏳</div>
                Lade Modelle...
              </div>
            ) : models.length === 0 ? (
              <div className="bg-slate-800/50 rounded-xl p-8 text-center">
                <div className="text-4xl mb-4">🧠</div>
                <h3 className="text-lg font-medium text-white mb-2">Keine ML-Modelle</h3>
                <p className="text-slate-400 text-sm">
                  Trainiere ein Modell über das Dashboard oder lade historische Daten herunter.
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {models.map(model => {
                  const status = trainingStatus[model.symbol];
                  return (
                    <div key={model.symbol} className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold">
                            {model.symbol.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-white">{model.symbol}</div>
                            <div className="text-xs text-slate-400">
                              {model.trainedAt ? `Trainiert: ${formatDate(model.trainedAt)}` : 'Nicht trainiert'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {model.accuracy && (
                            <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs">
                              {(model.accuracy * 100).toFixed(1)}% Accuracy
                            </span>
                          )}
                          {status?.status === 'training' && (
                            <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs animate-pulse">
                              Training...
                            </span>
                          )}
                          <button
                            onClick={() => startTraining(model.symbol)}
                            disabled={status?.status === 'training'}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 rounded text-xs text-white transition-colors"
                          >
                            {status?.status === 'training' ? '⏳' : '🔄'} Trainieren
                          </button>
                          {deleteConfirm === model.symbol ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => deleteModel(model.symbol)}
                                className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs text-white"
                              >
                                Ja
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded text-xs text-white"
                              >
                                Nein
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(model.symbol)}
                              className="px-2 py-1.5 bg-slate-700 hover:bg-red-600/30 hover:text-red-400 rounded text-xs text-gray-400 transition-colors"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* RL Agents Tab */}
        {activeTab === 'rl-agents' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <RLAgentsPanel />
            </div>
            <div className="space-y-4">
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                <h3 className="text-lg font-semibold text-white mb-3">📚 Wie funktioniert's?</h3>
                <div className="text-sm text-slate-400 space-y-2">
                  <p>
                    RL Trading Agents nutzen <strong className="text-white">Deep Reinforcement Learning</strong> (PPO Algorithmus) 
                    um Handelsstrategien aus historischen Marktdaten zu lernen.
                  </p>
                  <p>
                    Jeder Agent wird trainiert um Profit zu maximieren unter Berücksichtigung deiner konfigurierten 
                    Risikoparameter wie Stop-Loss und Take-Profit.
                  </p>
                </div>
              </div>
              {rlHealth?.device_info?.device !== 'cuda' && (
                <div className="bg-amber-900/30 border border-amber-600 rounded-lg p-4">
                  <h4 className="text-amber-400 font-medium mb-2">💡 GPU Beschleunigung</h4>
                  <p className="text-sm text-amber-200/80">
                    Training läuft auf CPU. Für schnelleres Training, aktiviere GPU Support mit dem GPU docker-compose override.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Historical Data Tab */}
        {activeTab === 'historical-data' && (
          <div className="space-y-4">
            {/* Search */}
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
              <h3 className="font-medium text-white mb-3 flex items-center gap-2">
                <span>🔍</span> Symbol prüfen
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchSymbol}
                  onChange={(e) => setSearchSymbol(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && checkSymbolAvailability()}
                  placeholder="Symbol eingeben (z.B. AAPL)"
                  className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-gray-400 text-sm"
                />
                <button
                  onClick={checkSymbolAvailability}
                  disabled={checkLoading || !searchSymbol.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 rounded-lg text-sm text-white transition-colors"
                >
                  {checkLoading ? '⏳' : '🔍'} Prüfen
                </button>
              </div>
              {checkResult && (
                <div className="mt-3 p-3 bg-slate-900/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-white">{checkResult.symbol}</span>
                      <span className="ml-2">{getStatusBadge(checkResult.status, checkResult.recordCount)}</span>
                    </div>
                    <button
                      onClick={() => refreshSymbolData(checkResult.symbol)}
                      disabled={refreshing[checkResult.symbol]}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 rounded text-xs text-white transition-colors"
                    >
                      {refreshing[checkResult.symbol] ? '⏳' : '📥'} Laden
                    </button>
                  </div>
                  {checkResult.startDate && checkResult.endDate && (
                    <div className="text-xs text-slate-400 mt-2">
                      Zeitraum: {formatDate(checkResult.startDate)} - {formatDate(checkResult.endDate)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Available Symbols */}
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-white flex items-center gap-2">
                  <span>📊</span> Verfügbare Daten ({availableSymbols.length})
                </h3>
                <button
                  onClick={fetchAvailableSymbols}
                  disabled={histLoading}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white transition-colors"
                >
                  {histLoading ? '⏳' : '🔄'} Aktualisieren
                </button>
              </div>
              
              {histLoading ? (
                <div className="text-center py-8 text-gray-400">Lade...</div>
              ) : availableSymbols.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">📭</div>
                  Keine historischen Daten vorhanden
                </div>
              ) : (
                <div className="grid gap-2 max-h-96 overflow-y-auto">
                  {availableSymbols.map(sym => (
                    <div key={sym.symbol} className="flex items-center justify-between p-2 bg-slate-900/50 rounded">
                      <div>
                        <span className="font-medium text-white">{sym.symbol}</span>
                        <span className="text-xs text-slate-400 ml-2">
                          {sym.recordCount} Einträge
                        </span>
                        {sym.dateRange && (
                          <span className="text-xs text-slate-500 ml-2">
                            ({formatDate(sym.dateRange.start)} - {formatDate(sym.dateRange.end)})
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => refreshSymbolData(sym.symbol)}
                        disabled={refreshing[sym.symbol]}
                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white transition-colors"
                        title="Daten aktualisieren"
                      >
                        {refreshing[sym.symbol] ? '⏳' : '🔄'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
