/**
 * Global Exchange Registry
 * 
 * Defines trading exchanges worldwide with their:
 * - Trading hours
 * - Timezones
 * - Symbol suffixes
 * - Market holidays
 */

export interface Exchange {
  code: string;           // Exchange code (e.g., "XETRA", "NYSE")
  name: string;           // Full name
  country: string;        // Country code (ISO 3166-1 alpha-2)
  timezone: string;       // IANA timezone
  suffix: string;         // Symbol suffix (e.g., ".DE" for XETRA)
  tradingHours: {
    open: string;         // Opening time (HH:MM)
    close: string;        // Closing time (HH:MM)
  };
  currency: string;       // Primary currency
  flag: string;           // Country flag emoji
}

/**
 * All supported exchanges
 */
export const EXCHANGES: Record<string, Exchange> = {
  // North America
  NYSE: {
    code: 'NYSE',
    name: 'New York Stock Exchange',
    country: 'US',
    timezone: 'America/New_York',
    suffix: '',
    tradingHours: { open: '09:30', close: '16:00' },
    currency: 'USD',
    flag: '🇺🇸',
  },
  NASDAQ: {
    code: 'NASDAQ',
    name: 'NASDAQ',
    country: 'US',
    timezone: 'America/New_York',
    suffix: '',
    tradingHours: { open: '09:30', close: '16:00' },
    currency: 'USD',
    flag: '🇺🇸',
  },
  TSX: {
    code: 'TSX',
    name: 'Toronto Stock Exchange',
    country: 'CA',
    timezone: 'America/Toronto',
    suffix: '.TO',
    tradingHours: { open: '09:30', close: '16:00' },
    currency: 'CAD',
    flag: '🇨🇦',
  },

  // Europe
  XETRA: {
    code: 'XETRA',
    name: 'XETRA (Deutsche Börse)',
    country: 'DE',
    timezone: 'Europe/Berlin',
    suffix: '.DE',
    tradingHours: { open: '09:00', close: '17:30' },
    currency: 'EUR',
    flag: '🇩🇪',
  },
  FRA: {
    code: 'FRA',
    name: 'Frankfurt Stock Exchange',
    country: 'DE',
    timezone: 'Europe/Berlin',
    suffix: '.F',
    tradingHours: { open: '08:00', close: '20:00' },
    currency: 'EUR',
    flag: '🇩🇪',
  },
  LSE: {
    code: 'LSE',
    name: 'London Stock Exchange',
    country: 'GB',
    timezone: 'Europe/London',
    suffix: '.L',
    tradingHours: { open: '08:00', close: '16:30' },
    currency: 'GBP',
    flag: '🇬🇧',
  },
  EURONEXT_PAR: {
    code: 'EURONEXT_PAR',
    name: 'Euronext Paris',
    country: 'FR',
    timezone: 'Europe/Paris',
    suffix: '.PA',
    tradingHours: { open: '09:00', close: '17:30' },
    currency: 'EUR',
    flag: '🇫🇷',
  },
  EURONEXT_AMS: {
    code: 'EURONEXT_AMS',
    name: 'Euronext Amsterdam',
    country: 'NL',
    timezone: 'Europe/Amsterdam',
    suffix: '.AS',
    tradingHours: { open: '09:00', close: '17:30' },
    currency: 'EUR',
    flag: '🇳🇱',
  },
  SIX: {
    code: 'SIX',
    name: 'SIX Swiss Exchange',
    country: 'CH',
    timezone: 'Europe/Zurich',
    suffix: '.SW',
    tradingHours: { open: '09:00', close: '17:30' },
    currency: 'CHF',
    flag: '🇨🇭',
  },
  BME: {
    code: 'BME',
    name: 'Bolsa de Madrid',
    country: 'ES',
    timezone: 'Europe/Madrid',
    suffix: '.MC',
    tradingHours: { open: '09:00', close: '17:30' },
    currency: 'EUR',
    flag: '🇪🇸',
  },
  MIL: {
    code: 'MIL',
    name: 'Borsa Italiana (Milan)',
    country: 'IT',
    timezone: 'Europe/Rome',
    suffix: '.MI',
    tradingHours: { open: '09:00', close: '17:30' },
    currency: 'EUR',
    flag: '🇮🇹',
  },

  // Asia Pacific
  TSE: {
    code: 'TSE',
    name: 'Tokyo Stock Exchange',
    country: 'JP',
    timezone: 'Asia/Tokyo',
    suffix: '.T',
    tradingHours: { open: '09:00', close: '15:00' },
    currency: 'JPY',
    flag: '🇯🇵',
  },
  HKEX: {
    code: 'HKEX',
    name: 'Hong Kong Stock Exchange',
    country: 'HK',
    timezone: 'Asia/Hong_Kong',
    suffix: '.HK',
    tradingHours: { open: '09:30', close: '16:00' },
    currency: 'HKD',
    flag: '🇭🇰',
  },
  SSE: {
    code: 'SSE',
    name: 'Shanghai Stock Exchange',
    country: 'CN',
    timezone: 'Asia/Shanghai',
    suffix: '.SS',
    tradingHours: { open: '09:30', close: '15:00' },
    currency: 'CNY',
    flag: '🇨🇳',
  },
  SZSE: {
    code: 'SZSE',
    name: 'Shenzhen Stock Exchange',
    country: 'CN',
    timezone: 'Asia/Shanghai',
    suffix: '.SZ',
    tradingHours: { open: '09:30', close: '15:00' },
    currency: 'CNY',
    flag: '🇨🇳',
  },
  KRX: {
    code: 'KRX',
    name: 'Korea Exchange',
    country: 'KR',
    timezone: 'Asia/Seoul',
    suffix: '.KS',
    tradingHours: { open: '09:00', close: '15:30' },
    currency: 'KRW',
    flag: '🇰🇷',
  },
  ASX: {
    code: 'ASX',
    name: 'Australian Securities Exchange',
    country: 'AU',
    timezone: 'Australia/Sydney',
    suffix: '.AX',
    tradingHours: { open: '10:00', close: '16:00' },
    currency: 'AUD',
    flag: '🇦🇺',
  },
  NSE: {
    code: 'NSE',
    name: 'National Stock Exchange of India',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    suffix: '.NS',
    tradingHours: { open: '09:15', close: '15:30' },
    currency: 'INR',
    flag: '🇮🇳',
  },
  BSE: {
    code: 'BSE',
    name: 'Bombay Stock Exchange',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    suffix: '.BO',
    tradingHours: { open: '09:15', close: '15:30' },
    currency: 'INR',
    flag: '🇮🇳',
  },

  // Other
  BVMF: {
    code: 'BVMF',
    name: 'B3 (Brasil Bolsa Balcão)',
    country: 'BR',
    timezone: 'America/Sao_Paulo',
    suffix: '.SA',
    tradingHours: { open: '10:00', close: '17:00' },
    currency: 'BRL',
    flag: '🇧🇷',
  },
  JSE: {
    code: 'JSE',
    name: 'Johannesburg Stock Exchange',
    country: 'ZA',
    timezone: 'Africa/Johannesburg',
    suffix: '.JO',
    tradingHours: { open: '09:00', close: '17:00' },
    currency: 'ZAR',
    flag: '🇿🇦',
  },
};

