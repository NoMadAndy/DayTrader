"""Smoke tests for the bge-base embedder wrapper."""

import os

import pytest

pytest.importorskip("sentence_transformers")

from app import embeddings  # noqa: E402


def test_info_defaults():
    info = embeddings.info()
    assert info["dim"] == 768
    assert info["model"].startswith("BAAI/")


def test_embed_empty():
    assert embeddings.embed([]) == []


@pytest.mark.slow
def test_embed_shape_and_determinism():
    texts = ["Apple beats earnings", "Tesla misses delivery targets"]
    v1 = embeddings.embed(texts)
    v2 = embeddings.embed(texts)
    assert len(v1) == len(v2) == 2
    assert all(len(v) == 768 for v in v1)
    # Deterministic on same device
    for a, b in zip(v1[0], v2[0]):
        assert abs(a - b) < 1e-5


@pytest.mark.slow
def test_embed_normalized():
    vec = embeddings.embed(["hello world"])[0]
    norm = sum(x * x for x in vec) ** 0.5
    assert abs(norm - 1.0) < 1e-3
