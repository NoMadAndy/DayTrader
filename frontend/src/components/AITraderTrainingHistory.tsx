/**
 * AI Trader Training History Component
 * 
 * Displays the complete training history with results, duration,
 * and performance metrics for each training session.
 */

import { useState, useEffect } from 'react';
import { getTrainingHistory, getTrainingStats, type TrainingHistoryEntry, type TrainingStats } from '../services/aiTraderService';

interface AITraderTrainingHistoryProps {
  traderId: number;
  compact?: boolean;
  className?: string;
}

export function AITraderTrainingHistory({ traderId, compact = false, className = '' }: AITraderTrainingHistoryProps) {
  const [history, setHistory] = useState<TrainingHistoryEntry[]>([]);
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    loadData();
    
    // Refresh every 60 seconds
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [traderId]);

  async function loadData() {
    try {
      setLoading(true);
      const [historyData, statsData] = await Promise.all([
        getTrainingHistory(traderId, compact ? 5 : 20),
        getTrainingStats(traderId)
      ]);
      setHistory(historyData);
      setStats(statsData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden der Training-Historie');
    } finally {
      setLoading(false);
    }
  }

  if (loading && history.length === 0) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-5 border border-slate-700 ${className}`}>
        <div className="animate-pulse">
          <div className="h-6 bg-slate-700 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-16 bg-slate-700 rounded"></div>
            <div className="h-16 bg-slate-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-5 border border-slate-700 ${className}`}>
        <div className="text-center py-4">
          <span className="text-red-400">⚠️ {error}</span>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-5 border border-slate-700 ${className}`}>
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <span>🎓</span>
          Training-Historie
        </h3>
        <div className="text-center py-8 text-gray-400">
          <div className="text-3xl mb-3">📭</div>
          <p>Noch keine Trainings durchgeführt</p>
          <p className="text-sm mt-2">Das Self-Training startet automatisch in Ruhephasen</p>
        </div>
      </div>
    );
  }

  // Compact version for cards
  if (compact) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-4 border border-slate-700 ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-gray-300 flex items-center gap-2">
            <span>🎓</span> Letzte Trainings
          </h4>
          {stats && (
            <span className="text-xs text-gray-400">
              {stats.successful_sessions} erfolgreich
            </span>
          )}
        </div>
        <div className="space-y-2">
          {history.slice(0, 3).map((entry) => (
            <CompactTrainingEntry key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    );
  }

  // Full version
  return (
    <div className={`bg-slate-800/50 rounded-xl p-5 border border-slate-700 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <span>🎓</span>
          Training-Historie
        </h3>
        <button
          onClick={loadData}
          className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-slate-700 transition-colors"
        >
          🔄 Aktualisieren
        </button>
      </div>

      {/* Statistics Summary */}
      {stats && stats.total_sessions > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatCard
            label="Trainings"
            value={stats.total_sessions.toString()}
            subValue={`${stats.successful_sessions} erfolgreich`}
            color="blue"
          />
          <StatCard
            label="Ø Reward"
            value={stats.avg_reward != null ? Number(stats.avg_reward).toFixed(1) : '-'}
            subValue={`Best: ${stats.best_reward != null ? Number(stats.best_reward).toFixed(1) : '-'}`}
            color={stats.avg_reward && Number(stats.avg_reward) >= 0 ? 'green' : 'red'}
          />
          <StatCard
            label="Ø Return"
            value={stats.avg_return_pct != null ? `${Number(stats.avg_return_pct).toFixed(1)}%` : '-'}
            subValue={stats.best_return_pct != null ? `Best: ${Number(stats.best_return_pct).toFixed(1)}%` : ''}
            color={stats.avg_return_pct && stats.avg_return_pct >= 0 ? 'green' : 'red'}
          />
          <StatCard
            label="Training-Zeit"
            value={formatDuration(stats.total_training_time_seconds || 0)}
            subValue={`${((stats.total_timesteps_trained || 0) / 1000).toFixed(0)}k Steps`}
            color="purple"
          />
        </div>
      )}

      {/* Training History List */}
      <div className="space-y-3">
        {history.map((entry) => (
          <TrainingEntry
            key={entry.id}
            entry={entry}
            expanded={expandedId === entry.id}
            onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
          />
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, subValue, color }: { 
  label: string; 
  value: string; 
  subValue?: string;
  color: 'blue' | 'green' | 'red' | 'purple';
}) {
  const colorClasses = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
    purple: 'text-purple-400',
  };

  return (
    <div className="bg-slate-700/50 rounded-lg p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-bold ${colorClasses[color]}`}>{value}</div>
      {subValue && <div className="text-xs text-gray-500">{subValue}</div>}
    </div>
  );
}

