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
  type BacktestResult,
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
  enable_short_selling: false,
  slippage_model: 'proportional',
  slippage_bps: 5.0,
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
  const [showTransformerOptions, setShowTransformerOptions] = useState(false);
  
  // Backtest state
  const [backtestAgent, setBacktestAgent] = useState<string | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestSymbol, setBacktestSymbol] = useState('AAPL');
  const [backtestDays, setBacktestDays] = useState(365);
  const [backtestShortSelling, setBacktestShortSelling] = useState(false);
  const [backtestSlippageModel, setBacktestSlippageModel] = useState<'none'|'fixed'|'proportional'|'volume'>('proportional');
  const [backtestSlippageBps, setBacktestSlippageBps] = useState(5.0);
  
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
  
  // Helper to check if Transformer parameters are valid
  const getTransformerValidation = () => {
    if (!formConfig.use_transformer_policy) return { isValid: true, message: '' };
    
    const dModel = formConfig.transformer_d_model || 256;
    const nHeads = formConfig.transformer_n_heads || 8;
    
    if (dModel % 2 !== 0) {
      return { 
        isValid: false, 
        message: 'ℹ️ d_model must be even' 
      };
    }
    
    if (dModel % nHeads !== 0) {
      return { 
        isValid: false, 
        message: `ℹ️ d_model (${dModel}) must be divisible by n_heads (${nHeads})` 
      };
    }
    
    return { isValid: true, message: '✓ Valid configuration' };
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
    
    // Validate Transformer architecture parameters
    if (formConfig.use_transformer_policy) {
      const dModel = formConfig.transformer_d_model || 256;
      const nHeads = formConfig.transformer_n_heads || 8;
      
      // Check d_model is even
      if (dModel % 2 !== 0) {
        setError(`d_model must be even (got ${dModel}). Try 256, 128, or 512.`);
        return;
      }
      
      // Check d_model is divisible by n_heads
      if (dModel % nHeads !== 0) {
        const suggested = Math.ceil(dModel / nHeads) * nHeads;
        setError(
          `d_model (${dModel}) must be divisible by n_heads (${nHeads}). ` +
          `Try setting d_model to ${suggested} or n_heads to ${Math.floor(dModel / Math.floor(dModel / nHeads))}.`
        );
        return;
      }
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

  const handleRunBacktest = async () => {
    if (!backtestAgent) return;
    setBacktestLoading(true);
    setBacktestResult(null);
    setError(null);
    try {
      const result = await rlTradingService.backtestAgent({
        agent_name: backtestAgent,
        symbol: backtestSymbol,
        days: backtestDays,
        enable_short_selling: backtestShortSelling,
        slippage_model: backtestSlippageModel,
        slippage_bps: backtestSlippageBps,
      });
      setBacktestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setBacktestLoading(false);
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
          
          {/* Short Selling & Slippage Section */}
          <div className="mt-4 p-4 bg-slate-800 rounded-lg border border-slate-600">
            <h5 className="text-white font-medium mb-3">📉 Short Selling & Slippage</h5>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enable_short_selling"
                  checked={formConfig.enable_short_selling || false}
                  onChange={(e) => setFormConfig(prev => ({ ...prev, enable_short_selling: e.target.checked }))}
                  className="w-4 h-4 rounded bg-slate-600 border-slate-500 text-blue-600"
                />
                <label htmlFor="enable_short_selling" className="text-sm text-slate-300 cursor-pointer">
                  Short Selling erlauben
                </label>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Slippage-Modell</label>
                <select
                  value={formConfig.slippage_model || 'proportional'}
                  onChange={(e) => setFormConfig(prev => ({ ...prev, slippage_model: e.target.value as AgentConfig['slippage_model'] }))}
                  className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                >
                  <option value="none">Kein Slippage</option>
                  <option value="fixed">Fixed (BPS)</option>
                  <option value="proportional">Proportional + Jitter</option>
                  <option value="volume">Volume Impact (√)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Slippage (BPS)</label>
                <input
                  type="number"
                  value={formConfig.slippage_bps ?? 5.0}
                  onChange={(e) => setFormConfig(prev => ({ ...prev, slippage_bps: Number(e.target.value) }))}
                  className="w-full bg-slate-600 text-white rounded px-3 py-2 text-sm"
                  min="0"
                  max="50"
                  step="0.5"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Slippage simuliert realistische Ausführungskosten. 5 BPS = 0,05% pro Trade.
            </p>
          </div>

          {/* Transformer Architecture Section */}
          <div className="mt-4 p-4 bg-slate-800 rounded-lg border border-slate-600">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="use_transformer"
                  checked={formConfig.use_transformer_policy || false}
                  onChange={(e) => {
                    setFormConfig(prev => ({ 
                      ...prev, 
                      use_transformer_policy: e.target.checked,
                      // Set defaults when enabling
                      ...(e.target.checked ? {
                        transformer_d_model: prev.transformer_d_model || 256,
                        transformer_n_heads: prev.transformer_n_heads || 8,
                        transformer_n_layers: prev.transformer_n_layers || 4,
                        transformer_d_ff: prev.transformer_d_ff || 512,
                        transformer_dropout: prev.transformer_dropout || 0.1,
                      } : {})
                    }));
                  }}
                  className="w-4 h-4 rounded bg-slate-600 border-slate-500 text-blue-600 focus:ring-2 focus:ring-blue-500"
                />
                <label htmlFor="use_transformer" className="text-white font-medium cursor-pointer">
                  🚀 Use Advanced Transformer Architecture
                </label>
              </div>
              <button
                type="button"
                onClick={() => setShowTransformerOptions(!showTransformerOptions)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {showTransformerOptions ? '▼ Hide Options' : '▶ Show Options'}
              </button>
            </div>
            
            <div className="text-xs text-slate-400 mb-3">
              <p className="mb-1">
                ✨ <strong>~2.5-3M parameters</strong> (vs ~300k for standard MLP)
              </p>
              <p>
                Enables temporal awareness via self-attention, multi-scale feature extraction, 
                and market regime detection for superior pattern recognition.
              </p>
            </div>
            
            {showTransformerOptions && formConfig.use_transformer_policy && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 pt-3 border-t border-slate-700">
                <div>
                  <label className="block text-xs text-slate-400 mb-1" title="Transformer model dimension">
                    d_model
                  </label>
                  <input
                    type="number"
                    value={formConfig.transformer_d_model || 256}
                    onChange={(e) => setFormConfig(prev => ({ ...prev, transformer_d_model: Number(e.target.value) }))}
                    className="w-full bg-slate-600 text-white rounded px-2 py-1 text-sm"
                    min="64"
                    max="512"
                    step="64"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1" title="Number of attention heads">
                    n_heads
                  </label>
                  <input
                    type="number"
                    value={formConfig.transformer_n_heads || 8}
                    onChange={(e) => setFormConfig(prev => ({ ...prev, transformer_n_heads: Number(e.target.value) }))}
                    className="w-full bg-slate-600 text-white rounded px-2 py-1 text-sm"
                    min="1"
                    max="16"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1" title="Number of transformer layers">
                    n_layers
                  </label>
                  <input
                    type="number"
                    value={formConfig.transformer_n_layers || 4}
                    onChange={(e) => setFormConfig(prev => ({ ...prev, transformer_n_layers: Number(e.target.value) }))}
                    className="w-full bg-slate-600 text-white rounded px-2 py-1 text-sm"
                    min="1"
                    max="8"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1" title="Feedforward dimension">
                    d_ff
                  </label>
                  <input
                    type="number"
                    value={formConfig.transformer_d_ff || 512}
                    onChange={(e) => setFormConfig(prev => ({ ...prev, transformer_d_ff: Number(e.target.value) }))}
                    className="w-full bg-slate-600 text-white rounded px-2 py-1 text-sm"
                    min="128"
                    max="2048"
                    step="128"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1" title="Dropout rate">
                    dropout
                  </label>
                  <input
                    type="number"
                    value={formConfig.transformer_dropout || 0.1}
                    onChange={(e) => setFormConfig(prev => ({ ...prev, transformer_dropout: Number(e.target.value) }))}
                    className="w-full bg-slate-600 text-white rounded px-2 py-1 text-sm"
                    min="0"
                    max="0.5"
                    step="0.05"
                  />
                </div>
              </div>
            )}
            
            {/* Validation message */}
            {formConfig.use_transformer_policy && showTransformerOptions && (
              <div className={`mt-2 text-xs ${getTransformerValidation().isValid ? 'text-green-400' : 'text-yellow-400'}`}>
                {getTransformerValidation().message}
              </div>
            )}
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
                  {agent.is_trained && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setBacktestAgent(agent.name);
                        setBacktestResult(null);
                      }}
                      className="text-slate-400 hover:text-blue-400 ml-1"
                      title="Backtest agent"
                    >
                      📊
                    </button>
                  )}
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
                          {agent.performance_metrics.mean_sharpe_ratio !== undefined && (
                            <div>
                              <span className="text-slate-400">Sharpe:</span>
                              <span className={`ml-1 ${(agent.performance_metrics.mean_sharpe_ratio ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatNumber(agent.performance_metrics.mean_sharpe_ratio)}
                              </span>
                            </div>
                          )}
                          {agent.performance_metrics.mean_max_drawdown !== undefined && (
                            <div>
                              <span className="text-slate-400">Max DD:</span>
                              <span className="text-red-400 ml-1">
                                {formatNumber((agent.performance_metrics.mean_max_drawdown ?? 0) * 100)}%
                              </span>
                            </div>
                          )}
                          {agent.performance_metrics.mean_win_rate !== undefined && (
                            <div>
                              <span className="text-slate-400">Win Rate:</span>
                              <span className="text-white ml-1">
                                {formatNumber((agent.performance_metrics.mean_win_rate ?? 0) * 100)}%
                              </span>
                            </div>
                          )}
                          {agent.performance_metrics.mean_alpha_pct !== undefined && (
                            <div>
                              <span className="text-slate-400">Alpha:</span>
                              <span className={`ml-1 ${(agent.performance_metrics.mean_alpha_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatNumber(agent.performance_metrics.mean_alpha_pct)}%
                              </span>
                            </div>
                          )}
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

      {/* Backtest Modal */}
      {backtestAgent && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => { setBacktestAgent(null); setBacktestResult(null); }}>
          <div className="bg-slate-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 border-b border-slate-700 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-white">📊 Backtest: {backtestAgent}</h3>
                <p className="text-sm text-slate-400">RL-Agent auf historischen Daten simulieren</p>
              </div>
              <button onClick={() => { setBacktestAgent(null); setBacktestResult(null); }} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Config */}
              {!backtestResult && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Symbol</label>
                    <input
                      type="text"
                      value={backtestSymbol}
                      onChange={(e) => setBacktestSymbol(e.target.value.toUpperCase())}
                      className="w-full bg-slate-700 text-white rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tage</label>
                    <input
                      type="number"
                      value={backtestDays}
                      onChange={(e) => setBacktestDays(Number(e.target.value))}
                      className="w-full bg-slate-700 text-white rounded px-3 py-2 text-sm"
                      min="30" max="3650"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Slippage-Modell</label>
                    <select
                      value={backtestSlippageModel}
                      onChange={(e) => setBacktestSlippageModel(e.target.value as 'none'|'fixed'|'proportional'|'volume')}
                      className="w-full bg-slate-700 text-white rounded px-3 py-2 text-sm"
                    >
                      <option value="none">Kein Slippage</option>
                      <option value="fixed">Fixed</option>
                      <option value="proportional">Proportional</option>
                      <option value="volume">Volume Impact</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Slippage (BPS)</label>
                    <input
                      type="number"
                      value={backtestSlippageBps}
                      onChange={(e) => setBacktestSlippageBps(Number(e.target.value))}
                      className="w-full bg-slate-700 text-white rounded px-3 py-2 text-sm"
                      min="0" max="50" step="0.5"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={backtestShortSelling}
                        onChange={(e) => setBacktestShortSelling(e.target.checked)}
                        className="w-4 h-4 rounded bg-slate-600 text-blue-600"
                      />
                      <span className="text-sm text-slate-300">Short Selling</span>
                    </label>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleRunBacktest}
                      disabled={backtestLoading}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                    >
                      {backtestLoading ? '⏳ Läuft...' : '▶ Backtest starten'}
                    </button>
                  </div>
                </div>
              )}

              {/* Loading */}
              {backtestLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
                  <span className="ml-3 text-slate-400">Agent backtested auf {backtestSymbol}...</span>
                </div>
              )}

              {/* Results */}
              {backtestResult && (
                <div className="space-y-4">
                  {/* Back button */}
                  <button
                    onClick={() => setBacktestResult(null)}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    ← Neuer Backtest
                  </button>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-slate-700 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400">Return</div>
                      <div className={`text-lg font-bold ${backtestResult.return_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {backtestResult.return_pct >= 0 ? '+' : ''}{formatNumber(backtestResult.return_pct)}%
                      </div>
                    </div>
                    <div className="bg-slate-700 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400">Alpha vs B&H</div>
                      <div className={`text-lg font-bold ${backtestResult.alpha_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {backtestResult.alpha_pct >= 0 ? '+' : ''}{formatNumber(backtestResult.alpha_pct)}%
                      </div>
                    </div>
                    <div className="bg-slate-700 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400">Sharpe Ratio</div>
                      <div className={`text-lg font-bold ${backtestResult.sharpe_ratio >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatNumber(backtestResult.sharpe_ratio)}
                      </div>
                    </div>
                    <div className="bg-slate-700 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400">Max Drawdown</div>
                      <div className="text-lg font-bold text-red-400">
                        {formatNumber(backtestResult.max_drawdown * 100)}%
                      </div>
                    </div>
                  </div>

                  {/* Equity Curve */}
                  {backtestResult.equity_curve && backtestResult.equity_curve.length > 0 && (
                    <div className="bg-slate-700 rounded-lg p-4">
                      <h4 className="text-white font-medium mb-3">Equity Curve</h4>
                      <div className="w-full" style={{ height: 200 }}>
                        <svg viewBox="0 0 600 200" className="w-full h-full" preserveAspectRatio="none">
                          {(() => {
                            const curve = backtestResult.equity_curve;
                            const minV = Math.min(...curve.map(p => p.portfolio_value));
                            const maxV = Math.max(...curve.map(p => p.portfolio_value));
                            const range = maxV - minV || 1;
                            const pad = 10;
                            const w = 600 - pad * 2;
                            const h = 200 - pad * 2;
                            const points = curve.map((p, i) => {
                              const x = pad + (i / (curve.length - 1)) * w;
                              const y = pad + h - ((p.portfolio_value - minV) / range) * h;
                              return `${x},${y}`;
                            });
                            const startVal = curve[0].portfolio_value;
                            const endVal = curve[curve.length - 1].portfolio_value;
                            const color = endVal >= startVal ? '#4ade80' : '#f87171';
                            return (
                              <>
                                <defs>
                                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                                    <stop offset="100%" stopColor={color} stopOpacity="0.0" />
                                  </linearGradient>
                                </defs>
                                <polygon
                                  points={`${pad},${pad + h} ${points.join(' ')} ${pad + w},${pad + h}`}
                                  fill="url(#eqGrad)"
                                />
                                <polyline
                                  points={points.join(' ')}
                                  fill="none"
                                  stroke={color}
                                  strokeWidth="2"
                                />
                                <text x={pad} y={pad - 2} fill="#94a3b8" fontSize="10">
                                  {Math.round(maxV).toLocaleString()}€
                                </text>
                                <text x={pad} y={pad + h + 12} fill="#94a3b8" fontSize="10">
                                  {Math.round(minV).toLocaleString()}€
                                </text>
                              </>
                            );
                          })()}
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Detailed Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div className="bg-slate-700/50 rounded p-2">
                      <span className="text-slate-400 block text-xs">Sortino</span>
                      <span className="text-white">{formatNumber(backtestResult.sortino_ratio)}</span>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2">
                      <span className="text-slate-400 block text-xs">Calmar</span>
                      <span className="text-white">{formatNumber(backtestResult.calmar_ratio)}</span>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2">
                      <span className="text-slate-400 block text-xs">Profit Factor</span>
                      <span className="text-white">{formatNumber(backtestResult.profit_factor)}</span>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2">
                      <span className="text-slate-400 block text-xs">Win Rate</span>
                      <span className="text-white">{formatNumber(backtestResult.win_rate * 100)}%</span>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2">
                      <span className="text-slate-400 block text-xs">Trades</span>
                      <span className="text-white">{backtestResult.total_trades} ({backtestResult.winning_trades}W / {backtestResult.losing_trades}L)</span>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2">
                      <span className="text-slate-400 block text-xs">Avg Win / Loss</span>
                      <span className="text-green-400">{formatNumber(backtestResult.avg_win)}</span>
                      <span className="text-slate-500 mx-1">/</span>
                      <span className="text-red-400">{formatNumber(backtestResult.avg_loss)}</span>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2">
                      <span className="text-slate-400 block text-xs">Gebühren</span>
                      <span className="text-amber-400">{formatNumber(backtestResult.total_fees_paid)}€ ({formatNumber(backtestResult.fee_impact_pct)}%)</span>
                    </div>
                    <div className="bg-slate-700/50 rounded p-2">
                      <span className="text-slate-400 block text-xs">Benchmark (B&H)</span>
                      <span className={backtestResult.benchmark_return_pct >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {formatNumber(backtestResult.benchmark_return_pct)}%
                      </span>
                    </div>
                  </div>

                  {/* Actions Summary */}
                  {backtestResult.actions_summary && Object.keys(backtestResult.actions_summary).length > 0 && (
                    <div className="bg-slate-700 rounded-lg p-4">
                      <h4 className="text-white font-medium mb-2 text-sm">Aktionen</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(backtestResult.actions_summary).sort((a, b) => b[1] - a[1]).map(([action, count]) => (
                          <span key={action} className="text-xs px-2 py-1 bg-slate-600 rounded text-slate-300">
                            {action}: <strong className="text-white">{count}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Config Info */}
                  <div className="text-xs text-slate-500 flex flex-wrap gap-3">
                    <span>Slippage: {backtestResult.slippage_model} ({backtestResult.slippage_bps} BPS)</span>
                    <span>Short: {backtestResult.short_selling_enabled ? 'Ja' : 'Nein'}</span>
                    <span>Schritte: {backtestResult.total_steps}</span>
                    <span>Portfolio: {Math.round(backtestResult.final_portfolio_value).toLocaleString()}€</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
