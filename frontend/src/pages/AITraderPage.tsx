/**
 * AI Trader Dashboard Page
 * 
 * Full dashboard for monitoring and controlling AI traders.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AITraderActivityFeed } from '../components/AITraderActivityFeed';
import { AITraderSettingsModal } from '../components/AITraderSettingsModal';
import { AITraderTrainingStatus } from '../components/AITraderTrainingStatus';
import AITraderTrainingHistory from '../components/AITraderTrainingHistory';
import { TradeReasoningCard } from '../components/TradeReasoningCard';
import AITraderReportCard from '../components/AITraderReportCard';
import AITraderInsights from '../components/AITraderInsights';
import SignalAccuracyChart from '../components/SignalAccuracyChart';
import AdaptiveWeightsPanel from '../components/AdaptiveWeightsPanel';
import TradeAlertBar from '../components/TradeAlertBar';
import TradeDetailCard from '../components/TradeDetailCard';
import SelfTrainingIndicator from '../components/SelfTrainingIndicator';
import { TradeToastSystem, useTradeToasts } from '../components/TradeToastSystem';
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
    // Trade stats from closed positions
    tradesExecuted?: number;
    winningTrades?: number;
    losingTrades?: number;
    winRate?: number | null;
    realizedPnl?: number;
  } | null>(null);
  // Executed trades (opens + closes)
  const [executedTrades, setExecutedTrades] = useState<Array<{
    id: number;
    tradeType: 'open' | 'close';
    symbol: string;
    side: string;
    action: string;
    quantity: number;
    price: number;
    cost: number;
    timestamp: string;
    pnl: number | null;
    pnlPercent: number | null;
    holdingHours?: number;
    holdingDays?: number;
    closeReason?: string | null;
    wasWinner?: boolean;
    entryPrice?: number;
    stopLoss: number | null;
    takeProfit: number | null;
    isOpen: boolean;
    positionId: number;
    // Decision reasoning
    summary?: string | null;
    confidence?: number | null;
    weightedScore?: number | null;
    mlScore?: number | null;
    rlScore?: number | null;
    sentimentScore?: number | null;
    technicalScore?: number | null;
    signalAgreement?: string | null;
    explanation?: string[] | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'activity' | 'reports' | 'analytics'>('activity');
  const [selectedReportIndex, setSelectedReportIndex] = useState(0);
  const lastRefreshRef = useRef<number>(0);
  const [activityPanelExpanded, setActivityPanelExpanded] = useState(false);
  const [expandedTradeId, setExpandedTradeId] = useState<number | null>(null);
  
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
  
  // Notification feedback hook (for non-trade notifications)
  const { notifyDecision } = useNotificationFeedback({ settings: notificationSettings });
  
  // Trade toast notifications
  const { toasts: tradeToasts, addToast: addTradeToast, dismissToast: dismissTradeToast } = useTradeToasts();
  
  // Navigate to stock dashboard for a symbol
  const navigateToSymbol = useCallback((symbol: string) => {
    window.dispatchEvent(new CustomEvent('selectSymbol', { detail: symbol }));
    navigate('/dashboard');
  }, [navigate]);
  
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
        // NOTE: Toasts are now triggered by SSE trade_executed events (see handleSSEEvent)
        // to avoid race condition where decision is seen with executed=false first
        
        if (d.decisionType !== 'skip' && !d.executed) {
          // Non-trade notifications (hold etc.) - no sound, only visual
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
          // Trade stats from closed positions
          tradesExecuted: portfolioData.trades_executed || 0,
          winningTrades: portfolioData.winning_trades || 0,
          losingTrades: portfolioData.losing_trades || 0,
          winRate: portfolioData.win_rate,
          realizedPnl: portfolioData.realized_pnl || 0,
        });
      }
      
      // Fetch executed trades (closed positions)
      const tradesRes = await fetch(`/api/ai-traders/${traderId}/trades?limit=50&_t=${Date.now()}`, { cache: 'no-store' });
      if (tradesRes.ok) {
        const tradesData = await tradesRes.json();
        setExecutedTrades(Array.isArray(tradesData) ? tradesData : []);
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
  
  // Handle SSE events - trigger refresh on important events AND create toasts
  const handleSSEEvent = useCallback((event: AITraderEvent) => {
    // Create toast directly from SSE trade_executed event (avoids polling race condition)
    if (event.type === 'trade_executed' && event.data) {
      const d = event.data as {
        symbol?: string;
        action?: string;
        quantity?: number;
        price?: number;
        pnl?: string | number;
        proceeds?: number;
        cost?: number;
      };
      const action = d.action as 'buy' | 'sell' | 'short' | 'close';
      if (['buy', 'sell', 'short', 'close'].includes(action)) {
        addTradeToast({
          action,
          symbol: d.symbol || '???',
          quantity: d.quantity || 0,
          price: d.price || 0,
          confidence: null,
          pnl: d.pnl ? parseFloat(String(d.pnl)) : null,
          pnlPercent: null,
          reasoning: undefined,
          timestamp: event.timestamp || new Date().toISOString(),
        });
      }
    }
    
    // On decision_made, trade_executed, or status_changed, refresh data immediately
    if (['decision_made', 'trade_executed', 'status_changed', 'position_closed'].includes(event.type)) {
      // Debounce: only refresh if last refresh was more than 2 seconds ago
      if (Date.now() - lastRefreshRef.current > 2000) {
        loadTraderData(false);
      }
    }
  }, [loadTraderData, addTradeToast]);
  
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
      {/* Trade Alert Bar - sticky at top */}
      <TradeAlertBar 
        trade={currentTradeAlert} 
        onDismiss={() => setCurrentTradeAlert(null)}
        autoDismissMs={30000}
      />
      
      {/* Trade Toast Notifications - stacking bottom-right */}
      <TradeToastSystem
        toasts={tradeToasts}
        onDismiss={dismissTradeToast}
        soundEnabled={notificationSettings.sound}
      />
      
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-3 space-y-2">
      {/* Compact Header: Back + Name + Status + Controls + Market + Live */}
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 px-3 py-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Left: Back + Trader Info + Status */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => navigate('/ai-traders')}
              className="p-1 hover:bg-slate-700/50 rounded transition-colors flex-shrink-0"
              title="Zurück"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-xl flex-shrink-0">{trader.avatar}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold truncate">{trader.name}</h1>
                {/* Status Badge */}
                {(() => {
                  const statusStyles: Record<string, { bg: string; text: string; icon: string }> = {
                    running: { bg: 'bg-green-500/20', text: 'text-green-400', icon: '▶️' },
                    paused: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '⏸️' },
                    stopped: { bg: 'bg-slate-500/20', text: 'text-slate-400', icon: '⏹️' },
                    error: { bg: 'bg-red-500/20', text: 'text-red-400', icon: '❌' },
                  };
                  const s = statusStyles[trader.status] || statusStyles.stopped;
                  return (
                    <span className={`px-1.5 py-0.5 rounded-full ${s.bg} ${s.text} text-[10px] font-medium uppercase flex items-center gap-1`}>
                      <span>{s.icon}</span> {trader.status}
                    </span>
                  );
                })()}
              </div>
              {trader.statusMessage && (
                <p className="text-[10px] text-gray-500 truncate">{trader.statusMessage}</p>
              )}
            </div>
          </div>
          
          {/* Right: Controls + Market + Settings + Live */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Compact Training Status */}
            <div className="hidden sm:block">
              <AITraderTrainingStatus traderId={trader.id} compact={true} />
            </div>
            
            {/* Control Buttons */}
            <button onClick={handleStart} disabled={trader.status === 'running'}
              className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-gray-500 rounded text-xs transition-colors">▶️</button>
            <button onClick={handlePause} disabled={trader.status !== 'running'}
              className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-700 disabled:text-gray-500 rounded text-xs transition-colors">⏸️</button>
            <button onClick={handleStop} disabled={trader.status === 'stopped'}
              className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-gray-500 rounded text-xs transition-colors">⏹️</button>
            
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            
            {/* Settings */}
            <button onClick={() => setShowSettings(true)}
              className="p-1 rounded hover:bg-slate-700/50 transition-colors" title="Einstellungen">⚙️</button>
            
            {/* Market Status */}
            {(() => {
              const schedule = trader.personality?.schedule;
              const tradingStart = schedule?.tradingStart || '15:30';
              const tradingEnd = schedule?.tradingEnd || '22:00';
              const isOpen = trader.tradingTime;
              return (
                <div className={`px-2 py-0.5 rounded flex items-center gap-1.5 text-xs font-medium ${
                  isOpen ? 'bg-green-500/20 border border-green-500/40' : 'bg-amber-500/20 border border-amber-500/40'
                }`}
                  title={`${tradingStart} - ${tradingEnd} (${schedule?.timezone || 'Europe/Berlin'})`}
                >
                  <span className="text-sm">{isOpen ? '🟢' : '🟡'}</span>
                  <span className="hidden sm:inline">{isOpen ? 'Markt offen' : `${tradingStart}-${tradingEnd}`}</span>
                </div>
              );
            })()}
            
            {/* Connection */}
            <button onClick={reconnect}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                connected ? 'hover:bg-slate-700/50' : 'bg-red-500/20'
              }`}
              title={connected ? `${mode === 'sse' ? 'SSE' : 'Polling'}` : 'Reconnect'}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${connected ? mode === 'sse' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500' : 'bg-red-500'}`} />
              <span className="text-[10px] text-gray-400">{connected ? mode === 'sse' ? 'Live' : 'Poll' : '…'}</span>
            </button>
          </div>
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
      
      {/* Compact Stats Row */}
      <div className="grid grid-cols-6 gap-1.5">
        {portfolio && (
          <>
            <div className="bg-slate-800/50 rounded border border-slate-700/50 px-2 py-1.5">
              <div className="text-[10px] text-gray-500">💰 Cash</div>
              <div className="text-sm font-bold">${portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div className="bg-slate-800/50 rounded border border-slate-700/50 px-2 py-1.5">
              <div className="text-[10px] text-gray-500">📊 Wert</div>
              <div className="text-sm font-bold">${portfolio.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div className="bg-slate-800/50 rounded border border-slate-700/50 px-2 py-1.5">
              <div className="text-[10px] text-gray-500">📈 Unreal.</div>
              <div className={`text-sm font-bold ${(portfolio.unrealizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(portfolio.unrealizedPnl || 0) >= 0 ? '+' : ''}${(portfolio.unrealizedPnl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          </>
        )}
        <div className="bg-slate-800/50 rounded border border-slate-700/50 px-2 py-1.5">
          <div className="text-[10px] text-gray-500">🎯 Trades</div>
          <div className="text-sm font-bold">{portfolio?.tradesExecuted ?? 0}</div>
        </div>
        <div className="bg-slate-800/50 rounded border border-slate-700/50 px-2 py-1.5">
          <div className="text-[10px] text-gray-500">🏆 Win</div>
          <div className="text-sm font-bold">{portfolio?.winRate != null ? `${portfolio.winRate.toFixed(0)}%` : '-'}</div>
        </div>
        <div className="bg-slate-800/50 rounded border border-slate-700/50 px-2 py-1.5">
          <div className="text-[10px] text-gray-500">💹 P&L</div>
          <div className={`text-sm font-bold ${(portfolio?.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(portfolio?.pnl ?? 0) >= 0 ? '+' : ''}{(portfolio?.pnl ?? 0).toFixed(1)}%
          </div>
        </div>
      </div>
      
      {/* Tab Navigation - compact */}
      <div className="bg-slate-800/50 rounded border border-slate-700/50 p-0.5 flex gap-0.5">
        <button
          onClick={() => setActiveTab('activity')}
          className={`flex-1 px-3 py-1.5 rounded text-sm transition-colors ${
            activeTab === 'activity' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-slate-700/50'
          }`}
        >
          🔴 Live Activity
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex-1 px-3 py-1.5 rounded text-sm transition-colors ${
            activeTab === 'reports' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-slate-700/50'
          }`}
        >
          📊 Reports
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 px-3 py-1.5 rounded text-sm transition-colors ${
            activeTab === 'analytics' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-slate-700/50'
          }`}
        >
          📈 Analytics
        </button>
      </div>
      
      {/* Tab Content */}
      {activeTab === 'activity' && (
        <>
        {/* Self-Training Indicator */}
        {traderId && <SelfTrainingIndicator traderId={traderId} />}
        
        {/* Desktop: Trades left, Positions right | Mobile: stacked */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Left: Executed Trades */}
          <div>
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-blue-500/50 border-l-4 border-l-blue-500">
              <div className="px-3 py-2 border-b border-slate-700/50 flex items-center justify-between">
                <h3 className="font-bold text-sm text-blue-300">
                  ⚡ Trades ({executedTrades.length})
                  <span className="text-[10px] text-gray-500 ml-1 font-normal">geschlossen</span>
                </h3>
              </div>
              <div className="p-1.5 space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto">
                {executedTrades.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">
                    <div className="text-lg mb-1">📊</div>
                    <div className="text-xs">Keine Trades</div>
                  </div>
                ) : (
                  executedTrades.map((trade) => {
                    const isBuy = trade.tradeType === 'open';
                    const actionLabel = trade.action === 'short' ? 'Short' : trade.action === 'buy' ? 'Kauf' : 'Verkauf';
                    const actionColor = isBuy
                      ? (trade.action === 'short' ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400')
                      : 'bg-red-500/20 text-red-400';
                    const borderColor = isBuy
                      ? 'border-l-blue-500'
                      : (trade.wasWinner ? 'border-l-green-500' : 'border-l-red-500');
                    const isExpanded = expandedTradeId === trade.id;
                    
                    return (
                    <div 
                      key={trade.id}
                      className={`bg-slate-900/50 rounded border-l-2 ${borderColor} transition-all`}
                    >
                      {/* Compact header - always visible, click to expand */}
                      <div
                        className="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-800/50 transition-colors"
                        onClick={() => setExpandedTradeId(isExpanded ? null : trade.id)}
                      >
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigateToSymbol(trade.symbol); }}
                            className="font-bold text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                            title={`${trade.symbol} im Dashboard anzeigen`}
                          >
                            {trade.symbol}
                          </button>
                          <span className={`text-[10px] px-1 py-0.5 rounded ${actionColor}`}>
                            {isBuy ? '📥' : '📤'} {actionLabel}
                          </span>
                          <svg className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                        {!isBuy && trade.pnlPercent != null ? (
                          <div className={`text-sm font-bold ${(trade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {(trade.pnl ?? 0) >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                          </div>
                        ) : (
                          <div className="text-[10px] text-gray-500">${trade.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        )}
                      </div>
                      
                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-2 pb-2 pt-0 space-y-1.5 border-t border-slate-700/30">
                          {/* Price & Quantity */}
                          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                            <div className="bg-slate-800/50 rounded px-2 py-1">
                              <div className="text-[10px] text-gray-500">Preis</div>
                              <div className="text-xs font-mono">${trade.price.toFixed(2)}</div>
                            </div>
                            <div className="bg-slate-800/50 rounded px-2 py-1">
                              <div className="text-[10px] text-gray-500">Stück</div>
                              <div className="text-xs font-mono">{trade.quantity}</div>
                            </div>
                            <div className="bg-slate-800/50 rounded px-2 py-1">
                              <div className="text-[10px] text-gray-500">Wert</div>
                              <div className="text-xs font-mono">${trade.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                            </div>
                            <div className="bg-slate-800/50 rounded px-2 py-1">
                              <div className="text-[10px] text-gray-500">Seite</div>
                              <div className="text-xs font-mono">{trade.side === 'short' ? '🔴 Short' : '🟢 Long'}</div>
                            </div>
                          </div>
                          
                          {/* Entry price for close trades */}
                          {!isBuy && trade.entryPrice && (
                            <div className="grid grid-cols-2 gap-1.5">
                              <div className="bg-slate-800/50 rounded px-2 py-1">
                                <div className="text-[10px] text-gray-500">Einstieg</div>
                                <div className="text-xs font-mono">${trade.entryPrice.toFixed(2)}</div>
                              </div>
                              <div className="bg-slate-800/50 rounded px-2 py-1">
                                <div className="text-[10px] text-gray-500">P&L</div>
                                <div className={`text-xs font-mono font-bold ${(trade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {(trade.pnl ?? 0) >= 0 ? '+' : ''}${(trade.pnl ?? 0).toFixed(2)}
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* SL/TP */}
                          {(trade.stopLoss || trade.takeProfit) && (
                            <div className="grid grid-cols-2 gap-1.5">
                              {trade.stopLoss && (
                                <div className="bg-red-900/20 rounded px-2 py-1">
                                  <div className="text-[10px] text-red-400/60">Stop Loss</div>
                                  <div className="text-xs font-mono text-red-400">${trade.stopLoss.toFixed(2)}</div>
                                </div>
                              )}
                              {trade.takeProfit && (
                                <div className="bg-green-900/20 rounded px-2 py-1">
                                  <div className="text-[10px] text-green-400/60">Take Profit</div>
                                  <div className="text-xs font-mono text-green-400">${trade.takeProfit.toFixed(2)}</div>
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Holding time */}
                          {(trade.holdingDays || trade.holdingHours) && (
                            <div className="bg-slate-800/50 rounded px-2 py-1">
                              <div className="text-[10px] text-gray-500">Haltezeit</div>
                              <div className="text-xs font-mono">
                                {trade.holdingDays ? `${trade.holdingDays} Tage` : ''}
                                {trade.holdingDays && trade.holdingHours ? ', ' : ''}
                                {trade.holdingHours ? `${trade.holdingHours}h` : ''}
                              </div>
                            </div>
                          )}
                          
                          {/* Close reason */}
                          {!isBuy && trade.closeReason && (
                            <div className="bg-slate-800/50 rounded px-2 py-1">
                              <div className="text-[10px] text-gray-500">Grund</div>
                              <div className="text-xs text-gray-300">{trade.closeReason}</div>
                            </div>
                          )}
                          
                          {/* AI Decision Explanation */}
                          {(trade.explanation || trade.summary) && (
                            <div className="bg-blue-900/20 border border-blue-500/20 rounded px-2 py-1.5 space-y-1">
                              <div className="text-[10px] text-blue-400/80 font-medium">🧠 Warum diese Entscheidung?</div>
                              {trade.explanation ? (
                                <ul className="space-y-0.5">
                                  {trade.explanation.map((line, i) => (
                                    <li key={i} className="text-xs text-gray-300 flex items-start gap-1">
                                      <span className="text-blue-400/60 mt-0.5">•</span>
                                      <span>{line}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : trade.summary ? (
                                <div className="text-xs text-gray-300">{trade.summary}</div>
                              ) : null}
                            </div>
                          )}
                          
                          {/* Signal Scores */}
                          {(trade.mlScore != null || trade.rlScore != null || trade.sentimentScore != null || trade.technicalScore != null) && (
                            <div className="grid grid-cols-4 gap-1">
                              {[
                                { label: 'ML', value: trade.mlScore, color: 'blue' },
                                { label: 'RL', value: trade.rlScore, color: 'purple' },
                                { label: 'Sent.', value: trade.sentimentScore, color: 'cyan' },
                                { label: 'Tech.', value: trade.technicalScore, color: 'amber' },
                              ].map(({ label, value, color }) => (
                                value != null && (
                                  <div key={label} className="bg-slate-800/50 rounded px-1.5 py-1 text-center">
                                    <div className={`text-[9px] text-${color}-400/60`}>{label}</div>
                                    <div className={`text-xs font-mono font-bold ${value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                      {(value * 100).toFixed(0)}%
                                    </div>
                                  </div>
                                )
                              ))}
                            </div>
                          )}
                          
                          {/* Confidence + Agreement */}
                          {(trade.confidence != null || trade.signalAgreement) && (
                            <div className="flex items-center gap-2 text-[10px]">
                              {trade.confidence != null && (
                                <span className={`font-mono ${trade.confidence >= 0.7 ? 'text-green-400' : trade.confidence >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  Konfidenz: {(trade.confidence * 100).toFixed(0)}%
                                </span>
                              )}
                              {trade.signalAgreement && (
                                <span className={`px-1 py-0.5 rounded ${
                                  trade.signalAgreement === 'strong' ? 'bg-green-500/20 text-green-400' :
                                  trade.signalAgreement === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                                  'bg-red-500/20 text-red-400'
                                }`}>
                                  {trade.signalAgreement === 'strong' ? 'Starke' : trade.signalAgreement === 'moderate' ? 'Moderate' : 'Schwache'} Übereinstimmung
                                </span>
                              )}
                            </div>
                          )}
                          
                          {/* Timestamp */}
                          <div className="text-[10px] text-gray-600 text-right">
                            {new Date(trade.timestamp).toLocaleString('de-DE', { 
                              day: '2-digit', month: '2-digit', year: '2-digit',
                              hour: '2-digit', minute: '2-digit', second: '2-digit'
                            })}
                          </div>
                        </div>
                      )}
                      
                      {/* Collapsed: minimal info line */}
                      {!isExpanded && (
                        <div className="flex items-center justify-between text-[10px] text-gray-500 px-2 pb-1.5 -mt-0.5">
                          <span>{trade.quantity}x @ ${trade.price.toFixed(2)}</span>
                          <span>
                            {new Date(trade.timestamp).toLocaleString('de-DE', { 
                              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          
          {/* Right: Open Positions */}
          <div>
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
              <div className="px-3 py-2 border-b border-slate-700/50">
                <h3 className="font-bold text-sm">📍 Positionen ({positions.length})</h3>
              </div>
              <div className="p-2 max-h-[calc(100vh-280px)] overflow-y-auto">
                {positions.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">
                    <div className="text-lg mb-1">📭</div>
                    <div className="text-xs">Keine Positionen</div>
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
                            <button
                              onClick={() => navigateToSymbol(position.symbol)}
                              className="font-bold text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                              title={`${position.symbol} im Dashboard anzeigen`}
                            >
                              {position.symbol}
                            </button>
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
          </div>
        </div>
        
        {/* Bottom row: Decisions + Notifications + Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
          {/* Recent Decisions */}
          <div className="lg:col-span-2 bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
            <div className="px-3 py-2 border-b border-slate-700/50">
              <h3 className="font-bold text-sm">🧠 Entscheidungen</h3>
            </div>
            <div className="p-2 space-y-1 max-h-[350px] overflow-y-auto">
              {decisions.length === 0 ? (
                <div className="text-center text-gray-500 py-6">
                  <div className="text-xl mb-1">🤔</div>
                  <div className="text-sm">Keine Entscheidungen</div>
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
          
          {/* Right: Notifications + Activity Feed */}
          <div className="space-y-3">
            {/* Notification Settings - compact */}
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 px-3 py-2">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-xs font-medium text-gray-400">🔔</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setNotificationSettings((s: { sound: boolean; vibration: boolean; flash: boolean }) => ({ ...s, flash: !s.flash }))}
                    className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${notificationSettings.flash ? 'bg-yellow-500/30 text-yellow-400' : 'bg-slate-700/50 text-gray-500'}`}
                  >✨ Flash</button>
                  <button
                    onClick={() => setNotificationSettings((s: { sound: boolean; vibration: boolean; flash: boolean }) => ({ ...s, sound: !s.sound }))}
                    className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${notificationSettings.sound ? 'bg-green-500/30 text-green-400' : 'bg-slate-700/50 text-gray-500'}`}
                  >🔔 Ton</button>
                  <button
                    onClick={() => setNotificationSettings((s: { sound: boolean; vibration: boolean; flash: boolean }) => ({ ...s, vibration: !s.vibration }))}
                    className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${notificationSettings.vibration ? 'bg-purple-500/30 text-purple-400' : 'bg-slate-700/50 text-gray-500'}`}
                  >📳 Vibr.</button>
                </div>
              </div>
              {wakeLock.isSupported && (
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-700/50">
                  <span className="text-[10px] text-gray-500">📱 Display an</span>
                  <button onClick={() => wakeLock.toggle()}
                    className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                      wakeLock.isActive ? 'bg-cyan-500/30 text-cyan-400' : 'bg-slate-700/50 text-gray-500'
                    }`}
                  >{wakeLock.isActive ? '☀️ AN' : '🌙 AUS'}</button>
                </div>
              )}
            </div>
            
            {/* Activity Feed */}
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50">
              <div onClick={() => setActivityPanelExpanded(!activityPanelExpanded)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-slate-700/30 transition-colors rounded-t-lg cursor-pointer">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">🔴 Activity</span>
                  <span className="text-[10px] text-gray-500">({allEvents.length})</span>
                </div>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${activityPanelExpanded ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {activityPanelExpanded && (
                <div className="border-t border-slate-700/50">
                  <AITraderActivityFeed 
                    events={allEvents} maxHeight="300px" autoScroll={true}
                    enableFlash={notificationSettings.flash}
                    enableSound={notificationSettings.sound}
                    enableVibration={notificationSettings.vibration}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        </>
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
          
          {/* Training History - Persistent Records */}
          <div className="lg:col-span-2">
            <AITraderTrainingHistory traderId={traderId} />
          </div>
        </div>
      )}
    </div>
    </>
  );
}