/**
 * Get exchange list grouped by region
 */
export const EXCHANGE_REGIONS = {
  'Nord-Amerika': ['NYSE', 'NASDAQ', 'TSX'],
  'Europa': ['XETRA', 'FRA', 'LSE', 'EURONEXT_PAR', 'EURONEXT_AMS', 'SIX', 'BME', 'MIL'],
  'Asien-Pazifik': ['TSE', 'HKEX', 'SSE', 'SZSE', 'KRX', 'ASX', 'NSE', 'BSE'],
  'Andere': ['BVMF', 'JSE'],
};

/**
 * Common stock symbols per exchange for quick add
 */
export const POPULAR_SYMBOLS: Record<string, Array<{ symbol: string; name: string }>> = {
  NYSE: [
    { symbol: 'JPM', name: 'JPMorgan Chase' },
    { symbol: 'JNJ', name: 'Johnson & Johnson' },
    { symbol: 'V', name: 'Visa Inc.' },
    { symbol: 'PG', name: 'Procter & Gamble' },
    { symbol: 'UNH', name: 'UnitedHealth Group' },
  ],
  NASDAQ: [
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'GOOGL', name: 'Alphabet (Google)' },
    { symbol: 'AMZN', name: 'Amazon' },
    { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'META', name: 'Meta Platforms' },
    { symbol: 'NVDA', name: 'NVIDIA' },
  ],
  XETRA: [
    { symbol: 'SAP.DE', name: 'SAP SE' },
    { symbol: 'SIE.DE', name: 'Siemens AG' },
    { symbol: 'ALV.DE', name: 'Allianz SE' },
    { symbol: 'BAS.DE', name: 'BASF SE' },
    { symbol: 'BMW.DE', name: 'BMW AG' },
    { symbol: 'DTE.DE', name: 'Deutsche Telekom' },
    { symbol: 'VOW3.DE', name: 'Volkswagen AG' },
    { symbol: 'MRK.DE', name: 'Merck KGaA' },
    { symbol: 'ADS.DE', name: 'Adidas AG' },
    { symbol: 'DBK.DE', name: 'Deutsche Bank' },
  ],
  LSE: [
    { symbol: 'HSBA.L', name: 'HSBC Holdings' },
    { symbol: 'SHEL.L', name: 'Shell plc' },
    { symbol: 'AZN.L', name: 'AstraZeneca' },
    { symbol: 'ULVR.L', name: 'Unilever' },
    { symbol: 'BP.L', name: 'BP plc' },
    { symbol: 'GSK.L', name: 'GSK plc' },
    { symbol: 'RIO.L', name: 'Rio Tinto' },
  ],
  EURONEXT_PAR: [
    { symbol: 'MC.PA', name: 'LVMH' },
    { symbol: 'OR.PA', name: "L'Oréal" },
    { symbol: 'TTE.PA', name: 'TotalEnergies' },
    { symbol: 'SAN.PA', name: 'Sanofi' },
    { symbol: 'AIR.PA', name: 'Airbus' },
  ],
  TSE: [
    { symbol: '7203.T', name: 'Toyota Motor' },
    { symbol: '6758.T', name: 'Sony Group' },
    { symbol: '9984.T', name: 'SoftBank Group' },
    { symbol: '6861.T', name: 'Keyence' },
  ],
  HKEX: [
    { symbol: '0700.HK', name: 'Tencent Holdings' },
    { symbol: '9988.HK', name: 'Alibaba Group' },
    { symbol: '1299.HK', name: 'AIA Group' },
    { symbol: '0005.HK', name: 'HSBC Holdings' },
  ],
};

