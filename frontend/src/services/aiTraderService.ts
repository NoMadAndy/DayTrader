/**
 * AI Trader Service
 * 
 * API client for AI trading agents.
 */

import { getAuthHeaders } from './authService';
import type {
  AITrader,
  AITraderPersonality,
  AITraderDecision,
  AITraderDailyReport,
  CreateAITraderRequest,
  UpdateAITraderRequest,
} from '../types/aiTrader';
import type { Position } from '../types/trading';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

// ============================================================================
// Helper Functions
// ============================================================================

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ============================================================================
// AI Trader CRUD Operations
// ============================================================================

/**
 * Get all AI traders (with cache-busting to ensure fresh data)
 */
export async function getAITraders(): Promise<AITrader[]> {
  const response = await fetch(`${API_BASE}/ai-traders?_t=${Date.now()}`, { cache: 'no-store' });
  return handleResponse<AITrader[]>(response);
}

/**
 * Get AI trader by ID (with cache-busting)
 */
export async function getAITrader(id: number): Promise<AITrader> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}?_t=${Date.now()}`, { cache: 'no-store' });
  return handleResponse<AITrader>(response);
}

/**
 * Create new AI trader
 */
export async function createAITrader(data: CreateAITraderRequest): Promise<AITrader> {
  const response = await fetch(`${API_BASE}/ai-traders`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return handleResponse<AITrader>(response);
}

/**
 * Update AI trader
 */
export async function updateAITrader(id: number, data: UpdateAITraderRequest): Promise<AITrader> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return handleResponse<AITrader>(response);
}

/**
 * Delete AI trader
 */
export async function deleteAITrader(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  await handleResponse<{ success: boolean }>(response);
}

// ============================================================================
// AI Trader Status Control
// ============================================================================

/**
 * Start AI trader
 */
export async function startAITrader(id: number): Promise<AITrader> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/start`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<AITrader>(response);
}

/**
 * Stop AI trader
 */
export async function stopAITrader(id: number): Promise<AITrader> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/stop`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<AITrader>(response);
}

/**
 * Pause AI trader
 */
export async function pauseAITrader(id: number): Promise<AITrader> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/pause`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<AITrader>(response);
}

// ============================================================================
// AI Trader Decisions & History
// ============================================================================

/**
 * Get decisions for an AI trader
 */
export async function getAITraderDecisions(
  id: number,
  limit?: number,
  offset?: number
): Promise<AITraderDecision[]> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', limit.toString());
  if (offset !== undefined) params.set('offset', offset.toString());
  
  const url = `${API_BASE}/ai-traders/${id}/decisions${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);
  return handleResponse<AITraderDecision[]>(response);
}

/**
 * Get specific decision
 */
export async function getAITraderDecision(traderId: number, decisionId: number): Promise<AITraderDecision> {
  const response = await fetch(`${API_BASE}/ai-traders/${traderId}/decisions/${decisionId}`);
  return handleResponse<AITraderDecision>(response);
}

/**
 * Get positions for an AI trader
 */
export async function getAITraderPositions(id: number): Promise<Position[]> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/positions`);
  return handleResponse<Position[]>(response);
}

/**
 * Get daily reports for an AI trader
 */
export async function getAITraderReports(
  id: number,
  startDate?: string,
  endDate?: string
): Promise<AITraderDailyReport[]> {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  
  const url = `${API_BASE}/ai-traders/${id}/reports${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);
  return handleResponse<AITraderDailyReport[]>(response);
}

/**
 * Get a specific report by date
 */
export async function getAITraderReportByDate(
  id: number,
  date: string
): Promise<AITraderDailyReport> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/reports/${date}`);
  return handleResponse<AITraderDailyReport>(response);
}

/**
 * Generate daily report manually
 */
export async function generateAITraderReport(
  id: number,
  date?: string
): Promise<AITraderDailyReport> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/reports/generate`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ date }),
  });
  return handleResponse<AITraderDailyReport>(response);
}

/**
 * Get signal accuracy for an AI trader
 */
export async function getSignalAccuracy(
  id: number,
  days: number = 30
): Promise<import('../types/aiTrader').SignalAccuracyData> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/signal-accuracy?days=${days}`);
  return handleResponse<import('../types/aiTrader').SignalAccuracyData>(response);
}

