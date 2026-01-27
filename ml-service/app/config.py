"""
Configuration for ML Service
"""
import os
import torch
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings"""
    
    # Service info
    service_name: str = "daytrader-ml-service"
    version: str = os.getenv("BUILD_VERSION", "1.12.0")
    commit: str = os.getenv("BUILD_COMMIT", "unknown")
    build_time: str = os.getenv("BUILD_TIME", "unknown")
    
    # API settings
    api_prefix: str = "/api/ml"
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"
    
    # Model settings
    model_dir: str = os.getenv("MODEL_DIR", "/app/models")
    sequence_length: int = int(os.getenv("SEQUENCE_LENGTH", "60"))
    forecast_days: int = int(os.getenv("FORECAST_DAYS", "14"))
    
    # Training settings
    epochs: int = int(os.getenv("EPOCHS", "100"))
    batch_size: int = int(os.getenv("BATCH_SIZE", "32"))
    learning_rate: float = float(os.getenv("LEARNING_RATE", "0.001"))
    
    # CUDA settings
    use_cuda: bool = os.getenv("USE_CUDA", "true").lower() == "true"
    
    # FinBERT settings
    preload_finbert: bool = os.getenv("PRELOAD_FINBERT", "false").lower() == "true"
    
    @property
    def device(self) -> torch.device:
        """Get the compute device (CUDA if available and enabled)"""
        if self.use_cuda and torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")
    
    @property
    def device_info(self) -> dict:
        """Get device information"""
        info = {
            "device": str(self.device),
            "cuda_available": torch.cuda.is_available(),
            "cuda_enabled": self.use_cuda,
        }
        if torch.cuda.is_available():
            info["cuda_device_name"] = torch.cuda.get_device_name(0)
            info["cuda_device_count"] = torch.cuda.device_count()
            info["cuda_memory_total"] = f"{torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB"
        return info
    
    class Config:
        env_file = ".env"


settings = Settings()
