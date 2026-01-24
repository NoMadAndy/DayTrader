/**
 * ML Forecast Panel Component
 * 
 * Displays ML-based price predictions with:
 * - Training controls
 * - Prediction chart
 * - Confidence indicators
 * - GPU/CUDA status
 */

import { useState, useEffect, useCallback } from 'react';
import { mlService, type MLPredictResponse, type MLTrainStatus, type MLServiceHealth } from '../services';
import type { OHLCV } from '../types/stock';

interface MLForecastPanelProps {
  symbol: string;
  stockData: OHLCV[];
  /** Optional callback to notify parent when predictions are available */
  onPredictionsChange?: (predictions: MLPredictResponse['predictions'] | null) => void;
  /** Callback to register refresh function with parent */
  onRefreshRegister?: (refreshFn: () => void) => void;
}

export function MLForecastPanel({ symbol, stockData, onPredictionsChange, onRefreshRegister }: MLForecastPanelProps) {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [health, setHealth] = useState<MLServiceHealth | null>(null);
  const [hasModel, setHasModel] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState<MLTrainStatus | null>(null);
  const [prediction, setPrediction] = useState<MLPredictResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check ML service availability on mount
  useEffect(() => {
    const checkService = async () => {
      const available = await mlService.isAvailable();
      setIsAvailable(available);
      if (available) {
        const healthData = await mlService.getHealth();
        setHealth(healthData);
      }
    };
    checkService();
  }, []);

  // Check if model exists when symbol changes
  useEffect(() => {
    if (!isAvailable || !symbol) return;
    
    const checkModel = async () => {
      const exists = await mlService.hasModel(symbol);
      setHasModel(exists);
      if (exists) {
        // Auto-load prediction if model exists
        loadPrediction();
      }
    };
    checkModel();
  }, [isAvailable, symbol]);

  // Poll training status
  useEffect(() => {
    if (!isTraining) return;

    const pollStatus = async () => {
      const status = await mlService.getTrainingStatus(symbol);
      setTrainingStatus(status);

      if (status?.status === 'completed') {
        setIsTraining(false);
        setHasModel(true);
        loadPrediction();
      } else if (status?.status === 'failed') {
        setIsTraining(false);
        setError(status.message || 'Training failed');
      }
    };

    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [isTraining, symbol]);

  const loadPrediction = useCallback(async () => {
    if (!stockData || stockData.length < 60) return;
    
    setIsLoading(true);
    setError(null);
    
    const result = await mlService.predict(symbol, stockData);
    
    if (result) {
      setPrediction(result);
      // Notify parent about new predictions
      onPredictionsChange?.(result.predictions);
    } else {
      setError('Failed to get prediction');
      onPredictionsChange?.(null);
    }
    
    setIsLoading(false);
  }, [symbol, stockData, onPredictionsChange]);

  // Register refresh function with parent
  useEffect(() => {
    if (onRefreshRegister && hasModel && isAvailable) {
      onRefreshRegister(loadPrediction);
    }
  }, [onRefreshRegister, loadPrediction, hasModel, isAvailable]);

  const startTraining = async () => {
    if (!stockData || stockData.length < 150) {
      setError('Need at least 150 data points for training');
      return;
    }

    setIsTraining(true);
    setError(null);
    
    const result = await mlService.startTraining(symbol, stockData);
    
    if (!result.success) {
      setIsTraining(false);
      setError(result.message);
    }
  };

  const deleteModel = async () => {
    const success = await mlService.deleteModel(symbol);
    if (success) {
      setHasModel(false);
      setPrediction(null);
    }
  };

  // ML Service not available
  if (isAvailable === false) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
        <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
          <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          ML Prediction
        </h3>
        <p className="text-gray-400 text-sm">
          ML Service is not available. Start the ml-service container to enable AI predictions.
        </p>
      </div>
    );
  }

  // Loading state
  if (isAvailable === null) {
    return (
      <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 animate-pulse">
        <div className="h-6 bg-slate-700 rounded w-1/3 mb-3"></div>
        <div className="h-4 bg-slate-700 rounded w-2/3"></div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          ML Prediction
          {health?.device_info.cuda_available && (
            <span className="text-xs bg-green-600/20 text-green-400 px-2 py-0.5 rounded-full">
              GPU: {health.device_info.cuda_device_name?.split(' ')[0] || 'CUDA'}
            </span>
          )}
        </h3>
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          {hasModel && !isTraining && (
            <>
              <button
                onClick={loadPrediction}
                disabled={isLoading}
                className="text-xs px-3 py-1.5 bg-purple-600/20 text-purple-400 rounded-lg hover:bg-purple-600/30 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Refresh'}
              </button>
              <button
                onClick={deleteModel}
                className="text-xs px-3 py-1.5 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors"
              >
                Delete Model
              </button>
            </>
          )}
          {!hasModel && !isTraining && (
            <button
              onClick={startTraining}
              className="text-xs px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg hover:bg-blue-600/30 transition-colors"
            >
              Train Model
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Training Progress */}
      {isTraining && trainingStatus && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-400">Training {symbol}...</span>
            <span className="text-purple-400">{trainingStatus.progress}%</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div 
              className="bg-purple-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${trainingStatus.progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{trainingStatus.message}</p>
        </div>
      )}

      {/* No Model */}
      {!hasModel && !isTraining && (
        <div className="text-center py-6">
          <svg className="w-12 h-12 mx-auto text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-gray-400 text-sm">No ML model trained for {symbol}</p>
          <p className="text-gray-500 text-xs mt-1">
            Click "Train Model" to create an LSTM prediction model using historical data
          </p>
        </div>
      )}

      {/* Predictions */}
      {prediction && !isTraining && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Current Price</p>
              <p className="text-lg font-semibold text-white">${prediction.current_price.toFixed(2)}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400">7-Day Target</p>
              {prediction.predictions[6] && (
                <>
                  <p className="text-lg font-semibold text-white">
                    ${prediction.predictions[6].predicted_price.toFixed(2)}
                  </p>
                  <p className={`text-xs ${prediction.predictions[6].change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {prediction.predictions[6].change_pct >= 0 ? '+' : ''}{prediction.predictions[6].change_pct.toFixed(2)}%
                  </p>
                </>
              )}
            </div>
            <div className="bg-slate-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400">14-Day Target</p>
              {prediction.predictions[13] && (
                <>
                  <p className="text-lg font-semibold text-white">
                    ${prediction.predictions[13].predicted_price.toFixed(2)}
                  </p>
                  <p className={`text-xs ${prediction.predictions[13].change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {prediction.predictions[13].change_pct >= 0 ? '+' : ''}{prediction.predictions[13].change_pct.toFixed(2)}%
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Prediction Table */}
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-xs border-b border-slate-700">
                <tr>
                  <th className="text-left py-2">Day</th>
                  <th className="text-right py-2">Price</th>
                  <th className="text-right py-2">Change</th>
                  <th className="text-right py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {prediction.predictions.map((pred) => (
                  <tr key={pred.day} className="border-b border-slate-700/50">
                    <td className="py-2 text-gray-300">Day {pred.day}</td>
                    <td className="py-2 text-right text-white">${pred.predicted_price.toFixed(2)}</td>
                    <td className={`py-2 text-right ${pred.change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pred.change_pct >= 0 ? '+' : ''}{pred.change_pct.toFixed(2)}%
                    </td>
                    <td className="py-2 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        pred.confidence > 0.7 ? 'bg-green-600/20 text-green-400' :
                        pred.confidence > 0.5 ? 'bg-yellow-600/20 text-yellow-400' :
                        'bg-red-600/20 text-red-400'
                      }`}>
                        {(pred.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Model Info */}
          <div className="text-xs text-gray-500 pt-2 border-t border-slate-700">
            <p>
              Model trained on {prediction.model_info.data_points} data points •
              Device: {prediction.model_info.device} •
              Val Loss: {prediction.model_info.final_val_loss?.toFixed(6) || 'N/A'}
            </p>
            <p className="mt-1 text-yellow-500/70">
              ⚠️ ML predictions are experimental and for educational purposes only. Not financial advice.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