/**
 * Get insights for an AI trader
 */
export async function getAITraderInsights(
  id: number
): Promise<import('../types/aiTrader').AITraderInsightsResponse> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/insights`);
  return handleResponse<import('../types/aiTrader').AITraderInsightsResponse>(response);
}

/**
 * Get weight history for an AI trader
 */
export async function getWeightHistory(
  id: number,
  limit: number = 20
): Promise<import('../types/aiTrader').WeightHistoryEntry[]> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/weight-history?limit=${limit}`);
  return handleResponse<import('../types/aiTrader').WeightHistoryEntry[]>(response);
}

/**
 * Manually adjust weights for an AI trader
 */
export async function adjustWeights(
  id: number,
  weights: import('../types/aiTrader').AITraderSignalWeights,
  reason?: string
): Promise<{ success: boolean; oldWeights: import('../types/aiTrader').AITraderSignalWeights; newWeights: import('../types/aiTrader').AITraderSignalWeights }> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}/adjust-weights`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ weights, reason }),
  });
  return handleResponse<{ success: boolean; oldWeights: import('../types/aiTrader').AITraderSignalWeights; newWeights: import('../types/aiTrader').AITraderSignalWeights }>(response);
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get default personality configuration
 */
export async function getDefaultPersonality(): Promise<AITraderPersonality> {
  const response = await fetch(`${API_BASE}/ai-traders/config/default-personality`);
  return handleResponse<AITraderPersonality>(response);
}

// ============================================================================
// RL Agents
// ============================================================================

/** RL Agent status from the RL Trading Service */
export interface RLAgentStatus {
  name: string;
  status: 'trained' | 'training' | 'not_trained';
  is_trained: boolean;
  training_progress: number;
  last_trained: string | null;
  total_episodes: number;
  best_reward: number;
  config: {
    name: string;
    description: string;
    holding_period: string;
    risk_profile: string;
    trading_style: string;
  };
  performance_metrics?: {
    mean_reward: number;
    std_reward: number;
    mean_return_pct: number;
    max_return_pct: number;
    min_return_pct: number;
  };
}

/**
 * Get available RL agents from the RL Trading Service
 */
export async function getAvailableRLAgents(): Promise<RLAgentStatus[]> {
  const RL_SERVICE_URL = import.meta.env.VITE_RL_SERVICE_URL || '/rl-api';
  const response = await fetch(`${RL_SERVICE_URL}/agents`);
  return handleResponse<RLAgentStatus[]>(response);
}

/**
 * Get RL agent status for a specific agent by name
 */
export async function getRLAgentStatus(agentName: string): Promise<RLAgentStatus | null> {
  const RL_SERVICE_URL = import.meta.env.VITE_RL_SERVICE_URL || '/rl-api';
  try {
    const response = await fetch(`${RL_SERVICE_URL}/agents/${encodeURIComponent(agentName)}`);
    if (response.status === 404) {
      return null;
    }
    return handleResponse<RLAgentStatus>(response);
  } catch {
    return null;
  }
}

/**
 * Get training status for an AI trader (RL agent status + ML model info)
 */
export async function getTraderTrainingStatus(traderId: number): Promise<TraderTrainingStatus> {
  const response = await fetch(`${API_BASE}/ai-traders/${traderId}/training-status`);
  return handleResponse<TraderTrainingStatus>(response);
}

/** Training status for an AI trader */
export interface TraderTrainingStatus {
  traderId: number;
  traderName: string;
  rlAgentName: string | null;
  rlAgent: {
    status: 'trained' | 'training' | 'not_trained' | 'not_configured';
    isTrained: boolean;
    lastTrained: string | null;
    trainingProgress: number;
    totalEpisodes: number;
    bestReward: number | null;
    performanceMetrics: {
      meanReward: number;
      meanReturnPct: number;
      maxReturnPct: number;
      minReturnPct: number;
    } | null;
  };
  selfTraining: {
    enabled: boolean;
    intervalMinutes: number;
    timesteps: number;
    lastTrainingAt: string | null;
  };
  mlModel: {
    autoTrain: boolean;
    trainedSymbols: string[];
  };
  learningMode: {
    enabled: boolean;
    updateWeights: boolean;
    minSamples: number;
  };
}
