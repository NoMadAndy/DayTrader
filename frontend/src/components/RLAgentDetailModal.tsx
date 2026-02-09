/**
 * RL Agent Detail Modal
 * 
 * Modal showing detailed information about an RL agent.
 */

interface RLAgent {
  name: string;
  symbol?: string;
  status?: string;
  episodes?: number;
  totalReward?: number;
}

interface RLAgentDetailModalProps {
  agent: RLAgent | null;
  isOpen: boolean;
  onClose: () => void;
}

export function RLAgentDetailModal({ agent, isOpen, onClose }: RLAgentDetailModalProps) {
  if (!isOpen || !agent) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>🤖</span>
            <span>RL Agent: {agent.name}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Symbol</div>
              <div className="font-medium">{agent.symbol || '-'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Status</div>
              <div className="font-medium">{agent.status || 'Unbekannt'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Episoden</div>
              <div className="font-medium">{agent.episodes?.toLocaleString() || '-'}</div>
            </div>
            <div className="bg-slate-700/30 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Total Reward</div>
              <div className={`font-medium ${(agent.totalReward || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {agent.totalReward?.toFixed(2) || '-'}
              </div>
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex justify-end p-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

export default RLAgentDetailModal;
