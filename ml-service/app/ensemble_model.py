"""
LSTM + Transformer Ensemble Predictor

Combines predictions from both model types using dynamic, loss-weighted
averaging.  When both models are available, the ensemble:
  - Weights each model's prediction by the inverse of its validation loss
    (lower loss → higher weight)
  - Boosts confidence when the models agree on direction; reduces it when
    they disagree.

The ensemble never trains its own model weights; it only loads existing
LSTM and Transformer checkpoints.
"""

import logging
from typing import List, Optional

from .model import StockPredictor
from .transformer_model import TransformerStockPredictor

logger = logging.getLogger(__name__)


class EnsemblePredictor:
    """
    Weighted ensemble of LSTM and Transformer models.

    Usage:
        predictor = EnsemblePredictor("AAPL")
        predictor.load()          # loads both sub-models from disk if available
        result = predictor.predict(ohlcv_data)

    At least one sub-model must be loaded (is_trained=True) before predict().
    """

    def __init__(self, symbol: str, use_cuda: Optional[bool] = None) -> None:
        self.symbol = symbol.upper()
        self.model_type = "ensemble"
        self._use_cuda = use_cuda

        self.lstm_predictor: Optional[StockPredictor] = None
        self.transformer_predictor: Optional[TransformerStockPredictor] = None

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def is_trained(self) -> bool:
        """True when at least one sub-model is available."""
        lstm_ok = self.lstm_predictor is not None and self.lstm_predictor.is_trained
        transformer_ok = (
            self.transformer_predictor is not None
            and self.transformer_predictor.is_trained
        )
        return lstm_ok or transformer_ok

    @property
    def model_metadata(self) -> dict:
        """Merged metadata from available sub-models."""
        meta: dict = {"model_type": "ensemble", "symbol": self.symbol}

        if self.lstm_predictor and self.lstm_predictor.is_trained:
            meta["lstm"] = self.lstm_predictor.model_metadata

        if self.transformer_predictor and self.transformer_predictor.is_trained:
            meta["transformer"] = self.transformer_predictor.model_metadata

        weights = self._compute_weights()
        meta["ensemble_weights"] = weights
        return meta

    @property
    def device(self):
        """Return device from whichever sub-model is available."""
        if self.lstm_predictor and self.lstm_predictor.is_trained:
            return self.lstm_predictor.device
        if self.transformer_predictor and self.transformer_predictor.is_trained:
            return self.transformer_predictor.device
        return "cpu"

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def load(self, path: Optional[str] = None) -> bool:
        """
        Try to load both LSTM and Transformer models from disk.

        Returns True when at least one model loaded successfully.
        *path* is ignored (models are always loaded from the default model
        directory based on the symbol).
        """
        lstm_ok = False
        transformer_ok = False

        # LSTM
        try:
            lstm = StockPredictor(self.symbol, use_cuda=self._use_cuda)
            if lstm.load():
                self.lstm_predictor = lstm
                lstm_ok = True
                logger.info(f"EnsemblePredictor: LSTM model loaded for {self.symbol}")
        except Exception as exc:
            logger.warning(f"EnsemblePredictor: LSTM load failed for {self.symbol}: {exc}")

        # Transformer
        try:
            transformer = TransformerStockPredictor(self.symbol, use_cuda=self._use_cuda)
            if transformer.load():
                self.transformer_predictor = transformer
                transformer_ok = True
                logger.info(
                    f"EnsemblePredictor: Transformer model loaded for {self.symbol}"
                )
        except Exception as exc:
            logger.warning(
                f"EnsemblePredictor: Transformer load failed for {self.symbol}: {exc}"
            )

        if lstm_ok and transformer_ok:
            logger.info(f"EnsemblePredictor: both models loaded for {self.symbol}")
        elif lstm_ok:
            logger.warning(
                f"EnsemblePredictor: only LSTM available for {self.symbol} (no Transformer)"
            )
        elif transformer_ok:
            logger.warning(
                f"EnsemblePredictor: only Transformer available for {self.symbol} (no LSTM)"
            )
        else:
            logger.error(f"EnsemblePredictor: no models could be loaded for {self.symbol}")

        return lstm_ok or transformer_ok

    # ------------------------------------------------------------------
    # Weighting helpers
    # ------------------------------------------------------------------

    def _compute_weights(self) -> dict:
        """Compute inverse-loss weights for available sub-models."""
        lstm_ok = self.lstm_predictor is not None and self.lstm_predictor.is_trained
        transformer_ok = (
            self.transformer_predictor is not None
            and self.transformer_predictor.is_trained
        )

        if lstm_ok and transformer_ok:
            lstm_val_loss = float(
                self.lstm_predictor.model_metadata.get("best_val_loss", 1.0) or 1.0
            )
            transformer_val_loss = float(
                self.transformer_predictor.model_metadata.get("best_val_loss", 1.0) or 1.0
            )
            # Avoid division by zero
            lstm_val_loss = max(lstm_val_loss, 1e-8)
            transformer_val_loss = max(transformer_val_loss, 1e-8)

            inv_lstm = 1.0 / lstm_val_loss
            inv_transformer = 1.0 / transformer_val_loss
            total = inv_lstm + inv_transformer

            return {
                "lstm": round(inv_lstm / total, 4),
                "transformer": round(inv_transformer / total, 4),
            }
        elif lstm_ok:
            return {"lstm": 1.0, "transformer": 0.0}
        else:
            return {"lstm": 0.0, "transformer": 1.0}

    # ------------------------------------------------------------------
    # Prediction
    # ------------------------------------------------------------------

    def predict(self, ohlcv_data: List[dict]) -> dict:
        """
        Generate ensemble price predictions.

        Weighting strategy:
        - Both models: weight by inverse validation loss (lower loss → higher weight)
        - One model only: use that model exclusively
        - Confidence: averaged confidence boosted/reduced by directional agreement
        """
        if not self.is_trained:
            raise ValueError(
                f"EnsemblePredictor for {self.symbol}: no models loaded. Call load() first."
            )

        lstm_ok = self.lstm_predictor is not None and self.lstm_predictor.is_trained
        transformer_ok = (
            self.transformer_predictor is not None
            and self.transformer_predictor.is_trained
        )

        # --- Single-model fallback ---
        if lstm_ok and not transformer_ok:
            logger.warning(
                f"EnsemblePredictor {self.symbol}: only LSTM available, using alone"
            )
            result = self.lstm_predictor.predict(ohlcv_data)
            result["model_type"] = "ensemble"
            result["ensemble_weights"] = {"lstm": 1.0, "transformer": 0.0}
            return result

        if transformer_ok and not lstm_ok:
            logger.warning(
                f"EnsemblePredictor {self.symbol}: only Transformer available, using alone"
            )
            result = self.transformer_predictor.predict(ohlcv_data)
            result["model_type"] = "ensemble"
            result["ensemble_weights"] = {"lstm": 0.0, "transformer": 1.0}
            return result

        # --- True ensemble path ---
        weights = self._compute_weights()
        lstm_weight = weights["lstm"]
        transformer_weight = weights["transformer"]

        lstm_result = self.lstm_predictor.predict(ohlcv_data)
        transformer_result = self.transformer_predictor.predict(ohlcv_data)

        lstm_preds = lstm_result["predictions"]
        transformer_preds = transformer_result["predictions"]

        # Align prediction length (take minimum to avoid index errors)
        n_preds = min(len(lstm_preds), len(transformer_preds))

        current_price = lstm_result["current_price"]

        ensemble_predictions = []
        for i in range(n_preds):
            lp = lstm_preds[i]["predicted_price"]
            tp = transformer_preds[i]["predicted_price"]
            lc = lstm_preds[i]["confidence"]
            tc = transformer_preds[i]["confidence"]

            # Weighted average price
            ensemble_price = lstm_weight * lp + transformer_weight * tp

            # Agreement bonus: how closely do the two prices agree?
            # Use mean of the two prices as denominator so both positive/negative
            # prices are handled correctly.
            denom = (abs(lp) + abs(tp)) / 2.0
            denom = max(denom, 1e-8)
            price_agreement = 1.0 - abs(lp - tp) / denom
            price_agreement = max(0.0, min(1.0, price_agreement))

            # Average confidence, boosted when models agree
            avg_confidence = lstm_weight * lc + transformer_weight * tc
            ensemble_confidence = avg_confidence * (0.7 + 0.3 * price_agreement)
            ensemble_confidence = max(0.3, min(0.95, ensemble_confidence))

            change_pct = (ensemble_price - current_price) / current_price * 100

            ensemble_predictions.append(
                {
                    "date": lstm_preds[i]["date"],
                    "day": i + 1,
                    "predicted_price": float(ensemble_price),
                    "confidence": float(ensemble_confidence),
                    "change_pct": float(change_pct),
                }
            )

        logger.info(
            f"EnsemblePredictor {self.symbol}: combined {n_preds} predictions "
            f"(lstm_w={lstm_weight:.3f}, transformer_w={transformer_weight:.3f})"
        )

        return {
            "symbol": self.symbol,
            "current_price": current_price,
            "predictions": ensemble_predictions,
            "model_info": self.model_metadata,
            "generated_at": lstm_result["generated_at"],
            "model_type": "ensemble",
            "ensemble_weights": weights,
        }
