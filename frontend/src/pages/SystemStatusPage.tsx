/**
 * SystemStatusPage - System Health & Status Dashboard
 * Shows cache stats, rate limits, background jobs, SSE connections, ML/RL health
 */

import { getAuthState, getAuthHeaders } from '../services/authService';
import { useState, useEffect, useCallback } from 'react';

interface CacheStats {
  enabled: boolean;
  message?: string;
  totalEntries?: number;
  hitRate?: number;
  missRate?: number;
  memoryUsage?: number;
  oldestEntry?: string;
  newestEntry?: string;
}

interface RateLimitStatus {
  [provider: string]: {
    remaining: number;
    limit: number;
    resetAt?: string;
    windowMs?: number;
  };
}

interface JobStatus {
  quoteUpdate: {
    lastRun?: string;
    nextRun?: string;
    isRunning: boolean;
    lastResult?: string;
    symbolsUpdated?: number;
  };
  cacheCleanup?: {
    lastRun?: string;
    nextRun?: string;
  };
}

interface StreamStats {
  activeConnections: number;
  clients: Array<{
    clientId: string;
    symbols: string[];
    connectedAt: string;
  }>;
}

interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  version?: string;
  uptime?: number;
  error?: string;
}

export function SystemStatusPage() {
  const authState = getAuthState();
  const user = authState.user;
  
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimitStatus | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [mlHealth, setMlHealth] = useState<ServiceHealth | null>(null);
  const [rlHealth, setRlHealth] = useState<ServiceHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchAllStats = useCallback(async () => {
    setLoading(true);
    
    try {
      const [cacheRes, rateLimitRes, jobRes, streamRes, mlRes, rlRes] = await Promise.allSettled([
        fetch('/api/cache/stats'),
        fetch('/api/cache/rate-limits'),
        fetch('/api/jobs/status'),
        fetch('/api/stream/stats'),
        fetch('/api/ml/health'),
        fetch('/api/rl/health'),
      ]);

      if (cacheRes.status === 'fulfilled' && cacheRes.value.ok) {
        setCacheStats(await cacheRes.value.json());
      }
      
      if (rateLimitRes.status === 'fulfilled' && rateLimitRes.value.ok) {
        setRateLimits(await rateLimitRes.value.json());
      }
      
      if (jobRes.status === 'fulfilled' && jobRes.value.ok) {
        setJobStatus(await jobRes.value.json());
      }
      
      if (streamRes.status === 'fulfilled' && streamRes.value.ok) {
        setStreamStats(await streamRes.value.json());
      }
      
      if (mlRes.status === 'fulfilled') {
        if (mlRes.value.ok) {
          const data = await mlRes.value.json();
          setMlHealth({ status: 'healthy', ...data });
        } else {
          setMlHealth({ status: 'unhealthy', error: `HTTP ${mlRes.value.status}` });
        }
      } else {
        setMlHealth({ status: 'unknown', error: 'Service nicht erreichbar' });
      }
      
      if (rlRes.status === 'fulfilled') {
        if (rlRes.value.ok) {
          const data = await rlRes.value.json();
          setRlHealth({ status: 'healthy', ...data });
        } else {
          setRlHealth({ status: 'unhealthy', error: `HTTP ${rlRes.value.status}` });
        }
      } else {
        setRlHealth({ status: 'unknown', error: 'Service nicht erreichbar' });
      }
      
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to fetch system stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllStats();
    const interval = setInterval(fetchAllStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchAllStats]);

  const triggerQuoteUpdate = async () => {
    if (!user) {
      alert('Bitte einloggen um diese Aktion auszuführen');
      return;
    }
    try {
      const response = await fetch('/api/jobs/update-quotes', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
        },
      });
      if (response.ok) {
        setTimeout(fetchAllStats, 1000);
      } else if (response.status === 401) {
        alert('Sitzung abgelaufen. Bitte neu einloggen.');
      }
    } catch (error) {
      console.error('Failed to trigger quote update:', error);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500';
      case 'unhealthy': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy': return '✅';
      case 'unhealthy': return '❌';
      default: return '⚠️';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
            <span className="text-3xl">🖥️</span>
            System Status
          </h1>
          <p className="text-gray-400 mt-1">
            Übersicht über System-Gesundheit und -Ressourcen
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">
            Letzte Aktualisierung: {lastRefresh.toLocaleTimeString('de-DE')}
          </span>
          <button
            onClick={fetchAllStats}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 rounded-lg transition-colors flex items-center gap-2"
          >
            {loading ? (
              <span className="animate-spin">⟳</span>
            ) : (
              <span>🔄</span>
            )}
            Aktualisieren
          </button>
        </div>
      </div>

      {/* Service Health Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Backend Health */}
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Backend API</h3>
            <div className={`w-3 h-3 rounded-full ${cacheStats ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
          <div className="text-2xl mb-1">{cacheStats ? '✅' : '❌'}</div>
          <p className="text-sm text-gray-400">
            {cacheStats ? 'Erreichbar' : 'Nicht erreichbar'}
          </p>
        </div>

        {/* ML Service Health */}
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">ML Service</h3>
            <div className={`w-3 h-3 rounded-full ${getHealthColor(mlHealth?.status || 'unknown')}`} />
          </div>
          <div className="text-2xl mb-1">{getHealthIcon(mlHealth?.status || 'unknown')}</div>
          <p className="text-sm text-gray-400">
            {mlHealth?.status === 'healthy' 
              ? mlHealth.uptime ? `Uptime: ${formatUptime(mlHealth.uptime)}` : 'Aktiv'
              : mlHealth?.error || 'Unbekannt'}
          </p>
        </div>

        {/* RL Service Health */}
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">RL Trading Service</h3>
            <div className={`w-3 h-3 rounded-full ${getHealthColor(rlHealth?.status || 'unknown')}`} />
          </div>
          <div className="text-2xl mb-1">{getHealthIcon(rlHealth?.status || 'unknown')}</div>
          <p className="text-sm text-gray-400">
            {rlHealth?.status === 'healthy'
              ? rlHealth.uptime ? `Uptime: ${formatUptime(rlHealth.uptime)}` : 'Aktiv'
              : rlHealth?.error || 'Unbekannt'}
          </p>
        </div>

        {/* SSE Connections */}
        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Live-Verbindungen</h3>
            <div className={`w-3 h-3 rounded-full ${(streamStats?.activeConnections || 0) > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
          </div>
          <div className="text-2xl mb-1">{streamStats?.activeConnections || 0}</div>
          <p className="text-sm text-gray-400">SSE Clients verbunden</p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cache Statistics */}
        <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span>💾</span> Cache-Statistiken
          </h2>
          
          {cacheStats?.enabled === false ? (
            <div className="text-center py-8 text-gray-400">
              <span className="text-4xl mb-3 block">📭</span>
              <p>{cacheStats.message || 'Caching nicht aktiviert'}</p>
            </div>
          ) : cacheStats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <div className="text-sm text-gray-400">Einträge</div>
                  <div className="text-xl font-bold">{cacheStats.totalEntries?.toLocaleString() || 0}</div>
                </div>
                <div className="bg-slate-700/50 rounded-lg p-3">
                  <div className="text-sm text-gray-400">Speicher</div>
                  <div className="text-xl font-bold">{cacheStats.memoryUsage ? formatBytes(cacheStats.memoryUsage) : 'N/A'}</div>
                </div>
              </div>
              
              {(cacheStats.hitRate !== undefined || cacheStats.missRate !== undefined) && (
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">Hit Rate</span>
                    <span className="text-green-400">{((cacheStats.hitRate || 0) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${(cacheStats.hitRate || 0) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">Laden...</div>
          )}
        </div>

        {/* Rate Limits */}
        <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span>🚦</span> API Rate Limits
          </h2>
          
          {rateLimits ? (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {Object.entries(rateLimits).map(([provider, limit]) => {
                const percentage = limit.limit > 0 ? (limit.remaining / limit.limit) * 100 : 100;
                const isLow = percentage < 20;
                
                return (
                  <div key={provider} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium capitalize">{provider}</span>
                      <span className={`text-sm ${isLow ? 'text-red-400' : 'text-gray-400'}`}>
                        {limit.remaining} / {limit.limit}
                      </span>
                    </div>
                    <div className="w-full bg-slate-600 rounded-full h-1.5">
                      <div 
                        className={`h-1.5 rounded-full transition-all ${
                          isLow ? 'bg-red-500' : percentage < 50 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">Laden...</div>
          )}
        </div>

        {/* Background Jobs */}
        <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span>⚙️</span> Background Jobs
          </h2>
          
          {jobStatus ? (
            <div className="space-y-4">
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-medium">Quote Update Job</h3>
                    <p className="text-sm text-gray-400">Aktualisiert Kursdaten für Watchlist</p>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs ${
                    jobStatus.quoteUpdate?.isRunning 
                      ? 'bg-blue-500/20 text-blue-400' 
                      : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {jobStatus.quoteUpdate?.isRunning ? '🔄 Läuft' : '⏸️ Wartend'}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {jobStatus.quoteUpdate?.lastRun && (
                    <div>
                      <span className="text-gray-400">Letzte Ausführung: </span>
                      <span>{new Date(jobStatus.quoteUpdate.lastRun).toLocaleString('de-DE')}</span>
                    </div>
                  )}
                  {jobStatus.quoteUpdate?.symbolsUpdated !== undefined && (
                    <div>
                      <span className="text-gray-400">Symbole aktualisiert: </span>
                      <span>{jobStatus.quoteUpdate.symbolsUpdated}</span>
                    </div>
                  )}
                </div>
                
                {user && (
                  <button
                    onClick={triggerQuoteUpdate}
                    disabled={jobStatus.quoteUpdate?.isRunning}
                    className="mt-3 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded text-sm transition-colors"
                  >
                    Manuell ausführen
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">Laden...</div>
          )}
        </div>

        {/* Active SSE Clients */}
        <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <span>📡</span> Aktive SSE-Verbindungen
          </h2>
          
          {streamStats ? (
            streamStats.clients.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {streamStats.clients.map((client) => (
                  <div key={client.clientId} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <code className="text-xs text-blue-400">{client.clientId.substring(0, 8)}...</code>
                        <p className="text-sm text-gray-400 mt-1">
                          {client.symbols.length} Symbol{client.symbols.length !== 1 ? 'e' : ''}:
                          <span className="text-white ml-1">
                            {client.symbols.slice(0, 5).join(', ')}
                            {client.symbols.length > 5 && ` +${client.symbols.length - 5}`}
                          </span>
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {new Date(client.connectedAt).toLocaleTimeString('de-DE')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <span className="text-4xl mb-3 block">📭</span>
                <p>Keine aktiven Verbindungen</p>
              </div>
            )
          ) : (
            <div className="text-center py-8 text-gray-400">Laden...</div>
          )}
        </div>
      </div>
    </div>
  );
}
