"""Round-trip tests for the Qdrant wrapper. Skipped if Qdrant is unreachable."""

import os
import time
import uuid

import pytest

pytest.importorskip("qdrant_client")

from app import vector_store as vs  # noqa: E402


def _qdrant_up() -> bool:
    try:
        return vs.health()["ok"] is True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _qdrant_up(), reason="Qdrant not reachable")


def _rand_vec(dim: int = 768):
    import random

    random.seed(42)
    raw = [random.random() for _ in range(dim)]
    norm = sum(x * x for x in raw) ** 0.5
    return [x / norm for x in raw]


def test_ensure_collections_idempotent():
    vs.ensure_collections()
    vs.ensure_collections()
    cols = {c.name for c in vs.client().get_collections().collections}
    for name in vs.COLLECTIONS:
        assert name in cols


def test_upsert_search_roundtrip():
    vs.ensure_collections()
    pid = str(uuid.uuid4())
    now = int(time.time())
    vec = _rand_vec()
    sym = f"RT-{uuid.uuid4().hex[:8].upper()}"
    vs.upsert(
        "news",
        [{"id": pid, "vector": vec, "payload": {"symbol": sym, "published_at": now, "source": "pytest"}}],
    )
    hits = vs.search("news", vec, k=1, flt={"symbol": sym})
    assert hits and hits[0]["id"] == pid
    assert hits[0]["payload"]["source"] == "pytest"


def test_lookahead_range_filter():
    """A published_at < decision_ts filter must exclude future items."""
    vs.ensure_collections()
    past = int(time.time()) - 3600
    future = int(time.time()) + 3600
    decision = int(time.time())
    sym = f"LA-{uuid.uuid4().hex[:6]}"
    vec = _rand_vec()
    vs.upsert(
        "news",
        [
            {"vector": vec, "payload": {"symbol": sym, "published_at": past, "source": "pytest"}},
            {"vector": vec, "payload": {"symbol": sym, "published_at": future, "source": "pytest"}},
        ],
    )
    hits = vs.search("news", vec, k=10, flt={"symbol": sym, "published_at": {"lt": decision}})
    assert len(hits) == 1
    assert hits[0]["payload"]["published_at"] == past
