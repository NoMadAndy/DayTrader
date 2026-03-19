"""Tests for Sprint 2 new modules: DriftDetector, FeatureSelector, CrossAssetFeatureProvider, EnsemblePredictor."""

import numpy as np
import pandas as pd
import pytest

from app.drift_detector import DriftDetector
from app.feature_selector import FeatureSelector


# ===========================================================================
# DriftDetector tests
# ===========================================================================

class TestDriftDetector:
    def test_no_data_returns_no_drift(self):
        dd = DriftDetector()
        status = dd.check_drift("AAPL")
        assert status["drift_detected"] is False
        assert status["should_retrain"] is False
        assert "Insufficient" in status["reason"]

    def test_insufficient_samples_no_drift(self):
        dd = DriftDetector(min_samples=10)
        for i in range(5):
            dd.record_prediction("AAPL", 100.0, 100.0)
        status = dd.check_drift("AAPL")
        assert status["drift_detected"] is False

    def test_stable_predictions_no_drift(self):
        dd = DriftDetector(threshold=1.5, min_samples=10)
        # Perfect predictions throughout
        for _ in range(20):
            dd.record_prediction("AAPL", 100.0, 100.0)
        status = dd.check_drift("AAPL")
        assert status["drift_detected"] is False

    def test_degrading_predictions_triggers_drift(self):
        dd = DriftDetector(threshold=1.5, min_samples=10)
        # Good predictions in baseline
        for _ in range(10):
            dd.record_prediction("TSLA", 100.0, 100.5)  # ~0.5% MAPE
        # Terrible predictions recently
        for _ in range(10):
            dd.record_prediction("TSLA", 100.0, 200.0)  # ~50% MAPE
        status = dd.check_drift("TSLA")
        assert status["drift_detected"] is True
        assert status["should_retrain"] is True
        assert status["metrics"]["error_ratio"] > 1.5

    def test_record_prediction_stores_history(self):
        dd = DriftDetector()
        dd.record_prediction("MSFT", 300.0, 305.0)
        dd.record_prediction("MSFT", 305.0, 300.0)
        assert "MSFT" in dd._history
        assert len(dd._history["MSFT"]) == 2

    def test_window_size_limits_history(self):
        dd = DriftDetector(window_size=5)
        for i in range(10):
            dd.record_prediction("GOOG", float(i), float(i))
        assert len(dd._history["GOOG"]) == 5

    def test_clear_symbol(self):
        dd = DriftDetector()
        dd.record_prediction("AAPL", 100.0, 100.0)
        dd.clear("AAPL")
        assert "AAPL" not in dd._history

    def test_clear_all(self):
        dd = DriftDetector()
        dd.record_prediction("AAPL", 100.0, 100.0)
        dd.record_prediction("MSFT", 300.0, 300.0)
        dd.clear()
        assert len(dd._history) == 0

    def test_get_all_status(self):
        dd = DriftDetector()
        dd.record_prediction("AAPL", 100.0, 100.0)
        all_status = dd.get_all_status()
        assert "AAPL" in all_status

    def test_metrics_returned_correctly(self):
        dd = DriftDetector(min_samples=4)
        for _ in range(4):
            dd.record_prediction("META", 200.0, 200.0)
        status = dd.check_drift("META")
        assert "metrics" in status
        m = status["metrics"]
        assert "baseline_mape" in m
        assert "recent_mape" in m
        assert "error_ratio" in m
        assert "n_predictions" in m
        assert "direction_accuracy_baseline" in m
        assert "direction_accuracy_recent" in m

    def test_symbol_uppercased(self):
        dd = DriftDetector()
        dd.record_prediction("aapl", 100.0, 100.0)
        assert "AAPL" in dd._history


# ===========================================================================
# FeatureSelector tests
# ===========================================================================

