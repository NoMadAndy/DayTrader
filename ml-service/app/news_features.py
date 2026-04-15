"""
News-cluster features derived from the Qdrant `news` collection.

Computes per-symbol news redundancy and freshness-decayed cluster count for a
given decision timestamp.

CRITICAL: every query MUST filter `published_at < decision_ts` to prevent
look-ahead bias when used in signal aggregation or backtests.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import List, Optional

from . import vector_store as rag_store

logger = logging.getLogger(__name__)

import os

DEFAULT_WINDOW_SECONDS = int(os.environ.get("NEWS_REDUNDANCY_WINDOW_SECONDS", str(6 * 3600)))
DEFAULT_CLUSTER_THRESHOLD = float(os.environ.get("NEWS_CLUSTER_THRESHOLD", "0.75"))
DEFAULT_DECAY_TAU_SECONDS = float(os.environ.get("NEWS_DECAY_TAU_SECONDS", str(6 * 3600)))


@dataclass
class NewsRedundancy:
    symbol: str
    decision_ts: int
    window_seconds: int
    total_articles: int
    unique_clusters: int
    redundancy: float          # 1 - unique/total, in [0,1]; 0 when no articles
    cluster_weight: float      # sum_clusters exp(-(decision_ts - cluster_latest_ts)/tau)
    latest_published_at: Optional[int]


def _greedy_cluster(points: List[dict], threshold: float) -> List[List[int]]:
    """
    Single-pass greedy clustering of already-fetched points by cosine similarity
    of their embeddings. Inputs are expected to be cosine-normalised (bge-base
    embeddings are unit vectors) so dot product == cosine similarity.

    Returns: list of clusters, each a list of indices into `points`.
    """
    clusters: List[List[int]] = []
    centroids: List[List[float]] = []  # representative vector per cluster
    for idx, p in enumerate(points):
        vec = p.get("vector")
        if vec is None:
            # If vectors aren't returned (with_vectors=False), fall back to
            # treating each item as its own cluster — caller is responsible
            # for asking with_vectors=True.
            clusters.append([idx])
            centroids.append([])
            continue
        assigned = False
        for ci, centroid in enumerate(centroids):
            if not centroid:
                continue
            sim = sum(a * b for a, b in zip(vec, centroid))
            if sim >= threshold:
                clusters[ci].append(idx)
                assigned = True
                break
        if not assigned:
            clusters.append([idx])
            centroids.append(list(vec))
    return clusters


def compute_news_redundancy(
    symbol: str,
    decision_ts: int,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
    cluster_threshold: float = DEFAULT_CLUSTER_THRESHOLD,
    decay_tau_seconds: float = DEFAULT_DECAY_TAU_SECONDS,
    max_articles: int = 200,
) -> NewsRedundancy:
    """
    Pull news for `symbol` published in [decision_ts - window, decision_ts) and
    return cluster-based redundancy + freshness-decayed cluster weight.
    """
    if not symbol:
        raise ValueError("symbol required")
    if decision_ts <= 0:
        raise ValueError("decision_ts must be a positive unix timestamp")

    flt = {
        "symbol": symbol.upper(),
        "published_at": {"gte": decision_ts - window_seconds, "lt": decision_ts},
    }

    qm_filter = rag_store._build_filter(flt)
    raw = rag_store.client().scroll(
        collection_name="news",
        scroll_filter=qm_filter,
        limit=max_articles,
        with_payload=True,
        with_vectors=True,
    )
    records, _ = raw
    points = [
        {"vector": r.vector, "payload": r.payload, "id": r.id}
        for r in records
    ]
    total = len(points)

    if total == 0:
        return NewsRedundancy(
            symbol=symbol.upper(),
            decision_ts=decision_ts,
            window_seconds=window_seconds,
            total_articles=0,
            unique_clusters=0,
            redundancy=0.0,
            cluster_weight=0.0,
            latest_published_at=None,
        )

    clusters = _greedy_cluster(points, cluster_threshold)
    unique = len(clusters)
    redundancy = 1.0 - (unique / total) if total > 0 else 0.0

    # Freshness-decayed cluster weight: each cluster contributes a decayed
    # weight using its newest article's age. Older clusters fade.
    cluster_weight = 0.0
    latest_ts = 0
    for cluster_indices in clusters:
        latest_in_cluster = max(
            int(points[i]["payload"].get("published_at") or 0) for i in cluster_indices
        )
        if latest_in_cluster > latest_ts:
            latest_ts = latest_in_cluster
        age = max(0, decision_ts - latest_in_cluster)
        cluster_weight += math.exp(-age / decay_tau_seconds)

    return NewsRedundancy(
        symbol=symbol.upper(),
        decision_ts=decision_ts,
        window_seconds=window_seconds,
        total_articles=total,
        unique_clusters=unique,
        redundancy=redundancy,
        cluster_weight=cluster_weight,
        latest_published_at=latest_ts or None,
    )
