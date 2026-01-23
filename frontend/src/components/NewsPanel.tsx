/**
 * News Panel Component
 * 
 * Displays financial news for the selected stock with sentiment analysis.
 * Uses ML-based FinBERT sentiment when available, falls back to keyword-based analysis.
 * Includes trading signal summary for different holding periods.
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNews } from '../hooks';
import { analyzeSentiment, getSentimentLabel, type SentimentResult } from '../utils/sentimentAnalysis';
import { analyzeBatchWithFallback, checkMLSentimentAvailable, resetMLServiceCache } from '../services/mlSentimentService';
import { TradingSignalPanel } from './TradingSignalPanel';
import type { ForecastResult, OHLCV } from '../types/stock';

// ML Prediction Interface
interface MLPrediction {
  date: string;
  day: number;
  predicted_price: number;
  confidence: number;
  change_pct: number;
}

interface NewsPanelProps {
  symbol: string;
  className?: string;
  // Neue Props für kombinierte Trading-Signale
  forecast?: ForecastResult;
  stockData?: OHLCV[];
  mlPredictions?: MLPrediction[];
  currentPrice?: number;
}

interface NewsItemWithSentiment {
  id: string;
  headline: string;
  summary?: string;
  source: string;
  url: string;
  datetime: number;
  image?: string;
  sentimentResult: SentimentResult & { source?: 'ml' | 'local' };
}

// Image component with error fallback using React state
function NewsImage({ src, className }: { src: string; className: string }) {
  const [hasError, setHasError] = useState(false);
  
  if (hasError) {
    return null;
  }
  
  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setHasError(true)}
    />
  );
}

export function NewsPanel({ 
  symbol, 
  className = '',
  forecast,
  stockData,
  mlPredictions,
  currentPrice
}: NewsPanelProps) {
  const { news, isLoading, error, refetch } = useNews(symbol);
  const [newsWithSentiment, setNewsWithSentiment] = useState<NewsItemWithSentiment[]>([]);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [useMLSentiment, setUseMLSentiment] = useState(true);
  const [mlAvailable, setMlAvailable] = useState<boolean | null>(null);

  // Check ML availability on mount
  useEffect(() => {
    checkMLSentimentAvailable().then(setMlAvailable);
  }, []);

  // Analyze sentiment when news changes
  useEffect(() => {
    if (news.length === 0) {
      setNewsWithSentiment([]);
      return;
    }

    const analyzeNews = async () => {
      setSentimentLoading(true);
      
      try {
        if (useMLSentiment && mlAvailable) {
          // Use ML batch analysis
          const texts = news.map(item => `${item.headline} ${item.summary || ''}`);
          const results = await analyzeBatchWithFallback(texts, true);
          
          setNewsWithSentiment(news.map((item, index) => ({
            ...item,
            sentimentResult: results[index],
          })));
        } else {
          // Use local analysis only
          setNewsWithSentiment(news.map(item => ({
            ...item,
            sentimentResult: {
              ...analyzeSentiment(`${item.headline} ${item.summary || ''}`),
              source: 'local' as const,
            },
          })));
        }
      } catch (err) {
        console.error('Sentiment analysis failed:', err);
        // Fallback to local
        setNewsWithSentiment(news.map(item => ({
          ...item,
          sentimentResult: {
            ...analyzeSentiment(`${item.headline} ${item.summary || ''}`),
            source: 'local' as const,
          },
        })));
      } finally {
        setSentimentLoading(false);
      }
    };

    analyzeNews();
  }, [news, useMLSentiment, mlAvailable]);

  // Toggle ML sentiment
  const toggleMLSentiment = useCallback(() => {
    setUseMLSentiment(prev => !prev);
    resetMLServiceCache();
    checkMLSentimentAvailable().then(setMlAvailable);
  }, []);

  // Calculate overall sentiment summary
  const sentimentSummary = useMemo(() => {
    if (newsWithSentiment.length === 0) return null;
    
    const counts = { positive: 0, negative: 0, neutral: 0 };
    let totalScore = 0;
    
    newsWithSentiment.forEach(item => {
      counts[item.sentimentResult.sentiment]++;
      totalScore += item.sentimentResult.score;
    });
    
    const avgScore = totalScore / newsWithSentiment.length;
    const dominantSentiment = avgScore > 0.1 ? 'positive' : avgScore < -0.1 ? 'negative' : 'neutral';
    
    return { counts, avgScore, dominantSentiment };
  }, [newsWithSentiment]);

  if (isLoading) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-6 border border-slate-700 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <h3 className="font-semibold text-white">News</h3>
        </div>
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-6 border border-slate-700 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <h3 className="font-semibold text-white">News</h3>
        </div>
        <div className="text-center py-4 text-gray-400">
          <p>Unable to load news.</p>
          <button
            onClick={refetch}
            className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (news.length === 0) {
    return (
      <div className={`bg-slate-800/50 rounded-xl p-6 border border-slate-700 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <h3 className="font-semibold text-white">News</h3>
        </div>
        <div className="text-center py-8 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p>No news available for {symbol}</p>
          <p className="text-xs mt-1 text-gray-500">Configure API keys to enable news</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-slate-800/50 rounded-xl p-6 border border-slate-700 flex flex-col ${className}`}>
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <h3 className="font-semibold text-white">News for {symbol}</h3>
          {sentimentLoading && (
            <div className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* ML/Local Toggle */}
          <button
            onClick={toggleMLSentiment}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              useMLSentiment && mlAvailable
                ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                : 'bg-slate-700/50 text-gray-400 hover:bg-slate-700'
            }`}
            title={mlAvailable 
              ? (useMLSentiment ? 'Using FinBERT ML (click for keyword-based)' : 'Using keyword-based (click for FinBERT ML)')
              : 'ML service not available'
            }
          >
            {useMLSentiment && mlAvailable ? '🤖 FinBERT' : '📝 Keywords'}
          </button>
          {/* Sentiment Summary */}
          {sentimentSummary && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-green-400" title="Bullish">📈 {sentimentSummary.counts.positive}</span>
              <span className="text-gray-400" title="Neutral">➖ {sentimentSummary.counts.neutral}</span>
              <span className="text-red-400" title="Bearish">📉 {sentimentSummary.counts.negative}</span>
            </div>
          )}
          <button
            onClick={refetch}
            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-gray-400 hover:text-white transition-colors"
            title="Refresh news"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Trading Signal Summary - zeigt kombinierte Signale aus allen Datenquellen */}
      {(newsWithSentiment.length > 0 || forecast || (mlPredictions && mlPredictions.length > 0)) && (
        <TradingSignalPanel 
          newsItems={newsWithSentiment.map(item => ({
            sentimentResult: item.sentimentResult,
            datetime: item.datetime
          }))}
          symbol={symbol}
          className="mb-4"
          forecast={forecast}
          stockData={stockData}
          mlPredictions={mlPredictions}
          currentPrice={currentPrice}
        />
      )}

      <div className="space-y-3 flex-1 overflow-y-auto">
        {newsWithSentiment.map((item) => {
          const sentimentInfo = getSentimentLabel(item.sentimentResult.sentiment);
          return (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-3 rounded-lg bg-slate-900/50 hover:bg-slate-700/50 transition-colors border border-slate-700/50"
            >
              <div className="flex gap-3">
                {item.image && (
                  <NewsImage 
                    src={item.image} 
                    className="w-16 h-16 rounded-lg object-cover flex-shrink-0" 
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h4 className="font-medium text-white text-sm line-clamp-2 flex-1">
                      {item.headline}
                    </h4>
                    {/* Sentiment Tag */}
                    <span 
                      className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                        item.sentimentResult.sentiment === 'positive' 
                          ? 'bg-green-500/20 text-green-400' 
                          : item.sentimentResult.sentiment === 'negative'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                      title={`Score: ${item.sentimentResult.score.toFixed(2)}, Confidence: ${(item.sentimentResult.confidence * 100).toFixed(0)}%${item.sentimentResult.source ? ` (${item.sentimentResult.source === 'ml' ? 'FinBERT' : 'Keywords'})` : ''}`}
                    >
                      {sentimentInfo.emoji} {sentimentInfo.label}
                    </span>
                  </div>
                  {item.summary && (
                    <p className="text-xs text-gray-400 line-clamp-2 mb-2">
                      {item.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{item.source}</span>
                    <span>•</span>
                    <span>{formatTimeAgo(item.datetime)}</span>
                    {item.sentimentResult.keywords.positive.length > 0 || item.sentimentResult.keywords.negative.length > 0 ? (
                      <>
                        <span>•</span>
                        <span className="truncate max-w-[150px]" title={[...item.sentimentResult.keywords.positive, ...item.sentimentResult.keywords.negative].join(', ')}>
                          {[...item.sentimentResult.keywords.positive.slice(0, 2), ...item.sentimentResult.keywords.negative.slice(0, 2)].join(', ')}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}
