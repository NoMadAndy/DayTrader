"""
Custom Features Extractor for Stable Baselines3

Wraps the TransformerTradingPolicy to work with SB3's PPO algorithm.
"""

import torch
import torch.nn as nn
from gymnasium import spaces
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor
from typing import Optional

from .transformer_policy import TransformerTradingPolicy


class TransformerFeaturesExtractor(BaseFeaturesExtractor):
    """
    Custom features extractor that uses Transformer architecture.
    
    This wraps TransformerTradingPolicy to extract features for SB3's PPO.
    The actual actor/critic heads are handled by SB3's policy, but we use
    our custom feature extractor to process observations.
    
    Args:
        observation_space: Gymnasium observation space
        seq_len: Sequence length (lookback window)
        d_model: Transformer model dimension
        n_heads: Number of attention heads
        n_layers: Number of transformer blocks
        d_ff: Feedforward dimension
        dropout: Dropout probability
    """
    
    def __init__(
        self,
        observation_space: spaces.Box,
        seq_len: int = 60,
        d_model: int = 256,
        n_heads: int = 8,
        n_layers: int = 4,
        d_ff: int = 512,
        dropout: float = 0.1,
    ):
        # Output features dimension (after aggregation)
        features_dim = d_model * 3  # 768 for d_model=256
        
        super().__init__(observation_space, features_dim=features_dim)
        
        # Calculate input dimension
        obs_shape = observation_space.shape[0]
        input_dim = obs_shape // seq_len
        
        # Create transformer network (without actor/critic heads)
        self.transformer = TransformerTradingPolicy(
            input_dim=input_dim,
            seq_len=seq_len,
            d_model=d_model,
            n_heads=n_heads,
            n_layers=n_layers,
            d_ff=d_ff,
            dropout=dropout,
            n_actions=7,  # Dummy value, we won't use the heads
        )
        
        self.seq_len = seq_len
        self.input_dim = input_dim
    
    def forward(self, observations: torch.Tensor) -> torch.Tensor:
        """
        Extract features from observations.
        
        Args:
            observations: [batch_size, obs_dim] where obs_dim = seq_len * input_dim
        
        Returns:
            features: [batch_size, features_dim] - Aggregated features for policy/value heads
        """
        # Reshape to sequence format
        batch_size = observations.size(0)
        x = observations.view(batch_size, self.seq_len, self.input_dim)
        
        # Pass through CNN encoder
        x = self.transformer.cnn_encoder(x)
        x = self.transformer.input_projection(x)
        
        # Add positional encoding
        x = self.transformer.pos_encoding(x)
        
        # Transformer encoding
        for transformer_block in self.transformer.transformer_blocks:
            x = transformer_block(x)
        
        # Multi-scale aggregation (this is our feature output)
        features = self.transformer.aggregation(x)
        
        return features
    
    def get_regime_probs(self, observations: torch.Tensor) -> torch.Tensor:
        """
        Get market regime probabilities for given observations.
        
        This is an extra utility method for monitoring/analysis.
        
        Args:
            observations: [batch_size, obs_dim]
        
        Returns:
            regime_probs: [batch_size, 4]
        """
        with torch.no_grad():
            batch_size = observations.size(0)
            x = observations.view(batch_size, self.seq_len, self.input_dim)
            
            # Pass through network up to regime detector
            x = self.transformer.cnn_encoder(x)
            x = self.transformer.input_projection(x)
            x = self.transformer.pos_encoding(x)
            
            for transformer_block in self.transformer.transformer_blocks:
                x = transformer_block(x)
            
            _, regime_probs = self.transformer.regime_detector(x)
            
            return regime_probs
    
    def get_parameter_count(self) -> dict:
        """Get parameter count breakdown"""
        return self.transformer.get_parameter_count()
