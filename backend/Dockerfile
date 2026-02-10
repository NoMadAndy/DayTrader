# DayTrader Backend - Production Dockerfile
FROM node:20-alpine

# Build arguments for version info
ARG BUILD_VERSION=1.37.7
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME

# Set environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    BUILD_VERSION=${BUILD_VERSION} \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_TIME=${BUILD_TIME}

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy source code
COPY src/ ./src/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the server
CMD ["node", "src/index.js"]
