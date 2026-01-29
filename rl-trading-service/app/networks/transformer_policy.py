"""
Transformer-Enhanced Trading Policy Network

Advanced architecture for RL trading agents featuring:
- Multi-scale CNN for feature extraction
- Transformer encoder for temporal awareness
- Market regime detection
- Multi-scale temporal aggregation

Parameter count: ~2.5-3M (vs ~300k for standard MLP)
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Optional


class PositionalEncoding(nn.Module):
    """
    Sinusoidal positional encoding for time series data.
    
    Args:
        d_model: Dimension of the model
        max_len: Maximum sequence length
        dropout: Dropout probability
    """
    
    def __init__(self, d_model: int, max_len: int = 5000, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)
        
        # Create positional encoding matrix
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # [1, max_len, d_model]
        
        self.register_buffer('pe', pe)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [batch_size, seq_len, d_model]
        Returns:
            [batch_size, seq_len, d_model]
        """
        x = x + self.pe[:, :x.size(1), :]
        return self.dropout(x)


class MultiScaleCNN(nn.Module):
    """
    Multi-scale CNN for extracting features at different temporal scales.
    
    Uses parallel 1D convolutions with different kernel sizes (3, 5, 7, 14)
    to capture short-term to medium-term patterns.
    
    Args:
        in_channels: Number of input features
        out_channels: Output dimension per scale
    """
    
    def __init__(self, in_channels: int, out_channels: int = 64):
        super().__init__()
        
        # Different kernel sizes for different temporal scales
        self.conv3 = nn.Conv1d(in_channels, out_channels, kernel_size=3, padding=1)
        self.conv5 = nn.Conv1d(in_channels, out_channels, kernel_size=5, padding=2)
        self.conv7 = nn.Conv1d(in_channels, out_channels, kernel_size=7, padding=3)
        self.conv14 = nn.Conv1d(in_channels, out_channels, kernel_size=14, padding=7)
        
        self.bn3 = nn.BatchNorm1d(out_channels)
        self.bn5 = nn.BatchNorm1d(out_channels)
        self.bn7 = nn.BatchNorm1d(out_channels)
        self.bn14 = nn.BatchNorm1d(out_channels)
        
        # Projection to combine all scales
        self.projection = nn.Linear(out_channels * 4, out_channels * 4)
        self.layer_norm = nn.LayerNorm(out_channels * 4)
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [batch_size, seq_len, in_channels]
        Returns:
            [batch_size, seq_len, out_channels * 4]
        """
        # Transpose for Conv1d: [batch, channels, seq_len]
        x = x.transpose(1, 2)
        
        # Apply convolutions in parallel
        out3 = F.relu(self.bn3(self.conv3(x)))
        out5 = F.relu(self.bn5(self.conv5(x)))
        out7 = F.relu(self.bn7(self.conv7(x)))
        out14 = F.relu(self.bn14(self.conv14(x)))
        
        # Concatenate and transpose back
        out = torch.cat([out3, out5, out7, out14], dim=1)  # [batch, 4*out_channels, seq_len]
        out = out.transpose(1, 2)  # [batch, seq_len, 4*out_channels]
        
        # Project and normalize
        out = self.projection(out)
        out = self.layer_norm(out)
        
        return out


class TransformerBlock(nn.Module):
    """
    Standard Transformer Encoder Block with Multi-Head Self-Attention.
    
    Args:
        d_model: Model dimension
        n_heads: Number of attention heads
        d_ff: Feedforward dimension
        dropout: Dropout probability
    """
    
    def __init__(
        self,
        d_model: int = 256,
        n_heads: int = 8,
        d_ff: int = 512,
        dropout: float = 0.1
    ):
        super().__init__()
        
        self.attention = nn.MultiheadAttention(
            d_model, n_heads, dropout=dropout, batch_first=True
        )
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        
        self.ffn = nn.Sequential(
            nn.Linear(d_model, d_ff),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(d_ff, d_model),
            nn.Dropout(dropout),
        )
        
    def forward(self, x: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        """
        Args:
            x: [batch_size, seq_len, d_model]
            mask: Optional attention mask
        Returns:
            [batch_size, seq_len, d_model]
        """
        # Self-attention with residual
        attn_out, _ = self.attention(x, x, x, attn_mask=mask)
        x = self.norm1(x + attn_out)
        
        # Feedforward with residual
        ffn_out = self.ffn(x)
        x = self.norm2(x + ffn_out)
        
        return x


class MarketRegimeDetector(nn.Module):
    """
    Detects market regime from encoded features.
    
    Classifies into 4 regimes:
    - 0: Trend (strong directional movement)
    - 1: Range (sideways, mean-reverting)
    - 2: Volatile (high uncertainty)
    - 3: Crash (extreme downward movement)
    
    Args:
        d_model: Input feature dimension
        n_regimes: Number of market regimes (default: 4)
    """
    
    def __init__(self, d_model: int = 256, n_regimes: int = 4):
        super().__init__()
        
        self.detector = nn.Sequential(
            nn.Linear(d_model, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, n_regimes),
        )
        
    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Args:
            x: [batch_size, seq_len, d_model] or [batch_size, d_model]
        Returns:
            logits: [batch_size, n_regimes]
            probs: [batch_size, n_regimes]
        """
        # If sequence, use last timestep
        if x.dim() == 3:
            x = x[:, -1, :]
        
        logits = self.detector(x)
        probs = F.softmax(logits, dim=-1)
        
        return logits, probs


