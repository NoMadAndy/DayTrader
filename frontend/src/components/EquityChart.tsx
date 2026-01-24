/**
 * EquityChart Component
 * 
 * Displays portfolio value over time as a line chart.
 */

import { useState, useEffect } from 'react';
import { getEquityCurve, formatCurrency } from '../services/tradingService';
import type { EquityCurvePoint } from '../types/trading';

interface EquityChartProps {
  portfolioId: number;
  days?: number;
  height?: number;
}

export function EquityChart({ portfolioId, days = 30, height = 200 }: EquityChartProps) {
  const [data, setData] = useState<EquityCurvePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<EquityCurvePoint | null>(null);
  
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const curveData = await getEquityCurve(portfolioId, days);
        setData(curveData);
      } catch (e) {
        setError('Chart konnte nicht geladen werden');
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, [portfolioId, days]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  if (error || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-400" style={{ height }}>
        <p>{error || 'Keine Daten verfügbar'}</p>
      </div>
    );
  }
  
  // Calculate chart dimensions
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartWidth = 600;
  const chartHeight = height;
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  
  // Calculate scales
  const values = data.map(d => d.totalValue);
  const minValue = Math.min(...values) * 0.995;
  const maxValue = Math.max(...values) * 1.005;
  const valueRange = maxValue - minValue;
  
  // Generate path
  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1 || 1)) * innerWidth;
    const y = padding.top + innerHeight - ((d.totalValue - minValue) / valueRange) * innerHeight;
    return { x, y, data: d };
  });
  
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');
  
  // Area fill path
  const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${padding.left} ${padding.top + innerHeight} Z`;
  
  // Determine if overall positive or negative
  const startValue = data[0]?.totalValue || 0;
  const endValue = data[data.length - 1]?.totalValue || 0;
  const isPositive = endValue >= startValue;
  const strokeColor = isPositive ? '#22c55e' : '#ef4444';
  const fillColor = isPositive ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';
  
  // Y-axis labels
  const yLabels = [minValue, minValue + valueRange / 2, maxValue];
  
  // X-axis labels
  const xLabels = [
    data[0]?.date,
    data[Math.floor(data.length / 2)]?.date,
    data[data.length - 1]?.date,
  ].filter(Boolean);
  
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setHoveredPoint(null)}
      >
        {/* Grid lines */}
        {yLabels.map((val, i) => {
          const y = padding.top + innerHeight - ((val - minValue) / valueRange) * innerHeight;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + innerWidth}
                y2={y}
                stroke="#334155"
                strokeDasharray="4"
              />
              <text
                x={padding.left - 8}
                y={y}
                fill="#9ca3af"
                fontSize="10"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatCurrency(val)}
              </text>
            </g>
          );
        })}
        
        {/* X-axis labels */}
        {xLabels.map((date, i) => {
          const x = padding.left + (i / (xLabels.length - 1 || 1)) * innerWidth;
          return (
            <text
              key={i}
              x={x}
              y={chartHeight - 8}
              fill="#9ca3af"
              fontSize="10"
              textAnchor="middle"
            >
              {new Date(date!).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
            </text>
          );
        })}
        
        {/* Area fill */}
        <path d={areaD} fill={fillColor} />
        
        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Interactive points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoveredPoint?.date === p.data.date ? 6 : 3}
            fill={strokeColor}
            stroke="#1e293b"
            strokeWidth="2"
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHoveredPoint(p.data)}
          />
        ))}
      </svg>
      
      {/* Tooltip */}
      {hoveredPoint && (
        <div className="absolute top-2 right-2 bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm shadow-lg">
          <div className="text-gray-400 mb-1">
            {new Date(hoveredPoint.date).toLocaleDateString('de-DE')}
          </div>
          <div className="font-semibold">{formatCurrency(hoveredPoint.totalValue)}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
            <span className="text-gray-400">Bargeld:</span>
            <span>{formatCurrency(hoveredPoint.cashBalance)}</span>
            <span className="text-gray-400">Unrealisiert:</span>
            <span className={hoveredPoint.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
              {formatCurrency(hoveredPoint.unrealizedPnl)}
            </span>
            <span className="text-gray-400">Realisiert:</span>
            <span className={hoveredPoint.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
              {formatCurrency(hoveredPoint.realizedPnl)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default EquityChart;
