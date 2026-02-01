/**
 * AI Trader Settings Modal
 * 
 * Modal for editing AI Trader settings.
 */

import { useState, useEffect } from 'react';
import { updateAITrader } from '../services/aiTraderService';
import { useSettings } from '../contexts';
import type { AITrader, AITraderPersonality, AITraderRiskConfig } from '../types/aiTrader';

interface AITraderSettingsModalProps {
  trader: AITrader;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: (trader: AITrader) => void;
}

const AVATAR_OPTIONS = ['🤖', '🧠', '📈', '💹', '🎯', '🦾', '🔮', '⚡', '🚀', '🦊'];

const RISK_OPTIONS: { value: AITraderRiskConfig['tolerance']; labelKey: string; descKey: string }[] = [
  { value: 'conservative', labelKey: 'aiTraders.risk.conservative', descKey: 'aiTraders.risk.conservativeDesc' },
  { value: 'moderate', labelKey: 'aiTraders.risk.moderate', descKey: 'aiTraders.risk.moderateDesc' },
  { value: 'aggressive', labelKey: 'aiTraders.risk.aggressive', descKey: 'aiTraders.risk.aggressiveDesc' },
];

export function AITraderSettingsModal({ trader, isOpen, onClose, onUpdated }: AITraderSettingsModalProps) {
  const { t } = useSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState(trader.name);
  const [description, setDescription] = useState(trader.description || '');
  const [avatar, setAvatar] = useState(trader.avatar);
  const [riskTolerance, setRiskTolerance] = useState<AITraderRiskConfig['tolerance']>(
    trader.personality?.risk?.tolerance || 'moderate'
  );
  const [maxDrawdown, setMaxDrawdown] = useState(trader.personality?.risk?.maxDrawdown || 20);
  const [stopLoss, setStopLoss] = useState(trader.personality?.risk?.stopLossPercent || 5);
  const [takeProfit, setTakeProfit] = useState(trader.personality?.risk?.takeProfitPercent || 10);
  const [maxPositions, setMaxPositions] = useState(trader.personality?.trading?.maxOpenPositions || 5);
  const [minConfidence, setMinConfidence] = useState(trader.personality?.signals?.minAgreement || 0.6);
  const [watchlistSymbols, setWatchlistSymbols] = useState(
    trader.personality?.watchlist?.symbols?.join(', ') || ''
  );
  
  // Signal weights
  const [mlWeight, setMlWeight] = useState(trader.personality?.signals?.weights?.ml || 0.25);
  const [rlWeight, setRlWeight] = useState(trader.personality?.signals?.weights?.rl || 0.25);
  const [sentimentWeight, setSentimentWeight] = useState(trader.personality?.signals?.weights?.sentiment || 0.25);
  const [technicalWeight, setTechnicalWeight] = useState(trader.personality?.signals?.weights?.technical || 0.25);
  
  // Schedule
  const [scheduleEnabled, setScheduleEnabled] = useState(trader.personality?.schedule?.enabled ?? true);
  const [tradingStart, setTradingStart] = useState(trader.personality?.schedule?.tradingStart || '09:00');
  const [tradingEnd, setTradingEnd] = useState(trader.personality?.schedule?.tradingEnd || '17:30');
  const [checkInterval, setCheckInterval] = useState(trader.personality?.schedule?.checkIntervalMinutes || 15);
  
  // Learning
  const [learningEnabled, setLearningEnabled] = useState(trader.personality?.learning?.enabled ?? false);
  const [updateWeights, setUpdateWeights] = useState(trader.personality?.learning?.updateWeights ?? false);
  const [minSamples, setMinSamples] = useState(trader.personality?.learning?.minSamples || 5);
  
  // Reset form when trader changes
  useEffect(() => {
    if (isOpen) {
      setName(trader.name);
      setDescription(trader.description || '');
      setAvatar(trader.avatar);
      setRiskTolerance(trader.personality?.risk?.tolerance || 'moderate');
      setMaxDrawdown(trader.personality?.risk?.maxDrawdown || 20);
      setStopLoss(trader.personality?.risk?.stopLossPercent || 5);
      setTakeProfit(trader.personality?.risk?.takeProfitPercent || 10);
      setMaxPositions(trader.personality?.trading?.maxOpenPositions || 5);
      setMinConfidence(trader.personality?.signals?.minAgreement || 0.6);
      setWatchlistSymbols(trader.personality?.watchlist?.symbols?.join(', ') || '');
      setMlWeight(trader.personality?.signals?.weights?.ml || 0.25);
      setRlWeight(trader.personality?.signals?.weights?.rl || 0.25);
      setSentimentWeight(trader.personality?.signals?.weights?.sentiment || 0.25);
      setTechnicalWeight(trader.personality?.signals?.weights?.technical || 0.25);
      setScheduleEnabled(trader.personality?.schedule?.enabled ?? true);
      setTradingStart(trader.personality?.schedule?.tradingStart || '09:00');
      setTradingEnd(trader.personality?.schedule?.tradingEnd || '17:30');
      setCheckInterval(trader.personality?.schedule?.checkIntervalMinutes || 15);
      setLearningEnabled(trader.personality?.learning?.enabled ?? false);
      setUpdateWeights(trader.personality?.learning?.updateWeights ?? false);
      setMinSamples(trader.personality?.learning?.minSamples || 5);
      setError(null);
    }
  }, [trader, isOpen]);
  
  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name ist erforderlich');
      return;
    }
    
    setSaving(true);
    setError(null);
    
    try {
      // Parse watchlist symbols
      const symbols = watchlistSymbols
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      
      // Build updated personality
      const updatedPersonality: AITraderPersonality = {
        ...trader.personality,
        risk: {
          tolerance: riskTolerance,
          maxDrawdown,
          stopLossPercent: stopLoss,
          takeProfitPercent: takeProfit,
        },
        signals: {
          weights: {
            ml: mlWeight,
            rl: rlWeight,
            sentiment: sentimentWeight,
            technical: technicalWeight,
          },
          minAgreement: minConfidence,
        },
        trading: {
          ...trader.personality?.trading,
          maxOpenPositions: maxPositions,
          minConfidence,
        },
        schedule: {
          ...trader.personality?.schedule,
          enabled: scheduleEnabled,
          tradingStart,
          tradingEnd,
          checkIntervalMinutes: checkInterval,
        },
        watchlist: {
          ...trader.personality?.watchlist,
          symbols,
        },
        learning: {
          enabled: learningEnabled,
          updateWeights: learningEnabled && updateWeights,
          minSamples,
        },
      };
      
      const updated = await updateAITrader(trader.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        avatar,
        personality: updatedPersonality,
      });
      
      onUpdated(updated);
      onClose();
    } catch (err) {
      console.error('Failed to update trader:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };
  
  if (!isOpen) return null;
  
  const totalWeight = mlWeight + rlWeight + sentimentWeight + technicalWeight;
  const weightsValid = Math.abs(totalWeight - 1) < 0.01;
  
  return (
    <div 
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-slate-700 sticky top-0 bg-slate-800 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              ⚙️ {t('aiTraders.settings.title') || 'Trader Einstellungen'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-2"
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300">
              {error}
            </div>
          )}
          
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              📝 Grundeinstellungen
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Avatar
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setAvatar(opt)}
                      className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors ${
                        avatar === opt
                          ? 'bg-blue-600 border-2 border-blue-400'
                          : 'bg-slate-700 hover:bg-slate-600 border-2 border-transparent'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Beschreibung
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none resize-none"
              />
            </div>
          </div>
          
          {/* Risk Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              ⚠️ Risiko-Einstellungen
            </h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Risikotoleranz
              </label>
              <div className="grid grid-cols-3 gap-3">
                {RISK_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRiskTolerance(option.value)}
                    className={`p-3 rounded-lg text-left transition-colors ${
                      riskTolerance === option.value
                        ? 'bg-blue-600/30 border-2 border-blue-500'
                        : 'bg-slate-700 hover:bg-slate-600 border-2 border-transparent'
                    }`}
                  >
                    <div className="font-medium text-white">{t(option.labelKey)}</div>
                    <div className="text-xs text-gray-400">{t(option.descKey)}</div>
                  </button>
                ))}
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Max Drawdown (%)
                </label>
                <input
                  type="number"
                  value={maxDrawdown}
                  onChange={(e) => setMaxDrawdown(Number(e.target.value))}
                  min={5}
                  max={50}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Stop-Loss (%)
                </label>
                <input
                  type="number"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(Number(e.target.value))}
                  min={1}
                  max={20}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Take-Profit (%)
                </label>
                <input
                  type="number"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(Number(e.target.value))}
                  min={1}
                  max={50}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
          
          {/* Signal Weights */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              📊 Signal-Gewichtungen
              {!weightsValid && (
                <span className="text-sm text-amber-400 ml-2">
                  (Summe: {(totalWeight * 100).toFixed(0)}% - sollte 100% sein)
                </span>
              )}
            </h3>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  🧠 ML
                </label>
                <input
                  type="number"
                  value={mlWeight}
                  onChange={(e) => setMlWeight(Number(e.target.value))}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  🤖 RL
                </label>
                <input
                  type="number"
                  value={rlWeight}
                  onChange={(e) => setRlWeight(Number(e.target.value))}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  📰 Sentiment
                </label>
                <input
                  type="number"
                  value={sentimentWeight}
                  onChange={(e) => setSentimentWeight(Number(e.target.value))}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  📈 Technical
                </label>
                <input
                  type="number"
                  value={technicalWeight}
                  onChange={(e) => setTechnicalWeight(Number(e.target.value))}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Min. Übereinstimmung: {(minConfidence * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                min={0.3}
                max={0.9}
                step={0.05}
                className="w-full"
              />
            </div>
          </div>
          
          {/* Trading Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              💼 Trading-Einstellungen
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Max. offene Positionen
                </label>
                <input
                  type="number"
                  value={maxPositions}
                  onChange={(e) => setMaxPositions(Number(e.target.value))}
                  min={1}
                  max={20}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Watchlist Symbole
                </label>
                <input
                  type="text"
                  value={watchlistSymbols}
                  onChange={(e) => setWatchlistSymbols(e.target.value)}
                  placeholder="AAPL, MSFT, GOOGL"
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
          
          {/* Schedule Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              🕐 Zeitplan
            </h3>
            
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
              <span className="text-gray-300">Nur während Handelszeiten aktiv</span>
            </div>
            
            {scheduleEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Start
                  </label>
                  <input
                    type="time"
                    value={tradingStart}
                    onChange={(e) => setTradingStart(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Ende
                  </label>
                  <input
                    type="time"
                    value={tradingEnd}
                    onChange={(e) => setTradingEnd(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Prüfintervall (Min.)
                  </label>
                  <input
                    type="number"
                    value={checkInterval}
                    onChange={(e) => setCheckInterval(Number(e.target.value))}
                    min={1}
                    max={60}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
          
          {/* Learning Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              🧠 Adaptives Lernen
            </h3>
            
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={learningEnabled}
                  onChange={(e) => setLearningEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
              <span className="text-gray-300">Learning Mode aktivieren</span>
            </div>
            
            <p className="text-sm text-gray-400">
              Im Learning Mode verfolgt der Trader die Genauigkeit jeder Signal-Quelle und kann optional die Gewichtungen automatisch anpassen.
            </p>
            
            {learningEnabled && (
              <div className="space-y-4 p-4 bg-slate-700/30 rounded-lg border border-slate-600">
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={updateWeights}
                      onChange={(e) => setUpdateWeights(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                  </label>
                  <span className="text-gray-300">Gewichtungen automatisch anpassen</span>
                </div>
                
                {updateWeights && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Minimum Entscheidungen vor Anpassung
                    </label>
                    <input
                      type="number"
                      value={minSamples}
                      onChange={(e) => setMinSamples(Number(e.target.value))}
                      min={3}
                      max={50}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Der Trader benötigt mindestens diese Anzahl an abgeschlossenen Entscheidungen, bevor Gewichtungen angepasst werden.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="p-6 border-t border-slate-700 flex gap-3 justify-end sticky bottom-0 bg-slate-800">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Speichern...
              </>
            ) : (
              <>💾 Speichern</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
