"""
FastAPI Application for ML Service

Provides REST API endpoints for:
- Training models on historical stock data
- Generating price predictions
- FinBERT-based news sentiment analysis
- Model management (save/load/delete)
- Health and status checks
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import asyncio
from contextlib import asynccontextmanager

from .config import settings
from .model import StockPredictor
from . import sentiment as finbert

# Store for active predictors
predictors: Dict[str, StockPredictor] = {}
training_status: Dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    print(f"Starting {settings.service_name} v{settings.version}")
    print(f"Device: {settings.device_info}")
    
    # Optionally preload FinBERT model
    if settings.preload_finbert:
        print("Preloading FinBERT model...")
        if finbert.preload_model():
            print("FinBERT model loaded successfully")
        else:
            print("FinBERT model loading deferred (will load on first request)")
    
    yield
    print("Shutting down ML Service")


app = FastAPI(
    title="DayTrader ML Service",
    description="LSTM-based stock price prediction and FinBERT sentiment analysis with CUDA acceleration",
    version=settings.version,
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== Pydantic Models ==============

class OHLCVData(BaseModel):
    """Single OHLCV data point"""
    timestamp: int = Field(..., description="Unix timestamp in milliseconds")
    open: float
    high: float
    low: float
    close: float
    volume: float


class TrainRequest(BaseModel):
    """Request to train a model"""
    symbol: str = Field(..., description="Stock symbol (e.g., AAPL)")
    data: List[OHLCVData] = Field(..., description="Historical OHLCV data")
    epochs: Optional[int] = Field(None, description="Training epochs")
    learning_rate: Optional[float] = Field(None, description="Learning rate")
    sequence_length: Optional[int] = Field(None, description="Sequence length for LSTM input")
    forecast_days: Optional[int] = Field(None, description="Number of days to forecast")
    use_cuda: Optional[bool] = Field(None, description="Force CUDA usage (requires GPU container)")


class PredictRequest(BaseModel):
    """Request for price prediction"""
    symbol: str = Field(..., description="Stock symbol")
    data: List[OHLCVData] = Field(..., description="Recent OHLCV data")


class PredictionResult(BaseModel):
    """Single prediction result"""
    date: str
    day: int
    predicted_price: float
    confidence: float
    change_pct: float


class PredictResponse(BaseModel):
    """Prediction response"""
    symbol: str
    current_price: float
    predictions: List[PredictionResult]
    model_info: dict
    generated_at: str


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    timestamp: str
    version: str
    commit: str
    build_time: str
    device_info: dict
    finbert_status: Optional[dict] = None


class TrainStatusResponse(BaseModel):
    """Training status response"""
    symbol: str
    status: str
    progress: Optional[float] = None
    message: Optional[str] = None
    result: Optional[dict] = None


# ============== Sentiment Models ==============

class SentimentRequest(BaseModel):
    """Request for sentiment analysis"""
    text: str = Field(..., description="Text to analyze (headline or summary)")


class SentimentBatchRequest(BaseModel):
    """Request for batch sentiment analysis"""
    texts: List[str] = Field(..., description="List of texts to analyze")
    

class SentimentResultModel(BaseModel):
    """Single sentiment analysis result"""
    text: str
    sentiment: str  # 'positive', 'negative', 'neutral'
    score: float  # -1 to 1
    confidence: float  # 0 to 1
    probabilities: Dict[str, float]


class SentimentResponse(BaseModel):
    """Response for single sentiment analysis"""
    success: bool
    result: Optional[SentimentResultModel] = None
    error: Optional[str] = None


class SentimentBatchResponse(BaseModel):
    """Response for batch sentiment analysis"""
    success: bool
    results: List[Optional[SentimentResultModel]]
    processed: int
    failed: int


# ============== Endpoints ==============

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": settings.version,
        "commit": settings.commit,
        "build_time": settings.build_time,
        "device_info": settings.device_info,
        "finbert_status": finbert.get_model_status()
    }


@app.get("/api/ml/version")
async def get_version():
    """Get service version and build info"""
    return {
        "service": settings.service_name,
        "version": settings.version,
        "commit": settings.commit,
        "build_time": settings.build_time,
        "device": settings.device_info
    }


@app.get("/api/ml/models")
async def list_models():
    """List all loaded models"""
    return {
        "models": [
            {
                "symbol": symbol,
                "is_trained": pred.is_trained,
                "metadata": pred.model_metadata if pred.is_trained else None
            }
            for symbol, pred in predictors.items()
        ]
    }


@app.get("/api/ml/models/{symbol}")
async def get_model_info(symbol: str):
    """Get info about a specific model"""
    symbol = symbol.upper()
    
    if symbol not in predictors:
        # Try to load from disk
        predictor = StockPredictor(symbol)
        if predictor.load():
            predictors[symbol] = predictor
        else:
            raise HTTPException(status_code=404, detail=f"Model not found for {symbol}")
    
    pred = predictors[symbol]
    return {
        "symbol": symbol,
        "is_trained": pred.is_trained,
        "metadata": pred.model_metadata,
        "device": str(pred.device)
    }


async def train_model_background(
    symbol: str, 
    data: List[dict], 
    epochs: int, 
    learning_rate: float,
    sequence_length: int,
    forecast_days: int,
    use_cuda: Optional[bool] = None
):
    """Background task for model training"""
    try:
        training_status[symbol] = {
            "status": "training",
            "progress": 0,
            "message": "Initializing training..."
        }
        
        # Create predictor with optional CUDA override
        predictor = StockPredictor(symbol, use_cuda=use_cuda)
        
        # Convert data
        ohlcv_data = [d for d in data]
        
        training_status[symbol]["message"] = f"Preparing data (device: {predictor.device})..."
        training_status[symbol]["progress"] = 10
        
        # Train with custom parameters
        result = predictor.train(
            ohlcv_data,
            epochs=epochs,
            learning_rate=learning_rate,
            sequence_length=sequence_length,
            forecast_days=forecast_days
        )
        
        training_status[symbol]["progress"] = 90
        training_status[symbol]["message"] = "Saving model..."
        
        # Save model
        predictor.save()
        
        # Store predictor
        predictors[symbol] = predictor
        
        training_status[symbol] = {
            "status": "completed",
            "progress": 100,
            "message": "Training completed successfully",
            "result": result
        }
        
    except Exception as e:
        training_status[symbol] = {
            "status": "failed",
            "progress": 0,
            "message": str(e),
            "result": None
        }


@app.post("/api/ml/train")
async def train_model(request: TrainRequest, background_tasks: BackgroundTasks):
    """
    Train a model on historical data
    
    Training happens in the background. Use /api/ml/train/{symbol}/status
    to check progress.
    """
    symbol = request.symbol.upper()
    
    # Use request params or fall back to settings defaults
    seq_length = request.sequence_length or settings.sequence_length
    fc_days = request.forecast_days or settings.forecast_days
    
    # Validate data
    min_data_points = seq_length + fc_days + 50
    if len(request.data) < min_data_points:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {min_data_points} data points for training (sequence_length={seq_length}, forecast_days={fc_days})"
        )
    
    # Check if already training
    if symbol in training_status and training_status[symbol].get("status") == "training":
        raise HTTPException(
            status_code=409,
            detail=f"Training already in progress for {symbol}"
        )
    
    # Convert to dict format
    data = [d.model_dump() for d in request.data]
    
    # Determine CUDA usage
    use_cuda = request.use_cuda
    device_info = "cuda" if use_cuda else ("cpu" if use_cuda is False else "auto")
    
    # Start training in background with all parameters
    background_tasks.add_task(
        train_model_background,
        symbol,
        data,
        request.epochs or settings.epochs,
        request.learning_rate or settings.learning_rate,
        seq_length,
        fc_days,
        use_cuda
    )
    
    training_status[symbol] = {
        "status": "starting",
        "progress": 0,
        "message": f"Training job queued (epochs={request.epochs or settings.epochs}, seq_len={seq_length}, forecast={fc_days}, device={device_info})"
    }
    
    return {
        "message": f"Training started for {symbol}",
        "status_url": f"/api/ml/train/{symbol}/status"
    }


@app.get("/api/ml/train/{symbol}/status", response_model=TrainStatusResponse)
async def get_training_status(symbol: str):
    """Get training status for a symbol"""
    symbol = symbol.upper()
    
    if symbol not in training_status:
        raise HTTPException(status_code=404, detail=f"No training job found for {symbol}")
    
    status = training_status[symbol]
    return {
        "symbol": symbol,
        **status
    }


@app.post("/api/ml/predict", response_model=PredictResponse)
async def predict(request: PredictRequest):
    """
    Generate price predictions for a symbol
    
    Requires a trained model. If model is not in memory, attempts to load from disk.
    """
    symbol = request.symbol.upper()
    
    # Get or load predictor
    if symbol not in predictors:
        predictor = StockPredictor(symbol)
        if not predictor.load():
            raise HTTPException(
                status_code=404,
                detail=f"No trained model found for {symbol}. Train a model first using /api/ml/train"
            )
        predictors[symbol] = predictor
    
    predictor = predictors[symbol]
    
    # Validate data
    if len(request.data) < settings.sequence_length:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {settings.sequence_length} data points for prediction"
        )
    
    # Convert to dict format
    data = [d.model_dump() for d in request.data]
    
    try:
        result = predictor.predict(data)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/ml/models/{symbol}")
async def delete_model(symbol: str):
    """Delete a model"""
    symbol = symbol.upper()
    
    import os
    model_path = os.path.join(settings.model_dir, f"{symbol}_model.pt")
    
    if symbol in predictors:
        del predictors[symbol]
    
    if os.path.exists(model_path):
        os.remove(model_path)
        return {"message": f"Model deleted for {symbol}"}
    
    raise HTTPException(status_code=404, detail=f"Model not found for {symbol}")


# ============== Sentiment Endpoints ==============

@app.get("/api/ml/sentiment/status")
async def get_sentiment_status():
    """Get FinBERT model status"""
    return finbert.get_model_status()


@app.post("/api/ml/sentiment/load")
async def load_sentiment_model():
    """Explicitly load the FinBERT model"""
    success = finbert.preload_model()
    if success:
        return {"message": "FinBERT model loaded successfully", "status": finbert.get_model_status()}
    else:
        raise HTTPException(status_code=500, detail="Failed to load FinBERT model")


@app.post("/api/ml/sentiment/analyze", response_model=SentimentResponse)
async def analyze_sentiment(request: SentimentRequest):
    """
    Analyze sentiment of a single text using FinBERT.
    
    The model will be loaded on first request if not already loaded.
    
    Returns sentiment (positive/negative/neutral), score (-1 to 1), and confidence.
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    result = finbert.analyze_sentiment(request.text)
    
    if result is None:
        status = finbert.get_model_status()
        return {
            "success": False,
            "result": None,
            "error": status.get("error", "Failed to analyze sentiment")
        }
    
    return {
        "success": True,
        "result": {
            "text": result.text,
            "sentiment": result.sentiment,
            "score": result.score,
            "confidence": result.confidence,
            "probabilities": result.probabilities
        }
    }


