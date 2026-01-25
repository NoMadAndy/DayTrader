/**
 * Rate Limiter & API Call Manager
 * 
 * Implements data conservation strategies for API providers with rate limits:
 * - Per-provider rate limiting
 * - Request deduplication
 * - Intelligent caching with tiered expiry
 * - Request batching
 * - Quota tracking
 * 
 * Provider Rate Limits (Free Tier):
 * - Alpha Vantage: 25 requests/day (5/min on some endpoints)
 * - Twelve Data: 800 requests/day (8/min)
 * - Finnhub: 60 requests/min
 * - Yahoo Finance: No official limit, but be respectful
 */

import type { DataSourceType } from './types';

// Rate limit configurations per provider
export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerDay: number;
  burstLimit: number;         // Max requests in quick succession
  cooldownMs: number;         // Minimum time between requests
  cacheDurationMs: number;    // How long to cache data
  priority: number;           // Lower = higher priority (used less aggressively)
}

export const PROVIDER_RATE_LIMITS: Record<DataSourceType, RateLimitConfig> = {
  alphaVantage: {
    requestsPerMinute: 5,
    requestsPerDay: 25,
    burstLimit: 2,
    cooldownMs: 12000,        // 12 seconds between requests
    cacheDurationMs: 300000,  // 5 minutes cache
    priority: 3               // Use sparingly
  },
  twelveData: {
    requestsPerMinute: 8,
    requestsPerDay: 800,
    burstLimit: 3,
    cooldownMs: 8000,         // 8 seconds between requests
    cacheDurationMs: 180000,  // 3 minutes cache
    priority: 2
  },
  finnhub: {
    requestsPerMinute: 60,
    requestsPerDay: 100000,   // Effectively unlimited
    burstLimit: 10,
    cooldownMs: 1000,         // 1 second between requests
    cacheDurationMs: 60000,   // 1 minute cache
    priority: 1               // Use freely
  },
  yahoo: {
    requestsPerMinute: 100,
    requestsPerDay: 10000,
    burstLimit: 20,
    cooldownMs: 500,
    cacheDurationMs: 60000,   // 1 minute cache
    priority: 1
  },
  mock: {
    requestsPerMinute: Infinity,
    requestsPerDay: Infinity,
    burstLimit: Infinity,
    cooldownMs: 0,
    cacheDurationMs: 0,
    priority: 0
  }
};

// Request tracking
interface RequestRecord {
  timestamp: number;
  endpoint: string;
}

interface ProviderStats {
  requestsThisMinute: number;
  requestsToday: number;
  lastRequest: number;
  dayStartTimestamp: number;
  requestHistory: RequestRecord[];
}

// Cache entry with metadata
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  source: DataSourceType;
  expiresAt: number;
}

// Pending request for deduplication
interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

const STORAGE_KEY = 'daytrader_rate_limiter_stats';

export class RateLimiter {
  private stats: Map<DataSourceType, ProviderStats> = new Map();
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private pendingRequests: Map<string, PendingRequest<unknown>> = new Map();
  private listeners: Set<(stats: Map<DataSourceType, ProviderStats>) => void> = new Set();

  constructor() {
    this.loadStats();
    this.startDailyReset();
  }

