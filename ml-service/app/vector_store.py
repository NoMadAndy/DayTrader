"""
Qdrant wrapper with collection bootstrap + typed payload filters.

Collections:
    news    — news headlines/articles (symbol, published_at, url, ...)
    trades  — per-trade context snapshots
    signals — decision-time signal snapshots
    repo    — code / docs / changelog / todo chunks

ENV:
    QDRANT_URL   default "http://qdrant:6333"
    QDRANT_API_KEY optional
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict, Iterable, List, Optional

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from .embeddings import EMBEDDING_DIM

logger = logging.getLogger(__name__)

QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY") or None

COLLECTIONS = ("news", "trades", "signals", "repo")

_client: Optional[QdrantClient] = None


def client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=10.0)
    return _client


def ensure_collections() -> None:
    c = client()
    existing = {col.name for col in c.get_collections().collections}
    for name in COLLECTIONS:
        if name in existing:
            continue
        logger.info("Creating Qdrant collection %s", name)
        c.create_collection(
            collection_name=name,
            vectors_config=qm.VectorParams(size=EMBEDDING_DIM, distance=qm.Distance.COSINE),
        )
        # Index frequently-filtered fields
        if name == "news":
            c.create_payload_index(name, "symbol", qm.PayloadSchemaType.KEYWORD)
            c.create_payload_index(name, "published_at", qm.PayloadSchemaType.INTEGER)
            c.create_payload_index(name, "source", qm.PayloadSchemaType.KEYWORD)
        elif name == "trades":
            c.create_payload_index(name, "symbol", qm.PayloadSchemaType.KEYWORD)
            c.create_payload_index(name, "closed_at", qm.PayloadSchemaType.INTEGER)
        elif name == "signals":
            c.create_payload_index(name, "symbol", qm.PayloadSchemaType.KEYWORD)
            c.create_payload_index(name, "ts", qm.PayloadSchemaType.INTEGER)
        elif name == "repo":
            c.create_payload_index(name, "kind", qm.PayloadSchemaType.KEYWORD)
            c.create_payload_index(name, "path", qm.PayloadSchemaType.KEYWORD)


def upsert(
    collection: str,
    items: Iterable[Dict[str, Any]],
) -> int:
    """
    Items: [{id?: str, vector: [float], payload: {...}}, ...]
    Returns count upserted.
    """
    points = []
    count = 0
    for item in items:
        pid = item.get("id") or str(uuid.uuid4())
        points.append(qm.PointStruct(id=pid, vector=item["vector"], payload=item.get("payload", {})))
        count += 1
    if not points:
        return 0
    client().upsert(collection_name=collection, points=points)
    return count


def _build_filter(flt: Optional[Dict[str, Any]]) -> Optional[qm.Filter]:
    if not flt:
        return None
    must: List[qm.FieldCondition] = []
    for key, cond in flt.items():
        if isinstance(cond, dict) and any(k in cond for k in ("gt", "gte", "lt", "lte")):
            rng = qm.Range(
                gt=cond.get("gt"),
                gte=cond.get("gte"),
                lt=cond.get("lt"),
                lte=cond.get("lte"),
            )
            must.append(qm.FieldCondition(key=key, range=rng))
        elif isinstance(cond, (list, tuple)):
            must.append(qm.FieldCondition(key=key, match=qm.MatchAny(any=list(cond))))
        else:
            must.append(qm.FieldCondition(key=key, match=qm.MatchValue(value=cond)))
    return qm.Filter(must=must)


def search(
    collection: str,
    query_vector: List[float],
    k: int = 8,
    flt: Optional[Dict[str, Any]] = None,
    score_threshold: Optional[float] = None,
) -> List[Dict[str, Any]]:
    res = client().query_points(
        collection_name=collection,
        query=query_vector,
        limit=k,
        query_filter=_build_filter(flt),
        score_threshold=score_threshold,
        with_payload=True,
    )
    return [{"id": str(hit.id), "score": hit.score, "payload": hit.payload} for hit in res.points]


def count(collection: str, flt: Optional[Dict[str, Any]] = None) -> int:
    return client().count(collection_name=collection, count_filter=_build_filter(flt), exact=True).count


def health() -> Dict[str, Any]:
    try:
        cols = [c.name for c in client().get_collections().collections]
        return {"ok": True, "url": QDRANT_URL, "collections": cols}
    except Exception as exc:
        return {"ok": False, "url": QDRANT_URL, "error": str(exc)}
