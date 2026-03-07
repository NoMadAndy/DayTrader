"""
RL Ensemble System (Majority Voting)

Runs multiple RL agents with different configurations in parallel
and combines their signals via majority voting for more robust decisions.

Agent Types:
1. Trend-Following Agent
2. Mean-Reversion Agent
3. Momentum Agent
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import logging

logger = logging.getLogger(__name__)


@dataclass
class EnsembleSignal:
    """Signal from a single ensemble member"""
    agent_name: str
    action: str  # 'buy', 'sell', 'hold', 'short'
    confidence: float
    score: float  # -1 to +1


@dataclass
class EnsembleResult:
    """Aggregated result from ensemble voting"""
    consensus_action: str  # 'buy', 'sell', 'hold', 'short'
    consensus_confidence: float
    consensus_score: float
    vote_counts: Dict[str, int]
    agreement_level: str  # 'unanimous', 'strong', 'majority', 'split'
    individual_signals: List[EnsembleSignal]
    details: Dict[str, Any] = field(default_factory=dict)


class RLEnsemble:
    """
    Manages an ensemble of RL agents with different trading styles.

    Combines signals via weighted majority voting for more robust
    trading decisions. Reduces single-model risk.

    Voting Rules:
    - Unanimous (all agree): High confidence, proceed
    - Strong majority (2/3): Moderate confidence, proceed
    - Majority (2/3 with low confidence): Proceed with caution
    - Split (no majority): Hold / skip
    """

    def __init__(
        self,
        min_agreement_ratio: float = 0.6,
        confidence_weight: bool = True,
    ):
        """
        Args:
            min_agreement_ratio: Minimum ratio of agents that must agree (0.5-1.0)
            confidence_weight: Whether to weight votes by confidence
        """
        self.min_agreement_ratio = min_agreement_ratio
        self.confidence_weight = confidence_weight

        # Track ensemble member performance for adaptive weighting
        self._member_performance: Dict[str, List[float]] = {}
        self._member_weights: Dict[str, float] = {}

    def aggregate_signals(
        self,
        signals: List[EnsembleSignal],
    ) -> EnsembleResult:
        """
        Aggregate signals from multiple ensemble members via weighted voting.

        Args:
            signals: List of signals from individual ensemble members

        Returns:
            EnsembleResult with consensus decision
        """
        if not signals:
            return EnsembleResult(
                consensus_action='hold',
                consensus_confidence=0.0,
                consensus_score=0.0,
                vote_counts={},
                agreement_level='split',
                individual_signals=[],
            )

        # Count votes with optional weighting
        vote_weights: Dict[str, float] = {}
        vote_scores: Dict[str, List[float]] = {}

        for signal in signals:
            action = signal.action
            weight = signal.confidence if self.confidence_weight else 1.0

            # Apply performance-based weight if available
            perf_weight = self._member_weights.get(signal.agent_name, 1.0)
            weight *= perf_weight

            vote_weights[action] = vote_weights.get(action, 0) + weight
            if action not in vote_scores:
                vote_scores[action] = []
            vote_scores[action].append(signal.score)

        # Simple count for agreement level
        vote_counts = {}
        for signal in signals:
            action = signal.action
            vote_counts[action] = vote_counts.get(action, 0) + 1

        # Find winning action
        total_weight = sum(vote_weights.values())
        if total_weight == 0:
            consensus_action = 'hold'
            consensus_ratio = 0
        else:
            consensus_action = max(vote_weights, key=vote_weights.get)
            consensus_ratio = vote_weights[consensus_action] / total_weight

        # Calculate consensus score and confidence
        if consensus_action in vote_scores:
            consensus_score = float(np.mean(vote_scores[consensus_action]))
        else:
            consensus_score = 0.0

        # Determine agreement level
        n_agents = len(signals)
        n_agree = vote_counts.get(consensus_action, 0)

        if n_agree == n_agents:
            agreement_level = 'unanimous'
            confidence_boost = 1.3
        elif n_agree / n_agents >= 0.75:
            agreement_level = 'strong'
            confidence_boost = 1.15
        elif n_agree / n_agents >= self.min_agreement_ratio:
            agreement_level = 'majority'
            confidence_boost = 1.0
        else:
            agreement_level = 'split'
            confidence_boost = 0.5
            consensus_action = 'hold'  # No consensus -> hold

        # Consensus confidence
        agent_confidences = [s.confidence for s in signals if s.action == consensus_action]
        base_confidence = float(np.mean(agent_confidences)) if agent_confidences else 0.3
        consensus_confidence = min(1.0, base_confidence * confidence_boost)

        return EnsembleResult(
            consensus_action=consensus_action,
            consensus_confidence=consensus_confidence,
            consensus_score=consensus_score,
            vote_counts=vote_counts,
            agreement_level=agreement_level,
            individual_signals=signals,
            details={
                'weighted_votes': vote_weights,
                'consensus_ratio': consensus_ratio,
                'n_agents': n_agents,
                'confidence_boost': confidence_boost,
            }
        )

    def record_outcome(self, agent_name: str, profit: float):
        """
        Record trade outcome for a specific ensemble member.
        Used for adaptive weighting.

        Args:
            agent_name: Name of the ensemble member
            profit: Trade profit (positive = win)
        """
        if agent_name not in self._member_performance:
            self._member_performance[agent_name] = []

        self._member_performance[agent_name].append(profit)
        if len(self._member_performance[agent_name]) > 100:
            self._member_performance[agent_name] = self._member_performance[agent_name][-100:]

        # Update weights based on recent performance
        self._update_weights()

    def _update_weights(self):
        """Update ensemble member weights based on their performance"""
        if not self._member_performance:
            return

        for agent_name, profits in self._member_performance.items():
            if len(profits) < 5:
                self._member_weights[agent_name] = 1.0
                continue

            recent = profits[-20:]
            win_rate = sum(1 for p in recent if p > 0) / len(recent)
            avg_profit = np.mean(recent)

            # Weight = win_rate * profitability_factor
            profitability = 1.0 + np.clip(avg_profit / 1000, -0.3, 0.3)
            weight = max(0.3, min(2.0, win_rate * 2 * profitability))

            self._member_weights[agent_name] = weight

    def get_member_stats(self) -> Dict[str, Dict]:
        """Get performance statistics for each ensemble member"""
        stats = {}
        for agent_name, profits in self._member_performance.items():
            if not profits:
                continue
            stats[agent_name] = {
                'total_trades': len(profits),
                'win_rate': sum(1 for p in profits if p > 0) / len(profits),
                'avg_profit': float(np.mean(profits)),
                'total_profit': float(sum(profits)),
                'current_weight': self._member_weights.get(agent_name, 1.0),
            }
        return stats


def create_ensemble_configs() -> Dict[str, Dict]:
    """
    Create configuration profiles for ensemble members.

    Returns:
        Dict of agent configurations for different trading styles
    """
    return {
        'trend_follower': {
            'trading_style': 'trend_following',
            'holding_period': 'swing_medium',
            'risk_profile': 'moderate',
            'indicators_focus': ['sma_20', 'sma_50', 'adx', 'macd'],
            'description': 'Follows established trends using MA crossovers and ADX'
        },
        'mean_reverter': {
            'trading_style': 'mean_reversion',
            'holding_period': 'swing_short',
            'risk_profile': 'moderate',
            'indicators_focus': ['rsi', 'bb_pct', 'stoch_k', 'cci'],
            'description': 'Buys oversold, sells overbought using oscillators'
        },
        'momentum_trader': {
            'trading_style': 'momentum',
            'holding_period': 'intraday',
            'risk_profile': 'aggressive',
            'indicators_focus': ['momentum_5', 'momentum_10', 'volume_ratio', 'obv'],
            'description': 'Trades breakouts and strong momentum moves'
        },
    }
