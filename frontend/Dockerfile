# Multi-stage Dockerfile for DayTrader Frontend
# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app

# Accept build arguments for build info (defaults read from package.json in vite.config.ts)
ARG BUILD_VERSION=1.39.0
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown

# Accept API keys as build arguments (Vite embeds them at build time)
ARG VITE_API_BASE_URL=/api
ARG VITE_FINNHUB_API_KEY
ARG VITE_ALPHA_VANTAGE_API_KEY
ARG VITE_TWELVE_DATA_API_KEY
ARG VITE_NEWS_API_KEY
ARG VITE_PREFERRED_DATA_SOURCE=yahoo

# Set environment variables for Vite build
ENV BUILD_VERSION=${BUILD_VERSION}
ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_FINNHUB_API_KEY=${VITE_FINNHUB_API_KEY}
ENV VITE_ALPHA_VANTAGE_API_KEY=${VITE_ALPHA_VANTAGE_API_KEY}
ENV VITE_TWELVE_DATA_API_KEY=${VITE_TWELVE_DATA_API_KEY}
ENV VITE_NEWS_API_KEY=${VITE_NEWS_API_KEY}
ENV VITE_PREFERRED_DATA_SOURCE=${VITE_PREFERRED_DATA_SOURCE}

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine AS production

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
