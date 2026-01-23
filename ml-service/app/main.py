"""
FastAPI Application for ML Service

Provides REST API endpoints for:
- Training models on historical stock data
- Generating price predictions
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

# Store for active predictors
predictors: Dict[str, StockPredictor] = {}
training_status: Dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    print(f"Starting {settings.service_name} v{settings.version}")
    print(f"Device: {settings.device_info}")
    yield
    print("Shutting down ML Service")


app = FastAPI(
    title="DayTrader ML Service",
    description="LSTM-based stock price prediction with CUDA acceleration",
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


class TrainStatusResponse(BaseModel):
    """Training status response"""
    symbol: str
    status: str
    progress: Optional[float] = None
    message: Optional[str] = None
    result: Optional[dict] = None


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
        "device_info": settings.device_info
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


async def train_model_background(symbol: str, data: List[dict], epochs: int, learning_rate: float):
    """Background task for model training"""
    try:
        training_status[symbol] = {
            "status": "training",
            "progress": 0,
            "message": "Initializing training..."
        }
        
        predictor = StockPredictor(symbol)
        
        # Convert data
        ohlcv_data = [d for d in data]
        
        training_status[symbol]["message"] = "Preparing data..."
        training_status[symbol]["progress"] = 10
        
        # Train
        result = predictor.train(
            ohlcv_data,
            epochs=epochs,
            learning_rate=learning_rate
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
    
    # Validate data
    if len(request.data) < settings.sequence_length + settings.forecast_days + 50:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {settings.sequence_length + settings.forecast_days + 50} data points for training"
        )
    
    # Check if already training
    if symbol in training_status and training_status[symbol].get("status") == "training":
        raise HTTPException(
            status_code=409,
            detail=f"Training already in progress for {symbol}"
        )
    
    # Convert to dict format
    data = [d.model_dump() for d in request.data]
    
    # Start training in background
    background_tasks.add_task(
        train_model_background,
        symbol,
        data,
        request.epochs or settings.epochs,
        request.learning_rate or settings.learning_rate
    )
    
    training_status[symbol] = {
        "status": "starting",
        "progress": 0,
        "message": "Training job queued"
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


# ============== Main ==============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
