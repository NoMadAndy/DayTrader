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
        self.best_reward = -np.inf
        self.episode_rewards = []
        self.episode_lengths = []
        self.last_log_timestep = 0
        self.log_interval = max(1000, total_timesteps // 100)  # Log every 1% or 1000 steps
        
    def _log(self, message: str, level: str = "info"):
        """Emit a log message"""
        if self.log_callback:
            self.log_callback(message, level)
        
    def _on_training_start(self) -> None:
        self._log(f"🚀 Training started for agent '{self.agent_name}'")
        self._log(f"   Total timesteps: {self.total_timesteps:,}")
        self._log(f"   Device: {self.model.device}")
        
    def _on_step(self) -> bool:
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
            
            if reward > self.best_reward:
                old_best = self.best_reward
                self.best_reward = reward
                if old_best > -np.inf:
                    self._log(f"🏆 New best reward: {self.best_reward:.2f} (was {old_best:.2f})", "success")
        
        # Calculate progress
        progress = self.num_timesteps / self.total_timesteps
        
        # Log progress at intervals
        if self.num_timesteps - self.last_log_timestep >= self.log_interval:
            self.last_log_timestep = self.num_timesteps
            pct = progress * 100
            mean_rew = np.mean(self.episode_rewards[-100:]) if self.episode_rewards else 0
            self._log(f"⏳ Progress: {pct:.1f}% ({self.num_timesteps:,}/{self.total_timesteps:,} steps) | Mean reward: {mean_rew:.2f}")
        
        if self.progress_callback:
            self.progress_callback({
                "agent_name": self.agent_name,
                "progress": progress,
                "timesteps": self.num_timesteps,
                "total_timesteps": self.total_timesteps,
                "episodes": len(self.episode_rewards),
                "mean_reward": np.mean(self.episode_rewards[-100:]) if self.episode_rewards else 0,
                "best_reward": self.best_reward,
            })
        
        return True
    
    def _on_training_end(self) -> None:
        self._log(f"✅ Training completed!")
        self._log(f"   Total episodes: {len(self.episode_rewards)}")
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
        return TradingEnvironment(df=df, config=config, inference_mode=inference_mode)
    
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
            
        Returns:
            Training results dictionary
        """
        logger.info(f"Starting training for agent: {agent_name}")
        
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
    ) -> Dict[str, Any]:
        """Synchronous training implementation (runs in thread pool)"""
        
        def log(msg: str, level: str = "info"):
            """Helper to emit logs"""
            if log_callback:
                log_callback(msg, level)
            logger.info(msg) if level == "info" else logger.warning(msg)
        
        try:
            log(f"📦 Preparing training data for {len(training_data)} symbol(s)...")
            
            # Create environments for each symbol
            envs = []
            for symbol, df in training_data.items():
                if len(df) < 200:
                    log(f"⚠️ Skipping {symbol}: insufficient data ({len(df)} rows)", "warning")
                    continue
                
                log(f"   ✓ {symbol}: {len(df)} data points")
                env = self.create_environment(df, config)
                env = Monitor(env)
                envs.append(env)
            
            if not envs:
                raise ValueError("No valid training data provided")
            
            # Create vectorized environment (round-robin across symbols)
            def make_env_fn(idx):
                def _init():
                    return envs[idx % len(envs)]
                return _init
            
            # Use first env for now (TODO: implement multi-symbol training)
            vec_env = DummyVecEnv([make_env_fn(0)])
            
            # Optionally normalize observations
            vec_env = VecNormalize(
                vec_env,
                norm_obs=True,
                norm_reward=True,
                clip_obs=10.0,
            )
            
            # Determine architecture based on config
            use_transformer = getattr(config, 'use_transformer_policy', False)
            
            # Log GPU usage if enabled
            if settings.device == "cuda" and torch.cuda.is_available():
                log(f"🚀 GPU Training enabled: {torch.cuda.get_device_name(0)}")
                log(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
            
            if use_transformer:
                log(f"🧠 Creating PPO model with Transformer architecture...")
                log(f"   d_model: {config.transformer_d_model}")
                log(f"   n_heads: {config.transformer_n_heads}")
                log(f"   n_layers: {config.transformer_n_layers}")
                log(f"   d_ff: {config.transformer_d_ff}")
                log(f"   dropout: {config.transformer_dropout}")
                log(f"   Learning rate: {config.learning_rate}")
                log(f"   Gamma: {config.gamma}")
                
                # Suppress misleading SB3 GPU warning for transformer architecture
                # Our TransformerFeaturesExtractor contains CNN+Transformer (~2.5-3M params)
                # and significantly benefits from GPU acceleration
                warnings.filterwarnings(
                    "ignore",
                    message=".*GPU.*primarily intended to run on the CPU.*",
                    category=UserWarning,
                    module="stable_baselines3.*"
                )
                
                # Import transformer components
                from .networks import TransformerFeaturesExtractor
                
                # Get observation space to calculate input dimensions
                obs_space = vec_env.observation_space
                
                # Create policy kwargs with custom features extractor
                policy_kwargs = dict(
                    features_extractor_class=TransformerFeaturesExtractor,
                    features_extractor_kwargs=dict(
                        seq_len=getattr(config, 'lookback_window', settings.default_lookback_window),
                        d_model=config.transformer_d_model,
                        n_heads=config.transformer_n_heads,
                        n_layers=config.transformer_n_layers,
                        d_ff=config.transformer_d_ff,
                        dropout=config.transformer_dropout,
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
                log(f"   Learning rate: {config.learning_rate}")
                log(f"   Gamma: {config.gamma}")
                
                # Create PPO model with standard MLP
                policy_kwargs = dict(
                    net_arch=dict(pi=[256, 256], vf=[256, 256]),
                    activation_fn=torch.nn.ReLU,
                )
            
            model = PPO(
                policy="MlpPolicy",
                env=vec_env,
                learning_rate=config.learning_rate,
                n_steps=settings.default_n_steps,
                batch_size=settings.default_batch_size,
                n_epochs=10,
                gamma=config.gamma,
                ent_coef=config.ent_coef,
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
            log(f"🎯 Starting training for {total_timesteps:,} timesteps...")
            start_time = datetime.now()
            model.learn(
                total_timesteps=total_timesteps,
                callback=[progress_cb, checkpoint_cb],
                progress_bar=False,  # Disabled in container, use callback for progress
            )
            training_duration = (datetime.now() - start_time).total_seconds()
            
            log(f"💾 Saving model...")
            # Save model
            model_path = self.model_dir / agent_name
            model_path.mkdir(parents=True, exist_ok=True)
            
            model.save(str(model_path / "model"))
            vec_env.save(str(model_path / "vec_normalize.pkl"))
            
            # Evaluate model
            log(f"📈 Evaluating model performance...")
            eval_results = self._evaluate_model(model, vec_env, n_episodes=10)
            log(f"   Mean return: {eval_results['mean_return_pct']:.2f}%")
            log(f"   Max return: {eval_results['max_return_pct']:.2f}%")
            log(f"   Min return: {eval_results['min_return_pct']:.2f}%")
            
            # Save metadata
            metadata = {
                "agent_name": agent_name,
                "config": config.model_dump(),
                "trained_at": datetime.now().isoformat(),
                "training_duration_seconds": training_duration,
                "total_timesteps": total_timesteps,
                "total_episodes": len(progress_cb.episode_rewards),
                "best_reward": progress_cb.best_reward,
                "device": self.device,
                "performance_metrics": eval_results,
                "symbols_trained": list(training_data.keys()),
            }
            
            with open(model_path / "metadata.json", 'w') as f:
                json.dump(metadata, f, indent=2)
            
            # Update status
            self._models[agent_name] = model
            self._training_status[agent_name] = AgentStatus(
                name=agent_name,
                status="trained",
                is_trained=True,
                last_trained=metadata['trained_at'],
                total_episodes=metadata['total_episodes'],
                best_reward=metadata['best_reward'],
                config=config,
                performance_metrics=eval_results,
            )
            
            log(f"🎉 Training completed in {training_duration:.1f}s!")
            log(f"   Model saved to: {model_path}")
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
        """Evaluate a trained model with varied starting points"""
        episode_rewards = []
        episode_lengths = []
        episode_returns = []
        
        for i in range(n_episodes):
            # Set random seed before reset to get varied start positions
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
                    if 'return_pct' in info[0]:
                        episode_returns.append(info[0]['return_pct'])
                    break
            
            episode_rewards.append(total_reward)
            episode_lengths.append(length)
        
        return {
            "mean_reward": float(np.mean(episode_rewards)),
            "std_reward": float(np.std(episode_rewards)),
            "mean_length": float(np.mean(episode_lengths)),
            "mean_return_pct": float(np.mean(episode_returns)) if episode_returns else 0,
            "max_return_pct": float(np.max(episode_returns)) if episode_returns else 0,
            "min_return_pct": float(np.min(episode_returns)) if episode_returns else 0,
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
