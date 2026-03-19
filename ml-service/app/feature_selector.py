"""
Automatic Feature Selection / Pruning for Time-Series Prediction

Reduces redundant and uninformative features before model training to:
  1. Speed up training (fewer input dimensions)
  2. Reduce overfitting (less noise)
  3. Improve interpretability

Pipeline
--------
1. Remove near-zero variance features
2. Remove highly correlated feature pairs (keep the one with higher MI score)
3. Rank remaining features by mutual information with the target
4. Keep top-K features (or all that pass the filters when max_features is None)
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.feature_selection import mutual_info_regression

logger = logging.getLogger(__name__)


class FeatureSelector:
    """
    Automatic feature selection for time-series prediction.

    Args:
        correlation_threshold: Drop one of any pair with |corr| ≥ this. (default 0.95)
        variance_threshold:    Drop features whose normalised variance < this. (default 0.001)
        max_features:          Keep at most this many features after filtering.
                               ``None`` keeps all that pass the filters.
        always_keep:           Feature names that are never removed regardless of
                               their score.  Defaults to ['close', 'volume'].
    """

    def __init__(
        self,
        correlation_threshold: float = 0.95,
        variance_threshold: float = 0.001,
        max_features: Optional[int] = None,
        always_keep: Optional[List[str]] = None,
    ) -> None:
        self.correlation_threshold = correlation_threshold
        self.variance_threshold = variance_threshold
        self.max_features = max_features
        self.always_keep: List[str] = always_keep if always_keep is not None else ["close", "volume"]

        self.selected_features_: Optional[List[str]] = None
        self.feature_scores_: Optional[Dict[str, float]] = None
        self.removed_features_: Optional[Dict[str, str]] = None  # feature → reason

    # ------------------------------------------------------------------
    # Fit
    # ------------------------------------------------------------------

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        feature_names: List[str],
    ) -> "FeatureSelector":
        """
        Analyse features and decide which to keep.

        Must be called with **training data only** to avoid leakage.

        Args:
            X:             Feature matrix (n_samples, n_features).
            y:             Target values (n_samples,).
            feature_names: Column names corresponding to X's columns.
        """
        if X.shape[0] == 0 or X.shape[1] == 0:
            logger.warning("FeatureSelector.fit: empty feature matrix — keeping all features")
            self.selected_features_ = list(feature_names)
            self.feature_scores_ = {f: 0.0 for f in feature_names}
            self.removed_features_ = {}
            return self

        n_features = X.shape[1]
        if len(feature_names) != n_features:
            raise ValueError(
                f"feature_names length ({len(feature_names)}) != X columns ({n_features})"
            )

        removed: Dict[str, str] = {}
        keep_mask = np.ones(n_features, dtype=bool)

        # ---- Step 1: Near-zero variance --------------------------------
        variances = X.var(axis=0)
        # Normalise variance by the feature's range to make threshold scale-agnostic
        ranges = X.max(axis=0) - X.min(axis=0)  # peak-to-peak (max - min) per column
        with np.errstate(divide="ignore", invalid="ignore"):
            norm_var = np.where(ranges > 0, variances / (ranges ** 2), 0.0)

        for i, fname in enumerate(feature_names):
            if fname in self.always_keep:
                continue
            if norm_var[i] < self.variance_threshold:
                keep_mask[i] = False
                removed[fname] = f"near-zero variance ({norm_var[i]:.6f})"
                logger.debug(f"FeatureSelector: removing '{fname}' — {removed[fname]}")

        # ---- Step 2: Mutual information --------------------------------
        surviving_idx = [i for i in range(n_features) if keep_mask[i]]
        if len(surviving_idx) == 0:
            surviving_idx = list(range(n_features))
            keep_mask[:] = True

        X_surviving = X[:, surviving_idx]
        surviving_names = [feature_names[i] for i in surviving_idx]

        try:
            mi_scores = mutual_info_regression(
                X_surviving, y, n_neighbors=5, random_state=42
            )
        except Exception as exc:
            logger.warning(f"FeatureSelector: MI computation failed ({exc}), using variance rank")
            mi_scores = np.array([norm_var[i] for i in surviving_idx])

        score_map: Dict[str, float] = {
            name: float(score) for name, score in zip(surviving_names, mi_scores)
        }

        # ---- Step 3: High-correlation pairs ----------------------------
        if len(surviving_idx) > 1:
            try:
                corr_matrix = np.corrcoef(X_surviving.T)
            except Exception:
                corr_matrix = np.eye(len(surviving_idx))

            # Upper-triangle pairs
            for i in range(len(surviving_idx)):
                if not keep_mask[surviving_idx[i]]:
                    continue
                for j in range(i + 1, len(surviving_idx)):
                    if not keep_mask[surviving_idx[j]]:
                        continue
                    if abs(corr_matrix[i, j]) >= self.correlation_threshold:
                        # Drop the one with the lower MI score
                        fi = surviving_names[i]
                        fj = surviving_names[j]
                        if fi in self.always_keep:
                            drop, keep_name = fj, fi
                        elif fj in self.always_keep:
                            drop, keep_name = fi, fj
                        elif score_map.get(fi, 0) >= score_map.get(fj, 0):
                            drop, keep_name = fj, fi
                        else:
                            drop, keep_name = fi, fj

                        global_idx = surviving_idx[surviving_names.index(drop)]
                        keep_mask[global_idx] = False
                        removed[drop] = (
                            f"correlated with '{keep_name}' "
                            f"(|r|={abs(corr_matrix[i, j]):.3f})"
                        )
                        logger.debug(f"FeatureSelector: removing '{drop}' — {removed[drop]}")

        # ---- Step 4: Top-K selection -----------------------------------
        selected = [feature_names[i] for i in range(n_features) if keep_mask[i]]

        # Guarantee always_keep columns are in the selected list
        for fname in self.always_keep:
            if fname in feature_names and fname not in selected:
                selected.append(fname)
                removed.pop(fname, None)

        if self.max_features is not None and len(selected) > self.max_features:
            # Sort by MI score descending; keep always_keep at the top
            protected = [f for f in selected if f in self.always_keep]
            ranked = sorted(
                [f for f in selected if f not in self.always_keep],
                key=lambda f: score_map.get(f, 0.0),
                reverse=True,
            )
            n_extra = max(0, self.max_features - len(protected))
            dropped = ranked[n_extra:]
            for fname in dropped:
                removed[fname] = f"max_features={self.max_features} limit"
            selected = protected + ranked[:n_extra]

        self.selected_features_ = selected
        self.feature_scores_ = score_map
        self.removed_features_ = removed

        logger.info(
            f"FeatureSelector: keeping {len(selected)}/{n_features} features "
            f"(removed {len(removed)})"
        )
        return self

    # ------------------------------------------------------------------
    # Transform
    # ------------------------------------------------------------------

    def transform(
        self,
        X: np.ndarray,
        feature_names: List[str],
    ) -> Tuple[np.ndarray, List[str]]:
        """
        Apply the fitted selection to *X*.

        Returns:
            (filtered_X, filtered_feature_names)
        """
        if self.selected_features_ is None:
            raise RuntimeError("FeatureSelector.fit() must be called before transform()")

        selected_indices = [
            i for i, name in enumerate(feature_names) if name in self.selected_features_
        ]
        if not selected_indices:
            # Safety: return unchanged if nothing survived
            return X, feature_names

        filtered_X = X[:, selected_indices]
        filtered_names = [feature_names[i] for i in selected_indices]
        return filtered_X, filtered_names

    def fit_transform(
        self,
        X: np.ndarray,
        y: np.ndarray,
        feature_names: List[str],
    ) -> Tuple[np.ndarray, List[str]]:
        """Fit and transform in one step."""
        self.fit(X, y, feature_names)
        return self.transform(X, feature_names)

    # ------------------------------------------------------------------
    # Reporting
    # ------------------------------------------------------------------

    def get_report(self) -> dict:
        """Return a human-readable summary of feature selection results."""
        if self.selected_features_ is None:
            return {"error": "FeatureSelector not yet fitted"}

        return {
            "selected_features": self.selected_features_,
            "n_selected": len(self.selected_features_),
            "removed_features": self.removed_features_ or {},
            "n_removed": len(self.removed_features_ or {}),
            "feature_scores": {
                k: round(v, 6)
                for k, v in (self.feature_scores_ or {}).items()
            },
        }
