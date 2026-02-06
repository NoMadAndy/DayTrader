/**
 * Trade Toast Notification System
 * 
 * Stacking toast notifications for trade events (buy, sell, close, short).
 * New toasts slide in from the bottom-right, older ones shift up.
 * Each toast shows key trade info and auto-dismisses.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export interface TradeToast {
  id: number;
  action: 'buy' | 'sell' | 'short' | 'close';
  symbol: string;
  quantity: number;
  price: number;
  confidence: number | null;
  pnl?: number | null;
  pnlPercent?: number | null;
  reasoning?: string;
  timestamp: string;
}

interface TradeToastSystemProps {
  toasts: TradeToast[];
  onDismiss: (id: number) => void;
  soundEnabled: boolean;
}

// ─── Sound Engine ────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(ctx: AudioContext, freq: number, startTime: number, duration: number, volume: number, type: OscillatorType = 'triangle') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = type;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
  gain.gain.setValueAtTime(volume, startTime + duration * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playTradeSound(action: 'buy' | 'sell' | 'short' | 'close') {
  const ctx = getAudioCtx();
  if (!ctx) return;

  const t = ctx.currentTime;

  switch (action) {
    case 'buy': {
      // Ka-Ching! Ascending 4-tone with bright timbre
      const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        playTone(ctx, freq, t + i * 0.1, 0.15, 0.35, 'triangle');
      });
      // Sparkle overlay
      playTone(ctx, 2093, t + 0.35, 0.25, 0.15, 'sine');
      break;
    }
    case 'sell':
    case 'close': {
      // Cash-out: Descending tones, warm
      const notes = [1047, 784, 659, 523]; // C6, G5, E5, C5
      notes.forEach((freq, i) => {
        playTone(ctx, freq, t + i * 0.1, 0.15, 0.3, 'triangle');
      });
      // Low confirmation
      playTone(ctx, 330, t + 0.4, 0.3, 0.2, 'sine');
      break;
    }
    case 'short': {
      // Alert: Low pulsing tones
      playTone(ctx, 440, t, 0.12, 0.35, 'sawtooth');
      playTone(ctx, 370, t + 0.15, 0.12, 0.35, 'sawtooth');
      playTone(ctx, 330, t + 0.3, 0.2, 0.3, 'triangle');
      break;
    }
  }
}

// ─── Action config ───────────────────────────────────────────────

const ACTION_CONFIG: Record<string, { label: string; emoji: string; bg: string; border: string; accent: string }> = {
  buy:   { label: 'KAUF',    emoji: '📈', bg: 'from-green-900/95 to-green-800/95', border: 'border-green-400', accent: 'text-green-400' },
  sell:  { label: 'VERKAUF', emoji: '📉', bg: 'from-red-900/95 to-red-800/95',     border: 'border-red-400',   accent: 'text-red-400' },
  close: { label: 'CLOSE',   emoji: '📤', bg: 'from-amber-900/95 to-amber-800/95', border: 'border-amber-400', accent: 'text-amber-400' },
  short: { label: 'SHORT',   emoji: '🔻', bg: 'from-purple-900/95 to-purple-800/95', border: 'border-purple-400', accent: 'text-purple-400' },
};

// ─── Single Toast Component ──────────────────────────────────────

function ToastItem({ toast, onDismiss, index }: { toast: TradeToast; onDismiss: (id: number) => void; index: number }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const navigate = useNavigate();

  const config = ACTION_CONFIG[toast.action] || ACTION_CONFIG.buy;

  const navigateToSymbol = useCallback((symbol: string) => {
    window.dispatchEvent(new CustomEvent('selectSymbol', { detail: symbol }));
    navigate('/dashboard');
  }, [navigate]);

  useEffect(() => {
    // Slide in after mount
    const showTimer = setTimeout(() => setIsVisible(true), 50 + index * 30);
    // Auto dismiss after 12 seconds
    timerRef.current = setTimeout(() => handleDismiss(), 12000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [onDismiss, toast.id]);

  const cost = toast.quantity * toast.price;
  const timeStr = new Date(toast.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div
      className={`
        transform transition-all duration-300 ease-out
        ${isVisible && !isExiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        w-80 rounded-lg border-l-4 ${config.border} shadow-2xl shadow-black/50 backdrop-blur-sm overflow-hidden
        cursor-pointer hover:scale-[1.02] active:scale-95
      `}
      onClick={handleDismiss}
      role="alert"
    >
      {/* Gradient background */}
      <div className={`bg-gradient-to-r ${config.bg} p-3`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{config.emoji}</span>
            <span className={`font-bold text-sm tracking-wider ${config.accent}`}>
              {config.label}
            </span>
          </div>
          <span className="text-gray-400 text-xs font-mono">{timeStr}</span>
        </div>

        {/* Symbol + Price */}
        <div className="flex items-center justify-between mb-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); navigateToSymbol(toast.symbol); }}
            className="text-blue-300 hover:text-blue-200 hover:underline font-bold text-lg transition-colors"
            title={`${toast.symbol} im Dashboard anzeigen`}
          >
            {toast.symbol}
          </button>
          <span className="text-white font-mono text-base">${toast.price.toFixed(2)}</span>
        </div>

        {/* Details row */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="text-gray-300">
              <span className="text-gray-500">Stk:</span> {toast.quantity}
            </span>
            <span className="text-gray-300">
              <span className="text-gray-500">Wert:</span> ${cost.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          </div>
          {toast.confidence !== null && toast.confidence !== undefined && (
            <span className={`font-mono ${toast.confidence >= 0.7 ? 'text-green-400' : toast.confidence >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
              {(toast.confidence * 100).toFixed(0)}% Konf.
            </span>
          )}
        </div>

        {/* P&L for close/sell */}
        {toast.pnl !== null && toast.pnl !== undefined && (
          <div className={`mt-1.5 pt-1.5 border-t border-white/10 flex items-center justify-between text-xs`}>
            <span className="text-gray-400">Realisiert:</span>
            <span className={`font-mono font-bold ${toast.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {toast.pnl >= 0 ? '+' : ''}{toast.pnl.toFixed(2)}$
              {toast.pnlPercent !== null && toast.pnlPercent !== undefined && (
                <span className="ml-1 text-gray-400">({toast.pnlPercent >= 0 ? '+' : ''}{toast.pnlPercent.toFixed(1)}%)</span>
              )}
            </span>
          </div>
        )}

        {/* Short reasoning */}
        {toast.reasoning && (
          <div className="mt-1.5 text-gray-400 text-xs truncate italic">
            {toast.reasoning}
          </div>
        )}
      </div>

      {/* Dismiss progress bar */}
      <div className="h-0.5 bg-slate-900">
        <div
          className={`h-full ${config.accent.replace('text-', 'bg-')} transition-all ease-linear`}
          style={{
            width: isVisible && !isExiting ? '0%' : '100%',
            transitionDuration: isVisible && !isExiting ? '12000ms' : '0ms',
          }}
        />
      </div>
    </div>
  );
}

// ─── Toast Container ─────────────────────────────────────────────

export function TradeToastSystem({ toasts, onDismiss, soundEnabled }: TradeToastSystemProps) {
  const playedSoundsRef = useRef<Set<number>>(new Set());

  // Play sound for new toasts
  useEffect(() => {
    toasts.forEach(toast => {
      if (!playedSoundsRef.current.has(toast.id) && soundEnabled) {
        playedSoundsRef.current.add(toast.id);
        playTradeSound(toast.action);
      }
    });
  }, [toasts, soundEnabled]);

  // Cleanup played sounds ref
  useEffect(() => {
    const activeIds = new Set(toasts.map(t => t.id));
    playedSoundsRef.current.forEach(id => {
      if (!activeIds.has(id)) {
        playedSoundsRef.current.delete(id);
      }
    });
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.slice(-5).map((toast, i) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={onDismiss} index={i} />
        </div>
      ))}
    </div>
  );
}

// ─── Hook for managing toasts ────────────────────────────────────

export function useTradeToasts() {
  const [toasts, setToasts] = useState<TradeToast[]>([]);

  const addToast = useCallback((toast: Omit<TradeToast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}

export default TradeToastSystem;
