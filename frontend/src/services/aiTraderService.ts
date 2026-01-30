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
 * Get all AI traders
 */
export async function getAITraders(): Promise<AITrader[]> {
  const response = await fetch(`${API_BASE}/ai-traders`);
  return handleResponse<AITrader[]>(response);
}

/**
 * Get AI trader by ID
 */
export async function getAITrader(id: number): Promise<AITrader> {
  const response = await fetch(`${API_BASE}/ai-traders/${id}`);
  return handleResponse<AITrader>(response);
}

/**
 * Create new AI trader
 */
export async function createAITrader(data: CreateAITraderRequest): Promise<AITrader> {
  const response = await fetch(`${API_BASE}/ai-traders`, {
    method: 'POST',
    headers: getAuthHeaders(),
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
    headers: getAuthHeaders(),
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
