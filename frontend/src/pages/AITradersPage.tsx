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
      console.error('Failed to refresh AI traders:', err);
    }
  };

  const loadTraders = async () => {
    try {
      setLoading(true);
      setError(null);
      const traderList = await getAITraders();
      setTraders(traderList);
    } catch (err) {
      console.error('Failed to load AI traders:', err);
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
      console.error('Failed to delete AI trader:', err);
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
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
            <span className="text-2xl sm:text-3xl">🤖</span>
            {t('aiTraders.title')}
          </h1>
          <p className="text-slate-400 mt-1">
            {t('aiTraders.description')}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <span className="text-xl">+</span>
          {t('aiTraders.newTrader')}
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300">
          {success}
        </div>
      )}

      {/* Create Trader Modal (unified config modal) */}
      <AITraderConfigModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSaved={handleTraderCreated}
      />

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Traders List */}
        <div className="lg:col-span-2">
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
            <div className="space-y-4">
              {traders.map((trader) => {
                const statusStyle = STATUS_STYLES[trader.status];
                return (
                  <div
                    key={trader.id}
                    className="bg-slate-800/50 rounded-lg p-4 hover:bg-slate-700/50 transition-colors border border-slate-700/50"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <Link 
                        to={`/ai-trader/${trader.id}`}
                        className="flex items-start gap-4 flex-1 min-w-0"
                      >
                        <span className="text-4xl flex-shrink-0">{trader.avatar}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-semibold text-white truncate">{trader.name}</h3>
                            <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                              {statusStyle.icon} {trader.status}
                            </div>
                            {trader.status === 'running' && trader.tradingTime === false && (
                              <div className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/30 text-amber-300 border-2 border-amber-500/50 flex items-center gap-1 animate-pulse">
                                🚦 Wartet auf Handelszeit
                              </div>
                          )}
                          </div>
                          {trader.description && (
                            <p className="text-sm text-gray-400 mt-1 truncate">{trader.description}</p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-sm">
                            <span className="text-gray-400">
                              {t('aiTraders.trades')}: <span className="text-white">{trader.tradesExecuted}</span>
                            </span>
                            <span className="text-gray-400">
                              {t('aiTraders.winRate')}: <span className="text-white">
                                {trader.tradesExecuted > 0 
                                  ? `${((trader.winningTrades / trader.tradesExecuted) * 100).toFixed(1)}%`
                                  : '-'}
                              </span>
                            </span>
                            <span className={(trader.totalPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}>
                              P&L: {(trader.totalPnl ?? 0) >= 0 ? '+' : ''}{(trader.totalPnl ?? 0).toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      </Link>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Link
                          to={`/ai-trader/${trader.id}`}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                        >
                          {t('aiTraders.viewDashboard')}
                        </Link>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            handleDeleteTrader(trader);
                          }}
                          disabled={deletingId === trader.id}
                          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-sm rounded-lg transition-colors disabled:opacity-50"
                        >
                          {deletingId === trader.id ? '...' : '🗑️'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info Panel */}
        <div className="space-y-4">
          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-lg font-semibold text-white mb-3">📚 {t('aiTraders.info.howItWorks')}</h3>
            <div className="text-sm text-slate-400 space-y-3">
              <p>{t('aiTraders.info.paragraph1')}</p>
              <p>{t('aiTraders.info.paragraph2')}</p>
              <p>{t('aiTraders.info.paragraph3')}</p>
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-lg font-semibold text-white mb-3">⚙️ {t('aiTraders.info.features')}</h3>
            <ul className="text-sm text-slate-400 space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                {t('aiTraders.info.feature1')}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                {t('aiTraders.info.feature2')}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                {t('aiTraders.info.feature3')}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                {t('aiTraders.info.feature4')}
              </li>
            </ul>
          </div>

          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4">
            <h4 className="text-amber-400 font-medium mb-2">⚠️ {t('aiTraders.info.disclaimer')}</h4>
            <p className="text-sm text-amber-200/80">
              {t('aiTraders.info.disclaimerText')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
