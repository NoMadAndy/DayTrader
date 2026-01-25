/**
 * PortfolioPage - Portfolio Overview and History
 * 
 * Shows portfolio performance, transaction history, and detailed analytics.
 */

import { useState, useEffect, useCallback } from 'react';
import { getAuthState, subscribeToAuth, type AuthState } from '../services/authService';
import {
  getOrCreatePortfolio,
  getPortfolioMetrics,
  getAllPositions,
  getTransactionHistory,
  getFeeSummary,
  resetPortfolio,
  updatePortfolioSettings,
  setInitialCapital,
  getBrokerProfiles,
  formatCurrency,
  formatPercent,
  getProductTypeName,
  getSideName,
} from '../services/tradingService';
import { EquityChart } from '../components';
import type {
  Portfolio,
  Position,
  Transaction,
  PortfolioMetrics,
  FeeSummary,
  BrokerProfiles,
  BrokerProfileId,
} from '../types/trading';

type TabType = 'overview' | 'positions' | 'history' | 'settings';

export function PortfolioPage() {
  const [authState, setAuthState] = useState<AuthState>(getAuthState());
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  
  // Data
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [feeSummary, setFeeSummary] = useState<FeeSummary | null>(null);
  const [brokerProfiles, setBrokerProfiles] = useState<BrokerProfiles | null>(null);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCapitalChange, setShowCapitalChange] = useState(false);
  const [newCapital, setNewCapital] = useState<string>('');
  
  useEffect(() => {
    return subscribeToAuth(setAuthState);
  }, []);
  
  useEffect(() => {
    getBrokerProfiles().then(setBrokerProfiles).catch(console.error);
  }, []);
  
  const loadData = useCallback(async () => {
    if (!authState.isAuthenticated) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const portfolioData = await getOrCreatePortfolio();
      setPortfolio(portfolioData);
      
      const [metricsData, positionsData, transactionsData, feeData] = await Promise.all([
        getPortfolioMetrics(portfolioData.id),
        getAllPositions(portfolioData.id),
        getTransactionHistory(portfolioData.id),
        getFeeSummary(portfolioData.id),
      ]);
      
      setMetrics(metricsData);
      setPositions(positionsData);
      setTransactions(transactionsData);
      setFeeSummary(feeData);
    } catch (e) {
      setError('Daten konnten nicht geladen werden');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [authState.isAuthenticated]);
  
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Note: Auto-refresh is now handled server-side via background jobs
  // The server updates quotes every 60 seconds for all watched symbols
  
  const handleReset = async () => {
    if (!portfolio) return;
    
    try {
      await resetPortfolio(portfolio.id);
      setSuccessMessage('Portfolio wurde zurückgesetzt');
      setShowResetConfirm(false);
      await loadData();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (e) {
      setError('Reset fehlgeschlagen');
    }
  };
  
  const handleCapitalChange = async () => {
    if (!portfolio) return;
    
    const capital = parseFloat(newCapital.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (isNaN(capital)) {
      setError('Ungültiger Betrag');
      return;
    }
    
    try {
      setError(null);
      await setInitialCapital(portfolio.id, capital);
      setSuccessMessage(`Startkapital wurde auf ${formatCurrency(capital)} geändert`);
      setShowCapitalChange(false);
      setNewCapital('');
      await loadData();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Änderung fehlgeschlagen');
    }
  };
  
  const handleBrokerChange = async (brokerProfile: BrokerProfileId) => {
    if (!portfolio) return;
    
    try {
      await updatePortfolioSettings(portfolio.id, { brokerProfile });
      setPortfolio({ ...portfolio, brokerProfile });
      setSuccessMessage('Broker-Profil geändert');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e) {
      setError('Einstellung konnte nicht gespeichert werden');
    }
  };
  
  if (!authState.isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-slate-800/50 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">📊 Portfolio</h2>
          <p className="text-gray-400 mb-6">
            Melde dich an, um dein Portfolio und deine Trading-Historie zu sehen.
          </p>
          <a 
            href="/settings" 
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            Anmelden
          </a>
        </div>
      </div>
    );
  }
  
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">📊 Portfolio</h1>
          <p className="text-gray-400 text-sm mt-1">
            {portfolio?.name} • Broker: {brokerProfiles?.[portfolio?.brokerProfile || 'standard']?.name}
          </p>
        </div>
        
        {metrics && (
          <div className="text-right">
            <div className="text-2xl font-bold">{formatCurrency(metrics.totalValue)}</div>
            <div className={`text-sm ${metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatPercent(metrics.totalReturn)} seit Start
            </div>
          </div>
        )}
      </div>
      
      {/* Messages */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-300">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">×</button>
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4 text-green-300">
          ✅ {successMessage}
        </div>
      )}
      
      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-700 pb-2">
        {[
          { id: 'overview', label: '📈 Übersicht' },
          { id: 'positions', label: '📋 Positionen' },
          { id: 'history', label: '📜 Historie' },
          { id: 'settings', label: '⚙️ Einstellungen' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-slate-800 text-white'
                : 'text-gray-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* Tab Content */}
      <div className="bg-slate-800/50 rounded-xl p-6">
        {activeTab === 'overview' && metrics && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900/50 rounded-lg p-4">
                <div className="text-sm text-gray-400">Gesamtwert</div>
                <div className="text-xl font-bold">{formatCurrency(metrics.totalValue)}</div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-4">
                <div className="text-sm text-gray-400">Bargeld</div>
                <div className="text-xl font-bold text-blue-400">{formatCurrency(metrics.cashBalance)}</div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-4">
                <div className="text-sm text-gray-400">Unrealisiert P&L</div>
                <div className={`text-xl font-bold ${metrics.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(metrics.unrealizedPnl)}
                </div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-4">
                <div className="text-sm text-gray-400">Realisiert P&L</div>
                <div className={`text-xl font-bold ${metrics.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(metrics.realizedPnl)}
                </div>
              </div>
            </div>
            
            {/* Trading Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-3">📊 Trading-Statistik</h3>
                <div className="space-y-2">
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Trades gesamt</span>
                    <span className="font-medium">{metrics.totalTrades}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Gewinner</span>
                    <span className="font-medium text-green-400">{metrics.winningTrades}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Verlierer</span>
                    <span className="font-medium text-red-400">{metrics.losingTrades}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Win-Rate</span>
                    <span className={`font-medium ${metrics.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                      {metrics.winRate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-700">
                    <span className="text-gray-400">Ø Gewinn</span>
                    <span className="font-medium text-green-400">{formatCurrency(metrics.avgWin)}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-gray-400">Ø Verlust</span>
                    <span className="font-medium text-red-400">{formatCurrency(metrics.avgLoss)}</span>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold mb-3">💰 Gebühren-Übersicht</h3>
                {feeSummary && (
                  <div className="space-y-2">
                    <div className="flex justify-between py-2 border-b border-slate-700">
                      <span className="text-gray-400">Kommissionen</span>
                      <span className="font-medium text-yellow-400">{formatCurrency(feeSummary.commission)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-700">
                      <span className="text-gray-400">Spread-Kosten</span>
                      <span className="font-medium text-yellow-400">{formatCurrency(feeSummary.spread)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-700">
                      <span className="text-gray-400">Overnight-Gebühren</span>
                      <span className="font-medium text-yellow-400">{formatCurrency(feeSummary.overnight)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-t-2 border-slate-600 mt-2">
                      <span className="font-semibold">Gesamt</span>
                      <span className="font-bold text-yellow-400">{formatCurrency(feeSummary.total)}</span>
                    </div>
                  </div>
                )}
                
                {/* Fee Impact */}
                {metrics.totalTrades > 0 && feeSummary && (
                  <div className="mt-4 p-3 bg-slate-900/50 rounded-lg text-sm">
                    <div className="text-gray-400 mb-1">Gebühren-Impact:</div>
                    <div className="text-yellow-300">
                      {formatCurrency(feeSummary.total / metrics.totalTrades)} pro Trade
                    </div>
                    <div className="text-gray-500 text-xs mt-1">
                      {((feeSummary.total / portfolio!.initialCapital) * 100).toFixed(2)}% des Startkapitals
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Margin Info */}
            {metrics.marginUsed > 0 && (
              <div className="bg-slate-900/50 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3">📊 Margin-Status</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-gray-400">Verwendete Margin</div>
                    <div className="text-lg font-medium">{formatCurrency(metrics.marginUsed)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Freie Margin</div>
                    <div className="text-lg font-medium text-blue-400">{formatCurrency(metrics.freeMargin)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Margin-Level</div>
                    <div className={`text-lg font-medium ${
                      (metrics.marginLevel || 0) > 150 ? 'text-green-400' :
                      (metrics.marginLevel || 0) > 100 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {metrics.marginLevel?.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Portfolio Equity Curve */}
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3">📈 Portfolio-Entwicklung</h3>
              <EquityChart 
                portfolioId={portfolio!.id}
                days={90}
                height={250}
              />
            </div>
          </div>
        )}
        
        {activeTab === 'positions' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Alle Positionen ({positions.length})</h3>
            {positions.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                Noch keine Positionen vorhanden
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-slate-700">
                      <th className="pb-2">Symbol</th>
                      <th className="pb-2">Typ</th>
                      <th className="pb-2">Seite</th>
                      <th className="pb-2 text-right">Menge</th>
                      <th className="pb-2 text-right">Einstieg</th>
                      <th className="pb-2 text-right">P&L</th>
                      <th className="pb-2 text-right">Status</th>
                      <th className="pb-2">Datum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos) => (
                      <tr key={pos.id} className="border-b border-slate-800">
                        <td className="py-2 font-medium">{pos.symbol}</td>
                        <td className="py-2 text-gray-400">{getProductTypeName(pos.productType)}</td>
                        <td className="py-2">
                          <span className={pos.side === 'long' ? 'text-green-400' : 'text-red-400'}>
                            {pos.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 text-right">{pos.quantity}</td>
                        <td className="py-2 text-right">{formatCurrency(pos.entryPrice)}</td>
                        <td className={`py-2 text-right ${
                          (pos.realizedPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {pos.realizedPnl ? formatCurrency(pos.realizedPnl) : '-'}
                        </td>
                        <td className="py-2 text-right">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            pos.isOpen ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                          }`}>
                            {pos.isOpen ? 'Offen' : 'Geschlossen'}
                          </span>
                        </td>
                        <td className="py-2 text-gray-400">
                          {new Date(pos.openedAt).toLocaleDateString('de-DE')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        
        {activeTab === 'history' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Transaktions-Historie ({transactions.length})</h3>
            {transactions.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                Noch keine Transaktionen vorhanden
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div key={tx.id} className="bg-slate-900/50 rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        tx.transactionType === 'buy' ? 'bg-green-500/20 text-green-400' :
                        tx.transactionType === 'sell' || tx.transactionType === 'close' ? 'bg-red-500/20 text-red-400' :
                        tx.transactionType === 'overnight_fee' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {tx.transactionType === 'buy' ? '📈' :
                         tx.transactionType === 'sell' || tx.transactionType === 'close' ? '📉' :
                         tx.transactionType === 'overnight_fee' ? '🌙' :
                         tx.transactionType === 'reset' ? '🔄' : '💰'}
                      </div>
                      <div>
                        <div className="font-medium">
                          {tx.symbol ? `${getSideName(tx.transactionType)} ${tx.symbol}` : 
                           tx.transactionType === 'reset' ? 'Portfolio Reset' :
                           tx.transactionType === 'overnight_fee' ? 'Overnight-Gebühr' :
                           tx.description || tx.transactionType}
                        </div>
                        <div className="text-xs text-gray-400">
                          {tx.quantity && `${tx.quantity}x @ ${formatCurrency(tx.price || 0)}`}
                          {tx.totalFees > 0 && ` • Gebühren: ${formatCurrency(tx.totalFees)}`}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-medium ${
                        (tx.cashImpact || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {tx.cashImpact ? formatCurrency(tx.cashImpact) : '-'}
                      </div>
                      <div className="text-xs text-gray-400">
                        {new Date(tx.executedAt).toLocaleString('de-DE')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {activeTab === 'settings' && portfolio && (
          <div className="space-y-6">
            {/* Startkapital */}
            <div>
              <h3 className="text-lg font-semibold mb-4">💰 Startkapital</h3>
              <div className="bg-slate-900/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm text-gray-400">Aktuelles Startkapital</div>
                    <div className="text-2xl font-bold">{formatCurrency(portfolio.initialCapital)}</div>
                  </div>
                  {!showCapitalChange && (
                    <button
                      onClick={() => {
                        setNewCapital(portfolio.initialCapital.toString());
                        setShowCapitalChange(true);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                      Ändern
                    </button>
                  )}
                </div>
                
                {showCapitalChange && (
                  <div className="border-t border-slate-700 pt-4">
                    <p className="text-sm text-yellow-400 mb-3">
                      ⚠️ Eine Änderung des Startkapitals setzt das Portfolio zurück. Alle Positionen werden geschlossen.
                    </p>
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="block text-sm text-gray-400 mb-1">Neues Startkapital</label>
                        <input
                          type="text"
                          value={newCapital}
                          onChange={(e) => setNewCapital(e.target.value)}
                          placeholder="z.B. 50000"
                          className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:border-blue-500 focus:outline-none"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          Min: 1.000 € • Max: 10.000.000 €
                        </div>
                      </div>
                      <button
                        onClick={handleCapitalChange}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                      >
                        Speichern
                      </button>
                      <button
                        onClick={() => {
                          setShowCapitalChange(false);
                          setNewCapital('');
                        }}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                      >
                        Abbrechen
                      </button>
                    </div>
                    
                    {/* Preset buttons */}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {[1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000].map((amount) => (
                        <button
                          key={amount}
                          onClick={() => setNewCapital(amount.toString())}
                          className={`px-3 py-1 text-sm rounded transition-colors ${
                            newCapital === amount.toString()
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-700 hover:bg-slate-600 text-gray-300'
                          }`}
                        >
                          {amount >= 1000000 ? `${amount / 1000000}M` : `${amount / 1000}k`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Broker-Profil */}
            <div>
              <h3 className="text-lg font-semibold mb-4">🏦 Broker-Profil</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {brokerProfiles && Object.entries(brokerProfiles).map(([id, profile]) => (
                  <button
                    key={id}
                    onClick={() => handleBrokerChange(id as BrokerProfileId)}
                    className={`p-4 rounded-lg text-left transition-colors ${
                      portfolio.brokerProfile === id
                        ? 'bg-blue-600 ring-2 ring-blue-400'
                        : 'bg-slate-900/50 hover:bg-slate-700'
                    }`}
                  >
                    <div className="font-semibold">{profile.name}</div>
                    <div className="text-sm text-gray-400 mt-1">{profile.description}</div>
                    <div className="text-xs text-gray-500 mt-2">
                      Spread: {profile.spreadPercent}% • 
                      Overnight: {profile.cfdOvernight.longRate}%/Tag
                    </div>
                  </button>
                ))}
              </div>
            </div>
            
            <div className="border-t border-slate-700 pt-6">
              <h3 className="text-lg font-semibold mb-4 text-red-400">Gefahrenzone</h3>
              {!showResetConfirm ? (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
                >
                  Portfolio zurücksetzen
                </button>
              ) : (
                <div className="bg-red-500/20 rounded-lg p-4">
                  <p className="text-red-300 mb-3">
                    Möchtest du wirklich das Portfolio zurücksetzen? Alle Positionen werden geschlossen und das Kapital wird auf {formatCurrency(portfolio.initialCapital)} zurückgesetzt.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReset}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                    >
                      Ja, zurücksetzen
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(false)}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PortfolioPage;
