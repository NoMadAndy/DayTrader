/**
 * PendingOrders Component
 * 
 * Displays and manages pending limit/stop orders.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getPendingOrders,
  cancelOrder,
  formatCurrency,
  getOrderTypeName,
  getSideName,
  getProductTypeName,
} from '../services/tradingService';
import type { Order } from '../types/trading';

interface PendingOrdersProps {
  portfolioId: number;
  onOrderCancelled?: () => void;
}

export function PendingOrders({ portfolioId, onOrderCancelled }: PendingOrdersProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getPendingOrders(portfolioId);
      setOrders(data);
    } catch (e) {
      setError('Orders konnten nicht geladen werden');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [portfolioId]);
  
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);
  
  const handleCancel = async (orderId: number) => {
    try {
      setCancellingId(orderId);
      setError(null);
      
      const result = await cancelOrder(orderId);
      
      if (result.success) {
        await loadOrders();
        onOrderCancelled?.();
      } else {
        setError(result.error || 'Stornierung fehlgeschlagen');
      }
    } catch (e) {
      setError('Stornierung fehlgeschlagen');
    } finally {
      setCancellingId(null);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  if (orders.length === 0) {
    return (
      <div className="text-center py-4 text-gray-400 text-sm">
        Keine offenen Orders
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-2 text-red-300 text-sm">
          {error}
        </div>
      )}
      
      {orders.map((order) => (
        <div
          key={order.id}
          className="bg-slate-900/50 rounded-lg p-3 flex items-center justify-between"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{order.symbol}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                order.side === 'buy' 
                  ? 'bg-green-500/20 text-green-400' 
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {getSideName(order.side)}
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                {getOrderTypeName(order.orderType)}
              </span>
            </div>
            <div className="text-sm text-gray-400 mt-1">
              {order.quantity}x {getProductTypeName(order.productType)}
              {order.limitPrice && ` • Limit: ${formatCurrency(order.limitPrice)}`}
              {order.stopPrice && ` • Stop: ${formatCurrency(order.stopPrice)}`}
            </div>
          </div>
          
          <button
            onClick={() => handleCancel(order.id)}
            disabled={cancellingId === order.id}
            className="px-3 py-1 bg-slate-700 hover:bg-red-600/50 text-sm rounded transition-colors disabled:opacity-50"
          >
            {cancellingId === order.id ? '...' : 'Stornieren'}
          </button>
        </div>
      ))}
    </div>
  );
}

export default PendingOrders;
