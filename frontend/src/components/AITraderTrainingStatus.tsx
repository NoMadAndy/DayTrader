/**
 * AI Trader Training Status Component
 * 
 * Displays the training status and quality metrics for an AI trader's
 * RL agent and learning configuration.
 */

import { useState, useEffect } from 'react';
import { getTraderTrainingStatus, type TraderTrainingStatus } from '../services/aiTraderService';

interface AITraderTrainingStatusProps {
  traderId: number;
  compact?: boolean;
}

export function AITraderTrainingStatus({ traderId, compact = false }: AITraderTrainingStatusProps) {
  const [status, setStatus] = useState<TraderTrainingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
    
    // Refresh every 60 seconds
    const interval = setInterval(loadStatus, 60000);
    return () => clearInterval(interval);
  }, [traderId]);

  async function loadStatus() {
    try {
      setLoading(true);
      const data = await getTraderTrainingStatus(traderId);
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load training status');
    } finally {
      setLoading(false);
    }
  }

  if (loading && !status) {
    return (
      <div className="animate-pulse bg-slate-700/30 rounded-lg p-3">
        <div className="h-4 bg-slate-600 rounded w-1/3 mb-2"></div>
        <div className="h-3 bg-slate-600 rounded w-2/3"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
        ⚠️ {error}
      </div>
    );
  }

  if (!status) return null;

  // Compact version for the card
  if (compact) {
    return <CompactTrainingStatus status={status} />;
  }

  // Full version
  return <FullTrainingStatus status={status} onRefresh={loadStatus} />;
}

function CompactTrainingStatus({ status }: { status: TraderTrainingStatus }) {
  const rl = status.rlAgent;
  
  // Determine overall training quality
  const getQualityInfo = () => {
    if (rl.status === 'not_configured') {
      return { color: 'text-gray-400', bg: 'bg-gray-500/20', icon: '⚪', label: 'Kein Agent' };
    }
    if (rl.status === 'training') {
      return { color: 'text-blue-400', bg: 'bg-blue-500/20', icon: '🔄', label: `Training ${(rl.trainingProgress * 100).toFixed(0)}%` };
    }
    if (!rl.isTrained) {
      return { color: 'text-amber-400', bg: 'bg-amber-500/20', icon: '⚠️', label: 'Untrainiert' };
    }
    
    // Trained - check quality
    const metrics = rl.performanceMetrics;
    if (metrics) {
      if (metrics.meanReturnPct >= 5) {
        return { color: 'text-green-400', bg: 'bg-green-500/20', icon: '🏆', label: 'Exzellent' };
      }
      if (metrics.meanReturnPct >= 2) {
        return { color: 'text-emerald-400', bg: 'bg-emerald-500/20', icon: '✅', label: 'Gut' };
      }
      if (metrics.meanReturnPct >= 0) {
        return { color: 'text-yellow-400', bg: 'bg-yellow-500/20', icon: '📊', label: 'Moderat' };
      }
      return { color: 'text-orange-400', bg: 'bg-orange-500/20', icon: '📉', label: 'Schwach' };
    }
    
    return { color: 'text-green-400', bg: 'bg-green-500/20', icon: '✅', label: 'Trainiert' };
  };

  const quality = getQualityInfo();
  const lastTrained = rl.lastTrained ? formatTimeAgo(rl.lastTrained) : null;

  return (
    <div className={`px-3 py-2 rounded-lg ${quality.bg} flex items-center gap-2`}>
      <span>{quality.icon}</span>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${quality.color}`}>
          RL: {quality.label}
        </div>
        {lastTrained && (
          <div className="text-xs text-gray-400 truncate">
            Trainiert {lastTrained}
          </div>
        )}
      </div>
      {rl.performanceMetrics && (
        <div className="text-right">
          <div className={`text-sm font-bold ${rl.performanceMetrics.meanReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {rl.performanceMetrics.meanReturnPct >= 0 ? '+' : ''}{rl.performanceMetrics.meanReturnPct.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-400">Ø Return</div>
        </div>
      )}
    </div>
  );
}

