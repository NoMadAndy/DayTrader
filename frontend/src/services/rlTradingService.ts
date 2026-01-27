/**
 * RL Trading Service Client
 * 
 * Client for the Deep Reinforcement Learning trading service.
 * Provides methods for:
 * - Managing trading agents (create, train, delete)
 * - Getting trading signals from trained agents
 * - Configuring agent parameters
 */

import type { OHLCV } from '../types/stock';
import { getAuthHeaders } from './authService';

// Use backend proxy for RL service
const RL_API_BASE = '/api/rl';

/**
 * Convert frontend OHLCV format to backend OHLCVData format
 * Frontend uses: { time: seconds, open, high, low, close, volume }
 * Backend expects: { timestamp: milliseconds, open, high, low, close, volume }
 */
function convertToBackendFormat(data: OHLCV[]): Array<{
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> {
  return data.map(d => ({
    timestamp: d.time * 1000, // Convert seconds to milliseconds
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  }));
}

// ============== Types ==============

export type HoldingPeriod = 
  | 'scalping' 
  | 'intraday' 
  | 'swing_short' 
  | 'swing_medium' 
  | 'position_short' 
  | 'position_medium' 
  | 'position_long' 
  | 'investor';

export type RiskProfile = 
  | 'conservative' 
  | 'moderate' 
  | 'aggressive' 
  | 'very_aggressive';

export type TradingStyle = 
  | 'trend_following' 
  | 'mean_reversion' 
  | 'momentum' 
  | 'breakout' 
  | 'contrarian' 
  | 'mixed';

export type BrokerProfile = 
  | 'discount' 
  | 'standard' 
  | 'premium' 
  | 'marketMaker';

export interface AgentConfig {
  name: string;
  description?: string;
  holding_period: HoldingPeriod;
  risk_profile: RiskProfile;
  trading_style: TradingStyle;
  initial_balance: number;
  max_position_size: number;
  max_positions: number;
  stop_loss_percent?: number;
  take_profit_percent?: number;
  trailing_stop: boolean;
  trailing_stop_distance: number;
  broker_profile: BrokerProfile;
  trade_on_high_volatility: boolean;
  min_volume_threshold: number;
  use_daily_data: boolean;
  symbols: string[];
  learning_rate: number;
  gamma: number;
  ent_coef: number;
}

export interface AgentStatus {
  name: string;
  status: 'idle' | 'training' | 'trained' | 'failed';
  is_trained: boolean;
  training_progress: number;
  last_trained?: string;
  total_episodes: number;
  best_reward?: number;
  config?: AgentConfig;
  performance_metrics?: {
    mean_reward: number;
    std_reward: number;
    mean_length: number;
    mean_return_pct: number;
    max_return_pct: number;
    min_return_pct: number;
  };
}

export interface TrainingStatus {
  agent_name: string;
  status: 'starting' | 'fetching_data' | 'training' | 'completed' | 'failed';
  progress: number;
  timesteps?: number;
  episodes?: number;
  mean_reward?: number;
  best_reward?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
  result?: Record<string, unknown>;
}

export interface TradingSignal {
  signal: 'buy' | 'sell' | 'hold';
  action: string;
  strength: 'weak' | 'moderate' | 'strong' | 'neutral';
  confidence: number;
  action_probabilities: Record<string, number>;
  agent_name: string;
  agent_style: string;
  holding_period: string;
  symbol?: string;
  error?: string;
}

export interface MultiSignalResponse {
  signals: Record<string, TradingSignal>;
  consensus: {
    signal: 'buy' | 'sell' | 'hold';
    strength: number;
    confidence: number;
    votes: {
      buy: number;
      sell: number;
      hold: number;
    };
  };
  agents_queried: number;
  agents_responded: number;
}

export interface RLServiceHealth {
  status: string;
  timestamp: string;
  version: string;
  commit: string;
  build_time: string;
  device_info: {
    device: string;
    cuda_available: boolean;
    cuda_enabled: boolean;
    cuda_device_name?: string;
    cuda_memory_total?: string;
    cuda_device_count?: number;
  };
}

export interface ConfigOption {
  value: string;
  label: string;
}

// ============== Service Class ==============

class RLTradingService {
  /**
   * Check RL service health and GPU status
   */
  async getHealth(): Promise<RLServiceHealth | null> {
    try {
      const response = await fetch(`${RL_API_BASE}/health`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('RL Trading Service health check failed:', error);
      return null;
    }
  }

  /**
   * Check if RL service is available
   */
  async isAvailable(): Promise<boolean> {
    const health = await this.getHealth();
    return health?.status === 'healthy';
  }

  /**
   * Get service info
   */
  async getInfo(): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${RL_API_BASE}/info`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('RL Trading Service info failed:', error);
      return null;
    }
  }

  // ============== Agent Management ==============

  /**
   * List all trading agents
   */
  async listAgents(): Promise<AgentStatus[]> {
    const response = await fetch(`${RL_API_BASE}/agents`);
    if (!response.ok) {
      throw new Error('Failed to list agents');
    }
    return response.json();
  }

  /**
   * Get status of a specific agent
   */
  async getAgentStatus(agentName: string): Promise<AgentStatus> {
    const response = await fetch(`${RL_API_BASE}/agents/${encodeURIComponent(agentName)}`);
    if (!response.ok) {
      throw new Error(`Agent not found: ${agentName}`);
    }
    return response.json();
  }

  /**
   * Delete an agent (requires authentication)
   */
  async deleteAgent(agentName: string): Promise<void> {
    const response = await fetch(`${RL_API_BASE}/agents/${encodeURIComponent(agentName)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to delete agent: ${agentName}`);
    }
  }

  /**
   * List available preset configurations
   */
  async listPresets(): Promise<Record<string, AgentConfig>> {
    const response = await fetch(`${RL_API_BASE}/presets`);
    if (!response.ok) {
      throw new Error('Failed to list presets');
    }
    return response.json();
  }

  /**
   * Get a specific preset configuration
   */
  async getPreset(presetName: string): Promise<AgentConfig> {
    const response = await fetch(`${RL_API_BASE}/presets/${encodeURIComponent(presetName)}`);
    if (!response.ok) {
      throw new Error(`Preset not found: ${presetName}`);
    }
    return response.json();
  }

  // ============== Training ==============

  /**
   * Start training an agent with provided data (requires authentication)
   */
  async trainAgent(
    agentName: string,
    config: AgentConfig,
    data: Record<string, OHLCV[]>,
    totalTimesteps: number = 100000
  ): Promise<{ message: string; status: string }> {
    // Convert all symbol data to backend format
    const convertedData: Record<string, ReturnType<typeof convertToBackendFormat>> = {};
    for (const [symbol, ohlcvData] of Object.entries(data)) {
      convertedData[symbol] = convertToBackendFormat(ohlcvData);
    }
    
    const response = await fetch(`${RL_API_BASE}/train`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        agent_name: agentName,
        config,
        data: convertedData,
        total_timesteps: totalTimesteps,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Training failed to start');
    }
    return response.json();
  }

  /**
   * Start training an agent using backend data (requires authentication)
   */
  async trainAgentFromBackend(
    agentName: string,
    config: AgentConfig,
    symbols: string[] = ['AAPL', 'MSFT', 'GOOGL'],
    days: number = 365,
    totalTimesteps: number = 100000
  ): Promise<{ message: string; status: string }> {
    const response = await fetch(`${RL_API_BASE}/train/from-backend`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        agent_name: agentName,
        config,
        symbols,
        days,
        total_timesteps: totalTimesteps,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Training failed to start');
    }
    return response.json();
  }

  /**
   * Get training status for an agent
   */
  async getTrainingStatus(agentName: string): Promise<TrainingStatus> {
    const response = await fetch(`${RL_API_BASE}/train/status/${encodeURIComponent(agentName)}`);
    if (!response.ok) {
      throw new Error(`Training status not found: ${agentName}`);
    }
    return response.json();
  }

  // ============== Signals ==============

  /**
   * Get trading signal from an agent
   */
  async getSignal(agentName: string, data: OHLCV[]): Promise<TradingSignal> {
    const response = await fetch(`${RL_API_BASE}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: agentName,
        data: convertToBackendFormat(data),
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to get signal');
    }
    return response.json();
  }

  /**
   * Get signals from multiple agents
   */
  async getMultiSignals(agentNames: string[], data: OHLCV[]): Promise<MultiSignalResponse> {
    const response = await fetch(`${RL_API_BASE}/signals/multi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_names: agentNames,
        data: convertToBackendFormat(data),
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to get signals');
    }
    return response.json();
  }

  /**
   * Get quick signal (auto-fetches data)
   */
  async getQuickSignal(agentName: string, symbol: string = 'AAPL'): Promise<TradingSignal> {
    const response = await fetch(
      `${RL_API_BASE}/signal/${encodeURIComponent(agentName)}/quick?symbol=${encodeURIComponent(symbol)}`
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to get quick signal');
    }
    return response.json();
  }

  // ============== Configuration Options ==============

  /**
   * Get holding period options
   */
  async getHoldingPeriods(): Promise<ConfigOption[]> {
    const response = await fetch(`${RL_API_BASE}/options/holding-periods`);
    if (!response.ok) return [];
    return response.json();
  }

  /**
   * Get risk profile options
   */
  async getRiskProfiles(): Promise<ConfigOption[]> {
    const response = await fetch(`${RL_API_BASE}/options/risk-profiles`);
    if (!response.ok) return [];
    return response.json();
  }

  /**
   * Get trading style options
   */
  async getTradingStyles(): Promise<ConfigOption[]> {
    const response = await fetch(`${RL_API_BASE}/options/trading-styles`);
    if (!response.ok) return [];
    return response.json();
  }

  /**
   * Get broker profile options
   */
  async getBrokerProfiles(): Promise<ConfigOption[]> {
    const response = await fetch(`${RL_API_BASE}/options/broker-profiles`);
    if (!response.ok) return [];
    return response.json();
  }
}

// Export singleton instance
export const rlTradingService = new RLTradingService();
export default rlTradingService;
