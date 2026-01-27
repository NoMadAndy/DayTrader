/**
 * RL Trading Agents Panel
 * 
 * Component for managing and training Deep Reinforcement Learning trading agents.
 * Allows users to:
 * - View existing agents and their status
 * - Create new agents with custom configurations
 * - Train agents on historical data
 * - Monitor training progress
 * - Get trading signals from trained agents
 */

import { useState, useEffect } from 'react';
import { 
  rlTradingService,
  type AgentConfig,
  type AgentStatus,
  type TrainingStatus,
  type RLServiceHealth,
  type HoldingPeriod,
  type RiskProfile,
  type TradingStyle,
  type BrokerProfile,
} from '../services/rlTradingService';
import { 
  getCustomSymbols, 
  getAvailableSymbols,
  type CustomSymbol 
} from '../services/userSettingsService';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import TrainingConsole from './TrainingConsole';

interface RLAgentsPanelProps {
  className?: string;
}

// Default agent configuration
const DEFAULT_CONFIG: Partial<AgentConfig> = {
  holding_period: 'swing_short',
  risk_profile: 'moderate',
  trading_style: 'mixed',
  initial_balance: 100000,
  max_position_size: 0.20,
  max_positions: 5,
  stop_loss_percent: 0.05,
  take_profit_percent: 0.10,
  trailing_stop: false,
  trailing_stop_distance: 0.03,
  broker_profile: 'standard',
  trade_on_high_volatility: true,
  min_volume_threshold: 0,
  use_daily_data: true,
  symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'],
  learning_rate: 0.0003,
  gamma: 0.99,
  ent_coef: 0.01,
};

