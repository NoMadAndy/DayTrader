/**
 * AI Trader Settings Modal
 * 
 * Modal for editing AI Trader settings.
 */

import { useState, useEffect } from 'react';
import { updateAITrader, getAvailableRLAgents, type RLAgentStatus } from '../services/aiTraderService';
import { getCustomSymbols } from '../services/userSettingsService';
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

// Strategy Presets with trading personalities
interface StrategyPreset {
  id: string;
  name: string;
  avatar: string;
  description: string;
  color: string;
  // Risk settings
  riskTolerance: AITraderRiskConfig['tolerance'];
  maxDrawdown: number;
  stopLoss: number;
  takeProfit: number;
  slTpMode: 'dynamic' | 'fixed';
  atrSlMultiplier: number;
  minRiskReward: number;
  allowShortSelling: boolean;
  maxShortPositions: number;
  maxShortExposure: number;
  // Trading settings
  tradingHorizon: 'scalping' | 'day' | 'swing' | 'position';
  maxPositions: number;
  // Signal weights
  mlWeight: number;
  rlWeight: number;
  sentimentWeight: number;
  technicalWeight: number;
  // Signal agreement
  minConfidence: number;
  requireAgreement: boolean;
  minSignalAgreement: 'weak' | 'moderate' | 'strong';
  // Schedule
  checkInterval: number;
  // Learning
  learningEnabled: boolean;
  updateWeights: boolean;
}

