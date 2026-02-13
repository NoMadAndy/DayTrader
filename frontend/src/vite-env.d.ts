/// <reference types="vite/client" />

declare const __BUILD_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

// Service Worker Periodic Background Sync API (non-standard, Chrome only)
interface PeriodicSyncManager {
  register(tag: string, options?: { minInterval: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

interface ServiceWorkerRegistration {
  readonly periodicSync?: PeriodicSyncManager;
  readonly sync?: SyncManager;
}

interface ImportMetaEnv {
  readonly VITE_FINNHUB_API_KEY?: string;
  readonly VITE_ALPHA_VANTAGE_API_KEY?: string;
  readonly VITE_TWELVE_DATA_API_KEY?: string;
  readonly VITE_NEWS_API_KEY?: string;
  readonly VITE_PREFERRED_DATA_SOURCE?: 'finnhub' | 'alphaVantage' | 'twelveData' | 'yahoo';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
