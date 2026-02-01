/**
 * Info Page
 * 
 * Comprehensive documentation of all features, indicators, and AI systems.
 * Designed to be accessible for beginners while providing depth for experts.
 */

import { useState } from 'react';
import { ChangelogPanel } from '../components/ChangelogPanel';

type InfoTab = 'handbook' | 'changelog';

// Collapsible Section Component
function Section({ 
  title, 
  icon, 
  children, 
  defaultOpen = false,
  color = 'blue'
}: { 
  title: string; 
  icon: string; 
  children: React.ReactNode;
  defaultOpen?: boolean;
  color?: 'blue' | 'green' | 'purple' | 'yellow' | 'red' | 'orange';
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  const colorClasses = {
    blue: 'border-blue-500/30 hover:border-blue-500/50',
    green: 'border-green-500/30 hover:border-green-500/50',
    purple: 'border-purple-500/30 hover:border-purple-500/50',
    yellow: 'border-yellow-500/30 hover:border-yellow-500/50',
    red: 'border-red-500/30 hover:border-red-500/50',
    orange: 'border-orange-500/30 hover:border-orange-500/50',
  };
  
  return (
    <div className={`bg-slate-800/50 rounded-xl border ${colorClasses[color]} transition-colors`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 sm:p-6 flex items-center justify-between text-left"
        title={isOpen ? "Abschnitt zuklappen" : "Abschnitt aufklappen"}
        aria-expanded={isOpen}
      >
        <h2 className="text-lg sm:text-xl font-semibold text-white flex items-center gap-2 sm:gap-3">
          <span className="text-xl sm:text-2xl">{icon}</span>
          {title}
        </h2>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-0">
          {children}
        </div>
      )}
    </div>
  );
}

// Info Card Component
function InfoCard({ 
  title, 
  icon, 
  children,
  color = 'slate'
}: { 
  title: string; 
  icon: string;
  children: React.ReactNode;
  color?: 'slate' | 'green' | 'red' | 'blue' | 'purple' | 'yellow';
}) {
  const bgColors = {
    slate: 'bg-slate-900/50',
    green: 'bg-green-900/20 border border-green-500/20',
    red: 'bg-red-900/20 border border-red-500/20',
    blue: 'bg-blue-900/20 border border-blue-500/20',
    purple: 'bg-purple-900/20 border border-purple-500/20',
    yellow: 'bg-yellow-900/20 border border-yellow-500/20',
  };
  
  return (
    <div className={`${bgColors[color]} rounded-lg p-4`}>
      <h4 className="font-medium text-white flex items-center gap-2 mb-2">
        <span>{icon}</span>
        {title}
      </h4>
      <div className="text-sm text-gray-300">
        {children}
      </div>
    </div>
  );
}

// Visual Scale Component
function VisualScale({ 
  labels, 
  colors 
}: { 
  labels: string[]; 
  colors: string[];
}) {
  return (
    <div className="flex items-center gap-1 my-3">
      {colors.map((color, idx) => (
        <div key={idx} className="flex-1 flex flex-col items-center">
          <div className={`w-full h-3 ${color} ${idx === 0 ? 'rounded-l' : ''} ${idx === colors.length - 1 ? 'rounded-r' : ''}`} />
          <span className="text-[10px] text-gray-500 mt-1">{labels[idx]}</span>
        </div>
      ))}
    </div>
  );
}

