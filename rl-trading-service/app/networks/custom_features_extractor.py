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
    
    The extractor splits observations into temporal features (OHLCV + indicators
    over time) and portfolio state features (cash ratio, position ratio, etc.),
    processes them separately, and concatenates the results.
    
    Args:
        observation_space: Gymnasium observation space
        seq_len: Sequence length (lookback window)
        d_model: Transformer model dimension
        n_heads: Number of attention heads
        n_layers: Number of transformer blocks
        d_ff: Feedforward dimension
        dropout: Dropout probability
        n_portfolio_features: Number of portfolio state features (default: 7)
            Portfolio features include: cash_ratio, position_ratio, unrealized_pnl,
            holding_ratio, current_drawdown, short_position_ratio, is_short
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
        n_portfolio_features: int = 7,
    ):
        # Output features dimension (after aggregation + portfolio features)
        features_dim = d_model * 3 + d_model  # 768 + 256 = 1024 for d_model=256
        
        super().__init__(observation_space, features_dim=features_dim)
        
        # Calculate dimensions correctly
        obs_shape = observation_space.shape[0]
        self.n_portfolio_features = n_portfolio_features
        self.seq_len = seq_len
        
        # Temporal features: obs_shape - portfolio_features
        temporal_size = obs_shape - n_portfolio_features  # 2107 - 7 = 2100
        self.input_dim = temporal_size // seq_len  # 2100 // 60 = 35
        
        # Validate
        expected_temporal = self.seq_len * self.input_dim
        if temporal_size != expected_temporal:
            raise ValueError(
                f"Observation shape mismatch: expected {expected_temporal + n_portfolio_features}, "
                f"got {obs_shape}. seq_len={seq_len}, input_dim={self.input_dim}, "
                f"portfolio_features={n_portfolio_features}"
            )
        
        # Create transformer network (without actor/critic heads)
        self.transformer = TransformerTradingPolicy(
            input_dim=self.input_dim,
            seq_len=seq_len,
            d_model=d_model,
            n_heads=n_heads,
            n_layers=n_layers,
            d_ff=d_ff,
            dropout=dropout,
            n_actions=7,  # Dummy value, we won't use the heads
        )
        
        # Portfolio features projection (to add to aggregated features)
        self.portfolio_projection = nn.Linear(n_portfolio_features, d_model)
    
    def forward(self, observations: torch.Tensor) -> torch.Tensor:
        """
        Extract features from observations.
        
        Args:
            observations: [batch_size, obs_dim] where obs_dim = seq_len * input_dim + n_portfolio_features
        
        Returns:
            features: [batch_size, features_dim] - Aggregated features for policy/value heads
        """
        batch_size = observations.size(0)
        
        # Split observations into temporal features and portfolio features
        temporal_size = self.seq_len * self.input_dim
        temporal_obs = observations[:, :temporal_size]
        portfolio_obs = observations[:, temporal_size:]  # Last n_portfolio_features
        
        # Reshape temporal to sequence format
        x = temporal_obs.view(batch_size, self.seq_len, self.input_dim)
        
        # Pass through CNN encoder
        x = self.transformer.cnn_encoder(x)
        x = self.transformer.input_projection(x)
        
        # Add positional encoding
        x = self.transformer.pos_encoding(x)
        
        # Transformer encoding
        for transformer_block in self.transformer.transformer_blocks:
            x = transformer_block(x)
        
        # Multi-scale aggregation
        temporal_features = self.transformer.aggregation(x)  # [batch, d_model * 3]
        
        # Project portfolio features
        portfolio_features = self.portfolio_projection(portfolio_obs)  # [batch, d_model]
        
        # Concatenate both feature sets
        features = torch.cat([temporal_features, portfolio_features], dim=-1)
        
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
            
            # Split observations
            temporal_size = self.seq_len * self.input_dim
            temporal_obs = observations[:, :temporal_size]
            
            x = temporal_obs.view(batch_size, self.seq_len, self.input_dim)
            
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
        base_counts = self.transformer.get_parameter_count()
        
        # Add portfolio projection layer
        portfolio_proj_params = sum(p.numel() for p in self.portfolio_projection.parameters())
        base_counts["portfolio_projection"] = portfolio_proj_params
        base_counts["total"] += portfolio_proj_params
        base_counts["trainable"] += portfolio_proj_params
        
        return base_counts
