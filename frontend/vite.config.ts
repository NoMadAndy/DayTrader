import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,  // Erlaubt alle Hosts (für Reverseproxy)
    proxy: {
      // SSE Stream endpoints - MUST be before /api to match first
      '/api/stream': {
        target: process.env.BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        // Critical: Disable all buffering for SSE
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // Disable buffering for SSE responses
            proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
      // Proxy API requests to backend in development
      // Uses BACKEND_URL (Docker internal) not VITE_API_BASE_URL (browser-facing)
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // Proxy RL service requests
      '/rl-api': {
        target: process.env.RL_SERVICE_URL || 'http://localhost:8001',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/rl-api/, ''),
      },
    },
  },
  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.BUILD_VERSION || packageJson.version),
    __BUILD_COMMIT__: JSON.stringify(process.env.BUILD_COMMIT || 'dev'),
    __BUILD_TIME__: JSON.stringify(process.env.BUILD_TIME || new Date().toISOString()),
  },
})