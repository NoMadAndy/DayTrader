/**
 * OptionChainPanel - Interactive Option Chain (Optionskette)
 *
 * Triple-Hybrid Data Sources:
 *   1. 📊 Yahoo Finance — Real US options (bid/ask/volume/OI/IV)
 *   2. 🏦 Emittenten-API — German warrants (SocGen: WKN/ISIN/bid/ask)
 *   3. 🧮 Black-Scholes — Theoretical fallback (always works)
 *
 * Shows a grid of option/warrant prices across multiple strikes and
 * expiry periods. Users can select an option to auto-fill trade
 * parameters in the WatchlistPanel or TradingPortfolioPage.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getOptionChain, getRealOptionChain } from '../services/tradingService';
import { useSettings } from '../contexts/SettingsContext';
import type { OptionChainEntry, OptionChainResult, RealOptionEntry, RealOptionChainResult, OptionDataSource } from '../types/trading';

interface OptionChainPanelProps {
  symbol: string;
  underlyingPrice: number;
  onSelect?: (params: {
    optionType: 'call' | 'put';
    strike: number;
    days: number;
    price: number;
    delta: number;
    volatility: number;
    ratio: number;
  }) => void;
  onClose?: () => void;
}

type ViewTab = 'calls' | 'puts' | 'both';
type GreekDisplay = 'price' | 'delta' | 'theta' | 'leverage';
type DataMode = 'real' | 'theoretical';

const SOURCE_BADGES: Record<OptionDataSource, { icon: string; label: string; color: string }> = {
  yahoo: { icon: '📊', label: 'Yahoo Finance', color: 'bg-purple-500/20 text-purple-300 ring-purple-500/40' },
  emittent: { icon: '🏦', label: 'Emittent', color: 'bg-cyan-500/20 text-cyan-300 ring-cyan-500/40' },
  theoretical: { icon: '🧮', label: 'Theoretisch', color: 'bg-amber-500/20 text-amber-300 ring-amber-500/40' },
};

export function OptionChainPanel({ symbol, underlyingPrice, onSelect, onClose }: OptionChainPanelProps) {
  const { formatCurrency } = useSettings();
  
  // Theoretical chain state (existing)
  const [chainData, setChainData] = useState<OptionChainResult | null>(null);
  
  // Real chain state (new)
  const [realChainData, setRealChainData] = useState<RealOptionChainResult | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>('calls');
  const [greekDisplay, setGreekDisplay] = useState<GreekDisplay>('price');
  const [volatility, setVolatility] = useState(30);
  const [ratio, setRatio] = useState(0.1);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [highlightedStrike, setHighlightedStrike] = useState<number | null>(null);
  
  // Data mode: try real first, fallback to theoretical
  const [dataMode, setDataMode] = useState<DataMode>('real');
  const [forceSource, setForceSource] = useState<OptionDataSource | null>(null);

  // Active data source from loaded data
  const activeSource: OptionDataSource = realChainData?.source || 'theoretical';
  const isRealData = dataMode === 'real' && realChainData != null && realChainData.source !== 'theoretical';

  // Load real chain data
  const loadRealChain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getRealOptionChain({
        symbol,
        underlyingPrice,
        volatility: volatility / 100,
        ratio,
        forceSource,
      });
      if (result.success) {
        setRealChainData(result);
        setChainData(null); // Clear theoretical when real is loaded
        // Default selected expiry
        if (result.expiry_days.length > 1 && !selectedExpiry) {
          setSelectedExpiry(result.expiry_days[1]);
        } else if (result.expiry_days.length > 0 && !selectedExpiry) {
          setSelectedExpiry(result.expiry_days[0]);
        }
      } else {
        // Fallback to theoretical
        setRealChainData(null);
        await loadTheoreticalChain();
      }
    } catch {
      // Fallback to theoretical on error
      setRealChainData(null);
      await loadTheoreticalChain();
    } finally {
      setLoading(false);
    }
  }, [symbol, underlyingPrice, volatility, ratio, forceSource]);

  // Load theoretical chain (existing behavior)
  const loadTheoreticalChain = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getOptionChain({
        underlyingPrice,
        volatility: volatility / 100,
        ratio,
      });
      if (result.success) {
        setChainData(result);
        if (result.expiry_days.length > 1 && !selectedExpiry) {
          setSelectedExpiry(result.expiry_days[1]);
        } else if (result.expiry_days.length > 0 && !selectedExpiry) {
          setSelectedExpiry(result.expiry_days[0]);
        }
      } else {
        setError('Optionskette konnte nicht geladen werden');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  }, [underlyingPrice, volatility, ratio]);

  // Load data on mount / parameter change
  const loadChain = useCallback(async () => {
    if (dataMode === 'real') {
      await loadRealChain();
    } else {
      await loadTheoreticalChain();
    }
  }, [dataMode, loadRealChain, loadTheoreticalChain]);

  useEffect(() => {
    if (underlyingPrice > 0) {
      loadChain();
    }
  }, [loadChain, underlyingPrice]);

  // Unified strikes/expiry_days/calls/puts accessor
  const strikes = useMemo(() => {
    if (realChainData) return realChainData.strikes;
    if (chainData) return chainData.strikes;
    return [];
  }, [realChainData, chainData]);

  const expiryDays = useMemo(() => {
    if (realChainData) return realChainData.expiry_days;
    if (chainData) return chainData.expiry_days;
    return [];
  }, [realChainData, chainData]);

  // Find ATM strike
  const atmStrike = useMemo(() => {
    if (strikes.length === 0) return 0;
    let closest = strikes[0];
    let minDist = Math.abs(strikes[0] - underlyingPrice);
    for (const k of strikes) {
      const dist = Math.abs(k - underlyingPrice);
      if (dist < minDist) {
        minDist = dist;
        closest = k;
      }
    }
    return closest;
  }, [strikes, underlyingPrice]);

  // Filtered entries for selected expiry
  const filteredCalls = useMemo(() => {
    if (!selectedExpiry) return [];
    if (realChainData) return realChainData.calls.filter(c => c.days === selectedExpiry);
    if (chainData) return chainData.calls.filter(c => c.days === selectedExpiry);
    return [];
  }, [realChainData, chainData, selectedExpiry]);

  const filteredPuts = useMemo(() => {
    if (!selectedExpiry) return [];
    if (realChainData) return realChainData.puts.filter(p => p.days === selectedExpiry);
    if (chainData) return chainData.puts.filter(p => p.days === selectedExpiry);
    return [];
  }, [realChainData, chainData, selectedExpiry]);

  // Paired entries for "both" view
  const pairedEntries = useMemo(() => {
    if (!selectedExpiry) return [];
    const callMap = new Map<number, RealOptionEntry | OptionChainEntry>();
    const putMap = new Map<number, RealOptionEntry | OptionChainEntry>();
    for (const c of filteredCalls) callMap.set(c.strike, c);
    for (const p of filteredPuts) putMap.set(p.strike, p);
    return strikes.map(k => ({
      strike: k,
      call: callMap.get(k) || null,
      put: putMap.get(k) || null,
    }));
  }, [strikes, selectedExpiry, filteredCalls, filteredPuts]);

  // Get display value for a cell
  const getCellValue = (entry: RealOptionEntry | OptionChainEntry): string => {
    if (isRealData) {
      const real = entry as RealOptionEntry;
      switch (greekDisplay) {
        case 'price': {
          // Prefer bid/ask midpoint for real data, fallback to lastPrice
          if (real.bid > 0 && real.ask > 0) return ((real.bid + real.ask) / 2).toFixed(2);
          if (real.lastPrice > 0) return real.lastPrice.toFixed(2);
          return '—';
        }
        case 'delta': return real.delta?.toFixed(4) || real.impliedVolatility?.toFixed(2) || '—';
        case 'theta': return real.theta?.toFixed(4) || '—';
        case 'leverage': return real.leverage ? `${real.leverage.toFixed(1)}×` : '—';
        default: return real.lastPrice?.toFixed(2) || '—';
      }
    }
    // Theoretical
    const theo = entry as OptionChainEntry;
    switch (greekDisplay) {
      case 'price': return theo.price > 0 ? theo.price.toFixed(4) : '—';
      case 'delta': return theo.delta.toFixed(4);
      case 'theta': return theo.theta.toFixed(4);
      case 'leverage': return theo.leverage > 0 ? `${theo.leverage.toFixed(1)}×` : '—';
      default: return theo.price.toFixed(4);
    }
  };

  const getMoneynessColor = (moneyness: string) => {
    switch (moneyness) {
      case 'ITM': return 'bg-green-500/15 text-green-300';
      case 'ATM': return 'bg-yellow-500/15 text-yellow-300';
      case 'OTM': return 'bg-slate-800/50 text-gray-400';
      default: return '';
    }
  };

  const handleCellClick = (entry: RealOptionEntry | OptionChainEntry, type: 'call' | 'put') => {
    if (!onSelect) return;
    
    if (isRealData) {
      const real = entry as RealOptionEntry;
      const price = (real.bid > 0 && real.ask > 0) ? (real.bid + real.ask) / 2 : real.lastPrice;
      if (price <= 0) return;
      onSelect({
        optionType: type,
        strike: real.strike,
        days: real.days,
        price,
        delta: real.delta || real.impliedVolatility || 0,
        volatility: real.impliedVolatility || volatility / 100,
        ratio: real.ratio || ratio,
      });
    } else {
      const theo = entry as OptionChainEntry;
      if (theo.price <= 0) return;
      onSelect({
        optionType: type,
        strike: theo.strike,
        days: theo.days,
        price: theo.price,
        delta: theo.delta,
        volatility: volatility / 100,
        ratio,
      });
    }
  };

  // Expiry formatting
  const formatExpiry = (days: number) => {
    if (days < 30) return `${days}T`;
    if (days < 365) return `${Math.round(days / 30)}M`;
    return `${(days / 365).toFixed(1)}J`;
  };

  const formatExpiryDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  // Build cell tooltip
  const getCellTooltip = (entry: RealOptionEntry | OptionChainEntry, type: string): string => {
    if (isRealData) {
      const r = entry as RealOptionEntry;
      const parts = [`${type} Strike ${r.strike}`];
      if (r.bid > 0) parts.push(`Bid: ${r.bid.toFixed(2)}`);
      if (r.ask > 0) parts.push(`Ask: ${r.ask.toFixed(2)}`);
      if (r.volume > 0) parts.push(`Vol: ${r.volume.toLocaleString()}`);
      if (r.openInterest > 0) parts.push(`OI: ${r.openInterest.toLocaleString()}`);
      if (r.impliedVolatility > 0) parts.push(`IV: ${(r.impliedVolatility * 100).toFixed(1)}%`);
      if (r.wkn) parts.push(`WKN: ${r.wkn}`);
      if (r.emittent) parts.push(`Emittent: ${r.emittent}`);
      return parts.join(' | ');
    }
    const t = entry as OptionChainEntry;
    return `${type} Strike ${t.strike}: ${t.price.toFixed(4)} | Δ${t.delta.toFixed(4)} | Θ${t.theta.toFixed(4)} | Hebel ${t.leverage.toFixed(1)}×`;
  };

  // Loading state
  if (loading) {
    return (
      <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-amber-400">⚡ Optionskette — {symbol}</h3>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">×</button>
          )}
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-400"></div>
          <span className="ml-2 text-sm text-gray-400">Lade Optionskette…</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !realChainData && !chainData) {
    return (
      <div className="bg-slate-800/80 rounded-xl p-4 border border-red-500/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-red-400">Fehler</h3>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">×</button>
          )}
        </div>
        <p className="text-xs text-red-300">{error || 'Keine Daten'}</p>
        <button onClick={loadChain} className="mt-2 px-3 py-1 bg-slate-700 rounded text-xs hover:bg-slate-600">
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (!realChainData && !chainData) return null;

  const sourceBadge = SOURCE_BADGES[activeSource];
  const totalCalls = filteredCalls.length;
  const totalPuts = filteredPuts.length;

  return (
    <div className="bg-slate-800/90 rounded-xl border border-amber-500/30 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-slate-900/60 border-b border-slate-700 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-amber-400">⚡ Optionskette</h3>
          <span className="text-xs text-gray-400">{symbol}</span>
          <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded">
            {formatCurrency(underlyingPrice)}
          </span>
          {/* Source badge */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${sourceBadge.color}`}>
            {sourceBadge.icon} {sourceBadge.label}
          </span>
          {realChainData?.cached && (
            <span className="text-[9px] px-1 py-0.5 bg-slate-700/50 text-gray-500 rounded">cached</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Data mode toggle */}
          <div className="flex gap-0.5 bg-slate-900/50 rounded p-0.5">
            <button
              onClick={() => { setDataMode('real'); setForceSource(null); }}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                dataMode === 'real' ? 'bg-purple-500/30 text-purple-300' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              📊 Real
            </button>
            <button
              onClick={() => { setDataMode('theoretical'); setRealChainData(null); }}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                dataMode === 'theoretical' ? 'bg-amber-500/30 text-amber-300' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              🧮 BS
            </button>
          </div>
          {/* Volatility & Ratio — only for theoretical mode */}
          {dataMode === 'theoretical' && (
            <>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500">IV%</span>
                <input
                  type="number"
                  value={volatility}
                  onChange={(e) => setVolatility(Math.max(5, Math.min(200, parseInt(e.target.value) || 30)))}
                  className="w-12 px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-[10px] text-center focus:border-amber-500 focus:outline-none"
                  min={5} max={200} step={5}
                />
              </div>
              <select
                value={ratio}
                onChange={(e) => setRatio(parseFloat(e.target.value))}
                className="px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-[10px] focus:border-amber-500 focus:outline-none"
              >
                <option value={1}>1:1</option>
                <option value={0.1}>0,1</option>
                <option value={0.01}>0,01</option>
              </select>
            </>
          )}
          <button onClick={loadChain} className="px-1.5 py-0.5 bg-amber-600/30 text-amber-300 rounded text-[10px] hover:bg-amber-600/50">
            ↻
          </button>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
          )}
        </div>
      </div>

      {/* Tab bar: Calls / Puts / Both + display selector */}
      <div className="px-3 py-1.5 border-b border-slate-700/50 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          {(['calls', 'puts', 'both'] as ViewTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setViewTab(tab)}
              className={`px-2.5 py-1 rounded text-[10px] sm:text-xs font-medium transition-colors ${
                viewTab === tab
                  ? tab === 'calls' ? 'bg-green-600/30 text-green-300 ring-1 ring-green-500/50'
                    : tab === 'puts' ? 'bg-red-600/30 text-red-300 ring-1 ring-red-500/50'
                    : 'bg-blue-600/30 text-blue-300 ring-1 ring-blue-500/50'
                  : 'bg-slate-700/50 text-gray-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {tab === 'calls' ? '📈 Calls' : tab === 'puts' ? '📉 Puts' : '⟷ Beide'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([
            { key: 'price', label: isRealData ? 'Bid/Ask' : 'Preis' },
            { key: 'delta', label: isRealData ? 'IV%' : 'Δ Delta' },
            { key: 'theta', label: 'Θ Theta' },
            { key: 'leverage', label: 'Hebel' },
          ] as { key: GreekDisplay; label: string }[]).map(g => (
            <button
              key={g.key}
              onClick={() => setGreekDisplay(g.key)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                greekDisplay === g.key
                  ? 'bg-amber-500/30 text-amber-300'
                  : 'bg-slate-700/30 text-gray-500 hover:text-gray-300'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Expiry tabs */}
      <div className="px-3 py-1.5 border-b border-slate-700/50 flex items-center gap-1 overflow-x-auto">
        <span className="text-[10px] text-gray-500 mr-1 shrink-0">Verfall:</span>
        {expiryDays.map(days => (
          <button
            key={days}
            onClick={() => setSelectedExpiry(days)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
              selectedExpiry === days
                ? 'bg-amber-500/30 text-amber-300 ring-1 ring-amber-500/50'
                : 'bg-slate-700/30 text-gray-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {formatExpiry(days)}
            <span className="hidden sm:inline text-gray-500 ml-1">({formatExpiryDate(days)})</span>
          </button>
        ))}
      </div>

      {/* Chain Table */}
      <div className="max-h-[400px] overflow-auto">
        {viewTab === 'both' ? (
          /* ===== Combined Call + Put view ===== */
          <table className="w-full text-[10px] sm:text-xs">
            <thead className="sticky top-0 bg-slate-900/95 z-10">
              <tr>
                {isRealData && <th className="px-1 py-1.5 text-right text-green-400/60 font-medium hidden sm:table-cell">Vol</th>}
                <th className="px-2 py-1.5 text-right text-green-400 font-medium">
                  Call {greekDisplay === 'price' ? (isRealData ? 'Mid' : 'Preis') : greekDisplay === 'delta' ? (isRealData ? 'IV' : 'Δ') : greekDisplay === 'theta' ? 'Θ' : 'Hebel'}
                </th>
                <th className="px-2 py-1.5 text-center text-amber-400 font-bold">Strike</th>
                <th className="px-2 py-1.5 text-left text-red-400 font-medium">
                  Put {greekDisplay === 'price' ? (isRealData ? 'Mid' : 'Preis') : greekDisplay === 'delta' ? (isRealData ? 'IV' : 'Δ') : greekDisplay === 'theta' ? 'Θ' : 'Hebel'}
                </th>
                {isRealData && <th className="px-1 py-1.5 text-left text-red-400/60 font-medium hidden sm:table-cell">Vol</th>}
              </tr>
            </thead>
            <tbody>
              {pairedEntries.map(({ strike, call, put }) => {
                const isAtm = strike === atmStrike;
                return (
                  <tr
                    key={strike}
                    className={`border-b border-slate-800/50 transition-colors ${
                      isAtm ? 'bg-amber-500/10 border-amber-500/30' :
                      highlightedStrike === strike ? 'bg-slate-700/30' : 'hover:bg-slate-700/20'
                    }`}
                    onMouseEnter={() => setHighlightedStrike(strike)}
                    onMouseLeave={() => setHighlightedStrike(null)}
                  >
                    {/* Call volume */}
                    {isRealData && (
                      <td className="px-1 py-1.5 text-right text-gray-500 hidden sm:table-cell">
                        {call && (call as RealOptionEntry).volume > 0 ? (call as RealOptionEntry).volume.toLocaleString() : '—'}
                      </td>
                    )}
                    {/* Call value */}
                    <td
                      className={`px-2 py-1.5 text-right cursor-pointer ${call ? getMoneynessColor(call.moneyness) : 'text-gray-600'}`}
                      onClick={() => call && handleCellClick(call, 'call')}
                      title={call ? getCellTooltip(call, 'Call') : ''}
                    >
                      {call ? getCellValue(call) : '—'}
                    </td>
                    {/* Strike */}
                    <td className={`px-2 py-1.5 text-center font-bold ${isAtm ? 'text-amber-300' : 'text-gray-300'}`}>
                      {strike.toFixed(strike >= 100 ? 0 : 2)}
                      {isAtm && <span className="ml-1 text-[8px] text-amber-500">ATM</span>}
                    </td>
                    {/* Put value */}
                    <td
                      className={`px-2 py-1.5 text-left cursor-pointer ${put ? getMoneynessColor(put.moneyness) : 'text-gray-600'}`}
                      onClick={() => put && handleCellClick(put, 'put')}
                      title={put ? getCellTooltip(put, 'Put') : ''}
                    >
                      {put ? getCellValue(put) : '—'}
                    </td>
                    {/* Put volume */}
                    {isRealData && (
                      <td className="px-1 py-1.5 text-left text-gray-500 hidden sm:table-cell">
                        {put && (put as RealOptionEntry).volume > 0 ? (put as RealOptionEntry).volume.toLocaleString() : '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          /* ===== Single Calls or Puts view ===== */
          <table className="w-full text-[10px] sm:text-xs">
            <thead className="sticky top-0 bg-slate-900/95 z-10">
              <tr className="text-gray-400">
                <th className="px-2 py-1.5 text-left font-medium">Strike</th>
                {isRealData ? (
                  <>
                    <th className="px-2 py-1.5 text-right font-medium">Bid</th>
                    <th className="px-2 py-1.5 text-right font-medium">Ask</th>
                    <th className="px-2 py-1.5 text-right font-medium hidden sm:table-cell">Letzter</th>
                    <th className="px-2 py-1.5 text-right font-medium hidden sm:table-cell">Vol</th>
                    <th className="px-2 py-1.5 text-right font-medium hidden md:table-cell">OI</th>
                    <th className="px-2 py-1.5 text-right font-medium hidden md:table-cell">IV%</th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-1.5 text-right font-medium">Preis</th>
                    <th className="px-2 py-1.5 text-right font-medium">Innerer W.</th>
                    <th className="px-2 py-1.5 text-right font-medium">Zeitwert</th>
                    <th className="px-2 py-1.5 text-right font-medium hidden sm:table-cell">Δ Delta</th>
                    <th className="px-2 py-1.5 text-right font-medium hidden sm:table-cell">Θ Theta</th>
                    <th className="px-2 py-1.5 text-right font-medium hidden md:table-cell">Hebel</th>
                  </>
                )}
                <th className="px-2 py-1.5 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(viewTab === 'calls' ? filteredCalls : filteredPuts).map((entry) => {
                const isAtm = entry.strike === atmStrike;
                return (
                  <tr
                    key={entry.strike}
                    className={`border-b border-slate-800/50 cursor-pointer transition-colors ${
                      isAtm ? 'bg-amber-500/10 border-amber-500/30' :
                      highlightedStrike === entry.strike ? 'bg-slate-700/30' : 'hover:bg-slate-700/20'
                    }`}
                    onClick={() => handleCellClick(entry, viewTab === 'calls' ? 'call' : 'put')}
                    onMouseEnter={() => setHighlightedStrike(entry.strike)}
                    onMouseLeave={() => setHighlightedStrike(null)}
                    title={getCellTooltip(entry, viewTab === 'calls' ? 'Call' : 'Put')}
                  >
                    <td className={`px-2 py-1.5 font-bold ${isAtm ? 'text-amber-300' : 'text-gray-200'}`}>
                      {entry.strike.toFixed(entry.strike >= 100 ? 0 : 2)}
                      {isAtm && <span className="ml-1 text-[8px] text-amber-500">ATM</span>}
                    </td>
                    {isRealData ? (
                      <>
                        {/* Real data columns: Bid, Ask, Last, Volume, OI, IV */}
                        <td className={`px-2 py-1.5 text-right font-medium ${getMoneynessColor(entry.moneyness)}`}>
                          {(entry as RealOptionEntry).bid > 0 ? (entry as RealOptionEntry).bid.toFixed(2) : '—'}
                        </td>
                        <td className={`px-2 py-1.5 text-right font-medium ${getMoneynessColor(entry.moneyness)}`}>
                          {(entry as RealOptionEntry).ask > 0 ? (entry as RealOptionEntry).ask.toFixed(2) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-300 hidden sm:table-cell">
                          {(entry as RealOptionEntry).lastPrice > 0 ? (entry as RealOptionEntry).lastPrice.toFixed(2) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-blue-300 hidden sm:table-cell">
                          {(entry as RealOptionEntry).volume > 0 ? (entry as RealOptionEntry).volume.toLocaleString() : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-purple-300 hidden md:table-cell">
                          {(entry as RealOptionEntry).openInterest > 0 ? (entry as RealOptionEntry).openInterest.toLocaleString() : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-orange-300 hidden md:table-cell">
                          {(entry as RealOptionEntry).impliedVolatility > 0 ? `${((entry as RealOptionEntry).impliedVolatility * 100).toFixed(1)}%` : '—'}
                        </td>
                      </>
                    ) : (
                      <>
                        {/* Theoretical columns: Price, Intrinsic, Time Value, Delta, Theta, Leverage */}
                        <td className={`px-2 py-1.5 text-right font-medium ${getMoneynessColor(entry.moneyness)}`}>
                          {(entry as OptionChainEntry).price > 0 ? (entry as OptionChainEntry).price.toFixed(4) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-400">
                          {(entry as OptionChainEntry).intrinsic > 0 ? (entry as OptionChainEntry).intrinsic.toFixed(4) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-blue-300">
                          {(entry as OptionChainEntry).timeValue > 0 ? (entry as OptionChainEntry).timeValue.toFixed(4) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right hidden sm:table-cell text-gray-300">
                          {(entry as OptionChainEntry).delta.toFixed(4)}
                        </td>
                        <td className="px-2 py-1.5 text-right hidden sm:table-cell text-orange-300">
                          {(entry as OptionChainEntry).theta.toFixed(4)}
                        </td>
                        <td className="px-2 py-1.5 text-right hidden md:table-cell text-purple-300">
                          {(entry as OptionChainEntry).leverage > 0 ? `${(entry as OptionChainEntry).leverage.toFixed(1)}×` : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-2 py-1.5 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        entry.moneyness === 'ITM' ? 'bg-green-500/20 text-green-400' :
                        entry.moneyness === 'ATM' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-gray-500/20 text-gray-500'
                      }`}>
                        {entry.moneyness}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 bg-slate-900/40 border-t border-slate-700/50 text-[10px] text-gray-500 flex items-center justify-between flex-wrap gap-1">
        <span className="hidden sm:inline">Klicke auf einen Warrant → Automatisch in Trade-Formular</span>
        <span className="sm:hidden">Tippe → Trade-Formular</span>
        <div className="flex items-center gap-2">
          {isRealData && realChainData?.source_priority && (
            <span className="text-[9px]">
              Quellen: {realChainData.source_priority.map(s => {
                const b = SOURCE_BADGES[s as OptionDataSource];
                return b ? `${s === activeSource ? '✓' : '✗'}${b.icon}` : s;
              }).join(' → ')}
            </span>
          )}
          <span>{strikes.length} Strikes × {expiryDays.length} Laufzeiten | {totalCalls + totalPuts} Einträge</span>
        </div>
      </div>
    </div>
  );
}
