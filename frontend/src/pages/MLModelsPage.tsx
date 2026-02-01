/**
 * MLModelsPage - Machine Learning Model Management
 * Shows trained models, training status, and allows model management
 */

import { getAuthState, getAuthHeaders } from '../services/authService';
import { useState, useEffect, useCallback } from 'react';

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

export function MLModelsPage() {
  const authState = getAuthState();
  const user = authState.user;
  
  const [models, setModels] = useState<MLModel[]>([]);
  const [serviceInfo, setServiceInfo] = useState<MLServiceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [trainingStatus, setTrainingStatus] = useState<Record<string, TrainingStatus>>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [showTrainModal, setShowTrainModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const [modelsRes, healthRes] = await Promise.allSettled([
        fetch('/api/ml/models'),
        fetch('/api/ml/health'),
      ]);

      if (modelsRes.status === 'fulfilled' && modelsRes.value.ok) {
        const data = await modelsRes.value.json();
        setModels(data.models || []);
      }

      if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
        const data = await healthRes.value.json();
        setServiceInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch ML data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const startTraining = async (symbol: string) => {
    if (!user) {
      alert('Bitte einloggen um zu trainieren');
      return;
    }

    setTrainingStatus(prev => ({
      ...prev,
      [symbol]: { symbol, status: 'preparing' }
    }));

    try {
      // First fetch historical data
      const histResponse = await fetch(`/api/historical-prices/${encodeURIComponent(symbol)}?days=365`);
      if (!histResponse.ok) {
        throw new Error('Keine historischen Daten verfügbar');
      }
      const histData = await histResponse.json();

      // Start training
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

      // Poll for status
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
          console.error('Status poll error:', err);
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
    if (!user) return;

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
      console.error('Delete failed:', error);
    }
  };

  const getStatusBadge = (model: MLModel) => {
    const status = trainingStatus[model.symbol]?.status;
    
    if (status === 'training' || status === 'preparing') {
      return (
        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs flex items-center gap-1">
          <span className="animate-spin">⟳</span>
          Training...
        </span>
      );
    }
    
    switch (model.status) {
      case 'ready':
        return <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs">✅ Bereit</span>;
      case 'training':
        return <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">🔄 Training</span>;
      case 'error':
        return <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">❌ Fehler</span>;
      default:
        return <span className="px-2 py-1 bg-gray-500/20 text-gray-400 rounded text-xs">⏳ Nicht trainiert</span>;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
            <span className="text-3xl">🧠</span>
            ML Modell-Verwaltung
          </h1>
          <p className="text-gray-400 mt-1">
            Trainierte Transformer-Modelle für Kursprognosen
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {serviceInfo && (
            <div className={`px-3 py-1.5 rounded-lg flex items-center gap-2 ${
              serviceInfo.status === 'healthy' 
                ? 'bg-green-500/20 border border-green-500/50' 
                : 'bg-red-500/20 border border-red-500/50'
            }`}>
              <span>{serviceInfo.status === 'healthy' ? '🟢' : '🔴'}</span>
              <span className="text-sm">
                {serviceInfo.gpu_available ? `GPU (${serviceInfo.device})` : 'CPU'}
              </span>
            </div>
          )}
          
          <button
            onClick={fetchModels}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            🔄 Aktualisieren
          </button>
          
          {user && (
            <button
              onClick={() => setShowTrainModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <span>➕</span>
              Neues Modell
            </button>
          )}
        </div>
      </div>

      {/* Service Info Card */}
      {serviceInfo && (
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700 mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-gray-400">Service Status</div>
              <div className="text-lg font-bold flex items-center gap-2">
                {serviceInfo.status === 'healthy' ? '✅' : '❌'}
                {serviceInfo.status}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Version</div>
              <div className="text-lg font-bold">{serviceInfo.version || 'N/A'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Geladene Modelle</div>
              <div className="text-lg font-bold">{serviceInfo.models_loaded || 0}</div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Hardware</div>
              <div className="text-lg font-bold">
                {serviceInfo.gpu_available ? `🖥️ GPU` : '💻 CPU'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Models Grid */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin text-4xl mb-4">⟳</div>
          <p className="text-gray-400">Lade Modelle...</p>
        </div>
      ) : models.length === 0 ? (
        <div className="bg-slate-800/50 rounded-xl p-8 border border-slate-700 text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h3 className="text-xl font-bold mb-2">Noch keine Modelle trainiert</h3>
          <p className="text-gray-400 mb-4">
            Trainiere ein ML-Modell für ein Symbol, um Kursprognosen zu erhalten.
          </p>
          {user && (
            <button
              onClick={() => setShowTrainModal(true)}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Erstes Modell trainieren
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model) => (
            <div 
              key={model.symbol}
              className="bg-slate-800/50 rounded-xl p-5 border border-slate-700 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold">{model.symbol}</h3>
                  <p className="text-sm text-gray-400">{model.modelType || 'Transformer'}</p>
                </div>
                {getStatusBadge(model)}
              </div>

              {model.status === 'ready' && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {model.accuracy !== undefined && (
                    <div className="bg-slate-700/50 rounded-lg p-2">
                      <div className="text-xs text-gray-400">Accuracy</div>
                      <div className="text-lg font-bold text-green-400">
                        {(model.accuracy * 100).toFixed(1)}%
                      </div>
                    </div>
                  )}
                  {model.r2 !== undefined && (
                    <div className="bg-slate-700/50 rounded-lg p-2">
                      <div className="text-xs text-gray-400">R² Score</div>
                      <div className="text-lg font-bold text-blue-400">
                        {model.r2.toFixed(3)}
                      </div>
                    </div>
                  )}
                  {model.mse !== undefined && (
                    <div className="bg-slate-700/50 rounded-lg p-2">
                      <div className="text-xs text-gray-400">MSE</div>
                      <div className="text-lg font-bold">{model.mse.toFixed(4)}</div>
                    </div>
                  )}
                  {model.epochs !== undefined && (
                    <div className="bg-slate-700/50 rounded-lg p-2">
                      <div className="text-xs text-gray-400">Epochs</div>
                      <div className="text-lg font-bold">{model.epochs}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Training Progress */}
              {trainingStatus[model.symbol]?.status === 'training' && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">Training Progress</span>
                    <span>
                      {trainingStatus[model.symbol].currentEpoch || 0} / {trainingStatus[model.symbol].totalEpochs || 100}
                    </span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${trainingStatus[model.symbol].progress || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {trainingStatus[model.symbol]?.status === 'error' && (
                <div className="mb-4 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                  {trainingStatus[model.symbol].error}
                </div>
              )}

              {model.trainedAt && (
                <p className="text-xs text-gray-500 mb-4">
                  Trainiert: {new Date(model.trainedAt).toLocaleString('de-DE')}
                </p>
              )}

              {/* Actions */}
              {user && (
                <div className="flex gap-2">
                  <button
                    onClick={() => startTraining(model.symbol)}
                    disabled={trainingStatus[model.symbol]?.status === 'training'}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
                  >
                    🔄 Neu trainieren
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(model.symbol)}
                    className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm transition-colors"
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Train New Model Modal */}
      {showTrainModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-md w-full p-6 border border-slate-700">
            <h2 className="text-xl font-bold mb-4">Neues Modell trainieren</h2>
            
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Symbol</label>
              <input
                type="text"
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value.toUpperCase())}
                placeholder="z.B. AAPL, MSFT, TSLA"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div>

            <p className="text-sm text-gray-400 mb-4">
              Das Training verwendet die letzten 365 Tage historischer Daten und kann einige Minuten dauern.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowTrainModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  if (selectedSymbol) {
                    startTraining(selectedSymbol);
                    setShowTrainModal(false);
                    setSelectedSymbol('');
                  }
                }}
                disabled={!selectedSymbol}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Training starten
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-md w-full p-6 border border-slate-700">
            <h2 className="text-xl font-bold mb-4">Modell löschen?</h2>
            <p className="text-gray-400 mb-4">
              Möchtest du das Modell für <strong>{deleteConfirm}</strong> wirklich löschen? 
              Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={() => deleteModel(deleteConfirm)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