/**
 * Parse symbol to extract base symbol and exchange
 */
export function parseSymbol(fullSymbol: string): { symbol: string; exchange: Exchange | null; suffix: string } {
  const upperSymbol = fullSymbol.toUpperCase().trim();
  
  // Find matching suffix
  for (const exchange of Object.values(EXCHANGES)) {
    if (exchange.suffix && upperSymbol.endsWith(exchange.suffix)) {
      return {
        symbol: upperSymbol.slice(0, -exchange.suffix.length),
        exchange,
        suffix: exchange.suffix,
      };
    }
  }
  
  // No suffix = assume US market (NYSE/NASDAQ)
  return {
    symbol: upperSymbol,
    exchange: EXCHANGES.NASDAQ, // Default to NASDAQ for US symbols
    suffix: '',
  };
}

/**
 * Format symbol with exchange suffix
 */
export function formatSymbolForExchange(symbol: string, exchangeCode: string): string {
  const exchange = EXCHANGES[exchangeCode];
  if (!exchange) return symbol.toUpperCase();
  
  const baseSymbol = symbol.toUpperCase().trim();
  
  // Remove any existing suffix
  for (const ex of Object.values(EXCHANGES)) {
    if (ex.suffix && baseSymbol.endsWith(ex.suffix)) {
      return baseSymbol.slice(0, -ex.suffix.length) + exchange.suffix;
    }
  }
  
  return baseSymbol + exchange.suffix;
}

