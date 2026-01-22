/// <reference types="vite/client" />

declare const __BUILD_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly VITE_FINNHUB_API_KEY?: string;
  readonly VITE_ALPHA_VANTAGE_API_KEY?: string;
  readonly VITE_TWELVE_DATA_API_KEY?: string;
  readonly VITE_NEWS_API_KEY?: string;
  readonly VITE_PREFERRED_DATA_SOURCE?: 'mock' | 'finnhub' | 'alphaVantage' | 'twelveData' | 'yahoo';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
