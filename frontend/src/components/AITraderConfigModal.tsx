/**
 * AI Trader Config Modal (Unified Create + Edit)
 * 
 * Single modal for creating new AI traders and editing existing ones.
 * Strategy presets pre-fill all settings and remain selected.
 * SL/TP are shown as read-only info from the risk profile (dynamically managed).
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  createAITrader, 
  updateAITrader, 
  getDefaultPersonality, 
  getAvailableRLAgents, 
  type RLAgentStatus 
} from '../services/aiTraderService';
import { getCustomSymbols } from '../services/userSettingsService';
import { getAvailableHistoricalSymbols, type AvailableSymbol } from '../services/tradingService';
import { useSettings } from '../contexts';
import { log } from '../utils/logger';
import type { 
  AITrader, 
  AITraderPersonality, 
  AITraderRiskConfig, 
  CreateAITraderRequest 
} from '../types/aiTrader';

// ============================================================================
// Types
// ============================================================================

interface AITraderConfigModalProps {
  /** Existing trader for edit mode. Omit for create mode. */
  trader?: AITrader | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after successful create or update */
  onSaved: (trader: AITrader) => void;
}

type TradingHorizon = 'scalping' | 'day' | 'swing' | 'position';

// ============================================================================
// Constants
// ============================================================================

const AVATAR_OPTIONS = ['🤖', '🧠', '📈', '💹', '🎯', '🦾', '🔮', '⚡', '🚀', '💎', '🌟', '🦊'];

// ============================================================================
// Strategy Presets
// ============================================================================

