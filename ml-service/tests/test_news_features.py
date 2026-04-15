"""End-to-end tests for the news redundancy feature.

Verifies the look-ahead guard (future articles never appear in result) and
that semantically similar articles collapse into a single cluster.
"""

import time
import uuid

import pytest

pytest.importorskip("qdrant_client")
pytest.importorskip("sentence_transformers")

from app import embeddings as rag_embeddings  # noqa: E402
from app import news_features as nf  # noqa: E402
from app import vector_store as vs  # noqa: E402


def _qdrant_up() -> bool:
    try:
        return vs.health()["ok"] is True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _qdrant_up(), reason="Qdrant not reachable")


def _ingest(symbol: str, items):
    vs.ensure_collections()
    texts = [text for text, _ in items]
    vectors = rag_embeddings.embed(texts)
    payload_items = [
        {
            "id": str(uuid.uuid4()),
            "vector": vec,
            "payload": {"symbol": symbol, "published_at": ts, "source": "pytest", "title": text},
        }
        for vec, (text, ts) in zip(vectors, items)
    ]
    vs.upsert("news", payload_items)


def test_lookahead_excludes_future_articles():
    sym = f"LATEST-{uuid.uuid4().hex[:6]}".upper()
    decision = int(time.time())
    _ingest(
        sym,
        [
            ("Company X reports record revenue", decision - 1800),
            ("Company X earnings smash forecasts", decision - 600),
            # Two future items must be ignored:
            ("Company X announces buyback (future)", decision + 3600),
            ("Company X CEO resigns (future)", decision + 7200),
        ],
    )
    res = nf.compute_news_redundancy(symbol=sym, decision_ts=decision, window_seconds=3600)
    assert res.total_articles == 2
    assert res.latest_published_at == decision - 600
    assert 0.0 <= res.redundancy <= 1.0


def test_clusters_collapse_similar_stories():
    sym = f"DUP-{uuid.uuid4().hex[:6]}".upper()
    decision = int(time.time())
    # Three near-duplicate phrasings of the same story + one unrelated story:
    _ingest(
        sym,
        [
            ("Apple beats Q2 earnings expectations", decision - 1800),
            ("Apple Q2 earnings exceed analyst estimates", decision - 1700),
            ("Apple's Q2 results top forecasts", decision - 1600),
            ("Federal Reserve holds rates steady", decision - 1500),
        ],
    )
    res = nf.compute_news_redundancy(
        symbol=sym, decision_ts=decision, window_seconds=3600, cluster_threshold=0.70
    )
    assert res.total_articles == 4
    # The three Apple-earnings paraphrases should collapse, the Fed story
    # stays separate → ≤ 2 unique clusters at this threshold.
    assert res.unique_clusters <= 2, f"expected ≤2 clusters, got {res.unique_clusters}"
    assert res.redundancy >= 0.5


def test_empty_window_returns_zeroes():
    sym = f"EMPTY-{uuid.uuid4().hex[:6]}".upper()
    decision = int(time.time())
    res = nf.compute_news_redundancy(symbol=sym, decision_ts=decision, window_seconds=3600)
    assert res.total_articles == 0
    assert res.unique_clusters == 0
    assert res.redundancy == 0.0
    assert res.cluster_weight == 0.0
    assert res.latest_published_at is None
