/**
 * Trade Alert Bar Component
 * 
 * A sticky notification bar that appears at the top of the screen when a trade is executed.
 * Shows key details with expandable full information.
 */

import { useState, useEffect } from 'react';

interface TradeDetails {
  id: number;
  symbol: string;
  action: 'buy' | 'sell' | 'short' | 'close';
  quantity: number;
  price: number;
  confidence: number | null;
  weightedScore: number | null;
  mlScore: number | null;
  rlScore: number | null;
  sentimentScore: number | null;
  technicalScore: number | null;
  signalAgreement: string;
  reasoning: string;
  riskChecksPassed: boolean;
  riskWarnings?: string[];
  timestamp: string;
  cost?: number;
  pnl?: number;
  pnlPercent?: number;
}

interface TradeAlertBarProps {
  trade: TradeDetails | null;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export default function TradeAlertBar({ trade, onDismiss, autoDismissMs = 30000 }: TradeAlertBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(100);

  // Auto-dismiss countdown
  useEffect(() => {
    if (!trade || autoDismissMs <= 0) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / autoDismissMs) * 100);
      setProgress(remaining);
      
      if (remaining <= 0) {
        onDismiss();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [trade, autoDismissMs, onDismiss]);

  // Reset expansion when new trade arrives
  useEffect(() => {
    setExpanded(false);
    setProgress(100);
  }, [trade?.id]);

  if (!trade) return null;

  const isBuy = trade.action === 'buy' || trade.action === 'short';
  const actionColor = isBuy ? 'bg-green-600' : 'bg-red-600';
  const actionIcon = isBuy ? '📈' : '📉';
  const actionText = trade.action.toUpperCase();

  const formatScore = (score: number | null, label: string) => {
    if (score === null || score === undefined) return null;
    const color = score > 0 ? 'text-green-400' : score < 0 ? 'text-red-400' : 'text-gray-400';
    const sign = score > 0 ? '+' : '';
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-gray-500">{label}:</span>
        <span className={color}>{sign}{(score * 100).toFixed(0)}%</span>
      </span>
    );
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 animate-slide-down">
      {/* Progress bar */}
      <div className="h-1 bg-slate-800">
        <div 
          className={`h-full transition-all duration-100 ${isBuy ? 'bg-green-500' : 'bg-red-500'}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className={`${actionColor} text-white shadow-lg`}>
        {/* Main bar */}
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Trade summary */}
            <div className="flex items-center gap-3 flex-1">
              <span className="text-2xl">{actionIcon}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-lg">{actionText}</span>
                <span className="font-mono bg-black/20 px-2 py-0.5 rounded">
                  {trade.quantity} {trade.symbol}
                </span>
                <span className="text-white/80">@</span>
                <span className="font-mono">{formatCurrency(trade.price)}</span>
                {trade.cost && (
                  <span className="text-white/70 text-sm">
                    (Total: {formatCurrency(trade.cost)})
                  </span>
                )}
                {trade.pnlPercent !== undefined && (
                  <span className={`font-bold ${trade.pnlPercent >= 0 ? 'text-green-200' : 'text-red-200'}`}>
                    {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                  </span>
                )}
              </div>
            </div>

            {/* Center: Confidence */}
            <div className="hidden md:flex items-center gap-2 bg-black/20 px-3 py-1 rounded-full">
              <span className="text-sm text-white/70">Confidence:</span>
              <span className="font-bold">{((trade.confidence ?? 0) * 100).toFixed(0)}%</span>
              <span className="text-white/50">|</span>
              <span className="text-sm capitalize">{trade.signalAgreement}</span>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="px-3 py-1.5 bg-black/20 hover:bg-black/30 rounded-lg transition-colors flex items-center gap-1"
              >
                <span className="text-sm">Details</span>
                <svg 
                  className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <button
                onClick={onDismiss}
                className="p-1.5 hover:bg-black/20 rounded-lg transition-colors"
                title="Dismiss"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="bg-black/20 border-t border-white/10">
            <div className="container mx-auto px-4 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Signal Scores */}
                <div className="bg-black/20 rounded-lg p-3">
                  <h4 className="text-sm font-semibold text-white/70 mb-2 flex items-center gap-2">
                    <span>📊</span> Signal Scores
                  </h4>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {formatScore(trade.mlScore, 'ML')}
                    {formatScore(trade.rlScore, 'RL')}
                    {formatScore(trade.sentimentScore, 'Sent')}
                    {formatScore(trade.technicalScore, 'Tech')}
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <span className="text-white/70">Combined: </span>
                    <span className={`font-bold ${(trade.weightedScore ?? 0) > 0 ? 'text-green-300' : 'text-red-300'}`}>
                      {(trade.weightedScore ?? 0) > 0 ? '+' : ''}{((trade.weightedScore ?? 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* Risk Check */}
                <div className="bg-black/20 rounded-lg p-3">
                  <h4 className="text-sm font-semibold text-white/70 mb-2 flex items-center gap-2">
                    <span>⚠️</span> Risk Assessment
                  </h4>
                  <div className="flex items-center gap-2 mb-2">
                    {trade.riskChecksPassed ? (
                      <>
                        <span className="text-green-400">✅</span>
                        <span className="text-green-300">All checks passed</span>
                      </>
                    ) : (
                      <>
                        <span className="text-yellow-400">⚠️</span>
                        <span className="text-yellow-300">Risk warnings present</span>
                      </>
                    )}
                  </div>
                  {trade.riskWarnings && trade.riskWarnings.length > 0 && (
                    <ul className="text-xs text-yellow-200/80 space-y-1">
                      {trade.riskWarnings.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Trade Details */}
                <div className="bg-black/20 rounded-lg p-3">
                  <h4 className="text-sm font-semibold text-white/70 mb-2 flex items-center gap-2">
                    <span>📋</span> Trade Details
                  </h4>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-white/70">Quantity:</span>
                      <span>{trade.quantity}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Price:</span>
                      <span>{formatCurrency(trade.price)}</span>
                    </div>
                    {trade.cost && (
                      <div className="flex justify-between">
                        <span className="text-white/70">Total Cost:</span>
                        <span>{formatCurrency(trade.cost)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-white/70">Time:</span>
                      <span>{new Date(trade.timestamp).toLocaleTimeString('de-DE')}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reasoning */}
              <div className="mt-4 bg-black/20 rounded-lg p-3">
                <h4 className="text-sm font-semibold text-white/70 mb-2 flex items-center gap-2">
                  <span>💭</span> Reasoning
                </h4>
                <p className="text-sm text-white/90">{trade.reasoning}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Animation CSS (add to index.css or use inline)
const styles = `
@keyframes slide-down {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.animate-slide-down {
  animation: slide-down 0.3s ease-out;
}
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}
