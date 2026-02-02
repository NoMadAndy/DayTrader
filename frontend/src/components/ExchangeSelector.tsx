/**
 * Exchange Selector Component
 * 
 * Dropdown to select a stock exchange with status indicators.
 */

import { useState, useMemo } from 'react';
import { 
  EXCHANGES, 
  EXCHANGE_REGIONS, 
  getExchangeStatus
} from '../utils/exchanges';

interface ExchangeSelectorProps {
  value: string;
  onChange: (exchangeCode: string) => void;
  showStatus?: boolean;
  compact?: boolean;
  className?: string;
}

export function ExchangeSelector({ 
  value, 
  onChange, 
  showStatus = true,
  compact = false,
  className = '' 
}: ExchangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const selectedExchange = EXCHANGES[value] || EXCHANGES.NASDAQ;
  const status = useMemo(() => getExchangeStatus(value), [value]);
  
  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 bg-slate-800 border border-slate-600 rounded-lg
          hover:border-slate-500 transition-colors text-left
          ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'}
        `}
      >
        <span>{selectedExchange.flag}</span>
        <span className="font-medium">{selectedExchange.code}</span>
        {showStatus && (
          <span className={`w-2 h-2 rounded-full ${status.isOpen ? 'bg-green-500' : 'bg-gray-500'}`} />
        )}
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-80 overflow-y-auto min-w-[280px]">
            {Object.entries(EXCHANGE_REGIONS).map(([region, codes]) => (
              <div key={region}>
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 bg-slate-900/50 sticky top-0">
                  {region}
                </div>
                {codes.map(code => {
                  const exchange = EXCHANGES[code];
                  if (!exchange) return null;
                  const exchangeStatus = getExchangeStatus(code);
                  
                  return (
                    <button
                      key={code}
                      onClick={() => {
                        onChange(code);
                        setIsOpen(false);
                      }}
                      className={`
                        w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-700/50 transition-colors
                        ${value === code ? 'bg-slate-700/30' : ''}
                      `}
                    >
                      <span className="text-lg">{exchange.flag}</span>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium text-white">{exchange.code}</div>
                        <div className="text-xs text-gray-400">{exchange.name}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xs font-medium ${exchangeStatus.isOpen ? 'text-green-400' : 'text-gray-500'}`}>
                          {exchangeStatus.statusText}
                        </div>
                        <div className="text-xs text-gray-500">
                          {exchangeStatus.localTime} ({exchange.currency})
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Exchange Status Badge
 * Shows current status of an exchange
 */
interface ExchangeStatusBadgeProps {
  exchangeCode: string;
  showTime?: boolean;
  compact?: boolean;
}

export function ExchangeStatusBadge({ 
  exchangeCode, 
  showTime = true,
  compact = false 
}: ExchangeStatusBadgeProps) {
  const exchange = EXCHANGES[exchangeCode];
  const status = useMemo(() => getExchangeStatus(exchangeCode), [exchangeCode]);
  
  if (!exchange) return null;
  
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <span>{exchange.flag}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${status.isOpen ? 'bg-green-500' : 'bg-gray-500'}`} />
      </span>
    );
  }
  
  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 bg-slate-800/50 rounded text-xs">
      <span>{exchange.flag}</span>
      <span className="font-medium">{exchange.code}</span>
      <span className={`w-2 h-2 rounded-full ${status.isOpen ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
      {showTime && (
        <span className="text-gray-400">{status.localTime}</span>
      )}
    </div>
  );
}

/**
 * Multi-Exchange Status Panel
 * Shows status of multiple exchanges at once
 */
export function ExchangeStatusPanel() {
  const mainExchanges = ['NYSE', 'NASDAQ', 'XETRA', 'LSE', 'TSE', 'HKEX'];
  
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
      {mainExchanges.map(code => {
        const exchange = EXCHANGES[code];
        const status = getExchangeStatus(code);
        
        return (
          <div 
            key={code}
            className={`
              flex flex-col items-center p-2 rounded-lg border transition-colors
              ${status.isOpen 
                ? 'bg-green-500/10 border-green-500/30' 
                : 'bg-slate-800/50 border-slate-700/50'
              }
            `}
          >
            <span className="text-lg">{exchange.flag}</span>
            <span className="font-medium text-sm">{code}</span>
            <span className={`text-xs ${status.isOpen ? 'text-green-400' : 'text-gray-500'}`}>
              {status.localTime}
            </span>
            <span className={`text-[10px] ${status.isOpen ? 'text-green-400' : 'text-gray-500'}`}>
              {status.statusText}
            </span>
          </div>
        );
      })}
    </div>
  );
}
