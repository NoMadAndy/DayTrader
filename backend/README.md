# DayTrader Backend

Backend proxy service for DayTrader that handles external API calls to avoid CORS issues in the browser.

## Purpose

Many financial data APIs (like Yahoo Finance) don't support CORS for browser requests. This lightweight Express server acts as a proxy, forwarding requests from the frontend to external APIs.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check with version info |
| `GET /api/version` | Build version information |
| `GET /api/yahoo/chart/:symbol` | Yahoo Finance chart/quote data |
| `GET /api/yahoo/search?q=` | Yahoo Finance symbol search |

## Running Locally

```bash
npm install
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `CORS_ORIGIN` | Allowed CORS origin | * |
| `BUILD_VERSION` | Application version | 0.1.0 |
| `BUILD_COMMIT` | Git commit hash | unknown |
| `BUILD_TIME` | Build timestamp | current time |

## Docker

The backend is typically run via docker-compose alongside the frontend. See the root `docker-compose.yml` for configuration.
