"""Tests for AgentConfig — configuration model for RL agents."""

import pytest
from app.agent_config import AgentConfig, PRESET_AGENT_CONFIGS as AGENT_PRESETS


class TestAgentConfigDefaults:
    """Test default configuration values."""

    def test_default_short_selling_disabled(self):
        cfg = AgentConfig(name="test")
        assert cfg.enable_short_selling is False

    def test_default_slippage_model(self):
        cfg = AgentConfig(name="test")
        assert cfg.slippage_model == "proportional"

    def test_default_slippage_bps(self):
        cfg = AgentConfig(name="test")
        assert cfg.slippage_bps == 5.0

    def test_default_initial_balance(self):
        cfg = AgentConfig(name="test")
        assert cfg.initial_balance == 100000.0

    def test_custom_values(self):
        cfg = AgentConfig(
            name="custom",
            enable_short_selling=True,
            slippage_model="fixed",
            slippage_bps=10.0,
            initial_balance=50000.0,
        )
        assert cfg.enable_short_selling is True
        assert cfg.slippage_model == "fixed"
        assert cfg.slippage_bps == 10.0
        assert cfg.initial_balance == 50000.0


class TestPresets:
    """Test that all presets are valid AgentConfigs."""

    def test_presets_exist(self):
        assert len(AGENT_PRESETS) >= 4  # At least the 4 documented presets

    def test_all_presets_have_required_fields(self):
        for name, preset in AGENT_PRESETS.items():
            assert hasattr(preset, "name"), f"Preset {name} missing 'name'"
            assert hasattr(preset, "enable_short_selling"), f"Preset {name} missing 'enable_short_selling'"
            assert hasattr(preset, "slippage_model"), f"Preset {name} missing 'slippage_model'"
            assert hasattr(preset, "slippage_bps"), f"Preset {name} missing 'slippage_bps'"

    def test_presets_have_valid_slippage_models(self):
        valid_models = {"none", "fixed", "proportional", "volume"}
        for name, preset in AGENT_PRESETS.items():
            assert preset.slippage_model in valid_models, \
                f"Preset {name} has invalid slippage_model: {preset.slippage_model}"

    def test_presets_serializable(self):
        """Presets should be serializable to dict (for API responses)."""
        for name, preset in AGENT_PRESETS.items():
            d = preset.model_dump() if hasattr(preset, "model_dump") else preset.__dict__
            assert isinstance(d, dict)
            assert d["name"] == name
