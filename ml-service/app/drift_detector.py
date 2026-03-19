"""
Concept Drift Detector

Monitors per-symbol prediction accuracy over time and flags when performance
degrades enough to warrant retraining (concept drift).

Algorithm
---------
For each symbol we maintain a rolling history of (predicted_price, actual_price)
pairs.  We split this history into a "baseline" half and a "recent" half and
compare the Mean Absolute Percentage Error (MAPE) of both windows.

If  recent_MAPE / baseline_MAPE  ≥  threshold (default 1.5, i.e. 50% worse)
**and** the recent window has at least *min_samples* observations, drift is
flagged and a retrain is recommended.

We also track directional accuracy (correctly predicting up/down) for both
windows as a supplementary signal.
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class DriftDetector:
    """
    Detects concept drift by monitoring prediction errors over time.

    Args:
        window_size:  Rolling window of predictions to store per symbol.
        threshold:    Trigger retrain when recent_MAPE / baseline_MAPE ≥ this.
        min_samples:  Minimum number of predictions before drift is checked.
    """

    def __init__(
        self,
        window_size: int = 30,
        threshold: float = 1.5,
        min_samples: int = 10,
    ) -> None:
        self.window_size = window_size
        self.threshold = threshold
        self.min_samples = min_samples
        # symbol → list of {predicted, actual, timestamp}
        self._history: Dict[str, List[dict]] = {}

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------

    def record_prediction(
        self,
        symbol: str,
        predicted_price: float,
        actual_price: float,
        timestamp: Optional[str] = None,
    ) -> None:
        """Record a single prediction–actual pair for *symbol*."""
        symbol = symbol.upper()
        if symbol not in self._history:
            self._history[symbol] = []

        self._history[symbol].append(
            {
                "predicted": predicted_price,
                "actual": actual_price,
                "timestamp": timestamp or datetime.now().isoformat(),
            }
        )

        # Keep only the most recent *window_size* entries
        if len(self._history[symbol]) > self.window_size:
            self._history[symbol] = self._history[symbol][-self.window_size :]

        logger.debug(
            f"DriftDetector: recorded prediction for {symbol} "
            f"(predicted={predicted_price:.2f}, actual={actual_price:.2f})"
        )

    # ------------------------------------------------------------------
    # Drift check
    # ------------------------------------------------------------------

    @staticmethod
    def _mape(records: List[dict]) -> float:
        """Mean Absolute Percentage Error for a list of records."""
        if not records:
            return 0.0
        errors = [
            abs(r["predicted"] - r["actual"]) / max(abs(r["actual"]), 1e-8)
            for r in records
        ]
        return float(sum(errors) / len(errors))

    @staticmethod
    def _direction_accuracy(records: List[dict]) -> float:
        """Fraction of records where predicted direction matches actual direction."""
        if len(records) < 2:
            return 1.0
        correct = 0
        for i in range(1, len(records)):
            pred_dir = records[i]["predicted"] - records[i - 1]["predicted"]
            actual_dir = records[i]["actual"] - records[i - 1]["actual"]
            if pred_dir * actual_dir > 0:
                correct += 1
        return correct / (len(records) - 1)

    def check_drift(self, symbol: str) -> dict:
        """
        Check if concept drift is detected for *symbol*.

        Returns a dict with keys:
          drift_detected, should_retrain, reason, metrics
        """
        symbol = symbol.upper()
        history = self._history.get(symbol, [])
        n = len(history)

        # Default "no data" response
        default_metrics = {
            "baseline_mape": 0.0,
            "recent_mape": 0.0,
            "error_ratio": 1.0,
            "n_predictions": n,
            "direction_accuracy_baseline": 1.0,
            "direction_accuracy_recent": 1.0,
        }

        if n < self.min_samples:
            return {
                "drift_detected": False,
                "should_retrain": False,
                "reason": f"Insufficient data ({n}/{self.min_samples} samples)",
                "metrics": default_metrics,
            }

        # Split into baseline (first half) and recent (second half)
        mid = n // 2
        baseline = history[:mid]
        recent = history[mid:]

        baseline_mape = self._mape(baseline)
        recent_mape = self._mape(recent)

        if baseline_mape < 1e-8:
            error_ratio = 1.0
        else:
            error_ratio = recent_mape / baseline_mape

        dir_acc_baseline = self._direction_accuracy(baseline)
        dir_acc_recent = self._direction_accuracy(recent)

        drift_detected = error_ratio >= self.threshold
        should_retrain = drift_detected

        if drift_detected:
            reason = (
                f"MAPE increased {error_ratio:.1f}x (baseline {baseline_mape*100:.1f}% "
                f"-> recent {recent_mape*100:.1f}%). Retraining recommended."
            )
            logger.warning(f"DriftDetector: drift detected for {symbol}: {reason}")
        else:
            reason = (
                f"Performance stable (error ratio {error_ratio:.2f} < threshold {self.threshold})"
            )

        return {
            "drift_detected": drift_detected,
            "should_retrain": should_retrain,
            "reason": reason,
            "metrics": {
                "baseline_mape": baseline_mape,
                "recent_mape": recent_mape,
                "error_ratio": error_ratio,
                "n_predictions": n,
                "direction_accuracy_baseline": dir_acc_baseline,
                "direction_accuracy_recent": dir_acc_recent,
            },
        }

    # ------------------------------------------------------------------
    # Bulk status & management
    # ------------------------------------------------------------------

    def get_all_status(self) -> Dict[str, dict]:
        """Return drift status for all tracked symbols."""
        return {symbol: self.check_drift(symbol) for symbol in self._history}

    def clear(self, symbol: Optional[str] = None) -> None:
        """Clear history for *symbol*, or all symbols if None."""
        if symbol is None:
            self._history.clear()
            logger.info("DriftDetector: cleared all history")
        else:
            symbol = symbol.upper()
            self._history.pop(symbol, None)
            logger.info(f"DriftDetector: cleared history for {symbol}")
