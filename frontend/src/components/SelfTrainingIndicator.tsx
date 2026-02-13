/**
 * Self-Training Indicator Component
 * 
 * Shows when an AI Trader is performing self-training.
 * Displays progress bar, status message, and training details.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { log } from '../utils/logger';

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
  onTrainingEvent?: (event: { action: 'training_start' | 'training_complete' | 'training_failed'; message: string; agentName?: string }) => void;
}

export function SelfTrainingIndicator({ traderId, compact = false, onTrainingEvent }: SelfTrainingIndicatorProps) {
  const [status, setStatus] = useState<SelfTrainingStatus | null>(null);
  const prevStatusRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/rl/ai-trader/${traderId}/self-training-status`);
      if (response.ok) {
        const data = await response.json();
        const newStatus = data.status as string;
        const prevStatus = prevStatusRef.current;
        
        // Emit toast on status transitions
        if (onTrainingEvent && prevStatus !== null && newStatus !== prevStatus) {
          if ((newStatus === 'training' || newStatus === 'starting') && prevStatus !== 'training' && prevStatus !== 'starting') {
            onTrainingEvent({
              action: 'training_start',
              message: data.message || 'Self-Training gestartet',
              agentName: data.agent_name,
            });
          } else if (newStatus === 'complete' && prevStatus !== 'complete') {
            const reward = data.final_reward ? ` (Reward: ${data.final_reward.toFixed(2)})` : '';
            onTrainingEvent({
              action: 'training_complete',
              message: `Training abgeschlossen${reward}`,
              agentName: data.agent_name,
            });
          } else if ((newStatus === 'failed' || newStatus === 'error') && prevStatus !== 'failed' && prevStatus !== 'error') {
            onTrainingEvent({
              action: 'training_failed',
              message: data.message || 'Training fehlgeschlagen',
              agentName: data.agent_name,
            });
          }
        }
        
        prevStatusRef.current = newStatus;
        setStatus(data);
      }
    } catch (error) {
      log.error('Failed to fetch self-training status:', error);
    }
  }, [traderId, onTrainingEvent]);

  // Poll status while training
  useEffect(() => {
    fetchStatus();
    
    const interval = setInterval(() => {
      fetchStatus();
    }, status?.is_training ? 2000 : 10000); // Poll faster while training
    
    return () => clearInterval(interval);
  }, [fetchStatus, status?.is_training]);

  if (!status || !status.is_training) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 bg-blue-500/20 rounded text-xs">
        <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-blue-300">Self-Training...</span>
        <span className="text-blue-400 font-mono">{(status.progress || 0).toFixed(0)}%</span>
      </div>
    );
  }

  // Inline progress bar (no card, just a slim bar)
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-900/30 border border-blue-500/30 rounded-lg text-xs">
      <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
      <span className="text-blue-300 font-medium">🎓 Training</span>
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 rounded-full"
          style={{ width: `${status.progress || 0}%` }}
        />
      </div>
      <span className="text-blue-400 font-mono flex-shrink-0">{(status.progress || 0).toFixed(0)}%</span>
      {status.agent_name && <span className="text-gray-500 truncate max-w-[80px]">{status.agent_name}</span>}
    </div>
  );
}

export default SelfTrainingIndicator;
