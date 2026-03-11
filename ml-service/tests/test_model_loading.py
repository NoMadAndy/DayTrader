"""Tests for resilient model checkpoint loading helpers."""

import torch

from app.model import StockPredictor
from app.config import settings


class TestModelLoadingHelpers:
    """Validate checkpoint horizon resolution behavior."""

    def test_infer_output_size_from_state_dict(self):
        model_state = {
            "fc.3.bias": torch.zeros(28),
        }

        result = StockPredictor._infer_output_size_from_state(model_state)

        assert result == 28

    def test_resolve_forecast_days_prefers_state_dict_shape(self):
        save_dict = {
            "model_state": {"fc.3.bias": torch.zeros(28)},
            "metadata": {"forecast_days": 14},
            "config": {"forecast_days": 14},
        }

        result = StockPredictor._resolve_forecast_days(save_dict)

        assert result == 28

    def test_resolve_forecast_days_falls_back_to_defaults(self):
        save_dict = {
            "model_state": {},
            "metadata": {},
            "config": {},
        }

        result = StockPredictor._resolve_forecast_days(save_dict)

        assert result == settings.forecast_days