export default function RLAgentsPanel({ className = '' }: RLAgentsPanelProps) {
  // Auth state
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  
  // Service state
  const [isAvailable, setIsAvailable] = useState(false);
  const [health, setHealth] = useState<RLServiceHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Agents state
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [presets, setPresets] = useState<Record<string, AgentConfig>>({});
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  
  // Symbol selection state
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState<CustomSymbol[]>([]);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA']));
  const [showSymbolSelector, setShowSymbolSelector] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState('');
  
  // Form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formConfig, setFormConfig] = useState<Partial<AgentConfig>>(DEFAULT_CONFIG);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSymbols, setFormSymbols] = useState('AAPL,MSFT,GOOGL,AMZN,TSLA');
  const [formDays, setFormDays] = useState(365);
  const [formTimesteps, setFormTimesteps] = useState(100000);
  
  // Training state
  const [trainingStatus, setTrainingStatus] = useState<Record<string, TrainingStatus>>({});
  const [pollingAgents, setPollingAgents] = useState<Set<string>>(new Set());
  
  // Console visibility state (which agents have console open)
  const [openConsoles, setOpenConsoles] = useState<Set<string>>(new Set());
  
  // Messages
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Helper to toggle console visibility
  const toggleConsole = (agentName: string) => {
    setOpenConsoles(prev => {
      const next = new Set(prev);
      if (next.has(agentName)) {
        next.delete(agentName);
      } else {
        next.add(agentName);
      }
      return next;
    });
  };
  
  // Subscribe to auth state changes
  useEffect(() => {
    const unsubscribe = subscribeToAuth(setAuthState);
    return () => unsubscribe();
  }, []);

  // Check service health on mount
  useEffect(() => {
    checkHealth();
    loadAvailableSymbols();
  }, []);

  // Load watchlist when auth state changes
  useEffect(() => {
    loadWatchlistSymbols();
  }, [authState.isAuthenticated]);

  // Load agents when service is available
  useEffect(() => {
    if (isAvailable) {
      loadAgents();
      loadPresets();
    }
  }, [isAvailable]);

  // Sync formSymbols with selectedSymbols
  useEffect(() => {
    setFormSymbols(Array.from(selectedSymbols).join(','));
  }, [selectedSymbols]);

  // Auto-detect agents that are training on the server and add them to polling
  useEffect(() => {
    const trainingAgents = agents.filter(a => a.status === 'training');
    if (trainingAgents.length > 0) {
      setPollingAgents(prev => {
        const next = new Set(prev);
        trainingAgents.forEach(a => next.add(a.name));
        return next;
      });
      // Auto-open consoles for training agents
      setOpenConsoles(prev => {
        const next = new Set(prev);
        trainingAgents.forEach(a => next.add(a.name));
        return next;
      });
    }
  }, [agents]);

  // Poll for training status
  useEffect(() => {
    if (pollingAgents.size === 0) return;
    
    const interval = setInterval(async () => {
      for (const agentName of pollingAgents) {
        try {
          const status = await rlTradingService.getTrainingStatus(agentName);
          setTrainingStatus(prev => ({ ...prev, [agentName]: status }));
          
          if (status.status === 'completed' || status.status === 'failed') {
            setPollingAgents(prev => {
              const next = new Set(prev);
              next.delete(agentName);
              return next;
            });
            loadAgents(); // Refresh agents list
          }
        } catch (err) {
          console.warn(`Failed to poll status for ${agentName}:`, err);
        }
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [pollingAgents]);

  const checkHealth = async () => {
    setIsLoading(true);
    try {
      const healthData = await rlTradingService.getHealth();
      setHealth(healthData);
      setIsAvailable(healthData?.status === 'healthy');
    } catch (err) {
      setIsAvailable(false);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAgents = async () => {
    try {
      const agentList = await rlTradingService.listAgents();
      setAgents(agentList);
    } catch (err) {
      console.error('Failed to load agents:', err);
    }
  };

  const loadPresets = async () => {
    try {
      const presetList = await rlTradingService.listPresets();
      setPresets(presetList);
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  };

  const loadAvailableSymbols = async () => {
    try {
      const symbols = await getAvailableSymbols();
      setAvailableSymbols(symbols.sort());
    } catch (err) {
      console.error('Failed to load available symbols:', err);
    }
  };

  const loadWatchlistSymbols = async () => {
    if (authState.isAuthenticated) {
      try {
        const symbols = await getCustomSymbols();
        setWatchlistSymbols(symbols);
      } catch (err) {
        console.error('Failed to load watchlist:', err);
      }
    } else {
      setWatchlistSymbols([]);
    }
  };

  const handleToggleSymbol = (symbol: string) => {
    setSelectedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const handleSelectAllWatchlist = () => {
    setSelectedSymbols(prev => {
      const next = new Set(prev);
      watchlistSymbols.forEach(s => next.add(s.symbol));
      return next;
    });
  };

  const handleClearSymbols = () => {
    setSelectedSymbols(new Set());
  };

  const handlePresetSelect = (presetName: string) => {
    const preset = presets[presetName];
    if (preset) {
      setFormConfig(preset);
      setFormName(preset.name);
      setFormDescription(preset.description || '');
      setFormSymbols(preset.symbols.join(','));
      setSelectedSymbols(new Set(preset.symbols));
    }
  };

  const handleStartTraining = async () => {
    if (!formName.trim()) {
      setError('Agent name is required');
      return;
    }
    
    setError(null);
    setSuccess(null);
    
    try {
      const config: AgentConfig = {
        ...DEFAULT_CONFIG,
        ...formConfig,
        name: formName,
        description: formDescription || undefined,
        symbols: formSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      } as AgentConfig;
      
      await rlTradingService.trainAgentFromBackend(
        formName,
        config,
        config.symbols,
        formDays,
        formTimesteps
      );
      
      setSuccess(`Training started for agent: ${formName}`);
      setPollingAgents(prev => new Set(prev).add(formName));
      // Auto-open console for the training agent
      setOpenConsoles(prev => new Set(prev).add(formName));
      setShowCreateForm(false);
      loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start training');
    }
  };

  const handleDeleteAgent = async (agentName: string) => {
    if (!confirm(`Are you sure you want to delete agent "${agentName}"?`)) return;
    
    try {
      await rlTradingService.deleteAgent(agentName);
      setSuccess(`Agent "${agentName}" deleted`);
      loadAgents();
      if (selectedAgent === agentName) {
        setSelectedAgent(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    }
  };

  const formatNumber = (num: number | undefined, decimals: number = 2): string => {
    return num !== undefined ? num.toFixed(decimals) : 'N/A';
  };

  const formatPercent = (num: number | undefined): string => {
    return num !== undefined ? `${(num * 100).toFixed(1)}%` : 'N/A';
  };

  if (isLoading) {
    return (
      <div className={`bg-slate-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className={`bg-slate-800 rounded-lg p-4 ${className}`}>
        <h3 className="text-lg font-semibold text-white mb-2">🤖 RL Trading Agents</h3>
        <div className="text-amber-400 text-sm">
          RL Trading Service is not available. Make sure the service is running.
        </div>
        <button
          onClick={checkHealth}
          className="mt-2 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-slate-800 rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">🤖 RL Trading Agents</h3>
          <p className="text-sm text-slate-400">
            Deep Learning trained virtual traders
          </p>
        </div>
        <div className="flex items-center gap-2">
          {health && (
            <span className={`text-xs px-2 py-1 rounded ${
              health.device_info.device === 'cuda' 
                ? 'bg-green-600 text-white' 
                : 'bg-slate-600 text-slate-300'
            }`}>
              {health.device_info.device === 'cuda' ? '🚀 GPU' : '💻 CPU'}
            </span>
          )}
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            + New Agent
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 p-2 bg-red-900/50 text-red-300 rounded text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-2 bg-green-900/50 text-green-300 rounded text-sm">
          {success}
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="mb-6 p-4 bg-slate-700 rounded-lg">
          <h4 className="text-white font-medium mb-4">Create New Agent</h4>
          
          {/* Preset Selection */}
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-1">Start from Preset</label>
            <select
              className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
              onChange={(e) => e.target.value && handlePresetSelect(e.target.value)}
              defaultValue=""
            >
              <option value="">Custom Configuration</option>
              {Object.entries(presets).map(([name, preset]) => (
                <option key={name} value={name}>
                  {preset.description || name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name & Description */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Agent Name *</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                placeholder="my_trader"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Description</label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                placeholder="Optional description"
              />
            </div>
            
            {/* Trading Parameters */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Holding Period</label>
              <select
                value={formConfig.holding_period}
                onChange={(e) => setFormConfig(prev => ({ ...prev, holding_period: e.target.value as HoldingPeriod }))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
              >
                <option value="scalping">Scalping (minutes)</option>
                <option value="intraday">Intraday (hours)</option>
                <option value="swing_short">Swing Short (1-3 days)</option>
                <option value="swing_medium">Swing Medium (3-7 days)</option>
                <option value="position_short">Position Short (1-2 weeks)</option>
                <option value="position_medium">Position Medium (2-4 weeks)</option>
                <option value="position_long">Position Long (1-3 months)</option>
                <option value="investor">Investor (3+ months)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Risk Profile</label>
              <select
                value={formConfig.risk_profile}
                onChange={(e) => setFormConfig(prev => ({ ...prev, risk_profile: e.target.value as RiskProfile }))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
              >
                <option value="conservative">Conservative</option>
                <option value="moderate">Moderate</option>
                <option value="aggressive">Aggressive</option>
                <option value="very_aggressive">Very Aggressive</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Trading Style</label>
              <select
                value={formConfig.trading_style}
                onChange={(e) => setFormConfig(prev => ({ ...prev, trading_style: e.target.value as TradingStyle }))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
              >
                <option value="trend_following">Trend Following</option>
                <option value="mean_reversion">Mean Reversion</option>
                <option value="momentum">Momentum</option>
                <option value="breakout">Breakout</option>
                <option value="contrarian">Contrarian</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Broker Profile</label>
              <select
                value={formConfig.broker_profile}
                onChange={(e) => setFormConfig(prev => ({ ...prev, broker_profile: e.target.value as BrokerProfile }))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
              >
                <option value="discount">Discount (Low fees)</option>
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
                <option value="marketMaker">Market Maker (Zero commission)</option>
              </select>
            </div>
            
            {/* Capital & Position */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Initial Balance</label>
              <input
                type="number"
                value={formConfig.initial_balance}
                onChange={(e) => setFormConfig(prev => ({ ...prev, initial_balance: Number(e.target.value) }))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                min="1000"
                step="1000"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Max Position Size (%)</label>
              <input
                type="number"
                value={(formConfig.max_position_size || 0.2) * 100}
                onChange={(e) => setFormConfig(prev => ({ ...prev, max_position_size: Number(e.target.value) / 100 }))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                min="1"
                max="100"
              />
            </div>
            
            {/* Risk Management */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Stop Loss (%)</label>
              <input
                type="number"
                value={(formConfig.stop_loss_percent || 0.05) * 100}
                onChange={(e) => setFormConfig(prev => ({ ...prev, stop_loss_percent: Number(e.target.value) / 100 }))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                min="1"
                max="50"
                step="0.5"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Take Profit (%)</label>
              <input
                type="number"
                value={(formConfig.take_profit_percent || 0.1) * 100}
                onChange={(e) => setFormConfig(prev => ({ ...prev, take_profit_percent: Number(e.target.value) / 100 }))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                min="1"
                max="100"
                step="0.5"
              />
            </div>
            
            {/* Training Symbols Selection */}
            <div className="md:col-span-2">
              <label className="block text-sm text-slate-400 mb-1">
                Training Symbole ({selectedSymbols.size} ausgewählt)
              </label>
              
              {/* Quick Actions */}
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setShowSymbolSelector(!showSymbolSelector)}
                  className="px-3 py-1 bg-slate-600 text-white text-xs rounded hover:bg-slate-500"
                >
                  {showSymbolSelector ? '📋 Schließen' : '📋 Symbole auswählen'}
                </button>
                {authState.isAuthenticated && watchlistSymbols.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectAllWatchlist}
                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500"
                  >
                    📌 Watchlist hinzufügen ({watchlistSymbols.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearSymbols}
                  className="px-3 py-1 bg-slate-600 text-white text-xs rounded hover:bg-slate-500"
                >
                  🗑️ Alle entfernen
                </button>
              </div>

              {/* Selected Symbols Display */}
              <div className="flex flex-wrap gap-1 mb-2 min-h-[32px] p-2 bg-slate-600 rounded">
                {selectedSymbols.size === 0 ? (
                  <span className="text-slate-400 text-xs">Keine Symbole ausgewählt</span>
                ) : (
                  Array.from(selectedSymbols).sort().map(symbol => (
                    <span
                      key={symbol}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white text-xs rounded"
                    >
                      {symbol}
                      <button
                        type="button"
                        onClick={() => handleToggleSymbol(symbol)}
                        className="hover:text-red-300"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              {/* Symbol Selector Dropdown */}
              {showSymbolSelector && (
                <div className="bg-slate-700 rounded-lg p-3 max-h-64 overflow-y-auto">
                  {/* Filter */}
                  <input
                    type="text"
                    value={symbolFilter}
                    onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
                    placeholder="Symbol suchen..."
                    className="w-full bg-slate-600 text-white rounded px-3 py-1 text-sm mb-2"
                  />

                  {/* Watchlist Section */}
                  {authState.isAuthenticated && watchlistSymbols.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-blue-400 font-medium mb-1">📌 Meine Watchlist</div>
                      <div className="flex flex-wrap gap-1">
                        {watchlistSymbols
                          .filter(s => !symbolFilter || s.symbol.includes(symbolFilter))
                          .map(s => (
                            <button
                              key={s.symbol}
                              type="button"
                              onClick={() => handleToggleSymbol(s.symbol)}
                              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                                selectedSymbols.has(s.symbol)
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                              }`}
                              title={s.name}
                            >
                              {s.symbol}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Available Symbols Section */}
                  {availableSymbols.length > 0 && (
                    <div>
                      <div className="text-xs text-green-400 font-medium mb-1">
                        📊 Verfügbare Symbole ({availableSymbols.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {availableSymbols
                          .filter(s => !symbolFilter || s.includes(symbolFilter))
                          .slice(0, 100) // Limit display for performance
                          .map(symbol => (
                            <button
                              key={symbol}
                              type="button"
                              onClick={() => handleToggleSymbol(symbol)}
                              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                                selectedSymbols.has(symbol)
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                              }`}
                            >
                              {symbol}
                            </button>
                          ))}
                        {availableSymbols.filter(s => !symbolFilter || s.includes(symbolFilter)).length > 100 && (
                          <span className="text-xs text-slate-400 py-0.5">
                            ...und {availableSymbols.filter(s => !symbolFilter || s.includes(symbolFilter)).length - 100} mehr
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {availableSymbols.length === 0 && watchlistSymbols.length === 0 && (
                    <div className="text-slate-400 text-sm text-center py-4">
                      Keine Symbole verfügbar. Laden Sie zunächst historische Daten für einige Aktien.
                    </div>
                  )}
                </div>
              )}

              {/* Manual Input */}
              <div className="mt-2">
                <input
                  type="text"
                  value={formSymbols}
                  onChange={(e) => {
                    setFormSymbols(e.target.value);
                    // Parse and update selectedSymbols
                    const symbols = e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                    setSelectedSymbols(new Set(symbols));
                  }}
                  className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                  placeholder="Oder manuell eingeben: AAPL,MSFT,GOOGL"
                />
              </div>
            </div>
            
            {/* Training Parameters */}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Historical Days</label>
              <input
                type="number"
                value={formDays}
                onChange={(e) => setFormDays(Number(e.target.value))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                min="30"
                max="3650"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Training Timesteps</label>
              <input
                type="number"
                value={formTimesteps}
                onChange={(e) => setFormTimesteps(Number(e.target.value))}
                className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                min="10000"
                max="10000000"
                step="10000"
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleStartTraining}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Start Training
            </button>
          </div>
        </div>
      )}

      {/* Agents List */}
      <div className="space-y-2">
        {agents.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-8">
            No agents yet. Create one to get started!
          </div>
        ) : (
          agents.map((agent) => {
            const training = trainingStatus[agent.name];
            // Check both local training status AND server-reported status
            const isTraining = training?.status === 'training' || 
                               training?.status === 'fetching_data' ||
                               agent.status === 'training';
            
            return (
              <div
                key={agent.name}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedAgent === agent.name
                    ? 'bg-blue-900/50 border border-blue-500'
                    : 'bg-slate-700 hover:bg-slate-600'
                }`}
                onClick={() => setSelectedAgent(selectedAgent === agent.name ? null : agent.name)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{agent.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        agent.is_trained
                          ? 'bg-green-600 text-white'
                          : isTraining
                          ? 'bg-yellow-600 text-white'
                          : 'bg-slate-600 text-slate-300'
                      }`}>
                        {isTraining ? 'Training' : agent.is_trained ? 'Trained' : agent.status}
                      </span>
                    </div>
                    {agent.config?.description && (
                      <p className="text-sm text-slate-400 mt-1">{agent.config.description}</p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAgent(agent.name);
                    }}
                    className="text-slate-400 hover:text-red-400"
                    title="Delete agent"
                  >
                    🗑️
                  </button>
                </div>
                
                {/* Training Progress */}
                {isTraining && training && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>{training.status === 'fetching_data' ? 'Fetching data...' : 'Training...'}</span>
                      <span>{formatPercent(training.progress)}</span>
                    </div>
                    <div className="w-full bg-slate-600 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${(training.progress || 0) * 100}%` }}
                      />
                    </div>
                    {training.mean_reward !== undefined && (
                      <div className="text-xs text-slate-400 mt-1">
                        Avg Reward: {formatNumber(training.mean_reward)} | 
                        Best: {formatNumber(training.best_reward)}
                      </div>
                    )}
                    {/* Console toggle button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleConsole(agent.name);
                      }}
                      className="mt-2 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    >
                      {openConsoles.has(agent.name) ? '▼' : '▶'} Show Console
                    </button>
                  </div>
                )}
                
                {/* Training Console - always show if training or if manually opened with logs */}
                {(isTraining || openConsoles.has(agent.name)) && (
                  <TrainingConsole
                    agentName={agent.name}
                    isTraining={isTraining}
                    progress={training}
                    onClose={() => setOpenConsoles(prev => {
                      const next = new Set(prev);
                      next.delete(agent.name);
                      return next;
                    })}
                  />
                )}
                
                {/* Agent Details */}
                {selectedAgent === agent.name && agent.is_trained && (
                  <div className="mt-3 pt-3 border-t border-slate-600">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      {agent.config && (
                        <>
                          <div>
                            <span className="text-slate-400">Holding:</span>
                            <span className="text-white ml-1">{agent.config.holding_period}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Risk:</span>
                            <span className="text-white ml-1">{agent.config.risk_profile}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Style:</span>
                            <span className="text-white ml-1">{agent.config.trading_style}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Episodes:</span>
                            <span className="text-white ml-1">{agent.total_episodes}</span>
                          </div>
                        </>
                      )}
                      {agent.performance_metrics && (
                        <>
                          <div>
                            <span className="text-slate-400">Avg Return:</span>
                            <span className={`ml-1 ${agent.performance_metrics.mean_return_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {formatNumber(agent.performance_metrics.mean_return_pct)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Max Return:</span>
                            <span className="text-green-400 ml-1">
                              {formatNumber(agent.performance_metrics.max_return_pct)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Min Return:</span>
                            <span className="text-red-400 ml-1">
                              {formatNumber(agent.performance_metrics.min_return_pct)}%
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                    {agent.last_trained && (
                      <div className="text-xs text-slate-500 mt-2">
                        Last trained: {new Date(agent.last_trained).toLocaleString()}
                      </div>
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
