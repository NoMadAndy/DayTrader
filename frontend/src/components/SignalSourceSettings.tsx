/**
 * Signal Source Settings Component
 * 
 * Allows users to configure which signal sources to include in
 * trading signal aggregation (Sentiment, Technical, ML, RL Agents).
 */

import { useState, useEffect } from 'react';
import { 
  getSignalSourceSettings, 
  saveSignalSourceSettings,
  getWatchlistSettings,
  saveWatchlistSettings,
  type SignalSourceSettings,
  type WatchlistSettings,
  DEFAULT_SIGNAL_SOURCE_SETTINGS,
  DEFAULT_WATCHLIST_SETTINGS
} from '../services/userSettingsService';
import { rlTradingService, type AgentStatus } from '../services/rlTradingService';

interface SignalSourceSettingsProps {
  onSettingsChange?: (settings: SignalSourceSettings) => void;
}

export function SignalSourceSettingsPanel({ onSettingsChange }: SignalSourceSettingsProps) {
  const [settings, setSettings] = useState<SignalSourceSettings>(DEFAULT_SIGNAL_SOURCE_SETTINGS);
  const [watchlistSettings, setWatchlistSettings] = useState<WatchlistSettings>(DEFAULT_WATCHLIST_SETTINGS);
  const [availableAgents, setAvailableAgents] = useState<AgentStatus[]>([]);
  const [rlServiceAvailable, setRlServiceAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [watchlistSaved, setWatchlistSaved] = useState(false);

  // Load settings and check RL service
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      
      // Load saved settings
      const savedSettings = getSignalSourceSettings();
      setSettings(savedSettings);
      
      // Load watchlist settings
      const savedWatchlistSettings = getWatchlistSettings();
      setWatchlistSettings(savedWatchlistSettings);
      
      // Check RL service availability
      const isAvailable = await rlTradingService.isAvailable();
      setRlServiceAvailable(isAvailable);
      
      if (isAvailable) {
        try {
          const agents = await rlTradingService.listAgents();
          // Only show trained agents
          setAvailableAgents(agents.filter(a => a.is_trained));
        } catch {
          console.warn('Failed to load RL agents');
        }
      }
      
      setLoading(false);
    };
    
    loadData();
  }, []);

  const handleToggleSource = (source: keyof Pick<SignalSourceSettings, 'enableSentiment' | 'enableTechnical' | 'enableMLPrediction' | 'enableRLAgents'>) => {
    setSettings(prev => {
      const updated = { ...prev, [source]: !prev[source] };
      saveSignalSourceSettings(updated);
      onSettingsChange?.(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return updated;
    });
  };

  const handleToggleAgent = (agentName: string) => {
    setSettings(prev => {
      const currentAgents = prev.selectedRLAgents || [];
      const updated = {
        ...prev,
        selectedRLAgents: currentAgents.includes(agentName)
          ? currentAgents.filter(a => a !== agentName)
          : [...currentAgents, agentName]
      };
      saveSignalSourceSettings(updated);
      onSettingsChange?.(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return updated;
    });
  };

  const handleSelectAllAgents = () => {
    setSettings(prev => {
      const updated = {
        ...prev,
        selectedRLAgents: availableAgents.map(a => a.name)
      };
      saveSignalSourceSettings(updated);
      onSettingsChange?.(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return updated;
    });
  };

  const handleDeselectAllAgents = () => {
    setSettings(prev => {
      const updated = {
        ...prev,
        selectedRLAgents: []
      };
      saveSignalSourceSettings(updated);
      onSettingsChange?.(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return updated;
    });
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-400">
        <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        <p className="mt-2">Lade Einstellungen...</p>
      </div>
    );
  }

  const sourceItems = [
    {
      key: 'enableSentiment' as const,
      icon: '📰',
      label: 'News-Sentiment',
      description: 'Analysiert Stimmung aus Nachrichten und Artikeln'
    },
    {
      key: 'enableTechnical' as const,
      icon: '📊',
      label: 'Technische Analyse',
      description: 'RSI, MACD, Bollinger Bands, Stochastik, etc.'
    },
    {
      key: 'enableMLPrediction' as const,
      icon: '🤖',
      label: 'ML-Prognose',
      description: 'LSTM-basierte Preisvorhersagen'
    },
    {
      key: 'enableRLAgents' as const,
      icon: '🎯',
      label: 'RL-Agenten',
      description: 'Signale von trainierten Reinforcement Learning Agenten',
      requiresService: true
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Signal-Quellen</h3>
          <p className="text-sm text-gray-400">
            Wählen Sie aus, welche Datenquellen für die Trading-Signale verwendet werden sollen.
          </p>
        </div>
        {saved && (
          <span className="text-green-400 text-sm flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Gespeichert
          </span>
        )}
      </div>

      {/* Source Toggles */}
      <div className="space-y-3">
        {sourceItems.map(item => {
          const isDisabled = item.requiresService && !rlServiceAvailable;
          const isEnabled = settings[item.key];
          
          return (
            <div 
              key={item.key}
              className={`p-4 rounded-lg border transition-colors ${
                isEnabled && !isDisabled
                  ? 'bg-blue-500/10 border-blue-500/50' 
                  : 'bg-slate-800/50 border-slate-700/50'
              } ${isDisabled ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{item.icon}</span>
                  <div>
                    <h4 className="font-medium text-white">{item.label}</h4>
                    <p className="text-sm text-gray-400">{item.description}</p>
                    {item.requiresService && !rlServiceAvailable && (
                      <p className="text-xs text-yellow-400 mt-1">
                        ⚠️ RL-Service nicht verfügbar
                      </p>
                    )}
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => handleToggleSource(item.key)}
                    disabled={isDisabled}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 rounded-full peer 
                    ${isDisabled ? 'bg-slate-600' : 'bg-slate-600 peer-checked:bg-blue-500'}
                    peer-focus:ring-2 peer-focus:ring-blue-500/50 
                    after:content-[''] after:absolute after:top-0.5 after:left-[2px] 
                    after:bg-white after:rounded-full after:h-5 after:w-5 
                    after:transition-all peer-checked:after:translate-x-full`}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* RL Agent Selection (wenn aktiviert) */}
      {settings.enableRLAgents && rlServiceAvailable && (
        <div className="mt-6 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-white flex items-center gap-2">
              <span>🎯</span>
              RL-Agenten auswählen
            </h4>
            <div className="flex gap-2">
              <button
                onClick={handleSelectAllAgents}
                className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30"
              >
                Alle
              </button>
              <button
                onClick={handleDeselectAllAgents}
                className="text-xs px-2 py-1 bg-slate-700 text-gray-400 rounded hover:bg-slate-600"
              >
                Keine
              </button>
            </div>
          </div>

          {availableAgents.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              Keine trainierten Agenten verfügbar. 
              <br />
              <span className="text-xs">Trainieren Sie Agenten auf der RL-Agenten Seite.</span>
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {availableAgents.map(agent => {
                const isSelected = settings.selectedRLAgents?.includes(agent.name) || false;
                
                return (
                  <div
                    key={agent.name}
                    onClick={() => handleToggleAgent(agent.name)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      isSelected 
                        ? 'bg-blue-500/20 border border-blue-500/50' 
                        : 'bg-slate-700/50 border border-transparent hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-white">{agent.name}</span>
                        {agent.config && (
                          <div className="flex gap-2 mt-1 text-xs text-gray-400">
                            <span>{agent.config.trading_style}</span>
                            <span>•</span>
                            <span>{agent.config.holding_period}</span>
                            <span>•</span>
                            <span>{agent.config.risk_profile}</span>
                          </div>
                        )}
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected 
                          ? 'border-blue-500 bg-blue-500' 
                          : 'border-gray-500'
                      }`}>
                        {isSelected && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    {agent.performance_metrics && (
                      <div className="mt-2 flex gap-3 text-xs text-gray-500">
                        <span>Reward: {agent.performance_metrics.mean_reward?.toFixed(1)}</span>
                        <span>Return: {agent.performance_metrics.mean_return_pct?.toFixed(1)}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-3 text-xs text-gray-500">
            {settings.selectedRLAgents?.length || 0} von {availableAgents.length} Agenten ausgewählt
          </p>
        </div>
      )}

      {/* Watchlist-Einstellungen */}
      <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-white flex items-center gap-2">
            <span>📋</span>
            Watchlist-Einstellungen
          </h4>
          {watchlistSaved && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Gespeichert
            </span>
          )}
        </div>

        {/* Extended Signals Toggle */}
        <div className={`p-3 rounded-lg border transition-colors mb-4 ${
          watchlistSettings.extendedSignals
            ? 'bg-purple-500/10 border-purple-500/50'
            : 'bg-slate-700/50 border-slate-600/50'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <h5 className="font-medium text-white">Erweiterte Signale</h5>
              <p className="text-xs text-gray-400">
                News, ML & RL Signale in der Watchlist laden
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={watchlistSettings.extendedSignals}
                onChange={() => {
                  const newSettings = { ...watchlistSettings, extendedSignals: !watchlistSettings.extendedSignals };
                  setWatchlistSettings(newSettings);
                  saveWatchlistSettings(newSettings);
                  setWatchlistSaved(true);
                  setTimeout(() => setWatchlistSaved(false), 2000);
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 rounded-full peer bg-slate-600 peer-checked:bg-purple-500
                peer-focus:ring-2 peer-focus:ring-purple-500/50 
                after:content-[''] after:absolute after:top-0.5 after:left-[2px] 
                after:bg-white after:rounded-full after:h-5 after:w-5 
                after:transition-all peer-checked:after:translate-x-full"
              />
            </label>
          </div>
        </div>

        {/* Cache & Refresh Settings (nur wenn erweiterte Signale aktiv) */}
        {watchlistSettings.extendedSignals && (
          <div className="space-y-4">
            {/* Cache Duration */}
            <div>
              <label className="text-sm text-gray-300 block mb-2">
                Cache-Dauer (Minuten)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={watchlistSettings.cacheDurationMinutes}
                  onChange={(e) => {
                    const newSettings = { ...watchlistSettings, cacheDurationMinutes: parseInt(e.target.value) };
                    setWatchlistSettings(newSettings);
                    saveWatchlistSettings(newSettings);
                    setWatchlistSaved(true);
                    setTimeout(() => setWatchlistSaved(false), 2000);
                  }}
                  className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <span className="text-sm text-white min-w-[3rem] text-right">
                  {watchlistSettings.cacheDurationMinutes} min
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Wie lange Signale gecacht werden, bevor sie neu geladen werden
              </p>
            </div>

            {/* Auto-Refresh */}
            <div>
              <label className="text-sm text-gray-300 block mb-2">
                Auto-Refresh (Sekunden)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="300"
                  step="30"
                  value={watchlistSettings.autoRefreshSeconds}
                  onChange={(e) => {
                    const newSettings = { ...watchlistSettings, autoRefreshSeconds: parseInt(e.target.value) };
                    setWatchlistSettings(newSettings);
                    saveWatchlistSettings(newSettings);
                    setWatchlistSaved(true);
                    setTimeout(() => setWatchlistSaved(false), 2000);
                  }}
                  className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <span className="text-sm text-white min-w-[3rem] text-right">
                  {watchlistSettings.autoRefreshSeconds === 0 ? 'Aus' : `${watchlistSettings.autoRefreshSeconds}s`}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                0 = Kein Auto-Refresh (nur manuell)
              </p>
            </div>

            {/* Info about caching */}
            <div className="p-2 bg-slate-900/50 rounded text-xs text-gray-400">
              <span className="text-purple-400">💡</span> Signale werden serverseitig gecacht, um die API-Quote zu schonen und Ladezeiten zu verkürzen.
            </div>
          </div>
        )}
      </div>

      {/* Info-Box */}
      <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
        <h4 className="font-medium text-white mb-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Wie funktioniert die Signal-Aggregation?
        </h4>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>• Jede aktivierte Quelle trägt gewichtet zum Gesamtsignal bei</li>
          <li>• Die Gewichtung variiert je nach Zeitrahmen (kurzfristig vs. langfristig)</li>
          <li>• Übereinstimmende Signale verstärken sich gegenseitig</li>
          <li>• Widersprüchliche Signale werden abgeschwächt</li>
          <li>• RL-Agenten nutzen ihre trainierten Strategien für Empfehlungen</li>
        </ul>
      </div>
    </div>
  );
}

export default SignalSourceSettingsPanel;
