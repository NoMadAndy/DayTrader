"""
Neural Network Architectures for RL Trading

This module contains custom network architectures for trading agents:
- transformer_policy: Transformer-enhanced PPO policy
- custom_features_extractor: SB3 integration wrappers
"""

from .transformer_policy import (
    PositionalEncoding,
    MultiScaleCNN,
    TransformerBlock,
    MarketRegimeDetector,
    MultiScaleAggregation,
    TransformerTradingPolicy,
)
from .custom_features_extractor import TransformerFeaturesExtractor

__all__ = [
    "PositionalEncoding",
    "MultiScaleCNN",
    "TransformerBlock",
    "MarketRegimeDetector",
    "MultiScaleAggregation",
    "TransformerTradingPolicy",
    "TransformerFeaturesExtractor",
]
