/**
 * Watchlist Table View - Desktop Optimized Layout
 * 
 * Compact table layout for better space utilization on desktop screens
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TradingSignalSummary } from '../utils/tradingSignals';
import type { CompanyInfo } from '../services/companyInfoService';

// Helper function to format market cap
function formatMarketCap(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}Mrd`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}Mio`;
  return value.toLocaleString('de-DE');
}

interface WatchlistItem {
  symbol: string;
  name: string;
  currentPrice?: number;
  priceEUR?: number;
  priceChange?: number;
  signals?: TradingSignalSummary;
  companyInfo?: CompanyInfo;
  isLoading: boolean;
  error?: string;
  signalSources?: {
    hasNews: boolean;
    hasML: boolean;
    hasRL: boolean;
  };
}

interface WatchlistTableViewProps {
  items: WatchlistItem[];
  currentSymbol?: string;
  filterPeriod: 'hourly' | 'daily' | 'weekly' | 'longTerm';
  onSelectSymbol?: (symbol: string) => void;
  onRemoveSymbol?: (symbol: string) => void;
  onTradeSymbol?: (symbol: string) => void;
  onSetFilterPeriod?: (period: 'hourly' | 'daily' | 'weekly' | 'longTerm') => void;
  getFilteredScoreForPeriod: (signals: TradingSignalSummary | undefined, period: string) => number;
  getSignalDisplayFromScore: (score: number) => any;
  SignalBadge: any;
  SignalSourceBadges: any;
  isAuthenticated: boolean;
}

export function WatchlistTableView({
  items,
  currentSymbol,
  filterPeriod,
  onSelectSymbol,
  onRemoveSymbol,
  onSetFilterPeriod,
  getFilteredScoreForPeriod,
  getSignalDisplayFromScore,
  SignalBadge,
  SignalSourceBadges,
  isAuthenticated,
}: WatchlistTableViewProps) {
  const navigate = useNavigate();
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [deleteConfirmSymbol, setDeleteConfirmSymbol] = useState<string | null>(null);
  
  const periodLabels: Record<string, string> = {
    hourly: '1h',
    daily: '1d',
    weekly: '1w',
    longTerm: 'Long',
  };

  return (
    <div className="hidden lg:block">
      {/* Table Header */}
      <div className="grid grid-cols-[50px_minmax(200px,1fr)_140px_120px_200px_240px_50px] gap-3 px-3 py-2 text-xs font-medium text-gray-400 border-b border-slate-700/50 mb-1 sticky top-0 bg-slate-900/80 backdrop-blur-sm z-10">
        <div></div>
        <div>Symbol / Unternehmen</div>
        <div className="text-right">Kurs</div>
        <div className="text-center">Signal</div>
        <div>Quellen</div>
        <div className="text-center">Perioden</div>
        <div></div>
      </div>
      
      {/* Table Body */}
      <div className="space-y-0.5">
        {items.map((item) => {
          const isExpanded = expandedSymbol === item.symbol;
          
          return (
          <div key={item.symbol} className="transition-all">
            {/* Main Row */}
            <div
              className={`grid grid-cols-[50px_minmax(200px,1fr)_140px_120px_200px_240px_50px] gap-3 items-center px-3 py-2 rounded-lg transition-all cursor-pointer ${
                currentSymbol === item.symbol
                  ? 'bg-blue-500/10 border border-blue-500/30'
                  : isExpanded
                    ? 'bg-slate-800/50 border border-slate-600'
                    : 'hover:bg-slate-800/30 border border-transparent'
              } ${isExpanded ? 'rounded-b-none' : ''}`}
              onClick={() => onSelectSymbol?.(item.symbol)}
            >
            {/* Icon */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 bg-gradient-to-br from-blue-500 to-purple-600">
              {item.symbol.charAt(0)}
            </div>
            
            {/* Symbol & Name with inline company info */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-white text-base">{item.symbol}</span>
                {item.companyInfo?.marketCapEUR !== undefined && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-gray-400" title="Marktkapitalisierung">
                    €{formatMarketCap(item.companyInfo.marketCapEUR)}
                  </span>
                )}
                {item.companyInfo?.peRatio !== undefined && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 ${
                    item.companyInfo.peRatio > 30 ? 'text-yellow-400' : 
                    item.companyInfo.peRatio < 15 ? 'text-green-400' : 'text-gray-400'
                  }`} title="KGV">
                    {item.companyInfo.peRatio.toFixed(1)}
                  </span>
                )}
                {item.companyInfo?.dividendYield !== undefined && item.companyInfo.dividendYield > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 ${
                    item.companyInfo.dividendYield > 3 ? 'text-green-400' : 'text-gray-400'
                  }`} title="Dividende">
                    {item.companyInfo.dividendYield.toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-400 truncate" title={item.companyInfo?.name || item.name}>
                {item.companyInfo?.name || item.name}
                {item.companyInfo?.industry && (
                  <span className="ml-1 text-gray-500 text-[10px]">• {item.companyInfo.industry}</span>
                )}
              </div>
            </div>
            
            {/* Price */}
            <div className="text-right">
              {item.isLoading ? (
                <div className="w-full h-8 bg-slate-700 rounded animate-pulse" />
              ) : item.error ? (
                <span className="text-xs text-red-400">{item.error}</span>
              ) : (
                <>
                  <div className="text-sm font-medium flex items-center justify-end gap-1.5">
                    <span className="text-green-400">€{item.priceEUR?.toFixed(2) || '—'}</span>
                    <span className="text-gray-500 text-xs">${item.currentPrice?.toFixed(2)}</span>
                  </div>
                  <div className={`text-xs ${(item.priceChange ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(item.priceChange ?? 0) >= 0 ? '+' : ''}{item.priceChange?.toFixed(2)}%
                  </div>
                </>
              )}
            </div>
            
            {/* Signal Badge */}
            <div className="flex justify-center">
              {!item.isLoading && !item.error && (
                <SignalBadge signal={item.signals} />
              )}
            </div>
            
            {/* Signal Sources */}
            <div className="min-w-0">
              {!item.isLoading && !item.error && item.signals && item.signals.contributions?.[filterPeriod] && (
                <SignalSourceBadges contributions={item.signals.contributions[filterPeriod]} />
              )}
            </div>
            
            {/* Period Signals */}
            <div>
              {!item.isLoading && !item.error && item.signals && (
                <div className="flex items-center justify-center gap-1 text-xs">
                  {(['hourly', 'daily', 'weekly', 'longTerm'] as const).map(period => {
                    const score = Math.round(getFilteredScoreForPeriod(item.signals, period));
                    const display = getSignalDisplayFromScore(score);
                    
                    return (
                      <button
                        key={period}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetFilterPeriod?.(period);
                        }}
                        className={`px-1.5 py-1 rounded transition-all ${
                          period === filterPeriod ? 'ring-1 ring-blue-500' : ''
                        } ${display?.bgColor || 'bg-slate-700'}`}
                        title={`${periodLabels[period]}: Score ${score > 0 ? '+' : ''}${score}`}
                      >
                        <span className={`${display?.color || 'text-gray-400'} flex flex-col items-center`}>
                          <span className="text-[9px] leading-none">{periodLabels[period]}</span>
                          <span className="font-medium text-xs leading-none mt-0.5">{score > 0 ? '+' : ''}{score}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            
            {/* Actions - Expand Button */}
            <div className="flex items-center justify-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedSymbol(isExpanded ? null : item.symbol);
                  setDeleteConfirmSymbol(null);
                }}
                className="p-1.5 hover:bg-slate-700 rounded text-gray-400 hover:text-white transition-colors"
                title={isExpanded ? 'Zuklappen' : 'Details anzeigen'}
              >
                <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>
          
          {/* Expanded Detail Row */}
          {isExpanded && (
            <div className="bg-slate-800/50 border border-t-0 border-slate-600 rounded-b-lg px-4 py-3 mb-1">
              <div className="flex items-center justify-between gap-4">
                {/* Additional Details */}
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  {item.companyInfo?.sector && (
                    <span>
                      <span className="text-gray-500">Sektor:</span>{' '}
                      <span className="text-white">{item.companyInfo.sector}</span>
                    </span>
                  )}
                  {item.companyInfo?.exchange && (
                    <span>
                      <span className="text-gray-500">Börse:</span>{' '}
                      <span className="text-white">{item.companyInfo.exchange}</span>
                    </span>
                  )}
                  {item.companyInfo?.fiftyTwoWeekHigh !== undefined && (
                    <span>
                      <span className="text-gray-500">52W Hoch:</span>{' '}
                      <span className="text-green-400">${item.companyInfo.fiftyTwoWeekHigh.toFixed(2)}</span>
                    </span>
                  )}
                  {item.companyInfo?.fiftyTwoWeekLow !== undefined && (
                    <span>
                      <span className="text-gray-500">52W Tief:</span>{' '}
                      <span className="text-red-400">${item.companyInfo.fiftyTwoWeekLow.toFixed(2)}</span>
                    </span>
                  )}
                </div>
                
                {/* Action Buttons */}
                <div className="flex items-center gap-2">
                  {isAuthenticated && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/trading?symbol=${encodeURIComponent(item.symbol)}`);
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white font-medium transition-colors flex items-center gap-2"
                      >
                        <span>💹</span>
                        <span>Handeln</span>
                      </button>
                      
                      {deleteConfirmSymbol === item.symbol ? (
                        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/20 rounded-lg">
                          <span className="text-xs text-red-300">Entfernen?</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveSymbol?.(item.symbol);
                              setExpandedSymbol(null);
                              setDeleteConfirmSymbol(null);
                            }}
                            className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs text-white transition-colors"
                          >
                            Ja
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmSymbol(null);
                            }}
                            className="px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded text-xs text-white transition-colors"
                          >
                            Nein
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmSymbol(item.symbol);
                          }}
                          className="px-4 py-2 bg-slate-700 hover:bg-red-600/30 hover:text-red-400 rounded-lg text-sm text-gray-400 transition-colors flex items-center gap-2"
                        >
                          <span>🗑️</span>
                          <span>Entfernen</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        );
        })}
      </div>
    </div>
  );
}
