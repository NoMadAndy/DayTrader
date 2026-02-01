/**
 * AI Trader Report Card Component
 * 
 * Displays a daily performance report with key metrics and statistics.
 */

import type { AITraderDailyReport } from '../types/aiTrader';

interface AITraderReportCardProps {
  report: AITraderDailyReport;
}

export default function AITraderReportCard({ report }: AITraderReportCardProps) {
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
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  };

  const pnlColor = (pnl: number | null) => {
    if (pnl === null || pnl === 0) return 'text-gray-400';
    return pnl > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 p-6 rounded-lg shadow-lg">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-xl font-bold mb-1">Daily Report</h3>
        <p className="text-sm text-gray-400">{formatDate(report.reportDate)}</p>
      </div>

      {/* P&L Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-slate-900/50 rounded-lg">
          <div className="text-sm text-gray-400 mb-1">Daily P&L</div>
          <div className={`text-2xl font-bold ${pnlColor(report.pnl)}`}>
            {formatCurrency(report.pnl)}
          </div>
          <div className={`text-sm font-semibold ${pnlColor(report.pnlPercent)}`}>
            {formatPercent(report.pnlPercent)}
          </div>
        </div>

        <div className="p-4 bg-slate-900/50 rounded-lg">
          <div className="text-sm text-gray-400 mb-1">Portfolio Value</div>
          <div className="text-2xl font-bold">{formatCurrency(report.endValue)}</div>
          <div className="text-sm text-gray-400">
            Start: {formatCurrency(report.startValue)}
          </div>
        </div>
      </div>

      {/* Trading Activity */}
      <div className="mb-6">
        <h4 className="font-semibold mb-3">Trading Activity</h4>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 bg-slate-900/50 rounded">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {report.tradesExecuted}
            </div>
            <div className="text-xs text-gray-400">Trades</div>
          </div>
          <div className="text-center p-3 bg-slate-900/50 rounded">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {report.positionsOpened}
            </div>
            <div className="text-xs text-gray-400">Opened</div>
          </div>
          <div className="text-center p-3 bg-slate-900/50 rounded">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {report.positionsClosed}
            </div>
            <div className="text-xs text-gray-400">Closed</div>
          </div>
        </div>
      </div>

      {/* Win/Loss Stats */}
      {report.positionsClosed > 0 && (
        <div className="mb-6">
          <h4 className="font-semibold mb-3">Performance</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded">
              <div className="text-lg font-bold text-green-600 dark:text-green-400">
                {report.winningTrades}
              </div>
              <div className="text-xs text-gray-400">Winning Trades</div>
              {report.avgWin && (
                <div className="text-sm text-green-600 dark:text-green-400 mt-1">
                  Avg: {formatCurrency(report.avgWin)}
                </div>
              )}
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded">
              <div className="text-lg font-bold text-red-600 dark:text-red-400">
                {report.losingTrades}
              </div>
              <div className="text-xs text-gray-400">Losing Trades</div>
              {report.avgLoss && (
                <div className="text-sm text-red-600 dark:text-red-400 mt-1">
                  Avg: {formatCurrency(report.avgLoss)}
                </div>
              )}
            </div>
          </div>
          {report.winRate !== null && (
            <div className="mt-3 text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
              <span className="text-sm text-gray-400">Win Rate: </span>
              <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {report.winRate.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Best/Worst Trades */}
      {(report.bestTrade || report.worstTrade) && (
        <div className="mb-6">
          <h4 className="font-semibold mb-3">Notable Trades</h4>
          <div className="space-y-2">
            {report.bestTrade && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold">🏆 Best Trade</span>
                  <span className="text-sm font-bold text-green-600 dark:text-green-400">
                    {report.bestTrade.symbol}: +{report.bestTrade.pnl_percent?.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
            {report.worstTrade && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold">📉 Worst Trade</span>
                  <span className="text-sm font-bold text-red-600 dark:text-red-400">
                    {report.worstTrade.symbol}: {report.worstTrade.pnl_percent?.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fees */}
      {report.feesPaid !== null && report.feesPaid > 0 && (
        <div className="text-sm text-gray-400 pt-4 border-t border-slate-700">
          Fees paid: {formatCurrency(report.feesPaid)}
        </div>
      )}
    </div>
  );
}
