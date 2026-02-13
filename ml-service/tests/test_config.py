"""Tests for ML Service configuration."""

from app.config import Settings


class TestMLServiceConfig:
    """Test ML Service config defaults."""

    def test_version(self):
        settings = Settings()
        assert settings.version == "1.40.0"

    def test_service_name(self):
        settings = Settings()
        assert settings.service_name == "daytrader-ml-service"

    def test_default_model_type(self):
        settings = Settings()
        assert settings.default_model_type in ("lstm", "transformer")

    def test_sequence_length(self):
        settings = Settings()
        assert settings.sequence_length == 60

    def test_forecast_days(self):
        settings = Settings()
        assert settings.forecast_days == 14

    def test_transformer_defaults(self):
        settings = Settings()
        assert settings.transformer_d_model == 128
        assert settings.transformer_n_heads == 4
        assert settings.transformer_n_layers == 3
        assert settings.transformer_d_ff == 256
        assert settings.transformer_dropout == 0.1
