/**
 * Authentication Service
 * 
 * Handles user authentication, registration, and session management.
 * Works both with backend database (when available) and local-only mode.
 */

import { log } from '../utils/logger';
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const AUTH_TOKEN_KEY = 'daytrader_auth_token';
const AUTH_USER_KEY = 'daytrader_auth_user';

export interface User {
  id: number;
  email: string;
  username?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: User;
  token?: string;
}

export interface AuthStatus {
  authAvailable: boolean;
  dbConfigured: boolean;
  dbHealthy: boolean;
}

// In-memory state
let currentState: AuthState = {
  isAuthenticated: false,
  user: null,
  token: null,
};

// Listeners for state changes
type AuthListener = (state: AuthState) => void;
const listeners: Set<AuthListener> = new Set();

/**
 * Subscribe to auth state changes
 */
export function subscribeToAuth(listener: AuthListener): () => void {
  listeners.add(listener);
  // Immediately call with current state
  listener(currentState);
  return () => listeners.delete(listener);
}

/**
 * Notify all listeners of state change
 */
function notifyListeners(): void {
  listeners.forEach(listener => listener(currentState));
}

/**
 * Update auth state
 */
function setState(newState: Partial<AuthState>): void {
  currentState = { ...currentState, ...newState };
  notifyListeners();
}

/**
 * Get current auth state
 */
export function getAuthState(): AuthState {
  return currentState;
}

/**
 * Initialize auth from stored token
 */
export async function initializeAuth(): Promise<void> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const userJson = localStorage.getItem(AUTH_USER_KEY);
  
  if (token && userJson) {
    try {
      // Verify token is still valid
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        setState({
          isAuthenticated: true,
          user: data.user,
          token,
        });
      } else {
        // Token invalid, clear storage
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        setState({ isAuthenticated: false, user: null, token: null });
      }
    } catch {
      // Network error, use cached user but mark as potentially stale
      try {
        const cachedUser = JSON.parse(userJson) as User;
        setState({
          isAuthenticated: true,
          user: cachedUser,
          token,
        });
      } catch {
        setState({ isAuthenticated: false, user: null, token: null });
      }
    }
  }
}

/**
 * Check if auth backend is available
 */
export async function checkAuthStatus(): Promise<AuthStatus> {
  try {
    const response = await fetch(`${API_BASE}/auth/status`);
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Network error
  }
  return {
    authAvailable: false,
    dbConfigured: false,
    dbHealthy: false,
  };
}

/**
 * Register a new user
 */
export async function register(email: string, password: string, username?: string): Promise<AuthResult> {
  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, username }),
      credentials: 'include',
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      log.error('Registration failed:', response.status, data.error);
      return { success: false, error: data.error || `Registration failed (${response.status})` };
    }
    
    log.info('Registration successful');
    return { success: true, user: data.user };
  } catch (e) {
    log.error('Registration network error:', e);
    if (e instanceof TypeError || (e instanceof Error && (e.name === 'NetworkError' || e.name === 'TypeError'))) {
      return { success: false, error: 'Cannot reach server. Please check your connection and try again.' };
    }
    return { success: false, error: 'Network error. Please try again.' };
  }
}

/**
 * Login user
 */
export async function login(email: string, password: string): Promise<AuthResult> {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      log.error('Login failed:', response.status, data.error);
      return { success: false, error: data.error || `Login failed (${response.status})` };
    }
    
    // Store token and user
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
    
    setState({
      isAuthenticated: true,
      user: data.user,
      token: data.token,
    });
    
    log.info('Login successful');
    return { success: true, user: data.user, token: data.token };
  } catch (e) {
    log.error('Login network error:', e);
    if (e instanceof TypeError || (e instanceof Error && (e.name === 'NetworkError' || e.name === 'TypeError'))) {
      return { success: false, error: 'Cannot reach server. Please check your connection and try again.' };
    }
    return { success: false, error: 'Network error. Please try again.' };
  }
}

/**
 * Logout user
 */
export async function logout(): Promise<void> {
  const token = currentState.token;
  
  if (token) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
    } catch {
      // Ignore network errors on logout
    }
  }
  
  // Clear local storage
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  
  setState({
    isAuthenticated: false,
    user: null,
    token: null,
  });
}

/**
 * Get authorization headers for API requests
 */
export function getAuthHeaders(): Record<string, string> {
  const token = currentState.token;
  if (token) {
    return { 'Authorization': `Bearer ${token}` };
  }
  return {};
}

export default {
  subscribeToAuth,
  getAuthState,
  initializeAuth,
  checkAuthStatus,
  register,
  login,
  logout,
  getAuthHeaders,
};
