"""
RL Trading Agent Trainer

Manages the training of trading agents using Proximal Policy Optimization (PPO).
Handles:
- Agent creation and configuration
- Training with checkpointing
- Model persistence
- Performance evaluation
"""

import os
import json
import logging
import asyncio
import warnings
from datetime import datetime
from typing import Dict, Optional, List, Any, Tuple
from pathlib import Path
import numpy as np
import pandas as pd

import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import (
    BaseCallback, CheckpointCallback, EvalCallback
)
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize
from stable_baselines3.common.monitor import Monitor

from .config import settings
from .agent_config import AgentConfig, AgentStatus, PRESET_AGENT_CONFIGS
from .trading_env import TradingEnvironment
from .indicators import calculate_indicators, prepare_data_for_training

logger = logging.getLogger(__name__)


def sanitize_float(value: Optional[float]) -> Optional[float]:
    """
    Convert inf/nan to JSON-safe values.
    
    Args:
        value: A float value that might be inf, -inf, or nan
        
    Returns:
        None if value is inf/-inf/nan, otherwise the float value
    """
    import math
    
    if value is None:
        return None
    
    # Convert numpy types to Python float
    if isinstance(value, np.floating):
        value = float(value)
    
    # Check for non-finite values
    if not math.isfinite(value):
        return None
    
    return value