class MultiScaleAggregation(nn.Module):
    """
    Aggregates features across multiple time scales.
    
    Combines:
    - Short-term: Last 5 timesteps
    - Medium-term: Last 20 timesteps  
    - Long-term: All 60 timesteps
    
    Args:
        d_model: Feature dimension
    """
    
    def __init__(self, d_model: int = 256):
        super().__init__()
        
        self.short_pool = nn.AdaptiveAvgPool1d(1)
        self.medium_pool = nn.AdaptiveAvgPool1d(1)
        self.long_pool = nn.AdaptiveAvgPool1d(1)
        
        # Projection to combine scales
        self.projection = nn.Sequential(
            nn.Linear(d_model * 3, d_model * 3),
            nn.LayerNorm(d_model * 3),
            nn.ReLU(),
        )
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [batch_size, seq_len, d_model]
        Returns:
            [batch_size, d_model * 3]
        """
        seq_len = x.size(1)
        
        # Extract different time windows
        short_window = min(5, seq_len)
        medium_window = min(20, seq_len)
        
        # Pool over different windows
        # Transpose for pooling: [batch, d_model, seq_len]
        x_t = x.transpose(1, 2)
        
        short_feat = self.short_pool(x_t[:, :, -short_window:]).squeeze(-1)  # [batch, d_model]
        medium_feat = self.medium_pool(x_t[:, :, -medium_window:]).squeeze(-1)  # [batch, d_model]
        long_feat = self.long_pool(x_t).squeeze(-1)  # [batch, d_model]
        
        # Concatenate and project
        aggregated = torch.cat([short_feat, medium_feat, long_feat], dim=-1)  # [batch, d_model * 3]
        aggregated = self.projection(aggregated)
        
        return aggregated


class TransformerTradingPolicy(nn.Module):
    """
    Complete Transformer-based trading policy network.
    
    Architecture:
    1. Multi-scale CNN encoder
    2. Positional encoding
    3. Transformer encoder (multiple blocks)
    4. Market regime detector
    5. Multi-scale aggregation
    6. Separate Actor and Critic heads
    
    Args:
        input_dim: Number of input features
        seq_len: Sequence length (lookback window)
        d_model: Transformer model dimension
        n_heads: Number of attention heads
        n_layers: Number of transformer blocks
        d_ff: Feedforward dimension
        dropout: Dropout probability
        n_actions: Number of actions (for actor head)
    """
    
    def __init__(
        self,
        input_dim: int,
        seq_len: int = 60,
        d_model: int = 256,
        n_heads: int = 8,
        n_layers: int = 4,
        d_ff: int = 512,
        dropout: float = 0.1,
        n_actions: int = 7,
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.seq_len = seq_len
        self.d_model = d_model
        
        # Multi-scale CNN encoder (outputs 256 = 64*4)
        self.cnn_encoder = MultiScaleCNN(input_dim, out_channels=64)
        
        # Projection to d_model if needed
        cnn_out_dim = 64 * 4  # 256
        if cnn_out_dim != d_model:
            self.input_projection = nn.Linear(cnn_out_dim, d_model)
        else:
            self.input_projection = nn.Identity()
        
        # Positional encoding
        self.pos_encoding = PositionalEncoding(d_model, max_len=seq_len, dropout=dropout)
        
        # Transformer encoder blocks
        self.transformer_blocks = nn.ModuleList([
            TransformerBlock(d_model, n_heads, d_ff, dropout)
            for _ in range(n_layers)
        ])
        
        # Market regime detector
        self.regime_detector = MarketRegimeDetector(d_model, n_regimes=4)
        
        # Multi-scale aggregation
        self.aggregation = MultiScaleAggregation(d_model)
        
        # Feature dimension after aggregation
        aggregated_dim = d_model * 3  # 768 for d_model=256
        
        # Actor head (policy network)
        self.actor = nn.Sequential(
            nn.Linear(aggregated_dim, 512),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Linear(128, n_actions),
        )
        
        # Critic head (value network)
        self.critic = nn.Sequential(
            nn.Linear(aggregated_dim, 512),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Linear(128, 1),
        )
        
        self._initialize_weights()
    
    def _initialize_weights(self):
        """Initialize weights using Xavier/Kaiming initialization"""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.Conv1d):
                nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, (nn.BatchNorm1d, nn.LayerNorm)):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)
    
    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Forward pass through the network.
        
        Args:
            x: [batch_size, seq_len, input_dim] or [batch_size, seq_len * input_dim]
        
        Returns:
            action_logits: [batch_size, n_actions] - Actor output
            value: [batch_size, 1] - Critic output
            regime_probs: [batch_size, 4] - Market regime probabilities
        """
        # Reshape if needed (flatten to sequence)
        if x.dim() == 2:
            batch_size = x.size(0)
            x = x.view(batch_size, self.seq_len, self.input_dim)
        
        # Multi-scale CNN encoding
        x = self.cnn_encoder(x)  # [batch, seq_len, 256]
        
        # Project to d_model
        x = self.input_projection(x)  # [batch, seq_len, d_model]
        
        # Add positional encoding
        x = self.pos_encoding(x)  # [batch, seq_len, d_model]
        
        # Transformer encoding
        for transformer_block in self.transformer_blocks:
            x = transformer_block(x)  # [batch, seq_len, d_model]
        
        # Market regime detection (from last timestep)
        _, regime_probs = self.regime_detector(x)  # [batch, 4]
        
        # Multi-scale aggregation
        aggregated = self.aggregation(x)  # [batch, d_model * 3]
        
        # Actor and Critic heads
        action_logits = self.actor(aggregated)  # [batch, n_actions]
        value = self.critic(aggregated)  # [batch, 1]
        
        return action_logits, value, regime_probs
    
    def get_parameter_count(self) -> dict:
        """Get detailed parameter count breakdown"""
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        
        # Breakdown by component
        breakdown = {
            "total": total,
            "trainable": trainable,
            "cnn_encoder": sum(p.numel() for p in self.cnn_encoder.parameters()),
            "transformer_blocks": sum(p.numel() for p in self.transformer_blocks.parameters()),
            "regime_detector": sum(p.numel() for p in self.regime_detector.parameters()),
            "aggregation": sum(p.numel() for p in self.aggregation.parameters()),
            "actor": sum(p.numel() for p in self.actor.parameters()),
            "critic": sum(p.numel() for p in self.critic.parameters()),
        }
        
        return breakdown