function CompactTrainingEntry({ entry }: { entry: TrainingHistoryEntry }) {
  const isSuccess = entry.status === 'completed';
  const date = new Date(entry.started_at);

  return (
    <div className={`flex items-center justify-between p-2 rounded-lg ${
      isSuccess ? 'bg-green-500/10' : 'bg-red-500/10'
    }`}>
      <div className="flex items-center gap-2">
        <span>{isSuccess ? '✅' : '❌'}</span>
        <span className="text-sm text-gray-300">
          {date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
        </span>
      </div>
      {entry.final_reward !== null && (
        <span className={`text-sm font-medium ${Number(entry.final_reward) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {Number(entry.final_reward) >= 0 ? '+' : ''}{Number(entry.final_reward).toFixed(1)}
        </span>
      )}
    </div>
  );
}

function TrainingEntry({ entry, expanded, onToggle }: { 
  entry: TrainingHistoryEntry; 
  expanded: boolean;
  onToggle: () => void;
}) {
  const isSuccess = entry.status === 'completed';
  const date = new Date(entry.started_at);
  
  return (
    <div className={`rounded-lg border transition-colors ${
      isSuccess 
        ? 'bg-green-500/5 border-green-500/20 hover:border-green-500/40' 
        : 'bg-red-500/5 border-red-500/20 hover:border-red-500/40'
    }`}>
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{isSuccess ? '✅' : '❌'}</span>
          <div>
            <div className="font-medium text-white flex items-center gap-2">
              {date.toLocaleDateString('de-DE', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
              <span className={`text-xs px-2 py-0.5 rounded ${
                isSuccess ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {isSuccess ? 'Erfolgreich' : 'Fehlgeschlagen'}
              </span>
            </div>
            <div className="text-sm text-gray-400 flex items-center gap-2 mt-1">
              {entry.symbols_trained && entry.symbols_trained.length > 0 && (
                <span>📈 {entry.symbols_trained.join(', ')}</span>
              )}
              {entry.duration_seconds && (
                <span>⏱️ {formatDuration(entry.duration_seconds)}</span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {entry.final_reward !== null && (
            <div className="text-right">
              <div className={`text-lg font-bold ${Number(entry.final_reward) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {Number(entry.final_reward) >= 0 ? '+' : ''}{Number(entry.final_reward).toFixed(2)}
              </div>
              <div className="text-xs text-gray-400">Reward</div>
            </div>
          )}
          {entry.mean_return_pct !== null && (
            <div className="text-right">
              <div className={`text-lg font-bold ${Number(entry.mean_return_pct) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {Number(entry.mean_return_pct) >= 0 ? '+' : ''}{Number(entry.mean_return_pct).toFixed(1)}%
              </div>
              <div className="text-xs text-gray-400">Ø Return</div>
            </div>
          )}
          <span className={`transform transition-transform ${expanded ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </div>
      </button>
      
      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-slate-700/50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {entry.total_timesteps && (
              <div className="bg-slate-700/30 rounded p-2">
                <div className="text-xs text-gray-400">Steps</div>
                <div className="font-medium">{entry.total_timesteps.toLocaleString()}</div>
              </div>
            )}
            {entry.episodes_completed && (
              <div className="bg-slate-700/30 rounded p-2">
                <div className="text-xs text-gray-400">Episoden</div>
                <div className="font-medium">{entry.episodes_completed}</div>
              </div>
            )}
            {entry.best_reward !== null && (
              <div className="bg-slate-700/30 rounded p-2">
                <div className="text-xs text-gray-400">Best Reward</div>
                <div className="font-medium text-green-400">{Number(entry.best_reward).toFixed(2)}</div>
              </div>
            )}
            {entry.mean_reward !== null && (
              <div className="bg-slate-700/30 rounded p-2">
                <div className="text-xs text-gray-400">Ø Reward</div>
                <div className="font-medium">{Number(entry.mean_reward).toFixed(2)}</div>
              </div>
            )}
            {entry.max_return_pct !== null && (
              <div className="bg-slate-700/30 rounded p-2">
                <div className="text-xs text-gray-400">Max Return</div>
                <div className="font-medium text-green-400">+{Number(entry.max_return_pct).toFixed(1)}%</div>
              </div>
            )}
            {entry.min_return_pct !== null && (
              <div className="bg-slate-700/30 rounded p-2">
                <div className="text-xs text-gray-400">Min Return</div>
                <div className="font-medium text-red-400">{Number(entry.min_return_pct).toFixed(1)}%</div>
              </div>
            )}
          </div>
          
          {entry.error_message && (
            <div className="mt-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
              <div className="text-xs text-red-400 mb-1">Fehler:</div>
              <div className="text-sm text-red-300">{entry.error_message}</div>
            </div>
          )}
          
          <div className="mt-3 text-xs text-gray-500">
            Agent: {entry.agent_name} • Typ: {entry.training_type}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export default AITraderTrainingHistory;
