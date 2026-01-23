/**
 * News Panel Component
 * 
 * Displays financial news for the selected stock.
 */

import { useState } from 'react';
import { useNews } from '../hooks';

interface NewsPanelProps {
  symbol: string;
  className?: string;
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

export function NewsPanel({ symbol, className = '' }: NewsPanelProps) {
  const { news, isLoading, error, refetch } = useNews(symbol);

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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
          <h3 className="font-semibold text-white">News for {symbol}</h3>
        </div>
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

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {news.map((item) => (
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
                <h4 className="font-medium text-white text-sm line-clamp-2 mb-1">
                  {item.headline}
                </h4>
                {item.summary && (
                  <p className="text-xs text-gray-400 line-clamp-2 mb-2">
                    {item.summary}
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>{item.source}</span>
                  <span>•</span>
                  <span>{formatTimeAgo(item.datetime)}</span>
                </div>
              </div>
            </div>
          </a>
        ))}
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
