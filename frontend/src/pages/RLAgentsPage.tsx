/**
 * RL Agents Page
 * 
 * Dedicated page for managing and training Deep Reinforcement Learning trading agents.
 * Provides full control over agent lifecycle and detailed performance monitoring.
 */

import { useState, useEffect } from 'react';
import { RLAgentsPanel } from '../components';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import { rlTradingService, type RLServiceHealth } from '../services/rlTradingService';

export default function RLAgentsPage() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [health, setHealth] = useState<RLServiceHealth | null>(null);

  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  useEffect(() => {
    loadHealth();
  }, []);

  const loadHealth = async () => {
    const healthData = await rlTradingService.getHealth();
    setHealth(healthData);
  };

  if (!authState.isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-slate-800 rounded-lg p-8 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">🤖 RL Trading Agents</h2>
            <p className="text-slate-400 mb-4">
              Please log in to access RL Trading Agents.
            </p>
            <a 
              href="/" 
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Go to Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">🤖 RL Trading Agents</h1>
          <p className="text-slate-400">
            Train and manage Deep Reinforcement Learning virtual traders
          </p>
        </div>

        {/* Service Status */}
        {health && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-sm text-slate-400">Service Status</div>
              <div className={`text-lg font-bold ${health.status === 'healthy' ? 'text-green-400' : 'text-red-400'}`}>
                {health.status === 'healthy' ? '✓ Online' : '✗ Offline'}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-sm text-slate-400">Compute Device</div>
              <div className="text-lg font-bold text-white">
                {health.device_info.device === 'cuda' ? '🚀 GPU (CUDA)' : '💻 CPU'}
              </div>
            </div>
            {health.device_info.cuda_device_name && (
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="text-sm text-slate-400">GPU Model</div>
                <div className="text-lg font-bold text-white truncate">
                  {health.device_info.cuda_device_name}
                </div>
              </div>
            )}
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-sm text-slate-400">Version</div>
              <div className="text-lg font-bold text-white">
                v{health.version}
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agents Panel */}
          <div className="lg:col-span-2">
            <RLAgentsPanel />
          </div>

          {/* Info & Help */}
          <div className="space-y-4">
            <div className="bg-slate-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">📚 How It Works</h3>
              <div className="text-sm text-slate-400 space-y-3">
                <p>
                  RL Trading Agents use <strong className="text-white">Deep Reinforcement Learning</strong> (PPO algorithm) 
                  to learn trading strategies from historical market data.
                </p>
                <p>
                  Each agent is trained to maximize profit while respecting your configured 
                  risk parameters like stop-loss and take-profit levels.
                </p>
                <p>
                  Once trained, agents can provide <strong className="text-white">trading signals</strong> that 
                  appear as advisors in the Trading Signals panel.
                </p>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">⚙️ Configuration Tips</h3>
              <ul className="text-sm text-slate-400 space-y-2">
                <li>
                  <strong className="text-blue-400">Holding Period:</strong> Match your trading style - 
                  scalping for quick trades, position for longer holds.
                </li>
                <li>
                  <strong className="text-blue-400">Risk Profile:</strong> Higher risk = larger positions 
                  and wider stop-loss levels.
                </li>
                <li>
                  <strong className="text-blue-400">Training Symbols:</strong> Use diverse stocks for 
                  more robust learning.
                </li>
                <li>
                  <strong className="text-blue-400">Timesteps:</strong> More timesteps = better training 
                  but longer time. Start with 100k.
                </li>
              </ul>
            </div>

            <div className="bg-slate-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">🎯 Preset Agents</h3>
              <div className="text-sm text-slate-400 space-y-2">
                <div>
                  <strong className="text-green-400">Conservative Swing:</strong> Low risk, 
                  trend-following, 3-7 day holds.
                </div>
                <div>
                  <strong className="text-red-400">Aggressive Momentum:</strong> High risk, 
                  momentum-based, 1-3 day holds.
                </div>
                <div>
                  <strong className="text-yellow-400">Day Trader:</strong> Moderate risk, 
                  mean reversion, intraday.
                </div>
                <div>
                  <strong className="text-purple-400">Position Investor:</strong> Low risk, 
                  long-term trend following.
                </div>
              </div>
            </div>

            {health?.device_info.device !== 'cuda' && (
              <div className="bg-amber-900/30 border border-amber-600 rounded-lg p-4">
                <h4 className="text-amber-400 font-medium mb-2">💡 GPU Acceleration</h4>
                <p className="text-sm text-amber-200/80">
                  Training runs on CPU. For faster training, enable GPU support by 
                  running with the GPU docker-compose override.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