/**
 * Check if an exchange is currently open
 */
export function isExchangeOpen(exchangeCode: string, date: Date = new Date()): boolean {
  const exchange = EXCHANGES[exchangeCode];
  if (!exchange) return false;
  
  try {
    // Get current time in exchange timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: exchange.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
    
    // Check if weekend
    if (['Sat', 'Sun'].includes(weekday)) {
      return false;
    }
    
    // Parse trading hours
    const [openHour, openMinute] = exchange.tradingHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = exchange.tradingHours.close.split(':').map(Number);
    
    const currentMinutes = hour * 60 + minute;
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;
    
    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
  } catch {
    return false;
  }
}

/**
 * Get current time at exchange location
 */
export function getExchangeLocalTime(exchangeCode: string, date: Date = new Date()): string {
  const exchange = EXCHANGES[exchangeCode];
  if (!exchange) return '--:--';
  
  try {
    return date.toLocaleTimeString('de-DE', {
      timeZone: exchange.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--:--';
  }
}

/**
 * Get exchange status with details
 */
export function getExchangeStatus(exchangeCode: string, date: Date = new Date()): {
  isOpen: boolean;
  localTime: string;
  statusText: string;
  nextEvent: string;
} {
  const exchange = EXCHANGES[exchangeCode];
  if (!exchange) {
    return { isOpen: false, localTime: '--:--', statusText: 'Unbekannt', nextEvent: '' };
  }
  
  const isOpen = isExchangeOpen(exchangeCode, date);
  const localTime = getExchangeLocalTime(exchangeCode, date);
  
  // Get weekday in exchange timezone
  const weekday = date.toLocaleDateString('en-US', {
    timeZone: exchange.timezone,
    weekday: 'short',
  });
  
  let statusText: string;
  let nextEvent: string;
  
  if (['Sat', 'Sun'].includes(weekday)) {
    statusText = 'Wochenende';
    nextEvent = `Öffnet Mo ${exchange.tradingHours.open}`;
  } else if (isOpen) {
    statusText = 'Geöffnet';
    nextEvent = `Schließt ${exchange.tradingHours.close}`;
  } else {
    // Check if before or after trading hours
    const [openHour] = exchange.tradingHours.open.split(':').map(Number);
    const currentHour = parseInt(localTime.split(':')[0]);
    
    if (currentHour < openHour) {
      statusText = 'Noch geschlossen';
      nextEvent = `Öffnet ${exchange.tradingHours.open}`;
    } else {
      statusText = 'Geschlossen';
      nextEvent = `Öffnet morgen ${exchange.tradingHours.open}`;
    }
  }
  
  return { isOpen, localTime, statusText, nextEvent };
}

/**
 * Get all exchanges that are currently open
 */
export function getOpenExchanges(date: Date = new Date()): Exchange[] {
  return Object.values(EXCHANGES).filter(ex => isExchangeOpen(ex.code, date));
}

/**
 * Detect exchange from symbol
 */
export function detectExchange(symbol: string): Exchange {
  const { exchange } = parseSymbol(symbol);
  return exchange || EXCHANGES.NASDAQ;
}