  /**
   * Load stats from localStorage
   */
  private loadStats(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const now = Date.now();
        const dayStart = this.getDayStart();

        // Restore stats, resetting daily counters if needed
        Object.entries(parsed).forEach(([source, stats]) => {
          const providerStats = stats as ProviderStats;
          if (providerStats.dayStartTimestamp !== dayStart) {
            // New day, reset daily counter
            providerStats.requestsToday = 0;
            providerStats.dayStartTimestamp = dayStart;
          }
          // Reset minute counter if more than a minute has passed
          if (now - providerStats.lastRequest > 60000) {
            providerStats.requestsThisMinute = 0;
          }
          this.stats.set(source as DataSourceType, providerStats);
        });
      }
    } catch (e) {
      console.warn('Failed to load rate limiter stats:', e);
    }

    // Initialize missing providers
    for (const source of Object.keys(PROVIDER_RATE_LIMITS) as DataSourceType[]) {
      if (!this.stats.has(source)) {
        this.stats.set(source, this.createEmptyStats());
      }
    }
  }

  /**
   * Save stats to localStorage
   */
  private saveStats(): void {
    try {
      const obj: Record<string, ProviderStats> = {};
      this.stats.forEach((stats, source) => {
        obj[source] = stats;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn('Failed to save rate limiter stats:', e);
    }
  }

  /**
   * Get start of current day (UTC midnight)
   */
  private getDayStart(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  /**
   * Create empty stats for a provider
   */
  private createEmptyStats(): ProviderStats {
    return {
      requestsThisMinute: 0,
      requestsToday: 0,
      lastRequest: 0,
      dayStartTimestamp: this.getDayStart(),
      requestHistory: []
    };
  }

  /**
   * Start daily reset timer
   */
  private startDailyReset(): void {
    // Check every minute for day change
    setInterval(() => {
      const dayStart = this.getDayStart();
      this.stats.forEach((stats, source) => {
        if (stats.dayStartTimestamp !== dayStart) {
          stats.requestsToday = 0;
          stats.dayStartTimestamp = dayStart;
          stats.requestHistory = [];
        }
      });
      this.saveStats();
    }, 60000);
  }

  /**
   * Check if a request is allowed for a provider
   */
  canMakeRequest(source: DataSourceType): boolean {
    if (source === 'mock') return true;

    const config = PROVIDER_RATE_LIMITS[source];
    const stats = this.stats.get(source) || this.createEmptyStats();
    const now = Date.now();

    // Check daily limit
    if (stats.requestsToday >= config.requestsPerDay) {
      console.warn(`${source}: Daily limit reached (${config.requestsPerDay})`);
      return false;
    }

    // Update minute counter
    const oneMinuteAgo = now - 60000;
    stats.requestsThisMinute = stats.requestHistory.filter(
      r => r.timestamp > oneMinuteAgo
    ).length;

    // Check per-minute limit
    if (stats.requestsThisMinute >= config.requestsPerMinute) {
      console.warn(`${source}: Minute limit reached (${config.requestsPerMinute})`);
      return false;
    }

    // Check cooldown
    if (now - stats.lastRequest < config.cooldownMs) {
      const waitTime = config.cooldownMs - (now - stats.lastRequest);
      console.warn(`${source}: Cooldown active, wait ${waitTime}ms`);
      return false;
    }

    return true;
  }

  /**
   * Record a request
   */
  recordRequest(source: DataSourceType, endpoint: string): void {
    if (source === 'mock') return;

    const stats = this.stats.get(source) || this.createEmptyStats();
    const now = Date.now();

    stats.requestsToday++;
    stats.lastRequest = now;
    stats.requestHistory.push({ timestamp: now, endpoint });

    // Clean old history (keep last hour)
    const oneHourAgo = now - 3600000;
    stats.requestHistory = stats.requestHistory.filter(r => r.timestamp > oneHourAgo);

    this.stats.set(source, stats);
    this.saveStats();
    this.notifyListeners();
  }

  /**
   * Get remaining quota for a provider
   */
  getRemainingQuota(source: DataSourceType): { daily: number; perMinute: number } {
    const config = PROVIDER_RATE_LIMITS[source];
    const stats = this.stats.get(source) || this.createEmptyStats();
    const now = Date.now();

    // Update minute counter
    const oneMinuteAgo = now - 60000;
    const requestsThisMinute = stats.requestHistory.filter(
      r => r.timestamp > oneMinuteAgo
    ).length;

    return {
      daily: Math.max(0, config.requestsPerDay - stats.requestsToday),
      perMinute: Math.max(0, config.requestsPerMinute - requestsThisMinute)
    };
  }

  /**
   * Get all provider stats
   */
  getAllStats(): Map<DataSourceType, ProviderStats> {
    return new Map(this.stats);
  }

  /**
   * Get cache entry if valid
   */
  getCached<T>(key: string, source?: DataSourceType): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cache entry with provider-specific duration
   */
  setCache<T>(key: string, data: T, source: DataSourceType): void {
    const config = PROVIDER_RATE_LIMITS[source];
    const now = Date.now();

    this.cache.set(key, {
      data,
      timestamp: now,
      source,
      expiresAt: now + config.cacheDurationMs
    });
  }

  /**
   * Set cache with custom duration
   */
  setCacheWithDuration<T>(key: string, data: T, source: DataSourceType, durationMs: number): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      source,
      expiresAt: now + durationMs
    });
  }

  /**
   * Deduplicate concurrent requests
   */
  async deduplicateRequest<T>(
    key: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    // Check if identical request is already pending
    const pending = this.pendingRequests.get(key) as PendingRequest<T> | undefined;
    if (pending && Date.now() - pending.timestamp < 5000) {
      console.log(`Deduplicating request: ${key}`);
      return pending.promise;
    }

    // Create new request
    const promise = requestFn().finally(() => {
      // Clean up after request completes
      setTimeout(() => {
        this.pendingRequests.delete(key);
      }, 100);
    });

    this.pendingRequests.set(key, { promise, timestamp: Date.now() });
    return promise;
  }

  /**
   * Get time until next request is allowed
   */
  getWaitTime(source: DataSourceType): number {
    if (source === 'mock') return 0;

    const config = PROVIDER_RATE_LIMITS[source];
    const stats = this.stats.get(source) || this.createEmptyStats();
    const now = Date.now();

    // Check cooldown
    const cooldownRemaining = config.cooldownMs - (now - stats.lastRequest);
    if (cooldownRemaining > 0) {
      return cooldownRemaining;
    }

    // Check minute limit
    const quota = this.getRemainingQuota(source);
    if (quota.perMinute <= 0) {
      // Find oldest request in the last minute
      const oneMinuteAgo = now - 60000;
      const recentRequests = stats.requestHistory.filter(r => r.timestamp > oneMinuteAgo);
      if (recentRequests.length > 0) {
        const oldest = Math.min(...recentRequests.map(r => r.timestamp));
        return oldest + 60000 - now;
      }
    }

    return 0;
  }

  /**
   * Subscribe to stats changes
   */
  subscribe(listener: (stats: Map<DataSourceType, ProviderStats>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify listeners of stats changes
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.getAllStats()));
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get best available provider based on rate limits and priority
   */
  getBestAvailableProvider(
    availableSources: DataSourceType[],
    preferredSource?: DataSourceType
  ): DataSourceType | null {
    // Try preferred source first if it has quota
    if (preferredSource && 
        preferredSource !== 'mock' && 
        availableSources.includes(preferredSource) &&
        this.canMakeRequest(preferredSource)) {
      return preferredSource;
    }

    // Sort by priority (lower = better) and filter by available quota
    const sourcesWithQuota = availableSources
      .filter(s => s !== 'mock' && this.canMakeRequest(s))
      .sort((a, b) => {
        const configA = PROVIDER_RATE_LIMITS[a];
        const configB = PROVIDER_RATE_LIMITS[b];
        return configA.priority - configB.priority;
      });

    return sourcesWithQuota[0] || null;
  }

  /**
   * Reset stats for testing
   */
  resetStats(): void {
    this.stats.clear();
    for (const source of Object.keys(PROVIDER_RATE_LIMITS) as DataSourceType[]) {
      this.stats.set(source, this.createEmptyStats());
    }
    this.saveStats();
    this.notifyListeners();
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter();
  }
  return rateLimiterInstance;
}
