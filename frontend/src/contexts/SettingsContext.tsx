/**
 * Settings Context
 * 
 * Global context for user preferences like language and currency.
 * Settings are persisted to localStorage and synced with backend when authenticated.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { getAuthState, subscribeToAuth } from '../services/authService';
import { getUserSettings, updateUserSettings } from '../services/userSettingsService';
import { getEurUsdRate } from '../services/companyInfoService';

export type Language = 'de' | 'en';
export type Currency = 'USD' | 'EUR';

interface Settings {
  language: Language;
  currency: Currency;
}

interface SettingsContextType {
  language: Language;
  currency: Currency;
  setLanguage: (lang: Language) => void;
  setCurrency: (curr: Currency) => void;
  t: (key: string) => string;
  formatCurrency: (value: number) => string;
  formatPrice: (value: number) => string;
}

const STORAGE_KEY = 'daytrader_ui_settings';

const DEFAULT_SETTINGS: Settings = {
  language: 'de',
  currency: 'USD',
};

// USD to EUR conversion rate - default fallback, will be updated dynamically
const DEFAULT_EUR_RATE = 0.92;

// Shared dynamic EUR rate (updated from API)
let currentEurRate = DEFAULT_EUR_RATE;

const SettingsContext = createContext<SettingsContextType | null>(null);

function loadStoredSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    console.warn('Failed to load UI settings');
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    console.warn('Failed to save UI settings');
  }
}

/**
 * Get current settings from localStorage (for use outside React components)
 */
export function getCurrentSettings(): Settings {
  return loadStoredSettings();
}

/**
 * Get current currency from localStorage (for use outside React components)
 */
export function getCurrentCurrency(): Currency {
  return loadStoredSettings().currency;
}

/**
 * Format currency value using stored settings (for use outside React components)
 * This is a standalone function that can be used in services
 */
export function formatCurrencyValue(value: number, forceCurrency?: Currency): string {
  const settings = loadStoredSettings();
  const currency = forceCurrency || settings.currency;
  
  // Convert USD to EUR if needed (using dynamically fetched rate)
  const convertedValue = currency === 'EUR' ? value * currentEurRate : value;
  
  const locale = currency === 'EUR' ? 'de-DE' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(convertedValue);
}

/**
 * Update the EUR rate from external source
 * Called by SettingsProvider on mount and periodically
 */
export function updateEurRate(rate: number): void {
  if (rate > 0 && rate < 10) { // Sanity check
    currentEurRate = rate;
  }
}

/**
 * Get current EUR rate (for display purposes)
 */
export function getCurrentEurRate(): number {
  return currentEurRate;
}

