/**
 * AI Trader Report Card Component
 * 
 * Displays a daily performance report with key metrics and statistics.
 */

import type { AITraderDailyReport } from '../types/aiTrader';

// API returns snake_case, but our types use camelCase - handle both
type ApiReport = {
  report_date?: string;
  reportDate?: string;
  pnl?: number | string | null;
  pnl_percent?: number | string | null;
  pnlPercent?: number | null;
  start_value?: number | string | null;
  startValue?: number | null;
  end_value?: number | string | null;
  endValue?: number | null;
  fees_paid?: number | string | null;
  feesPaid?: number | null;
  trades_executed?: number;
  tradesExecuted?: number;
  positions_opened?: number;
  positionsOpened?: number;
  positions_closed?: number;
  positionsClosed?: number;
  winning_trades?: number;
  winningTrades?: number;
  losing_trades?: number;
  losingTrades?: number;
  win_rate?: number | null;
  winRate?: number | null;
  avg_win?: number | string | null;
  avgWin?: number | null;
  avg_loss?: number | string | null;
  avgLoss?: number | null;
  best_trade?: { symbol: string; pnl_percent?: number } | null;
  bestTrade?: { symbol: string; pnl_percent?: number } | null;
  worst_trade?: { symbol: string; pnl_percent?: number } | null;
  worstTrade?: { symbol: string; pnl_percent?: number } | null;
};

interface AITraderReportCardProps {
  report: AITraderDailyReport | ApiReport;
}

// Helper to parse number from string or number
const parseNum = (val: number | string | null | undefined): number | null => {
  if (val === null || val === undefined) return null;
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(num) ? null : num;
};

export default function AITraderReportCard({ report }: AITraderReportCardProps) {
  // Normalize snake_case to camelCase
  const r = report as ApiReport;
  const reportDate = r.reportDate || r.report_date || '';
  const pnl = parseNum(r.pnl ?? r.pnl);
  const pnlPercent = parseNum(r.pnlPercent ?? r.pnl_percent);
  const startValue = parseNum(r.startValue ?? r.start_value);
  const endValue = parseNum(r.endValue ?? r.end_value);
  const feesPaid = parseNum(r.feesPaid ?? r.fees_paid);
  const tradesExecuted = r.tradesExecuted ?? r.trades_executed ?? 0;
  const positionsOpened = r.positionsOpened ?? r.positions_opened ?? 0;
  const positionsClosed = r.positionsClosed ?? r.positions_closed ?? 0;
  const winningTrades = r.winningTrades ?? r.winning_trades ?? 0;
  const losingTrades = r.losingTrades ?? r.losing_trades ?? 0;
  const winRate = parseNum(r.winRate ?? r.win_rate);
  const avgWin = parseNum(r.avgWin ?? r.avg_win);
  const avgLoss = parseNum(r.avgLoss ?? r.avg_loss);
  const bestTrade = r.bestTrade ?? r.best_trade ?? null;
  const worstTrade = r.worstTrade ?? r.worst_trade ?? null;

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'N/A';
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number | null) => {
    if (value === null) return 'N/A';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Unknown Date';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return new Intl.DateTimeFormat('de-DE', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date);
    } catch {
      return 'Invalid Date';
    }
  };

  const pnlColor = (pnl: number | null) => {
    if (pnl === null || pnl === 0) return 'text-gray-400';
    return pnl > 0 ? 'text-green-400' : 'text-red-400';
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-lg">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/50">
        <h3 className="text-lg font-bold">📊 Tagesbericht</h3>
        <p className="text-sm text-gray-400">{formatDate(reportDate)}</p>
      </div>

      <div className="p-4 space-y-4">
        {/* P&L Summary Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-slate-900/50 rounded-lg">
            <div className="text-xs text-gray-400">Tages-P&L</div>
            <div className={`text-xl font-bold ${pnlColor(pnl)}`}>
              {formatCurrency(pnl)}
            </div>
            <div className={`text-sm font-medium ${pnlColor(pnlPercent)}`}>
              {formatPercent(pnlPercent)}
            </div>
          </div>
          <div className="p-3 bg-slate-900/50 rounded-lg">
            <div className="text-xs text-gray-400">Portfolio</div>
            <div className="text-xl font-bold">{formatCurrency(endValue)}</div>
            <div className="text-xs text-gray-500">
              Start: {formatCurrency(startValue)}
            </div>
          </div>
        </div>

        {/* Trading Activity - Compact */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 bg-slate-900/50 rounded-lg">
            <div className="text-lg font-bold text-blue-400">{tradesExecuted}</div>
            <div className="text-xs text-gray-500">Trades</div>
          </div>
          <div className="text-center p-2 bg-slate-900/50 rounded-lg">
            <div className="text-lg font-bold text-green-400">{positionsOpened}</div>
            <div className="text-xs text-gray-500">Eröffnet</div>
          </div>
          <div className="text-center p-2 bg-slate-900/50 rounded-lg">
            <div className="text-lg font-bold text-orange-400">{positionsClosed}</div>
            <div className="text-xs text-gray-500">Geschlossen</div>
          </div>
          <div className="text-center p-2 bg-slate-900/50 rounded-lg">
            <div className="text-lg font-bold text-purple-400">
              {winRate !== null ? `${winRate.toFixed(0)}%` : '-'}
            </div>
            <div className="text-xs text-gray-500">Win Rate</div>
          </div>
        </div>

        {/* Win/Loss Stats - Compact */}
        {positionsClosed > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 bg-green-500/10 rounded-lg border border-green-500/30 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-green-400">{winningTrades} Wins</div>
                {avgWin && <div className="text-xs text-green-400/60">⌀ {formatCurrency(avgWin)}</div>}
              </div>
              <span className="text-xl">🏆</span>
            </div>
            <div className="p-2 bg-red-500/10 rounded-lg border border-red-500/30 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-red-400">{losingTrades} Losses</div>
                {avgLoss && <div className="text-xs text-red-400/60">⌀ {formatCurrency(avgLoss)}</div>}
              </div>
              <span className="text-xl">📉</span>
            </div>
          </div>
        )}

        {/* Best/Worst Trades - Compact */}
        {(bestTrade || worstTrade) && (
          <div className="space-y-1">
            {bestTrade && (
              <div className="p-2 bg-green-500/10 rounded-lg border border-green-500/30 flex justify-between items-center">
                <span className="text-xs text-gray-400">🏆 Bester Trade</span>
                <span className="text-sm font-bold text-green-400">
                  {bestTrade.symbol}: {(bestTrade.pnl_percent ?? 0) >= 0 ? '+' : ''}{bestTrade.pnl_percent?.toFixed(2)}%
                </span>
              </div>
            )}
            {worstTrade && (
              <div className="p-2 bg-red-500/10 rounded-lg border border-red-500/30 flex justify-between items-center">
                <span className="text-xs text-gray-400">📉 Schlechtester</span>
                <span className="text-sm font-bold text-red-400">
                  {worstTrade.symbol}: {worstTrade.pnl_percent?.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Fees - Minimal */}
        {feesPaid !== null && feesPaid > 0 && (
          <div className="text-xs text-gray-500 pt-2 border-t border-slate-700/50">
            Gebühren: {formatCurrency(feesPaid)}
          </div>
        )}
      </div>
    </div>
  );
}
