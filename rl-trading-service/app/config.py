"""
Configuration for RL Trading Service
"""
import os
import torch
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional


class Settings(BaseSettings):
    """Application settings"""
    
    # Service info
    service_name: str = "daytrader-rl-trading-service"
    version: str = os.getenv("BUILD_VERSION", "1.12.0")
    commit: str = os.getenv("BUILD_COMMIT", "unknown")
    build_time: str = os.getenv("BUILD_TIME", "unknown")
    
    # API settings
    api_prefix: str = ""
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"
    
    # Model storage
    model_dir: str = os.getenv("MODEL_DIR", "/app/models")
    checkpoint_dir: str = os.getenv("CHECKPOINT_DIR", "/app/checkpoints")
    
    # Training defaults
    default_timesteps: int = int(os.getenv("DEFAULT_TIMESTEPS", "100000"))
    default_learning_rate: float = float(os.getenv("DEFAULT_LEARNING_RATE", "0.0003"))
    default_batch_size: int = int(os.getenv("DEFAULT_BATCH_SIZE", "64"))
    default_n_steps: int = int(os.getenv("DEFAULT_N_STEPS", "2048"))
    
    # Environment defaults
    default_lookback_window: int = int(os.getenv("DEFAULT_LOOKBACK_WINDOW", "60"))
    default_initial_balance: float = float(os.getenv("DEFAULT_INITIAL_BALANCE", "100000"))
    
    # CUDA settings
    use_cuda: bool = os.getenv("USE_CUDA", "true").lower() == "true"
    
    # Database
    database_url: Optional[str] = os.getenv("DATABASE_URL")
    
    # ML Service URL for getting predictions
    ml_service_url: str = os.getenv("ML_SERVICE_URL", "http://ml-service:8000")
    
    # Backend URL for historical data
    backend_url: str = os.getenv("BACKEND_URL", "http://backend:3001")
    
    @property
    def device(self) -> str:
        """Get the compute device (CUDA if available and enabled)"""
        if self.use_cuda and torch.cuda.is_available():
            return "cuda"
        return "cpu"
    
    @property
    def device_info(self) -> dict:
        """Get device information"""
        info = {
            "device": self.device,
            "cuda_available": torch.cuda.is_available(),
            "cuda_enabled": self.use_cuda,
        }
        if torch.cuda.is_available():
            info["cuda_device_name"] = torch.cuda.get_device_name(0)
            info["cuda_memory_total"] = f"{torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB"
            info["cuda_device_count"] = torch.cuda.device_count()
        return info
    
    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Ensure directories exist
os.makedirs(settings.model_dir, exist_ok=True)
os.makedirs(settings.checkpoint_dir, exist_ok=True)
