import '@testing-library/jest-dom';

// Mock Vite's import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_API_BASE_URL: '/api',
    MODE: 'test',
    DEV: true,
    PROD: false,
    SSR: false,
  },
  writable: true,
});

// Mock build-time defines
(globalThis as Record<string, unknown>).__BUILD_VERSION__ = '1.39.0';
(globalThis as Record<string, unknown>).__BUILD_COMMIT__ = 'test';
(globalThis as Record<string, unknown>).__BUILD_TIME__ = new Date().toISOString();
