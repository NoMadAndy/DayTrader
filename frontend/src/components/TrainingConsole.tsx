/**
 * TrainingConsole Component
 * 
 * Displays live training logs and progress for RL agent training.
 * Features:
 * - Collapsible console view
 * - Live log streaming
 * - Auto-scroll to latest log
 * - Progress bar
 * - Color-coded log levels
 */

import { useState, useEffect, useRef, useCallback } from 'react';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

interface TrainingProgress {
  status: string;
  progress: number;
  timesteps?: number;
  total_timesteps?: number;
  episodes?: number;
  mean_reward?: number;
  best_reward?: number;
}

interface TrainingConsoleProps {
  agentName: string;
  isTraining: boolean;
  progress?: TrainingProgress;
  onClose?: () => void;
}

const RL_SERVICE_URL = import.meta.env.VITE_RL_SERVICE_URL || 'http://localhost:8001';

export function TrainingConsole({ agentName, isTraining, progress, onClose }: TrainingConsoleProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastLogCount = useRef(0);

  // Fetch logs periodically
  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch(
        `${RL_SERVICE_URL}/train/logs/${encodeURIComponent(agentName)}?since=${lastLogCount.current}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.logs && data.logs.length > 0) {
          setLogs(prev => [...prev, ...data.logs]);
          lastLogCount.current = data.total;
        }
      }
    } catch (error) {
      console.error('Failed to fetch training logs:', error);
    }
  }, [agentName]);

  // Reset logs when training starts
  useEffect(() => {
    if (isTraining) {
      setLogs([]);
      lastLogCount.current = 0;
      setIsExpanded(true);
    }
  }, [isTraining, agentName]);

  // Poll for logs while training
  useEffect(() => {
    if (!isTraining) return;

    // Initial fetch
    fetchLogs();

    // Poll every 500ms
    const interval = setInterval(fetchLogs, 500);
    return () => clearInterval(interval);
  }, [isTraining, fetchLogs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Handle scroll - disable auto-scroll if user scrolls up
  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const getLogColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      case 'success':
        return 'text-green-400';
      default:
        return 'text-slate-300';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('de-DE', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 1
    });
  };

  const progressPercent = (progress?.progress ?? 0) * 100;

  // Don't render if no logs and not training
  if (!isTraining && logs.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 bg-slate-800 rounded-lg border border-slate-600 overflow-hidden">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-2 bg-slate-700 cursor-pointer hover:bg-slate-650"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-300 text-sm">
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="text-white font-medium text-sm">Training Console</span>
          {isTraining && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white animate-pulse">
              Live
            </span>
          )}
          <span className="text-slate-400 text-xs">
            ({logs.length} logs)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {progress?.mean_reward !== undefined && (
            <span className="text-xs text-slate-400">
              Reward: {progress.mean_reward.toFixed(2)}
            </span>
          )}
          {onClose && !isTraining && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-slate-400 hover:text-white text-sm px-1"
              title="Close console"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Progress Bar */}
          {isTraining && (
            <div className="px-3 py-2 border-b border-slate-600">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>
                  {progress?.status === 'fetching_data' 
                    ? 'Fetching data...' 
                    : `Training: ${progressPercent.toFixed(1)}%`
                  }
                </span>
                <span>
                  {progress?.timesteps?.toLocaleString() ?? 0} / {progress?.total_timesteps?.toLocaleString() ?? '?'} steps
                </span>
              </div>
              <div className="w-full bg-slate-600 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-500 to-blue-400 h-full rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {progress?.episodes !== undefined && (
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>Episodes: {progress.episodes}</span>
                  {progress.best_reward !== undefined && (
                    <span>Best reward: {progress.best_reward.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Log Output */}
          <div
            ref={logContainerRef}
            onScroll={handleScroll}
            className="h-48 overflow-y-auto font-mono text-xs p-2 bg-slate-900"
          >
            {logs.length === 0 ? (
              <div className="text-slate-500 text-center py-4">
                Waiting for logs...
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="py-0.5 flex gap-2">
                  <span className="text-slate-500 flex-shrink-0">
                    [{formatTimestamp(log.timestamp)}]
                  </span>
                  <span className={getLogColor(log.level)}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-1 bg-slate-800 border-t border-slate-700 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="w-3 h-3"
                />
                Auto-scroll
              </label>
            </div>
            <button
              onClick={() => setLogs([])}
              className="text-xs text-slate-400 hover:text-white"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default TrainingConsole;
