"""
Sentence-embedding wrapper for RAG.

Uses BAAI/bge-base-en-v1.5 (768 dim) via sentence-transformers.
Device is configurable to avoid competing with FinBERT for 8 GB VRAM.

ENV:
    EMBEDDER_MODEL        default "BAAI/bge-base-en-v1.5"
    EMBEDDER_DEVICE       "cpu" | "cuda" | "auto"  (default "cpu")
    EMBEDDER_BATCH_SIZE   default 32
"""

from __future__ import annotations

import logging
import os
import threading
from typing import List, Optional

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 768
_MODEL_NAME = os.environ.get("EMBEDDER_MODEL", "BAAI/bge-base-en-v1.5")
_DEVICE_PREF = os.environ.get("EMBEDDER_DEVICE", "cpu").lower()
_BATCH_SIZE = int(os.environ.get("EMBEDDER_BATCH_SIZE", "32"))

_model = None
_device: Optional[str] = None
_lock = threading.Lock()


def _resolve_device() -> str:
    if _DEVICE_PREF == "cpu":
        return "cpu"
    try:
        import torch

        if _DEVICE_PREF == "cuda":
            return "cuda" if torch.cuda.is_available() else "cpu"
        # auto
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _load():
    global _model, _device
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model
        from sentence_transformers import SentenceTransformer

        _device = _resolve_device()
        logger.info("Loading embedder model=%s device=%s", _MODEL_NAME, _device)
        _model = SentenceTransformer(_MODEL_NAME, device=_device)
        return _model


def preload() -> bool:
    try:
        _load()
        return True
    except Exception as exc:
        logger.exception("Embedder preload failed: %s", exc)
        return False


def embed(texts: List[str]) -> List[List[float]]:
    """Return normalized embeddings (cosine-ready) for each text."""
    if not texts:
        return []
    model = _load()
    vectors = model.encode(
        texts,
        batch_size=_BATCH_SIZE,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return [v.tolist() for v in vectors]


def info() -> dict:
    return {
        "model": _MODEL_NAME,
        "device": _device or "unloaded",
        "dim": EMBEDDING_DIM,
        "batch_size": _BATCH_SIZE,
    }
