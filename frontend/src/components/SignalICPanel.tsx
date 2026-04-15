/**
 * Signal IC Panel
 *
 * Universe-weite Rank-IC pro Signalquelle aus /api/ml/sentiment/ic. Misst, ob
 * ein Signal monoton mit dem realisierten Return korreliert. Ergänzt den
 * SignalAccuracyChart (per-Trader, win-rate-basiert): IC ist schwellen-frei
 * und detektiert Degradation auch bei stabilem Hit-Rate.
 */

import { useEffect, useState } from 'react';
import { log } from '../utils/logger';

interface ICDatum {
  source: string;
  n: number;
  ic: number | null;
}

interface ICResponse {
  days: number;
  source: string | null;
  bySymbol: boolean;
  data: ICDatum[];
  n: number;
}

const SOURCE_COLORS: Record<string, string> = {
  ml: 'text-blue-400',
  rl: 'text-purple-400',
  sentiment: 'text-green-400',
  technical: 'text-orange-400',
};

function icColor(ic: number | null): string {
  if (ic === null) return 'text-gray-500';
  if (ic > 0.05) return 'text-green-400';
  if (ic < -0.05) return 'text-red-400';
  return 'text-gray-400';
}

export default function SignalICPanel({ days = 30 }: { days?: number }) {
  const [data, setData] = useState<ICResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Async fetch → setState on completion is the canonical React data-loading
  // pattern; the compiler-rule noise comes from the synchronous setLoading
  // before the fetch starts. Cancelled-flag guards against post-unmount.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/ml/sentiment/ic?days=${days}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: ICResponse) => { if (!cancelled) setData(d); })
      .catch((e) => log.warn('SignalICPanel fetch failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 p-4 rounded-lg shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Signal IC ({days}d)</h3>
        <span className="text-xs text-gray-500" title="Spearman-Rank-IC: Score ↔ Next-Bar-Return">
          universe-weit
        </span>
      </div>

      {loading && <div className="text-gray-500 text-sm">Lade IC…</div>}

      {!loading && (!data || data.data.length === 0) && (
        <div className="text-gray-500 text-sm">
          Keine IC-Daten — Daily-Backfill um 18:05 läuft sobald historical_prices ≥ horizon+1 Bars zurückliegt.
        </div>
      )}

      {!loading && data && data.data.length > 0 && (
        <div className="space-y-3">
          {data.data
            .slice()
            .sort((a, b) => (b.ic ?? -Infinity) - (a.ic ?? -Infinity))
            .map((d) => (
              <div key={d.source} className="flex items-center justify-between">
                <span className={`font-medium capitalize ${SOURCE_COLORS[d.source] || 'text-gray-300'}`}>
                  {d.source}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">n={d.n}</span>
                  <span className={`text-lg font-mono ${icColor(d.ic)}`}>
                    {d.ic === null ? '—' : `${d.ic >= 0 ? '+' : ''}${d.ic.toFixed(3)}`}
                  </span>
                </div>
              </div>
            ))}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-700 text-xs text-gray-500 leading-relaxed">
        IC &gt; +0.05: signal trägt; IC ≈ 0: noise; IC &lt; −0.05: invertiert.
      </div>
    </div>
  );
}
