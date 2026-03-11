# ML Service README

# DayTrader ML Service

LSTM & Transformer-based stock price prediction and FinBERT sentiment analysis with CUDA/GPU acceleration.

## Features

- **LSTM Neural Network**: Multi-layer LSTM for time series forecasting
- **Transformer Model**: Multi-Head Self-Attention with Multi-Scale CNN for superior pattern recognition
- **FinBERT Sentiment**: Transformer-based financial sentiment analysis
- **Technical Indicators**: Automatically calculates 20+ indicators as features
- **CUDA Support**: GPU acceleration for fast training and inference
- **REST API**: FastAPI-based endpoints for training, prediction, and sentiment
- **Model Persistence**: Save/load trained models
- **Resilient Model Loading**: Incompatible checkpoints are skipped safely instead of crashing prediction requests
- **Dual-Model Coexistence**: LSTM and Transformer models can exist side-by-side per symbol

## Architecture

### LSTM (default)

```
Input (60 days of OHLCV + indicators)
          ↓
    [LSTM Layer 1] (128 hidden units)
          ↓
      [Dropout]
          ↓
    [LSTM Layer 2] (128 hidden units)
          ↓
      [Dropout]
          ↓
    [Dense Layer] (64 units, ReLU)
          ↓
      [Dropout]
          ↓
    [Output Layer] (14 days forecast)
```

### Transformer

```
Input (60 days of OHLCV + indicators)
          ↓
    [Multi-Scale CNN] (kernels 3,5,7,14)
          ↓
    [Linear Projection → d_model=128]
          ↓
    [Positional Encoding]
          ↓
    [Transformer Encoder × 3 layers]
      (4 attention heads, d_ff=256)
          ↓
    [Multi-Scale Aggregation]
      (global avg + last step + max pooling)
          ↓
    [FC Layers] (256→128→14)
          ↓
    [Output] (14 days forecast)
```

## Features Used

The model uses these technical indicators as input features:

- **Price Data**: OHLCV (Open, High, Low, Close, Volume)
- **Returns**: Daily and log returns
- **Moving Averages**: SMA/EMA ratios (5, 10, 20, 50 days)
- **RSI**: 14-day Relative Strength Index
- **MACD**: MACD line, signal, histogram
- **Bollinger Bands**: Width and position
- **Volume**: Volume ratio to 20-day average
- **Volatility**: 20-day rolling standard deviation
- **Momentum**: 5, 10, 20 day momentum

## API Endpoints

### Health Check
```
GET /health
```

### Train Model
```
POST /api/ml/train
{
  "symbol": "AAPL",
  "data": [...OHLCV data...],
  "epochs": 100,
  "learning_rate": 0.001
}
```

### Check Training Status
```
GET /api/ml/train/{symbol}/status
```

### Get Prediction
```
POST /api/ml/predict
{
  "symbol": "AAPL",
  "data": [...recent OHLCV data...]
}
```

### List Models
```
GET /api/ml/models
```

### Delete Model
```
DELETE /api/ml/models/{symbol}
```

### Sentiment Analysis

#### Get Status
```
GET /api/ml/sentiment/status
```

#### Analyze Single Text
```
POST /api/ml/sentiment/analyze
{
  "text": "Apple shares surge on strong earnings report"
}
```

Response:
```json
{
  "success": true,
  "result": {
    "sentiment": "positive",
    "score": 0.85,
    "confidence": 0.92,
    "probabilities": {
      "positive": 0.92,
      "negative": 0.03,
      "neutral": 0.05
    }
  }
}
```

#### Batch Analysis
```
POST /api/ml/sentiment/analyze/batch
{
  "texts": ["headline 1", "headline 2", ...]
}
```

## CUDA/GPU Requirements

For GPU acceleration:
- NVIDIA GPU with CUDA Compute Capability 3.5+
- NVIDIA Driver 525.60.13+
- CUDA 12.1
- cuDNN 8

The service automatically falls back to CPU if CUDA is not available.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_CUDA` | `auto` | GPU mode: `auto` (detect), `true` (force), `false` (CPU only) |
| `MODEL_DIR` | `/app/models` | Directory for saved models |
| `SEQUENCE_LENGTH` | `60` | Input sequence length (days) |
| `FORECAST_DAYS` | `14` | Prediction horizon (days) |
| `EPOCHS` | `100` | Default training epochs |
| `BATCH_SIZE` | `32` | Training batch size |
| `LEARNING_RATE` | `0.001` | Default learning rate |
| `PRELOAD_FINBERT` | `false` | Preload FinBERT model on startup |

## Running Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Run with uvicorn
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Docker

```bash
# Build with CUDA support
docker build -t daytrader-ml-service .

# Run with GPU
docker run --gpus all -p 8000:8000 daytrader-ml-service

# Run without GPU (CPU fallback)
docker run -e USE_CUDA=false -p 8000:8000 daytrader-ml-service
```
