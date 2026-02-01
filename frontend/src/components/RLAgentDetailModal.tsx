/**
 * RLAgentDetailModal - Detailed view of an RL Agent
 * Shows configuration, training logs, and signal explanation
 */

import { useState, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { getAuthHeaders } from '../services/authService';

interface AgentConfig {
  agentName: string;
  algorithm?: string;
  totalTimesteps?: number;
  learningRate?: number;
  gamma?: number;
  clipRange?: number;
  entCoef?: number;
  vfCoef?: number;
  networkArch?: string;
  observationSpace?: number;
  actionSpace?: number;
  trainingSymbols?: string[];
  createdAt?: string;
  lastTrained?: string;
  performance?: {
    meanReward?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    winRate?: number;
  };
}

interface TrainingLog {
  timestamp: string;
  episode?: number;
  timestep?: number;
  reward?: number;
  loss?: number;
  entropy?: number;
  message?: string;
}

interface SignalExplanation {
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  factors: Array<{
    name: string;
    value: number;
    contribution: number;
    description?: string;
  }>;
  marketCondition?: string;
  riskAssessment?: string;
}

interface RLAgentDetailModalProps {
  agentName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function RLAgentDetailModal({ agentName, isOpen, onClose }: RLAgentDetailModalProps) {
  const { } = useSettings();
  const [agent, setAgent] = useState<AgentConfig | null>(null);
  const [logs, setLogs] = useState<TrainingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'config' | 'logs' | 'explain'>('config');
  const [explainSymbol, setExplainSymbol] = useState('AAPL');
  const [explanation, setExplanation] = useState<SignalExplanation | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !agentName) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [agentRes, logsRes] = await Promise.allSettled([
          fetch(`/api/rl/agents/${encodeURIComponent(agentName)}`),
          fetch(`/api/rl/train/logs/${encodeURIComponent(agentName)}`),
        ]);

        if (agentRes.status === 'fulfilled' && agentRes.value.ok) {
          setAgent(await agentRes.value.json());
        }

        if (logsRes.status === 'fulfilled' && logsRes.value.ok) {
          const data = await logsRes.value.json();
          setLogs(data.logs || []);
        }
      } catch (error) {
        console.error('Failed to fetch agent details:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [agentName, isOpen]);

  const fetchExplanation = async () => {
    if (!explainSymbol) return;
    
    setExplainLoading(true);
    try {
      // First get current market data
      const quoteRes = await fetch(`/api/yahoo/quote/${encodeURIComponent(explainSymbol)}`);
      if (!quoteRes.ok) throw new Error('Kursdaten nicht verfügbar');
      const quoteData = await quoteRes.json();

      // Then get explanation
      const response = await fetch('/api/rl/signal/explain', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          agentName,
          symbol: explainSymbol,
          currentPrice: quoteData.quote?.regularMarketPrice || quoteData.price,
          marketData: quoteData,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setExplanation(data);
      }
    } catch (error) {
      console.error('Failed to get explanation:', error);
    } finally {
      setExplainLoading(false);
    }
  };

  if (!isOpen) return null;

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'buy': return 'text-green-400 bg-green-500/20';
      case 'sell': return 'text-red-400 bg-red-500/20';
      default: return 'text-yellow-400 bg-yellow-500/20';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden border border-slate-700 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span>🤖</span>
              {agentName}
            </h2>
            {agent?.algorithm && (
              <p className="text-sm text-gray-400">{agent.algorithm} Agent</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700">
          {[
            { id: 'config', label: '⚙️ Konfiguration' },
            { id: 'logs', label: '📜 Training Logs' },
            { id: 'explain', label: '💡 Signal-Erklärung' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-700/30'
                  : 'text-gray-400 hover:text-gray-300 hover:bg-slate-700/20'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[calc(90vh-140px)]">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin text-4xl mb-4">⟳</div>
              <p className="text-gray-400">Lade Agent-Details...</p>
            </div>
          ) : activeTab === 'config' ? (
            <div className="space-y-6">
              {/* Performance Metrics */}
              {agent?.performance && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">📊 Performance</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {agent.performance.meanReward !== undefined && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Ø Reward</div>
                        <div className={`text-lg font-bold ${agent.performance.meanReward >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {agent.performance.meanReward.toFixed(2)}
                        </div>
                      </div>
                    )}
                    {agent.performance.sharpeRatio !== undefined && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Sharpe Ratio</div>
                        <div className="text-lg font-bold text-blue-400">
                          {agent.performance.sharpeRatio.toFixed(2)}
                        </div>
                      </div>
                    )}
                    {agent.performance.winRate !== undefined && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Win Rate</div>
                        <div className="text-lg font-bold text-green-400">
                          {(agent.performance.winRate * 100).toFixed(1)}%
                        </div>
                      </div>
                    )}
                    {agent.performance.maxDrawdown !== undefined && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Max Drawdown</div>
                        <div className="text-lg font-bold text-red-400">
                          {(agent.performance.maxDrawdown * 100).toFixed(1)}%
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Training Configuration */}
              <div>
                <h3 className="text-lg font-semibold mb-3">🎯 Training-Konfiguration</h3>
                <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    {agent?.totalTimesteps && (
                      <div>
                        <span className="text-gray-400 text-sm">Timesteps:</span>
                        <span className="ml-2 font-medium">{agent.totalTimesteps.toLocaleString()}</span>
                      </div>
                    )}
                    {agent?.learningRate && (
                      <div>
                        <span className="text-gray-400 text-sm">Learning Rate:</span>
                        <span className="ml-2 font-medium">{agent.learningRate}</span>
                      </div>
                    )}
                    {agent?.gamma && (
                      <div>
                        <span className="text-gray-400 text-sm">Gamma:</span>
                        <span className="ml-2 font-medium">{agent.gamma}</span>
                      </div>
                    )}
                    {agent?.clipRange && (
                      <div>
                        <span className="text-gray-400 text-sm">Clip Range:</span>
                        <span className="ml-2 font-medium">{agent.clipRange}</span>
                      </div>
                    )}
                    {agent?.entCoef && (
                      <div>
                        <span className="text-gray-400 text-sm">Entropy Coef:</span>
                        <span className="ml-2 font-medium">{agent.entCoef}</span>
                      </div>
                    )}
                    {agent?.networkArch && (
                      <div className="col-span-2">
                        <span className="text-gray-400 text-sm">Network:</span>
                        <span className="ml-2 font-medium">{agent.networkArch}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Training Symbols */}
              {agent?.trainingSymbols && agent.trainingSymbols.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">📈 Training-Symbole</h3>
                  <div className="flex flex-wrap gap-2">
                    {agent.trainingSymbols.map((symbol) => (
                      <span key={symbol} className="px-3 py-1 bg-slate-700 rounded-lg text-sm">
                        {symbol}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700 text-sm">
                {agent?.createdAt && (
                  <div>
                    <span className="text-gray-400">Erstellt:</span>
                    <span className="ml-2">{new Date(agent.createdAt).toLocaleString('de-DE')}</span>
                  </div>
                )}
                {agent?.lastTrained && (
                  <div>
                    <span className="text-gray-400">Letztes Training:</span>
                    <span className="ml-2">{new Date(agent.lastTrained).toLocaleString('de-DE')}</span>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'logs' ? (
            <div>
              {logs.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-4xl mb-3">📭</div>
                  <p>Keine Training-Logs verfügbar</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {logs.slice(-50).reverse().map((log, idx) => (
                    <div key={idx} className="bg-slate-700/50 rounded-lg p-3 font-mono text-sm">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-gray-400 text-xs">
                          {new Date(log.timestamp).toLocaleString('de-DE')}
                        </span>
                        {log.episode !== undefined && (
                          <span className="text-blue-400 text-xs">Episode {log.episode}</span>
                        )}
                      </div>
                      {log.message && <p className="text-gray-300">{log.message}</p>}
                      <div className="flex gap-4 mt-1 text-xs">
                        {log.reward !== undefined && (
                          <span className={log.reward >= 0 ? 'text-green-400' : 'text-red-400'}>
                            Reward: {log.reward.toFixed(3)}
                          </span>
                        )}
                        {log.loss !== undefined && (
                          <span className="text-yellow-400">Loss: {log.loss.toFixed(4)}</span>
                        )}
                        {log.entropy !== undefined && (
                          <span className="text-purple-400">Entropy: {log.entropy.toFixed(4)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Symbol Input */}
              <div className="flex gap-3">
                <input
                  type="text"
                  value={explainSymbol}
                  onChange={(e) => setExplainSymbol(e.target.value.toUpperCase())}
                  placeholder="Symbol eingeben..."
                  className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={fetchExplanation}
                  disabled={explainLoading || !explainSymbol}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {explainLoading ? '⟳' : '🔍'} Analysieren
                </button>
              </div>

              {/* Explanation Result */}
              {explanation ? (
                <div className="space-y-4">
                  {/* Signal Summary */}
                  <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`text-3xl p-2 rounded-lg ${getSignalColor(explanation.signal)}`}>
                        {explanation.signal === 'buy' ? '📈' : explanation.signal === 'sell' ? '📉' : '⏸️'}
                      </div>
                      <div>
                        <div className={`text-xl font-bold uppercase ${getSignalColor(explanation.signal).split(' ')[0]}`}>
                          {explanation.signal}
                        </div>
                        <div className="text-sm text-gray-400">Empfehlung für {explainSymbol}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-400">
                        {(explanation.confidence * 100).toFixed(0)}%
                      </div>
                      <div className="text-sm text-gray-400">Konfidenz</div>
                    </div>
                  </div>

                  {/* Factors */}
                  {explanation.factors && explanation.factors.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3">Einflussfaktoren</h4>
                      <div className="space-y-2">
                        {explanation.factors.map((factor, idx) => (
                          <div key={idx} className="bg-slate-700/50 rounded-lg p-3">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-medium">{factor.name}</span>
                              <span className={`text-sm ${factor.contribution >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {factor.contribution >= 0 ? '+' : ''}{(factor.contribution * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div className="w-full bg-slate-600 rounded-full h-1.5">
                              <div 
                                className={`h-1.5 rounded-full ${factor.contribution >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                                style={{ width: `${Math.abs(factor.contribution) * 100}%` }}
                              />
                            </div>
                            {factor.description && (
                              <p className="text-xs text-gray-400 mt-1">{factor.description}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Market Condition & Risk */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {explanation.marketCondition && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="text-sm text-gray-400 mb-1">Marktbedingung</div>
                        <div className="font-medium">{explanation.marketCondition}</div>
                      </div>
                    )}
                    {explanation.riskAssessment && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="text-sm text-gray-400 mb-1">Risiko-Einschätzung</div>
                        <div className="font-medium">{explanation.riskAssessment}</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-4xl mb-3">💡</div>
                  <p>Gib ein Symbol ein und klicke "Analysieren" um zu sehen,</p>
                  <p>warum der Agent ein bestimmtes Signal empfiehlt.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
