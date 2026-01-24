/**
 * Info Page
 * 
 * Technical analysis information and trading signals explanation.
 */

export function InfoPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6 flex-1">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="text-3xl">📊</span>
          Technische Analyse Info
        </h1>
        <p className="text-gray-400 mt-2">
          Erklärungen zu allen verwendeten Indikatoren und Signalen
        </p>
      </div>

      <div className="space-y-6">
        {/* Moving Averages */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-2xl">📈</span>
            Gleitende Durchschnitte
          </h2>
          <div className="space-y-4 text-gray-300">
            <div>
              <h3 className="font-medium text-blue-400">SMA (Simple Moving Average)</h3>
              <p className="text-sm mt-1">
                Der einfache gleitende Durchschnitt berechnet den Mittelwert der Schlusskurse über einen bestimmten Zeitraum.
                SMA 20 zeigt den Durchschnitt der letzten 20 Tage, SMA 50 der letzten 50 Tage.
              </p>
              <p className="text-sm mt-2 text-gray-400">
                <strong>Signal:</strong> Kreuzt der Preis den SMA nach oben → bullish. Nach unten → bearish.
              </p>
            </div>
            <div>
              <h3 className="font-medium text-purple-400">EMA (Exponential Moving Average)</h3>
              <p className="text-sm mt-1">
                Der exponentielle gleitende Durchschnitt gewichtet neuere Kurse stärker.
                Reagiert schneller auf Preisänderungen als SMA.
              </p>
              <p className="text-sm mt-2 text-gray-400">
                <strong>Signal:</strong> EMA 12 kreuzt EMA 26 nach oben → Kaufsignal. Nach unten → Verkaufssignal.
              </p>
            </div>
          </div>
        </div>

        {/* Bollinger Bands */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-2xl">📉</span>
            Bollinger Bänder
          </h2>
          <div className="text-gray-300">
            <p className="text-sm">
              Bollinger Bänder bestehen aus drei Linien: dem mittleren Band (SMA 20) und zwei
              äußeren Bändern bei ±2 Standardabweichungen.
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <p><span className="text-green-400">●</span> <strong>Oberes Band:</strong> Widerstand, bei Berührung oft überkauft</p>
              <p><span className="text-yellow-400">●</span> <strong>Mittleres Band:</strong> Gleichgewicht, oft als Support/Resistance</p>
              <p><span className="text-red-400">●</span> <strong>Unteres Band:</strong> Support, bei Berührung oft überverkauft</p>
            </div>
            <p className="text-sm mt-4 text-gray-400">
              <strong>Squeeze:</strong> Enge Bänder deuten auf bevorstehende starke Bewegung hin.
            </p>
          </div>
        </div>

        {/* RSI */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-2xl">📊</span>
            RSI (Relative Strength Index)
          </h2>
          <div className="text-gray-300">
            <p className="text-sm">
              Der RSI misst die Geschwindigkeit und Stärke von Preisbewegungen auf einer Skala von 0-100.
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <p><span className="text-red-400">●</span> <strong>&gt;70:</strong> Überkauft - mögliche Korrektur</p>
              <p><span className="text-yellow-400">●</span> <strong>30-70:</strong> Neutral</p>
              <p><span className="text-green-400">●</span> <strong>&lt;30:</strong> Überverkauft - mögliche Erholung</p>
            </div>
            <p className="text-sm mt-4 text-gray-400">
              <strong>Divergenz:</strong> RSI steigt während Preis fällt → bullish Divergenz (und umgekehrt).
            </p>
          </div>
        </div>

        {/* MACD */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-2xl">📈</span>
            MACD (Moving Average Convergence Divergence)
          </h2>
          <div className="text-gray-300">
            <p className="text-sm">
              MACD zeigt die Beziehung zwischen zwei EMAs (12 und 26 Tage) und besteht aus:
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <p><span className="text-blue-400">●</span> <strong>MACD Linie:</strong> EMA 12 - EMA 26</p>
              <p><span className="text-orange-400">●</span> <strong>Signal Linie:</strong> EMA 9 der MACD Linie</p>
              <p><span className="text-gray-400">●</span> <strong>Histogramm:</strong> MACD - Signal</p>
            </div>
            <p className="text-sm mt-4 text-gray-400">
              <strong>Signal:</strong> MACD kreuzt Signal nach oben → Kaufsignal. Nach unten → Verkaufssignal.
            </p>
          </div>
        </div>

        {/* Trading Signals */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-2xl">🎯</span>
            Trading Signale
          </h2>
          <div className="text-gray-300 space-y-4">
            <p className="text-sm">
              Die Trading-Signale kombinieren mehrere Datenquellen mit unterschiedlicher Gewichtung je nach Zeitraum:
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="bg-slate-900/50 rounded-lg p-4">
                <h4 className="font-medium text-yellow-400">📰 News Sentiment</h4>
                <p className="text-xs mt-1 text-gray-400">Analyse von Nachrichtenartikeln mit FinBERT ML-Modell</p>
                <div className="mt-2 text-xs">
                  <span className="text-blue-400">1h: 55%</span> • 
                  <span className="text-gray-400"> 1d: 40%</span> • 
                  <span className="text-gray-400"> 1w: 25%</span> • 
                  <span className="text-gray-400"> Long: 15%</span>
                </div>
              </div>
              
              <div className="bg-slate-900/50 rounded-lg p-4">
                <h4 className="font-medium text-green-400">📊 Technische Indikatoren</h4>
                <p className="text-xs mt-1 text-gray-400">RSI, MACD, SMA/EMA, Bollinger, Stochastic</p>
                <div className="mt-2 text-xs">
                  <span className="text-gray-400">1h: 35%</span> • 
                  <span className="text-blue-400"> 1d: 40%</span> • 
                  <span className="text-blue-400"> 1w: 45%</span> • 
                  <span className="text-blue-400"> Long: 45%</span>
                </div>
              </div>
              
              <div className="bg-slate-900/50 rounded-lg p-4">
                <h4 className="font-medium text-purple-400">🤖 ML Vorhersage</h4>
                <p className="text-xs mt-1 text-gray-400">LSTM-Modell für Preisprognose</p>
                <div className="mt-2 text-xs">
                  <span className="text-gray-400">1h: 10%</span> • 
                  <span className="text-gray-400"> 1d: 20%</span> • 
                  <span className="text-gray-400"> 1w: 30%</span> • 
                  <span className="text-blue-400"> Long: 40%</span>
                </div>
              </div>
              
              <div className="bg-slate-900/50 rounded-lg p-4">
                <h4 className="font-medium text-white">Signal Stärke</h4>
                <div className="mt-2 space-y-1 text-xs">
                  <p><span className="text-green-400">🚀</span> Starker Kauf: Score &gt; 50</p>
                  <p><span className="text-green-400">📈</span> Kauf: Score 20-50</p>
                  <p><span className="text-yellow-400">➡️</span> Halten: Score -20 bis 20</p>
                  <p><span className="text-red-400">📉</span> Verkauf: Score -50 bis -20</p>
                  <p><span className="text-red-400">⚠️</span> Starker Verkauf: Score &lt; -50</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-yellow-400 mb-4 flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            Wichtiger Hinweis
          </h2>
          <div className="text-gray-300 text-sm space-y-2">
            <p>
              Diese Anwendung dient ausschließlich zu <strong>Bildungs- und Testzwecken</strong>.
            </p>
            <p>
              Die angezeigten Signale und Prognosen stellen <strong>keine Anlageberatung</strong> dar und sollten
              nicht als Grundlage für Investitionsentscheidungen verwendet werden.
            </p>
            <p>
              Vergangene Performance ist kein Indikator für zukünftige Ergebnisse.
              Investitionen in Aktien bergen Risiken bis hin zum Totalverlust.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
