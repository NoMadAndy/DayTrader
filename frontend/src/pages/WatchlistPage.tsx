/**
 * Watchlist Page
 * 
 * Full page view of the user's stock watchlist with trading signals.
 */

import { WatchlistPanel } from '../components/WatchlistPanel';
import { useNavigate } from 'react-router-dom';

export function WatchlistPage() {
  const navigate = useNavigate();

  const handleSelectSymbol = (symbol: string) => {
    // Dispatch event for App to update selected symbol
    window.dispatchEvent(new CustomEvent('selectSymbol', { detail: symbol }));
    navigate('/');
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex-1 flex flex-col">
      <div className="mb-4 sm:mb-6 px-2 sm:px-0">
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
          <span className="text-2xl sm:text-3xl">📋</span>
          Meine Watchlist
        </h1>
        <p className="text-gray-400 mt-1 sm:mt-2 text-sm sm:text-base">
          Übersicht aller beobachteten Aktien mit Trading-Empfehlungen
        </p>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-3 sm:p-6 flex-1 overflow-hidden">
        <WatchlistPanel 
          onSelectSymbol={handleSelectSymbol}
        />
      </div>
    </div>
  );
}