/**
 * Company Info Panel Component
 * 
 * Displays detailed company information aggregated from multiple providers:
 * - Name, Symbol, Exchange
 * - Instrument Type (Stock, ETF, Warrant, Certificate, etc.)
 * - Identifiers (ISIN, WKN, CUSIP)
 * - Current price in EUR (and USD)
 * - 52-Week Range
 * - Market Cap, P/E (KGV), Dividend Yield
 * - Industry, Country
 * - Derivative-specific info (leverage, knockout, etc.)
 * - Data sources indicator
 */

import { useState, useEffect } from 'react';
import { 
  fetchCompanyInfo, 
  formatPercent,
  formatPE,
  type CompanyInfo 
} from '../services/companyInfoService';
import { useSettings } from '../contexts/SettingsContext';

interface CompanyInfoPanelProps {
  symbol: string;
}

export function CompanyInfoPanel({ symbol }: CompanyInfoPanelProps) {
  const { t, formatCurrency, language, currency } = useSettings();
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Format market cap with currency conversion
  const formatMarketCapValue = (value?: number): string => {
    if (!value) return '—';
    // Convert if needed (original value is in USD)
    const converted = currency === 'EUR' ? value * 0.92 : value;
    const symbol = currency === 'EUR' ? '€' : '$';
    
    if (converted >= 1e12) return `${symbol}${(converted / 1e12).toFixed(2)} ${t('marketCap.trillion')}`;
    if (converted >= 1e9) return `${symbol}${(converted / 1e9).toFixed(2)} ${t('marketCap.billion')}`;
    if (converted >= 1e6) return `${symbol}${(converted / 1e6).toFixed(2)} ${t('marketCap.million')}`;
    if (converted >= 1e3) return `${symbol}${(converted / 1e3).toFixed(0)} ${t('marketCap.thousand')}`;
    return `${symbol}${converted.toLocaleString(language === 'de' ? 'de-DE' : 'en-US')}`;
  };

  // Format volume with localized suffixes
  const formatVolume = (vol?: number): string => {
    if (!vol) return '—';
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)} ${t('marketCap.billion')}`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)} ${t('marketCap.million')}`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)} ${t('marketCap.thousand')}`;
    return vol.toLocaleString(language === 'de' ? 'de-DE' : 'en-US');
  };

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
            setError(t('company.noData'));
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(t('company.loadError'));
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
  }, [symbol, t]);

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
        <p className="text-gray-400 text-sm">{error || t('company.noData')}</p>
      </div>
    );
  }

  const isPositive = companyInfo.changePercent >= 0;

  // Get instrument type styling
  const getInstrumentTypeStyle = (type?: CompanyInfo['instrumentType']) => {
    switch (type) {
      case 'stock':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'etf':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'warrant':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'certificate':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'future':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'cfd':
        return 'bg-pink-500/20 text-pink-400 border-pink-500/30';
      case 'option':
        return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
      case 'bond':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  // Get instrument type icon
  const getInstrumentTypeIcon = (type?: CompanyInfo['instrumentType']) => {
    switch (type) {
      case 'stock': return '📈';
      case 'etf': return '📊';
      case 'warrant': return '⚡';
      case 'certificate': return '📜';
      case 'future': return '📅';
      case 'cfd': return '🔄';
      case 'option': return '🎯';
      case 'bond': return '💵';
      default: return '❓';
    }
  };

  // Check if it's a derivative or leveraged instrument
  const isDerivative = ['warrant', 'certificate', 'future', 'cfd', 'option'].includes(companyInfo.instrumentType || '');
  const isLeveraged = companyInfo.leverage && companyInfo.leverage > 1;
  const showDerivativeWarning = isDerivative || isLeveraged;

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 space-y-4">
      {/* Header: Name, Symbol & Instrument Type */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-lg sm:text-xl font-bold text-white truncate" title={companyInfo.name}>
              {companyInfo.name}
            </h2>
            {/* Instrument Type Badge */}
            {companyInfo.instrumentType && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${getInstrumentTypeStyle(companyInfo.instrumentType)}`}>
                <span>{getInstrumentTypeIcon(companyInfo.instrumentType)}</span>
                <span>{companyInfo.instrumentTypeLabel}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
            <span className="font-mono">{companyInfo.symbol}</span>
            {companyInfo.exchange && (
              <>
                <span>•</span>
                <span>{companyInfo.exchange}</span>
              </>
            )}
            {companyInfo.country && (
              <>
                <span>•</span>
                <span>{companyInfo.country}</span>
              </>
            )}
          </div>
          {companyInfo.industry && (
            <div className="text-xs text-gray-500 mt-1">
              {companyInfo.sector && `${companyInfo.sector} / `}{companyInfo.industry}
            </div>
          )}
        </div>
        
        {/* Price */}
        <div className="text-right flex-shrink-0">
          <div className="text-xl sm:text-2xl font-bold text-white">
            {formatCurrency(companyInfo.priceUSD)}
          </div>
          <div className={`text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {formatPercent(companyInfo.changePercent)}
            <span className="text-gray-500 ml-1">
              ({isPositive ? '+' : ''}{formatCurrency(companyInfo.changeAbsolute)})
            </span>
          </div>
        </div>
      </div>

      {/* Identifiers Row: ISIN, WKN, CUSIP */}
      {(companyInfo.isin || companyInfo.wkn || companyInfo.cusip) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {companyInfo.isin && (
            <div className="bg-slate-900/50 rounded px-2 py-1">
              <span className="text-gray-500">ISIN: </span>
              <span className="font-mono text-gray-300">{companyInfo.isin}</span>
            </div>
          )}
          {companyInfo.wkn && (
            <div className="bg-slate-900/50 rounded px-2 py-1">
              <span className="text-gray-500">WKN: </span>
              <span className="font-mono text-gray-300">{companyInfo.wkn}</span>
            </div>
          )}
          {companyInfo.cusip && (
            <div className="bg-slate-900/50 rounded px-2 py-1">
              <span className="text-gray-500">CUSIP: </span>
              <span className="font-mono text-gray-300">{companyInfo.cusip}</span>
            </div>
          )}
        </div>
      )}

      {/* Derivative/Leveraged Product Warning */}
      {showDerivativeWarning && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-orange-400 text-sm font-medium mb-2">
            <span>⚠️</span>
            <span>{isDerivative ? t('company.derivative') : t('company.leveraged')}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {companyInfo.leverage && (
              <div>
                <span className="text-gray-500">{t('company.leverage')}: </span>
                <span className="text-white font-semibold">{companyInfo.leverage}x</span>
              </div>
            )}
            {companyInfo.knockoutLevel && (
              <div>
                <span className="text-gray-500">{t('company.knockout')}: </span>
                <span className="text-red-400 font-semibold">{formatCurrency(companyInfo.knockoutLevel)}</span>
              </div>
            )}
            {companyInfo.strikePrice && (
              <div>
                <span className="text-gray-500">{t('company.strike')}: </span>
                <span className="text-white font-semibold">{formatCurrency(companyInfo.strikePrice)}</span>
              </div>
            )}
            {companyInfo.expirationDate && (
              <div>
                <span className="text-gray-500">{t('company.expiration')}: </span>
                <span className="text-yellow-400 font-semibold">{companyInfo.expirationDate}</span>
              </div>
            )}
            {companyInfo.underlyingSymbol && (
              <div>
                <span className="text-gray-500">{t('company.underlying')}: </span>
                <span className="text-blue-400 font-semibold">{companyInfo.underlyingSymbol}</span>
              </div>
            )}
            {companyInfo.overnightFee !== undefined && companyInfo.overnightFee > 0 && (
              <div>
                <span className="text-gray-500">{t('company.overnight')}: </span>
                <span className="text-yellow-400 font-semibold">~{(companyInfo.overnightFee * 365).toFixed(1)}% p.a.</span>
              </div>
            )}
            {companyInfo.spreadPercent !== undefined && companyInfo.spreadPercent > 0 && (
              <div>
                <span className="text-gray-500">{t('company.spread')}: </span>
                <span className="text-white font-semibold">~{companyInfo.spreadPercent.toFixed(2)}%</span>
              </div>
            )}
          </div>
          <div className="text-xs text-orange-400/70 mt-2">
            {isDerivative 
              ? `⚡ ${t('company.derivativeWarning')}`
              : `⚡ ${t('company.leveragedWarning')}`}
          </div>
        </div>
      )}

      {/* Key Financials Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {/* Market Cap */}
        <div className="bg-slate-900/50 rounded-lg p-2.5 sm:p-3">
          <div className="text-xs text-gray-400 mb-1">{t('company.marketCap')}</div>
          <div className="text-sm sm:text-base font-semibold text-white">
            {companyInfo.marketCapUSD ? formatMarketCapValue(companyInfo.marketCapUSD) : '—'}
          </div>
        </div>

        {/* P/E Ratio (KGV) */}
        <div className="bg-slate-900/50 rounded-lg p-2.5 sm:p-3">
          <div className="text-xs text-gray-400 mb-1">{t('company.peRatio')}</div>
          <div className={`text-sm sm:text-base font-semibold ${
            companyInfo.peRatio === undefined ? 'text-white' :
            companyInfo.peRatio > 30 ? 'text-yellow-400' : 
            companyInfo.peRatio < 0 ? 'text-red-400' :
            companyInfo.peRatio < 15 ? 'text-green-400' : 'text-white'
          }`}>
            {formatPE(companyInfo.peRatio)}
          </div>
          {companyInfo.forwardPE !== undefined && (
            <div className="text-xs text-gray-500">
              {t('company.forwardPE')}: {formatPE(companyInfo.forwardPE)}
            </div>
          )}
        </div>

        {/* Dividend Yield */}
        <div className="bg-slate-900/50 rounded-lg p-2.5 sm:p-3">
          <div className="text-xs text-gray-400 mb-1">{t('company.dividendYield')}</div>
          <div className={`text-sm sm:text-base font-semibold ${
            companyInfo.dividendYield === undefined || companyInfo.dividendYield === 0 ? 'text-white' :
            companyInfo.dividendYield > 4 ? 'text-green-400' : 
            companyInfo.dividendYield > 2 ? 'text-blue-400' : 'text-white'
          }`}>
            {companyInfo.dividendYield !== undefined && companyInfo.dividendYield > 0 
              ? `${companyInfo.dividendYield.toFixed(2)}%` 
              : '—'}
          </div>
          {companyInfo.eps !== undefined && (
            <div className="text-xs text-gray-500">
              {t('company.eps')}: {formatCurrency(companyInfo.eps)}
            </div>
          )}
        </div>

        {/* Volume */}
        <div className="bg-slate-900/50 rounded-lg p-2.5 sm:p-3">
          <div className="text-xs text-gray-400 mb-1">{t('company.volume')}</div>
          <div className="text-sm sm:text-base font-semibold text-white">
            {formatVolume(companyInfo.volume)}
          </div>
          {companyInfo.beta !== undefined && (
            <div className="text-xs text-gray-500">
              {t('company.beta')}: {companyInfo.beta.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {/* 52-Week Range */}
      {companyInfo.fiftyTwoWeekLow && companyInfo.fiftyTwoWeekHigh && (
        <div className="bg-slate-900/50 rounded-lg p-2.5 sm:p-3">
          <div className="text-xs text-gray-400 mb-2">{t('company.weekRange')}</div>
          <div className="flex justify-between text-sm font-semibold text-white mb-1">
            <span>{formatCurrency(companyInfo.fiftyTwoWeekLow)}</span>
            <span>{formatCurrency(companyInfo.fiftyTwoWeekHigh)}</span>
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
            {t('company.current')}: {formatCurrency(companyInfo.priceUSD)}
          </div>
        </div>
      )}

      {/* Data sources and info */}
      <div className="text-xs text-gray-500 pt-2 border-t border-slate-700/50 flex justify-between items-center flex-wrap gap-2">
        {companyInfo.dataSources && companyInfo.dataSources.length > 0 && (
          <span className="text-gray-600">
            📊 {companyInfo.dataSources.join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}