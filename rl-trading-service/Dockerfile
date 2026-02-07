# CPU Dockerfile for RL Trading Service
# Uses standard Python image for CPU-only inference

FROM python:3.11-slim

# Build arguments
ARG BUILD_VERSION=1.33.1
ARG BUILD_COMMIT=dev
ARG BUILD_TIME=unknown

# Set environment variables
ENV BUILD_VERSION=${BUILD_VERSION}
ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV USE_CUDA=false

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU version first (smaller image)
COPY requirements.txt .
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ /app/app/

# Create directories for models and checkpoints
RUN mkdir -p /app/models /app/checkpoints

# Expose port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')" || exit 1

# Run the service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
