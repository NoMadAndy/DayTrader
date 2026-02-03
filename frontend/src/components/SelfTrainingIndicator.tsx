/**
 * Self-Training Indicator Component
 * 
 * Shows when an AI Trader is performing self-training.
 * Displays progress bar, status message, and training details.
 */

import { useState, useEffect, useCallback } from 'react';

interface SelfTrainingStatus {
  trader_id: number;
  is_training: boolean;
  status: 'idle' | 'starting' | 'training' | 'complete' | 'failed' | 'error';
  agent_name?: string;
  progress?: number;
  timesteps?: number;
  total_timesteps?: number;
  current_reward?: number;
  final_reward?: number;
  started_at?: string;
  completed_at?: string;
  symbols?: string[];
  message?: string;
}

interface SelfTrainingIndicatorProps {
  traderId: number;
  compact?: boolean;
}

export function SelfTrainingIndicator({ traderId, compact = false }: SelfTrainingIndicatorProps) {
  const [status, setStatus] = useState<SelfTrainingStatus | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/rl/ai-trader/${traderId}/self-training-status`);
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
        setIsVisible(data.is_training || data.status === 'complete');
        
        // Hide "complete" status after 30 seconds
        if (data.status === 'complete') {
          setTimeout(() => {
            setIsVisible(false);
          }, 30000);
        }
      }
    } catch (error) {
      console.error('Failed to fetch self-training status:', error);
    }
  }, [traderId]);

  // Poll status while training
  useEffect(() => {
    fetchStatus();
    
    const interval = setInterval(() => {
      fetchStatus();
    }, status?.is_training ? 2000 : 10000); // Poll faster while training
    
    return () => clearInterval(interval);
  }, [fetchStatus, status?.is_training]);

  if (!isVisible || !status) return null;

  const getStatusColor = () => {
    switch (status.status) {
      case 'training':
      case 'starting':
        return 'bg-gradient-to-r from-blue-600 to-purple-600';
      case 'complete':
        return 'bg-gradient-to-r from-green-600 to-emerald-600';
      case 'failed':
      case 'error':
        return 'bg-gradient-to-r from-red-600 to-orange-600';
      default:
        return 'bg-slate-700';
    }
  };

  const getStatusIcon = () => {
    switch (status.status) {
      case 'training':
      case 'starting':
        return '🎓';
      case 'complete':
        return '✅';
      case 'failed':
      case 'error':
        return '❌';
      default:
        return '💤';
    }
  };

  const formatDuration = (startedAt?: string) => {
    if (!startedAt) return '';
    const start = new Date(startedAt);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  if (compact) {
    // Compact view for the AI Trader Card
    if (!status.is_training) return null;
    
    return (
      <div className="flex items-center gap-2 px-2 py-1 bg-blue-500/20 rounded text-xs">
        <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-blue-300">Self-Training...</span>
        <span className="text-blue-400 font-mono">{(status.progress || 0).toFixed(0)}%</span>
      </div>
    );
  }

  // Full view for the Activity panel
  return (
    <div className={`rounded-lg border ${status.is_training ? 'border-blue-500/50' : status.status === 'complete' ? 'border-green-500/50' : 'border-red-500/50'} overflow-hidden`}>
      {/* Header */}
      <div className={`px-4 py-2 ${getStatusColor()} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{getStatusIcon()}</span>
          <span className="font-semibold text-white">
            {status.is_training ? 'Self-Training läuft...' : 
             status.status === 'complete' ? 'Training abgeschlossen' :
             'Training fehlgeschlagen'}
          </span>
        </div>
        {status.is_training && status.started_at && (
          <span className="text-white/70 text-sm">
            ⏱️ {formatDuration(status.started_at)}
          </span>
        )}
        <button 
          onClick={() => setIsVisible(false)}
          className="text-white/70 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Progress Bar */}
      {status.is_training && (
        <div className="h-2 bg-slate-800">
          <div 
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
            style={{ width: `${status.progress || 0}%` }}
          />
        </div>
      )}

      {/* Details */}
      <div className="p-4 bg-slate-800/50 space-y-3">
        {/* Status Message */}
        <div className="text-sm text-gray-300">
          {status.message}
        </div>

        {/* Progress Details */}
        {status.is_training && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-gray-500 text-xs">Fortschritt</div>
              <div className="font-mono text-blue-400">{(status.progress || 0).toFixed(1)}%</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-gray-500 text-xs">Schritte</div>
              <div className="font-mono text-white">
                {(status.timesteps || 0).toLocaleString()} / {(status.total_timesteps || 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-gray-500 text-xs">Ø Reward</div>
              <div className={`font-mono ${(status.current_reward || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(status.current_reward || 0).toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2">
              <div className="text-gray-500 text-xs">Agent</div>
              <div className="font-mono text-purple-400 truncate">{status.agent_name || 'N/A'}</div>
            </div>
          </div>
        )}

        {/* Completed Details */}
        {status.status === 'complete' && (
          <div className="flex items-center justify-between bg-green-900/20 rounded-lg p-3">
            <div>
              <div className="text-green-400 font-medium">Training erfolgreich!</div>
              <div className="text-gray-400 text-sm">
                {(status.total_timesteps || 0).toLocaleString()} Schritte trainiert
              </div>
            </div>
            <div className="text-right">
              <div className="text-gray-500 text-xs">Final Reward</div>
              <div className={`font-mono text-xl ${(status.final_reward || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(status.final_reward || 0).toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {/* Training Symbols */}
        {status.symbols && status.symbols.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-gray-500 text-xs">Symbole:</span>
            {status.symbols.map((symbol) => (
              <span 
                key={symbol} 
                className="px-2 py-0.5 bg-slate-700 text-gray-300 rounded text-xs font-mono"
              >
                {symbol}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SelfTrainingIndicator;