const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'conservative-investor',
    name: 'Der Konservative Anleger',
    avatar: '🛡️',
    description: 'Kapitalerhalt steht an erster Stelle. Langfristige Positionen mit engen Risikogrenzen.',
    color: 'blue',
    riskTolerance: 'conservative',
    maxDrawdown: 10,
    stopLoss: 8,
    takeProfit: 15,
    slTpMode: 'dynamic',
    atrSlMultiplier: 1.0,
    minRiskReward: 2.5,
    allowShortSelling: false,
    maxShortPositions: 0,
    maxShortExposure: 0,
    tradingHorizon: 'position',
    maxPositions: 5,
    mlWeight: 0.35,
    rlWeight: 0.15,
    sentimentWeight: 0.15,
    technicalWeight: 0.35,
    minConfidence: 0.75,
    requireAgreement: true,
    minSignalAgreement: 'strong',
    checkInterval: 300,
    learningEnabled: true,
    updateWeights: false,
  },
  {
    id: 'cautious-daytrader',
    name: 'Der Vorsichtige Daytrader',
    avatar: '🧐',
    description: 'Sicheres Intraday-Trading mit ausgewogenen Signalen und moderatem Risiko.',
    color: 'cyan',
    riskTolerance: 'moderate',
    maxDrawdown: 15,
    stopLoss: 4,
    takeProfit: 8,
    slTpMode: 'dynamic',
    atrSlMultiplier: 1.5,
    minRiskReward: 2.0,
    allowShortSelling: false,
    maxShortPositions: 0,
    maxShortExposure: 0,
    tradingHorizon: 'day',
    maxPositions: 6,
    mlWeight: 0.25,
    rlWeight: 0.25,
    sentimentWeight: 0.20,
    technicalWeight: 0.30,
    minConfidence: 0.65,
    requireAgreement: true,
    minSignalAgreement: 'moderate',
    checkInterval: 60,
    learningEnabled: true,
    updateWeights: true,
  },
  {
    id: 'trend-follower',
    name: 'Der Trend-Surfer',
    avatar: '🏄',
    description: 'Reitet die großen Wellen. Swing-Trading mit Fokus auf starke Trends.',
    color: 'green',
    riskTolerance: 'moderate',
    maxDrawdown: 20,
    stopLoss: 6,
    takeProfit: 18,
    slTpMode: 'dynamic',
    atrSlMultiplier: 2.0,
    minRiskReward: 2.5,
    allowShortSelling: true,
    maxShortPositions: 2,
    maxShortExposure: 20,
    tradingHorizon: 'swing',
    maxPositions: 4,
    mlWeight: 0.35,
    rlWeight: 0.20,
    sentimentWeight: 0.10,
    technicalWeight: 0.35,
    minConfidence: 0.60,
    requireAgreement: true,
    minSignalAgreement: 'moderate',
    checkInterval: 120,
    learningEnabled: true,
    updateWeights: true,
  },
  {
    id: 'momentum-hunter',
    name: 'Der Momentum-Jäger',
    avatar: '🎯',
    description: 'Schnelle Momentum-Plays mit Fokus auf Volumen und Preisbewegungen.',
    color: 'orange',
    riskTolerance: 'moderate',
    maxDrawdown: 18,
    stopLoss: 3,
    takeProfit: 6,
    slTpMode: 'dynamic',
    atrSlMultiplier: 1.2,
    minRiskReward: 2.0,
    allowShortSelling: true,
    maxShortPositions: 3,
    maxShortExposure: 25,
    tradingHorizon: 'day',
    maxPositions: 8,
    mlWeight: 0.20,
    rlWeight: 0.30,
    sentimentWeight: 0.15,
    technicalWeight: 0.35,
    minConfidence: 0.55,
    requireAgreement: false,
    minSignalAgreement: 'weak',
    checkInterval: 30,
    learningEnabled: true,
    updateWeights: true,
  },
  {
    id: 'news-trader',
    name: 'Der News-Trader',
    avatar: '📰',
    description: 'Reagiert schnell auf Nachrichten und Sentiment-Änderungen.',
    color: 'purple',
    riskTolerance: 'moderate',
    maxDrawdown: 20,
    stopLoss: 5,
    takeProfit: 10,
    slTpMode: 'dynamic',
    atrSlMultiplier: 1.5,
    minRiskReward: 2.0,
    allowShortSelling: true,
    maxShortPositions: 2,
    maxShortExposure: 20,
    tradingHorizon: 'day',
    maxPositions: 6,
    mlWeight: 0.15,
    rlWeight: 0.20,
    sentimentWeight: 0.45,
    technicalWeight: 0.20,
    minConfidence: 0.50,
    requireAgreement: false,
    minSignalAgreement: 'weak',
    checkInterval: 30,
    learningEnabled: true,
    updateWeights: true,
  },
  {
    id: 'aggressive-scalper',
    name: 'Der Aggressive Scalper',
    avatar: '⚡',
    description: 'Blitzschnelle Trades für kleine, häufige Gewinne. Hohes Tempo!',
    color: 'yellow',
    riskTolerance: 'aggressive',
    maxDrawdown: 12,
    stopLoss: 1.5,
    takeProfit: 2.5,
    slTpMode: 'dynamic',
    atrSlMultiplier: 0.8,
    minRiskReward: 1.5,
    allowShortSelling: true,
    maxShortPositions: 5,
    maxShortExposure: 40,
    tradingHorizon: 'scalping',
    maxPositions: 10,
    mlWeight: 0.15,
    rlWeight: 0.35,
    sentimentWeight: 0.10,
    technicalWeight: 0.40,
    minConfidence: 0.50,
    requireAgreement: false,
    minSignalAgreement: 'weak',
    checkInterval: 15,
    learningEnabled: true,
    updateWeights: true,
  },
  {
    id: 'algo-strategist',
    name: 'Der Algo-Stratege',
    avatar: '🤖',
    description: 'Datengetriebene Entscheidungen. ML & RL im Fokus mit strenger Validierung.',
    color: 'indigo',
    riskTolerance: 'moderate',
    maxDrawdown: 15,
    stopLoss: 5,
    takeProfit: 12,
    slTpMode: 'dynamic',
    atrSlMultiplier: 1.5,
    minRiskReward: 2.5,
    allowShortSelling: true,
    maxShortPositions: 3,
    maxShortExposure: 25,
    tradingHorizon: 'swing',
    maxPositions: 5,
    mlWeight: 0.40,
    rlWeight: 0.35,
    sentimentWeight: 0.10,
    technicalWeight: 0.15,
    minConfidence: 0.70,
    requireAgreement: true,
    minSignalAgreement: 'strong',
    checkInterval: 90,
    learningEnabled: true,
    updateWeights: true,
  },
  {
    id: 'risk-taker',
    name: 'Der Risiko-Liebhaber',
    avatar: '🔥',
    description: 'Hohe Risiken, hohe Chancen. Aggressive Positionsgrößen und weite Stopps.',
    color: 'red',
    riskTolerance: 'aggressive',
    maxDrawdown: 35,
    stopLoss: 10,
    takeProfit: 25,
    slTpMode: 'dynamic',
    atrSlMultiplier: 2.0,
    minRiskReward: 2.0,
    allowShortSelling: true,
    maxShortPositions: 5,
    maxShortExposure: 40,
    tradingHorizon: 'day',
    maxPositions: 8,
    mlWeight: 0.25,
    rlWeight: 0.30,
    sentimentWeight: 0.20,
    technicalWeight: 0.25,
    minConfidence: 0.45,
    requireAgreement: false,
    minSignalAgreement: 'weak',
    checkInterval: 45,
    learningEnabled: true,
    updateWeights: true,
  },
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
  const [slTpMode, setSlTpMode] = useState<'dynamic' | 'fixed'>(trader.personality?.risk?.slTpMode || 'dynamic');
  const [atrSlMultiplier, setAtrSlMultiplier] = useState(trader.personality?.risk?.atrSlMultiplier || 1.5);
  const [minRiskReward, setMinRiskReward] = useState(trader.personality?.risk?.minRiskReward || 2.0);
  const [maxPositions, setMaxPositions] = useState(trader.personality?.trading?.maxOpenPositions || 5);
  const [minConfidence, setMinConfidence] = useState(trader.personality?.signals?.minAgreement || 0.6);
  const [watchlistSymbols, setWatchlistSymbols] = useState(
    trader.personality?.watchlist?.symbols?.join(', ') || ''
  );
  const [useFullWatchlist, setUseFullWatchlist] = useState(
    trader.personality?.watchlist?.useFullWatchlist ?? false
  );
  const [userWatchlistSymbols, setUserWatchlistSymbols] = useState<string[]>([]);
  const [loadingWatchlist, setLoadingWatchlist] = useState(false);
  
  // Signal weights
  const [mlWeight, setMlWeight] = useState(trader.personality?.signals?.weights?.ml || 0.25);
  const [rlWeight, setRlWeight] = useState(trader.personality?.signals?.weights?.rl || 0.25);
  const [sentimentWeight, setSentimentWeight] = useState(trader.personality?.signals?.weights?.sentiment || 0.25);
  const [technicalWeight, setTechnicalWeight] = useState(trader.personality?.signals?.weights?.technical || 0.25);
  
  // Signal Agreement
  const [requireAgreement, setRequireAgreement] = useState(trader.personality?.signals?.requireMultipleConfirmation ?? false);
  const [minSignalAgreement, setMinSignalAgreement] = useState<'weak' | 'moderate' | 'strong'>(
    trader.personality?.signals?.minSignalAgreement || 'weak'
  );
  
  // Schedule
  const [scheduleEnabled, setScheduleEnabled] = useState(trader.personality?.schedule?.enabled ?? true);
  const [tradingStart, setTradingStart] = useState(trader.personality?.schedule?.tradingStart || '09:00');
  const [tradingEnd, setTradingEnd] = useState(trader.personality?.schedule?.tradingEnd || '17:30');
  const [checkInterval, setCheckInterval] = useState(trader.personality?.schedule?.checkIntervalSeconds || 60);
  
  // Learning
  const [learningEnabled, setLearningEnabled] = useState(trader.personality?.learning?.enabled ?? false);
  const [updateWeights, setUpdateWeights] = useState(trader.personality?.learning?.updateWeights ?? false);
  const [minSamples, setMinSamples] = useState(trader.personality?.learning?.minSamples || 5);
  
  // ML Auto-Training
  const [autoTrainML, setAutoTrainML] = useState(trader.personality?.ml?.autoTrain ?? true);
  
  // RL Self-Training (during idle)
  const [selfTrainingEnabled, setSelfTrainingEnabled] = useState(trader.personality?.rl?.selfTrainingEnabled ?? true);
  const [selfTrainingInterval, setSelfTrainingInterval] = useState(trader.personality?.rl?.selfTrainingIntervalMinutes || 60);
  const [selfTrainingTimesteps, setSelfTrainingTimesteps] = useState(trader.personality?.rl?.selfTrainingTimesteps || 10000);
  
  // Short Selling
  const [allowShortSelling, setAllowShortSelling] = useState(trader.personality?.risk?.allowShortSelling ?? false);
  const [maxShortPositions, setMaxShortPositions] = useState(trader.personality?.risk?.maxShortPositions || 3);
  const [maxShortExposure, setMaxShortExposure] = useState((trader.personality?.risk?.maxShortExposure || 0.3) * 100);
  
  // Trading Horizon
  type TradingHorizon = 'scalping' | 'day' | 'swing' | 'position';
  const [tradingHorizon, setTradingHorizon] = useState<TradingHorizon>(
    trader.personality?.trading?.horizon || 'day'
  );
  
  // RL Agent
  const [rlAgentName, setRlAgentName] = useState(trader.personality?.rlAgentName || '');
  const [availableRLAgents, setAvailableRLAgents] = useState<RLAgentStatus[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  
  // Broker Profile
  const [brokerProfile, setBrokerProfile] = useState<'flatex' | 'ingdiba'>(
    (trader.personality?.capital?.brokerProfile as 'flatex' | 'ingdiba') || 'flatex'
  );
  
  // Selected Strategy Preset
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [showStrategyHint, setShowStrategyHint] = useState(true);
  
  // Apply Strategy Preset
  const applyStrategyPreset = (presetId: string) => {
    const preset = STRATEGY_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    
    setSelectedStrategy(presetId);
    setShowStrategyHint(false);
    
    // Apply all preset values
    setAvatar(preset.avatar);
    setRiskTolerance(preset.riskTolerance);
    setMaxDrawdown(preset.maxDrawdown);
    setStopLoss(preset.stopLoss);
    setTakeProfit(preset.takeProfit);
    setSlTpMode(preset.slTpMode);
    setAtrSlMultiplier(preset.atrSlMultiplier);
    setMinRiskReward(preset.minRiskReward);
    setAllowShortSelling(preset.allowShortSelling);
    setMaxShortPositions(preset.maxShortPositions);
    setMaxShortExposure(preset.maxShortExposure);
    setTradingHorizon(preset.tradingHorizon);
    setMaxPositions(preset.maxPositions);
    setMlWeight(preset.mlWeight);
    setRlWeight(preset.rlWeight);
    setSentimentWeight(preset.sentimentWeight);
    setTechnicalWeight(preset.technicalWeight);
    setMinConfidence(preset.minConfidence);
    setRequireAgreement(preset.requireAgreement);
    setMinSignalAgreement(preset.minSignalAgreement);
    setCheckInterval(preset.checkInterval);
    setLearningEnabled(preset.learningEnabled);
    setUpdateWeights(preset.updateWeights);
    
    // Update description if empty
    if (!description.trim()) {
      setDescription(preset.description);
    }
  };

  // Load available RL agents
  useEffect(() => {
    if (isOpen) {
      setLoadingAgents(true);
      getAvailableRLAgents()
        .then(agents => {
          // Only show trained agents
          setAvailableRLAgents(agents.filter(a => a.is_trained));
        })
        .catch(err => {
          console.error('Failed to load RL agents:', err);
          setAvailableRLAgents([]);
        })
        .finally(() => setLoadingAgents(false));
      
      // Load user's watchlist symbols
      setLoadingWatchlist(true);
      getCustomSymbols()
        .then(symbols => {
          setUserWatchlistSymbols(symbols.map(s => s.symbol));
        })
        .catch(err => {
          console.error('Failed to load watchlist:', err);
          setUserWatchlistSymbols([]);
        })
        .finally(() => setLoadingWatchlist(false));
    }
  }, [isOpen]);
  
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
      setSlTpMode(trader.personality?.risk?.slTpMode || 'dynamic');
      setAtrSlMultiplier(trader.personality?.risk?.atrSlMultiplier || 1.5);
      setMinRiskReward(trader.personality?.risk?.minRiskReward || 2.0);
      setMaxPositions(trader.personality?.trading?.maxOpenPositions || 5);
      setTradingHorizon(trader.personality?.trading?.horizon || 'day');
      setMinConfidence(trader.personality?.signals?.minAgreement || 0.6);
      setWatchlistSymbols(trader.personality?.watchlist?.symbols?.join(', ') || '');
      setUseFullWatchlist(trader.personality?.watchlist?.useFullWatchlist ?? false);
      setMlWeight(trader.personality?.signals?.weights?.ml || 0.25);
      setRlWeight(trader.personality?.signals?.weights?.rl || 0.25);
      setSentimentWeight(trader.personality?.signals?.weights?.sentiment || 0.25);
      setTechnicalWeight(trader.personality?.signals?.weights?.technical || 0.25);
      setRequireAgreement(trader.personality?.signals?.requireMultipleConfirmation ?? false);
      setMinSignalAgreement(trader.personality?.signals?.minSignalAgreement || 'weak');
      setScheduleEnabled(trader.personality?.schedule?.enabled ?? true);
      setTradingStart(trader.personality?.schedule?.tradingStart || '09:00');
      setTradingEnd(trader.personality?.schedule?.tradingEnd || '17:30');
      setCheckInterval(trader.personality?.schedule?.checkIntervalSeconds || 60);
      setLearningEnabled(trader.personality?.learning?.enabled ?? false);
      setUpdateWeights(trader.personality?.learning?.updateWeights ?? false);
      setMinSamples(trader.personality?.learning?.minSamples || 5);
      setAutoTrainML(trader.personality?.ml?.autoTrain ?? true);
      setSelfTrainingEnabled(trader.personality?.rl?.selfTrainingEnabled ?? true);
      setSelfTrainingInterval(trader.personality?.rl?.selfTrainingIntervalMinutes || 60);
      setSelfTrainingTimesteps(trader.personality?.rl?.selfTrainingTimesteps || 10000);
      setAllowShortSelling(trader.personality?.risk?.allowShortSelling ?? false);
      setMaxShortPositions(trader.personality?.risk?.maxShortPositions || 3);
      setMaxShortExposure((trader.personality?.risk?.maxShortExposure || 0.3) * 100);
      setRlAgentName(trader.personality?.rlAgentName || '');
      setSelectedStrategy(null);
      setShowStrategyHint(true);
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
          slTpMode,
          atrSlMultiplier,
          minRiskReward,
          allowShortSelling,
          maxShortPositions,
          maxShortExposure: maxShortExposure / 100,
        },
        signals: {
          weights: {
            ml: mlWeight,
            rl: rlWeight,
            sentiment: sentimentWeight,
            technical: technicalWeight,
          },
          minAgreement: minConfidence,
          requireMultipleConfirmation: requireAgreement,
          minSignalAgreement,
        },
        trading: {
          ...trader.personality?.trading,
          maxOpenPositions: maxPositions,
          minConfidence,
          horizon: tradingHorizon,
          // Auto-set holding periods based on horizon
          targetHoldingHours: tradingHorizon === 'scalping' ? 1 : 
                              tradingHorizon === 'day' ? 8 : 
                              tradingHorizon === 'swing' ? 72 : 336,
          maxHoldingHours: tradingHorizon === 'scalping' ? 4 : 
                           tradingHorizon === 'day' ? 24 : 
                           tradingHorizon === 'swing' ? 168 : 720,
        },
        schedule: {
          ...trader.personality?.schedule,
          enabled: scheduleEnabled,
          tradingHoursOnly: scheduleEnabled, // Only trade during specified hours when schedule is enabled
          tradingStart,
          tradingEnd,
          checkIntervalSeconds: checkInterval,
        },
        watchlist: {
          ...trader.personality?.watchlist,
          symbols: useFullWatchlist ? userWatchlistSymbols : symbols,
          useFullWatchlist,
        },
        learning: {
          enabled: learningEnabled,
          updateWeights: learningEnabled && updateWeights,
          minSamples,
        },
        ml: {
          ...trader.personality?.ml,
          autoTrain: autoTrainML,
        },
        rl: {
          ...trader.personality?.rl,
          selfTrainingEnabled,
          selfTrainingIntervalMinutes: selfTrainingInterval,
          selfTrainingTimesteps,
        },
        rlAgentName: rlAgentName || undefined,
      };
      
      const updated = await updateAITrader(trader.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        avatar,
        personality: updatedPersonality,
        brokerProfile,
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
          
          {/* Strategy Presets */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              🎭 Trading-Persönlichkeit wählen
            </h3>
            
            {showStrategyHint && (
              <div className="p-3 bg-blue-500/20 border border-blue-500/40 rounded-lg text-blue-300 text-sm">
                💡 <strong>Tipp:</strong> Wähle eine Persönlichkeit als Basis – alle Einstellungen werden automatisch angepasst. Du kannst danach jederzeit einzelne Werte ändern.
              </div>
            )}
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {STRATEGY_PRESETS.map((preset) => {
                const colorClasses: Record<string, string> = {
                  blue: 'border-blue-500 bg-blue-500/20',
                  cyan: 'border-cyan-500 bg-cyan-500/20',
                  green: 'border-green-500 bg-green-500/20',
                  orange: 'border-orange-500 bg-orange-500/20',
                  purple: 'border-purple-500 bg-purple-500/20',
                  yellow: 'border-yellow-500 bg-yellow-500/20',
                  indigo: 'border-indigo-500 bg-indigo-500/20',
                  red: 'border-red-500 bg-red-500/20',
                };
                const isSelected = selectedStrategy === preset.id;
                
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyStrategyPreset(preset.id)}
                    className={`p-3 rounded-lg text-left transition-all ${
                      isSelected
                        ? `${colorClasses[preset.color]} border-2`
                        : 'bg-slate-700/50 hover:bg-slate-600/50 border-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{preset.avatar}</span>
                      <span className="font-medium text-white text-sm">{preset.name}</span>
                    </div>
                    <p className="text-xs text-gray-400 line-clamp-2">{preset.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-800/50 rounded text-gray-300">
                        {preset.tradingHorizon === 'scalping' ? '⚡ Mins' : 
                         preset.tradingHorizon === 'day' ? '📅 Std' : 
                         preset.tradingHorizon === 'swing' ? '📊 Tage' : '📈 Wochen'}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        preset.riskTolerance === 'conservative' ? 'bg-blue-500/30 text-blue-300' :
                        preset.riskTolerance === 'moderate' ? 'bg-yellow-500/30 text-yellow-300' :
                        'bg-red-500/30 text-red-300'
                      }`}>
                        {preset.riskTolerance === 'conservative' ? '🛡️' : 
                         preset.riskTolerance === 'moderate' ? '⚖️' : '🔥'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            
            {selectedStrategy && (
              <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-green-400">✓</span>
                  <span className="text-gray-300 text-sm">
                    <strong>{STRATEGY_PRESETS.find(p => p.id === selectedStrategy)?.name}</strong> angewendet
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStrategy(null);
                    setShowStrategyHint(true);
                  }}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1"
                >
                  Zurücksetzen
                </button>
              </div>
            )}
          </div>
          
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
            
            {/* Broker Profile */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                🏦 Broker
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'flatex' as const, label: 'flatex', desc: '~$8.50 flat/Order' },
                  { value: 'ingdiba' as const, label: 'ING DiBa', desc: '$5.30 + 0.25%' },
                ].map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() => setBrokerProfile(b.value)}
                    className={`p-2 rounded-lg text-left transition-colors ${
                      brokerProfile === b.value
                        ? 'bg-orange-600/30 border-2 border-orange-500'
                        : 'bg-slate-700 hover:bg-slate-600 border-2 border-transparent'
                    }`}
                  >
                    <div className="font-medium text-white text-sm">{b.label}</div>
                    <div className="text-xs text-gray-400">{b.desc}</div>
                  </button>
                ))}
              </div>
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            </div>
            
            {/* SL/TP Mode Toggle */}
            <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="font-medium text-white flex items-center gap-2">
                    📐 Stop-Loss / Take-Profit Modus
                  </h4>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {slTpMode === 'dynamic' 
                      ? 'ATR-basiert: SL/TP passen sich automatisch an die Volatilität jeder Aktie an'
                      : 'Fixe Prozentsätze für alle Trades gleich'}
                  </p>
                </div>
                <div className="flex bg-slate-800 rounded-lg overflow-hidden border border-slate-600">
                  <button
                    type="button"
                    onClick={() => setSlTpMode('dynamic')}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      slTpMode === 'dynamic' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    🎯 Dynamisch
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlTpMode('fixed')}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      slTpMode === 'fixed' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    📌 Fix
                  </button>
                </div>
              </div>
              
              {slTpMode === 'dynamic' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      ATR-Multiplikator (SL)
                    </label>
                    <p className="text-[10px] text-gray-500 mb-2">SL-Abstand = ATR × Multiplikator</p>
                    <input
                      type="number"
                      value={atrSlMultiplier}
                      onChange={(e) => setAtrSlMultiplier(Number(e.target.value))}
                      min={0.5}
                      max={5}
                      step={0.1}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Min. Risk:Reward
                    </label>
                    <p className="text-[10px] text-gray-500 mb-2">TP = SL-Abstand × R:R</p>
                    <input
                      type="number"
                      value={minRiskReward}
                      onChange={(e) => setMinRiskReward(Number(e.target.value))}
                      min={1}
                      max={5}
                      step={0.1}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="md:col-span-2 text-xs text-gray-500 bg-slate-800/50 rounded-lg p-2">
                    💡 Fallback SL={stopLoss}% / TP={takeProfit}% wird verwendet, wenn nicht genug Kursdaten für ATR vorhanden sind.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Stop-Loss (%)
                    </label>
                    <input
                      type="number"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(Number(e.target.value))}
                      min={0.5}
                      max={20}
                      step={0.5}
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
                      step={0.5}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
            </div>
            
            {/* Short Selling */}
            <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📉</span>
                  <h4 className="font-medium text-white">Short-Selling</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowShortSelling(!allowShortSelling)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    allowShortSelling ? 'bg-purple-600' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      allowShortSelling ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              
              {allowShortSelling && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Max. Short-Positionen
                    </label>
                    <input
                      type="number"
                      value={maxShortPositions}
                      onChange={(e) => setMaxShortPositions(Number(e.target.value))}
                      min={1}
                      max={10}
                      className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">Maximal gleichzeitige Shorts</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Max. Short-Exposure ({maxShortExposure}%)
                    </label>
                    <input
                      type="range"
                      value={maxShortExposure}
                      onChange={(e) => setMaxShortExposure(Number(e.target.value))}
                      min={10}
                      max={50}
                      step={5}
                      className="w-full accent-purple-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Anteil des Kapitals für Shorts</p>
                  </div>
                </div>
              )}
              
              <p className="text-xs text-gray-500 mt-3">
                {allowShortSelling 
                  ? '⚠️ Short-Selling aktiviert - der AI-Trader kann auf fallende Kurse setzen'
                  : 'Short-Selling deaktiviert - nur Long-Positionen möglich'}
              </p>
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
            
            {/* RL Agent Selection */}
            <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                🤖 RL-Agent für Signale
              </label>
              <select
                value={rlAgentName}
                onChange={(e) => setRlAgentName(e.target.value)}
                disabled={loadingAgents}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">Kein RL-Agent (nur Technical Analysis)</option>
                {availableRLAgents.map((agent) => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name} - {agent.config.description} ({agent.config.risk_profile})
                  </option>
                ))}
              </select>
              {rlAgentName && (
                <div className="mt-2 text-xs text-gray-400">
                  {(() => {
                    const agent = availableRLAgents.find(a => a.name === rlAgentName);
                    if (!agent) return null;
                    return (
                      <div className="flex flex-wrap gap-2">
                        <span className="px-2 py-0.5 bg-blue-600/30 rounded">Stil: {agent.config.trading_style}</span>
                        <span className="px-2 py-0.5 bg-green-600/30 rounded">Haltedauer: {agent.config.holding_period}</span>
                        {agent.performance_metrics && (
                          <span className="px-2 py-0.5 bg-purple-600/30 rounded">
                            Ø Return: {agent.performance_metrics.mean_return_pct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
              {!rlAgentName && rlWeight > 0 && (
                <p className="mt-2 text-xs text-amber-400">
                  ⚠️ Ohne RL-Agent wird das RL-Gewicht ({(rlWeight * 100).toFixed(0)}%) nicht berücksichtigt.
                </p>
              )}
            </div>
            
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
                Mindest-Konfidenz: {(minConfidence * 100).toFixed(0)}%
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
              <p className="mt-1 text-xs text-gray-500">
                Signal-Konfidenz muss über diesem Wert liegen, um eine Aktion auszulösen (Buy/Sell/Short).
              </p>
            </div>
            
            {/* Signal Agreement */}
            <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600 space-y-4">
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireAgreement}
                    onChange={(e) => setRequireAgreement(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
                <span className="text-gray-300">Signal-Übereinstimmung erforderlich</span>
              </div>
              
              <p className="text-xs text-gray-400">
                Wenn aktiviert, müssen mehrere Signale (ML, RL, Sentiment, Technisch) in dieselbe Richtung zeigen.
              </p>
              
              {requireAgreement && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Mindest-Übereinstimmung
                  </label>
                  <select
                    value={minSignalAgreement}
                    onChange={(e) => setMinSignalAgreement(e.target.value as 'weak' | 'moderate' | 'strong')}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="weak">Schwach (2+ von 4 Signalen)</option>
                    <option value="moderate">Moderat (3+ von 4 Signalen)</option>
                    <option value="strong">Stark (4 von 4 Signalen)</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Je höher die Anforderung, desto weniger Trades aber höhere Treffsicherheit.
                  </p>
                </div>
              )}
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
                  ⏱️ Trading-Horizont
                </label>
                <select
                  value={tradingHorizon}
                  onChange={(e) => setTradingHorizon(e.target.value as TradingHorizon)}
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="scalping">⚡ Scalping (Minuten)</option>
                  <option value="day">📅 Day-Trading (Stunden)</option>
                  <option value="swing">📊 Swing-Trading (Tage)</option>
                  <option value="position">📈 Position-Trading (Wochen)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {tradingHorizon === 'scalping' && 'Sehr kurze Trades, schnelle Gewinne. Ziel: 1h, Max: 4h'}
                  {tradingHorizon === 'day' && 'Intraday-Trades, vor Marktschluss schließen. Ziel: 8h, Max: 24h'}
                  {tradingHorizon === 'swing' && 'Mehrtägige Trades. Ziel: 3 Tage, Max: 1 Woche'}
                  {tradingHorizon === 'position' && 'Langfristige Trends. Ziel: 2 Wochen, Max: 1 Monat'}
                </p>
              </div>
            </div>
            
            {/* Watchlist Selection */}
            <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600">
              <label className="block text-sm font-medium text-gray-300 mb-3">
                📋 Watchlist Symbole
              </label>
              
              {/* Toggle for full watchlist */}
              <div className="flex items-center gap-3 mb-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useFullWatchlist}
                    onChange={(e) => setUseFullWatchlist(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
                <span className="text-gray-300">Gesamte Watchlist verwenden</span>
                {loadingWatchlist && <span className="text-gray-500 text-sm">Lädt...</span>}
              </div>
              
              {useFullWatchlist ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-400">
                    Der Trader wird alle {userWatchlistSymbols.length} Symbole aus deiner Watchlist analysieren.
                  </p>
                  {userWatchlistSymbols.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-slate-900/50 rounded-lg">
                      {userWatchlistSymbols.map((symbol) => (
                        <span 
                          key={symbol} 
                          className="px-2 py-0.5 bg-blue-600/30 text-blue-300 rounded text-xs font-mono"
                        >
                          {symbol}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-amber-400">
                      ⚠️ Deine Watchlist ist leer. Füge zuerst Symbole zur Watchlist hinzu.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    value={watchlistSymbols}
                    onChange={(e) => setWatchlistSymbols(e.target.value)}
                    placeholder="AAPL, MSFT, GOOGL"
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-blue-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Komma-separierte Symbole eingeben
                  </p>
                </div>
              )}
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
                    Prüfintervall (Sek.)
                  </label>
                  <input
                    type="number"
                    value={checkInterval}
                    onChange={(e) => setCheckInterval(Number(e.target.value))}
                    min={10}
                    max={3600}
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
          
          {/* ML Auto-Training */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              🤖 ML Modell Training
            </h3>
            
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoTrainML}
                  onChange={(e) => setAutoTrainML(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
              <span className="text-gray-300">ML-Modelle automatisch trainieren</span>
            </div>
            
            <p className="text-sm text-gray-400">
              Wenn aktiviert, trainiert der Trader automatisch LSTM-Modelle für Symbole, die noch kein trainiertes Modell haben. 
              Das Training verwendet 2 Jahre historische Daten und kann einige Minuten dauern.
            </p>
            
            <div className="p-3 bg-slate-700/30 rounded-lg border border-slate-600">
              <p className="text-xs text-gray-400">
                <span className="text-purple-400">💡 Tipp:</span> Deaktiviere diese Option wenn du nur bestimmte Modelle verwenden möchtest 
                oder wenn das automatische Training zu lange dauert. Du kannst Modelle auch manuell über die ML-Service API trainieren.
              </p>
            </div>
          </div>
          
          {/* RL Self-Training */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white border-b border-slate-700 pb-2">
              🧠 RL Agent Self-Training
            </h3>
            
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={selfTrainingEnabled}
                  onChange={(e) => setSelfTrainingEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
              </label>
              <span className="text-gray-300">Self-Training aktivieren (während Leerlaufzeiten)</span>
            </div>
            
            <p className="text-sm text-gray-400">
              Der RL-Agent trainiert sich automatisch während Leerlaufzeiten (außerhalb der Handelszeiten oder wenn nichts zu tun ist).
              Das verbessert die Entscheidungsfähigkeit über Zeit.
            </p>
            
            {selfTrainingEnabled && (
              <div className="space-y-4 p-4 bg-slate-700/30 rounded-lg border border-slate-600">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Trainings-Intervall (Minuten)
                  </label>
                  <input
                    type="number"
                    value={selfTrainingInterval}
                    onChange={(e) => setSelfTrainingInterval(Number(e.target.value))}
                    min={15}
                    max={240}
                    step={15}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-green-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Wie oft soll der Agent trainieren? (15-240 Minuten)
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Training-Schritte pro Session
                  </label>
                  <select
                    value={selfTrainingTimesteps}
                    onChange={(e) => setSelfTrainingTimesteps(Number(e.target.value))}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-green-500 focus:outline-none"
                  >
                    <option value={5000}>5.000 (Schnell, ~1-2 Min)</option>
                    <option value={10000}>10.000 (Standard, ~2-4 Min)</option>
                    <option value={25000}>25.000 (Intensiv, ~5-10 Min)</option>
                    <option value={50000}>50.000 (Gründlich, ~10-20 Min)</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Mehr Schritte = besseres Training, aber längere Dauer
                  </p>
                </div>
              </div>
            )}
            
            <div className="p-3 bg-slate-700/30 rounded-lg border border-slate-600">
              <p className="text-xs text-gray-400">
                <span className="text-green-400">📊 Wie fließt das Training ein?</span> Der RL-Agent lernt aus historischen Daten 
                und entwickelt eine Strategie (wann kaufen/verkaufen). Seine Empfehlungen werden mit der RL-Gewichtung 
                (aktuell: {(rlWeight * 100).toFixed(0)}%) in die Gesamtentscheidung einbezogen.
              </p>
            </div>
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