// Translations
const translations: Record<Language, Record<string, string>> = {
  de: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.trading': 'Trading',
    'nav.leaderboard': 'Rangliste',
    'nav.backtest': 'Backtest',
    'nav.rlAgents': 'RL Agents',
    'nav.aiTraders': 'Live AI',
    'nav.watchlist': 'Watchlist',
    'nav.settings': 'Einstellungen',
    'nav.info': 'Info',
    'nav.changelog': 'Changelog',
    'nav.login': 'Login',
    'nav.account': 'Konto',
    
    // Settings Page
    'settings.title': 'Einstellungen',
    'settings.subtitle': 'API-Schlüssel, Datenquellen und ML-Konfiguration',
    'settings.apiKeys': 'API Keys',
    'settings.dataSources': 'Datenquellen',
    'settings.mlSettings': 'ML Settings',
    'settings.preferences': 'Darstellung',
    'settings.language': 'Sprache',
    'settings.currency': 'Währung',
    'settings.languageDesc': 'Sprache der Benutzeroberfläche',
    'settings.currencyDesc': 'Währung für alle Preisanzeigen',
    'settings.german': 'Deutsch',
    'settings.english': 'English',
    'settings.save': 'Speichern & Anwenden',
    'settings.saved': '✓ Gespeichert!',
    'settings.clear': 'Alle löschen',
    'settings.apiConfigured': 'API-Schlüssel konfiguriert',
    'settings.yahooUsed': 'Yahoo Finance wird verwendet (kein API-Schlüssel nötig)',
    'settings.marketDataApis': 'Marktdaten-APIs',
    'settings.newsApis': 'Nachrichten-APIs',
    'settings.finnhubKey': 'Finnhub API Key',
    'settings.alphaVantageKey': 'Alpha Vantage API Key',
    'settings.twelveDataKey': 'Twelve Data API Key',
    'settings.newsApiKey': 'NewsAPI Key',
    'settings.marketauxKey': 'Marketaux API Key',
    'settings.marketauxDesc': 'Finanznachrichten mit Sentiment-Analyse und Multi-Sprachen-Support (~100 Anfragen/Tag)',
    'settings.fmpKey': 'Financial Modeling Prep API Key',
    'settings.fmpDesc': 'Umfassende Finanzdaten und Unternehmensnachrichten',
    'settings.tiingoKey': 'Tiingo API Key',
    'settings.tiingoDesc': 'Institutionelle Nachrichten-API mit historischem Archiv',
    'settings.rssFeeds': 'Deutsche RSS-Feeds',
    'settings.enableRssFeeds': 'RSS-Feeds aktivieren',
    'settings.rssFeedsDesc': 'Börse Frankfurt, BaFin, EZB, Bundesbank - kostenlose deutsche Finanznachrichten',
    'settings.noApiKeyRequired': 'Kein API-Schlüssel nötig',
    'settings.freeRegister': '(Kostenlos registrieren)',
    'settings.enterKey': 'API-Schlüssel eingeben',
    'settings.keysStoredLocally': 'API-Schlüssel werden lokal gespeichert. Bei Anmeldung werden sie mit deinem Konto synchronisiert.',
    'settings.selectDataSource': 'Wähle deine bevorzugte Datenquelle für Aktienkurse.',
    'settings.apiUsage': 'API-Verbrauch',
    'settings.apiUsageDesc': 'Übersicht über dein verbleibendes API-Kontingent. Daten werden automatisch gecached, um API-Aufrufe zu minimieren und Rate-Limits einzuhalten.',
    'settings.mlConfig': 'Konfiguriere die Parameter für das Machine Learning Modell.',
    'settings.sequenceLength': 'Sequenzlänge (Tage)',
    'settings.sequenceLengthDesc': 'Anzahl der Tage für die Eingabesequenz (30-120)',
    'settings.forecastDays': 'Vorhersage-Tage',
    'settings.forecastDaysDesc': 'Anzahl der Tage für die Vorhersage (1-30)',
    'settings.epochs': 'Epochen',
    'settings.epochsDesc': 'Trainings-Epochen (10-500)',
    'settings.learningRate': 'Lernrate',
    'settings.learningRateDesc': 'Lernrate für das Training (0.0001-0.1)',
    'settings.useCuda': 'GPU/CUDA verwenden',
    'settings.useCudaDesc': 'Beschleunigt Training wenn NVIDIA GPU verfügbar',
    'settings.preloadFinbert': 'FinBERT vorladen',
    'settings.preloadFinbertDesc': 'Lädt Sentiment-Modell beim Start (mehr RAM, schnellere Analyse)',
    'settings.saveML': 'ML-Einstellungen speichern',
    'settings.mlSaved': '✓ ML-Einstellungen gespeichert!',
    'settings.loggedIn': '✓ Eingeloggt',
    'settings.apiKeysSynced': '✓ API-Schlüssel werden synchronisiert',
    'settings.customSymbolsSaved': '✓ Custom Symbols werden gespeichert',
    'settings.mlSettingsAcross': '✓ ML-Einstellungen geräteübergreifend',
    'settings.logout': 'Abmelden',
    'settings.alreadyAccount': 'Bereits ein Konto?',
    'settings.signIn': 'Anmelden',
    'settings.noAccount': 'Noch kein Konto?',
    'settings.register': 'Registrieren',
    'settings.benefits': 'Vorteile eines Kontos:',
    'settings.benefit1': '• API-Schlüssel geräteübergreifend synchronisieren',
    'settings.benefit2': '• Custom Symbols speichern',
    'settings.benefit3': '• ML-Einstellungen beibehalten',
    'settings.benefit4': '• Watchlist zwischen Geräten teilen',
    'settings.signalSources': 'Signal-Quellen',
    
    // Trading Page
    'trading.title': 'Trading & Portfolio',
    'trading.tab.trading': 'Trading',
    'trading.tab.overview': 'Übersicht',
    'trading.tab.settings': 'Einstellungen',
    'trading.loginRequired': 'Trading erfordert einen Account',
    'trading.loginToTrade': 'Melde dich an, um mit dem Paper Trading zu beginnen.',
    'trading.goToSettings': 'Zu den Einstellungen',
    'trading.totalValue': 'Gesamtwert',
    'trading.pnl': 'P&L',
    'trading.cash': 'Bargeld',
    'trading.newOrder': 'Neue Order',
    'trading.symbol': 'Symbol',
    'trading.current': 'Aktuell',
    'trading.productType': 'Produkt',
    'trading.stock': 'Aktie',
    'trading.side': 'Seite',
    'trading.buy': 'Kauf',
    'trading.sell': 'Verkauf',
    'trading.short': 'Short',
    'trading.quantity': 'Menge',
    'trading.leverage': 'Hebel',
    'trading.orderType': 'Order-Typ',
    'trading.market': 'Market',
    'trading.limit': 'Limit',
    'trading.stop': 'Stop',
    'trading.stopLimit': 'Stop-Limit',
    'trading.limitPrice': 'Limit-Preis',
    'trading.stopPrice': 'Stop-Preis',
    'trading.stopLoss': 'Stop-Loss',
    'trading.takeProfit': 'Take-Profit',
    'trading.optional': 'optional',
    'trading.preview': 'Vorschau',
    'trading.notionalValue': 'Nominalwert',
    'trading.fees': 'Gebühren',
    'trading.margin': 'Margin',
    'trading.placeOrder': 'Order platzieren',
    'trading.totalFees': 'Gebühren gesamt',
    'trading.openPositions': 'Offene Positionen',
    'trading.noPositions': 'Keine offenen Positionen',
    'trading.position': 'Position',
    'trading.entry': 'Einstieg',
    'trading.price': 'Kurs',
    'trading.value': 'Wert',
    'trading.marginUsed': 'Margin',
    'trading.feesPaid': 'Gebühren',
    'trading.close': 'Schließen',
    'trading.edit': 'Bearbeiten',
    'trading.save': 'Speichern',
    'trading.cancel': 'Abbrechen',
    'trading.liquidation': 'Liquidation',
    'trading.pendingOrders': 'Offene Orders',
    'trading.noPendingOrders': 'Keine offenen Orders',
    'trading.portfolioNotLoaded': 'Portfolio konnte nicht geladen werden',
    'trading.enterValidQuantity': 'Bitte gültige Menge eingeben',
    'trading.enterValidLimitPrice': 'Bitte gültigen Limit-Preis eingeben',
    'trading.enterValidStopPrice': 'Bitte gültigen Stop-Preis eingeben',
    'trading.enterValidBothPrices': 'Bitte gültigen Stop- und Limit-Preis eingeben',
    'trading.orderCreated': 'Order erstellt für',
    'trading.orderFailed': 'Order konnte nicht erstellt werden',
    'trading.orderExecuted': 'Order ausgeführt',
    'trading.positionClosed': 'Position geschlossen',
    'trading.capitalChanged': 'Startkapital wurde auf {amount} geändert',
    'trading.resetPortfolio': 'Portfolio zurücksetzen',
    'trading.resetConfirm': 'Bist du sicher? Alle Positionen und History werden gelöscht.',
    'trading.resetYes': 'Ja, zurücksetzen',
    'trading.resetNo': 'Abbrechen',
    'trading.brokerProfile': 'Broker-Profil',
    'trading.initialCapital': 'Startkapital',
    'trading.changeCapital': 'Kapital ändern',
    
    // Dashboard
    'dashboard.analyzingWatchlist': 'Analysiere Watchlist für beste Empfehlung...',
    'dashboard.quickTrade': 'Quick Trade',
    'dashboard.invalidQuantity': 'Ungültige Menge',
    'dashboard.purchaseSuccess': 'Kauf erfolgreich! Neuer Kontostand:',
    'dashboard.sellSuccess': 'Verkauf erfolgreich! Neuer Kontostand:',
    'dashboard.shortSuccess': 'Short erfolgreich! Neuer Kontostand:',
    'dashboard.noPortfolio': 'Kein Portfolio',
    'dashboard.loginToTrade': 'Anmelden um zu traden',
    'dashboard.available': 'Verfügbar',
    'dashboard.tradeFailed': 'Trade fehlgeschlagen',
    'dashboard.loadingChart': 'Lade Chart...',
    'dashboard.noData': 'Keine Daten verfügbar',
    
    // Watchlist
    'watchlist.title': 'Watchlist',
    'watchlist.addSymbol': 'Symbol hinzufügen',
    'watchlist.noSymbols': 'Keine Symbole in der Watchlist',
    'watchlist.remove': 'Entfernen',
    'watchlist.analyze': 'Analysieren',
    'watchlist.trade': 'Traden',
    
    // Leaderboard
    'leaderboard.title': 'Rangliste',
    'leaderboard.rank': 'Rang',
    'leaderboard.trader': 'Trader',
    'leaderboard.totalReturn': 'Gesamtrendite',
    'leaderboard.winRate': 'Gewinnrate',
    'leaderboard.trades': 'Trades',
    'leaderboard.yourRank': 'Dein Rang',
    
    // Backtest
    'backtest.title': 'Backtest',
    'backtest.strategy': 'Strategie',
    'backtest.period': 'Zeitraum',
    'backtest.run': 'Backtest starten',
    'backtest.results': 'Ergebnisse',
    
    // Common
    'common.loading': 'Lädt...',
    'common.error': 'Fehler',
    'common.success': 'Erfolg',
    'common.confirm': 'Bestätigen',
    'common.cancel': 'Abbrechen',
    'common.save': 'Speichern',
    'common.delete': 'Löschen',
    'common.edit': 'Bearbeiten',
    'common.close': 'Schließen',
    'common.yes': 'Ja',
    'common.no': 'Nein',
    
    // Footer
    'footer.disclaimer': '⚠️ Disclaimer: Dies ist nur für Bildungs-/Testzwecke. Keine Finanzberatung.',
    
    // Forecast
    'forecast.title': 'Prognose',
    'forecast.mlTitle': 'ML-Prognose',
    'forecast.days': 'Tage',
    'forecast.confidence': 'Konfidenz',
    'forecast.expected': 'Erwartet',
    'forecast.bullish': 'Bullisch',
    'forecast.bearish': 'Bärisch',
    'forecast.neutral': 'Neutral',
    
    // News
    'news.title': 'Nachrichten',
    'news.sentiment': 'Stimmung',
    'news.noNews': 'Keine Nachrichten verfügbar',
    
    // Signals
    'signals.title': 'Trading-Signale',
    'signals.recommendation': 'Empfehlung',
    'signals.strongBuy': 'Starker Kauf',
    'signals.buy': 'Kaufen',
    'signals.hold': 'Halten',
    'signals.sell': 'Verkaufen',
    'signals.strongSell': 'Starker Verkauf',
    
    // Company Info
    'company.info': 'Unternehmensinfo',
    'company.sector': 'Sektor',
    'company.industry': 'Branche',
    'company.marketCap': 'Marktkapitalisierung',
    'company.employees': 'Mitarbeiter',
    'company.description': 'Beschreibung',
    
    // Leaderboard Page
    'leaderboard.description': 'Top-Trader nach Performance',
    'leaderboard.timeframe.all': 'Gesamt',
    'leaderboard.timeframe.month': '30 Tage',
    'leaderboard.timeframe.week': '7 Tage',
    'leaderboard.timeframe.day': 'Heute',
    'leaderboard.loadError': 'Leaderboard konnte nicht geladen werden',
    'leaderboard.notRanked': 'Noch nicht gerankt',
    'leaderboard.tradeToAppear': 'Führe Trades aus, um auf dem Leaderboard zu erscheinen.',
    'leaderboard.loginPrompt': 'Melde dich an, um dein Ranking zu sehen.',
    'leaderboard.noTraders': 'Noch keine Trader auf dem Leaderboard.',
    'leaderboard.joined': 'Beigetreten',
    'leaderboard.columns.rank': 'Rang',
    'leaderboard.columns.trader': 'Trader',
    'leaderboard.columns.return': 'Rendite',
    'leaderboard.columns.winRate': 'Win-Rate',
    'leaderboard.columns.trades': 'Trades',
    
    // WatchlistPage
    'watchlistPage.title': 'Meine Watchlist',
    'watchlistPage.description': 'Übersicht aller beobachteten Aktien mit Trading-Empfehlungen',
    
    // LoginForm
    'login.email': 'E-Mail',
    'login.password': 'Passwort',
    'login.failed': 'Login fehlgeschlagen',
    'login.loggingIn': 'Einloggen...',
    'login.submit': 'Einloggen',
    
    // RegisterForm
    'register.username': 'Benutzername',
    'register.email': 'E-Mail',
    'register.password': 'Passwort',
    'register.confirmPassword': 'Passwort bestätigen',
    'register.failed': 'Registrierung fehlgeschlagen',
    'register.registering': 'Registrieren...',
    'register.submit': 'Registrieren',
    
    // Backtest Page
    'backtest.description': 'Teste Trading-Strategien mit historischen Daten',
    'backtest.sessions': 'Sessions',
    'backtest.newSession': 'Neue Session',
    'backtest.sessionName': 'Session-Name',
    'backtest.startDate': 'Startdatum',
    'backtest.endDate': 'Enddatum',
    'backtest.capital': 'Startkapital',
    'backtest.create': 'Erstellen',
    'backtest.delete': 'Löschen',
    'backtest.loadError': 'Backtest konnte nicht geladen werden',
    'backtest.noSessions': 'Keine Sessions',
    'backtest.createFirst': 'Erstelle eine neue Backtest-Session',
    'backtest.currentDate': 'Aktuelles Datum',
    'backtest.advanceTime': 'Zeit vorspulen',
    'backtest.autoPlay': 'Auto-Play',
    'backtest.pause': 'Pause',
    
    // Trading errors/messages
    'trading.orderSuccess': 'Order erfolgreich',
    'trading.loadError': 'Portfolio konnte nicht geladen werden',
    'trading.quoteError': 'Kurs konnte nicht abgerufen werden',
    'trading.closeError': 'Position konnte nicht geschlossen werden',
    'trading.updateSuccess': 'Stop-Loss/Take-Profit aktualisiert',
    'trading.updateError': 'Fehler beim Aktualisieren',
    'trading.resetSuccess': 'Portfolio wurde zurückgesetzt',
    'trading.resetError': 'Reset fehlgeschlagen',
    'trading.invalidAmount': 'Ungültiger Betrag',
    'trading.settingsError': 'Einstellung konnte nicht gespeichert werden',
    'trading.brokerChanged': 'Broker-Profil geändert',
    'trading.loginPrompt': 'Melde dich an, um mit virtuellem Geld zu handeln und dein Portfolio zu verwalten.',
    'trading.executed': 'Order {symbol} ausgeführt',
    'trading.stopLossTriggered': 'Stop-Loss',
    'trading.takeProfitTriggered': 'Take-Profit',
    'trading.knockoutTriggered': 'Knock-Out',
    'trading.marginCallTriggered': 'Margin-Call',
    
    // Periods
    'period.hourly': 'Stündlich',
    'period.daily': 'Täglich',
    'period.weekly': 'Wöchentlich',
    'period.longTerm': 'Langfristig',
    
    // Sort
    'sort.name': 'Name',
    'sort.score': 'Score',
    
    // Market Cap
    'marketCap.trillion': 'Bio',
    'marketCap.billion': 'Mrd',
    'marketCap.million': 'Mio',
    'marketCap.thousand': 'Tsd',
    
    // ForecastPanel (AI Forecast)
    'forecast.aiTitle': 'KI-Prognose',
    'forecast.currentPrice': 'Aktueller Kurs',
    'forecast.priceTarget': 'Kursziel',
    'forecast.supportLevel': 'Unterstützung',
    'forecast.resistanceLevel': 'Widerstand',
    'forecast.indicatorAgreement': 'Indikator-Übereinstimmung',
    'forecast.analysisSummary': 'Analyse-Zusammenfassung',
    'forecast.technicalIndicators': 'Technische Indikatoren',
    'forecast.agreement': 'Übereinstimmung',
    'forecast.agreementStrong': 'stark',
    'forecast.agreementModerate': 'moderat',
    'forecast.agreementWeak': 'schwach',
    'forecast.agreementConflicting': 'widerspr.',
    'forecast.conflictingWarning': 'Dieser Indikator widerspricht der Mehrheit - mit Vorsicht interpretieren',
    
    // MLForecastPanel
    'ml.prediction': 'ML-Vorhersage',
    'ml.notAvailable': 'ML Service ist nicht verfügbar. Starte den ml-service Container um KI-Vorhersagen zu aktivieren.',
    'ml.noModel': 'Kein ML-Modell für {symbol} trainiert',
    'ml.trainHint': 'Klicke "Modell trainieren" um ein LSTM-Vorhersagemodell mit historischen Daten zu erstellen',
    'ml.trainModel': 'Modell trainieren',
    'ml.refresh': 'Aktualisieren',
    'ml.deleteModel': 'Modell löschen',
    'ml.training': 'Training {symbol}...',
    'ml.currentPrice': 'Aktueller Kurs',
    'ml.target7day': '7-Tage Ziel',
    'ml.target14day': '14-Tage Ziel',
    'ml.day': 'Tag',
    'ml.price': 'Kurs',
    'ml.change': 'Änderung',
    'ml.modelInfo': 'Modell trainiert auf {points} Datenpunkten • Gerät: {device} • Val Loss: {loss}',
    'ml.disclaimer': '⚠️ ML-Vorhersagen sind experimentell und nur für Bildungszwecke. Keine Finanzberatung.',
    'ml.loading': 'Lädt...',
    'ml.modelError': 'Modell-Fehler: Vorhersage ist für {predSymbol}, nicht {symbol}',
    'ml.modelOutdated': 'Modell-Daten veraltet: Bitte Modell neu trainieren',
    'ml.notEnoughData': 'Konnte nicht genug Daten laden. Benötigt: {required}, Verfügbar: {available}',
    'ml.loadingError': 'Fehler beim Laden zusätzlicher Daten',
    
    // CompanyInfoPanel
    'company.derivative': 'Derivat / Hebelprodukt',
    'company.leveraged': 'Gehebeltes Produkt (Leveraged)',
    'company.leverage': 'Hebel',
    'company.knockout': 'Knock-Out',
    'company.strike': 'Strike',
    'company.expiration': 'Verfall',
    'company.underlying': 'Basiswert',
    'company.overnight': 'Overnight',
    'company.spread': 'Spread',
    'company.derivativeWarning': 'Hebelprodukte bergen erhöhte Risiken. Totalverlust möglich.',
    'company.leveragedWarning': 'Leveraged ETFs unterliegen dem Pfadabhängigkeits-Effekt. Nicht für langfristiges Halten geeignet.',
    'company.peRatio': 'KGV (P/E)',
    'company.forwardPE': 'Fwd',
    'company.dividendYield': 'Dividendenrendite',
    'company.eps': 'EPS',
    'company.volume': 'Volumen (heute)',
    'company.beta': 'Beta',
    'company.weekRange': '52-Wochen Bereich',
    'company.current': 'Aktuell',
    'company.pricesConverted': 'Preise in EUR umgerechnet zum aktuellen Wechselkurs',
    'company.noData': 'Keine Daten verfügbar',
    'company.loadError': 'Fehler beim Laden',
    
    // AI Traders Page
    'aiTraders.title': 'Live AI Trader',
    'aiTraders.description': 'Erstelle und verwalte autonome KI-Handelsagenten',
    'aiTraders.newTrader': 'Neuer AI Trader',
    'aiTraders.createTitle': 'Neuen AI Trader erstellen',
    'aiTraders.loginRequired': 'Bitte melde dich an, um AI Trader zu verwalten.',
    'aiTraders.loadError': 'Fehler beim Laden der AI Trader',
    'aiTraders.nameRequired': 'Name ist erforderlich',
    'aiTraders.createSuccess': 'AI Trader "{name}" wurde erfolgreich erstellt!',
    'aiTraders.createError': 'Fehler beim Erstellen des AI Traders',
    'aiTraders.confirmDelete': 'Möchtest du den AI Trader "{name}" wirklich löschen?',
    'aiTraders.deleteSuccess': 'AI Trader "{name}" wurde gelöscht',
    'aiTraders.deleteError': 'Fehler beim Löschen des AI Traders',
    'aiTraders.noTraders': 'Noch keine AI Trader',
    'aiTraders.noTradersHint': 'Erstelle deinen ersten AI Trader, um loszulegen.',
    'aiTraders.viewDashboard': 'Dashboard',
    'aiTraders.trades': 'Trades',
    'aiTraders.winRate': 'Win Rate',
    'aiTraders.form.name': 'Name',
    'aiTraders.form.namePlaceholder': 'z.B. Momentum Master',
    'aiTraders.form.nameHint': 'Klicke auf "Vorschlag" für einen automatischen Namen basierend auf den Einstellungen',
    'aiTraders.form.suggest': 'Vorschlag',
    'aiTraders.form.suggestName': 'Namen basierend auf Einstellungen vorschlagen',
    'aiTraders.form.description': 'Beschreibung (optional)',
    'aiTraders.form.descriptionPlaceholder': 'Beschreibe die Strategie...',
    'aiTraders.form.avatar': 'Avatar',
    'aiTraders.form.initialCapital': 'Startkapital',
    'aiTraders.form.capitalHint': 'Virtuelles Startkapital für das Paper Trading',
    'aiTraders.form.riskTolerance': 'Risikotoleranz',
    'aiTraders.form.signalSources': 'Signalquellen',
    'aiTraders.form.signalSourcesHint': 'Wähle, welche Signalquellen der Trader nutzen soll',
    'aiTraders.form.ml': 'Machine Learning',
    'aiTraders.form.mlDesc': 'Vorhersagen basierend auf historischen Mustern',
    'aiTraders.form.rl': 'Reinforcement Learning',
    'aiTraders.form.rlDesc': 'Adaptive Strategien durch Belohnungslernen',
    'aiTraders.form.sentiment': 'Sentiment Analyse',
    'aiTraders.form.sentimentDesc': 'Marktstimmung aus News und Social Media',
    'aiTraders.form.technical': 'Technische Indikatoren',
    'aiTraders.form.technicalDesc': 'RSI, MACD, Moving Averages etc.',
    'aiTraders.form.noSignalWarning': 'Wähle mindestens eine Signalquelle',
    'aiTraders.form.watchlist': 'Watchlist Symbole',
    'aiTraders.form.watchlistHint': 'Kommagetrennte Liste von Aktien-Symbolen',
    'aiTraders.form.loadingSymbols': 'Lade verfügbare Symbole...',
    'aiTraders.form.availableSymbols': 'Verfügbar in DB',
    'aiTraders.form.selectAll': 'Alle',
    'aiTraders.form.infoTitle': 'Wie funktioniert es?',
    'aiTraders.form.infoText': 'Der AI Trader analysiert automatisch ML, RL, Sentiment und technische Signale, um Handelsentscheidungen zu treffen. Du kannst die Strategie nach der Erstellung im Dashboard weiter anpassen.',
    'aiTraders.form.cancel': 'Abbrechen',
    'aiTraders.form.creating': 'Wird erstellt...',
    'aiTraders.form.create': 'AI Trader erstellen',
    'aiTraders.risk.conservative': 'Konservativ',
    'aiTraders.risk.conservativeDesc': 'Geringeres Risiko, kleinere Positionen',
    'aiTraders.risk.moderate': 'Moderat',
    'aiTraders.risk.moderateDesc': 'Ausgewogener Ansatz',
    'aiTraders.risk.aggressive': 'Aggressiv',
    'aiTraders.risk.aggressiveDesc': 'Höheres Risiko, größere Positionen',
    'aiTraders.info.howItWorks': 'So funktioniert es',
    'aiTraders.info.paragraph1': 'Live AI Trader sind autonome Handelsagenten, die verschiedene Signalquellen (ML, RL, Sentiment, Technische Analyse) kombinieren, um Handelsentscheidungen zu treffen.',
    'aiTraders.info.paragraph2': 'Jeder Trader hat eine eigene Persönlichkeit mit konfigurierbaren Risiko- und Handelsparametern.',
    'aiTraders.info.paragraph3': 'Die Trader führen Paper Trades aus und lernen kontinuierlich aus ihren Ergebnissen.',
    'aiTraders.info.features': 'Features',
    'aiTraders.info.feature1': 'Multi-Signal-Analyse (ML, RL, Sentiment, Technisch)',
    'aiTraders.info.feature2': 'Automatische Gewichtsanpassung basierend auf Performance',
    'aiTraders.info.feature3': 'Tägliche Reports und Insights',
    'aiTraders.info.feature4': 'Echtzeit-Monitoring via SSE',
    'aiTraders.info.disclaimer': 'Hinweis',
    'aiTraders.info.disclaimerText': 'Dies ist eine Simulation zu Bildungszwecken. Keine Finanzberatung.',
  },
  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.trading': 'Trading',
    'nav.leaderboard': 'Leaderboard',
    'nav.backtest': 'Backtest',
    'nav.rlAgents': 'RL Agents',
    'nav.aiTraders': 'Live AI',
    'nav.watchlist': 'Watchlist',
    'nav.settings': 'Settings',
    'nav.info': 'Info',
    'nav.changelog': 'Changelog',
    'nav.login': 'Login',
    'nav.account': 'Account',
    
    // Settings Page
    'settings.title': 'Settings',
    'settings.subtitle': 'API keys, data sources and ML configuration',
    'settings.apiKeys': 'API Keys',
    'settings.dataSources': 'Data Sources',
    'settings.mlSettings': 'ML Settings',
    'settings.preferences': 'Display',
    'settings.language': 'Language',
    'settings.currency': 'Currency',
    'settings.languageDesc': 'User interface language',
    'settings.currencyDesc': 'Currency for all price displays',
    'settings.german': 'Deutsch',
    'settings.english': 'English',
    'settings.save': 'Save & Apply',
    'settings.saved': '✓ Saved!',
    'settings.clear': 'Clear all',
    'settings.apiConfigured': 'API keys configured',
    'settings.yahooUsed': 'Yahoo Finance is used (no API key needed)',
    'settings.marketDataApis': 'Market Data APIs',
    'settings.newsApis': 'News APIs',
    'settings.finnhubKey': 'Finnhub API Key',
    'settings.alphaVantageKey': 'Alpha Vantage API Key',
    'settings.twelveDataKey': 'Twelve Data API Key',
    'settings.newsApiKey': 'NewsAPI Key',
    'settings.marketauxKey': 'Marketaux API Key',
    'settings.marketauxDesc': 'Financial news with sentiment analysis and multi-language support (~100 requests/day)',
    'settings.fmpKey': 'Financial Modeling Prep API Key',
    'settings.fmpDesc': 'Comprehensive financial data and company news',
    'settings.tiingoKey': 'Tiingo API Key',
    'settings.tiingoDesc': 'Institutional news API with historical archive',
    'settings.rssFeeds': 'German RSS Feeds',
    'settings.enableRssFeeds': 'Enable RSS Feeds',
    'settings.rssFeedsDesc': 'Börse Frankfurt, BaFin, ECB, Bundesbank - free German financial news',
    'settings.noApiKeyRequired': 'No API key required',
    'settings.freeRegister': '(Register for free)',
    'settings.enterKey': 'Enter API key',
    'settings.keysStoredLocally': 'API keys are stored locally. When logged in, they sync with your account.',
    'settings.selectDataSource': 'Choose your preferred data source for stock prices.',
    'settings.apiUsage': 'API Usage',
    'settings.apiUsageDesc': 'Overview of your remaining API quota. Data is automatically cached to minimize API calls and respect rate limits.',
    'settings.mlConfig': 'Configure the parameters for the machine learning model.',
    'settings.sequenceLength': 'Sequence Length (Days)',
    'settings.sequenceLengthDesc': 'Number of days for input sequence (30-120)',
    'settings.forecastDays': 'Forecast Days',
    'settings.forecastDaysDesc': 'Number of days to forecast (1-30)',
    'settings.epochs': 'Epochs',
    'settings.epochsDesc': 'Training epochs (10-500)',
    'settings.learningRate': 'Learning Rate',
    'settings.learningRateDesc': 'Learning rate for training (0.0001-0.1)',
    'settings.useCuda': 'Use GPU/CUDA',
    'settings.useCudaDesc': 'Accelerates training when NVIDIA GPU is available',
    'settings.preloadFinbert': 'Preload FinBERT',
    'settings.preloadFinbertDesc': 'Loads sentiment model at startup (more RAM, faster analysis)',
    'settings.saveML': 'Save ML Settings',
    'settings.mlSaved': '✓ ML settings saved!',
    'settings.loggedIn': '✓ Logged in',
    'settings.apiKeysSynced': '✓ API keys are synced',
    'settings.customSymbolsSaved': '✓ Custom symbols are saved',
    'settings.mlSettingsAcross': '✓ ML settings across devices',
    'settings.logout': 'Log out',
    'settings.alreadyAccount': 'Already have an account?',
    'settings.signIn': 'Sign in',
    'settings.noAccount': 'No account yet?',
    'settings.register': 'Register',
    'settings.benefits': 'Benefits of an account:',
    'settings.benefit1': '• Sync API keys across devices',
    'settings.benefit2': '• Save custom symbols',
    'settings.benefit3': '• Keep ML settings',
    'settings.benefit4': '• Share watchlist between devices',
    'settings.signalSources': 'Signal Sources',
    
    // Trading Page
    'trading.title': 'Trading & Portfolio',
    'trading.tab.trading': 'Trading',
    'trading.tab.overview': 'Overview',
    'trading.tab.settings': 'Settings',
    'trading.loginRequired': 'Trading requires an account',
    'trading.loginToTrade': 'Log in to start paper trading.',
    'trading.goToSettings': 'Go to Settings',
    'trading.totalValue': 'Total Value',
    'trading.pnl': 'P&L',
    'trading.cash': 'Cash',
    'trading.newOrder': 'New Order',
    'trading.symbol': 'Symbol',
    'trading.current': 'Current',
    'trading.productType': 'Product',
    'trading.stock': 'Stock',
    'trading.side': 'Side',
    'trading.buy': 'Buy',
    'trading.sell': 'Sell',
    'trading.short': 'Short',
    'trading.quantity': 'Quantity',
    'trading.leverage': 'Leverage',
    'trading.orderType': 'Order Type',
    'trading.market': 'Market',
    'trading.limit': 'Limit',
    'trading.stop': 'Stop',
    'trading.stopLimit': 'Stop-Limit',
    'trading.limitPrice': 'Limit Price',
    'trading.stopPrice': 'Stop Price',
    'trading.stopLoss': 'Stop-Loss',
    'trading.takeProfit': 'Take-Profit',
    'trading.optional': 'optional',
    'trading.preview': 'Preview',
    'trading.notionalValue': 'Notional Value',
    'trading.fees': 'Fees',
    'trading.margin': 'Margin',
    'trading.placeOrder': 'Place Order',
    'trading.totalFees': 'Total Fees',
    'trading.openPositions': 'Open Positions',
    'trading.noPositions': 'No open positions',
    'trading.position': 'Position',
    'trading.entry': 'Entry',
    'trading.price': 'Price',
    'trading.value': 'Value',
    'trading.marginUsed': 'Margin',
    'trading.feesPaid': 'Fees',
    'trading.close': 'Close',
    'trading.edit': 'Edit',
    'trading.save': 'Save',
    'trading.cancel': 'Cancel',
    'trading.liquidation': 'Liquidation',
    'trading.pendingOrders': 'Pending Orders',
    'trading.noPendingOrders': 'No pending orders',
    'trading.portfolioNotLoaded': 'Could not load portfolio',
    'trading.enterValidQuantity': 'Please enter a valid quantity',
    'trading.enterValidLimitPrice': 'Please enter a valid limit price',
    'trading.enterValidStopPrice': 'Please enter a valid stop price',
    'trading.enterValidBothPrices': 'Please enter valid stop and limit prices',
    'trading.orderCreated': 'Order created for',
    'trading.orderFailed': 'Could not create order',
    'trading.orderExecuted': 'Order executed',
    'trading.positionClosed': 'Position closed',
    'trading.capitalChanged': 'Initial capital changed to {amount}',
    'trading.resetPortfolio': 'Reset Portfolio',
    'trading.resetConfirm': 'Are you sure? All positions and history will be deleted.',
    'trading.resetYes': 'Yes, reset',
    'trading.resetNo': 'Cancel',
    'trading.brokerProfile': 'Broker Profile',
    'trading.initialCapital': 'Initial Capital',
    'trading.changeCapital': 'Change Capital',
    
    // Dashboard
    'dashboard.analyzingWatchlist': 'Analyzing watchlist for best recommendation...',
    'dashboard.quickTrade': 'Quick Trade',
    'dashboard.invalidQuantity': 'Invalid quantity',
    'dashboard.purchaseSuccess': 'Purchase successful! New balance:',
    'dashboard.sellSuccess': 'Sale successful! New balance:',
    'dashboard.shortSuccess': 'Short successful! New balance:',
    'dashboard.noPortfolio': 'No Portfolio',
    'dashboard.loginToTrade': 'Log in to trade',
    'dashboard.available': 'Available',
    'dashboard.tradeFailed': 'Trade failed',
    'dashboard.loadingChart': 'Loading chart...',
    'dashboard.noData': 'No data available',
    
    // Watchlist
    'watchlist.title': 'Watchlist',
    'watchlist.addSymbol': 'Add Symbol',
    'watchlist.noSymbols': 'No symbols in watchlist',
    'watchlist.remove': 'Remove',
    'watchlist.analyze': 'Analyze',
    'watchlist.trade': 'Trade',
    
    // Leaderboard
    'leaderboard.title': 'Leaderboard',
    'leaderboard.rank': 'Rank',
    'leaderboard.trader': 'Trader',
    'leaderboard.totalReturn': 'Total Return',
    'leaderboard.winRate': 'Win Rate',
    'leaderboard.trades': 'Trades',
    'leaderboard.yourRank': 'Your Rank',
    
    // Backtest
    'backtest.title': 'Backtest',
    'backtest.strategy': 'Strategy',
    'backtest.period': 'Period',
    'backtest.run': 'Run Backtest',
    'backtest.results': 'Results',
    
    // Common
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.close': 'Close',
    'common.yes': 'Yes',
    'common.no': 'No',
    
    // Footer
    'footer.disclaimer': '⚠️ Disclaimer: This is for educational/testing purposes only. Not financial advice.',
    
    // Forecast
    'forecast.title': 'Forecast',
    'forecast.mlTitle': 'ML Forecast',
    'forecast.days': 'Days',
    'forecast.confidence': 'Confidence',
    'forecast.expected': 'Expected',
    'forecast.bullish': 'Bullish',
    'forecast.bearish': 'Bearish',
    'forecast.neutral': 'Neutral',
    
    // News
    'news.title': 'News',
    'news.sentiment': 'Sentiment',
    'news.noNews': 'No news available',
    
    // Signals
    'signals.title': 'Trading Signals',
    'signals.recommendation': 'Recommendation',
    'signals.strongBuy': 'Strong Buy',
    'signals.buy': 'Buy',
    'signals.hold': 'Hold',
    'signals.sell': 'Sell',
    'signals.strongSell': 'Strong Sell',
    
    // Company Info
    'company.info': 'Company Info',
    'company.sector': 'Sector',
    'company.industry': 'Industry',
    'company.marketCap': 'Market Cap',
    'company.employees': 'Employees',
    'company.description': 'Description',
    
    // Leaderboard Page
    'leaderboard.description': 'Top traders by performance',
    'leaderboard.timeframe.all': 'All Time',
    'leaderboard.timeframe.month': '30 Days',
    'leaderboard.timeframe.week': '7 Days',
    'leaderboard.timeframe.day': 'Today',
    'leaderboard.loadError': 'Could not load leaderboard',
    'leaderboard.notRanked': 'Not yet ranked',
    'leaderboard.tradeToAppear': 'Execute trades to appear on the leaderboard.',
    'leaderboard.loginPrompt': 'Log in to see your ranking.',
    'leaderboard.noTraders': 'No traders on the leaderboard yet.',
    'leaderboard.joined': 'Joined',
    'leaderboard.columns.rank': 'Rank',
    'leaderboard.columns.trader': 'Trader',
    'leaderboard.columns.return': 'Return',
    'leaderboard.columns.winRate': 'Win Rate',
    'leaderboard.columns.trades': 'Trades',
    
    // WatchlistPage
    'watchlistPage.title': 'My Watchlist',
    'watchlistPage.description': 'Overview of all watched stocks with trading recommendations',
    
    // LoginForm
    'login.email': 'E-Mail',
    'login.password': 'Password',
    'login.failed': 'Login failed',
    'login.loggingIn': 'Logging in...',
    'login.submit': 'Log in',
    
    // RegisterForm
    'register.username': 'Username',
    'register.email': 'E-Mail',
    'register.password': 'Password',
    'register.confirmPassword': 'Confirm Password',
    'register.failed': 'Registration failed',
    'register.registering': 'Registering...',
    'register.submit': 'Register',
    
    // Backtest Page
    'backtest.description': 'Test trading strategies with historical data',
    'backtest.sessions': 'Sessions',
    'backtest.newSession': 'New Session',
    'backtest.sessionName': 'Session Name',
    'backtest.startDate': 'Start Date',
    'backtest.endDate': 'End Date',
    'backtest.capital': 'Initial Capital',
    'backtest.create': 'Create',
    'backtest.delete': 'Delete',
    'backtest.loadError': 'Could not load backtest',
    'backtest.noSessions': 'No Sessions',
    'backtest.createFirst': 'Create a new backtest session',
    'backtest.currentDate': 'Current Date',
    'backtest.advanceTime': 'Advance Time',
    'backtest.autoPlay': 'Auto-Play',
    'backtest.pause': 'Pause',
    
    // Trading errors/messages
    'trading.orderSuccess': 'Order successful',
    'trading.loadError': 'Could not load portfolio',
    'trading.quoteError': 'Could not fetch quote',
    'trading.closeError': 'Could not close position',
    'trading.updateSuccess': 'Stop-Loss/Take-Profit updated',
    'trading.updateError': 'Error updating',
    'trading.resetSuccess': 'Portfolio was reset',
    'trading.resetError': 'Reset failed',
    'trading.invalidAmount': 'Invalid amount',
    'trading.settingsError': 'Could not save setting',
    'trading.brokerChanged': 'Broker profile changed',
    'trading.loginPrompt': 'Log in to trade with virtual money and manage your portfolio.',
    'trading.executed': 'Order {symbol} executed',
    'trading.stopLossTriggered': 'Stop-Loss',
    'trading.takeProfitTriggered': 'Take-Profit',
    'trading.knockoutTriggered': 'Knock-Out',
    'trading.marginCallTriggered': 'Margin-Call',
    
    // Periods
    'period.hourly': 'Hourly',
    'period.daily': 'Daily',
    'period.weekly': 'Weekly',
    'period.longTerm': 'Long-term',
    
    // Sort
    'sort.name': 'Name',
    'sort.score': 'Score',
    
    // Market Cap
    'marketCap.trillion': 'T',
    'marketCap.billion': 'B',
    'marketCap.million': 'M',
    'marketCap.thousand': 'K',
    
    // ForecastPanel (AI Forecast)
    'forecast.aiTitle': 'AI Forecast',
    'forecast.currentPrice': 'Current Price',
    'forecast.priceTarget': 'Price Target',
    'forecast.supportLevel': 'Support Level',
    'forecast.resistanceLevel': 'Resistance Level',
    'forecast.indicatorAgreement': 'Indicator Agreement',
    'forecast.analysisSummary': 'Analysis Summary',
    'forecast.technicalIndicators': 'Technical Indicators',
    'forecast.agreement': 'Agreement',
    'forecast.agreementStrong': 'strong',
    'forecast.agreementModerate': 'moderate',
    'forecast.agreementWeak': 'weak',
    'forecast.agreementConflicting': 'conflicting',
    'forecast.conflictingWarning': 'This indicator contradicts the majority - interpret with caution',
    
    // MLForecastPanel
    'ml.prediction': 'ML Prediction',
    'ml.notAvailable': 'ML Service is not available. Start the ml-service container to enable AI predictions.',
    'ml.noModel': 'No ML model trained for {symbol}',
    'ml.trainHint': 'Click "Train Model" to create an LSTM prediction model using historical data',
    'ml.trainModel': 'Train Model',
    'ml.refresh': 'Refresh',
    'ml.deleteModel': 'Delete Model',
    'ml.training': 'Training {symbol}...',
    'ml.currentPrice': 'Current Price',
    'ml.target7day': '7-Day Target',
    'ml.target14day': '14-Day Target',
    'ml.day': 'Day',
    'ml.price': 'Price',
    'ml.change': 'Change',
    'ml.modelInfo': 'Model trained on {points} data points • Device: {device} • Val Loss: {loss}',
    'ml.disclaimer': '⚠️ ML predictions are experimental and for educational purposes only. Not financial advice.',
    'ml.loading': 'Loading...',
    'ml.modelError': 'Model error: Prediction is for {predSymbol}, not {symbol}',
    'ml.modelOutdated': 'Model data outdated: Please retrain model',
    'ml.notEnoughData': 'Could not load enough data. Required: {required}, Available: {available}',
    'ml.loadingError': 'Error loading additional data',
    
    // CompanyInfoPanel
    'company.derivative': 'Derivative / Leveraged Product',
    'company.leveraged': 'Leveraged Product',
    'company.leverage': 'Leverage',
    'company.knockout': 'Knock-Out',
    'company.strike': 'Strike',
    'company.expiration': 'Expiration',
    'company.underlying': 'Underlying',
    'company.overnight': 'Overnight',
    'company.spread': 'Spread',
    'company.derivativeWarning': 'Leveraged products carry increased risks. Total loss possible.',
    'company.leveragedWarning': 'Leveraged ETFs are subject to path dependency effect. Not suitable for long-term holding.',
    'company.peRatio': 'P/E Ratio',
    'company.forwardPE': 'Fwd',
    'company.dividendYield': 'Dividend Yield',
    'company.eps': 'EPS',
    'company.volume': 'Volume (today)',
    'company.beta': 'Beta',
    'company.weekRange': '52-Week Range',
    'company.current': 'Current',
    'company.pricesConverted': 'Prices converted to EUR at current exchange rate',
    'company.noData': 'No data available',
    'company.loadError': 'Error loading data',
    
    // AI Traders Page
    'aiTraders.title': 'Live AI Traders',
    'aiTraders.description': 'Create and manage autonomous AI trading agents',
    'aiTraders.newTrader': 'New AI Trader',
    'aiTraders.createTitle': 'Create New AI Trader',
    'aiTraders.loginRequired': 'Please log in to manage AI traders.',
    'aiTraders.loadError': 'Failed to load AI traders',
    'aiTraders.nameRequired': 'Name is required',
    'aiTraders.createSuccess': 'AI Trader "{name}" created successfully!',
    'aiTraders.createError': 'Failed to create AI trader',
    'aiTraders.confirmDelete': 'Are you sure you want to delete AI Trader "{name}"?',
    'aiTraders.deleteSuccess': 'AI Trader "{name}" deleted',
    'aiTraders.deleteError': 'Failed to delete AI trader',
    'aiTraders.noTraders': 'No AI Traders yet',
    'aiTraders.noTradersHint': 'Create your first AI trader to get started.',
    'aiTraders.viewDashboard': 'Dashboard',
    'aiTraders.trades': 'Trades',
    'aiTraders.winRate': 'Win Rate',
    'aiTraders.form.name': 'Name',
    'aiTraders.form.namePlaceholder': 'e.g. Momentum Master',
    'aiTraders.form.nameHint': 'Click "Suggest" for an automatic name based on settings',
    'aiTraders.form.suggest': 'Suggest',
    'aiTraders.form.suggestName': 'Suggest name based on settings',
    'aiTraders.form.description': 'Description (optional)',
    'aiTraders.form.descriptionPlaceholder': 'Describe the strategy...',
    'aiTraders.form.avatar': 'Avatar',
    'aiTraders.form.initialCapital': 'Initial Capital',
    'aiTraders.form.capitalHint': 'Virtual starting capital for paper trading',
    'aiTraders.form.riskTolerance': 'Risk Tolerance',
    'aiTraders.form.signalSources': 'Signal Sources',
    'aiTraders.form.signalSourcesHint': 'Choose which signal sources the trader should use',
    'aiTraders.form.ml': 'Machine Learning',
    'aiTraders.form.mlDesc': 'Predictions based on historical patterns',
    'aiTraders.form.rl': 'Reinforcement Learning',
    'aiTraders.form.rlDesc': 'Adaptive strategies through reward learning',
    'aiTraders.form.sentiment': 'Sentiment Analysis',
    'aiTraders.form.sentimentDesc': 'Market mood from news and social media',
    'aiTraders.form.technical': 'Technical Indicators',
    'aiTraders.form.technicalDesc': 'RSI, MACD, Moving Averages etc.',
    'aiTraders.form.noSignalWarning': 'Select at least one signal source',
    'aiTraders.form.watchlist': 'Watchlist Symbols',
    'aiTraders.form.watchlistHint': 'Comma-separated list of stock symbols',
    'aiTraders.form.loadingSymbols': 'Loading available symbols...',
    'aiTraders.form.availableSymbols': 'Available in DB',
    'aiTraders.form.selectAll': 'All',
    'aiTraders.form.infoTitle': 'How does it work?',
    'aiTraders.form.infoText': 'The AI Trader automatically analyzes ML, RL, Sentiment, and Technical signals to make trading decisions. You can further customize the strategy in the dashboard after creation.',
    'aiTraders.form.cancel': 'Cancel',
    'aiTraders.form.creating': 'Creating...',
    'aiTraders.form.create': 'Create AI Trader',
    'aiTraders.risk.conservative': 'Conservative',
    'aiTraders.risk.conservativeDesc': 'Lower risk, smaller positions',
    'aiTraders.risk.moderate': 'Moderate',
    'aiTraders.risk.moderateDesc': 'Balanced approach',
    'aiTraders.risk.aggressive': 'Aggressive',
    'aiTraders.risk.aggressiveDesc': 'Higher risk, larger positions',
    'aiTraders.info.howItWorks': 'How It Works',
    'aiTraders.info.paragraph1': 'Live AI Traders are autonomous trading agents that combine multiple signal sources (ML, RL, Sentiment, Technical Analysis) to make trading decisions.',
    'aiTraders.info.paragraph2': 'Each trader has its own personality with configurable risk and trading parameters.',
    'aiTraders.info.paragraph3': 'Traders execute paper trades and continuously learn from their results.',
    'aiTraders.info.features': 'Features',
    'aiTraders.info.feature1': 'Multi-signal analysis (ML, RL, Sentiment, Technical)',
    'aiTraders.info.feature2': 'Automatic weight adjustment based on performance',
    'aiTraders.info.feature3': 'Daily reports and insights',
    'aiTraders.info.feature4': 'Real-time monitoring via SSE',
    'aiTraders.info.disclaimer': 'Disclaimer',
    'aiTraders.info.disclaimerText': 'This is a simulation for educational purposes. Not financial advice.',
  },
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadStoredSettings);
  const eurRateRef = useRef<number>(DEFAULT_EUR_RATE);

  // Fetch and update EUR rate on mount and every 5 minutes
  useEffect(() => {
    const fetchEurRate = async () => {
      try {
        const rate = await getEurUsdRate();
        if (rate > 0) {
          eurRateRef.current = rate;
          updateEurRate(rate); // Update global rate for formatCurrencyValue
          console.log(`[Settings] EUR rate updated: ${rate}`);
        }
      } catch (e) {
        console.warn('Failed to fetch EUR rate:', e);
      }
    };

    // Fetch immediately
    fetchEurRate();

    // Refresh every 5 minutes
    const interval = setInterval(fetchEurRate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Load settings from server when authenticated
  useEffect(() => {
    const loadServerSettings = async () => {
      const { isAuthenticated } = getAuthState();
      if (isAuthenticated) {
        try {
          const serverSettings = await getUserSettings();
          if (serverSettings?.uiPreferences) {
            const prefs = serverSettings.uiPreferences as Partial<Settings>;
            if (prefs.language || prefs.currency) {
              setSettings(prev => ({
                ...prev,
                ...(prefs.language && { language: prefs.language }),
                ...(prefs.currency && { currency: prefs.currency }),
              }));
            }
          }
        } catch (e) {
          console.warn('Failed to load server settings:', e);
        }
      }
    };

    loadServerSettings();
    return subscribeToAuth(loadServerSettings);
  }, []);

  // Save settings whenever they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const setLanguage = useCallback((lang: Language) => {
    setSettings(prev => ({ ...prev, language: lang }));
    
    // Sync to server if authenticated
    const { isAuthenticated } = getAuthState();
    if (isAuthenticated) {
      updateUserSettings({
        uiPreferences: { language: lang },
      }).catch(console.warn);
    }
  }, []);

  const setCurrency = useCallback((curr: Currency) => {
    setSettings(prev => ({ ...prev, currency: curr }));
    
    // Sync to server if authenticated
    const { isAuthenticated } = getAuthState();
    if (isAuthenticated) {
      updateUserSettings({
        uiPreferences: { currency: curr },
      }).catch(console.warn);
    }
  }, []);

  const t = useCallback((key: string): string => {
    return translations[settings.language][key] || key;
  }, [settings.language]);

  const formatCurrencyValue = useCallback((value: number): string => {
    const { currency } = settings;
    
    // Convert USD to EUR if needed (using dynamically fetched rate)
    const convertedValue = currency === 'EUR' ? value * eurRateRef.current : value;
    
    const locale = currency === 'EUR' ? 'de-DE' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(convertedValue);
  }, [settings]);

  const formatPrice = useCallback((value: number): string => {
    // Same as formatCurrencyValue but can be customized for price display
    return formatCurrencyValue(value);
  }, [formatCurrencyValue]);

  return (
    <SettingsContext.Provider value={{
      language: settings.language,
      currency: settings.currency,
      setLanguage,
      setCurrency,
      t,
      formatCurrency: formatCurrencyValue,
      formatPrice,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

export default SettingsContext;