@app.post("/api/ml/sentiment/analyze/batch", response_model=SentimentBatchResponse)
async def analyze_sentiment_batch(request: SentimentBatchRequest):
    """
    Analyze sentiment of multiple texts in batch using FinBERT.
    
    More efficient than calling /analyze multiple times.
    Empty texts will return null in the results array.
    """
    if not request.texts:
        raise HTTPException(status_code=400, detail="Texts list cannot be empty")
    
    if len(request.texts) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 texts per batch")
    
    # Filter out empty texts and track indices
    valid_indices = []
    valid_texts = []
    for i, text in enumerate(request.texts):
        if text.strip():
            valid_indices.append(i)
            valid_texts.append(text)
    
    # Analyze valid texts
    results_list = finbert.analyze_batch(valid_texts)
    
    # Reconstruct full results list with None for empty texts
    full_results: List[Optional[SentimentResultModel]] = [None] * len(request.texts)
    failed_count = 0
    
    for i, result in enumerate(results_list):
        original_idx = valid_indices[i]
        if result is not None:
            full_results[original_idx] = SentimentResultModel(
                text=result.text,
                sentiment=result.sentiment,
                score=result.score,
                confidence=result.confidence,
                probabilities=result.probabilities
            )
        else:
            failed_count += 1
    
    return {
        "success": True,
        "results": full_results,
        "processed": len(valid_texts) - failed_count,
        "failed": failed_count + (len(request.texts) - len(valid_texts))
    }


# ============== Main ==============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
