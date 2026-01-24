/**
 * Company Info Panel Component
 * 
 * Displays detailed company information:
 * - Name, Symbol, Exchange
 * - Current price in EUR (and USD)
 * - 52-Week Range
 * - Volume
 */

import { useState, useEffect } from 'react';
import { 
  fetchCompanyInfo, 
  formatCurrency, 
  formatPercent, 
  type CompanyInfo 
} from '../services/companyInfoService';

interface CompanyInfoPanelProps {
  symbol: string;
}

export function CompanyInfoPanel({ symbol }: CompanyInfoPanelProps) {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function loadCompanyInfo() {
      setIsLoading(true);
      setError(null);
      
      try {
        const info = await fetchCompanyInfo(symbol);
        if (isMounted) {
          if (info) {
            setCompanyInfo(info);
          } else {
            setError('Keine Daten verfügbar');
          }
        }
      } catch (err) {
        if (isMounted) {
          setError('Fehler beim Laden');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    
    loadCompanyInfo();
    
    return () => {
      isMounted = false;
    };
  }, [symbol]);

  if (isLoading) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <div className="animate-pulse space-y-3">
          <div className="h-6 bg-slate-700 rounded w-1/3" />
          <div className="h-10 bg-slate-700 rounded w-1/2" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="h-16 bg-slate-700 rounded" />
            <div className="h-16 bg-slate-700 rounded" />
            <div className="h-16 bg-slate-700 rounded" />
            <div className="h-16 bg-slate-700 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !companyInfo) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <p className="text-gray-400 text-sm">{error || 'Keine Daten'}</p>
      </div>
    );
  }

  const isPositive = companyInfo.changePercent >= 0;

  // Format volume for display
  const formatVolume = (vol?: number): string => {
    if (!vol) return '—';
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)} Mrd.`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)} Mio.`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)} Tsd.`;
    return vol.toLocaleString('de-DE');
  };

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 space-y-4">
      {/* Header: Name & Symbol */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg sm:text-xl font-bold text-white truncate" title={companyInfo.name}>
            {companyInfo.name}
          </h2>
          <div className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
            <span className="font-mono">{companyInfo.symbol}</span>
            {companyInfo.exchange && (
              <>
                <span>•</span>
                <span>{companyInfo.exchange}</span>
              </>
            )}
          </div>
        </div>
        
        {/* Price in EUR */}
        <div className="text-right flex-shrink-0">
          <div className="text-xl sm:text-2xl font-bold text-white">
            {formatCurrency(companyInfo.priceEUR, 'EUR')}
          </div>
          <div className={`text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {formatPercent(companyInfo.changePercent)}
            <span className="text-gray-500 ml-1">
              ({isPositive ? '+' : ''}{formatCurrency(companyInfo.changeAbsolute * (companyInfo.priceEUR / companyInfo.priceUSD), 'EUR')})
            </span>
          </div>
          <div className="text-xs text-gray-500">
            ≈ {formatCurrency(companyInfo.priceUSD, 'USD')}
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {/* 52-Week Range */}
        <div className="bg-slate-900/50 rounded-lg p-2.5 sm:p-3 col-span-2">
          <div className="text-xs text-gray-400 mb-1">52-Wochen Bereich</div>
          {companyInfo.fiftyTwoWeekLow && companyInfo.fiftyTwoWeekHigh ? (
            <>
              <div className="flex justify-between text-sm font-semibold text-white mb-1">
                <span>{formatCurrency(companyInfo.fiftyTwoWeekLow, 'USD')}</span>
                <span>{formatCurrency(companyInfo.fiftyTwoWeekHigh, 'USD')}</span>
              </div>
              {/* Position indicator */}
              <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="absolute h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 opacity-30"
                  style={{ width: '100%' }}
                />
                <div 
                  className="absolute h-full w-2 bg-blue-500 rounded-full transform -translate-x-1/2"
                  style={{
                    left: `${Math.min(100, Math.max(0, 
                      ((companyInfo.priceUSD - companyInfo.fiftyTwoWeekLow) / 
                      (companyInfo.fiftyTwoWeekHigh - companyInfo.fiftyTwoWeekLow)) * 100
                    ))}%`
                  }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1 text-center">
                Aktuell: {formatCurrency(companyInfo.priceUSD, 'USD')}
              </div>
            </>
          ) : (
            <div className="text-sm font-semibold text-white">—</div>
          )}
        </div>

        {/* Volume */}
        <div className="bg-slate-900/50 rounded-lg p-2.5 sm:p-3">
          <div className="text-xs text-gray-400 mb-1">Volumen (heute)</div>
          <div className="text-sm sm:text-base font-semibold text-white">
            {formatVolume(companyInfo.volume)}
          </div>
        </div>

        {/* Day Range */}
        <div className="bg-slate-900/50 rounded-lg p-2.5 sm:p-3">
          <div className="text-xs text-gray-400 mb-1">Währung</div>
          <div className="text-sm sm:text-base font-semibold text-white">
            {companyInfo.currency}
          </div>
          <div className="text-xs text-gray-500">
            Originale Notierung
          </div>
        </div>
      </div>

      {/* Info note */}
      <div className="text-xs text-gray-500 pt-2 border-t border-slate-700/50">
        💱 Preise in EUR umgerechnet zum aktuellen Wechselkurs
      </div>
    </div>
  );
}
