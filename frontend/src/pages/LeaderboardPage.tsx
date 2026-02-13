/**
 * LeaderboardPage - Global Trading Competition Leaderboard
 * 
 * Shows rankings of all paper trading participants by total return.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import {
  getLeaderboard,
  getUserRank,
  formatPercent,
} from '../services/tradingService';
import { useSettings } from '../contexts/SettingsContext';
import type { LeaderboardEntry, UserRank } from '../types/trading';
import { log } from '../utils/logger';

type TimeframeType = 'all' | 'month' | 'week' | 'day';
type FilterType = 'all' | 'humans' | 'ai';

export function LeaderboardPage() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<UserRank | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeType>('all');
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t, formatCurrency } = useSettings();
  
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);
  
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        
        const [leaderboardData, rankData] = await Promise.all([
          getLeaderboard(50, timeframe, filter),
          authState.isAuthenticated ? getUserRank() : Promise.resolve(null),
        ]);
        
        setLeaderboard(leaderboardData);
        setUserRank(rankData);
      } catch (e) {
        setError(t('leaderboard.loadError'));
        log.error(e);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, [timeframe, filter, authState.isAuthenticated]);
  
  const getRankIcon = (rank: number): string => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };
  
  const getRankStyle = (rank: number): string => {
    if (rank === 1) return 'bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border-yellow-500/50';
    if (rank === 2) return 'bg-gradient-to-r from-gray-400/20 to-slate-400/20 border-gray-400/50';
    if (rank === 3) return 'bg-gradient-to-r from-orange-600/20 to-amber-600/20 border-orange-500/50';
    return 'bg-slate-900/50 border-slate-700/50';
  };
  
  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            🏆 {t('leaderboard.title')}
          </h1>
          <p className="text-gray-400 text-xs sm:text-sm mt-1">
            {t('leaderboard.description')}
          </p>
        </div>
        
        {/* Timeframe Selector */}
        <div className="flex gap-1 sm:gap-2">
          {[
            { id: 'all', labelKey: 'leaderboard.timeframe.all' },
            { id: 'month', labelKey: 'leaderboard.timeframe.month' },
            { id: 'week', labelKey: 'leaderboard.timeframe.week' },
            { id: 'day', labelKey: 'leaderboard.timeframe.day' },
          ].map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.id as TimeframeType)}
              className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                timeframe === tf.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700'
              }`}
            >
              {t(tf.labelKey)}
            </button>
          ))}
        </div>
      </div>
      
      {/* Filter Buttons */}
      <div className="flex gap-1.5 sm:gap-2 justify-center">
        {[
          { id: 'all', label: 'Alle', icon: '👥' },
          { id: 'humans', label: 'Menschen', icon: '👤' },
          { id: 'ai', label: 'KI', icon: '🤖' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id as FilterType)}
            className={`px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 sm:gap-2 ${
              filter === f.id
                ? 'bg-purple-600 text-white'
                : 'bg-slate-800 text-gray-300 hover:bg-slate-700'
            }`}
          >
            <span>{f.icon}</span>
            <span>{f.label}</span>
          </button>
        ))}
      </div>
      
      {/* User's own rank card */}
      {authState.isAuthenticated && userRank && userRank.rank !== null && (
        <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-3xl font-bold text-blue-400">
                #{userRank.rank}
              </div>
              <div>
                <div className="font-semibold">{t('leaderboard.yourRank')}</div>
                <div className="text-sm text-gray-400">
                  {userRank.totalParticipants} {t('leaderboard.columns.trader')}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold">{formatCurrency(userRank.currentValue)}</div>
              <div className={`text-sm ${userRank.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatPercent(userRank.totalReturnPct)}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {authState.isAuthenticated && userRank?.rank === null && (
        <div className="bg-slate-800/50 rounded-xl p-4 text-center text-gray-400">
          <p>{t('leaderboard.notRanked')} {t('leaderboard.tradeToAppear')}</p>
        </div>
      )}
      
      {/* Error */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-300">
          {error}
        </div>
      )}
      
      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        /* Leaderboard Table */
        <div className="bg-slate-800/50 rounded-xl overflow-hidden">
          {leaderboard.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-4">📭</div>
              <p>{t('leaderboard.noTraders')}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/50 overflow-x-auto">
              {leaderboard.map((entry) => {
                const isClickable = entry.isAITrader && entry.aiTraderId;
                
                const content = (
                  <>
                    <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                      <div className="w-8 sm:w-12 text-center text-sm sm:text-xl font-bold flex-shrink-0">
                        {getRankIcon(entry.rank)}
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        {entry.isAITrader && entry.avatar && (
                          <span className="text-lg sm:text-2xl flex-shrink-0" title="AI Trader">{entry.avatar}</span>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold flex items-center gap-1 sm:gap-2 text-sm sm:text-base">
                            <span className="truncate">{entry.username}</span>
                            {entry.isAITrader && (
                              <span className="text-[10px] sm:text-xs bg-purple-600/30 text-purple-300 px-1.5 sm:px-2 py-0.5 rounded-full flex-shrink-0">
                                KI
                              </span>
                            )}
                          </div>
                          <div className="text-xs sm:text-sm text-gray-400 truncate">{entry.name}</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 sm:gap-8 flex-shrink-0">
                      <div className="text-right hidden md:block">
                        <div className="text-sm text-gray-400">{t('leaderboard.columns.trades')}</div>
                        <div className="font-medium">{entry.totalTrades}</div>
                      </div>
                      <div className="text-right hidden md:block">
                        <div className="text-sm text-gray-400">{t('leaderboard.columns.winRate')}</div>
                        <div className={`font-medium ${entry.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                          {entry.winRate.toFixed(1)}%
                        </div>
                      </div>
                      <div className="text-right hidden sm:block">
                        <div className="text-xs sm:text-sm text-gray-400">Portfolio</div>
                        <div className="text-sm sm:text-base font-medium">{formatCurrency(entry.currentValue)}</div>
                      </div>
                      <div className="text-right min-w-[60px] sm:min-w-[100px]">
                        <div className={`text-sm sm:text-xl font-bold ${entry.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatPercent(entry.totalReturnPct)}
                        </div>
                      </div>
                    </div>
                  </>
                );
                
                return isClickable ? (
                  <Link
                    key={entry.portfolioId}
                    to={`/ai-trader/${entry.aiTraderId}`}
                    className={`p-2.5 sm:p-4 flex items-center justify-between gap-2 border-l-4 ${getRankStyle(entry.rank)} hover:bg-slate-700/30 transition-colors`}
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={entry.portfolioId}
                    className={`p-2.5 sm:p-4 flex items-center justify-between gap-2 border-l-4 ${getRankStyle(entry.rank)}`}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      
      {/* Info */}
      <div className="bg-slate-800/50 rounded-xl p-4 text-sm text-gray-400">
        <p className="flex items-center gap-2">
          <span>ℹ️</span>
          {t('leaderboard.tradeToAppear')}
        </p>
      </div>
    </div>
  );
}

export default LeaderboardPage;
