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
    ) -> TradingEnvironment:
        """Create a trading environment with given data and config"""
        return TradingEnvironment(df=df, config=config)
    
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
            
            log(f"🧠 Creating PPO model...")
            log(f"   Architecture: [256, 256] hidden layers")
            log(f"   Learning rate: {config.learning_rate}")
            log(f"   Gamma: {config.gamma}")
            
            # Create PPO model
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
            # Create environment for inference
            env = self.create_environment(df, config)
            vec_env = DummyVecEnv([lambda: env])
            
            # Load normalization stats if available
            norm_path = self.model_dir / agent_name / "vec_normalize.pkl"
            if norm_path.exists():
                vec_env = VecNormalize.load(str(norm_path), vec_env)
                vec_env.training = False
                vec_env.norm_reward = False
            
            # Get current observation
            obs = vec_env.reset()
            
            # Get action probabilities
            action, _ = model.predict(obs, deterministic=False)
            
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
