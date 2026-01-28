/**
 * User Settings Service
 * 
 * Handles user settings and custom symbols synchronization with the backend.
 * Falls back to localStorage when user is not authenticated.
 */

import { getAuthState, getAuthHeaders } from './authService';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export interface MLSettings {
  sequenceLength: number;
  forecastDays: number;
  epochs: number;
  learningRate: number;
  useCuda: boolean;
  preloadFinbert: boolean;
}

export const DEFAULT_ML_SETTINGS: MLSettings = {
  sequenceLength: 60,
  forecastDays: 14,
  epochs: 100,
  learningRate: 0.001,
  useCuda: true,
  preloadFinbert: false,
};

/**
 * Signal source settings for trading signal aggregation
 */
export interface SignalSourceSettings {
  // Enable/disable individual signal sources
  enableSentiment: boolean;      // News sentiment analysis
  enableTechnical: boolean;      // Technical indicators (RSI, MACD, etc.)
  enableMLPrediction: boolean;   // LSTM price predictions
  enableRLAgents: boolean;       // Reinforcement learning agents
  
  // Selected RL agents for signal generation
  selectedRLAgents: string[];
  
  // Custom weights (optional, null = use defaults)
  customWeights?: {
    sentiment: number;
    technical: number;
    ml: number;
    rl: number;
  } | null;
}

export const DEFAULT_SIGNAL_SOURCE_SETTINGS: SignalSourceSettings = {
  enableSentiment: true,
  enableTechnical: true,
  enableMLPrediction: true,
  enableRLAgents: true,  // RL Agents enabled by default
  selectedRLAgents: [],  // Empty = use all trained agents
  customWeights: null,
};

/**
 * Watchlist settings for extended signal loading
 */
export interface WatchlistSettings {
  // Load all signal sources (News, ML, RL) for watchlist items
  extendedSignals: boolean;
  // Cache duration in minutes for watchlist signals
  cacheDurationMinutes: number;
  // Auto-refresh interval in seconds (0 = disabled)
  autoRefreshSeconds: number;
}

export const DEFAULT_WATCHLIST_SETTINGS: WatchlistSettings = {
  extendedSignals: false,
  cacheDurationMinutes: 15,
  autoRefreshSeconds: 60,
};

const WATCHLIST_SETTINGS_KEY = 'daytrader_watchlist_settings';

/**
 * Get watchlist settings from localStorage
 */
export function getWatchlistSettings(): WatchlistSettings {
  try {
    const stored = localStorage.getItem(WATCHLIST_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_WATCHLIST_SETTINGS, ...parsed };
    }
  } catch {
    console.warn('Failed to load watchlist settings');
  }
  return { ...DEFAULT_WATCHLIST_SETTINGS };
}

/**
 * Save watchlist settings to localStorage
 */
export function saveWatchlistSettings(settings: WatchlistSettings): void {
  try {
    localStorage.setItem(WATCHLIST_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    console.warn('Failed to save watchlist settings');
  }
}

const SIGNAL_SETTINGS_KEY = 'daytrader_signal_sources';

/**
 * Get signal source settings from localStorage
 */
export function getSignalSourceSettings(): SignalSourceSettings {
  try {
    const stored = localStorage.getItem(SIGNAL_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SIGNAL_SOURCE_SETTINGS, ...parsed };
    }
  } catch {
    console.warn('Failed to load signal source settings');
  }
  return { ...DEFAULT_SIGNAL_SOURCE_SETTINGS };
}

/**
 * Save signal source settings to localStorage
 */
export function saveSignalSourceSettings(settings: SignalSourceSettings): void {
  try {
    localStorage.setItem(SIGNAL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    console.warn('Failed to save signal source settings');
  }
}

export interface UserSettings {
  preferredDataSource: string;
  apiKeys: Record<string, string>;
  uiPreferences: Record<string, unknown>;
  mlSettings: MLSettings;
}

export interface CustomSymbol {
  id?: number;
  symbol: string;
  name: string;
  isCustom: boolean;
  createdAt?: string;
}

/**
 * Get user settings from server or localStorage
 */
export async function getUserSettings(): Promise<UserSettings | null> {
  const { isAuthenticated, token } = getAuthState();
  
  if (!isAuthenticated || !token) {
    return null;
  }
  
  try {
    const response = await fetch(`${API_BASE}/user/settings`, {
      headers: getAuthHeaders(),
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error
  }
  
  return null;
}

/**
 * Update user settings on server
 */
export async function updateUserSettings(updates: Partial<UserSettings>): Promise<UserSettings | null> {
  const { isAuthenticated, token } = getAuthState();
  
  if (!isAuthenticated || !token) {
    return null;
  }
  
  try {
    const response = await fetch(`${API_BASE}/user/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(updates),
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error
  }
  
  return null;
}

/**
 * Get custom symbols from server
 */
export async function getCustomSymbols(): Promise<CustomSymbol[]> {
  const { isAuthenticated, token } = getAuthState();
  
  if (!isAuthenticated || !token) {
    return [];
  }
  
  try {
    const response = await fetch(`${API_BASE}/user/symbols`, {
      headers: getAuthHeaders(),
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error
  }
  
  return [];
}

/**
 * Add a custom symbol on server
 */
export async function addCustomSymbolToServer(symbol: string, name?: string): Promise<{ success: boolean; symbol?: CustomSymbol; error?: string }> {
  const { isAuthenticated, token } = getAuthState();
  
  if (!isAuthenticated || !token) {
    return { success: false, error: 'Not authenticated' };
  }
  
  try {
    const response = await fetch(`${API_BASE}/user/symbols`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ symbol, name }),
    });
    
    if (response.ok) {
      const data = await response.json();
      return { success: true, symbol: data };
    }
    
    const error = await response.json();
    return { success: false, error: error.error || 'Failed to add symbol' };
  } catch {
    return { success: false, error: 'Network error' };
  }
}

/**
 * Remove a custom symbol from server
 */
export async function removeCustomSymbolFromServer(symbol: string): Promise<boolean> {
  const { isAuthenticated, token } = getAuthState();
  
  if (!isAuthenticated || !token) {
    return false;
  }
  
  try {
    const response = await fetch(`${API_BASE}/user/symbols/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sync local custom symbols to server
 */
export async function syncLocalSymbolsToServer(symbols: Array<{ symbol: string; name: string }>): Promise<{ added: number; skipped: number } | null> {
  const { isAuthenticated, token } = getAuthState();
  
  if (!isAuthenticated || !token) {
    return null;
  }
  
  try {
    const response = await fetch(`${API_BASE}/user/symbols/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ symbols }),
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error
  }
  
  return null;
}

/**
 * Get all symbols with historical data available in database
 * These are symbols that users have previously fetched data for
 */
export async function getAvailableSymbols(): Promise<string[]> {
  try {
    const response = await fetch(`${API_BASE}/historical-prices/symbols/available`);
    
    if (response.ok) {
      const data = await response.json();
      // Extract symbol names from response (may be objects with symbol property)
      if (Array.isArray(data.symbols)) {
        return data.symbols.map((s: string | { symbol: string }) => 
          typeof s === 'string' ? s : s.symbol
        );
      }
      return [];
    }
  } catch {
    // Network error
  }
  
  return [];
}

export default {
  getUserSettings,
  updateUserSettings,
  getCustomSymbols,
  addCustomSymbolToServer,
  removeCustomSymbolFromServer,
  syncLocalSymbolsToServer,
  getAvailableSymbols,
  getSignalSourceSettings,
  saveSignalSourceSettings,
};
