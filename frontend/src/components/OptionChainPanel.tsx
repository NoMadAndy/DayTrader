/**
 * OptionChainPanel - Interactive Option Chain (Optionskette)
 *
 * Shows a grid of theoretical warrant prices across multiple
 * strikes and expiry periods. Users can select a warrant to
 * auto-fill trade parameters in the WatchlistPanel.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getOptionChain } from '../services/tradingService';
import { useSettings } from '../contexts/SettingsContext';
import type { OptionChainEntry, OptionChainResult } from '../types/trading';

interface OptionChainPanelProps {
  symbol: string;
  underlyingPrice: number;
  onSelect?: (params: {
    optionType: 'call' | 'put';
    strike: number;
    days: number;
    price: number;
    delta: number;
  }) => void;
  onClose?: () => void;
}

type ViewTab = 'calls' | 'puts' | 'both';
type GreekDisplay = 'price' | 'delta' | 'theta' | 'leverage';

export function OptionChainPanel({ symbol, underlyingPrice, onSelect, onClose }: OptionChainPanelProps) {
  const { formatCurrency } = useSettings();
  const [chainData, setChainData] = useState<OptionChainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>('calls');
  const [greekDisplay, setGreekDisplay] = useState<GreekDisplay>('price');
  const [volatility, setVolatility] = useState(30);
  const [ratio, setRatio] = useState(0.1);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [highlightedStrike, setHighlightedStrike] = useState<number | null>(null);

  const loadChain = useCallback(async () => {
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
        // Default selected expiry to the 2nd period (usually 30 days)
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

  useEffect(() => {
    if (underlyingPrice > 0) {
      loadChain();
    }
  }, [loadChain, underlyingPrice]);

  // Find ATM strike index (closest to underlying price)
  const atmStrike = useMemo(() => {
    if (!chainData) return 0;
    let closest = chainData.strikes[0];
    let minDist = Math.abs(chainData.strikes[0] - underlyingPrice);
    for (const k of chainData.strikes) {
      const dist = Math.abs(k - underlyingPrice);
      if (dist < minDist) {
        minDist = dist;
        closest = k;
      }
    }
    return closest;
  }, [chainData, underlyingPrice]);

  // Filter entries for the selected expiry
  const filteredCalls = useMemo(() => {
    if (!chainData || !selectedExpiry) return [];
    return chainData.calls.filter(c => c.days === selectedExpiry);
  }, [chainData, selectedExpiry]);

  const filteredPuts = useMemo(() => {
    if (!chainData || !selectedExpiry) return [];
    return chainData.puts.filter(p => p.days === selectedExpiry);
  }, [chainData, selectedExpiry]);

  // Group by strike for "both" view
  const pairedEntries = useMemo(() => {
    if (!chainData || !selectedExpiry) return [];
    const callMap = new Map(filteredCalls.map(c => [c.strike, c]));
    const putMap = new Map(filteredPuts.map(p => [p.strike, p]));
    return chainData.strikes.map(k => ({
      strike: k,
      call: callMap.get(k) || null,
      put: putMap.get(k) || null,
    }));
  }, [chainData, selectedExpiry, filteredCalls, filteredPuts]);

  const getCellValue = (entry: OptionChainEntry): string => {
    switch (greekDisplay) {
      case 'price': return entry.price > 0 ? entry.price.toFixed(4) : '—';
      case 'delta': return entry.delta.toFixed(4);
      case 'theta': return entry.theta.toFixed(4);
      case 'leverage': return entry.leverage > 0 ? `${entry.leverage.toFixed(1)}×` : '—';
      default: return entry.price.toFixed(4);
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

  const handleCellClick = (entry: OptionChainEntry, type: 'call' | 'put') => {
    if (onSelect && entry.price > 0) {
      onSelect({
        optionType: type,
        strike: entry.strike,
        days: entry.days,
        price: entry.price,
        delta: entry.delta,
      });
    }
  };

  // Expiry label
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
          <span className="ml-2 text-sm text-gray-400">Berechne Optionskette…</span>
        </div>
      </div>
    );
  }

  if (error || !chainData) {
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

  return (
    <div className="bg-slate-800/90 rounded-xl border border-amber-500/30 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-slate-900/60 border-b border-slate-700 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-amber-400">⚡ Optionskette</h3>
          <span className="text-xs text-gray-400">{symbol}</span>
          <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded">
            {formatCurrency(underlyingPrice)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Volatility input */}
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
          {/* Ratio selector */}
          <select
            value={ratio}
            onChange={(e) => setRatio(parseFloat(e.target.value))}
            className="px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-[10px] focus:border-amber-500 focus:outline-none"
          >
            <option value={1}>1:1</option>
            <option value={0.1}>0,1</option>
            <option value={0.01}>0,01</option>
          </select>
          <button onClick={loadChain} className="px-1.5 py-0.5 bg-amber-600/30 text-amber-300 rounded text-[10px] hover:bg-amber-600/50">
            ↻
          </button>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
          )}
        </div>
      </div>

      {/* Tab bar: Calls / Puts / Both + Greek selector */}
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
            { key: 'price', label: 'Preis' },
            { key: 'delta', label: 'Δ Delta' },
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
        {chainData.expiry_days.map(days => (
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
          /* Combined Call + Put view */
          <table className="w-full text-[10px] sm:text-xs">
            <thead className="sticky top-0 bg-slate-900/95 z-10">
              <tr>
                <th className="px-2 py-1.5 text-right text-green-400 font-medium">Call {greekDisplay === 'price' ? 'Preis' : greekDisplay === 'delta' ? 'Δ' : greekDisplay === 'theta' ? 'Θ' : 'Hebel'}</th>
                <th className="px-2 py-1.5 text-center text-amber-400 font-bold">Strike</th>
                <th className="px-2 py-1.5 text-left text-red-400 font-medium">Put {greekDisplay === 'price' ? 'Preis' : greekDisplay === 'delta' ? 'Δ' : greekDisplay === 'theta' ? 'Θ' : 'Hebel'}</th>
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
                    {/* Call side */}
                    <td
                      className={`px-2 py-1.5 text-right cursor-pointer ${call ? getMoneynessColor(call.moneyness) : 'text-gray-600'}`}
                      onClick={() => call && handleCellClick(call, 'call')}
                      title={call ? `Call Strike ${strike}: ${call.price.toFixed(4)} | Δ${call.delta.toFixed(4)} | Θ${call.theta.toFixed(4)} | Hebel ${call.leverage.toFixed(1)}×` : ''}
                    >
                      {call ? getCellValue(call) : '—'}
                    </td>
                    {/* Strike */}
                    <td className={`px-2 py-1.5 text-center font-bold ${isAtm ? 'text-amber-300' : 'text-gray-300'}`}>
                      {strike.toFixed(strike >= 100 ? 0 : 2)}
                      {isAtm && <span className="ml-1 text-[8px] text-amber-500">ATM</span>}
                    </td>
                    {/* Put side */}
                    <td
                      className={`px-2 py-1.5 text-left cursor-pointer ${put ? getMoneynessColor(put.moneyness) : 'text-gray-600'}`}
                      onClick={() => put && handleCellClick(put, 'put')}
                      title={put ? `Put Strike ${strike}: ${put.price.toFixed(4)} | Δ${put.delta.toFixed(4)} | Θ${put.theta.toFixed(4)} | Hebel ${put.leverage.toFixed(1)}×` : ''}
                    >
                      {put ? getCellValue(put) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          /* Single Calls or Puts view */
          <table className="w-full text-[10px] sm:text-xs">
            <thead className="sticky top-0 bg-slate-900/95 z-10">
              <tr className="text-gray-400">
                <th className="px-2 py-1.5 text-left font-medium">Strike</th>
                <th className="px-2 py-1.5 text-right font-medium">Preis</th>
                <th className="px-2 py-1.5 text-right font-medium">Innerer W.</th>
                <th className="px-2 py-1.5 text-right font-medium">Zeitwert</th>
                <th className="px-2 py-1.5 text-right font-medium hidden sm:table-cell">Δ Delta</th>
                <th className="px-2 py-1.5 text-right font-medium hidden sm:table-cell">Θ Theta</th>
                <th className="px-2 py-1.5 text-right font-medium hidden md:table-cell">Hebel</th>
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
                  >
                    <td className={`px-2 py-1.5 font-bold ${isAtm ? 'text-amber-300' : 'text-gray-200'}`}>
                      {entry.strike.toFixed(entry.strike >= 100 ? 0 : 2)}
                      {isAtm && <span className="ml-1 text-[8px] text-amber-500">ATM</span>}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-medium ${getMoneynessColor(entry.moneyness)}`}>
                      {entry.price > 0 ? entry.price.toFixed(4) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-400">
                      {entry.intrinsic > 0 ? entry.intrinsic.toFixed(4) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right text-blue-300">
                      {entry.timeValue > 0 ? entry.timeValue.toFixed(4) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right hidden sm:table-cell text-gray-300">
                      {entry.delta.toFixed(4)}
                    </td>
                    <td className="px-2 py-1.5 text-right hidden sm:table-cell text-orange-300">
                      {entry.theta.toFixed(4)}
                    </td>
                    <td className="px-2 py-1.5 text-right hidden md:table-cell text-purple-300">
                      {entry.leverage > 0 ? `${entry.leverage.toFixed(1)}×` : '—'}
                    </td>
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

      {/* Footer hint */}
      <div className="px-3 py-1.5 bg-slate-900/40 border-t border-slate-700/50 text-[10px] text-gray-500 flex items-center justify-between">
        <span>Klicke auf einen Warrant → Automatisch in Trade-Formular übernommen</span>
        <span>{chainData.strikes.length} Strikes × {chainData.expiry_days.length} Laufzeiten</span>
      </div>
    </div>
  );
}
