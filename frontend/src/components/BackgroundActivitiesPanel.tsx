/**
 * Background Activities Panel
 * 
 * Shows all currently running background activities across all services
 * (Backend, ML Service, RL Trading Service) with hardware/device info.
 */

import { useState, useEffect, useCallback } from 'react';
import { log } from '../utils/logger';

interface DeviceInfo {
  device: string;
  cuda_available?: boolean;
  cuda_enabled?: boolean;
  cuda_device_name?: string;
  cuda_memory_total?: string;
  cuda_device_count?: number;
}

interface ActivityDetails {
  interval_seconds?: number;
  last_update?: string;
  next_update?: string;
  successful?: number;
  failed?: number;
  timesteps?: number;
  total_timesteps?: number;
  episodes?: number;
  mean_reward?: number;
  progress?: number;
  message?: string;
  symbols?: string[];
  started_at?: string;
}

interface Activity {
  id: string;
  type: string;
  service: string;
  name: string;
  status: string;
  progress: number | null;
  message: string;
  device: string;
  device_info: DeviceInfo;
  started_at?: string | null;
  details?: ActivityDetails | null;
  model_type?: string;
}

interface ServiceStatus {
  status: string;
  device?: string;
  device_info?: DeviceInfo;
  error?: string;
}

interface ActivitiesResponse {
  services: Record<string, ServiceStatus>;
  activities: Activity[];
  timestamp: string;
}

interface BackgroundActivitiesPanelProps {
  refreshInterval?: number;
  compact?: boolean;
}

export function BackgroundActivitiesPanel({ refreshInterval = 10000, compact = false }: BackgroundActivitiesPanelProps) {
  const [data, setData] = useState<ActivitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async () => {
    try {
      const response = await fetch('/api/system/activities');
      if (response.ok) {
        const result = await response.json();
        setData(result);
        setError(null);
      } else {
        setError(`HTTP ${response.status}`);
      }
    } catch (e) {
      setError('Nicht erreichbar');
      log.error('[BackgroundActivities] Fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivities();
    const timer = setInterval(fetchActivities, refreshInterval);
    return () => clearInterval(timer);
  }, [fetchActivities, refreshInterval]);

  const getDeviceLabel = (activity: Activity): string => {
    const info = activity.device_info;
    if (info?.cuda_device_name) {
      return `GPU: ${info.cuda_device_name}`;
    }
    return activity.device?.toUpperCase() || 'CPU';
  };

  const getDeviceBadgeColor = (device: string): string => {
    if (device === 'cuda' || device?.toLowerCase().startsWith('gpu')) {
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    }
    return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'running': return 'text-green-400';
      case 'training': return 'text-blue-400';
      case 'starting': case 'preparing': return 'text-yellow-400';
      case 'failed': case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'running': return '▶';
      case 'training': return '⚡';
      case 'starting': case 'preparing': return '⏳';
      case 'failed': case 'error': return '✗';
      default: return '•';
    }
  };

  const getServiceBadge = (service: string): { label: string; color: string } => {
    switch (service) {
      case 'backend': return { label: 'Backend', color: 'bg-slate-600/50 text-slate-300' };
      case 'ml-service': return { label: 'ML', color: 'bg-purple-600/30 text-purple-300' };
      case 'rl-trading-service': return { label: 'RL', color: 'bg-blue-600/30 text-blue-300' };
      default: return { label: service, color: 'bg-gray-600/30 text-gray-300' };
    }
  };

  const getServiceStatusColor = (status: string): string => {
    switch (status) {
      case 'healthy': return 'bg-green-500';
      case 'unhealthy': return 'bg-red-500';
      case 'unreachable': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  const formatDuration = (startedAt: string | null | undefined): string => {
    if (!startedAt) return '';
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMs = now - start;
    if (diffMs < 0) return '';
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      return `${hrs}h ${mins % 60}m`;
    }
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  if (loading && !data) {
    return (
      <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="animate-spin">⟳</span> Lade Aktivitäten...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-slate-900/50 rounded-lg p-4 border border-red-700/50">
        <div className="text-sm text-red-400">Fehler: {error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { services, activities } = data;
  const hasActiveWork = activities.some(a => ['training', 'starting', 'preparing'].includes(a.status));

  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">⚙️</span>
          <h4 className="font-medium text-white text-sm">Hintergrund-Aktivitäten</h4>
          {hasActiveWork && (
            <span className="flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
          )}
        </div>
        <button
          onClick={fetchActivities}
          className="text-xs text-gray-400 hover:text-white transition-colors"
          title="Aktualisieren"
        >
          🔄
        </button>
      </div>

      {/* Service Status Row */}
      <div className="px-4 py-2 border-b border-slate-700/30 flex flex-wrap gap-3">
        {Object.entries(services).map(([key, svc]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <div className={`w-2 h-2 rounded-full ${getServiceStatusColor(svc.status)}`} />
            <span className="text-gray-400">
              {key === 'backend' ? 'Backend' : key === 'ml' ? 'ML Service' : 'RL Service'}
            </span>
            {svc.device_info?.cuda_device_name ? (
              <span className="text-green-400/80 font-mono text-[10px]">GPU</span>
            ) : (
              <span className="text-yellow-400/80 font-mono text-[10px]">CPU</span>
            )}
          </div>
        ))}
      </div>

      {/* Activities List */}
      <div className="divide-y divide-slate-700/30">
        {activities.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">
            Keine aktiven Aufgaben
          </div>
        ) : (
          activities.map((activity) => {
            const serviceBadge = getServiceBadge(activity.service);
            const deviceLabel = getDeviceLabel(activity);
            const duration = formatDuration(activity.started_at);

            return (
              <div key={activity.id} className="px-4 py-3">
                {/* Row 1: Name + Service + Status */}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs ${getStatusColor(activity.status)}`}>
                      {getStatusIcon(activity.status)}
                    </span>
                    <span className="text-sm text-white truncate">{activity.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${serviceBadge.color}`}>
                      {serviceBadge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {duration && (
                      <span className="text-[10px] text-gray-500">{duration}</span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${getDeviceBadgeColor(activity.device)}`}>
                      {deviceLabel}
                    </span>
                  </div>
                </div>

                {/* Row 2: Message */}
                {activity.message && (
                  <p className="text-xs text-gray-400 mb-1 truncate">{activity.message}</p>
                )}

                {/* Row 3: Progress bar (if applicable) */}
                {activity.progress != null && activity.progress > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${Math.min(activity.progress, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right">
                      {Math.round(activity.progress)}%
                    </span>
                  </div>
                )}

                {/* Row 4: Training details (non-compact) */}
                {!compact && activity.details && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {activity.details.timesteps != null && activity.details.total_timesteps != null && (
                      <span className="text-[10px] text-gray-500">
                        Steps: {activity.details.timesteps.toLocaleString()}/{activity.details.total_timesteps.toLocaleString()}
                      </span>
                    )}
                    {activity.details.mean_reward != null && (
                      <span className="text-[10px] text-gray-500">
                        Reward: {activity.details.mean_reward.toFixed(2)}
                      </span>
                    )}
                    {activity.details.symbols && activity.details.symbols.length > 0 && (
                      <span className="text-[10px] text-gray-500">
                        Symbole: {activity.details.symbols.join(', ')}
                      </span>
                    )}
                    {activity.model_type && (
                      <span className="text-[10px] text-gray-500">
                        Modell: {activity.model_type.toUpperCase()}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
