/**
 * Watchlist Page
 * 
 * Full page view of the user's stock watchlist with trading signals.
 */

import { WatchlistPanel, ForexWidget, ExchangeStatusPanel } from '../components';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { useState } from 'react';

export function WatchlistPage() {
  const navigate = useNavigate();
  const { t } = useSettings();
  const [showExchanges, setShowExchanges] = useState(false);

  const handleSelectSymbol = (symbol: string) => {
    // Dispatch event for App to update selected symbol
    window.dispatchEvent(new CustomEvent('selectSymbol', { detail: symbol }));
    navigate('/dashboard');
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex-1 flex flex-col">
      <div className="mb-4 sm:mb-6 px-2 sm:px-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
            <span className="text-2xl sm:text-3xl">📋</span>
            {t('watchlistPage.title')}
          </h1>
          <p className="text-gray-400 mt-1 sm:mt-2 text-sm sm:text-base">
            {t('watchlistPage.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExchanges(!showExchanges)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              showExchanges 
                ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' 
                : 'bg-slate-700/50 border-slate-600 text-gray-400 hover:text-white'
            }`}
          >
            🌍 Börsen
          </button>
          {/* Forex Widget */}
          <ForexWidget compact className="self-start sm:self-auto" />
        </div>
      </div>

      {/* Exchange Status Panel - toggleable */}
      {showExchanges && (
        <div className="mb-4 px-2 sm:px-0">
          <ExchangeStatusPanel />
        </div>
      )}

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-3 sm:p-6 flex-1 overflow-hidden">
        <WatchlistPanel 
          onSelectSymbol={handleSelectSymbol}
        />
      </div>
    </div>
  );
}