/**
 * DayTrader AI - Main Application
 * 
 * Multi-page application with React Router for navigation between:
 * - Dashboard: Main trading view with charts, forecasts, and signals
 * - Watchlist: Manage watched symbols with trading recommendations
 * - Settings: API keys, ML settings, data sources, and authentication
 * - Info: Technical analysis explanations
 * - Changelog: Version history
 */

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DataServiceProvider, useServiceWorker } from './hooks';
import { SettingsProvider, useSettings } from './contexts';
import { Navigation } from './components/Navigation';
import { DashboardPage, WatchlistPage, SettingsPage, ChangelogPage, InfoPage, TradingPortfolioPage, LeaderboardPage } from './pages';
import BacktestPage from './pages/BacktestPage';
import { initializeAuth, subscribeToAuth } from './services/authService';
import { getBestSymbolFromWatchlist, clearBestSymbolCache } from './services/bestSymbolService';

// Build info from Vite config
declare const __BUILD_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

function AppContent() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [isLoadingBestSymbol, setIsLoadingBestSymbol] = useState(true);

  // Initialize Service Worker for background updates
  const { isSupported: swSupported, periodicSyncSupported } = useServiceWorker();
  
  useEffect(() => {
    if (swSupported) {
      console.log('[App] Service Worker aktiv', periodicSyncSupported ? '(mit Periodic Sync)' : '');
    }
  }, [swSupported, periodicSyncSupported]);

  // Initialize auth on mount
  useEffect(() => {
    initializeAuth();
  }, []);

  // Load best symbol from watchlist on mount and auth changes
  useEffect(() => {
    const loadBestSymbol = async () => {
      setIsLoadingBestSymbol(true);
      try {
        const bestSymbol = await getBestSymbolFromWatchlist();
        setSelectedSymbol(bestSymbol);
      } catch (error) {
        console.error('[App] Error loading best symbol:', error);
        setSelectedSymbol('AAPL'); // Fallback
      }
      setIsLoadingBestSymbol(false);
    };

    loadBestSymbol();

    // Re-evaluate when auth state changes
    const unsubscribe = subscribeToAuth(() => {
      clearBestSymbolCache();
      loadBestSymbol();
    });
    return () => unsubscribe();
  }, []);

  // Listen for symbol selection from Watchlist
  useEffect(() => {
    const handleSelectSymbol = (event: CustomEvent<string>) => {
      setSelectedSymbol(event.detail);
    };
    
    window.addEventListener('selectSymbol', handleSelectSymbol as EventListener);
    return () => {
      window.removeEventListener('selectSymbol', handleSelectSymbol as EventListener);
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex flex-col">
        {/* Navigation */}
        <Navigation />

        {/* Routes */}
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route 
              path="/" 
              element={
                isLoadingBestSymbol || !selectedSymbol ? (
                  <div className="flex items-center justify-center flex-1">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                      <p className="text-gray-400">Analysiere Watchlist für beste Empfehlung...</p>
                    </div>
                  </div>
                ) : (
                  <DashboardPage 
                    selectedSymbol={selectedSymbol} 
                    onSymbolChange={setSelectedSymbol} 
                  />
                )
              } 
            />
            <Route path="/trading" element={<TradingPortfolioPage />} />
            <Route path="/portfolio" element={<TradingPortfolioPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/backtest" element={<BacktestPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/info" element={<InfoPage />} />
            <Route path="/changelog" element={<ChangelogPage />} />
          </Routes>
        </main>

        <AppFooter />
      </div>
    </BrowserRouter>
  );
}

function AppFooter() {
  const { t } = useSettings();
  
  return (
    <footer className="border-t border-slate-700/50 py-6">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <div>
            <p>{t('footer.disclaimer')}</p>
          </div>
          <div className="flex items-center gap-4">
            <span>v{__BUILD_VERSION__}</span>
            <span>•</span>
            <span>{__BUILD_COMMIT__}</span>
            <span>•</span>
            <span>{new Date(__BUILD_TIME__).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function App() {
  return (
    <SettingsProvider>
      <DataServiceProvider>
        <AppContent />
      </DataServiceProvider>
    </SettingsProvider>
  );
}

export default App;