function FullTrainingStatus({ status, onRefresh }: { status: TraderTrainingStatus; onRefresh: () => void }) {
  const rl = status.rlAgent;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          🎓 Trainings-Status
        </h3>
        <button
          onClick={onRefresh}
          className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-slate-700 transition-colors"
        >
          🔄 Aktualisieren
        </button>
      </div>

      {/* RL Agent Status */}
      <div className="bg-slate-700/30 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-gray-300 font-medium">🤖 RL Agent</span>
          <RLStatusBadge status={rl.status} />
        </div>

        {status.rlAgentName ? (
          <>
            <div className="text-sm text-gray-400">
              Agent: <span className="text-white font-mono">{status.rlAgentName}</span>
            </div>

            {rl.status === 'training' && (
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Fortschritt</span>
                  <span className="text-blue-400">{(rl.trainingProgress * 100).toFixed(1)}%</span>
                </div>
                <div className="w-full bg-slate-600 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${rl.trainingProgress * 100}%` }}
                  />
                </div>
              </div>
            )}

            {rl.isTrained && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-400">Letzes Training:</span>
                  <div className="text-white">
                    {rl.lastTrained ? formatTimeAgo(rl.lastTrained) : 'Unbekannt'}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400">Episoden:</span>
                  <div className="text-white">{rl.totalEpisodes.toLocaleString()}</div>
                </div>
                {rl.bestReward !== null && (
                  <div>
                    <span className="text-gray-400">Beste Belohnung:</span>
                    <div className="text-green-400">{rl.bestReward.toFixed(2)}</div>
                  </div>
                )}
              </div>
            )}

            {/* Performance Metrics */}
            {rl.performanceMetrics && (
              <div className="mt-3 pt-3 border-t border-slate-600">
                <div className="text-sm text-gray-400 mb-2">Performance-Metriken:</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-800/50 rounded p-2">
                    <div className={`text-lg font-bold ${rl.performanceMetrics.meanReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {rl.performanceMetrics.meanReturnPct >= 0 ? '+' : ''}{rl.performanceMetrics.meanReturnPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">Ø Return</div>
                  </div>
                  <div className="bg-slate-800/50 rounded p-2">
                    <div className="text-lg font-bold text-green-400">
                      +{rl.performanceMetrics.maxReturnPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">Max</div>
                  </div>
                  <div className="bg-slate-800/50 rounded p-2">
                    <div className="text-lg font-bold text-red-400">
                      {rl.performanceMetrics.minReturnPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">Min</div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-400 italic">
            Kein RL Agent konfiguriert. Konfiguriere einen Agent in den Einstellungen.
          </div>
        )}
      </div>

      {/* Self-Training Status */}
      <div className="bg-slate-700/30 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-300 font-medium">🔄 Self-Training</span>
          <span className={`px-2 py-0.5 rounded text-xs ${
            status.selfTraining.enabled 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-slate-500/20 text-slate-400'
          }`}>
            {status.selfTraining.enabled ? 'Aktiv' : 'Deaktiviert'}
          </span>
        </div>
        {status.selfTraining.enabled && (
          <div className="text-sm text-gray-400 space-y-1">
            <div>Intervall: alle {status.selfTraining.intervalMinutes} Min</div>
            <div>Schritte: {status.selfTraining.timesteps.toLocaleString()} pro Session</div>
          </div>
        )}
      </div>

      {/* Learning Mode Status */}
      <div className="bg-slate-700/30 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-300 font-medium">🧠 Adaptives Lernen</span>
          <span className={`px-2 py-0.5 rounded text-xs ${
            status.learningMode.enabled 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-slate-500/20 text-slate-400'
          }`}>
            {status.learningMode.enabled ? 'Aktiv' : 'Deaktiviert'}
          </span>
        </div>
        {status.learningMode.enabled && (
          <div className="text-sm text-gray-400 space-y-1">
            <div>
              Gewichtungen anpassen: {' '}
              <span className={status.learningMode.updateWeights ? 'text-green-400' : 'text-gray-400'}>
                {status.learningMode.updateWeights ? '✅ Ja' : '❌ Nein'}
              </span>
            </div>
            <div>Min. Samples: {status.learningMode.minSamples}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function RLStatusBadge({ status }: { status: string }) {
  const getStyle = () => {
    switch (status) {
      case 'trained':
        return { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Trainiert' };
      case 'training':
        return { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Training...' };
      case 'not_trained':
        return { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Nicht trainiert' };
      case 'not_configured':
        return { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Nicht konfiguriert' };
      default:
        return { bg: 'bg-gray-500/20', text: 'text-gray-400', label: status };
    }
  };

  const style = getStyle();
  
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'gerade eben';
  if (diffMins < 60) return `vor ${diffMins} Min`;
  if (diffHours < 24) return `vor ${diffHours} Std`;
  if (diffDays < 7) return `vor ${diffDays} Tag${diffDays > 1 ? 'en' : ''}`;
  
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default AITraderTrainingStatus;