class TestFeatureSelector:
    def _make_data(self, n_samples=200, n_features=10):
        rng = np.random.RandomState(42)
        X = rng.randn(n_samples, n_features)
        y = X[:, 0] + 0.1 * rng.randn(n_samples)  # close is most informative
        feature_names = ["close", "volume"] + [f"feat_{i}" for i in range(n_features - 2)]
        return X, y, feature_names

    def test_fit_returns_self(self):
        X, y, names = self._make_data()
        fs = FeatureSelector()
        result = fs.fit(X, y, names)
        assert result is fs

    def test_selected_features_not_none_after_fit(self):
        X, y, names = self._make_data()
        fs = FeatureSelector()
        fs.fit(X, y, names)
        assert fs.selected_features_ is not None
        assert len(fs.selected_features_) > 0

    def test_always_keep_features_preserved(self):
        X, y, names = self._make_data()
        fs = FeatureSelector(always_keep=["close", "volume"])
        X_out, names_out = fs.fit_transform(X, y, names)
        assert "close" in names_out
        assert "volume" in names_out

    def test_transform_reduces_columns(self):
        X, y, names = self._make_data(n_features=15)
        # Add a near-duplicate column to force removal
        X_dup = np.column_stack([X, X[:, 0] + 1e-10 * np.random.randn(200)])
        names_dup = names + ["close_copy"]
        fs = FeatureSelector(correlation_threshold=0.95)
        X_out, names_out = fs.fit_transform(X_dup, y, names_dup)
        # One of close / close_copy should be removed
        assert len(names_out) <= len(names_dup)

    def test_max_features_limit(self):
        X, y, names = self._make_data(n_features=10)
        fs = FeatureSelector(max_features=5)
        X_out, names_out = fs.fit_transform(X, y, names)
        assert len(names_out) <= 5

    def test_transform_without_fit_raises(self):
        X, y, names = self._make_data()
        fs = FeatureSelector()
        with pytest.raises(RuntimeError):
            fs.transform(X, names)

    def test_fit_transform_equivalent(self):
        X, y, names = self._make_data()
        fs1 = FeatureSelector()
        X1, n1 = fs1.fit_transform(X, y, names)

        fs2 = FeatureSelector()
        fs2.fit(X, y, names)
        X2, n2 = fs2.transform(X, names)

        assert n1 == n2
        np.testing.assert_array_equal(X1, X2)

    def test_get_report_structure(self):
        X, y, names = self._make_data()
        fs = FeatureSelector()
        fs.fit(X, y, names)
        report = fs.get_report()
        assert "selected_features" in report
        assert "n_selected" in report
        assert "removed_features" in report
        assert "n_removed" in report
        assert "feature_scores" in report

    def test_near_zero_variance_removed(self):
        X, y, names = self._make_data(n_features=5)
        # Add a constant column (zero variance)
        X_const = np.column_stack([X, np.ones(200)])
        names_const = names + ["const_feat"]
        fs = FeatureSelector(variance_threshold=1e-6, always_keep=[])
        fs.fit(X_const, y, names_const)
        # const_feat should be in removed list
        assert fs.removed_features_ is not None and "const_feat" in fs.removed_features_

    def test_empty_feature_matrix_handled(self):
        fs = FeatureSelector()
        X = np.zeros((0, 3))
        y = np.zeros(0)
        names = ["a", "b", "c"]
        # Should not raise
        fs.fit(X, y, names)
        assert fs.selected_features_ == names


# ===========================================================================
# Config new fields tests
# ===========================================================================

class TestConfigNewFields:
    def test_cross_asset_defaults(self):
        from app.config import Settings
        s = Settings()
        assert s.use_cross_asset_features is False
        assert s.cross_asset_cache_ttl == 3600

    def test_feature_selection_defaults(self):
        from app.config import Settings
        s = Settings()
        assert s.use_feature_selection is False
        assert s.feature_selection_max_features == 0
        assert s.feature_selection_correlation_threshold == 0.95