class TrainingProgressCallback(BaseCallback):
    """Callback to track training progress and emit updates with detailed logs"""
    
    def __init__(
        self,
        agent_name: str,
        total_timesteps: int,
        progress_callback: Optional[callable] = None,
        log_callback: Optional[callable] = None,
        verbose: int = 0
    ):
        super().__init__(verbose)
        self.agent_name = agent_name
        self.total_timesteps = total_timesteps
        self.progress_callback = progress_callback
        self.log_callback = log_callback
        self.best_reward = None  # Start with None instead of -np.inf for JSON compatibility
        self.episode_rewards = []
        self.episode_lengths = []
        self.last_log_timestep = 0
        self.start_timesteps = 0  # Will be set on training start to handle continue_training
        self.log_interval = max(1000, total_timesteps // 100)  # Log every 1% or 1000 steps
        
    def _log(self, message: str, level: str = "info"):
        """Emit a log message"""
        if self.log_callback:
            self.log_callback(message, level)
        
    def _on_training_start(self) -> None:
        self.start_timesteps = self.model.num_timesteps  # Capture starting point for continue_training
        self.last_log_timestep = self.start_timesteps
        self._log(f"🚀 Training started for agent '{self.agent_name}'")
        self._log(f"   Total timesteps: {self.total_timesteps:,}")
        if self.start_timesteps > 0:
            self._log(f"   Continuing from timestep: {self.start_timesteps:,}")
        self._log(f"   Device: {self.model.device}")
        
    def _on_step(self) -> bool:
        import math
        
        # Get episode info if available
        if len(self.model.ep_info_buffer) > 0:
            ep_info = self.model.ep_info_buffer[-1]
            reward = ep_info.get('r', 0)
            length = ep_info.get('l', 0)
            
            # Only log new episodes
            if len(self.episode_rewards) == 0 or reward != self.episode_rewards[-1]:
                self.episode_rewards.append(reward)
                self.episode_lengths.append(length)
                
                # Log episode completion
                if len(self.episode_rewards) % 10 == 0:  # Log every 10 episodes
                    self._log(f"📊 Episode {len(self.episode_rewards)}: reward={reward:.2f}, length={length}")
            
            # Update best reward (handle None case)
            if reward > (self.best_reward or float('-inf')):
                old_best = self.best_reward
                self.best_reward = reward
                if old_best is not None:
                    self._log(f"🏆 New best reward: {self.best_reward:.2f} (was {old_best:.2f})", "success")
        
        # Calculate session-relative progress (handles continue_training correctly)
        session_timesteps = self.num_timesteps - self.start_timesteps
        progress = min(session_timesteps / self.total_timesteps, 1.0)
        
        # Log progress at intervals
        if self.num_timesteps - self.last_log_timestep >= self.log_interval:
            self.last_log_timestep = self.num_timesteps
            pct = progress * 100
            mean_rew = np.mean(self.episode_rewards[-100:]) if self.episode_rewards else 0
            self._log(f"⏳ Progress: {pct:.1f}% ({session_timesteps:,}/{self.total_timesteps:,} steps) | Mean reward: {mean_rew:.2f}")
        
        if self.progress_callback:
            # Calculate mean reward and ensure it's finite
            mean_reward = 0.0
            if self.episode_rewards:
                mean_reward = float(np.mean(self.episode_rewards[-100:]))
                if not math.isfinite(mean_reward):
                    mean_reward = 0.0
            
            self.progress_callback({
                "agent_name": self.agent_name,
                "progress": progress,
                "timesteps": session_timesteps,
                "total_timesteps": self.total_timesteps,
                "episodes": len(self.episode_rewards),
                "mean_reward": mean_reward,
                "best_reward": sanitize_float(self.best_reward),
            })
        
        return True
    
    def _on_training_end(self) -> None:
        self._log(f"✅ Training completed!")
        self._log(f"   Total episodes: {len(self.episode_rewards)}")
        if self.best_reward is not None:
            self._log(f"   Best reward: {self.best_reward:.2f}")
        if self.episode_rewards:
            self._log(f"   Final mean reward (last 100): {np.mean(self.episode_rewards[-100:]):.2f}")


class TradingAgentTrainer:
    """
    Manages training and persistence of RL trading agents.
    
    Each agent is identified by name and can have different configurations.
    Models are saved with metadata for later loading and inference.
    """
    
    def __init__(self):
        self.model_dir = Path(settings.model_dir)
        self.checkpoint_dir = Path(settings.checkpoint_dir)
        self.device = settings.device
        
        # In-memory cache of loaded models
        self._models: Dict[str, PPO] = {}
        self._configs: Dict[str, AgentConfig] = {}
        self._training_status: Dict[str, AgentStatus] = {}
        
        # Load existing model metadata
        self._load_existing_models()
        
    def _load_existing_models(self):
        """Scan model directory and load metadata for existing models"""
        if not self.model_dir.exists():
            return
            
        for model_path in self.model_dir.glob("*/model.zip"):
            agent_name = model_path.parent.name
            metadata_path = model_path.parent / "metadata.json"
            
            if metadata_path.exists():
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
                
                config = AgentConfig(**metadata.get('config', {'name': agent_name}))
                self._configs[agent_name] = config
                
                self._training_status[agent_name] = AgentStatus(
                    name=agent_name,
                    status="trained",
                    is_trained=True,
                    last_trained=metadata.get('trained_at'),
                    total_episodes=metadata.get('total_episodes', 0),
                    best_reward=metadata.get('best_reward'),
                    config=config,
                    performance_metrics=metadata.get('performance_metrics'),
                )
                
                logger.info(f"Found existing model: {agent_name}")
    
    def get_agent_status(self, agent_name: str) -> Optional[AgentStatus]:
        """Get status of an agent"""
        return self._training_status.get(agent_name)
    
    def list_agents(self) -> List[AgentStatus]:
        """List all known agents"""
        return list(self._training_status.values())
    
    def list_presets(self) -> Dict[str, AgentConfig]:
        """List available preset configurations"""
        return PRESET_AGENT_CONFIGS.copy()
    
    def create_environment(
        self,
        df: pd.DataFrame,
        config: AgentConfig,
        inference_mode: bool = False,
    ) -> TradingEnvironment:
        """Create a trading environment with given data and config
        
        Args:
            df: DataFrame with OHLCV data and indicators
            config: Agent configuration
            inference_mode: If True, environment starts at end of data for signal inference
        """
        return TradingEnvironment(
            df=df,
            config=config,
            inference_mode=inference_mode,
            enable_short_selling=getattr(config, 'enable_short_selling', False),
            slippage_model=getattr(config, 'slippage_model', 'proportional'),
            slippage_bps=getattr(config, 'slippage_bps', 5.0),
        )
    
    def prepare_training_data(
        self,
        ohlcv_data: List[Dict],
        symbol: str,
    ) -> pd.DataFrame:
        """Prepare OHLCV data for training"""
        df = prepare_data_for_training(ohlcv_data)
        return df
    
    async def train_agent(
        self,
        agent_name: str,
        config: AgentConfig,
        training_data: Dict[str, pd.DataFrame],
        total_timesteps: int = 100000,
        progress_callback: Optional[callable] = None,
        log_callback: Optional[callable] = None,
        continue_training: bool = True,
    ) -> Dict[str, Any]:
        """
        Train an agent on multiple symbols.
        
        Args:
            agent_name: Unique name for this agent
            config: Agent configuration
            training_data: Dict mapping symbol to DataFrame
            total_timesteps: Total training timesteps
            progress_callback: Optional callback for progress updates
            log_callback: Optional callback for log messages
            continue_training: If True, load existing model and continue training (default).
                               If False, train from scratch.
            
        Returns:
            Training results dictionary
        """
        logger.info(f"Starting training for agent: {agent_name} (continue={continue_training})")
        
        # Update status
        self._configs[agent_name] = config
        self._training_status[agent_name] = AgentStatus(
            name=agent_name,
            status="training",
            is_trained=False,
            config=config,
        )
        
        # Run CPU-bound training in thread pool
        result = await asyncio.to_thread(
            self._train_agent_sync,
            agent_name,
            config,
            training_data,
            total_timesteps,
            progress_callback,
            log_callback,
            continue_training,
        )
        return result
    
    def _train_agent_sync(
        self,
        agent_name: str,
        config: AgentConfig,
        training_data: Dict[str, pd.DataFrame],
        total_timesteps: int,
        progress_callback: Optional[callable],
        log_callback: Optional[callable] = None,
        continue_training: bool = True,
    ) -> Dict[str, Any]:
        """Synchronous training implementation (runs in thread pool)
        
        Args:
            agent_name: Name of the agent
            config: Agent configuration
            training_data: Dict mapping symbol to DataFrame
            total_timesteps: Training timesteps for this session
            progress_callback: Optional progress callback
            log_callback: Optional log callback
            continue_training: If True and model exists, continue training from checkpoint
        """
        
        def log(msg: str, level: str = "info"):
            """Helper to emit logs"""
            if log_callback:
                log_callback(msg, level)
            logger.info(msg) if level == "info" else logger.warning(msg)
        
        # Check if existing model exists for continue training
        existing_model_path = self.model_dir / agent_name / "model.zip"
        existing_norm_path = self.model_dir / agent_name / "vec_normalize.pkl"
        existing_metadata_path = self.model_dir / agent_name / "metadata.json"
        
        has_existing_model = existing_model_path.exists()
        will_continue = continue_training and has_existing_model
        
        # Load existing metadata for cumulative tracking AND config preservation
        cumulative_timesteps = 0
        cumulative_episodes = 0
        training_sessions = 0
        saved_config = None
        
        if will_continue and existing_metadata_path.exists():
            try:
                with open(existing_metadata_path, 'r') as f:
                    existing_metadata = json.load(f)
                cumulative_timesteps = existing_metadata.get('cumulative_timesteps', 
                                                            existing_metadata.get('total_timesteps', 0))
                cumulative_episodes = existing_metadata.get('cumulative_episodes',
                                                           existing_metadata.get('total_episodes', 0))
                training_sessions = existing_metadata.get('training_sessions', 1)
                
                # Load saved config to preserve architecture settings
                if 'config' in existing_metadata:
                    saved_config = AgentConfig(**existing_metadata['config'])
                    log(f"📚 Found existing model with {cumulative_timesteps:,} cumulative timesteps")
                    log(f"   🏗️ Preserving architecture: transformer={saved_config.use_transformer_policy}")
            except Exception as e:
                log(f"⚠️ Could not load existing metadata: {e}", "warning")
        
        # Use saved config for continue training to preserve architecture
        # Only override trading parameters (balance, positions, etc.) from new config
        if will_continue and saved_config is not None:
            # Preserve architecture but allow updating some trading parameters
            effective_config = saved_config.model_copy(update={
                'initial_balance': config.initial_balance,
                'max_position_size': config.max_position_size,
                'stop_loss_percent': config.stop_loss_percent,
                'take_profit_percent': config.take_profit_percent,
                # Keep architecture settings from saved model:
                # - use_transformer_policy
                # - transformer_d_model, transformer_n_heads, etc.
                # - learning_rate, gamma, ent_coef
            })
            log(f"   📋 Using saved architecture with updated trading params")
        else:
            effective_config = config
        
        try:
            log(f"📦 Preparing training data for {len(training_data)} symbol(s)...")
            
            # === Walk-Forward Train/Test Split (80/20) ===
            # Split each symbol's data chronologically: first 80% for training, last 20% for OOS evaluation
            train_data_split = {}
            test_data_split = {}
            
            for symbol, df in training_data.items():
                if len(df) < 200:
                    log(f"⚠️ Skipping {symbol}: insufficient data ({len(df)} rows)", "warning")
                    continue
                
                split_idx = int(len(df) * 0.8)
                train_df = df.iloc[:split_idx].copy()
                test_df = df.iloc[split_idx:].copy()
                
                # Ensure both splits have enough data
                if len(train_df) < 150:
                    log(f"⚠️ Skipping {symbol}: train split too small ({len(train_df)} rows)", "warning")
                    continue
                if len(test_df) < 100:
                    # Not enough for OOS test, use all data for training
                    log(f"   ⚠️ {symbol}: test split too small ({len(test_df)}), using full data for training", "warning")
                    train_data_split[symbol] = df
                else:
                    train_data_split[symbol] = train_df
                    test_data_split[symbol] = test_df
                    log(f"   ✓ {symbol}: {len(df)} total → Train: {len(train_df)}, Test: {len(test_df)} (Walk-Forward 80/20)")
            
            if not train_data_split:
                raise ValueError("No valid training data provided")
            
            # Create training environments
            envs = []
            for symbol, df in train_data_split.items():
                env = self.create_environment(df, effective_config)
                env = Monitor(env)
                envs.append(env)
            
            # Create vectorized environment — use ALL symbols for generalized training
            n_envs = len(envs)
            if n_envs > 1:
                log(f"🔀 Multi-symbol training: {n_envs} environments ({', '.join(train_data_split.keys())})")
                vec_env = DummyVecEnv([lambda i=i: envs[i] for i in range(n_envs)])
            else:
                vec_env = DummyVecEnv([lambda: envs[0]])
            
            # Normalize observations
            vec_env = VecNormalize(
                vec_env,
                norm_obs=True,
                norm_reward=True,
                clip_obs=10.0,
            )
            
            # Determine architecture based on effective_config (preserves saved architecture)
            use_transformer = getattr(effective_config, 'use_transformer_policy', False)
            
            # Log GPU usage if enabled
            if settings.device == "cuda":
                log(f"🚀 GPU Training enabled: {torch.cuda.get_device_name(0)}")
                log(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
            
            if use_transformer:
                log(f"🧠 Creating PPO model with Transformer architecture...")
                log(f"   d_model: {effective_config.transformer_d_model}")
                log(f"   n_heads: {effective_config.transformer_n_heads}")
                log(f"   n_layers: {effective_config.transformer_n_layers}")
                log(f"   d_ff: {effective_config.transformer_d_ff}")
                log(f"   dropout: {effective_config.transformer_dropout}")
                log(f"   Learning rate: {effective_config.learning_rate}")
                log(f"   Gamma: {effective_config.gamma}")
                
                # Import transformer components
                from .networks import TransformerFeaturesExtractor
                
                # Get observation space to calculate input dimensions
                obs_space = vec_env.observation_space
                
                # Create policy kwargs with custom features extractor
                policy_kwargs = dict(
                    features_extractor_class=TransformerFeaturesExtractor,
                    features_extractor_kwargs=dict(
                        seq_len=getattr(effective_config, 'lookback_window', settings.default_lookback_window),
                        d_model=effective_config.transformer_d_model,
                        n_heads=effective_config.transformer_n_heads,
                        n_layers=effective_config.transformer_n_layers,
                        d_ff=effective_config.transformer_d_ff,
                        dropout=effective_config.transformer_dropout,
                        n_portfolio_features=TradingEnvironment.N_PORTFOLIO_FEATURES,
                    ),
                    net_arch=dict(pi=[256, 128], vf=[256, 128]),  # Smaller heads since features are rich
                    activation_fn=torch.nn.ReLU,
                )
                
                # Log parameter count
                temp_extractor = TransformerFeaturesExtractor(
                    obs_space,
                    **policy_kwargs['features_extractor_kwargs']
                )
                param_count = temp_extractor.get_parameter_count()
                log(f"   📊 Parameter count: {param_count['total']:,} total")
                log(f"      - CNN Encoder: {param_count['cnn_encoder']:,}")
                log(f"      - Transformer: {param_count['transformer_blocks']:,}")
                log(f"      - Regime Detector: {param_count['regime_detector']:,}")
                log(f"      - Aggregation: {param_count['aggregation']:,}")
                log(f"      - Portfolio Projection: {param_count['portfolio_projection']:,}")
                log(f"      - Actor: {param_count['actor']:,}")
                log(f"      - Critic: {param_count['critic']:,}")
                del temp_extractor  # Free memory
                
            else:
                log(f"🧠 Creating PPO model with MLP architecture...")
                log(f"   Architecture: [256, 256] hidden layers")
                log(f"   Learning rate: {effective_config.learning_rate}")
                log(f"   Gamma: {effective_config.gamma}")
                
                # Create PPO model with standard MLP
                policy_kwargs = dict(
                    net_arch=dict(pi=[256, 256], vf=[256, 256]),
                    activation_fn=torch.nn.ReLU,
                )
            
            # Create or load PPO model
            # For transformer architecture, suppress misleading SB3 GPU warning
            # Our TransformerFeaturesExtractor contains CNN+Transformer (~2.5-3M params)
            # and significantly benefits from GPU acceleration
            
            model = None
            
            # === CONTINUE TRAINING: Load existing model if available ===
            if will_continue:
                try:
                    log(f"🔄 Continue Training: Loading existing model...")
                    
                    # Load existing VecNormalize stats if available
                    if existing_norm_path.exists():
                        log(f"   📊 Loading normalization statistics...")
                        vec_env = VecNormalize.load(str(existing_norm_path), vec_env)
                        vec_env.training = True  # Enable training mode to update stats
                        vec_env.norm_reward = True
                    
                    # Load the existing model
                    model = PPO.load(
                        str(existing_model_path),
                        env=vec_env,
                        device=self.device,
                        tensorboard_log=str(self.checkpoint_dir / "tensorboard"),
                        # Use effective_config learning rate (preserved from saved model)
                        learning_rate=effective_config.learning_rate,
                    )
                    
                    log(f"   ✅ Model loaded successfully!")
                    log(f"   🧠 Continuing from {cumulative_timesteps:,} previous timesteps")
                    log(f"   📈 Previous training sessions: {training_sessions}")
                    
                except Exception as e:
                    log(f"   ⚠️ Failed to load existing model: {e}", "warning")
                    log(f"   🔄 Falling back to training from scratch...", "warning")
                    model = None
                    will_continue = False
                    cumulative_timesteps = 0
                    cumulative_episodes = 0
                    training_sessions = 0
            
            # === CREATE NEW MODEL if not continuing ===
            if model is None:
                if has_existing_model and not continue_training:
                    log(f"🆕 Training from scratch (continue_training=False)")
                else:
                    log(f"🆕 No existing model found, training from scratch...")
                
                if use_transformer:
                    with warnings.catch_warnings():
                        warnings.filterwarnings(
                            "ignore",
                            message=".*GPU.*primarily intended to run on the CPU.*",
                            category=UserWarning,
                        )
                        model = PPO(
                            policy="MlpPolicy",
                            env=vec_env,
                            learning_rate=effective_config.learning_rate,
                            n_steps=settings.default_n_steps,
                            batch_size=settings.default_batch_size,
                            n_epochs=10,
                            gamma=effective_config.gamma,
                            ent_coef=effective_config.ent_coef,
                            clip_range=0.2,
                            policy_kwargs=policy_kwargs,
                            verbose=1,
                            device=self.device,
                            tensorboard_log=str(self.checkpoint_dir / "tensorboard"),
                        )
                else:
                    model = PPO(
                        policy="MlpPolicy",
                        env=vec_env,
                        learning_rate=effective_config.learning_rate,
                        n_steps=settings.default_n_steps,
                        batch_size=settings.default_batch_size,
                        n_epochs=10,
                        gamma=effective_config.gamma,
                        ent_coef=effective_config.ent_coef,
                        clip_range=0.2,
                        policy_kwargs=policy_kwargs,
                        verbose=1,
                        device=self.device,
                        tensorboard_log=str(self.checkpoint_dir / "tensorboard"),
                    )
            
            # Setup callbacks
            progress_cb = TrainingProgressCallback(
                agent_name=agent_name,
                total_timesteps=total_timesteps,
                progress_callback=progress_callback,
                log_callback=log_callback,
            )
            
            checkpoint_path = self.checkpoint_dir / agent_name
            checkpoint_path.mkdir(parents=True, exist_ok=True)
            
            checkpoint_cb = CheckpointCallback(
                save_freq=total_timesteps // 10,
                save_path=str(checkpoint_path),
                name_prefix="checkpoint",
            )
            
            # Train
            training_mode = "Continue Training" if will_continue else "Fresh Training"
            log(f"🎯 Starting {training_mode} for {total_timesteps:,} timesteps...")
            if will_continue:
                log(f"   📊 Model will have {cumulative_timesteps + total_timesteps:,} total timesteps after this session")
            
            start_time = datetime.now()
            model.learn(
                total_timesteps=total_timesteps,
                callback=[progress_cb, checkpoint_cb],
                progress_bar=False,  # Disabled in container, use callback for progress
                reset_num_timesteps=not will_continue,  # Don't reset timestep counter if continuing
            )
            training_duration = (datetime.now() - start_time).total_seconds()
            
            log(f"💾 Saving model...")
            # Save model
            model_path = self.model_dir / agent_name
            model_path.mkdir(parents=True, exist_ok=True)
            
            model.save(str(model_path / "model"))
            vec_env.save(str(model_path / "vec_normalize.pkl"))
            
            # Evaluate model — In-Sample (training data)
            log(f"📈 Evaluating model performance (In-Sample)...")
            eval_results = self._evaluate_model(model, vec_env, n_episodes=10)
            log(f"   Mean return: {eval_results['mean_return_pct']:.2f}%")
            log(f"   Max return: {eval_results['max_return_pct']:.2f}%")
            log(f"   Min return: {eval_results['min_return_pct']:.2f}%")
            if 'mean_sharpe_ratio' in eval_results:
                log(f"   Sharpe: {eval_results['mean_sharpe_ratio']:.2f}, Sortino: {eval_results.get('mean_sortino_ratio', 0):.2f}")
            if 'mean_alpha_pct' in eval_results:
                log(f"   Alpha vs B&H: {eval_results['mean_alpha_pct']:.2f}%")
            
            # === Out-of-Sample Evaluation (Walk-Forward Test) ===
            oos_results = None
            if test_data_split:
                log(f"📊 Out-of-Sample Evaluation (Walk-Forward Test on {len(test_data_split)} symbol(s))...")
                try:
                    # Create test environment with first test symbol
                    test_symbol = list(test_data_split.keys())[0]
                    test_df = test_data_split[test_symbol]
                    
                    test_env = self.create_environment(test_df, effective_config)
                    test_env = Monitor(test_env)
                    test_vec_env = DummyVecEnv([lambda: test_env])
                    
                    # Apply trained normalization stats
                    test_vec_env = VecNormalize.load(str(model_path / "vec_normalize.pkl"), test_vec_env)
                    test_vec_env.training = False
                    test_vec_env.norm_reward = False
                    
                    oos_results = self._evaluate_model(model, test_vec_env, n_episodes=5)
                    
                    log(f"   📊 OOS Results ({test_symbol}):")
                    log(f"   Mean return: {oos_results['mean_return_pct']:.2f}%")
                    if 'mean_sharpe_ratio' in oos_results:
                        log(f"   Sharpe: {oos_results['mean_sharpe_ratio']:.2f}")
                    if 'mean_alpha_pct' in oos_results:
                        log(f"   Alpha vs B&H: {oos_results['mean_alpha_pct']:.2f}%")
                    
                    # Overfitting detection
                    is_return = eval_results['mean_return_pct']
                    oos_return = oos_results['mean_return_pct']
                    if is_return > 0 and oos_return < -abs(is_return) * 0.5:
                        log(f"   ⚠️ OVERFITTING WARNING: In-Sample {is_return:.2f}% vs OOS {oos_return:.2f}%", "warning")
                    elif is_return > 0 and oos_return > 0:
                        log(f"   ✅ Model generalizes well: IS {is_return:.2f}% → OOS {oos_return:.2f}%")
                    
                except Exception as e:
                    log(f"   ⚠️ OOS evaluation failed: {e}", "warning")
                    oos_results = None
            
            # Calculate cumulative values
            new_cumulative_timesteps = cumulative_timesteps + total_timesteps
            new_cumulative_episodes = cumulative_episodes + len(progress_cb.episode_rewards)
            new_training_sessions = training_sessions + 1
            
            # Save metadata with cumulative tracking
            # IMPORTANT: Save effective_config to preserve architecture for future continue-training
            metadata = {
                "agent_name": agent_name,
                "config": effective_config.model_dump(),  # Use effective_config to preserve architecture!
                "trained_at": datetime.now().isoformat(),
                "training_duration_seconds": training_duration,
                # Session-specific values
                "total_timesteps": total_timesteps,
                "total_episodes": len(progress_cb.episode_rewards),
                # Cumulative values (for continue training tracking)
                "cumulative_timesteps": new_cumulative_timesteps,
                "cumulative_episodes": new_cumulative_episodes,
                "training_sessions": new_training_sessions,
                "continued_from_previous": will_continue,
                # Performance
                "best_reward": progress_cb.best_reward,
                "device": self.device,
                "performance_metrics": eval_results,
                "oos_performance_metrics": oos_results,
                "walk_forward_split": {"train_pct": 80, "test_pct": 20},
                "symbols_trained": list(training_data.keys()),
            }
            
            # Log cumulative progress
            if will_continue:
                log(f"📊 Cumulative Training Progress:")
                log(f"   Total timesteps: {new_cumulative_timesteps:,}")
                log(f"   Total episodes: {new_cumulative_episodes:,}")
                log(f"   Training sessions: {new_training_sessions}")
            
            with open(model_path / "metadata.json", 'w') as f:
                json.dump(metadata, f, indent=2)
            
            # Update status with cumulative values
            self._models[agent_name] = model
            self._training_status[agent_name] = AgentStatus(
                name=agent_name,
                status="trained",
                is_trained=True,
                last_trained=metadata['trained_at'],
                total_episodes=new_cumulative_episodes,  # Use cumulative
                best_reward=metadata['best_reward'],
                config=effective_config,  # Use effective_config to preserve architecture
                performance_metrics={
                    **eval_results,
                    'cumulative_timesteps': new_cumulative_timesteps,
                    'training_sessions': new_training_sessions,
                    'continued_training': will_continue,
                },
            )
            
            completion_msg = "Continue Training" if will_continue else "Training"
            log(f"🎉 {completion_msg} completed in {training_duration:.1f}s!")
            log(f"   Model saved to: {model_path}")
            if will_continue:
                log(f"   🧠 Model now has {new_cumulative_timesteps:,} total experience!")
            logger.info(f"Training completed for {agent_name}")
            return metadata
            
        except Exception as e:
            error_msg = str(e)
            log(f"❌ Training failed: {error_msg}", "error")
            logger.error(f"Training failed for {agent_name}: {e}")
            self._training_status[agent_name] = AgentStatus(
                name=agent_name,
                status="failed",
                is_trained=False,
                config=config,
            )
            raise
    
    def _evaluate_model(
        self,
        model: PPO,
        env: VecNormalize,
        n_episodes: int = 10,
    ) -> Dict[str, Any]:
        """Evaluate a trained model with varied starting points and extended metrics"""
        episode_rewards = []
        episode_lengths = []
        episode_returns = []
        episode_sharpe = []
        episode_sortino = []
        episode_max_dd = []
        episode_win_rate = []
        episode_profit_factor = []
        episode_alpha = []
        
        for i in range(n_episodes):
            np.random.seed(42 + i)
            obs = env.reset()
            done = False
            total_reward = 0
            length = 0
            
            while not done:
                action, _ = model.predict(obs, deterministic=True)
                obs, reward, done, info = env.step(action)
                total_reward += reward[0]
                length += 1
                
                if done[0]:
                    ep_info = info[0]
                    if 'return_pct' in ep_info:
                        episode_returns.append(ep_info['return_pct'])
                    if 'sharpe_ratio' in ep_info:
                        episode_sharpe.append(ep_info['sharpe_ratio'])
                    if 'sortino_ratio' in ep_info:
                        episode_sortino.append(ep_info['sortino_ratio'])
                    if 'max_drawdown' in ep_info:
                        episode_max_dd.append(ep_info['max_drawdown'])
                    if 'win_rate' in ep_info:
                        episode_win_rate.append(ep_info['win_rate'])
                    if 'profit_factor' in ep_info:
                        episode_profit_factor.append(ep_info['profit_factor'])
                    if 'alpha_pct' in ep_info:
                        episode_alpha.append(ep_info['alpha_pct'])
                    break
            
            episode_rewards.append(total_reward)
            episode_lengths.append(length)
        
        result = {
            "mean_reward": float(np.mean(episode_rewards)),
            "std_reward": float(np.std(episode_rewards)),
            "mean_length": float(np.mean(episode_lengths)),
            "mean_return_pct": float(np.mean(episode_returns)) if episode_returns else 0,
            "max_return_pct": float(np.max(episode_returns)) if episode_returns else 0,
            "min_return_pct": float(np.min(episode_returns)) if episode_returns else 0,
        }
        
        # Extended metrics (v2)
        if episode_sharpe:
            result["mean_sharpe_ratio"] = float(np.mean(episode_sharpe))
        if episode_sortino:
            result["mean_sortino_ratio"] = float(np.mean(episode_sortino))
        if episode_max_dd:
            result["mean_max_drawdown"] = float(np.mean(episode_max_dd))
            result["worst_max_drawdown"] = float(np.max(episode_max_dd))
        if episode_win_rate:
            result["mean_win_rate"] = float(np.mean(episode_win_rate))
        if episode_profit_factor:
            pf = [x for x in episode_profit_factor if x < 900]  # Exclude inf-like
            result["mean_profit_factor"] = float(np.mean(pf)) if pf else 0.0
        if episode_alpha:
            result["mean_alpha_pct"] = float(np.mean(episode_alpha))
        
        return result
    
    def backtest_agent(
        self,
        agent_name: str,
        df: pd.DataFrame,
        config: Optional[AgentConfig] = None,
        enable_short_selling: bool = False,
        slippage_model: str = "proportional",
        slippage_bps: float = 5.0,
    ) -> Dict[str, Any]:
        """
        Run a full backtest of a trained agent over historical data.
        
        Unlike _evaluate_model (which uses random starts), this runs
        the agent from start to end of the data sequentially, producing
        a complete equity curve and detailed trade history.
        
        Args:
            agent_name: Name of the trained agent
            df: DataFrame with OHLCV + indicators (full backtest period)
            config: Agent config (uses saved if not provided)
            enable_short_selling: Allow short selling
            slippage_model: Slippage model type
            slippage_bps: Base slippage in basis points
            
        Returns:
            Detailed backtest results with equity curve, trades, and metrics
        """
        model = self.load_agent(agent_name)
        if model is None:
            raise ValueError(f"Agent not found: {agent_name}")
        
        if config is None:
            config = self._configs.get(agent_name)
            if config is None:
                config = AgentConfig(name=agent_name)
        
        # Create environment for sequential backtest (no random start)
        env = TradingEnvironment(
            df=df,
            config=config,
            enable_short_selling=enable_short_selling,
            slippage_model=slippage_model,
            slippage_bps=slippage_bps,
        )
        
        vec_env = DummyVecEnv([lambda: env])
        
        # Load normalization stats
        norm_path = self.model_dir / agent_name / "vec_normalize.pkl"
        if norm_path.exists():
            vec_env = VecNormalize.load(str(norm_path), vec_env)
            vec_env.training = False
            vec_env.norm_reward = False
        
        # Run backtest from start (no random start)
        obs = vec_env.reset()
        done = False
        total_reward = 0
        equity_curve = []
        actions_taken = []
        step = 0
        
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, reward, done, info = vec_env.step(action)
            total_reward += reward[0]
            step += 1
            
            ep_info = info[0]
            equity_curve.append({
                "step": step,
                "portfolio_value": ep_info.get("portfolio_value", 0),
                "cash": ep_info.get("cash", 0),
                "return_pct": ep_info.get("return_pct", 0),
            })
            
            action_names = ['hold', 'buy_small', 'buy_medium', 'buy_large',
                           'sell_small', 'sell_medium', 'sell_all',
                           'short_small', 'short_medium', 'short_large',
                           'cover_small', 'cover_medium', 'cover_all']
            action_idx = int(action[0])
            if action_idx != 0:  # Don't record holds
                actions_taken.append({
                    "step": step,
                    "action": action_names[action_idx] if action_idx < len(action_names) else "unknown",
                    "portfolio_value": ep_info.get("portfolio_value", 0),
                })
            
            if done[0]:
                break
        
        # Final info contains all metrics
        final_info = info[0]
        
        # Get trade history from the underlying environment
        underlying_env = vec_env.envs[0] if hasattr(vec_env, 'envs') else env
        if hasattr(underlying_env, 'env'):
            underlying_env = underlying_env.env  # unwrap Monitor
        trade_history = getattr(underlying_env, 'trade_history', [])
        
        return {
            "agent_name": agent_name,
            "total_steps": step,
            "total_reward": float(total_reward),
            "final_portfolio_value": final_info.get("portfolio_value", 0),
            "return_pct": final_info.get("return_pct", 0),
            "total_trades": final_info.get("total_trades", 0),
            "winning_trades": final_info.get("winning_trades", 0),
            "losing_trades": final_info.get("losing_trades", 0),
            "win_rate": final_info.get("win_rate", 0),
            "max_drawdown": final_info.get("max_drawdown", 0),
            "sharpe_ratio": final_info.get("sharpe_ratio", 0),
            "sortino_ratio": final_info.get("sortino_ratio", 0),
            "calmar_ratio": final_info.get("calmar_ratio", 0),
            "profit_factor": final_info.get("profit_factor", 0),
            "avg_win": final_info.get("avg_win", 0),
            "avg_loss": final_info.get("avg_loss", 0),
            "total_fees_paid": final_info.get("total_fees_paid", 0),
            "fee_impact_pct": final_info.get("fee_impact_pct", 0),
            "benchmark_return_pct": final_info.get("benchmark_return_pct", 0),
            "alpha_pct": final_info.get("alpha_pct", 0),
            "slippage_model": slippage_model,
            "slippage_bps": slippage_bps,
            "short_selling_enabled": enable_short_selling,
            "equity_curve": equity_curve[-100:] if len(equity_curve) > 100 else equity_curve,  # Last 100 for API
            "equity_curve_full_length": len(equity_curve),
            "trade_history": trade_history[-50:] if len(trade_history) > 50 else trade_history,
            "actions_summary": {
                "total_actions": len(actions_taken),
                "sample": actions_taken[-20:] if len(actions_taken) > 20 else actions_taken,
            },
        }
    
    def load_agent(self, agent_name: str) -> Optional[PPO]:
        """Load a trained agent"""
        if agent_name in self._models:
            return self._models[agent_name]
        
        model_path = self.model_dir / agent_name / "model.zip"
        if not model_path.exists():
            logger.warning(f"Model not found: {agent_name}")
            return None
        
        try:
            model = PPO.load(str(model_path), device=self.device)
            self._models[agent_name] = model
            return model
        except Exception as e:
            logger.error(f"Failed to load model {agent_name}: {e}")
            return None
    
    def get_trading_signal(
        self,
        agent_name: str,
        df: pd.DataFrame,
        config: Optional[AgentConfig] = None,
    ) -> Dict[str, Any]:
        """
        Get trading signal from a trained agent.
        
        Args:
            agent_name: Name of the agent to use
            df: DataFrame with current market data and indicators
            config: Agent config (uses saved config if not provided)
            
        Returns:
            Trading signal with action, confidence, and reasoning
        """
        model = self.load_agent(agent_name)
        if model is None:
            return {
                "error": f"Agent not found: {agent_name}",
                "signal": "hold",
                "confidence": 0,
            }
        
        # Use saved config if not provided
        if config is None:
            config = self._configs.get(agent_name)
            if config is None:
                config = AgentConfig(name=agent_name)
        
        try:
            # Create environment for inference (inference_mode=True starts at end of data)
            env = self.create_environment(df, config, inference_mode=True)
            vec_env = DummyVecEnv([lambda: env])
            
            # Load normalization stats if available
            norm_path = self.model_dir / agent_name / "vec_normalize.pkl"
            if norm_path.exists():
                vec_env = VecNormalize.load(str(norm_path), vec_env)
                vec_env.training = False
                vec_env.norm_reward = False
            
            # Get current observation (at end of data due to inference_mode)
            obs = vec_env.reset()
            
            # Get action probabilities (deterministic=True for consistent signals)
            action, _ = model.predict(obs, deterministic=True)
            
            # Get action distribution for confidence
            with torch.no_grad():
                obs_tensor = torch.tensor(obs).to(self.device)
                distribution = model.policy.get_distribution(obs_tensor)
                action_probs = distribution.distribution.probs.cpu().numpy()[0]
            
            # Map action to signal
            action_names = ['hold', 'buy_small', 'buy_medium', 'buy_large', 
                           'sell_small', 'sell_medium', 'sell_all']
            action_idx = int(action[0])
            
            # Determine overall signal direction
            if action_idx in [1, 2, 3]:
                signal = "buy"
                strength = ["weak", "moderate", "strong"][action_idx - 1]
            elif action_idx in [4, 5, 6]:
                signal = "sell"
                strength = ["weak", "moderate", "strong"][action_idx - 4]
            else:
                signal = "hold"
                strength = "neutral"
            
            confidence = float(action_probs[action_idx])
            
            return {
                "signal": signal,
                "action": action_names[action_idx],
                "strength": strength,
                "confidence": confidence,
                "action_probabilities": {
                    name: float(prob) 
                    for name, prob in zip(action_names, action_probs)
                },
                "agent_name": agent_name,
                "agent_style": config.trading_style if config else "unknown",
                "holding_period": config.holding_period if config else "unknown",
            }
            
        except Exception as e:
            logger.error(f"Error getting signal from {agent_name}: {e}")
            return {
                "error": str(e),
                "signal": "hold",
                "confidence": 0,
            }
    
    def get_signal_with_explanation(
        self,
        agent_name: str,
        df: pd.DataFrame,
        config: Optional[AgentConfig] = None,
    ) -> Dict[str, Any]:
        """
        Get trading signal with detailed, data-based explanation.
        
        This provides HONEST explanations based on actual data - no hallucinations.
        We explain:
        1. What market data the model observed
        2. Which features had the strongest influence on the decision
        3. The probability distribution across all possible actions
        4. The agent's configuration and what it's optimized for
        
        Args:
            agent_name: Name of the agent to use
            df: DataFrame with current market data and indicators
            config: Agent config (uses saved config if not provided)
            
        Returns:
            Signal with comprehensive explanation
        """
        model = self.load_agent(agent_name)
        if model is None:
            return {
                "error": f"Agent not found: {agent_name}",
                "signal": "hold",
                "confidence": 0,
            }
        
        if config is None:
            config = self._configs.get(agent_name)
            if config is None:
                config = AgentConfig(name=agent_name)
        
        try:
            # Create environment for inference
            env = self.create_environment(df, config, inference_mode=True)
            vec_env = DummyVecEnv([lambda: env])
            
            # Load normalization
            norm_path = self.model_dir / agent_name / "vec_normalize.pkl"
            if norm_path.exists():
                vec_env = VecNormalize.load(str(norm_path), vec_env)
                vec_env.training = False
                vec_env.norm_reward = False
            
            # Get observation
            obs = vec_env.reset()
            
            # Get action and probabilities
            action, _ = model.predict(obs, deterministic=True)
            
            with torch.no_grad():
                obs_tensor = torch.tensor(obs).to(self.device)
                distribution = model.policy.get_distribution(obs_tensor)
                action_probs = distribution.distribution.probs.cpu().numpy()[0]
            
            action_names = ['hold', 'buy_small', 'buy_medium', 'buy_large', 
                           'sell_small', 'sell_medium', 'sell_all']
            action_idx = int(action[0])
            chosen_action = action_names[action_idx]
            
            # === FEATURE IMPORTANCE via Gradient-based sensitivity ===
            # We'll use a simpler approach: measure how much the action probabilities change
            # when we significantly perturb each feature in the UNNORMALIZED space
            feature_importance = {}
            base_prob = float(action_probs[action_idx])
            
            # Get feature info from environment
            feature_cols = env.feature_columns
            portfolio_features = ['cash_ratio', 'position_ratio', 'unrealized_pnl', 
                                 'holding_time_ratio', 'current_drawdown']
            
            # Create a fresh environment without normalization for perturbation testing
            test_env = self.create_environment(df, config, inference_mode=True)
            test_vec_env = DummyVecEnv([lambda: test_env])
            
            # Get the raw unnormalized observation
            raw_obs = test_vec_env.reset()
            
            window_size = env.window_size
            n_features = len(feature_cols)
            obs_size = raw_obs.shape[1]
            market_features_end = obs_size - 5
            
            # Test perturbations on raw (unnormalized) observations
            # We'll apply the normalization manually after perturbation
            norm_path = self.model_dir / agent_name / "vec_normalize.pkl"
            
            for i, feature_name in enumerate(feature_cols):
                feature_idx = (window_size - 1) * n_features + i
                if feature_idx < market_features_end:
                    # Create perturbed raw observation
                    perturbed_raw = raw_obs.copy()
                    original_val = raw_obs[0, feature_idx]
                    
                    # Use significant perturbation (double or halve the value)
                    if abs(original_val) > 0.001:
                        perturbed_raw[0, feature_idx] = original_val * 2.0
                    else:
                        perturbed_raw[0, feature_idx] = 0.1
                    
                    # Normalize the perturbed observation if we have normalization stats
                    if norm_path.exists():
                        # Load fresh normalizer and normalize the perturbed obs
                        test_norm_env = VecNormalize.load(str(norm_path), DummyVecEnv([lambda: test_env]))
                        test_norm_env.training = False
                        test_norm_env.norm_reward = False
                        # Manually normalize
                        perturbed_normalized = test_norm_env.normalize_obs(perturbed_raw)
                    else:
                        perturbed_normalized = perturbed_raw
                    
                    with torch.no_grad():
                        perturbed_tensor = torch.tensor(perturbed_normalized, dtype=torch.float32).to(self.device)
                        perturbed_dist = model.policy.get_distribution(perturbed_tensor)
                        perturbed_probs = perturbed_dist.distribution.probs.cpu().numpy()[0]
                    
                    # Calculate impact as change in probability
                    impact = abs(float(perturbed_probs[action_idx]) - base_prob)
                    feature_importance[feature_name] = round(impact * 100, 2)
            
            # Portfolio features importance
            for i, feature_name in enumerate(portfolio_features):
                feature_idx = market_features_end + i
                if feature_idx < obs_size:
                    perturbed_raw = raw_obs.copy()
                    original_val = raw_obs[0, feature_idx]
                    
                    if abs(original_val) > 0.001:
                        perturbed_raw[0, feature_idx] = original_val * 2.0
                    else:
                        perturbed_raw[0, feature_idx] = 0.5
                    
                    if norm_path.exists():
                        test_norm_env = VecNormalize.load(str(norm_path), DummyVecEnv([lambda: test_env]))
                        test_norm_env.training = False
                        test_norm_env.norm_reward = False
                        perturbed_normalized = test_norm_env.normalize_obs(perturbed_raw)
                    else:
                        perturbed_normalized = perturbed_raw
                    
                    with torch.no_grad():
                        perturbed_tensor = torch.tensor(perturbed_normalized, dtype=torch.float32).to(self.device)
                        perturbed_dist = model.policy.get_distribution(perturbed_tensor)
                        perturbed_probs = perturbed_dist.distribution.probs.cpu().numpy()[0]
                    
                    impact = abs(float(perturbed_probs[action_idx]) - base_prob)
                    feature_importance[feature_name] = round(impact * 100, 2)
            
            # Sort by importance
            sorted_importance = dict(sorted(feature_importance.items(), 
                                           key=lambda x: x[1], reverse=True))
            top_factors = dict(list(sorted_importance.items())[:10])
            
            # === EXTRACT CURRENT MARKET STATE ===
            current_row = df.iloc[-1]
            market_state = {}
            
            # Key indicators
            indicator_mapping = {
                'close': 'Aktueller Kurs',
                'rsi': 'RSI (Relative Strength Index)',
                'macd': 'MACD',
                'macd_signal': 'MACD Signal',
                'bb_pct': 'Bollinger Band Position (%)',
                'atr_pct': 'ATR (Volatilität %)',
                'adx': 'ADX (Trendstärke)',
                'stoch_k': 'Stochastic %K',
                'mfi': 'Money Flow Index',
                'trend_strength': 'Trendstärke',
                'volatility': 'Volatilität',
            }
            
            for col, label in indicator_mapping.items():
                if col in current_row.index and not pd.isna(current_row[col]):
                    value = float(current_row[col])
                    market_state[label] = round(value, 4) if col not in ['close'] else round(value, 2)
            
            # === GENERATE EXPLANATION ===
            # Determine signal direction
            if action_idx in [1, 2, 3]:
                signal = "buy"
                strength = ["weak", "moderate", "strong"][action_idx - 1]
            elif action_idx in [4, 5, 6]:
                signal = "sell"
                strength = ["weak", "moderate", "strong"][action_idx - 4]
            else:
                signal = "hold"
                strength = "neutral"
            
            confidence = float(action_probs[action_idx])
            
            # Build textual explanation based on actual data
            explanation_parts = []
            
            # 1. Decision overview
            buy_prob = sum(action_probs[1:4])
            sell_prob = sum(action_probs[4:7])
            hold_prob = action_probs[0]
            
            explanation_parts.append(
                f"Der Agent '{agent_name}' (Stil: {config.trading_style}, "
                f"Haltedauer: {config.holding_period}) hat sich für '{chosen_action}' entschieden."
            )
            
            # 2. Probability breakdown
            explanation_parts.append(
                f"\n\nWahrscheinlichkeitsverteilung:\n"
                f"- Kaufen (gesamt): {buy_prob*100:.1f}%\n"
                f"- Verkaufen (gesamt): {sell_prob*100:.1f}%\n"
                f"- Halten: {hold_prob*100:.1f}%"
            )
            
            # 3. Top influencing factors
            if top_factors:
                factors_text = "\n\nTop-Einflussfaktoren (Impact auf Entscheidung):\n"
                for factor, impact in list(top_factors.items())[:5]:
                    factors_text += f"- {factor}: {impact}% Einfluss\n"
                explanation_parts.append(factors_text)
            
            # 4. Key market indicators
            key_indicators = []
            if 'RSI (Relative Strength Index)' in market_state:
                rsi = market_state['RSI (Relative Strength Index)']
                if rsi > 70:
                    key_indicators.append(f"RSI bei {rsi:.0f} (überkauft)")
                elif rsi < 30:
                    key_indicators.append(f"RSI bei {rsi:.0f} (überverkauft)")
                else:
                    key_indicators.append(f"RSI bei {rsi:.0f} (neutral)")
            
            if 'MACD' in market_state and 'MACD Signal' in market_state:
                macd = market_state['MACD']
                signal_line = market_state['MACD Signal']
                if macd > signal_line:
                    key_indicators.append("MACD über Signal-Linie (bullish)")
                else:
                    key_indicators.append("MACD unter Signal-Linie (bearish)")
            
            if 'ADX (Trendstärke)' in market_state:
                adx = market_state['ADX (Trendstärke)']
                if adx > 25:
                    key_indicators.append(f"Starker Trend (ADX: {adx:.0f})")
                else:
                    key_indicators.append(f"Schwacher/Kein Trend (ADX: {adx:.0f})")
            
            if key_indicators:
                explanation_parts.append("\n\nMarktindikatoren:\n- " + "\n- ".join(key_indicators))
            
            # 5. Agent context
            explanation_parts.append(
                f"\n\nAgent-Kontext:\n"
                f"- Risikoprofil: {config.risk_profile}\n"
                f"- Trading-Stil: {config.trading_style}\n"
                f"- Ziel-Haltedauer: {config.holding_period}\n"
                f"- Broker-Profil: {config.broker_profile}"
            )
            
            # 6. Disclaimer
            explanation_parts.append(
                "\n\n⚠️ Hinweis: Diese Erklärung basiert auf den tatsächlichen Eingabedaten "
                "und gemessenen Feature-Einflüssen. Das neuronale Netzwerk trifft Entscheidungen "
                "basierend auf Mustern, die es während des Trainings gelernt hat - die genaue "
                "interne Logik ist nicht vollständig interpretierbar."
            )
            
            full_explanation = "".join(explanation_parts)
            
            return {
                "signal": signal,
                "action": chosen_action,
                "strength": strength,
                "confidence": confidence,
                "action_probabilities": {
                    name: float(prob) 
                    for name, prob in zip(action_names, action_probs)
                },
                "agent_name": agent_name,
                "agent_style": config.trading_style,
                "holding_period": config.holding_period,
                "explanation": full_explanation,
                "feature_importance": top_factors,
                "market_state": market_state,
                "probability_summary": {
                    "buy_total": float(buy_prob),
                    "sell_total": float(sell_prob),
                    "hold": float(hold_prob),
                },
                "agent_config": {
                    "risk_profile": config.risk_profile,
                    "trading_style": config.trading_style,
                    "holding_period": config.holding_period,
                    "broker_profile": config.broker_profile,
                    "stop_loss_percent": config.stop_loss_percent,
                    "take_profit_percent": config.take_profit_percent,
                }
            }
            
        except Exception as e:
            logger.error(f"Error getting explained signal from {agent_name}: {e}")
            import traceback
            traceback.print_exc()
            return {
                "error": str(e),
                "signal": "hold",
                "confidence": 0,
            }
    
    def delete_agent(self, agent_name: str) -> bool:
        """Delete an agent and its saved data"""
        import shutil
        
        # Remove from cache
        self._models.pop(agent_name, None)
        self._configs.pop(agent_name, None)
        self._training_status.pop(agent_name, None)
        
        # Remove files
        model_path = self.model_dir / agent_name
        checkpoint_path = self.checkpoint_dir / agent_name
        
        try:
            if model_path.exists():
                shutil.rmtree(model_path)
            if checkpoint_path.exists():
                shutil.rmtree(checkpoint_path)
            return True
        except Exception as e:
            logger.error(f"Failed to delete agent {agent_name}: {e}")
            return False


# Global trainer instance
trainer = TradingAgentTrainer()
