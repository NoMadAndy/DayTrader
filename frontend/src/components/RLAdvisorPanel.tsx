/**
 * RL Advisor Panel
 * 
 * Displays trading signals from trained RL agents as "advisors"
 * for the current stock. Shows consensus from multiple agents.
 * Includes detailed explanations for each agent's decision.
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  rlTradingService,
  type AgentStatus,
  type MultiSignalResponse,
  type SignalExplanation,
} from '../services/rlTradingService';
import type { OHLCV } from '../types/stock';
import { log } from '../utils/logger';

interface RLAdvisorPanelProps {
  symbol: string;
  historicalData: OHLCV[];
  className?: string;
}

export default function RLAdvisorPanel({ 
  symbol, 
  historicalData, 
  className = '' 
}: RLAdvisorPanelProps) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [signals, setSignals] = useState<MultiSignalResponse | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // State für Erklärungen
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<SignalExplanation | null>(null);
  const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);

  // Check service and load agents on mount
  useEffect(() => {
    checkServiceAndLoadAgents();
  }, []);

  // Auto-select all trained agents
  useEffect(() => {
    const trainedAgents = agents.filter(a => a.is_trained).map(a => a.name);
    setSelectedAgents(trainedAgents);
  }, [agents]);

  // Fetch signals when data or selection changes
  useEffect(() => {
    if (isAvailable && selectedAgents.length > 0 && historicalData.length >= 100) {
      fetchSignals();
    }
  }, [selectedAgents, historicalData, symbol]);

  const checkServiceAndLoadAgents = async () => {
    setIsLoading(true);
    try {
      const available = await rlTradingService.isAvailable();
      setIsAvailable(available);
      
      if (available) {
        const agentList = await rlTradingService.listAgents();
        setAgents(agentList.filter(a => a.is_trained));
      }
    } catch (err) {
      log.error('Failed to check RL service:', err);
      setIsAvailable(false);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSignals = async () => {
    if (selectedAgents.length === 0 || historicalData.length < 100) return;
    
    setError(null);
    try {
      const result = await rlTradingService.getMultiSignals(selectedAgents, historicalData);
      setSignals(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get signals');
      setSignals(null);
    }
  };

  const toggleAgent = (agentName: string) => {
    setSelectedAgents(prev => 
      prev.includes(agentName)
        ? prev.filter(a => a !== agentName)
        : [...prev, agentName]
    );
  };

  // Erklärung für einen Agenten laden
  const loadExplanation = useCallback(async (agentName: string) => {
    if (expandedAgent === agentName) {
      // Schließen wenn bereits offen
      setExpandedAgent(null);
      setExplanation(null);
      return;
    }
    
    setExpandedAgent(agentName);
    setIsLoadingExplanation(true);
    setExplanation(null);
    
    try {
      const result = await rlTradingService.getSignalWithExplanation(agentName, historicalData);
      setExplanation(result);
    } catch (err) {
      log.error('Failed to load explanation:', err);
    } finally {
      setIsLoadingExplanation(false);
    }
  }, [expandedAgent, historicalData]);

  const getSignalColor = (signal: string): string => {
    switch (signal) {
      case 'buy': return 'text-green-400';
      case 'sell': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const getSignalBgColor = (signal: string): string => {
    switch (signal) {
      case 'buy': return 'bg-green-900/50 border-green-600';
      case 'sell': return 'bg-red-900/50 border-red-600';
      default: return 'bg-slate-700 border-slate-600';
    }
  };

  const getSignalIcon = (signal: string): string => {
    switch (signal) {
      case 'buy': return '📈';
      case 'sell': return '📉';
      default: return '➖';
    }
  };

  const getStrengthBars = (strength: string): number => {
    switch (strength) {
      case 'strong': return 3;
      case 'moderate': return 2;
      case 'weak': return 1;
      default: return 0;
    }
  };

  if (isLoading) {
    return (
      <div className={`bg-slate-800 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-center h-20">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className={`bg-slate-800 rounded-lg p-4 ${className}`}>
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-sm font-medium text-slate-400">🤖 RL Advisors</h4>
          <button 
            onClick={checkServiceAndLoadAgents} 
            className="text-xs text-blue-400 hover:text-blue-300"
            title="Erneut versuchen"
          >
            ↻ Retry
          </button>
        </div>
        <p className="text-xs text-slate-500">Service nicht erreichbar — wird beim nächsten Laden erneut geprüft</p>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className={`bg-slate-800 rounded-lg p-4 ${className}`}>
        <h4 className="text-sm font-medium text-slate-400 mb-2">🤖 RL Advisors</h4>
        <p className="text-xs text-slate-500">No trained agents available</p>
      </div>
    );
  }

  return (
    <div className={`bg-slate-800 rounded-lg p-4 ${className}`}>
      <div className="flex justify-between items-center mb-3">
        <h4 className="text-sm font-medium text-white">🤖 RL Advisors</h4>
        <span className="text-xs text-slate-400">{symbol}</span>
      </div>

      {/* Agent Selection */}
      <div className="flex flex-wrap gap-1 mb-3">
        {agents.map(agent => (
          <button
            key={agent.name}
            onClick={() => toggleAgent(agent.name)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              selectedAgents.includes(agent.name)
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
            title={agent.config?.description}
          >
            {agent.name}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}

      {historicalData.length < 100 && (
        <p className="text-xs text-amber-400 mb-2">
          Need at least 100 data points for signals
        </p>
      )}

      {/* Consensus Signal */}
      {signals && (
        <div className={`rounded-lg p-3 border ${getSignalBgColor(signals.consensus.signal)}`}>
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{getSignalIcon(signals.consensus.signal)}</span>
              <div>
                <div className={`text-lg font-bold uppercase ${getSignalColor(signals.consensus.signal)}`}>
                  {signals.consensus.signal}
                </div>
                <div className="text-xs text-slate-400">
                  Consensus from {signals.agents_responded} agents
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-white">
                {(signals.consensus.confidence * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-slate-400">confidence</div>
            </div>
          </div>

          {/* Vote breakdown */}
          <div className="flex gap-3 text-xs mt-2">
            <span className="text-green-400">
              Buy: {signals.consensus.votes.buy}
            </span>
            <span className="text-red-400">
              Sell: {signals.consensus.votes.sell}
            </span>
            <span className="text-slate-400">
              Hold: {signals.consensus.votes.hold}
            </span>
          </div>
        </div>
      )}

      {/* Individual Agent Signals */}
      {signals && Object.entries(signals.signals).length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-xs text-slate-400 mb-1">
            Individual Signals 
            <span className="text-slate-500 ml-1">(klicken für Details)</span>
          </div>
          {Object.entries(signals.signals).map(([agentName, signal]) => (
            <div key={agentName}>
              <button
                onClick={() => loadExplanation(agentName)}
                className={`w-full flex justify-between items-center text-xs rounded px-2 py-1.5 transition-colors ${
                  expandedAgent === agentName 
                    ? 'bg-slate-600/70 border border-slate-500' 
                    : 'bg-slate-700/50 hover:bg-slate-600/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{getSignalIcon(signal.signal)}</span>
                  <span className="text-slate-300">{agentName}</span>
                  {expandedAgent === agentName && (
                    <span className="text-blue-400 text-[10px]">▼</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={getSignalColor(signal.signal)}>
                    {signal.signal}
                  </span>
                  {/* Strength indicator */}
                  <div className="flex gap-0.5">
                    {[1, 2, 3].map(i => (
                      <div
                        key={i}
                        className={`w-1 h-2 rounded ${
                          i <= getStrengthBars(signal.strength)
                            ? signal.signal === 'buy' 
                              ? 'bg-green-400' 
                              : signal.signal === 'sell' 
                              ? 'bg-red-400' 
                              : 'bg-slate-500'
                            : 'bg-slate-600'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-slate-500 w-10 text-right">
                    {(signal.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </button>
              
              {/* Explanation Panel */}
              {expandedAgent === agentName && (
                <div className="mt-1 p-3 bg-slate-700/30 rounded border border-slate-600/50 text-xs">
                  {isLoadingExplanation ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                      <span className="ml-2 text-slate-400">Analysiere Entscheidung...</span>
                    </div>
                  ) : explanation ? (
                    <div className="space-y-3">
                      {/* Wahrscheinlichkeitsbalken */}
                      <div>
                        <div className="text-slate-400 mb-1 font-medium">Wahrscheinlichkeitsverteilung</div>
                        <div className="flex gap-1 h-4 rounded overflow-hidden">
                          <div 
                            className="bg-green-500/80 transition-all" 
                            style={{ width: `${explanation.probability_summary.buy_total * 100}%` }}
                            title={`Kaufen: ${(explanation.probability_summary.buy_total * 100).toFixed(1)}%`}
                          />
                          <div 
                            className="bg-slate-500/80 transition-all" 
                            style={{ width: `${explanation.probability_summary.hold * 100}%` }}
                            title={`Halten: ${(explanation.probability_summary.hold * 100).toFixed(1)}%`}
                          />
                          <div 
                            className="bg-red-500/80 transition-all" 
                            style={{ width: `${explanation.probability_summary.sell_total * 100}%` }}
                            title={`Verkaufen: ${(explanation.probability_summary.sell_total * 100).toFixed(1)}%`}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                          <span className="text-green-400">Kaufen {(explanation.probability_summary.buy_total * 100).toFixed(0)}%</span>
                          <span>Halten {(explanation.probability_summary.hold * 100).toFixed(0)}%</span>
                          <span className="text-red-400">Verkaufen {(explanation.probability_summary.sell_total * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                      
                      {/* Top Einflussfaktoren */}
                      {explanation.feature_importance && Object.keys(explanation.feature_importance).length > 0 && (
                        <div>
                          <div className="text-slate-400 mb-1 font-medium">Top Einflussfaktoren</div>
                          <div className="space-y-1">
                            {Object.entries(explanation.feature_importance).slice(0, 5).map(([feature, impact]) => (
                              <div key={feature} className="flex items-center gap-2">
                                <div className="w-20 truncate text-slate-300" title={feature}>{feature}</div>
                                <div className="flex-1 h-2 bg-slate-600 rounded overflow-hidden">
                                  <div 
                                    className="h-full bg-blue-500/80" 
                                    style={{ width: `${Math.min(impact * 10, 100)}%` }}
                                  />
                                </div>
                                <div className="w-12 text-right text-slate-400">{impact.toFixed(1)}%</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Marktindikatoren */}
                      {explanation.market_state && Object.keys(explanation.market_state).length > 0 && (
                        <div>
                          <div className="text-slate-400 mb-1 font-medium">Aktuelle Marktdaten</div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            {Object.entries(explanation.market_state).slice(0, 6).map(([indicator, value]) => (
                              <div key={indicator} className="flex justify-between">
                                <span className="text-slate-500 truncate" title={indicator}>{indicator}:</span>
                                <span className="text-slate-300 ml-1">
                                  {typeof value === 'number' ? value.toFixed(2) : value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Agent-Konfiguration */}
                      {explanation.agent_config && (
                        <div className="pt-2 border-t border-slate-600/50">
                          <div className="text-slate-400 mb-1 font-medium">Agent-Profil</div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                            <div><span className="text-slate-500">Stil:</span> <span className="text-slate-300">{explanation.agent_config.trading_style}</span></div>
                            <div><span className="text-slate-500">Risiko:</span> <span className="text-slate-300">{explanation.agent_config.risk_profile}</span></div>
                            <div><span className="text-slate-500">Haltedauer:</span> <span className="text-slate-300">{explanation.agent_config.holding_period}</span></div>
                            <div><span className="text-slate-500">Broker:</span> <span className="text-slate-300">{explanation.agent_config.broker_profile}</span></div>
                          </div>
                        </div>
                      )}
                      
                      {/* Disclaimer */}
                      <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-600/50">
                        ⚠️ Diese Erklärung basiert auf gemessenen Feature-Einflüssen. Die genaue interne Logik 
                        des neuronalen Netzwerks ist nicht vollständig interpretierbar.
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-500 text-center py-2">Keine Erklärung verfügbar</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
