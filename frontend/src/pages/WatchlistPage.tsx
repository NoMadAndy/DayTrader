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
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="text-3xl">📋</span>
          Meine Watchlist
        </h1>
        <p className="text-gray-400 mt-2">
          Übersicht aller beobachteten Aktien mit Trading-Empfehlungen
        </p>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <WatchlistPanel 
          onSelectSymbol={handleSelectSymbol}
        />
      </div>
    </div>
  );
}