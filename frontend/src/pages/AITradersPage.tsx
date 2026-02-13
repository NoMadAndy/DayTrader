/**
 * AI Traders Management Page
 * 
 * Dedicated page for managing Live AI Traders.
 * Uses the unified AITraderConfigModal for creating new traders.
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import { getAITraders, deleteAITrader } from '../services/aiTraderService';
import { AITraderConfigModal } from '../components/AITraderConfigModal';
import type { AITrader, AITraderStatus } from '../types/aiTrader';
import { useSettings } from '../contexts';
import { log } from '../utils/logger';

const STATUS_STYLES: Record<AITraderStatus, { bg: string; text: string; icon: string }> = {
  running: { bg: 'bg-green-500/20', text: 'text-green-400', icon: '▶️' },
  paused: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '⏸️' },
  stopped: { bg: 'bg-slate-500/20', text: 'text-slate-400', icon: '⏹️' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400', icon: '❌' },
};

export default function AITradersPage() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [traders, setTraders] = useState<AITrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { t } = useSettings();
  const navigate = useNavigate();

  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  useEffect(() => {
    loadTraders();
  }, []);
  
  // Auto-refresh traders list every 30 seconds to update status
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshTraders();
    }, 30000);
    
    return () => clearInterval(intervalId);
  }, []);
  
  // Silent refresh (no loading spinner)
  const refreshTraders = async () => {
    try {
      const traderList = await getAITraders();
      setTraders(traderList);
    } catch (err) {
      log.error('Failed to refresh AI traders:', err);
    }
  };

  const loadTraders = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Trigger stats recalculation before loading to ensure fresh data
      try {
        await fetch('/api/ai-traders/recalculate-stats', { method: 'POST' });
      } catch (_e) { /* non-critical */ }
      
      const traderList = await getAITraders();
      setTraders(traderList);
    } catch (err) {
      log.error('Failed to load AI traders:', err);
      setError(t('aiTraders.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTrader = async (trader: AITrader) => {
    if (!confirm(t('aiTraders.confirmDelete').replace('{name}', trader.name))) {
      return;
    }

    setDeletingId(trader.id);
    setError(null);
    setSuccess(null);

    try {
      await deleteAITrader(trader.id);
      setSuccess(t('aiTraders.deleteSuccess').replace('{name}', trader.name));
      loadTraders();
    } catch (err) {
      log.error('Failed to delete AI trader:', err);
      setError(err instanceof Error ? err.message : t('aiTraders.deleteError'));
    } finally {
      setDeletingId(null);
    }
  };

  // Handle new trader created
  const handleTraderCreated = (newTrader: AITrader) => {
    setSuccess(t('aiTraders.createSuccess').replace('{name}', newTrader.name));
    setShowCreateModal(false);
    loadTraders();
    setTimeout(() => navigate(`/ai-trader/${newTrader.id}`), 1500);
  };

  if (!authState.isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-8">
        <div className="bg-slate-800/50 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">🤖 {t('aiTraders.title')}</h2>
          <p className="text-slate-400 mb-4">
            {t('aiTraders.loginRequired')}
          </p>
          <Link 
            to="/settings" 
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            {t('nav.login')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            🤖 {t('aiTraders.title')}
          </h1>
          <p className="text-slate-400 text-sm mt-0.5 hidden sm:block">
            {t('aiTraders.description')}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
        >
          <span className="text-lg">+</span>
          {t('aiTraders.newTrader')}
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
          {success}
        </div>
      )}

      {/* Create Trader Modal (unified config modal) */}
      <AITraderConfigModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSaved={handleTraderCreated}
      />

      {/* Traders Grid - full width */}
      {loading ? (
        <div className="bg-slate-800/50 rounded-lg p-8 flex items-center justify-center border border-slate-700/50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : traders.length === 0 ? (
        <div className="bg-slate-800/50 rounded-lg p-8 text-center border border-slate-700/50">
          <div className="text-6xl mb-4">🤖</div>
          <h3 className="text-xl font-semibold text-white mb-2">{t('aiTraders.noTraders')}</h3>
          <p className="text-slate-400 mb-4">{t('aiTraders.noTradersHint')}</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            {t('aiTraders.newTrader')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {traders.map((trader) => {
            const statusStyle = STATUS_STYLES[trader.status];
            const closedTrades = trader.winningTrades + trader.losingTrades;
            const winRate = closedTrades > 0 ? (trader.winningTrades / closedTrades) * 100 : null;
            const pnl = trader.totalPnl ?? 0;
            const personality = trader.personality;
            const riskTolerance = personality?.risk?.tolerance;
            const horizon = personality?.trading?.horizon;
            const capital = personality?.capital?.initialBudget;
            const schedule = personality?.schedule;
            
            return (
              <div
                key={trader.id}
                className="bg-slate-800/50 rounded-lg border border-slate-700/50 hover:border-slate-600/70 transition-all overflow-hidden"
              >
                {/* Top: Name + Status + Actions */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/30">
                  <Link 
                    to={`/ai-trader/${trader.id}`}
                    className="flex items-center gap-2.5 flex-1 min-w-0"
                  >
                    <span className="text-2xl flex-shrink-0">{trader.avatar}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white truncate">{trader.name}</h3>
                        <div className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.icon} {trader.status}
                        </div>
                        {trader.status === 'running' && trader.tradingTime === false && (
                          <div className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/30 text-amber-300 border border-amber-500/50 animate-pulse">
                            🚦 Wartet
                          </div>
                        )}
                      </div>
                      {trader.description && (
                        <p className="text-[11px] text-gray-500 truncate">{trader.description}</p>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    <Link
                      to={`/ai-trader/${trader.id}`}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"
                    >
                      Öffnen →
                    </Link>
                    <button
                      onClick={() => handleDeleteTrader(trader)}
                      disabled={deletingId === trader.id}
                      className="p-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deletingId === trader.id ? '…' : '🗑️'}
                    </button>
                  </div>
                </div>
                
                {/* Stats Grid - all key data at a glance */}
                <div className="px-3 py-2">
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                    {/* P&L */}
                    <div className={`rounded px-2 py-1.5 ${pnl >= 0 ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                      <div className="text-[9px] text-gray-500 uppercase">P&L</div>
                      <div className={`text-sm font-bold font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%
                      </div>
                    </div>
                    {/* Win Rate */}
                    <div className="bg-slate-900/50 rounded px-2 py-1.5">
                      <div className="text-[9px] text-gray-500 uppercase">Win</div>
                      <div className={`text-sm font-bold font-mono ${winRate != null ? (winRate >= 50 ? 'text-green-400' : 'text-red-400') : 'text-gray-500'}`}>
                        {winRate != null ? `${winRate.toFixed(0)}%` : '–'}
                      </div>
                    </div>
                    {/* Trades W/L */}
                    <div className="bg-slate-900/50 rounded px-2 py-1.5">
                      <div className="text-[9px] text-gray-500 uppercase">Trades</div>
                      <div className="text-sm font-bold font-mono text-white">
                        {closedTrades > 0
                          ? <><span className="text-green-400">{trader.winningTrades}</span><span className="text-gray-600">/</span><span className="text-red-400">{trader.losingTrades}</span></>
                          : <span className="text-gray-500">{trader.tradesExecuted}</span>
                        }
                      </div>
                    </div>
                    {/* Streak */}
                    <div className="bg-slate-900/50 rounded px-2 py-1.5">
                      <div className="text-[9px] text-gray-500 uppercase">Streak</div>
                      <div className={`text-sm font-bold font-mono ${trader.currentStreak > 0 ? 'text-green-400' : trader.currentStreak < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                        {trader.currentStreak !== 0 
                          ? <>{trader.currentStreak > 0 ? '🔥' : '❄️'} {trader.currentStreak > 0 ? '+' : ''}{trader.currentStreak}</>
                          : '–'
                        }
                      </div>
                    </div>
                    {/* Capital */}
                    <div className="bg-slate-900/50 rounded px-2 py-1.5 hidden sm:block">
                      <div className="text-[9px] text-gray-500 uppercase">Kapital</div>
                      <div className="text-sm font-bold font-mono text-white">
                        {capital ? `${(capital / 1000).toFixed(0)}k` : '–'}
                      </div>
                    </div>
                    {/* Max DD */}
                    <div className="bg-slate-900/50 rounded px-2 py-1.5 hidden sm:block">
                      <div className="text-[9px] text-gray-500 uppercase">Max DD</div>
                      <div className={`text-sm font-bold font-mono ${trader.maxDrawdown > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                        {trader.maxDrawdown > 0 ? `-${trader.maxDrawdown.toFixed(1)}%` : '–'}
                      </div>
                    </div>
                  </div>
                  
                  {/* Bottom bar: config tags + last activity */}
                  <div className="flex items-center justify-between mt-1.5 text-[10px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Risk badge */}
                      {riskTolerance && (
                        <span className={`px-1.5 py-0.5 rounded ${
                          riskTolerance === 'conservative' ? 'bg-blue-500/15 text-blue-400' :
                          riskTolerance === 'aggressive' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'
                        }`}>
                          {riskTolerance === 'conservative' ? '🛡️ Konservativ' :
                           riskTolerance === 'aggressive' ? '🔥 Aggressiv' : '⚖️ Moderat'}
                        </span>
                      )}
                      {/* Horizon badge */}
                      {horizon && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-700/50 text-gray-400">
                          {horizon === 'scalping' ? '⚡ Scalping' :
                           horizon === 'day' ? '📅 Day' :
                           horizon === 'swing' ? '📊 Swing' : '📈 Position'}
                        </span>
                      )}
                      {/* Schedule */}
                      {schedule?.tradingStart && schedule?.tradingEnd && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-700/50 text-gray-400">
                          🕐 {schedule.tradingStart}–{schedule.tradingEnd}
                        </span>
                      )}
                      {/* Best/Worst trades */}
                      {trader.bestTradePnl != null && (
                        <span className="text-green-500 hidden sm:inline">↑ +{trader.bestTradePnl.toFixed(1)}%</span>
                      )}
                      {trader.worstTradePnl != null && (
                        <span className="text-red-500 hidden sm:inline">↓ {trader.worstTradePnl.toFixed(1)}%</span>
                      )}
                    </div>
                    {/* Last activity */}
                    <div className="text-gray-600 flex-shrink-0">
                      {trader.lastTradeAt ? (
                        <span>
                          Letzter Trade: {(() => {
                            const diff = Date.now() - new Date(trader.lastTradeAt).getTime();
                            const mins = Math.floor(diff / 60000);
                            const hrs = Math.floor(mins / 60);
                            const days = Math.floor(hrs / 24);
                            if (mins < 1) return 'gerade eben';
                            if (mins < 60) return `vor ${mins}m`;
                            if (hrs < 24) return `vor ${hrs}h`;
                            return `vor ${days}d`;
                          })()}
                        </span>
                      ) : trader.createdAt ? (
                        <span>Erstellt: {new Date(trader.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info - collapsible, unobtrusive */}
      <details className="group">
        <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-2 py-2">
          <span className="group-open:rotate-90 transition-transform">▶</span>
          ℹ️ Was sind AI Live Trader?
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <h4 className="text-sm font-semibold text-white mb-2">📚 {t('aiTraders.info.howItWorks')}</h4>
            <div className="text-xs text-slate-400 space-y-1.5">
              <p>{t('aiTraders.info.paragraph1')}</p>
              <p>{t('aiTraders.info.paragraph2')}</p>
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <h4 className="text-sm font-semibold text-white mb-2">⚙️ {t('aiTraders.info.features')}</h4>
            <ul className="text-xs text-slate-400 space-y-1">
              <li>• {t('aiTraders.info.feature1')}</li>
              <li>• {t('aiTraders.info.feature2')}</li>
              <li>• {t('aiTraders.info.feature3')}</li>
              <li>• {t('aiTraders.info.feature4')}</li>
            </ul>
          </div>
          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3">
            <h4 className="text-sm text-amber-400 font-medium mb-2">⚠️ {t('aiTraders.info.disclaimer')}</h4>
            <p className="text-xs text-amber-200/80">{t('aiTraders.info.disclaimerText')}</p>
          </div>
        </div>
      </details>
    </div>
  );
}