export function InfoPage() {
  const [activeTab, setActiveTab] = useState<InfoTab>('handbook');
  
  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 flex-1 flex flex-col">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
          <span className="text-3xl sm:text-4xl">📚</span>
          DayTrader AI - Hilfe & Info
        </h1>
        <p className="text-gray-400 mt-2 text-sm sm:text-base">
          Handbuch, Dokumentation und Änderungsprotokoll
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-700 mb-4">
        <button
          onClick={() => setActiveTab('handbook')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'handbook'
              ? 'border-blue-400 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span>📖</span>
          <span>Handbuch</span>
        </button>
        <button
          onClick={() => setActiveTab('changelog')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'changelog'
              ? 'border-blue-400 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span>📝</span>
          <span>Changelog</span>
        </button>
      </div>

      {/* Changelog Tab */}
      {activeTab === 'changelog' && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4 sm:p-6 flex-1 overflow-auto">
          <ChangelogPanel />
        </div>
      )}

      {/* Handbook Tab */}
      {activeTab === 'handbook' && (
      <div className="flex-1 overflow-auto">

      {/* Quick Overview */}
      <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 rounded-xl border border-blue-500/30 p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold text-white mb-4">🎯 Was macht diese App?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-800/50 rounded-lg p-3 text-center">
            <div className="text-3xl mb-2">📰</div>
            <div className="text-sm font-medium text-white">News analysieren</div>
            <div className="text-xs text-gray-400 mt-1">KI liest Nachrichten und erkennt Stimmung</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 text-center">
            <div className="text-3xl mb-2">📊</div>
            <div className="text-sm font-medium text-white">Charts auswerten</div>
            <div className="text-xs text-gray-400 mt-1">Technische Indikatoren berechnen Trends</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 text-center">
            <div className="text-3xl mb-2">🤖</div>
            <div className="text-sm font-medium text-white">Kurse vorhersagen</div>
            <div className="text-xs text-gray-400 mt-1">ML-Modelle prognostizieren die Zukunft</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 text-center">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-sm font-medium text-white">Signale kombinieren</div>
            <div className="text-xs text-gray-400 mt-1">Alles fließt in Kauf/Verkauf-Empfehlungen</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        
        {/* Trading Signals - Most Important */}
        <Section title="Trading-Signale verstehen" icon="🚦" defaultOpen={true} color="green">
          <div className="space-y-6">
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Was bedeuten die Signale?</h3>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-3">
                <div className="bg-green-900/30 rounded-lg p-3 text-center border border-green-500/30">
                  <div className="text-2xl mb-1">🚀</div>
                  <div className="text-green-400 font-medium text-sm">Stark Kaufen</div>
                  <div className="text-[10px] text-gray-400 mt-1">Score &gt; 50</div>
                  <div className="text-[10px] text-gray-500">Sehr bullish</div>
                </div>
                <div className="bg-green-900/20 rounded-lg p-3 text-center border border-green-500/20">
                  <div className="text-2xl mb-1">📈</div>
                  <div className="text-green-300 font-medium text-sm">Kaufen</div>
                  <div className="text-[10px] text-gray-400 mt-1">Score 20-50</div>
                  <div className="text-[10px] text-gray-500">Bullish</div>
                </div>
                <div className="bg-slate-700/30 rounded-lg p-3 text-center border border-slate-500/20">
                  <div className="text-2xl mb-1">➡️</div>
                  <div className="text-gray-300 font-medium text-sm">Halten</div>
                  <div className="text-[10px] text-gray-400 mt-1">Score -20 bis 20</div>
                  <div className="text-[10px] text-gray-500">Neutral</div>
                </div>
                <div className="bg-red-900/20 rounded-lg p-3 text-center border border-red-500/20">
                  <div className="text-2xl mb-1">📉</div>
                  <div className="text-red-300 font-medium text-sm">Verkaufen</div>
                  <div className="text-[10px] text-gray-400 mt-1">Score -50 bis -20</div>
                  <div className="text-[10px] text-gray-500">Bearish</div>
                </div>
                <div className="bg-red-900/30 rounded-lg p-3 text-center border border-red-500/30">
                  <div className="text-2xl mb-1">⚠️</div>
                  <div className="text-red-400 font-medium text-sm">Stark Verkaufen</div>
                  <div className="text-[10px] text-gray-400 mt-1">Score &lt; -50</div>
                  <div className="text-[10px] text-gray-500">Sehr bearish</div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-white font-medium mb-3">Zeiträume - Wofür sind sie gedacht?</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <InfoCard title="1 Stunde" icon="⚡" color="yellow">
                  <p className="text-xs">Für <strong>Daytrader</strong> und Scalper. Basiert hauptsächlich auf News und schnellen Indikatoren.</p>
                  <p className="text-[10px] text-gray-500 mt-2">News: 55% • Tech: 35% • ML: 10%</p>
                </InfoCard>
                <InfoCard title="1 Tag" icon="📅" color="blue">
                  <p className="text-xs">Für <strong>Swing-Trader</strong>. Ausgewogene Mischung aus allen Quellen.</p>
                  <p className="text-[10px] text-gray-500 mt-2">News: 40% • Tech: 40% • ML: 20%</p>
                </InfoCard>
                <InfoCard title="Wochen" icon="📆" color="purple">
                  <p className="text-xs">Für <strong>Position-Trader</strong>. Technische Trends werden wichtiger als News.</p>
                  <p className="text-[10px] text-gray-500 mt-2">News: 25% • Tech: 45% • ML: 30%</p>
                </InfoCard>
                <InfoCard title="Langfristig" icon="🏦" color="green">
                  <p className="text-xs">Für <strong>Investoren</strong>. ML-Vorhersagen und Trends dominieren.</p>
                  <p className="text-[10px] text-gray-500 mt-2">News: 15% • Tech: 45% • ML: 40%</p>
                </InfoCard>
              </div>
            </div>

            <div>
              <h3 className="text-white font-medium mb-3">Woher kommen die Signale?</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3 bg-slate-900/50 rounded-lg p-3">
                  <span className="text-2xl">📰</span>
                  <div>
                    <div className="font-medium text-yellow-400">News Sentiment</div>
                    <p className="text-xs text-gray-400 mt-1">
                      Eine KI (FinBERT) liest aktuelle Nachrichtenartikel und bewertet, ob sie positiv, negativ oder neutral für die Aktie sind.
                      Gute Nachrichten → bullishes Signal, schlechte → bearish.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 bg-slate-900/50 rounded-lg p-3">
                  <span className="text-2xl">📊</span>
                  <div>
                    <div className="font-medium text-blue-400">Technische Indikatoren</div>
                    <p className="text-xs text-gray-400 mt-1">
                      Mathematische Berechnungen auf historischen Kursdaten: RSI (Überkauft/Überverkauft), MACD (Trendwechsel), 
                      Bollinger Bänder (Volatilität), Stochastic (Momentum).
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 bg-slate-900/50 rounded-lg p-3">
                  <span className="text-2xl">🤖</span>
                  <div>
                    <div className="font-medium text-purple-400">ML-Vorhersage (LSTM)</div>
                    <p className="text-xs text-gray-400 mt-1">
                      Ein neuronales Netzwerk lernt Muster aus historischen Kursen und prognostiziert zukünftige Preise.
                      Steigt die Prognose → bullish, fällt sie → bearish.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 bg-slate-900/50 rounded-lg p-3">
                  <span className="text-2xl">🎯</span>
                  <div>
                    <div className="font-medium text-green-400">RL-Agenten (optional)</div>
                    <p className="text-xs text-gray-400 mt-1">
                      Virtuelle Trader, die durch Reinforcement Learning gelernt haben, wann man kaufen/verkaufen sollte.
                      Verschiedene Agenten haben verschiedene Strategien (aggressiv, konservativ, etc.).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* News Sentiment */}
        <Section title="News Sentiment Analyse" icon="📰" color="yellow">
          <div className="space-y-4">
            <p className="text-gray-300 text-sm">
              Die App sammelt automatisch Nachrichtenartikel zu deiner Aktie und analysiert deren Stimmung mit KI.
            </p>
            
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Wie funktioniert FinBERT?</h3>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="flex-1 space-y-2 text-sm text-gray-300">
                  <p>1. 📥 Artikel wird heruntergeladen</p>
                  <p>2. 🔤 Text wird in Tokens zerlegt</p>
                  <p>3. 🧠 FinBERT (speziell für Finanzen trainiert) analysiert</p>
                  <p>4. 📊 Ergebnis: Positiv, Negativ oder Neutral + Konfidenz</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-4 text-center">
                  <div className="text-sm text-gray-400 mb-2">Beispiel-Output:</div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-4 text-xs">
                      <span>🟢 Positiv:</span>
                      <span className="text-green-400 font-mono">78%</span>
                    </div>
                    <div className="flex justify-between gap-4 text-xs">
                      <span>⚪ Neutral:</span>
                      <span className="text-gray-400 font-mono">15%</span>
                    </div>
                    <div className="flex justify-between gap-4 text-xs">
                      <span>🔴 Negativ:</span>
                      <span className="text-red-400 font-mono">7%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <InfoCard title="Bullish News" icon="🟢" color="green">
                <p className="text-xs">Gewinnsteigerung, neue Produkte, Übernahmen, positive Analystenratings</p>
              </InfoCard>
              <InfoCard title="Neutrale News" icon="⚪">
                <p className="text-xs">Routine-Meldungen, Branchennews ohne direkten Bezug</p>
              </InfoCard>
              <InfoCard title="Bearish News" icon="🔴" color="red">
                <p className="text-xs">Gewinnwarnung, Rechtsstreitigkeiten, Managementwechsel, Rückrufe</p>
              </InfoCard>
            </div>
          </div>
        </Section>

        {/* Technical Indicators */}
        <Section title="Technische Indikatoren" icon="📊" color="blue">
          <div className="space-y-6">
            
            {/* RSI */}
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-2">RSI (Relative Strength Index)</h3>
              <p className="text-sm text-gray-400 mb-3">
                Misst, ob eine Aktie "überkauft" oder "überverkauft" ist. Skala von 0-100.
              </p>
              <VisualScale 
                labels={['Überverkauft', 'Neutral', 'Überkauft']} 
                colors={['bg-green-500', 'bg-slate-500', 'bg-red-500']} 
              />
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="text-green-400">
                  <div className="font-bold">RSI &lt; 30</div>
                  <div className="text-gray-500">Kaufchance?</div>
                </div>
                <div className="text-gray-400">
                  <div className="font-bold">RSI 30-70</div>
                  <div className="text-gray-500">Neutral</div>
                </div>
                <div className="text-red-400">
                  <div className="font-bold">RSI &gt; 70</div>
                  <div className="text-gray-500">Vorsicht!</div>
                </div>
              </div>
            </div>

            {/* MACD */}
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-2">MACD (Moving Average Convergence Divergence)</h3>
              <p className="text-sm text-gray-400 mb-3">
                Zeigt Trendwechsel und Momentum. Besteht aus MACD-Linie, Signal-Linie und Histogramm.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-green-900/20 border border-green-500/20 rounded-lg p-3">
                  <div className="text-green-400 font-medium text-sm mb-1">📈 Kaufsignal</div>
                  <p className="text-xs text-gray-400">MACD kreuzt Signal-Linie <strong>von unten nach oben</strong></p>
                </div>
                <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3">
                  <div className="text-red-400 font-medium text-sm mb-1">📉 Verkaufssignal</div>
                  <p className="text-xs text-gray-400">MACD kreuzt Signal-Linie <strong>von oben nach unten</strong></p>
                </div>
              </div>
            </div>

            {/* Bollinger Bands */}
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-2">Bollinger Bänder</h3>
              <p className="text-sm text-gray-400 mb-3">
                Drei Linien, die die Volatilität zeigen. Der Preis bewegt sich meist innerhalb der Bänder.
              </p>
              <div className="bg-slate-800 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-full h-2 bg-red-500/50 rounded" />
                  <span className="text-xs text-gray-400 whitespace-nowrap">Oberes Band</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-full h-2 bg-yellow-500/50 rounded" />
                  <span className="text-xs text-gray-400 whitespace-nowrap">Mittleres Band (SMA)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-full h-2 bg-green-500/50 rounded" />
                  <span className="text-xs text-gray-400 whitespace-nowrap">Unteres Band</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                💡 <strong>Squeeze:</strong> Wenn die Bänder eng zusammenlaufen, steht oft eine große Bewegung bevor!
              </p>
            </div>

            {/* Moving Averages */}
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-2">Gleitende Durchschnitte (SMA & EMA)</h3>
              <p className="text-sm text-gray-400 mb-3">
                Glätten den Kursverlauf und zeigen Trends. EMA reagiert schneller als SMA.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-blue-400 font-medium text-sm mb-1">SMA (Simple)</div>
                  <p className="text-xs text-gray-400">Einfacher Durchschnitt der letzten X Tage</p>
                  <p className="text-xs text-gray-500 mt-1">SMA20, SMA50 sind Standard</p>
                </div>
                <div>
                  <div className="text-purple-400 font-medium text-sm mb-1">EMA (Exponential)</div>
                  <p className="text-xs text-gray-400">Gewichtet neuere Kurse stärker</p>
                  <p className="text-xs text-gray-500 mt-1">EMA12, EMA26 für MACD</p>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ML Prediction */}
        <Section title="ML-Vorhersage (LSTM)" icon="🤖" color="purple">
          <div className="space-y-4">
            <p className="text-gray-300 text-sm">
              Ein neuronales Netzwerk analysiert historische Kursmuster und prognostiziert zukünftige Preise.
            </p>
            
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Wie funktioniert das LSTM-Modell?</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-500/30 rounded-full flex items-center justify-center text-sm">1</div>
                  <div className="text-sm text-gray-300">
                    <strong>Training:</strong> Das Modell lernt Muster aus 330+ Tagen historischer Daten
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-500/30 rounded-full flex items-center justify-center text-sm">2</div>
                  <div className="text-sm text-gray-300">
                    <strong>Features:</strong> Preis, Volumen, RSI, MACD, Bollinger, Momentum
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-500/30 rounded-full flex items-center justify-center text-sm">3</div>
                  <div className="text-sm text-gray-300">
                    <strong>Vorhersage:</strong> Prognose für die nächsten 14 Tage mit Konfidenz
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoCard title="Kursziel" icon="🎯" color="blue">
                <p className="text-xs">Prognostizierter Preis für verschiedene Zeitpunkte. Grün = über aktuellem Kurs, Rot = darunter.</p>
              </InfoCard>
              <InfoCard title="Konfidenz" icon="📊" color="purple">
                <p className="text-xs">Wie sicher ist sich das Modell? Höhere Konfidenz = zuverlässigere Vorhersage (aber nie 100%!).</p>
              </InfoCard>
            </div>

            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
              <p className="text-xs text-yellow-200">
                ⚠️ <strong>Wichtig:</strong> ML-Vorhersagen sind keine Garantie! Märkte können unvorhersehbar sein, 
                besonders bei plötzlichen Nachrichten oder externen Ereignissen.
              </p>
            </div>
          </div>
        </Section>

        {/* RL Agents */}
        <Section title="RL-Agenten (Reinforcement Learning)" icon="🎯" color="green">
          <div className="space-y-4">
            <p className="text-gray-300 text-sm">
              Virtuelle Trader, die durch Millionen von simulierten Trades gelernt haben, wann man kaufen/verkaufen sollte.
            </p>
            
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Was ist Reinforcement Learning?</h3>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 text-sm text-gray-300 space-y-2">
                  <p>🎮 Der Agent "spielt" den Aktienmarkt wie ein Spiel</p>
                  <p>💰 Er bekommt "Belohnungen" für gute Trades (Gewinn)</p>
                  <p>💸 Er bekommt "Strafen" für schlechte Trades (Verlust)</p>
                  <p>🧠 Er lernt, welche Aktionen in welchen Situationen gut sind</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3 text-center">
                  <div className="text-4xl mb-2">🤖</div>
                  <div className="text-xs text-gray-400">PPO-Algorithmus</div>
                  <div className="text-xs text-gray-500">~100.000 Trainingsepisoden</div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-white font-medium mb-3">Unsere vortrainierten Agenten</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <InfoCard title="Day Trader" icon="⚡" color="yellow">
                  <p className="text-xs">Aggressiv, kurze Haltedauer, reagiert schnell auf Signale</p>
                </InfoCard>
                <InfoCard title="Swing Trader" icon="🌊" color="blue">
                  <p className="text-xs">Moderate Strategie, hält Positionen Tage bis Wochen</p>
                </InfoCard>
                <InfoCard title="Position Investor" icon="🏦" color="green">
                  <p className="text-xs">Konservativ, langfristiger Fokus, weniger Trades</p>
                </InfoCard>
                <InfoCard title="Momentum Trader" icon="🚀" color="purple">
                  <p className="text-xs">Folgt starken Trends, kauft Stärke</p>
                </InfoCard>
                <InfoCard title="Contrarian" icon="🔄" color="red">
                  <p className="text-xs">Handelt gegen den Trend, kauft bei Panik</p>
                </InfoCard>
                <InfoCard title="Balanced" icon="⚖️">
                  <p className="text-xs">Ausgewogene Mischung verschiedener Strategien</p>
                </InfoCard>
              </div>
            </div>

            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Agent-Erklärungen verstehen</h3>
              <p className="text-xs text-gray-400 mb-3">
                Klicke auf einen Agenten im Dashboard, um zu sehen <strong>warum</strong> er so entschieden hat:
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-24 h-3 bg-gradient-to-r from-green-500 via-gray-500 to-red-500 rounded" />
                  <span className="text-xs text-gray-400">Wahrscheinlichkeitsbalken (Buy/Hold/Sell)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-3 bg-blue-500/50 rounded" />
                  <span className="text-xs text-gray-400">Feature-Wichtigkeit (welche Indikatoren zählen)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-300">RSI: 65.3</span>
                  <span className="text-xs text-gray-400">Aktuelle Marktdaten, die der Agent sieht</span>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Watchlist */}
        <Section title="Watchlist nutzen" icon="📋" color="orange">
          <div className="space-y-4">
            <p className="text-gray-300 text-sm">
              Verfolge mehrere Aktien gleichzeitig mit automatischen Signalen und Preisupdates.
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoCard title="Signalquellen auf einen Blick" icon="👁️" color="blue">
                <p className="text-xs mb-2">Jede Aktie zeigt die Einzelsignale:</p>
                <div className="space-y-1 text-xs">
                  <div>📊 Tech - Technische Indikatoren</div>
                  <div>📰 News - Sentiment-Analyse</div>
                  <div>🤖 ML - Preisprognose</div>
                  <div>🎯 RL - Agenten-Signale</div>
                </div>
              </InfoCard>
              <InfoCard title="Zeitraum-Filter" icon="⏱️" color="purple">
                <p className="text-xs mb-2">Wähle deinen Trading-Horizont:</p>
                <div className="flex gap-1 text-xs">
                  <span className="px-2 py-0.5 bg-slate-700 rounded">1h</span>
                  <span className="px-2 py-0.5 bg-blue-600 rounded">1d</span>
                  <span className="px-2 py-0.5 bg-slate-700 rounded">1w</span>
                  <span className="px-2 py-0.5 bg-slate-700 rounded">Long</span>
                </div>
              </InfoCard>
            </div>

            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-2">Score-Sortierung</h3>
              <p className="text-xs text-gray-400">
                Sortiere nach "Score" um die Aktien mit den stärksten Signalen oben zu sehen.
                Kombiniert mit dem Zeitraum-Filter findest du schnell Trading-Chancen.
              </p>
            </div>
          </div>
        </Section>

        {/* Backtesting */}
        <Section title="Backtesting" icon="📈" color="blue">
          <div className="space-y-4">
            <p className="text-gray-300 text-sm">
              Teste Strategien an historischen Daten, bevor du echtes Geld riskierst.
            </p>
            
            <div className="bg-slate-900/50 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Was wird getestet?</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-2xl mb-1">💰</div>
                  <div className="text-xs text-gray-300">Gesamtrendite</div>
                  <div className="text-[10px] text-gray-500">Gewinn/Verlust in %</div>
                </div>
                <div>
                  <div className="text-2xl mb-1">📊</div>
                  <div className="text-xs text-gray-300">Sharpe Ratio</div>
                  <div className="text-[10px] text-gray-500">Risiko-adjustierte Rendite</div>
                </div>
                <div>
                  <div className="text-2xl mb-1">📉</div>
                  <div className="text-xs text-gray-300">Max Drawdown</div>
                  <div className="text-[10px] text-gray-500">Größter Verlust vom Hoch</div>
                </div>
                <div>
                  <div className="text-2xl mb-1">🎯</div>
                  <div className="text-xs text-gray-300">Win Rate</div>
                  <div className="text-[10px] text-gray-500">Anteil profitabler Trades</div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Paper Trading */}
        <Section title="Paper Trading" icon="📝" color="green">
          <div className="space-y-4">
            <p className="text-gray-300 text-sm">
              Übe mit virtuellem Geld zu echten Marktpreisen - ohne Risiko!
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <InfoCard title="Virtuelles Portfolio" icon="💼" color="green">
                <p className="text-xs">Starte mit $10.000 virtuellem Kapital und verfolge deine Performance.</p>
              </InfoCard>
              <InfoCard title="Echte Kurse" icon="💱" color="blue">
                <p className="text-xs">Trades werden zu aktuellen Marktpreisen ausgeführt - wie im echten Leben.</p>
              </InfoCard>
              <InfoCard title="Rangliste" icon="🏆" color="yellow">
                <p className="text-xs">Vergleiche dich mit anderen Tradern auf dem Leaderboard.</p>
              </InfoCard>
            </div>
          </div>
        </Section>

        {/* Glossar */}
        <Section title="Glossar - Wichtige Begriffe" icon="📖">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-blue-400 font-medium">Bullish</div>
              <p className="text-xs text-gray-400">Optimistische Markterwartung, Kurse werden steigen</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-red-400 font-medium">Bearish</div>
              <p className="text-xs text-gray-400">Pessimistische Markterwartung, Kurse werden fallen</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-yellow-400 font-medium">Volatilität</div>
              <p className="text-xs text-gray-400">Schwankungsbreite der Kurse - hoch = riskanter</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-green-400 font-medium">Support</div>
              <p className="text-xs text-gray-400">Unterstützungslinie, an der der Kurs oft stoppt</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-purple-400 font-medium">Resistance</div>
              <p className="text-xs text-gray-400">Widerstandslinie, die der Kurs schwer durchbricht</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-orange-400 font-medium">Divergenz</div>
              <p className="text-xs text-gray-400">Kurs und Indikator bewegen sich unterschiedlich</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-cyan-400 font-medium">Momentum</div>
              <p className="text-xs text-gray-400">Geschwindigkeit und Stärke einer Kursbewegung</p>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-pink-400 font-medium">Drawdown</div>
              <p className="text-xs text-gray-400">Rückgang vom Höchststand - max. Verlust</p>
            </div>
          </div>
        </Section>

        {/* Disclaimer */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 sm:p-6">
          <h2 className="text-xl font-semibold text-yellow-400 mb-4 flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            Wichtiger Hinweis
          </h2>
          <div className="text-gray-300 text-sm space-y-3">
            <p>
              Diese Anwendung dient ausschließlich zu <strong>Bildungs- und Testzwecken</strong>.
            </p>
            <p>
              Die angezeigten Signale und Prognosen stellen <strong>keine Anlageberatung</strong> dar und sollten
              nicht als Grundlage für echte Investitionsentscheidungen verwendet werden.
            </p>
            <p>
              <strong>Risiken:</strong> Investitionen in Aktien können zu Verlusten bis hin zum Totalverlust führen.
              Vergangene Performance ist kein Indikator für zukünftige Ergebnisse.
            </p>
            <p className="text-yellow-400/80">
              📌 Bitte konsultiere einen qualifizierten Finanzberater, bevor du echtes Geld investierst.
            </p>
          </div>
        </div>

      </div>
      </div>
      )}
    </div>
  );
}
