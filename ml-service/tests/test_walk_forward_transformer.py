"""
Regression test: Transformer walk-forward CV parity with LSTM.

Goal: confirm TransformerStockPredictor.train(use_walk_forward=True) runs a
3-fold purged CV, writes one training_history entry per (fold, epoch), and
surfaces per-fold results in model_metadata.fold_results without NaNs.
"""

from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from app.transformer_model import TransformerStockPredictor


def _synthetic_ohlcv(n: int = 320) -> list[dict]:
    """Smooth-trending OHLCV with mild noise so the tiny Transformer can learn."""
    rng = np.random.default_rng(42)
    t = np.arange(n)
    close = 100 + 0.05 * t + 2 * np.sin(t / 7) + rng.normal(0, 0.5, n)
    records = []
    for i, c in enumerate(close):
        o = c - rng.normal(0, 0.2)
        h = max(o, c) + abs(rng.normal(0, 0.3))
        lo = min(o, c) - abs(rng.normal(0, 0.3))
        records.append({
            "timestamp": 1_700_000_000_000 + i * 86_400_000,
            "open": float(o), "high": float(h), "low": float(lo), "close": float(c),
            "volume": 1_000_000 + int(rng.normal(0, 100_000)),
        })
    return records


def test_walk_forward_runs_three_folds():
    # Shrink the architecture via env vars so the unit test runs in <1 min.
    import os
    os.environ["ML_TRANSFORMER_D_MODEL"] = "32"
    os.environ["ML_TRANSFORMER_N_HEADS"] = "4"
    os.environ["ML_TRANSFORMER_N_LAYERS"] = "1"
    os.environ["ML_TRANSFORMER_D_FF"] = "64"
    os.environ["ML_TRANSFORMER_DROPOUT"] = "0.1"
    predictor = TransformerStockPredictor(symbol="SYN", use_cuda=False)
    data = _synthetic_ohlcv(320)
    # Small seq_len + forecast keeps runtime short enough for CI.
    result = predictor.train(
        data,
        epochs=3,
        learning_rate=1e-3,
        sequence_length=20,
        forecast_days=3,
        early_stopping_patience=5,
        use_walk_forward=True,
    )
    assert result["success"] is True
    fold_results = result.get("fold_results")
    assert isinstance(fold_results, list)
    # With 320 raw points, seq_len=20, fc_days=3 -> ~297 sequences; WF default
    # n_splits=3, min_train_ratio=0.5 gives 3 folds.
    assert len(fold_results) == 3, f"expected 3 folds, got {len(fold_results)}"
    for f in fold_results:
        assert np.isfinite(f["best_val_loss"]), f"non-finite val loss in fold {f}"
        assert f["train_size"] > 0
        assert f["val_size"] > 0

    # Training history must contain at least one row per fold and only finite numbers.
    fold_ids = {row["fold"] for row in result["history"]}
    assert fold_ids == {1, 2, 3}
    for row in result["history"]:
        assert np.isfinite(row["train_loss"])
        assert np.isfinite(row["val_loss"])

    # model_metadata carries the WF flag + aggregate avg.
    assert predictor.model_metadata["walk_forward"] is True
    assert "avg_val_loss" in predictor.model_metadata
    assert np.isfinite(predictor.model_metadata["avg_val_loss"])


def test_walk_forward_split_matches_lstm_contract():
    """Parity: TransformerStockPredictor.walk_forward_split produces the same
    (train_slice, val_slice) tuples as StockPredictor for identical args."""
    from app.model import StockPredictor
    a = list(TransformerStockPredictor.walk_forward_split(300, n_splits=3, gap=5, min_train_ratio=0.5))
    b = list(StockPredictor.walk_forward_split(300, n_splits=3, gap=5, min_train_ratio=0.5))
    assert a == b, "Transformer and LSTM walk_forward_split must yield identical folds"
