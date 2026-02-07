/**
 * AI Trader Dashboard Page
 * 
 * Full dashboard for monitoring and controlling AI traders.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AITraderActivityFeed } from '../components/AITraderActivityFeed';
import { AITraderConfigModal } from '../components/AITraderConfigModal';
import { AITraderTrainingStatus } from '../components/AITraderTrainingStatus';
import AITraderTrainingHistory from '../components/AITraderTrainingHistory';
import { TradeReasoningCard } from '../components/TradeReasoningCard';
import AITraderReportCard from '../components/AITraderReportCard';
import AITraderInsights from '../components/AITraderInsights';
import SignalAccuracyChart from '../components/SignalAccuracyChart';
import AdaptiveWeightsPanel from '../components/AdaptiveWeightsPanel';
import TradeAlertBar from '../components/TradeAlertBar';
// TradeDetailCard removed (unused)
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
  // importantDecisions removed (was set but never read)
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
    // Broker fees
    totalFees?: number;
    brokerName?: string;
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
    fees?: number | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'activity' | 'reports' | 'analytics'>('activity');
  const [selectedReportIndex, setSelectedReportIndex] = useState(0);
  const lastRefreshRef = useRef<number>(0);
  const [activityPanelExpanded, setActivityPanelExpanded] = useState(false);
  const [expandedTradeId, setExpandedTradeId] = useState<number | null>(null);
  const [expandedPositionId, setExpandedPositionId] = useState<number | null>(null);
  
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
  const prevExecutedIdsRef = useRef<Set<number>>(new Set());
  const [newDecisionIds, setNewDecisionIds] = useState<Set<number>>(new Set());
  
  // Notification feedback hook (for non-trade notifications)
  // Notification feedback hook (kept for future use)
  useNotificationFeedback({ settings: notificationSettings });
  
  // Trade toast notifications
  const { toasts: tradeToasts, addToast: addTradeToast, dismissToast: dismissTradeToast } = useTradeToasts();
  
  // Deduplicate toasts: track which symbol+action+timestamp combos we already toasted
  const processedToastKeysRef = useRef<Set<string>>(new Set());
  
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
    const currentExecutedIds = new Set(decisions.filter(d => d.executed).map(d => d.id));
    const newIds = new Set<number>();
    
    // Helper: try to create toast for an executed trade decision (with dedup)
    const tryCreateToast = (d: typeof decisions[0]) => {
      if (!d.executed || !['buy', 'sell', 'short', 'close'].includes(d.decisionType)) return;
      const toastKey = `${d.symbol}-${d.decisionType}-${d.timestamp}`;
      if (processedToastKeysRef.current.has(toastKey)) return; // Already toasted (maybe via SSE)
      processedToastKeysRef.current.add(toastKey);
      
      const reasoning = typeof d.reasoning === 'object' ? d.reasoning : {};
      const rObj = reasoning as { quantity?: number; price?: number };
      addTradeToast({
        action: d.decisionType as 'buy' | 'sell' | 'short' | 'close',
        symbol: d.symbol,
        quantity: rObj.quantity || 0,
        price: rObj.price || 0,
        confidence: d.confidence,
        pnl: (reasoning as { pnl?: number }).pnl ?? null,
        pnlPercent: (reasoning as { pnl_percent?: number }).pnl_percent ?? null,
        reasoning: d.summaryShort || undefined,
        timestamp: d.timestamp,
      });
    };
    
    // Find truly new decisions (not seen before)
    decisions.forEach(d => {
      if (!prevDecisionIdsRef.current.has(d.id)) {
        // Brand new decision
        newIds.add(d.id);
        tryCreateToast(d);
        
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
      } else if (d.executed && !prevExecutedIdsRef.current.has(d.id)) {
        // Known decision that just became executed (race condition fix: 
        // first poll saw executed=false, now it's true)
        tryCreateToast(d);
      }
    });
    
    // Update refs and state
    if (newIds.size > 0) {
      setNewDecisionIds(newIds);
      setTimeout(() => setNewDecisionIds(new Set()), 2000);
    }
    
    prevDecisionIdsRef.current = currentIds;
    prevExecutedIdsRef.current = currentExecutedIds;
  }, [decisions, addTradeToast]);
  
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
          // Broker fees
          totalFees: portfolioData.total_fees || 0,
          brokerName: portfolioData.broker_name || null,
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
    // Create toast directly from SSE trade_executed event (with dedup)
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
        const ts = event.data?.timestamp || event.timestamp || new Date().toISOString();
        const toastKey = `${d.symbol}-${action}-${ts}`;
        if (!processedToastKeysRef.current.has(toastKey)) {
          processedToastKeysRef.current.add(toastKey);
          addTradeToast({
            action,
            symbol: d.symbol || '???',
            quantity: d.quantity || 0,
            price: d.price || 0,
            confidence: null,
            pnl: d.pnl ? parseFloat(String(d.pnl)) : null,
            pnlPercent: null,
            reasoning: undefined,
            timestamp: ts,
          });
        }
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
      
      <div className="max-w-[1600px] mx-auto px-2 sm:px-4 py-2 sm:py-3 space-y-2">
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
            {/* Compact Overall Status */}
            {(() => {
              const closedTrades = trader.winningTrades + trader.losingTrades;
              const winRate = closedTrades > 0 ? (trader.winningTrades / closedTrades) * 100 : null;
              // Use portfolio-level P&L (correct overall return), not sum of per-trade %
              const pnl = portfolio?.pnl ?? 0;
              const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';
              const pnlBg = pnl >= 0 ? 'bg-green-500/15' : 'bg-red-500/15';
              return (
                <div className={`hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-lg ${pnlBg} border ${pnl >= 0 ? 'border-green-500/30' : 'border-red-500/30'}`}>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${pnlColor}`}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%
                    </div>
                    <div className="text-[9px] text-gray-400">Gesamt P&L</div>
                  </div>
                  <div className="w-px h-6 bg-slate-600" />
                  <div className="text-right">
                    <div className={`text-sm font-bold ${winRate != null ? (winRate >= 50 ? 'text-green-400' : 'text-red-400') : 'text-gray-400'}`}>
                      {winRate != null ? `${winRate.toFixed(0)}%` : '-'}
                    </div>
                    <div className="text-[9px] text-gray-400">Win ({trader.winningTrades}W/{trader.losingTrades}L)</div>
                  </div>
                  {trader.currentStreak !== 0 && (
                    <>
                      <div className="w-px h-6 bg-slate-600" />
                      <div className="text-right">
                        <div className={`text-sm font-bold ${trader.currentStreak > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {trader.currentStreak > 0 ? '🔥' : '❄️'} {trader.currentStreak > 0 ? '+' : ''}{trader.currentStreak}
                        </div>
                        <div className="text-[9px] text-gray-400">Streak</div>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
            
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
                  <span>{isOpen ? 'Markt offen' : `Markt geschlossen (${tradingStart}–${tradingEnd})`}</span>
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
      
      {/* Settings Modal (unified config modal) */}
      {trader && (
        <AITraderConfigModal
          trader={trader}
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          onSaved={(updated) => setTrader(updated)}
        />
      )}
      
      {/* Compact Stats Row */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-1.5">
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
          <div className="bg-slate-800/50 rounded border border-orange-500/30 px-2 py-1.5">
            <div className="text-[10px] text-orange-400/70">🏦 Gebühren</div>
            <div className="text-sm font-bold text-orange-400">
              ${(portfolio?.totalFees ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            {portfolio?.brokerName && (
              <div className="text-[8px] text-gray-500 truncate">{portfolio.brokerName}</div>
            )}
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
        {traderId && <SelfTrainingIndicator traderId={traderId} onTrainingEvent={(evt) => {
          addTradeToast({
            action: evt.action,
            symbol: evt.agentName || 'TRAINING',
            quantity: 0,
            price: 0,
            confidence: null,
            reasoning: evt.message,
            timestamp: new Date().toISOString(),
          });
        }} />}
        
        {/* Desktop: 3 columns (Trades, Positions, Decisions) | Mobile: stacked */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Col 1: Executed Trades (5/12 on desktop) */}
          <div className="lg:col-span-5">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-blue-500/50 border-l-4 border-l-blue-500">
              <div className="px-3 py-2 border-b border-slate-700/50 flex items-center justify-between">
                <h3 className="font-bold text-sm text-blue-300">
                  ⚡ Trades ({executedTrades.length})
                  <span className="text-[10px] text-gray-500 ml-1 font-normal">geschlossen</span>
                </h3>
              </div>
              <div className="p-1.5 space-y-1.5 max-h-[400px] lg:max-h-[600px] overflow-y-auto">
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
                      ? (trade.action === 'short' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30')
                      : 'bg-red-500/20 text-red-400 border border-red-500/30';
                    const borderColor = isBuy
                      ? (trade.action === 'short' ? 'border-l-orange-500' : 'border-l-green-500')
                      : (trade.wasWinner ? 'border-l-green-500' : 'border-l-red-500');
                    const isExpanded = expandedTradeId === trade.id;
                    
                    // Time-based coloring
                    const tradeAge = Date.now() - new Date(trade.timestamp).getTime();
                    const hoursOld = tradeAge / 3600000;
                    const freshness = Math.max(0.4, 1.0 - (hoursOld / 48) * 0.6);
                    const isVeryRecent = hoursOld < 1;
                    const isRecent = hoursOld < 6;
                    const freshnessStyle = { opacity: freshness };
                    const recentGlow = isVeryRecent 
                      ? 'ring-1 ring-blue-400/40 shadow-lg shadow-blue-500/10' 
                      : isRecent ? 'ring-1 ring-slate-500/30' : '';
                    
                    // Calculate SL/TP distances for risk/reward
                    const refPrice = isBuy ? trade.price : (trade.entryPrice || trade.price);
                    const slDistPct = trade.stopLoss != null && refPrice > 0
                      ? ((trade.stopLoss - refPrice) / refPrice * 100) : null;
                    const tpDistPct = trade.takeProfit != null && refPrice > 0
                      ? ((trade.takeProfit - refPrice) / refPrice * 100) : null;
                    const rrRatio = (slDistPct != null && tpDistPct != null && Math.abs(slDistPct) > 0)
                      ? Math.abs(tpDistPct / slDistPct) : null;
                    
                    return (
                    <div 
                      key={trade.id}
                      style={freshnessStyle}
                      className={`bg-slate-900/50 rounded-lg border-l-[3px] ${borderColor} ${recentGlow} transition-all`}
                    >
                      {/* Header: Symbol + Action + Time + P&L (for closes) */}
                      <div
                        className="flex items-center justify-between px-2.5 pt-2 pb-1 cursor-pointer hover:bg-slate-800/30 transition-colors"
                        onClick={() => setExpandedTradeId(isExpanded ? null : trade.id)}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigateToSymbol(trade.symbol); }}
                            className="font-bold text-base text-white hover:text-blue-300 hover:underline transition-colors"
                            title={`${trade.symbol} im Dashboard anzeigen`}
                          >
                            {trade.symbol}
                          </button>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${actionColor}`}>
                            {isBuy ? '📥' : '📤'} {actionLabel}
                          </span>
                          {isVeryRecent && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-300 text-[10px] font-semibold animate-pulse">NEU</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!isBuy && trade.pnlPercent != null && (
                            <span className={`text-sm font-bold ${(trade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {(trade.pnl ?? 0) >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                              <span className="text-[10px] font-normal ml-0.5">({(trade.pnl ?? 0) >= 0 ? '+' : ''}${(trade.pnl ?? 0).toFixed(0)})</span>
                            </span>
                          )}
                          <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      
                      {/* Trade Setup: Entry Price, Quantity, Cost */}
                      <div className="px-2.5 pb-1">
                        <div className="flex items-baseline gap-3">
                          <span className="text-lg font-bold font-mono text-white">${trade.price.toFixed(2)}</span>
                          <span className="text-xs text-gray-400">{trade.quantity}× = <span className="text-gray-300 font-medium">${trade.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
                          {trade.side === 'short' && <span className="text-[10px] text-orange-400 font-medium">SHORT</span>}
                        </div>
                      </div>
                      
                      {/* SL / TP Bar with % distances and R:R */}
                      {(trade.stopLoss != null || trade.takeProfit != null) && (
                        <div className="px-2.5 pb-1.5">
                          <div className="flex items-center gap-2 text-xs">
                            {trade.stopLoss != null && (
                              <div className="flex items-center gap-1">
                                <span className="text-red-500 font-medium">SL</span>
                                <span className="text-red-400 font-mono font-bold">${trade.stopLoss.toFixed(2)}</span>
                                {slDistPct != null && (
                                  <span className="text-red-400/70 text-[10px]">({slDistPct >= 0 ? '+' : ''}{slDistPct.toFixed(1)}%)</span>
                                )}
                              </div>
                            )}
                            <span className="text-gray-600">│</span>
                            {trade.takeProfit != null && (
                              <div className="flex items-center gap-1">
                                <span className="text-green-500 font-medium">TP</span>
                                <span className="text-green-400 font-mono font-bold">${trade.takeProfit.toFixed(2)}</span>
                                {tpDistPct != null && (
                                  <span className="text-green-400/70 text-[10px]">({tpDistPct >= 0 ? '+' : ''}{tpDistPct.toFixed(1)}%)</span>
                                )}
                              </div>
                            )}
                            {rrRatio != null && (
                              <>
                                <span className="text-gray-600">│</span>
                                <span className={`font-bold text-[11px] ${rrRatio >= 2 ? 'text-green-400' : rrRatio >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  R:R {rrRatio.toFixed(1)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Signal Scores Bar - always visible for buy trades */}
                      {isBuy && (trade.mlScore != null || trade.rlScore != null || trade.sentimentScore != null || trade.technicalScore != null) && (
                        <div className="px-2.5 pb-1.5">
                          <div className="flex items-center gap-1.5">
                            {[
                              { label: 'ML', value: trade.mlScore },
                              { label: 'RL', value: trade.rlScore },
                              { label: 'Sent', value: trade.sentimentScore },
                              { label: 'Tech', value: trade.technicalScore },
                            ].filter(s => s.value != null).map(({ label, value }) => {
                              const pct = (value! * 100);
                              const color = pct > 20 ? 'text-green-400 bg-green-500/15' : pct > 0 ? 'text-green-400/70 bg-green-500/10' : pct > -20 ? 'text-red-400/70 bg-red-500/10' : 'text-red-400 bg-red-500/15';
                              return (
                                <div key={label} className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${color}`}>
                                  <span className="text-[10px] opacity-70">{label}</span>
                                  <span className="text-[11px] font-mono font-bold">{pct > 0 ? '+' : ''}{pct.toFixed(0)}%</span>
                                </div>
                              );
                            })}
                            {trade.confidence != null && (
                              <div className={`ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                                trade.confidence >= 0.7 ? 'bg-green-500/15 text-green-400' : 
                                trade.confidence >= 0.5 ? 'bg-yellow-500/15 text-yellow-400' : 
                                'bg-red-500/15 text-red-400'
                              }`}>
                                <span className="text-[10px] opacity-70">Konf.</span>
                                <span className="text-[11px] font-mono font-bold">{(trade.confidence * 100).toFixed(0)}%</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* AI Reasoning Preview - always visible for buy trades (first reason) */}
                      {isBuy && trade.explanation && trade.explanation.length > 0 && (
                        <div className="px-2.5 pb-1.5">
                          <div className="text-[11px] text-gray-300 flex items-start gap-1">
                            <span className="text-blue-400/70 shrink-0">🧠</span>
                            <span className="line-clamp-2">{trade.explanation[0]}{trade.explanation.length > 1 ? ` (+${trade.explanation.length - 1})` : ''}</span>
                          </div>
                        </div>
                      )}
                      
                      {/* Footer: Timestamp + Confidence (for sells) + Agreement */}
                      <div className="flex items-center justify-between px-2.5 pb-1.5 text-[10px]">
                        <span className={isRecent ? 'text-gray-300' : 'text-gray-500'}>
                          {new Date(trade.timestamp).toLocaleString('de-DE', { 
                            day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' 
                          })}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {!isBuy && trade.holdingHours != null && (
                            <span className="text-gray-500">⏱{trade.holdingDays ? `${trade.holdingDays}d` : `${trade.holdingHours}h`}</span>
                          )}
                          {trade.signalAgreement && (
                            <span className={`px-1 py-0 rounded font-medium ${
                              trade.signalAgreement === 'strong' ? 'bg-green-500/15 text-green-400' :
                              trade.signalAgreement === 'moderate' ? 'bg-yellow-500/15 text-yellow-400' :
                              'bg-red-500/15 text-red-400'
                            }`}>
                              {trade.signalAgreement === 'strong' ? '✓✓✓ Einig' : trade.signalAgreement === 'moderate' ? '✓✓ Mehrheit' : '✓ Schwach'}
                            </span>
                          )}
                          {!isBuy && trade.confidence != null && (
                            <span className={`font-mono px-1 py-0 rounded ${
                              trade.confidence >= 0.7 ? 'bg-green-500/15 text-green-400' : 
                              trade.confidence >= 0.5 ? 'bg-yellow-500/15 text-yellow-400' : 
                              'bg-red-500/15 text-red-400'
                            }`}>
                              {(trade.confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Expanded: Details for copying / understanding */}
                      {isExpanded && (
                        <div className="px-2.5 pb-2.5 pt-0 space-y-1.5 border-t border-slate-700/30">
                          {/* Full AI Reasoning */}
                          {(trade.explanation || trade.summary) ? (
                            <div className="bg-blue-900/20 border border-blue-500/20 rounded px-2.5 py-2 space-y-1 mt-1.5">
                              <div className="text-[11px] text-blue-400/80 font-medium">🧠 {isBuy ? 'Kaufgrund' : 'Verkaufsgrund'}</div>
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
                          ) : (
                            <div className="bg-slate-800/30 border border-slate-700/30 rounded px-2.5 py-2 mt-1.5">
                              <div className="text-[11px] text-gray-500 italic">🧠 Kein Entscheidungsgrund verfügbar</div>
                            </div>
                          )}
                          
                          {/* Close reason for sells */}
                          {!isBuy && trade.closeReason && (
                            <div className="bg-slate-800/50 rounded px-2.5 py-1.5">
                              <div className="text-[10px] text-gray-500">Auslöser</div>
                              <div className="text-xs text-gray-300">{(() => {
                                const cr = trade.closeReason?.toLowerCase() || '';
                                if (cr.includes('stop_loss') || cr.startsWith('stop_loss')) return '🛑 Stop-Loss ausgelöst';
                                if (cr.includes('take_profit') || cr.startsWith('take_profit')) return '🎯 Take-Profit erreicht';
                                if (cr.includes('max_holding') || cr.includes('expired')) return '⏰ Haltezeit überschritten';
                                if (cr.includes('signal') || cr.includes('bearish') || cr.includes('reversal')) return '📉 Signalumkehr';
                                if (cr.includes('user') || cr.includes('manual')) return '👤 Manuell';
                                if (cr.includes('capital') || cr.includes('reset')) return '💰 Portfolio-Anpassung';
                                if (cr.includes('risk')) return '⚠️ Risiko-Management';
                                return trade.closeReason;
                              })()}</div>
                            </div>
                          )}
                          
                          {/* Entry→Exit for close trades */}
                          {!isBuy && trade.entryPrice && (
                            <div className="flex items-center gap-2 bg-slate-800/50 rounded px-2.5 py-1.5">
                              <div>
                                <div className="text-[10px] text-gray-500">Einstieg</div>
                                <div className="text-xs font-mono font-bold">${trade.entryPrice.toFixed(2)}</div>
                              </div>
                              <span className="text-gray-600">→</span>
                              <div>
                                <div className="text-[10px] text-gray-500">Ausstieg</div>
                                <div className="text-xs font-mono font-bold">${trade.price.toFixed(2)}</div>
                              </div>
                              <span className="text-gray-600 mx-1">│</span>
                              <div>
                                <div className="text-[10px] text-gray-500">P&L</div>
                                <div className={`text-xs font-mono font-bold ${(trade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {(trade.pnl ?? 0) >= 0 ? '+' : ''}${(trade.pnl ?? 0).toFixed(2)}
                                </div>
                              </div>
                              {trade.fees != null && trade.fees > 0 && (
                                <>
                                  <span className="text-gray-600 mx-1">│</span>
                                  <div>
                                    <div className="text-[10px] text-orange-400/60">Gebühr</div>
                                    <div className="text-xs font-mono text-orange-400">${trade.fees.toFixed(2)}</div>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                          
                          {/* Signal Scores for sell trades (not shown in always-visible for sells) */}
                          {!isBuy && (trade.mlScore != null || trade.rlScore != null || trade.sentimentScore != null || trade.technicalScore != null) && (
                            <div className="flex items-center gap-1.5">
                              {[
                                { label: 'ML', value: trade.mlScore },
                                { label: 'RL', value: trade.rlScore },
                                { label: 'Sent', value: trade.sentimentScore },
                                { label: 'Tech', value: trade.technicalScore },
                              ].filter(s => s.value != null).map(({ label, value }) => {
                                const pct = (value! * 100);
                                const color = pct > 20 ? 'text-green-400 bg-green-500/15' : pct > 0 ? 'text-green-400/70 bg-green-500/10' : pct > -20 ? 'text-red-400/70 bg-red-500/10' : 'text-red-400 bg-red-500/15';
                                return (
                                  <div key={label} className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${color}`}>
                                    <span className="text-[10px] opacity-70">{label}</span>
                                    <span className="text-[11px] font-mono font-bold">{pct > 0 ? '+' : ''}{pct.toFixed(0)}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          
                          {/* Buy trade costs/fees in expanded */}
                          {isBuy && trade.fees != null && trade.fees > 0 && (
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="text-gray-500">Gebühr:</span>
                              <span className="text-orange-400 font-mono">${trade.fees.toFixed(2)}</span>
                              <span className="text-gray-600">│</span>
                              <span className="text-gray-500">Seite:</span>
                              <span className="font-mono">{trade.side === 'short' ? '🔴 Short' : '🟢 Long'}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          
          {/* Col 2: Open Positions (4/12 on desktop) */}
          <div className="lg:col-span-4">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
              <div className="px-3 py-2 border-b border-slate-700/50">
                <h3 className="font-bold text-sm">📍 Positionen ({positions.length})</h3>
              </div>
              <div className="p-1.5 max-h-[400px] lg:max-h-[600px] overflow-y-auto">
                {positions.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">
                    <div className="text-lg mb-1">📭</div>
                    <div className="text-xs">Keine Positionen</div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {positions.map((position) => {
                      const pnlPercent = position.unrealizedPnlPercent || 0;
                      const pnl = position.unrealizedPnl || 0;
                      const hoursHeld = (position as any).hoursHeld || 0;
                      const daysHeld = (position as any).daysHeld || 0;
                      const distanceToSL = (position as any).distanceToStopLoss;
                      const distanceToTP = (position as any).distanceToTakeProfit;
                      const currentPrice = position.currentPrice || position.entryPrice;
                      const totalFeesPaid = (position as any).totalFeesPaid || 0;
                      const breakEvenPrice = (position as any).breakEvenPrice || null;
                      const holdLabel = daysHeld > 0 ? `${daysHeld}d` : `${hoursHeld}h`;
                      const dailyPnl = (position as any).dailyPnl;
                      const dailyPnlPercent = (position as any).dailyPnlPercent;
                      const marketState = (position as any).marketState || 'UNKNOWN';
                      const priceChange = (position as any).priceChange;
                      const priceChangePercent = (position as any).priceChangePercent;
                      const notionalValue = (position as any).notionalValue || (currentPrice * position.quantity);
                      const investedValue = (position as any).investedValue || (position.entryPrice * position.quantity);
                      const openFee = (position as any).openFee || 0;
                      const isExpanded = expandedPositionId === position.id;
                      const pnlColor = pnlPercent >= 0 ? 'text-green-400' : 'text-red-400';
                      
                      return (
                        <div 
                          key={position.id}
                          className={`bg-slate-900/50 rounded-lg overflow-hidden transition-colors ${isExpanded ? 'ring-1 ring-slate-600' : ''}`}
                        >
                          {/* Row 1: Symbol, Qty, Current Price, P&L */}
                          <div
                            className="px-2 pt-1.5 pb-0.5 flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-800/50 transition-colors"
                            onClick={() => setExpandedPositionId(isExpanded ? null : position.id)}
                          >
                            <button
                              onClick={(e) => { e.stopPropagation(); navigateToSymbol(position.symbol); }}
                              className="font-bold text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors flex-shrink-0"
                              title={`${position.symbol} im Dashboard anzeigen`}
                            >
                              {position.side === 'short' ? '🔴' : '🟢'} {position.symbol}
                            </button>
                            <span className="text-gray-500">{position.quantity}x</span>
                            <span className="text-gray-300">${currentPrice?.toFixed(2)}</span>
                            {priceChangePercent != null && (
                              <span className={`text-[10px] ${priceChangePercent >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                                {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(1)}%
                              </span>
                            )}
                            <div className="flex-1" />
                            <span className={`font-bold ${pnlColor}`}>
                              {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%
                            </span>
                            <span className={`text-[10px] ${pnl >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                              ${Math.abs(pnl).toFixed(0)}
                            </span>
                            <span className={`text-gray-600 text-[10px] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</span>
                          </div>
                          
                          {/* Row 2: Entry, SL/TP distance, Hold time */}
                          <div className="px-2 pb-1.5 flex items-center gap-2 text-[10px] text-gray-500 cursor-pointer" onClick={() => setExpandedPositionId(isExpanded ? null : position.id)}>
                            <span>Einstieg ${position.entryPrice?.toFixed(2)}</span>
                            {breakEvenPrice && (
                              <span className="text-yellow-400/50">BE ${breakEvenPrice.toFixed(2)}</span>
                            )}
                            {distanceToSL != null && (
                              <span className={distanceToSL < 3 ? 'text-red-300' : ''}>
                                SL {distanceToSL.toFixed(1)}%
                              </span>
                            )}
                            {distanceToTP != null && (
                              <span className={distanceToTP < 3 ? 'text-green-300' : ''}>
                                TP {distanceToTP.toFixed(1)}%
                              </span>
                            )}
                            <div className="flex-1" />
                            <span>{holdLabel}</span>
                            {marketState !== 'UNKNOWN' && (
                              <span className={marketState === 'REGULAR' ? 'text-green-500' : 'text-gray-600'}>
                                {marketState === 'REGULAR' ? '●' : '○'}
                              </span>
                            )}
                          </div>
                          
                          {/* Expanded Details */}
                          {isExpanded && (
                            <div className="px-2 pb-2 pt-1 border-t border-slate-700/50 space-y-1.5 text-[10px]">
                              {/* Price Details */}
                              <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                                <div>
                                  <span className="text-gray-500">Einstieg</span>
                                  <div className="text-gray-300">${position.entryPrice?.toFixed(2)}</div>
                                </div>
                                <div>
                                  <span className="text-gray-500">Aktuell</span>
                                  <div className="text-gray-300">${currentPrice?.toFixed(2)}</div>
                                </div>
                                {breakEvenPrice && (
                                  <div>
                                    <span className="text-gray-500">Break-Even</span>
                                    <div className="text-yellow-400">${breakEvenPrice.toFixed(2)}</div>
                                  </div>
                                )}
                              </div>
                              
                              {/* Value & P&L */}
                              <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                                <div>
                                  <span className="text-gray-500">Investiert</span>
                                  <div className="text-gray-300">${investedValue.toFixed(0)}</div>
                                </div>
                                <div>
                                  <span className="text-gray-500">Marktwert</span>
                                  <div className="text-gray-300">${notionalValue.toFixed(0)}</div>
                                </div>
                                <div>
                                  <span className="text-gray-500">Unrealisiert</span>
                                  <div className={pnlColor}>
                                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                                  </div>
                                </div>
                              </div>
                              
                              {/* Daily P&L */}
                              {dailyPnl != null && (
                                <div className="grid grid-cols-3 gap-x-3">
                                  <div>
                                    <span className="text-gray-500">Tages-P&L</span>
                                    <div className={dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                                      {dailyPnl >= 0 ? '+' : ''}${dailyPnl.toFixed(2)}
                                      {dailyPnlPercent != null && ` (${dailyPnlPercent >= 0 ? '+' : ''}${dailyPnlPercent.toFixed(2)}%)`}
                                    </div>
                                  </div>
                                  {priceChange != null && (
                                    <div>
                                      <span className="text-gray-500">Kursänderung</span>
                                      <div className={priceChange >= 0 ? 'text-green-400/70' : 'text-red-400/70'}>
                                        {priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {/* Risk */}
                              <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                                {position.stopLoss != null && (
                                  <div>
                                    <span className="text-gray-500">Stop-Loss</span>
                                    <div className={`${distanceToSL != null && distanceToSL < 3 ? 'text-red-300' : 'text-gray-300'}`}>
                                      ${position.stopLoss.toFixed(2)}
                                      {distanceToSL != null && <span className="text-gray-500 ml-1">({distanceToSL.toFixed(1)}%)</span>}
                                    </div>
                                  </div>
                                )}
                                {position.takeProfit != null && (
                                  <div>
                                    <span className="text-gray-500">Take-Profit</span>
                                    <div className={`${distanceToTP != null && distanceToTP < 3 ? 'text-green-300' : 'text-gray-300'}`}>
                                      ${position.takeProfit.toFixed(2)}
                                      {distanceToTP != null && <span className="text-gray-500 ml-1">({distanceToTP.toFixed(1)}%)</span>}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <span className="text-gray-500">Seite</span>
                                  <div className="text-gray-300">
                                    {position.side === 'short' ? '🔴 Short' : '🟢 Long'}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Fees & Time */}
                              <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                                <div>
                                  <span className="text-gray-500">Gebühren</span>
                                  <div className="text-orange-400/80">🏦 ${totalFeesPaid.toFixed(2)}{openFee > 0 && ` (Open: $${openFee.toFixed(2)})`}</div>
                                </div>
                                <div>
                                  <span className="text-gray-500">Haltedauer</span>
                                  <div className="text-gray-300">
                                    {daysHeld > 0 ? `${daysHeld} Tag${daysHeld > 1 ? 'e' : ''}` : `${hoursHeld} Std.`}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-gray-500">Eröffnet</span>
                                  <div className="text-gray-300">
                                    {new Date(position.openedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Market State */}
                              <div className="flex items-center gap-2 pt-0.5">
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${marketState === 'REGULAR' ? 'bg-green-500/20 text-green-400' : marketState === 'PRE' || marketState === 'POST' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-600/30 text-gray-500'}`}>
                                  {marketState === 'REGULAR' ? '🟢 Markt offen' : marketState === 'PRE' ? '🟡 Vormarkt' : marketState === 'POST' ? '🟡 Nachmarkt' : '⚫ Geschlossen'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Col 3: Recent Decisions (3/12 on desktop) */}
          <div className="lg:col-span-3 bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
            <div className="px-3 py-2 border-b border-slate-700/50">
              <h3 className="font-bold text-sm">🧠 Entscheidungen</h3>
            </div>
            <div className="p-2 space-y-1 max-h-[400px] lg:max-h-[600px] overflow-y-auto">
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
        </div>
        
        {/* Bottom row: Notifications + Activity Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
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
        <div className="space-y-4">
          {/* Top row: 3 columns on desktop */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Signal Accuracy */}
            <div>
              <SignalAccuracyChart traderId={traderId} days={30} />
            </div>
            
            {/* Adaptive Weights */}
            <div>
              <AdaptiveWeightsPanel trader={trader} />
            </div>
            
            {/* Training Status */}
            <div>
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4">
                <AITraderTrainingStatus traderId={traderId} compact={false} />
              </div>
            </div>
          </div>
          
          {/* Training History - Full Width */}
          <AITraderTrainingHistory traderId={traderId} />
        </div>
      )}
    </div>
    </>
  );
}
