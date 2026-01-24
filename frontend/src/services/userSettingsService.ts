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
  useCuda: false,
  preloadFinbert: false,
};

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

export default {
  getUserSettings,
  updateUserSettings,
  getCustomSymbols,
  addCustomSymbolToServer,
  removeCustomSymbolFromServer,
  syncLocalSymbolsToServer,
};
