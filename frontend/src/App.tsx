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
import { DataServiceProvider } from './hooks';
import { Navigation } from './components/Navigation';
import { DashboardPage, WatchlistPage, SettingsPage, ChangelogPage, InfoPage } from './pages';
import { initializeAuth } from './services/authService';

// Build info from Vite config
declare const __BUILD_VERSION__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

function AppContent() {
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');

  // Initialize auth on mount
  useEffect(() => {
    initializeAuth();
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
        <main className="flex-1">
          <Routes>
            <Route 
              path="/" 
              element={
                <DashboardPage 
                  selectedSymbol={selectedSymbol} 
                  onSymbolChange={setSelectedSymbol} 
                />
              } 
            />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/info" element={<InfoPage />} />
            <Route path="/changelog" element={<ChangelogPage />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-700/50 py-6">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
              <div>
                <p>⚠️ <strong>Disclaimer:</strong> This is for educational/testing purposes only. Not financial advice.</p>
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
      </div>
    </BrowserRouter>
  );
}

function App() {
  return (
    <DataServiceProvider>
      <AppContent />
    </DataServiceProvider>
  );
}

export default App;