# Multi-stage Dockerfile for DayTrader Frontend
# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app

# Accept build arguments for build info (defaults read from package.json in vite.config.ts)
ARG BUILD_VERSION=1.43.4
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown

# Provider API keys leben jetzt serverseitig (siehe backend/src/index.js
# resolveProviderKey). Hier nur noch Build-Metadaten und nicht-sensitive Vite-Config.
ARG VITE_API_BASE_URL=/api
ARG VITE_PREFERRED_DATA_SOURCE=yahoo

ENV BUILD_VERSION=${BUILD_VERSION}
ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
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
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
