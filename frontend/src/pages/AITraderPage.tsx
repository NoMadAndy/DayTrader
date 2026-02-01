/**
 * AI Trader Dashboard Page
 * 
 * Full dashboard for monitoring and controlling AI traders.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AITraderCard } from '../components/AITraderCard';
import { AITraderActivityFeed } from '../components/AITraderActivityFeed';
import { TradeReasoningCard } from '../components/TradeReasoningCard';
import AITraderReportCard from '../components/AITraderReportCard';
import AITraderInsights from '../components/AITraderInsights';
import SignalAccuracyChart from '../components/SignalAccuracyChart';
import AdaptiveWeightsPanel from '../components/AdaptiveWeightsPanel';
import { useAITraderStream } from '../hooks/useAITraderStream';
import { useAITraderReports } from '../hooks/useAITraderReports';
import { startAITrader, stopAITrader, pauseAITrader } from '../services/aiTraderService';
import type { AITrader, AITraderDecision } from '../types/aiTrader';
import type { PositionWithPnL } from '../types/trading';

export function AITraderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trader, setTrader] = useState<AITrader | null>(null);
  const [decisions, setDecisions] = useState<AITraderDecision[]>([]);
  const [positions, setPositions] = useState<PositionWithPnL[]>([]);
  const [portfolio, setPortfolio] = useState<{ cash: number; totalValue: number; pnl: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'activity' | 'reports' | 'analytics'>('activity');
  
  const traderId = id ? parseInt(id) : undefined;
  const { events, connected } = useAITraderStream({ 
    traderId,
    enabled: !!traderId,
  });
  const { reports } = useAITraderReports(traderId);
  
  // Load trader data
  useEffect(() => {
    if (!traderId) {
      navigate('/leaderboard');
      return;
    }
    
    const loadTraderData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch trader details
        const traderRes = await fetch(`/api/ai-traders/${traderId}`);
        if (!traderRes.ok) throw new Error('Failed to load trader');
        const traderData = await traderRes.json();
        setTrader(traderData);
        
        // Fetch decisions
        const decisionsRes = await fetch(`/api/ai-traders/${traderId}/decisions?limit=10`);
        if (decisionsRes.ok) {
          const decisionsData = await decisionsRes.json();
          setDecisions(decisionsData.decisions || []);
        }
        
        // Fetch positions
        const positionsRes = await fetch(`/api/ai-traders/${traderId}/positions`);
        if (positionsRes.ok) {
          const positionsData = await positionsRes.json();
          setPositions(positionsData.positions || []);
        }
        
        // Fetch portfolio info
        if (traderData.portfolioId) {
          const portfolioRes = await fetch(`/api/portfolio/${traderData.portfolioId}`);
          if (portfolioRes.ok) {
            const portfolioData = await portfolioRes.json();
            setPortfolio({
              cash: portfolioData.cash_balance || 0,
              totalValue: portfolioData.total_value || 0,
              pnl: portfolioData.total_return_percent || 0,
            });
          }
        }
      } catch (err) {
        console.error('Error loading trader data:', err);
        setError('Failed to load AI trader data');
      } finally {
        setLoading(false);
      }
    };
    
    loadTraderData();
  }, [traderId, navigate]);
  
  const handleStart = async () => {
    if (!traderId) return;
    try {
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
      <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading AI Trader...</p>
        </div>
      </div>
    );
  }
  
  if (error || !trader) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-center">
          <div className="text-2xl mb-2">❌</div>
          <div className="font-medium">{error || 'AI Trader not found'}</div>
          <button
            onClick={() => navigate('/leaderboard')}
            className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            Back to Leaderboard
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/leaderboard')}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold">AI Trader Dashboard</h1>
        </div>
        
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-400">
            {connected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>
      
      {/* Main Card */}
      <AITraderCard
        trader={trader}
        onStart={handleStart}
        onStop={handleStop}
        onPause={handlePause}
      />
      
      {/* Trading Time Warning - Show when running but not in trading hours */}
      {trader.status === 'running' && trader.tradingTime === false && (
        <div className="bg-amber-500/20 border-2 border-amber-500/50 rounded-lg p-4 flex items-start gap-3 animate-pulse">
          <div className="text-3xl">🚦</div>
          <div className="flex-1">
            <div className="font-bold text-amber-400 text-lg mb-1">
              Keine Handelszeit
            </div>
            <div className="text-gray-300">
              Es ist aktuell keine Handelszeit. Der Trader bleibt solange inaktiv, bis der Markt öffnet.
            </div>
            {trader.statusMessage && (
              <div className="text-sm text-amber-300 mt-2 italic">
                Status: {trader.statusMessage}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Portfolio Overview */}
      {portfolio && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4">
            <div className="text-sm text-gray-400 mb-1">💰 Cash Balance</div>
            <div className="text-2xl font-bold">${portfolio.cash.toLocaleString()}</div>
          </div>
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4">
            <div className="text-sm text-gray-400 mb-1">📊 Total Value</div>
            <div className="text-2xl font-bold">${portfolio.totalValue.toLocaleString()}</div>
          </div>
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4">
            <div className="text-sm text-gray-400 mb-1">📈 Total P&L</div>
            <div className={`text-2xl font-bold ${portfolio.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {portfolio.pnl >= 0 ? '+' : ''}{portfolio.pnl.toFixed(2)}%
            </div>
          </div>
        </div>
      )}
      
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
          {/* Left Column: Activity Feed */}
          <AITraderActivityFeed events={events} maxHeight="600px" autoScroll={true} />
          
          {/* Right Column: Positions & Decisions */}
          <div className="space-y-6">
            {/* Open Positions */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
              <div className="px-4 py-3 border-b border-slate-700/50">
                <h3 className="font-bold">📍 Open Positions ({positions.length})</h3>
              </div>
              <div className="p-4">
                {positions.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    <div className="text-2xl mb-2">📭</div>
                    <div>No open positions</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {positions.map((position) => (
                      <div 
                        key={position.id}
                        className="bg-slate-900/50 rounded-lg p-3 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold">{position.symbol}</div>
                          <div className="text-xs text-gray-400">
                            {position.quantity} @ ${position.entryPrice?.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-bold ${(position.unrealizedPnlPercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {(position.unrealizedPnlPercent || 0) >= 0 ? '+' : ''}
                            {(position.unrealizedPnlPercent || 0).toFixed(2)}%
                          </div>
                          <div className="text-xs text-gray-400">
                            ${(position.unrealizedPnl || 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            {/* Recent Decisions */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-lg border border-slate-700/50">
              <div className="px-4 py-3 border-b border-slate-700/50">
                <h3 className="font-bold">🧠 Recent Decisions</h3>
              </div>
              <div className="p-4 space-y-3">
                {decisions.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    <div className="text-2xl mb-2">🤔</div>
                    <div>No decisions yet</div>
                  </div>
                ) : (
                  decisions.map((decision) => (
                    <TradeReasoningCard key={decision.id} decision={decision} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {activeTab === 'reports' && traderId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Latest Report */}
          <div>
            {reports.length > 0 ? (
              <AITraderReportCard report={reports[0]} />
            ) : (
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow text-center">
                <div className="text-4xl mb-2">📊</div>
                <p className="text-gray-600 dark:text-gray-400">
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
        </div>
      )}
    </div>
  );
}
