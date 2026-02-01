/**
 * AITraderDecisionModal - Detailed view of a single AI Trader decision
 * Shows all signal components, reasoning, and outcome
 */

import { useState, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';

interface SignalComponent {
  source: string;
  signal: 'buy' | 'sell' | 'hold';
  confidence: number;
  weight: number;
  contributedScore: number;
  details?: Record<string, unknown>;
}

interface Decision {
  id: number;
  traderId: number;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  reasoning: string | Record<string, unknown>;
  signalComponents?: SignalComponent[];
  priceAtDecision?: number;
  quantity?: number;
  positionId?: number;
  outcome?: {
    realized: boolean;
    pnl?: number;
    pnlPercent?: number;
    exitPrice?: number;
    exitDate?: string;
  };
  createdAt: string;
  // snake_case variants from DB
  ai_trader_id?: number;
  decision_type?: string;
  timestamp?: string;
  weighted_score?: number;
  ml_score?: number;
  rl_score?: number;
  sentiment_score?: number;
  technical_score?: number;
  signal_agreement?: string;
  summary_short?: string;
  outcome_pnl?: number;
  outcome_pnl_percent?: number;
  outcome_was_correct?: boolean;
}

interface AITraderDecisionModalProps {
  traderId: number;
  decisionId: number;
  isOpen: boolean;
  onClose: () => void;
}

export function AITraderDecisionModal({ traderId, decisionId, isOpen, onClose }: AITraderDecisionModalProps) {
  const { formatCurrency } = useSettings();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !decisionId) return;

    const fetchDecision = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`/api/ai-traders/${traderId}/decisions/${decisionId}`);
        if (!response.ok) {
          throw new Error('Entscheidung nicht gefunden');
        }
        const data = await response.json();
        setDecision(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden');
      } finally {
        setLoading(false);
      }
    };

    fetchDecision();
  }, [traderId, decisionId, isOpen]);

  if (!isOpen) return null;

  const getActionColor = (action: string) => {
    switch (action) {
      case 'buy': return 'text-green-400 bg-green-500/20';
      case 'sell': return 'text-red-400 bg-red-500/20';
      default: return 'text-yellow-400 bg-yellow-500/20';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'buy': return '📈';
      case 'sell': return '📉';
      default: return '⏸️';
    }
  };

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'buy': return 'text-green-400';
      case 'sell': return 'text-red-400';
      default: return 'text-yellow-400';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden border border-slate-700 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span>🧠</span>
            Entscheidungsdetails
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[calc(90vh-80px)]">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin text-4xl mb-4">⟳</div>
              <p className="text-gray-400">Lade Details...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">❌</div>
              <p className="text-red-400">{error}</p>
            </div>
          ) : decision ? (
            <div className="space-y-6">
              {/* Main Decision Info */}
              <div className="flex items-start gap-4">
                <div className={`text-4xl p-3 rounded-xl ${getActionColor(decision.decision_type || decision.action || 'hold')}`}>
                  {getActionIcon(decision.decision_type || decision.action || 'hold')}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl font-bold">{decision.symbol}</span>
                    <span className={`px-3 py-1 rounded-lg text-sm font-medium uppercase ${getActionColor(decision.decision_type || decision.action || 'hold')}`}>
                      {decision.decision_type || decision.action || 'hold'}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm">
                    {new Date(decision.timestamp || decision.createdAt).toLocaleString('de-DE')}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400">Konfidenz</div>
                  <div className="text-2xl font-bold text-blue-400">
                    {((decision.confidence || decision.weighted_score || 0) * 100).toFixed(0)}%
                  </div>
                </div>
              </div>

              {/* Signal Scores */}
              {(decision.ml_score !== undefined || decision.rl_score !== undefined || 
                decision.sentiment_score !== undefined || decision.technical_score !== undefined) && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {decision.ml_score !== undefined && (
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <div className="text-sm text-gray-400">ML</div>
                      <div className={`text-lg font-bold ${Number(decision.ml_score) > 0.5 ? 'text-green-400' : Number(decision.ml_score) < 0.5 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {(Number(decision.ml_score) * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}
                  {decision.rl_score !== undefined && (
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <div className="text-sm text-gray-400">RL</div>
                      <div className={`text-lg font-bold ${Number(decision.rl_score) > 0.5 ? 'text-green-400' : Number(decision.rl_score) < 0.5 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {(Number(decision.rl_score) * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}
                  {decision.sentiment_score !== undefined && (
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <div className="text-sm text-gray-400">Sentiment</div>
                      <div className={`text-lg font-bold ${Number(decision.sentiment_score) > 0.5 ? 'text-green-400' : Number(decision.sentiment_score) < 0.5 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {(Number(decision.sentiment_score) * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}
                  {decision.technical_score !== undefined && (
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <div className="text-sm text-gray-400">Technisch</div>
                      <div className={`text-lg font-bold ${Number(decision.technical_score) > 0.5 ? 'text-green-400' : Number(decision.technical_score) < 0.5 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {(Number(decision.technical_score) * 100).toFixed(0)}%
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Signal Agreement */}
              {decision.signal_agreement && (
                <div className={`rounded-lg p-3 text-center ${
                  decision.signal_agreement === 'unanimous' ? 'bg-green-500/20 text-green-400' :
                  decision.signal_agreement === 'majority' ? 'bg-blue-500/20 text-blue-400' :
                  decision.signal_agreement === 'split' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  <span className="font-medium">
                    {decision.signal_agreement === 'unanimous' ? '✅ Einstimmiges Signal' :
                     decision.signal_agreement === 'majority' ? '📊 Mehrheitssignal' :
                     decision.signal_agreement === 'split' ? '⚖️ Geteilte Signale' :
                     `📊 ${decision.signal_agreement}`}
                  </span>
                </div>
              )}

              {/* Price & Quantity */}
              {(decision.priceAtDecision || decision.quantity) && (
                <div className="grid grid-cols-2 gap-4">
                  {decision.priceAtDecision && (
                    <div className="bg-slate-700/50 rounded-lg p-3">
                      <div className="text-sm text-gray-400">Kurs bei Entscheidung</div>
                      <div className="text-lg font-bold">{formatCurrency(decision.priceAtDecision)}</div>
                    </div>
                  )}
                  {decision.quantity && (
                    <div className="bg-slate-700/50 rounded-lg p-3">
                      <div className="text-sm text-gray-400">Menge</div>
                      <div className="text-lg font-bold">{decision.quantity} Stück</div>
                    </div>
                  )}
                </div>
              )}

              {/* Outcome (if realized) */}
              {(decision.outcome || decision.outcome_pnl !== undefined || decision.outcome_pnl !== null) && (
                <div className={`rounded-lg p-4 ${
                  (decision.outcome?.pnl ?? decision.outcome_pnl ?? 0) >= 0 
                    ? 'bg-green-500/10 border border-green-500/30' 
                    : 'bg-red-500/10 border border-red-500/30'
                }`}>
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <span>{decision.outcome_was_correct !== undefined ? (decision.outcome_was_correct ? '✅' : '❌') : '📊'}</span>
                    Ergebnis
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {(decision.outcome?.pnl !== undefined || decision.outcome_pnl !== undefined) && (
                      <div>
                        <div className="text-sm text-gray-400">P&L</div>
                        <div className={`text-lg font-bold ${(decision.outcome?.pnl ?? decision.outcome_pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(decision.outcome?.pnl ?? decision.outcome_pnl ?? 0) >= 0 ? '+' : ''}{formatCurrency(decision.outcome?.pnl ?? decision.outcome_pnl ?? 0)}
                        </div>
                      </div>
                    )}
                    {(decision.outcome?.pnlPercent !== undefined || decision.outcome_pnl_percent !== undefined) && (
                      <div>
                        <div className="text-sm text-gray-400">Rendite</div>
                        <div className={`text-lg font-bold ${(decision.outcome?.pnlPercent ?? decision.outcome_pnl_percent ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(decision.outcome?.pnlPercent ?? decision.outcome_pnl_percent ?? 0) >= 0 ? '+' : ''}{Number(decision.outcome?.pnlPercent ?? decision.outcome_pnl_percent ?? 0).toFixed(2)}%
                        </div>
                      </div>
                    )}
                    {decision.outcome?.exitPrice && (
                      <div>
                        <div className="text-sm text-gray-400">Exit-Kurs</div>
                        <div className="text-lg font-bold">{formatCurrency(decision.outcome.exitPrice)}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Reasoning */}
              {(decision.reasoning || decision.summary_short) && (
                <div className="bg-slate-700/50 rounded-lg p-4">
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <span>💭</span>
                    Begründung
                  </h3>
                  <div className="text-gray-300">
                    {decision.summary_short && (
                      <p className="font-medium mb-2">{decision.summary_short}</p>
                    )}
                    {decision.reasoning && (
                      typeof decision.reasoning === 'string' 
                        ? <p className="whitespace-pre-wrap">{decision.reasoning}</p>
                        : (
                          <div className="space-y-2 text-sm">
                            {(() => {
                              const r = decision.reasoning as Record<string, unknown>;
                              return (
                                <>
                                  {typeof r.summary === 'string' && <p>{r.summary}</p>}
                                  {r.factors && typeof r.factors === 'object' && (
                                    <div className="mt-2">
                                      <span className="text-gray-400">Faktoren:</span>
                                      <ul className="list-disc list-inside mt-1">
                                        {Object.entries(r.factors as Record<string, unknown>).map(([key, value]) => (
                                          <li key={key}><span className="capitalize">{key}:</span> {String(value)}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )
                    )}
                  </div>
                </div>
              )}

              {/* Signal Components */}
              {decision.signalComponents && decision.signalComponents.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <span>📊</span>
                    Signal-Komponenten
                  </h3>
                  <div className="space-y-2">
                    {decision.signalComponents.map((comp, idx) => (
                      <div key={idx} className="bg-slate-700/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="font-medium capitalize">{comp.source}</span>
                            <span className={`px-2 py-0.5 rounded text-xs uppercase ${getActionColor(comp.signal)}`}>
                              {comp.signal}
                            </span>
                          </div>
                          <div className="text-sm">
                            <span className="text-gray-400">Gewicht: </span>
                            <span className="font-medium">{(comp.weight * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-400">Konfidenz: </span>
                            <span className={getSignalColor(comp.signal)}>
                              {(comp.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400">Beitrag: </span>
                            <span className={comp.contributedScore >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {comp.contributedScore >= 0 ? '+' : ''}{(comp.contributedScore * 100).toFixed(1)}
                            </span>
                          </div>
                        </div>

                        {/* Signal Details */}
                        {comp.details && Object.keys(comp.details).length > 0 && (
                          <details className="mt-2">
                            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                              Details anzeigen
                            </summary>
                            <pre className="mt-2 p-2 bg-slate-800 rounded text-xs overflow-x-auto">
                              {JSON.stringify(comp.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Score Visualization */}
                  <div className="mt-4 bg-slate-700/50 rounded-lg p-3">
                    <div className="text-sm text-gray-400 mb-2">Gesamt-Score Verteilung</div>
                    <div className="flex h-6 rounded-lg overflow-hidden">
                      {decision.signalComponents.map((comp, idx) => {
                        const absContrib = Math.abs(comp.contributedScore);
                        const totalAbs = decision.signalComponents!.reduce((sum, c) => sum + Math.abs(c.contributedScore), 0);
                        const widthPercent = totalAbs > 0 ? (absContrib / totalAbs) * 100 : 0;
                        
                        const bgColor = comp.signal === 'buy' 
                          ? 'bg-green-500' 
                          : comp.signal === 'sell' 
                            ? 'bg-red-500' 
                            : 'bg-yellow-500';
                        
                        return (
                          <div 
                            key={idx}
                            className={`${bgColor} flex items-center justify-center text-xs font-medium`}
                            style={{ width: `${widthPercent}%` }}
                            title={`${comp.source}: ${(comp.contributedScore * 100).toFixed(1)}`}
                          >
                            {widthPercent > 15 && comp.source.substring(0, 3).toUpperCase()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Decision ID */}
              <div className="text-center text-xs text-gray-500 pt-2 border-t border-slate-700">
                Decision ID: {decision.id}
                {decision.positionId && ` | Position ID: ${decision.positionId}`}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