interface StrategyPreset {
  id: string;
  name: string;
  avatar: string;
  description: string;
  color: string;
  tags: string[];
  // Risk
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
  // Trading
  tradingHorizon: TradingHorizon;
  maxPositions: number;
  // Signals
  mlWeight: number;
  rlWeight: number;
  sentimentWeight: number;
  technicalWeight: number;
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
    description: 'Kapitalerhalt an erster Stelle. Langfristige Positionen mit engen Risikogrenzen.',
    color: 'blue',
    tags: ['Position', 'Sicher'],
    riskTolerance: 'conservative', maxDrawdown: 10, stopLoss: 8, takeProfit: 15,
    slTpMode: 'dynamic', atrSlMultiplier: 2.0, minRiskReward: 2.0,
    allowShortSelling: false, maxShortPositions: 0, maxShortExposure: 0,
    tradingHorizon: 'position', maxPositions: 5,
    mlWeight: 0.35, rlWeight: 0.15, sentimentWeight: 0.15, technicalWeight: 0.35,
    minConfidence: 0.75, requireAgreement: true, minSignalAgreement: 'strong',
    checkInterval: 300, learningEnabled: true, updateWeights: false,
  },
  {
    id: 'cautious-daytrader',
    name: 'Der Vorsichtige Daytrader',
    avatar: '🧐',
    description: 'Sicheres Intraday-Trading mit ausgewogenen Signalen und moderatem Risiko.',
    color: 'cyan',
    tags: ['Day', 'Ausgewogen'],
    riskTolerance: 'moderate', maxDrawdown: 15, stopLoss: 4, takeProfit: 8,
    slTpMode: 'dynamic', atrSlMultiplier: 1.5, minRiskReward: 2.0,
    allowShortSelling: false, maxShortPositions: 0, maxShortExposure: 0,
    tradingHorizon: 'day', maxPositions: 6,
    mlWeight: 0.25, rlWeight: 0.25, sentimentWeight: 0.20, technicalWeight: 0.30,
    minConfidence: 0.65, requireAgreement: true, minSignalAgreement: 'moderate',
    checkInterval: 60, learningEnabled: true, updateWeights: true,
  },
  {
    id: 'trend-follower',
    name: 'Der Trend-Surfer',
    avatar: '🏄',
    description: 'Reitet die großen Wellen. Swing-Trading mit Fokus auf starke Trends.',
    color: 'green',
    tags: ['Swing', 'Trends'],
    riskTolerance: 'moderate', maxDrawdown: 20, stopLoss: 6, takeProfit: 18,
    slTpMode: 'dynamic', atrSlMultiplier: 1.8, minRiskReward: 3.0,
    allowShortSelling: true, maxShortPositions: 2, maxShortExposure: 20,
    tradingHorizon: 'swing', maxPositions: 4,
    mlWeight: 0.35, rlWeight: 0.20, sentimentWeight: 0.10, technicalWeight: 0.35,
    minConfidence: 0.60, requireAgreement: true, minSignalAgreement: 'moderate',
    checkInterval: 120, learningEnabled: true, updateWeights: true,
  },
  {
    id: 'momentum-hunter',
    name: 'Der Momentum-Jäger',
    avatar: '🎯',
    description: 'Schnelle Momentum-Plays mit Fokus auf Volumen und Preisbewegungen.',
    color: 'orange',
    tags: ['Day', 'Schnell'],
    riskTolerance: 'moderate', maxDrawdown: 18, stopLoss: 3, takeProfit: 6,
    slTpMode: 'dynamic', atrSlMultiplier: 1.2, minRiskReward: 2.0,
    allowShortSelling: true, maxShortPositions: 3, maxShortExposure: 25,
    tradingHorizon: 'day', maxPositions: 8,
    mlWeight: 0.20, rlWeight: 0.30, sentimentWeight: 0.15, technicalWeight: 0.35,
    minConfidence: 0.55, requireAgreement: false, minSignalAgreement: 'weak',
    checkInterval: 30, learningEnabled: true, updateWeights: true,
  },
  {
    id: 'news-trader',
    name: 'Der News-Trader',
    avatar: '📰',
    description: 'Reagiert schnell auf Nachrichten und Sentiment-Änderungen.',
    color: 'purple',
    tags: ['Day', 'Sentiment'],
    riskTolerance: 'moderate', maxDrawdown: 20, stopLoss: 5, takeProfit: 10,
    slTpMode: 'dynamic', atrSlMultiplier: 1.5, minRiskReward: 2.0,
    allowShortSelling: true, maxShortPositions: 2, maxShortExposure: 20,
    tradingHorizon: 'day', maxPositions: 6,
    mlWeight: 0.15, rlWeight: 0.20, sentimentWeight: 0.45, technicalWeight: 0.20,
    minConfidence: 0.50, requireAgreement: false, minSignalAgreement: 'weak',
    checkInterval: 30, learningEnabled: true, updateWeights: true,
  },
  {
    id: 'aggressive-scalper',
    name: 'Der Aggressive Scalper',
    avatar: '⚡',
    description: 'Blitzschnelle Trades für kleine, häufige Gewinne. Hohes Tempo!',
    color: 'yellow',
    tags: ['Scalping', 'Aggressiv'],
    riskTolerance: 'aggressive', maxDrawdown: 12, stopLoss: 1.5, takeProfit: 2.5,
    slTpMode: 'dynamic', atrSlMultiplier: 1.0, minRiskReward: 1.5,
    allowShortSelling: true, maxShortPositions: 5, maxShortExposure: 40,
    tradingHorizon: 'scalping', maxPositions: 10,
    mlWeight: 0.15, rlWeight: 0.35, sentimentWeight: 0.10, technicalWeight: 0.40,
    minConfidence: 0.50, requireAgreement: false, minSignalAgreement: 'weak',
    checkInterval: 15, learningEnabled: true, updateWeights: true,
  },
  {
    id: 'algo-strategist',
    name: 'Der Algo-Stratege',
    avatar: '🤖',
    description: 'Datengetriebene Entscheidungen. ML & RL im Fokus mit strenger Validierung.',
    color: 'indigo',
    tags: ['Swing', 'AI-Fokus'],
    riskTolerance: 'moderate', maxDrawdown: 15, stopLoss: 5, takeProfit: 12,
    slTpMode: 'dynamic', atrSlMultiplier: 1.5, minRiskReward: 2.5,
    allowShortSelling: true, maxShortPositions: 3, maxShortExposure: 25,
    tradingHorizon: 'swing', maxPositions: 5,
    mlWeight: 0.40, rlWeight: 0.35, sentimentWeight: 0.10, technicalWeight: 0.15,
    minConfidence: 0.70, requireAgreement: true, minSignalAgreement: 'strong',
    checkInterval: 90, learningEnabled: true, updateWeights: true,
  },
  {
    id: 'risk-taker',
    name: 'Der Risiko-Liebhaber',
    avatar: '🔥',
    description: 'Hohe Risiken, hohe Chancen. Aggressive Positionsgrößen.',
    color: 'red',
    tags: ['Day', 'Riskant'],
    riskTolerance: 'aggressive', maxDrawdown: 35, stopLoss: 10, takeProfit: 25,
    slTpMode: 'dynamic', atrSlMultiplier: 2.5, minRiskReward: 2.5,
    allowShortSelling: true, maxShortPositions: 5, maxShortExposure: 40,
    tradingHorizon: 'day', maxPositions: 8,
    mlWeight: 0.25, rlWeight: 0.30, sentimentWeight: 0.20, technicalWeight: 0.25,
    minConfidence: 0.45, requireAgreement: false, minSignalAgreement: 'weak',
    checkInterval: 45, learningEnabled: true, updateWeights: true,
  },
];

const PRESET_COLOR_CLASSES: Record<string, { selected: string; badge: string }> = {
  blue:   { selected: 'border-blue-500 bg-blue-500/20 ring-2 ring-blue-500/30', badge: 'bg-blue-500/30 text-blue-300' },
  cyan:   { selected: 'border-cyan-500 bg-cyan-500/20 ring-2 ring-cyan-500/30', badge: 'bg-cyan-500/30 text-cyan-300' },
  green:  { selected: 'border-green-500 bg-green-500/20 ring-2 ring-green-500/30', badge: 'bg-green-500/30 text-green-300' },
  orange: { selected: 'border-orange-500 bg-orange-500/20 ring-2 ring-orange-500/30', badge: 'bg-orange-500/30 text-orange-300' },
  purple: { selected: 'border-purple-500 bg-purple-500/20 ring-2 ring-purple-500/30', badge: 'bg-purple-500/30 text-purple-300' },
  yellow: { selected: 'border-yellow-500 bg-yellow-500/20 ring-2 ring-yellow-500/30', badge: 'bg-yellow-500/30 text-yellow-300' },
  indigo: { selected: 'border-indigo-500 bg-indigo-500/20 ring-2 ring-indigo-500/30', badge: 'bg-indigo-500/30 text-indigo-300' },
  red:    { selected: 'border-red-500 bg-red-500/20 ring-2 ring-red-500/30', badge: 'bg-red-500/30 text-red-300' },
};

