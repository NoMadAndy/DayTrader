/**
 * AI Traders Management Page
 * 
 * Dedicated page for managing Live AI Traders.
 * Allows users to:
 * - View existing AI traders and their status
 * - Create new AI traders with custom configurations
 * - Navigate to individual AI trader dashboards
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import { 
  getAITraders, 
  createAITrader, 
  updateAITrader,
  deleteAITrader,
  getDefaultPersonality 
} from '../services/aiTraderService';
import type { AITrader, AITraderPersonality, AITraderStatus, CreateAITraderRequest } from '../types/aiTrader';
import { useSettings } from '../contexts';

// Available avatars for AI traders
const AVATAR_OPTIONS = ['🤖', '🧠', '💹', '📈', '🎯', '⚡', '🔮', '🌟', '🚀', '💎', '🦾', '🎲'];

// Available avatar names for accessibility
const AVATAR_NAMES: Record<string, string> = {
  '🤖': 'Robot',
  '🧠': 'Brain',
  '💹': 'Chart',
  '📈': 'Growth',
  '🎯': 'Target',
  '⚡': 'Lightning',
  '🔮': 'Crystal Ball',
  '🌟': 'Star',
  '🚀': 'Rocket',
  '💎': 'Diamond',
  '🦾': 'Mechanical Arm',
  '🎲': 'Dice',
};

// Risk tolerance options - labels are translation keys
const RISK_OPTIONS = [
  { value: 'conservative', labelKey: 'aiTraders.risk.conservative', descKey: 'aiTraders.risk.conservativeDesc' },
  { value: 'moderate', labelKey: 'aiTraders.risk.moderate', descKey: 'aiTraders.risk.moderateDesc' },
  { value: 'aggressive', labelKey: 'aiTraders.risk.aggressive', descKey: 'aiTraders.risk.aggressiveDesc' },
] as const;

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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [defaultPersonality, setDefaultPersonality] = useState<AITraderPersonality | null>(null);
  const { t, formatCurrency } = useSettings();
  const navigate = useNavigate();

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAvatar, setFormAvatar] = useState('🤖');
  const [formInitialCapital, setFormInitialCapital] = useState(100000);
  const [formRiskTolerance, setFormRiskTolerance] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');
  const [formWatchlistSymbols, setFormWatchlistSymbols] = useState('AAPL,MSFT,GOOGL,AMZN,TSLA');

  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);

  useEffect(() => {
    loadTraders();
    loadDefaultPersonality();
  }, []);

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

  const loadDefaultPersonality = async () => {
    try {
      const personality = await getDefaultPersonality();
      setDefaultPersonality(personality);
    } catch (err) {
      console.error('Failed to load default personality:', err);
    }
  };

  const handleCreateTrader = async () => {
    if (!formName.trim()) {
      setError(t('aiTraders.nameRequired'));
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      // Build personality with form values
      const personality: AITraderPersonality = {
        ...(defaultPersonality || {
          capital: { initialBudget: 100000, maxPositionSize: 25, reserveCashPercent: 10 },
          risk: { tolerance: 'moderate', maxDrawdown: 20, stopLossPercent: 5, takeProfitPercent: 10 },
          signals: { weights: { ml: 0.25, rl: 0.25, sentiment: 0.25, technical: 0.25 }, minAgreement: 0.6 },
          trading: { minConfidence: 0.6, maxOpenPositions: 5, diversification: true },
          schedule: { enabled: true, checkIntervalMinutes: 15, tradingHoursOnly: true, timezone: 'Europe/Berlin' },
          watchlist: { symbols: [], autoUpdate: true },
          sentiment: { enabled: true, minScore: 0.3 },
          learning: { enabled: true, updateWeights: true },
        }),
        capital: {
          ...(defaultPersonality?.capital || { initialBudget: 100000, maxPositionSize: 25, reserveCashPercent: 10 }),
          initialBudget: formInitialCapital,
        },
        risk: {
          ...(defaultPersonality?.risk || { tolerance: 'moderate', maxDrawdown: 20, stopLossPercent: 5, takeProfitPercent: 10 }),
          tolerance: formRiskTolerance,
        },
        watchlist: {
          symbols: formWatchlistSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
          autoUpdate: true,
        },
      };

      const request: CreateAITraderRequest = {
        name: formName,
        description: formDescription || undefined,
        personality,
        initialCapital: formInitialCapital,
      };

      const newTrader = await createAITrader(request);
      
      // Update the avatar if it's different from default
      if (formAvatar !== '🤖') {
        try {
          await updateAITrader(newTrader.id, { avatar: formAvatar });
        } catch (avatarErr) {
          console.warn('Failed to set avatar:', avatarErr);
        }
      }
      
      setSuccess(t('aiTraders.createSuccess').replace('{name}', newTrader.name));
      setShowCreateForm(false);
      resetForm();
      loadTraders();

      // Navigate to the new trader's dashboard after a brief delay
      setTimeout(() => {
        navigate(`/ai-trader/${newTrader.id}`);
      }, 1500);
    } catch (err) {
      console.error('Failed to create AI trader:', err);
      setError(err instanceof Error ? err.message : t('aiTraders.createError'));
    } finally {
      setCreating(false);
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

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormAvatar('🤖');
    setFormInitialCapital(100000);
    setFormRiskTolerance('moderate');
    setFormWatchlistSymbols('AAPL,MSFT,GOOGL,AMZN,TSLA');
  };

  const closeModal = useCallback(() => {
    setShowCreateForm(false);
    resetForm();
  }, []);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showCreateForm) {
        closeModal();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCreateForm, closeModal]);

  if (!authState.isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-slate-800 rounded-lg p-8 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">🤖 {t('aiTraders.title')}</h2>
            <p className="text-slate-400 mb-4">
              {t('aiTraders.loginRequired')}
            </p>
            <Link 
              to="/settings" 
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {t('nav.login')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">🤖 {t('aiTraders.title')}</h1>
            <p className="text-slate-400">
              {t('aiTraders.description')}
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <span className="text-xl">+</span>
            {t('aiTraders.newTrader')}
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300">
            {success}
          </div>
        )}

        {/* Create Form Modal */}
        {showCreateForm && (
          <div 
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-trader-title"
          >
            <div className="bg-slate-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-700">
                <div className="flex items-center justify-between">
                  <h2 id="create-trader-title" className="text-xl font-bold text-white flex items-center gap-2">
                    ✨ {t('aiTraders.createTitle')}
                  </h2>
                  <button
                    onClick={closeModal}
                    className="text-gray-400 hover:text-white p-2"
                    aria-label={t('aiTraders.form.cancel')}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('aiTraders.form.name')} *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={t('aiTraders.form.namePlaceholder')}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('aiTraders.form.description')}
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder={t('aiTraders.form.descriptionPlaceholder')}
                    rows={2}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none resize-none"
                  />
                </div>

                {/* Avatar Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('aiTraders.form.avatar')}
                  </label>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('aiTraders.form.avatar')}>
                    {AVATAR_OPTIONS.map((avatar) => (
                      <button
                        key={avatar}
                        onClick={() => setFormAvatar(avatar)}
                        className={`w-12 h-12 rounded-lg text-2xl flex items-center justify-center transition-colors ${
                          formAvatar === avatar
                            ? 'bg-blue-600 border-2 border-blue-400'
                            : 'bg-slate-700 hover:bg-slate-600 border-2 border-transparent'
                        }`}
                        role="radio"
                        aria-checked={formAvatar === avatar}
                        aria-label={`Select ${AVATAR_NAMES[avatar]} avatar`}
                      >
                        {avatar}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Initial Capital */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('aiTraders.form.initialCapital')}
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={10000}
                      max={1000000}
                      step={10000}
                      value={formInitialCapital}
                      onChange={(e) => setFormInitialCapital(parseInt(e.target.value))}
                      className="flex-1"
                    />
                    <span className="text-white font-medium w-32 text-right">
                      {formatCurrency(formInitialCapital)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{t('aiTraders.form.capitalHint')}</p>
                </div>

                {/* Risk Tolerance */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('aiTraders.form.riskTolerance')}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {RISK_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setFormRiskTolerance(option.value as typeof formRiskTolerance)}
                        className={`p-3 rounded-lg text-left transition-colors ${
                          formRiskTolerance === option.value
                            ? 'bg-blue-600/30 border-2 border-blue-500'
                            : 'bg-slate-700 hover:bg-slate-600 border-2 border-transparent'
                        }`}
                      >
                        <div className="font-medium text-white">{t(option.labelKey)}</div>
                        <div className="text-xs text-gray-400">{t(option.descKey)}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Watchlist Symbols */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('aiTraders.form.watchlist')}
                  </label>
                  <input
                    type="text"
                    value={formWatchlistSymbols}
                    onChange={(e) => setFormWatchlistSymbols(e.target.value)}
                    placeholder="AAPL, MSFT, GOOGL"
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('aiTraders.form.watchlistHint')}</p>
                </div>

                {/* Info Box */}
                <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">💡</span>
                    <div className="text-sm text-blue-200">
                      <p className="font-medium mb-1">{t('aiTraders.form.infoTitle')}</p>
                      <p className="text-blue-300/80">{t('aiTraders.form.infoText')}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-slate-700 flex gap-3 justify-end">
                <button
                  onClick={closeModal}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  {t('aiTraders.form.cancel')}
                </button>
                <button
                  onClick={handleCreateTrader}
                  disabled={creating || !formName.trim()}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {creating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      {t('aiTraders.form.creating')}
                    </>
                  ) : (
                    <>
                      🚀 {t('aiTraders.form.create')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Traders List */}
          <div className="lg:col-span-2">
            {loading ? (
              <div className="bg-slate-800 rounded-lg p-8 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : traders.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-8 text-center">
                <div className="text-6xl mb-4">🤖</div>
                <h3 className="text-xl font-semibold text-white mb-2">{t('aiTraders.noTraders')}</h3>
                <p className="text-slate-400 mb-4">{t('aiTraders.noTradersHint')}</p>
                <button
                  onClick={() => setShowCreateForm(true)}
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
                      className="bg-slate-800 rounded-lg p-4 hover:bg-slate-800/80 transition-colors"
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
                              <span className={trader.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                                P&L: {trader.totalPnl >= 0 ? '+' : ''}{trader.totalPnl.toFixed(2)}%
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
            <div className="bg-slate-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">📚 {t('aiTraders.info.howItWorks')}</h3>
              <div className="text-sm text-slate-400 space-y-3">
                <p>{t('aiTraders.info.paragraph1')}</p>
                <p>{t('aiTraders.info.paragraph2')}</p>
                <p>{t('aiTraders.info.paragraph3')}</p>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-4">
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
    </div>
  );
}
