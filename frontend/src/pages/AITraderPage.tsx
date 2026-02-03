/**
 * AI Trader Dashboard Page
 * 
 * Full dashboard for monitoring and controlling AI traders.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AITraderCard } from '../components/AITraderCard';
import { AITraderActivityFeed } from '../components/AITraderActivityFeed';
import { AITraderSettingsModal } from '../components/AITraderSettingsModal';
import { AITraderTrainingStatus } from '../components/AITraderTrainingStatus';
import { TradeReasoningCard } from '../components/TradeReasoningCard';
import AITraderReportCard from '../components/AITraderReportCard';
import AITraderInsights from '../components/AITraderInsights';
import SignalAccuracyChart from '../components/SignalAccuracyChart';
import AdaptiveWeightsPanel from '../components/AdaptiveWeightsPanel';
import TradeAlertBar from '../components/TradeAlertBar';
import TradeDetailCard from '../components/TradeDetailCard';
import SelfTrainingIndicator from '../components/SelfTrainingIndicator';
import { useAITraderStream } from '../hooks/useAITraderStream';
import { useAITraderReports } from '../hooks/useAITraderReports';
import { useNotificationFeedback } from '../hooks/useNotificationFeedback';
import { useWakeLock } from '../hooks/useWakeLock';
import { startAITrader, stopAITrader, pauseAITrader } from '../services/aiTraderService';
import type { AITrader, AITraderDecision, AITraderEvent } from '../types/aiTrader';
import type { PositionWithPnL } from '../types/trading';

// Auto-refresh interval in milliseconds
const AUTO_REFRESH_INTERVAL_MS = 30000; // 30 seconds

// Trade alert interface for the alert bar
interface TradeAlert {
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

export function AITraderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trader, setTrader] = useState<AITrader | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [decisions, setDecisions] = useState<AITraderDecision[]>([]);
  const [importantDecisions, setImportantDecisions] = useState<AITraderDecision[]>([]);
  const [positions, setPositions] = useState<PositionWithPnL[]>([]);
  const [portfolio, setPortfolio] = useState<{ 
    cash: number; 
    totalValue: number; 
    pnl: number;
    unrealizedPnl?: number;
    dailyPnl?: number;
    dailyPnlPct?: number;
    initialCapital?: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'activity' | 'reports' | 'analytics'>('activity');
  const [selectedReportIndex, setSelectedReportIndex] = useState(0);
  const lastRefreshRef = useRef<number>(0);
  const [activityPanelExpanded, setActivityPanelExpanded] = useState(false);
  
  // Trade alert state for sticky notification
  const [currentTradeAlert, setCurrentTradeAlert] = useState<TradeAlert | null>(null);
  const processedTradeAlertsRef = useRef<Set<number>>(new Set());
  
  // Notification settings (persisted in localStorage)
  const [notificationSettings, setNotificationSettings] = useState(() => {
    const saved = localStorage.getItem('aiTraderNotifications');
    return saved ? JSON.parse(saved) : { sound: false, vibration: false, flash: true };
  });
  
  // Screen Wake Lock for mobile devices
  const wakeLock = useWakeLock();
  
  // Track previous decisions for detecting new ones
  const prevDecisionIdsRef = useRef<Set<number>>(new Set());
  const [newDecisionIds, setNewDecisionIds] = useState<Set<number>>(new Set());
  
  // Notification feedback hook
  const { notifyDecision } = useNotificationFeedback({ settings: notificationSettings });
  
  // Persist notification settings
  useEffect(() => {
    localStorage.setItem('aiTraderNotifications', JSON.stringify(notificationSettings));
  }, [notificationSettings]);
  
  // Detect new decisions and trigger feedback
  useEffect(() => {
    if (decisions.length === 0) return;
    
    const currentIds = new Set(decisions.map(d => d.id));
    const newIds = new Set<number>();
    
    // Find truly new decisions (not seen before)
    decisions.forEach(d => {
      if (!prevDecisionIdsRef.current.has(d.id)) {
        newIds.add(d.id);
        // Trigger notification for non-skip decisions
        if (d.decisionType !== 'skip') {
          notifyDecision(d.decisionType, d.executed);
        }
        
        // Show Trade Alert Bar for executed buy/sell/short/close
        if (d.executed && ['buy', 'sell', 'short', 'close'].includes(d.decisionType) && 
            !processedTradeAlertsRef.current.has(d.id)) {
          processedTradeAlertsRef.current.add(d.id);
          
          const reasoning = typeof d.reasoning === 'object' ? d.reasoning : {};
          setCurrentTradeAlert({
            id: d.id,
            symbol: d.symbol,
            action: d.decisionType as 'buy' | 'sell' | 'short' | 'close',
            quantity: (reasoning as { quantity?: number }).quantity || 0,
            price: (reasoning as { price?: number }).price || 0,
            confidence: d.confidence,
            weightedScore: d.weightedScore,
            mlScore: d.mlScore,
            rlScore: d.rlScore,
            sentimentScore: d.sentimentScore,
            technicalScore: d.technicalScore,
            signalAgreement: d.signalAgreement || 'unknown',
            reasoning: d.summaryShort || 'No reasoning available',
            riskChecksPassed: (reasoning as { risk_checks_passed?: boolean }).risk_checks_passed ?? true,
            riskWarnings: (reasoning as { risk_warnings?: string[] }).risk_warnings || [],
            timestamp: d.timestamp,
            cost: (reasoning as { quantity?: number; price?: number }).quantity && (reasoning as { quantity?: number; price?: number }).price 
              ? (reasoning as { quantity?: number; price?: number }).quantity! * (reasoning as { quantity?: number; price?: number }).price!
              : undefined,
          });
        }
      }
    });
    
    // Update refs and state
    if (newIds.size > 0) {
      setNewDecisionIds(newIds);
      // Clear flash after animation
      setTimeout(() => setNewDecisionIds(new Set()), 2000);
    }
    
    prevDecisionIdsRef.current = currentIds;
  }, [decisions, notifyDecision]);
  
  const traderId = id ? parseInt(id) : undefined;
  
  const { reports } = useAITraderReports(traderId);
  
  // Helper function to transform decision data from snake_case to camelCase
  const transformDecision = useCallback((d: Record<string, unknown>): AITraderDecision => ({
    id: d.id as number,
    aiTraderId: d.ai_trader_id as number,
    timestamp: d.timestamp as string,
    symbol: d.symbol as string,
    symbolsAnalyzed: (d.symbols_analyzed || []) as string[],
    decisionType: d.decision_type as AITraderDecision['decisionType'],
    reasoning: (d.reasoning || {}) as AITraderDecision['reasoning'],
    executed: d.executed as boolean,
    positionId: d.position_id as number | null,
    orderId: d.order_id as number | null,
    executionError: d.execution_error as string | null,
    confidence: parseFloat(String(d.confidence)) || 0,
    weightedScore: parseFloat(String(d.weighted_score)) || 0,
    mlScore: parseFloat(String(d.ml_score)) || 0,
    rlScore: parseFloat(String(d.rl_score)) || 0,
    sentimentScore: parseFloat(String(d.sentiment_score)) || 0,
    technicalScore: parseFloat(String(d.technical_score)) || 0,
    signalAgreement: d.signal_agreement as AITraderDecision['signalAgreement'],
    summaryShort: d.summary_short as string | null,
    marketContext: (d.market_context || {}) as AITraderDecision['marketContext'],
    portfolioSnapshot: (d.portfolio_snapshot || {}) as AITraderDecision['portfolioSnapshot'],
    outcomePnl: d.outcome_pnl as number | null,
    outcomePnlPercent: d.outcome_pnl_percent as number | null,
    outcomeHoldingDays: d.outcome_holding_days as number | null,
    outcomeWasCorrect: d.outcome_was_correct as boolean | null,
  }), []);
  
  // Load all trader data (trader details, decisions, positions, portfolio)
  const loadTraderData = useCallback(async (showLoadingState = false) => {
    if (!traderId) return;
    
    try {
      if (showLoadingState) {
        setLoading(true);
        setError(null);
      }
      lastRefreshRef.current = Date.now();
      
      // Fetch trader details (with cache-busting)
      const traderRes = await fetch(`/api/ai-traders/${traderId}?_t=${Date.now()}`, { cache: 'no-store' });
      if (!traderRes.ok) throw new Error('Failed to load trader');
      const traderData = await traderRes.json();
      setTrader(traderData);
      
      // Fetch decisions (with cache-busting timestamp to ensure fresh data)
      const decisionsRes = await fetch(`/api/ai-traders/${traderId}/decisions?limit=50&_t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (decisionsRes.ok) {
        const decisionsData = await decisionsRes.json();
        const transformedDecisions = (Array.isArray(decisionsData) ? decisionsData : []).map(transformDecision);
        setDecisions(transformedDecisions);
        
        // Extract important decisions (executed buy/sell/close/short)
        const important = transformedDecisions.filter(
          (d: AITraderDecision) => d.executed && ['buy', 'sell', 'close', 'short'].includes(d.decisionType)
        );
        setImportantDecisions(important);
      }
      
      // Fetch positions (with cache-busting)
      const positionsRes = await fetch(`/api/ai-traders/${traderId}/positions?_t=${Date.now()}`, { cache: 'no-store' });
      if (positionsRes.ok) {
        const positionsData = await positionsRes.json();
        // API returns array directly, not {positions: [...]}
        setPositions(Array.isArray(positionsData) ? positionsData : (positionsData.positions || []));
      }
      
      // Fetch portfolio info using the AI trader portfolio endpoint
      const portfolioRes = await fetch(`/api/ai-traders/${traderId}/portfolio?_t=${Date.now()}`, { cache: 'no-store' });
      if (portfolioRes.ok) {
        const portfolioData = await portfolioRes.json();
        setPortfolio({
          cash: portfolioData.cash || 0,
          totalValue: portfolioData.total_value || 0,
          pnl: portfolioData.total_pnl_pct || 0,
          unrealizedPnl: portfolioData.unrealized_pnl || 0,
          dailyPnl: portfolioData.daily_pnl || 0,
          dailyPnlPct: portfolioData.daily_pnl_pct || 0,
          initialCapital: portfolioData.initial_capital || 100000,
        });
      }
    } catch (err) {
      console.error('Error loading trader data:', err);
      if (showLoadingState) {
        setError('Failed to load AI trader data');
      }
    } finally {
      if (showLoadingState) {
        setLoading(false);
      }
    }
  }, [traderId, transformDecision]);
  
  // Delete a decision
  const handleDeleteDecision = useCallback(async (decisionId: number) => {
    if (!traderId) return;
    
    try {
      const res = await fetch(`/api/ai-traders/${traderId}/decisions/${decisionId}`, {
        method: 'DELETE',
      });
      
      if (res.ok) {
        // Remove from both lists
        setDecisions(prev => prev.filter(d => d.id !== decisionId));
        setImportantDecisions(prev => prev.filter(d => d.id !== decisionId));
      } else {
        console.error('Failed to delete decision');
      }
    } catch (err) {
      console.error('Error deleting decision:', err);
    }
  }, [traderId]);
  
  // Initial load
  useEffect(() => {
    if (!traderId) {
      navigate('/leaderboard');
      return;
    }
    loadTraderData(true);
  }, [traderId, navigate, loadTraderData]);
  
  // Auto-refresh polling every 30 seconds
  useEffect(() => {
    if (!traderId) return;
    
    const intervalId = setInterval(() => {
      loadTraderData(false);
    }, AUTO_REFRESH_INTERVAL_MS);
    
    return () => clearInterval(intervalId);
  }, [traderId, loadTraderData]);
  
  // Handle SSE events - trigger refresh on important events
  const handleSSEEvent = useCallback((event: AITraderEvent) => {
    // On decision_made, trade_executed, or status_changed, refresh data immediately
    if (['decision_made', 'trade_executed', 'status_changed', 'position_closed'].includes(event.type)) {
      // Debounce: only refresh if last refresh was more than 2 seconds ago
      if (Date.now() - lastRefreshRef.current > 2000) {
        loadTraderData(false);
      }
    }
  }, [loadTraderData]);
  
  // Subscribe to SSE events
  const { events: sseEvents, connected, mode, reconnect, clearEvents } = useAITraderStream({ 
    traderId,
    enabled: !!traderId,
    onEvent: handleSSEEvent,
  });
  
  // Convert decisions to events and combine with SSE events
  const allEvents = useMemo(() => {
    // Convert DB decisions to event format
    const decisionEvents: AITraderEvent[] = decisions.map((d) => ({
      type: 'decision_made' as const,
      traderId: d.aiTraderId,
      timestamp: d.timestamp,
      data: {
        traderId: d.aiTraderId,
        symbol: d.symbol,
        decisionType: d.decisionType,
        confidence: d.confidence,
        weightedScore: d.weightedScore,
        mlScore: d.mlScore,
        rlScore: d.rlScore,
        sentimentScore: d.sentimentScore,
        technicalScore: d.technicalScore,
        summary: d.summaryShort || `${d.decisionType?.toUpperCase()} ${d.symbol}`,
        timestamp: d.timestamp,
      },
    }));
    
    // Filter SSE events: only keep status events, not decision_made (those come from DB)
    const statusEvents = sseEvents.filter(e => 
      e.type !== 'decision_made' && e.type !== 'heartbeat'
    );
    
    // Combine status events with decision events
    const combined = [...statusEvents, ...decisionEvents];
    
    // Remove duplicates by unique key
    const seenKeys = new Set<string>();
    const unique = combined.filter(event => {
      const ts = String(event.data?.timestamp || event.timestamp || '');
      const sym = String(event.data?.symbol || '');
      const key = `${event.type}-${ts}-${sym}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    
    // Sort by timestamp (newest first)
    return unique.sort((a, b) => {
      const timeStrA = String(a.data?.timestamp || a.timestamp || '');
      const timeStrB = String(b.data?.timestamp || b.timestamp || '');
      // String comparison works for ISO timestamps and preserves millisecond precision
      if (timeStrA > timeStrB) return -1;
      if (timeStrA < timeStrB) return 1;
      // If timestamps are identical, sort by symbol for stable ordering
      const symbolA = String(a.data?.symbol || '');
      const symbolB = String(b.data?.symbol || '');
      return symbolB.localeCompare(symbolA);
    });
  }, [sseEvents, decisions]);
  
  const handleStart = async () => {
    if (!traderId) return;
    try {
      // Clear old SSE events before starting to avoid duplicates
      clearEvents();
      const updated = await startAITrader(traderId);
      setTrader(updated);
    } catch (err) {
      console.error('Error starting trader:', err);
    }
  };
  
  const handleStop = async () => {
    if (!traderId) return;
    try {
      const updated = await stopAITrader(traderId);
      setTrader(updated);
      // Clear SSE events after stopping
      clearEvents();
    } catch (err) {
      console.error('Error stopping trader:', err);
    }
  };
  
  const handlePause = async () => {
    if (!traderId) return;
    try {
      const updated = await pauseAITrader(traderId);
      setTrader(updated);
    } catch (err) {
      console.error('Error pausing trader:', err);
    }
  };
  
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading AI Trader...</p>
        </div>
      </div>
    );
  }
  
  if (error || !trader) {
    return (
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6">
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-center">
          <div className="text-2xl mb-2">❌</div>
          <div className="font-medium">{error || 'AI Trader not found'}</div>
          <button
            onClick={() => navigate('/ai-traders')}
            className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            Zurück zur Übersicht
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <>
      {/* Trade Alert Bar - sticky at top */}
      <TradeAlertBar 
        trade={currentTradeAlert} 
        onDismiss={() => setCurrentTradeAlert(null)}
        autoDismissMs={30000}
      />
      
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/ai-traders')}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
            title="Zurück zur AI Traders Übersicht"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl sm:text-2xl font-bold">AI Trader Dashboard</h1>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 transition-colors flex items-center gap-2"
            title="Einstellungen bearbeiten"
          >
            <span>⚙️</span>
            <span className="text-sm font-medium hidden sm:inline">Einstellungen</span>
          </button>
          
          {/* Trading Hours Indicator - Always show current market status */}
          {(() => {
            const schedule = trader.personality?.schedule;
            const tradingStart = schedule?.tradingStart || '15:30';
            const tradingEnd = schedule?.tradingEnd || '22:00';
            const isOpen = trader.tradingTime;
            return (
              <div 
                className={`px-3 py-1.5 rounded-lg flex items-center gap-2 ${
                  isOpen 
                    ? 'bg-green-500/20 border border-green-500/50' 
                    : 'bg-amber-500/20 border border-amber-500/50'
                }`}
                title={`Handelszeiten: ${tradingStart} - ${tradingEnd} (${schedule?.timezone || 'Europe/Berlin'})`}
              >
                <span className="text-lg">{isOpen ? '🟢' : '🟡'}</span>
                <span className="text-sm font-medium">
                  {isOpen ? 'Markt offen' : `${tradingStart} - ${tradingEnd}`}
                </span>
              </div>
            );
          })()}
          
          {/* Connection Status */}
          <button
            onClick={reconnect}
            className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-colors ${
              connected ? 'hover:bg-slate-700/50' : 'bg-red-500/20 hover:bg-red-500/30'
            }`}
            title={connected ? `Verbunden via ${mode === 'sse' ? 'SSE' : 'Polling'}` : 'Klicken zum Neu verbinden'}
          >
            <div className={`w-2 h-2 rounded-full ${
              connected 
                ? mode === 'sse' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'
                : 'bg-red-500'
            }`} />
            <span className="text-sm text-gray-400">
              {connected 
                ? mode === 'sse' ? 'Live' : 'Polling'
                : mode === 'connecting' ? 'Verbinde...' : 'Getrennt'
              }
            </span>
          </button>
        </div>
      </div>
      
      {/* Settings Modal */}
      {trader && (
        <AITraderSettingsModal
          trader={trader}
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          onUpdated={(updated) => setTrader(updated)}
        />
      )}
      
      {/* Main Card */}
      <AITraderCard
        trader={trader}
        onStart={handleStart}
        onStop={handleStop}
        onPause={handlePause}
      />
      
      {/* Trading Time Warning - Only show when market is closed AND trader is running */}
      {trader.tradingTime === false && trader.status === 'running' && (
        <div className="bg-amber-500/20 border border-amber-500/50 rounded-lg p-3 flex items-center gap-3">
          <span className="text-2xl">⏳</span>
          <div className="text-gray-300">
            <span className="font-medium text-amber-400">Wartet auf Handelszeit</span>
            {' – '}
            Handel beginnt um {trader.personality?.schedule?.tradingStart || '15:30'} ({trader.personality?.schedule?.timezone || 'Europe/Berlin'})
          </div>
        </div>
      )}
      
      {/* Combined Stats Row: Portfolio + Trade Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {/* Portfolio Stats */}
        {portfolio && (
          <>
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-2 sm:p-3">
              <div className="text-xs text-gray-400">💰 Cash</div>
              <div className="text-base sm:text-lg font-bold">${portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-2 sm:p-3">
              <div className="text-xs text-gray-400">📊 Wert</div>
              <div className="text-base sm:text-lg font-bold">${portfolio.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-2 sm:p-3">
              <div className="text-xs text-gray-400">📈 Unrealized</div>
              <div className={`text-base sm:text-lg font-bold ${(portfolio.unrealizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(portfolio.unrealizedPnl || 0) >= 0 ? '+' : ''}${(portfolio.unrealizedPnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          </>
        )}
        {/* Trade Stats */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-2 sm:p-3">
          <div className="text-xs text-gray-400">🎯 Trades</div>
          <div className="text-base sm:text-lg font-bold">{trader.tradesExecuted ?? 0}</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-2 sm:p-3">
          <div className="text-xs text-gray-400">🏆 Win Rate</div>
          <div className="text-base sm:text-lg font-bold">
            {(trader.tradesExecuted ?? 0) > 0 
              ? `${(((trader.winningTrades ?? 0) / (trader.tradesExecuted ?? 0)) * 100).toFixed(0)}%`
              : '-'}
          </div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-2 sm:p-3">
          <div className="text-xs text-gray-400">💹 Total P&L</div>
          <div className={`text-base sm:text-lg font-bold ${(trader.totalPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(trader.totalPnl ?? 0) >= 0 ? '+' : ''}{(trader.totalPnl ?? 0).toFixed(1)}%
          </div>
        </div>
      </div>
      
      {/* Tab Navigation */}
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-1 flex gap-1">
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex-1 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'activity'
              ? 'bg-blue-500 text-white'
              : 'text-gray-400 hover:bg-slate-700/50'
          }`}
        >
          🔴 Live Activity
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex-1 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'reports'
              ? 'bg-blue-500 text-white'
              : 'text-gray-400 hover:bg-slate-700/50'
          }`}
        >
          📊 Reports
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 px-4 py-2 rounded-md transition-colors ${
            activeTab === 'analytics'
              ? 'bg-blue-500 text-white'
              : 'text-gray-400 hover:bg-slate-700/50'
          }`}
        >
          📈 Analytics
        </button>
      </div>
      
      {/* Tab Content */}
      {activeTab === 'activity' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Trades & Positions */}
          <div className="space-y-4">
            {/* Self-Training Indicator - shows when training is in progress */}
            {traderId && (
              <SelfTrainingIndicator traderId={traderId} />
            )}
            
            {/* Important Decisions Panel - FIRST - Always visible */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-blue-500/50 border-l-4 border-l-blue-500">
              <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
                <h3 className="font-bold text-blue-300">
                  ⚡ Ausgeführte Trades ({importantDecisions.length})
                  <span className="text-xs text-gray-500 ml-2 font-normal">buy / sell / short / close</span>
                </h3>
                {importantDecisions.length > 0 && (
                  <span className="text-xs text-gray-500">Klick auf ✕ zum Löschen</span>
                )}
              </div>
              <div className="p-2 space-y-2 max-h-[400px] overflow-y-auto">
                {importantDecisions.length === 0 ? (
                  <div className="text-center text-gray-500 py-6">
                    <div className="text-2xl mb-1">📊</div>
                    <div className="text-sm font-medium">Keine ausgeführten Trades</div>
                    <div className="text-xs mt-1">Trades erscheinen hier sobald der AI Trader Positionen eröffnet oder schließt</div>
                  </div>
                ) : (
                  [...importantDecisions]
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .map((decision) => (
                      <TradeDetailCard 
                        key={decision.id} 
                        decision={decision}
                        isNew={newDecisionIds.has(decision.id)}
                        onDelete={() => {
                          if (confirm(`Entscheidung "${decision.symbol} ${decision.decisionType}" wirklich löschen?`)) {
                            handleDeleteDecision(decision.id);
                          }
                        }}
                      />
                    ))
                )}
              </div>
            </div>
            
            {/* Open Positions - Second */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
              <div className="px-4 py-3 border-b border-slate-700/50">
                <h3 className="font-bold">📍 Open Positions ({positions.length})</h3>
              </div>
              <div className="p-3">
                {positions.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">
                    <div className="text-xl mb-1">📭</div>
                    <div className="text-sm">No open positions</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {positions.map((position) => {
                      const pnlPercent = position.unrealizedPnlPercent || 0;
                      const pnl = position.unrealizedPnl || 0;
                      const hoursHeld = (position as any).hoursHeld || 0;
                      const daysHeld = (position as any).daysHeld || 0;
                      const distanceToSL = (position as any).distanceToStopLoss;
                      const distanceToTP = (position as any).distanceToTakeProfit;
                      const currentPrice = position.currentPrice || position.entryPrice;
                      
                      return (
                        <div 
                          key={position.id}
                          className="bg-slate-900/50 rounded-lg p-2 flex items-center gap-3"
                        >
                          {/* Symbol & Side */}
                          <div className="w-20 flex-shrink-0">
                            <div className="font-bold text-sm">{position.symbol}</div>
                            <div className="text-xs text-gray-500">
                              {position.side === 'short' ? '🔴 Short' : '🟢 Long'}
                            </div>
                          </div>
                          
                          {/* Qty & Prices */}
                          <div className="flex-1 text-xs text-gray-400">
                            <div>{position.quantity}x @ ${position.entryPrice?.toFixed(2)}</div>
                            <div>→ ${currentPrice?.toFixed(2)}</div>
                          </div>
                          
                          {/* P&L */}
                          <div className="text-right flex-shrink-0 w-20">
                            <div className={`font-bold ${pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                            </div>
                            <div className={`text-xs ${pnl >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                              ${Math.abs(pnl).toFixed(0)}
                            </div>
                          </div>
                          
                          {/* Risk Indicators */}
                          <div className="flex-shrink-0 flex flex-col items-end gap-0.5 w-16">
                            {distanceToSL != null && (
                              <div className={`text-xs px-1 rounded ${distanceToSL < 3 ? 'bg-red-500/30 text-red-300' : 'text-gray-500'}`}>
                                SL {distanceToSL.toFixed(1)}%
                              </div>
                            )}
                            {distanceToTP != null && (
                              <div className={`text-xs px-1 rounded ${distanceToTP < 3 ? 'bg-green-500/30 text-green-300' : 'text-gray-500'}`}>
                                TP {distanceToTP.toFixed(1)}%
                              </div>
                            )}
                          </div>
                          
                          {/* Time */}
                          <div className="text-xs text-gray-500 w-8 text-right">
                            {daysHeld > 0 ? `${daysHeld}d` : `${hoursHeld}h`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            
            {/* Recent Decisions */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
              <div className="px-4 py-3 border-b border-slate-700/50">
                <h3 className="font-bold">🧠 Recent Decisions</h3>
              </div>
              <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto">
                {decisions.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    <div className="text-2xl mb-2">🤔</div>
                    <div>No decisions yet</div>
                  </div>
                ) : (
                  decisions.map((decision) => (
                    <TradeReasoningCard 
                      key={decision.id} 
                      decision={decision} 
                      isNew={notificationSettings.flash && newDecisionIds.has(decision.id)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
          
          {/* Right Column: Notification Settings + Activity Feed */}
          <div className="space-y-4">
            {/* Notification & Display Settings Panel */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-medium text-gray-300">🔔 Benachrichtigungen</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setNotificationSettings((s: { sound: boolean; vibration: boolean; flash: boolean }) => ({ ...s, flash: !s.flash }))}
                    className={`px-2 py-1 text-xs rounded transition-colors ${notificationSettings.flash ? 'bg-yellow-500/30 text-yellow-400' : 'bg-slate-700/50 text-gray-500'}`}
                    title="Visueller Effekt bei neuen Entscheidungen"
                  >
                    ✨ Flash
                  </button>
                  <button
                    onClick={() => setNotificationSettings((s: { sound: boolean; vibration: boolean; flash: boolean }) => ({ ...s, sound: !s.sound }))}
                    className={`px-2 py-1 text-xs rounded transition-colors ${notificationSettings.sound ? 'bg-green-500/30 text-green-400' : 'bg-slate-700/50 text-gray-500'}`}
                    title="Ton bei wichtigen Ereignissen"
                  >
                    🔔 Ton
                  </button>
                  <button
                    onClick={() => setNotificationSettings((s: { sound: boolean; vibration: boolean; flash: boolean }) => ({ ...s, vibration: !s.vibration }))}
                    className={`px-2 py-1 text-xs rounded transition-colors ${notificationSettings.vibration ? 'bg-purple-500/30 text-purple-400' : 'bg-slate-700/50 text-gray-500'}`}
                    title="Vibration auf Mobilgeräten"
                  >
                    📳 Vibration
                  </button>
                </div>
              </div>
              
              {/* Wake Lock - Keep Screen On */}
              {wakeLock.isSupported && (
                <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
                  <span className="text-sm text-gray-400">📱 Display anlassen</span>
                  <button
                    onClick={() => wakeLock.toggle()}
                    className={`px-3 py-1 text-xs rounded-full transition-all duration-200 ${
                      wakeLock.isActive 
                        ? 'bg-cyan-500/30 text-cyan-400 ring-1 ring-cyan-500/50' 
                        : 'bg-slate-700/50 text-gray-500 hover:bg-slate-700'
                    }`}
                    title="Verhindert, dass das Display bei Inaktivität ausgeht (iOS/Android)"
                  >
                    {wakeLock.isActive ? '☀️ AN' : '🌙 AUS'}
                  </button>
                </div>
              )}
            </div>
            
            {/* Live Activity Feed - Collapsible */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
              <div
                onClick={() => setActivityPanelExpanded(!activityPanelExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/30 transition-colors rounded-t-lg cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold">🔴 Live Activity</span>
                  <span className="text-xs text-gray-500">({allEvents.length} events)</span>
                </div>
                <svg 
                  className={`w-5 h-5 text-gray-400 transition-transform ${activityPanelExpanded ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              
              {activityPanelExpanded && (
                <div className="border-t border-slate-700/50">
                  <AITraderActivityFeed 
                    events={allEvents} 
                    maxHeight="400px" 
                    autoScroll={true}
                    enableFlash={notificationSettings.flash}
                    enableSound={notificationSettings.sound}
                    enableVibration={notificationSettings.vibration}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {activeTab === 'reports' && traderId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Report with Navigation */}
          <div>
            {reports.length > 0 ? (
              <div>
                {/* Report Navigation */}
                <div className="flex items-center justify-between mb-4 bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <button
                    onClick={() => setSelectedReportIndex(Math.min(selectedReportIndex + 1, reports.length - 1))}
                    disabled={selectedReportIndex >= reports.length - 1}
                    className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Älter"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  
                  <div className="text-center">
                    <span className="text-sm text-gray-400">
                      Report {selectedReportIndex + 1} von {reports.length}
                    </span>
                  </div>
                  
                  <button
                    onClick={() => setSelectedReportIndex(Math.max(selectedReportIndex - 1, 0))}
                    disabled={selectedReportIndex <= 0}
                    className="p-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Neuer"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                
                <AITraderReportCard report={reports[selectedReportIndex]} />
              </div>
            ) : (
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-6 shadow text-center">
                <div className="text-4xl mb-2">📊</div>
                <p className="text-gray-400">
                  No reports available yet. Reports are generated daily after market close.
                </p>
              </div>
            )}
          </div>
          
          {/* Insights */}
          <div>
            <AITraderInsights traderId={traderId} />
          </div>
        </div>
      )}
      
      {activeTab === 'analytics' && traderId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Signal Accuracy */}
          <div>
            <SignalAccuracyChart traderId={traderId} days={30} />
          </div>
          
          {/* Adaptive Weights */}
          <div>
            <AdaptiveWeightsPanel trader={trader} />
          </div>
          
          {/* Training Status - Full View */}
          <div className="lg:col-span-2">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-6">
              <AITraderTrainingStatus traderId={traderId} compact={false} />
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