const HORIZON_LABELS: Record<TradingHorizon, string> = {
  scalping: '⚡ Scalping (Min.)',
  day: '📅 Day-Trading (Std.)',
  swing: '📊 Swing-Trading (Tage)',
  position: '📈 Position-Trading (Wochen)',
};

const RISK_LABELS: Record<string, { icon: string; label: string }> = {
  conservative: { icon: '🛡️', label: 'Konservativ' },
  moderate:     { icon: '⚖️', label: 'Moderat' },
  aggressive:   { icon: '🔥', label: 'Aggressiv' },
};

// ============================================================================
// Toggle Component
// ============================================================================

function Toggle({ checked, onChange, color = 'blue' }: { checked: boolean; onChange: (v: boolean) => void; color?: string }) {
  const bgClass = checked 
    ? color === 'green' ? 'bg-green-600' : color === 'purple' ? 'bg-purple-600' : 'bg-blue-600' 
    : 'bg-slate-600';
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${bgClass}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// ============================================================================
// Section Component (collapsible)
// ============================================================================

function Section({ title, icon, children, defaultOpen = false }: { 
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean 
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-700/50 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
      >
        <span className="flex items-center gap-2 font-medium text-white text-sm">
          <span>{icon}</span> {title}
        </span>
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AITraderConfigModal({ trader, isOpen, onClose, onSaved }: AITraderConfigModalProps) {
  const isEditMode = !!trader;
  const { t, formatCurrency } = useSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Strategy preset
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  // Basic info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('🤖');

  // Capital (create mode only)
  const [initialCapital, setInitialCapital] = useState(100000);
  const [brokerProfile, setBrokerProfile] = useState<'flatex' | 'ingdiba'>('flatex');

  // Risk (mostly from preset, shown as read-only summary)
  const [riskTolerance, setRiskTolerance] = useState<AITraderRiskConfig['tolerance']>('moderate');
  const [maxDrawdown, setMaxDrawdown] = useState(20);
  const [stopLoss, setStopLoss] = useState(5);
  const [takeProfit, setTakeProfit] = useState(10);
  const [slTpMode, setSlTpMode] = useState<'dynamic' | 'fixed'>('dynamic');
  const [atrSlMultiplier, setAtrSlMultiplier] = useState(1.5);
  const [minRiskReward, setMinRiskReward] = useState(2.0);
  const [allowShortSelling, setAllowShortSelling] = useState(false);
  const [maxShortPositions, setMaxShortPositions] = useState(3);
  const [maxShortExposure, setMaxShortExposure] = useState(30);

  // Trading
  const [tradingHorizon, setTradingHorizon] = useState<TradingHorizon>('day');
  const [maxPositions, setMaxPositions] = useState(5);

  // Signals
  const [mlWeight, setMlWeight] = useState(0.25);
  const [rlWeight, setRlWeight] = useState(0.25);
  const [sentimentWeight, setSentimentWeight] = useState(0.25);
  const [technicalWeight, setTechnicalWeight] = useState(0.25);
  const [minConfidence, setMinConfidence] = useState(0.6);
  const [requireAgreement, setRequireAgreement] = useState(false);
  const [minSignalAgreement, setMinSignalAgreement] = useState<'weak' | 'moderate' | 'strong'>('weak');
  const [rlAgentName, setRlAgentName] = useState('');

  // Schedule
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [tradingStart, setTradingStart] = useState('09:00');
  const [tradingEnd, setTradingEnd] = useState('17:30');
  const [checkInterval, setCheckInterval] = useState(60);

  // Learning
  const [learningEnabled, setLearningEnabled] = useState(false);
  const [updateWeights, setUpdateWeights] = useState(false);
  const [minSamples, setMinSamples] = useState(5);

  // ML / RL
  const [autoTrainML, setAutoTrainML] = useState(true);
  const [selfTrainingEnabled, setSelfTrainingEnabled] = useState(true);
  const [selfTrainingInterval, setSelfTrainingInterval] = useState(60);
  const [selfTrainingTimesteps, setSelfTrainingTimesteps] = useState(10000);

  // Watchlist
  const [watchlistSymbols, setWatchlistSymbols] = useState('');
  const [useFullWatchlist, setUseFullWatchlist] = useState(false);

  // Loaded data
  const [availableRLAgents, setAvailableRLAgents] = useState<RLAgentStatus[]>([]);
  const [availableSymbols, setAvailableSymbols] = useState<AvailableSymbol[]>([]);
  const [userWatchlistSymbols, setUserWatchlistSymbols] = useState<string[]>([]);
  const [_loadingData, setLoadingData] = useState(false);

  // ============================================================================
  // Load data
  // ============================================================================

  useEffect(() => {
    if (!isOpen) return;
    setLoadingData(true);
    
    Promise.all([
      getAvailableRLAgents().then(agents => setAvailableRLAgents(agents.filter(a => a.is_trained))).catch(() => setAvailableRLAgents([])),
      getCustomSymbols().then(syms => setUserWatchlistSymbols(syms.map(s => s.symbol))).catch(() => setUserWatchlistSymbols([])),
      getAvailableHistoricalSymbols().then(({ symbols }) => {
        setAvailableSymbols(symbols);
      }).catch(() => setAvailableSymbols([])),
    ]).finally(() => setLoadingData(false));
  }, [isOpen]);

  // ============================================================================
  // Initialize form from trader (edit mode)
  // ============================================================================

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    
    if (trader) {
      // Edit mode: populate from trader
      const p = trader.personality;
      setName(trader.name);
      setDescription(trader.description || '');
      setAvatar(trader.avatar);
      setBrokerProfile((p?.capital?.brokerProfile as 'flatex' | 'ingdiba') || 'flatex');
      setRiskTolerance(p?.risk?.tolerance || 'moderate');
      setMaxDrawdown(p?.risk?.maxDrawdown || 20);
      setStopLoss(p?.risk?.stopLossPercent || 5);
      setTakeProfit(p?.risk?.takeProfitPercent || 10);
      setSlTpMode(p?.risk?.slTpMode || 'dynamic');
      setAtrSlMultiplier(p?.risk?.atrSlMultiplier || 1.5);
      setMinRiskReward(p?.risk?.minRiskReward || 2.0);
      setAllowShortSelling(p?.risk?.allowShortSelling ?? false);
      setMaxShortPositions(p?.risk?.maxShortPositions || 3);
      setMaxShortExposure((p?.risk?.maxShortExposure || 0.3) * 100);
      setTradingHorizon(p?.trading?.horizon || 'day');
      setMaxPositions(p?.trading?.maxOpenPositions || 5);
      setMlWeight(p?.signals?.weights?.ml || 0.25);
      setRlWeight(p?.signals?.weights?.rl || 0.25);
      setSentimentWeight(p?.signals?.weights?.sentiment || 0.25);
      setTechnicalWeight(p?.signals?.weights?.technical || 0.25);
      setMinConfidence(p?.signals?.minAgreement || 0.6);
      setRequireAgreement(p?.signals?.requireMultipleConfirmation ?? false);
      setMinSignalAgreement(p?.signals?.minSignalAgreement || 'weak');
      setRlAgentName(p?.rlAgentName || '');
      setScheduleEnabled(p?.schedule?.enabled ?? true);
      setTradingStart(p?.schedule?.tradingStart || '09:00');
      setTradingEnd(p?.schedule?.tradingEnd || '17:30');
      setCheckInterval(p?.schedule?.checkIntervalSeconds || 60);
      setLearningEnabled(p?.learning?.enabled ?? false);
      setUpdateWeights(p?.learning?.updateWeights ?? false);
      setMinSamples(p?.learning?.minSamples || 5);
      setAutoTrainML(p?.ml?.autoTrain ?? true);
      setSelfTrainingEnabled(p?.rl?.selfTrainingEnabled ?? true);
      setSelfTrainingInterval(p?.rl?.selfTrainingIntervalMinutes || 60);
      setSelfTrainingTimesteps(p?.rl?.selfTrainingTimesteps || 10000);
      setWatchlistSymbols(p?.watchlist?.symbols?.join(', ') || '');
      setUseFullWatchlist(p?.watchlist?.useFullWatchlist ?? false);
      setInitialCapital(p?.capital?.initialBudget || 100000);
      
      // Try to detect matching preset
      const matched = STRATEGY_PRESETS.find(ps => 
        ps.riskTolerance === (p?.risk?.tolerance || 'moderate') &&
        ps.tradingHorizon === (p?.trading?.horizon || 'day') &&
        Math.abs(ps.mlWeight - (p?.signals?.weights?.ml || 0.25)) < 0.02
      );
      setSelectedStrategy(matched?.id || null);
    } else {
      // Create mode: defaults
      setName('');
      setDescription('');
      setAvatar('🤖');
      setInitialCapital(100000);
      setBrokerProfile('flatex');
      setRiskTolerance('moderate');
      setMaxDrawdown(20);
      setStopLoss(5);
      setTakeProfit(10);
      setSlTpMode('dynamic');
      setAtrSlMultiplier(1.5);
      setMinRiskReward(2.0);
      setAllowShortSelling(false);
      setMaxShortPositions(3);
      setMaxShortExposure(30);
      setTradingHorizon('day');
      setMaxPositions(5);
      setMlWeight(0.25);
      setRlWeight(0.25);
      setSentimentWeight(0.25);
      setTechnicalWeight(0.25);
      setMinConfidence(0.6);
      setRequireAgreement(false);
      setMinSignalAgreement('weak');
      setRlAgentName('');
      setScheduleEnabled(true);
      setTradingStart('09:00');
      setTradingEnd('17:30');
      setCheckInterval(60);
      setLearningEnabled(false);
      setUpdateWeights(false);
      setMinSamples(5);
      setAutoTrainML(true);
      setSelfTrainingEnabled(true);
      setSelfTrainingInterval(60);
      setSelfTrainingTimesteps(10000);
      setWatchlistSymbols('');
      setUseFullWatchlist(false);
      setSelectedStrategy(null);
    }
  }, [trader, isOpen]);

  // Set default watchlist symbols for create mode once data is available
  useEffect(() => {
    if (!isOpen || isEditMode) return;
    if (availableSymbols.length > 0 && !watchlistSymbols) {
      setWatchlistSymbols(availableSymbols.map(s => s.symbol).join(','));
    }
  }, [isOpen, isEditMode, availableSymbols, watchlistSymbols]);

  // ============================================================================
  // Apply Preset
  // ============================================================================

  const applyPreset = useCallback((presetId: string) => {
    const preset = STRATEGY_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    setSelectedStrategy(presetId);
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

    // Set description from preset if empty
    if (!description.trim()) {
      setDescription(preset.description);
    }
    // Suggest name in create mode if empty
    if (!name.trim() && !isEditMode) {
      setName(preset.name);
    }
  }, [description, name, isEditMode]);

  // ============================================================================
  // Save
  // ============================================================================

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('aiTraders.nameRequired') || 'Name ist erforderlich');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const symbols = useFullWatchlist
        ? userWatchlistSymbols
        : watchlistSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

      const personality: AITraderPersonality = {
        capital: {
          initialBudget: initialCapital,
          maxPositionSize: 25,
          reserveCashPercent: 10,
          brokerProfile,
        },
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
          weights: { ml: mlWeight, rl: rlWeight, sentiment: sentimentWeight, technical: technicalWeight },
          minAgreement: minConfidence,
          requireMultipleConfirmation: requireAgreement,
          minSignalAgreement,
        },
        trading: {
          minConfidence,
          maxOpenPositions: maxPositions,
          diversification: true,
          horizon: tradingHorizon,
          targetHoldingHours: tradingHorizon === 'scalping' ? 1 : tradingHorizon === 'day' ? 8 : tradingHorizon === 'swing' ? 72 : 336,
          maxHoldingHours: tradingHorizon === 'scalping' ? 4 : tradingHorizon === 'day' ? 24 : tradingHorizon === 'swing' ? 168 : 720,
        },
        schedule: {
          enabled: scheduleEnabled,
          tradingHoursOnly: scheduleEnabled,
          timezone: 'Europe/Berlin',
          tradingStart,
          tradingEnd,
          checkIntervalSeconds: checkInterval,
        },
        watchlist: {
          symbols,
          autoUpdate: true,
          useFullWatchlist,
        },
        sentiment: { enabled: sentimentWeight > 0, minScore: 0.3 },
        learning: {
          enabled: learningEnabled,
          updateWeights: learningEnabled && updateWeights,
          minSamples,
        },
        ml: { autoTrain: autoTrainML },
        rl: {
          selfTrainingEnabled,
          selfTrainingIntervalMinutes: selfTrainingInterval,
          selfTrainingTimesteps,
        },
        rlAgentName: rlAgentName || undefined,
      };

      if (isEditMode && trader) {
        // Update existing trader
        const updated = await updateAITrader(trader.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          avatar,
          personality: { ...trader.personality, ...personality },
        });
        onSaved(updated);
      } else {
        // Create new trader
        const defaultPersonality = await getDefaultPersonality().catch(() => null);
        const mergedPersonality = defaultPersonality
          ? { ...defaultPersonality, ...personality }
          : personality;

        const request: CreateAITraderRequest = {
          name: name.trim(),
          description: description.trim() || undefined,
          personality: mergedPersonality,
          initialCapital,
        };
        
        const newTrader = await createAITrader(request);
        
        // Update avatar if different from default
        if (avatar !== '🤖') {
          try {
            await updateAITrader(newTrader.id, { avatar });
          } catch {
            log.warn('Failed to set avatar');
          }
        }
        
        onSaved(newTrader);
      }

      onClose();
    } catch (err) {
      log.error('Failed to save trader:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  // ============================================================================
  // Render helpers
  // ============================================================================

  const totalWeight = mlWeight + rlWeight + sentimentWeight + technicalWeight;
  const weightsValid = Math.abs(totalWeight - 1) < 0.01;
  const selectedPreset = STRATEGY_PRESETS.find(p => p.id === selectedStrategy);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="p-5 border-b border-slate-700 flex items-center justify-between flex-shrink-0">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            {isEditMode ? '⚙️' : '✨'} {isEditMode ? 'Trader bearbeiten' : t('aiTraders.createTitle') || 'Neuen AI Trader erstellen'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 text-lg">✕</button>
        </div>

        {/* ── Content ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">


          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* ─── 1. Trading-Persönlichkeit ─────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              🎭 Trading-Persönlichkeit wählen
            </h3>
            <p className="text-xs text-gray-400">
              Wähle ein Profil als Basis – alle Einstellungen werden automatisch angepasst. Danach kannst du einzelne Werte unter „Erweitert" nachjustieren.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STRATEGY_PRESETS.map((preset) => {
                const isSelected = selectedStrategy === preset.id;
                const colors = PRESET_COLOR_CLASSES[preset.color];
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={`p-2.5 rounded-lg text-left transition-all border-2 ${
                      isSelected
                        ? colors.selected
                        : 'bg-slate-700/40 hover:bg-slate-600/50 border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-lg">{preset.avatar}</span>
                      <span className="font-medium text-white text-xs leading-tight">{preset.name}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 line-clamp-2 mb-1.5">{preset.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {preset.tags.map(tag => (
                        <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded ${isSelected ? colors.badge : 'bg-slate-600/50 text-gray-400'}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selected preset summary */}
            {selectedPreset && (
              <div className="p-3 bg-slate-700/40 rounded-lg border border-slate-600/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white flex items-center gap-2">
                    <span className="text-green-400">✓</span>
                    {selectedPreset.avatar} {selectedPreset.name}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Risiko:</span>
                    <span className="text-white">{RISK_LABELS[selectedPreset.riskTolerance].icon} {RISK_LABELS[selectedPreset.riskTolerance].label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Horizont:</span>
                    <span className="text-white">{HORIZON_LABELS[selectedPreset.tradingHorizon].split(' ')[0]}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">SL/TP:</span>
                    <span className="text-white">
                      {selectedPreset.slTpMode === 'dynamic' 
                        ? `ATR ${selectedPreset.atrSlMultiplier}× · R:R 1:${selectedPreset.minRiskReward}`
                        : `${selectedPreset.stopLoss}% / ${selectedPreset.takeProfit}%`
                      }
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Drawdown:</span>
                    <span className="text-white">max. {selectedPreset.maxDrawdown}%</span>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 mt-2">
                  {selectedPreset.slTpMode === 'dynamic'
                    ? 'SL/TP werden dynamisch per ATR an die Marktvolatilität angepasst.'
                    : 'SL/TP sind fest eingestellt – keine Anpassung an Volatilität.'}
                </p>
              </div>
            )}
          </div>

          {/* ─── 2. Grundeinstellungen ─────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              📝 Grundeinstellungen
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="z.B. Konservativer Alpha"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Avatar */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Avatar</label>
                <div className="flex flex-wrap gap-1.5">
                  {AVATAR_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setAvatar(opt)}
                      className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors ${
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

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Beschreibung</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional: Kurze Beschreibung der Strategie"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none resize-none"
              />
            </div>
          </div>

          {/* ─── 3. Kapital & Broker ──────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              💰 Kapital & Broker
            </h3>

            {/* Initial Capital (create mode: slider; edit mode: read-only) */}
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">
                Startkapital
              </label>
              {isEditMode ? (
                <div className="text-white font-medium">{formatCurrency(trader!.personality?.capital?.initialBudget || initialCapital)}</div>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1000} max={1000000} step={1000}
                    value={initialCapital}
                    onChange={(e) => setInitialCapital(parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-white font-medium w-28 text-right text-sm">{formatCurrency(initialCapital)}</span>
                </div>
              )}
            </div>

            {/* Broker */}
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">🏦 Broker</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'flatex' as const, label: 'flatex', desc: '~$8.50 flat/Order' },
                  { value: 'ingdiba' as const, label: 'ING DiBa', desc: '$5.30 + 0.25%' },
                ]).map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() => setBrokerProfile(b.value)}
                    className={`p-2.5 rounded-lg text-left transition-colors ${
                      brokerProfile === b.value
                        ? 'bg-orange-600/30 border-2 border-orange-500'
                        : 'bg-slate-700 hover:bg-slate-600 border-2 border-transparent'
                    }`}
                  >
                    <div className="font-medium text-white text-sm">{b.label}</div>
                    <div className="text-[10px] text-gray-400">{b.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ─── 4. Watchlist ─────────────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              📋 Watchlist
            </h3>

            <div className="flex items-center gap-3 mb-2">
              <Toggle checked={useFullWatchlist} onChange={setUseFullWatchlist} />
              <span className="text-sm text-gray-300">Gesamte Watchlist verwenden ({userWatchlistSymbols.length} Symbole)</span>
            </div>

            {useFullWatchlist ? (
              userWatchlistSymbols.length > 0 ? (
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto p-2 bg-slate-900/50 rounded-lg">
                  {userWatchlistSymbols.map(s => (
                    <span key={s} className="px-2 py-0.5 bg-blue-600/30 text-blue-300 rounded text-xs font-mono">{s}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-amber-400">⚠️ Deine Watchlist ist leer. Füge zuerst Symbole hinzu.</p>
              )
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={watchlistSymbols}
                  onChange={(e) => setWatchlistSymbols(e.target.value)}
                  placeholder="AAPL, MSFT, GOOGL"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                />
                {availableSymbols.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[10px] text-gray-500 mr-1">Verfügbar:</span>
                    {availableSymbols.map(sym => {
                      const current = watchlistSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                      const isIn = current.includes(sym.symbol);
                      return (
                        <button
                          key={sym.symbol}
                          type="button"
                          onClick={() => {
                            if (!isIn) setWatchlistSymbols(prev => prev ? `${prev},${sym.symbol}` : sym.symbol);
                          }}
                          className={`text-[10px] px-1.5 py-0.5 rounded ${isIn ? 'bg-blue-600/40 text-blue-200' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                        >
                          {sym.symbol}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setWatchlistSymbols(availableSymbols.map(s => s.symbol).join(','))}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50"
                    >
                      Alle
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── 5. Erweiterte Einstellungen (collapsible) ──── */}
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              🔧 Erweiterte Einstellungen
            </h3>
            <p className="text-[10px] text-gray-500 mb-1">
              Das gewählte Profil setzt sinnvolle Standardwerte. Nur anpassen, wenn nötig.
            </p>

            {/* Signal Weights */}
            <Section title="Signal-Gewichtungen" icon="📊" defaultOpen={isEditMode}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {([
                  { label: '🧠 ML', value: mlWeight, set: setMlWeight },
                  { label: '🤖 RL', value: rlWeight, set: setRlWeight },
                  { label: '📰 Sentiment', value: sentimentWeight, set: setSentimentWeight },
                  { label: '📈 Technical', value: technicalWeight, set: setTechnicalWeight },
                ] as const).map(({ label, value, set }) => (
                  <div key={label}>
                    <label className="block text-xs font-medium text-gray-300 mb-1">{label}</label>
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => set(Number(e.target.value))}
                      min={0} max={1} step={0.05}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
              {!weightsValid && (
                <p className="text-xs text-amber-400 mt-1">
                  ⚠️ Summe: {(totalWeight * 100).toFixed(0)}% – sollte 100% sein
                </p>
              )}

              {/* RL Agent */}
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-300 mb-1">🤖 RL-Agent</label>
                <select
                  value={rlAgentName}
                  onChange={(e) => setRlAgentName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Kein RL-Agent</option>
                  {availableRLAgents.map(a => (
                    <option key={a.name} value={a.name}>{a.name} – {a.config.description}</option>
                  ))}
                </select>
              </div>

              {/* Confidence */}
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Mindest-Konfidenz: {(minConfidence * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  min={0.3} max={0.9} step={0.05}
                  className="w-full"
                />
              </div>

              {/* Signal Agreement */}
              <div className="mt-3 flex items-center gap-3">
                <Toggle checked={requireAgreement} onChange={setRequireAgreement} />
                <span className="text-sm text-gray-300">Signal-Übereinstimmung erforderlich</span>
              </div>
              {requireAgreement && (
                <select
                  value={minSignalAgreement}
                  onChange={(e) => setMinSignalAgreement(e.target.value as typeof minSignalAgreement)}
                  className="mt-2 w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="weak">Schwach (2+ Signale)</option>
                  <option value="moderate">Moderat (3+ Signale)</option>
                  <option value="strong">Stark (alle Signale)</option>
                </select>
              )}
            </Section>

            {/* Trading */}
            <Section title="Trading" icon="💼">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Trading-Horizont</label>
                  <select
                    value={tradingHorizon}
                    onChange={(e) => setTradingHorizon(e.target.value as TradingHorizon)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-blue-500 focus:outline-none"
                  >
                    {Object.entries(HORIZON_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Max. offene Positionen</label>
                  <input
                    type="number"
                    value={maxPositions}
                    onChange={(e) => setMaxPositions(Number(e.target.value))}
                    min={1} max={20}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Short Selling */}
              <div className="mt-3 p-3 bg-slate-700/30 rounded-lg border border-slate-600/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300 flex items-center gap-1.5">📉 Short-Selling</span>
                  <Toggle checked={allowShortSelling} onChange={setAllowShortSelling} color="purple" />
                </div>
                {allowShortSelling && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1">Max. Shorts</label>
                      <input type="number" value={maxShortPositions} onChange={(e) => setMaxShortPositions(Number(e.target.value))}
                        min={1} max={10}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-purple-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1">Exposure ({maxShortExposure}%)</label>
                      <input type="range" value={maxShortExposure} onChange={(e) => setMaxShortExposure(Number(e.target.value))}
                        min={10} max={50} step={5} className="w-full accent-purple-500" />
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {/* Risiko (SL/TP mode toggle + settings) */}
            <Section title="Risiko & SL/TP" icon="⚠️">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">Risikotoleranz</label>
                  <select
                    value={riskTolerance}
                    onChange={(e) => setRiskTolerance(e.target.value as AITraderRiskConfig['tolerance'])}
                    className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="conservative">🛡️ Konservativ</option>
                    <option value="moderate">⚖️ Moderat</option>
                    <option value="aggressive">🔥 Aggressiv</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">Max Drawdown (%)</label>
                  <input type="number" value={maxDrawdown} onChange={(e) => setMaxDrawdown(Number(e.target.value))}
                    min={5} max={50}
                    className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-1">Konfidenz (%)</label>
                  <div className="text-sm text-white mt-1">{(minConfidence * 100).toFixed(0)}%</div>
                </div>
              </div>

              {/* SL/TP Mode Toggle */}
              <div className="p-3 bg-slate-700/30 rounded-lg border border-slate-600/50">
                <label className="block text-xs font-medium text-gray-300 mb-2">
                  📐 Stop-Loss / Take-Profit Modus
                </label>
                <div className="flex rounded-lg overflow-hidden border border-slate-600 mb-3">
                  <button
                    type="button"
                    onClick={() => setSlTpMode('dynamic')}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      slTpMode === 'dynamic'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    📊 Dynamisch (ATR)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlTpMode('fixed')}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      slTpMode === 'fixed'
                        ? 'bg-orange-600 text-white'
                        : 'bg-slate-800 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    📌 Fix (%)
                  </button>
                </div>

                {slTpMode === 'dynamic' ? (
                  <div className="space-y-3">
                    <p className="text-[10px] text-gray-500">
                      SL/TP werden anhand der Average True Range (ATR) berechnet und passen sich automatisch der Marktvolatilität an.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-1">
                          ATR-Multiplikator (SL): {atrSlMultiplier.toFixed(1)}×
                        </label>
                        <input
                          type="range"
                          value={atrSlMultiplier}
                          onChange={(e) => setAtrSlMultiplier(Number(e.target.value))}
                          min={0.5} max={4.0} step={0.1}
                          className="w-full accent-blue-500"
                        />
                        <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
                          <span>0.5× (eng)</span>
                          <span>4.0× (weit)</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-1">
                          Min. Risk:Reward: 1:{minRiskReward.toFixed(1)}
                        </label>
                        <input
                          type="range"
                          value={minRiskReward}
                          onChange={(e) => setMinRiskReward(Number(e.target.value))}
                          min={1.0} max={5.0} step={0.1}
                          className="w-full accent-blue-500"
                        />
                        <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
                          <span>1:1.0</span>
                          <span>1:5.0</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-2 bg-blue-500/10 rounded border border-blue-500/20 text-[10px] text-blue-300">
                      💡 TP = SL × {minRiskReward.toFixed(1)} · SL-Fallback: {stopLoss}% · TP-Fallback: {takeProfit}%
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[10px] text-gray-500">
                      Feste prozentuale SL/TP-Werte für alle Trades, unabhängig von der Marktvolatilität.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-1">Stop-Loss (%)</label>
                        <input
                          type="number"
                          value={stopLoss}
                          onChange={(e) => setStopLoss(Number(e.target.value))}
                          min={0.5} max={20} step={0.5}
                          className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-red-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-1">Take-Profit (%)</label>
                        <input
                          type="number"
                          value={takeProfit}
                          onChange={(e) => setTakeProfit(Number(e.target.value))}
                          min={0.5} max={50} step={0.5}
                          className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-green-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="p-2 bg-orange-500/10 rounded border border-orange-500/20 text-[10px] text-orange-300">
                      R:R = 1:{(takeProfit / stopLoss).toFixed(1)} · Keine Anpassung an Volatilität
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {/* Zeitplan */}
            <Section title="Zeitplan" icon="🕐">
              <div className="flex items-center gap-3 mb-3">
                <Toggle checked={scheduleEnabled} onChange={setScheduleEnabled} />
                <span className="text-sm text-gray-300">Nur während Handelszeiten aktiv</span>
              </div>
              {scheduleEnabled && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Start</label>
                    <input type="time" value={tradingStart} onChange={(e) => setTradingStart(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Ende</label>
                    <input type="time" value={tradingEnd} onChange={(e) => setTradingEnd(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-1">Intervall (Sek.)</label>
                    <input type="number" value={checkInterval} onChange={(e) => setCheckInterval(Number(e.target.value))}
                      min={10} max={3600}
                      className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
              )}
            </Section>

            {/* Lernen & Training */}
            <Section title="Lernen & Training" icon="🧠">
              {/* Adaptive Learning */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Toggle checked={learningEnabled} onChange={setLearningEnabled} />
                  <span className="text-sm text-gray-300">Adaptives Lernen</span>
                </div>
                {learningEnabled && (
                  <div className="ml-14 space-y-2">
                    <div className="flex items-center gap-3">
                      <Toggle checked={updateWeights} onChange={setUpdateWeights} color="green" />
                      <span className="text-xs text-gray-300">Gewichtungen automatisch anpassen</span>
                    </div>
                    {updateWeights && (
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-1">Min. Entscheidungen vorher</label>
                        <input type="number" value={minSamples} onChange={(e) => setMinSamples(Number(e.target.value))}
                          min={3} max={50}
                          className="w-32 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-green-500 focus:outline-none" />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <hr className="border-slate-700/50" />

              {/* ML Auto-Train */}
              <div className="flex items-center gap-3">
                <Toggle checked={autoTrainML} onChange={setAutoTrainML} color="purple" />
                <div>
                  <span className="text-sm text-gray-300">ML-Modelle auto-trainieren</span>
                  <p className="text-[10px] text-gray-500">ML-Modelle für Symbole ohne trainiertes Modell</p>
                </div>
              </div>

              <hr className="border-slate-700/50" />

              {/* RL Self-Training */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Toggle checked={selfTrainingEnabled} onChange={setSelfTrainingEnabled} color="green" />
                  <div>
                    <span className="text-sm text-gray-300">RL Self-Training</span>
                    <p className="text-[10px] text-gray-500">Training während Leerlaufzeiten</p>
                  </div>
                </div>
                {selfTrainingEnabled && (
                  <div className="ml-14 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1">Intervall (Min.)</label>
                      <input type="number" value={selfTrainingInterval} onChange={(e) => setSelfTrainingInterval(Number(e.target.value))}
                        min={15} max={240} step={15}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-green-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-1">Schritte/Session</label>
                      <select value={selfTrainingTimesteps} onChange={(e) => setSelfTrainingTimesteps(Number(e.target.value))}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-white text-xs focus:border-green-500 focus:outline-none">
                        <option value={5000}>5.000 (~1-2 Min)</option>
                        <option value={10000}>10.000 (~2-4 Min)</option>
                        <option value={25000}>25.000 (~5-10 Min)</option>
                        <option value={50000}>50.000 (~10-20 Min)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </Section>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="p-4 border-t border-slate-700 flex gap-3 justify-end flex-shrink-0 bg-slate-800">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-gray-500 text-white rounded-lg font-medium text-sm transition-colors flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                {isEditMode ? 'Speichern...' : 'Erstellen...'}
              </>
            ) : (
              <>{isEditMode ? '💾 Speichern' : '🚀 Erstellen'}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
