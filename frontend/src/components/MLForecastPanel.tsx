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
import { getDataService } from '../services/dataService';
import { DEFAULT_ML_SETTINGS, type MLSettings } from '../services/userSettingsService';
import { useSettings } from '../contexts/SettingsContext';
import type { OHLCV } from '../types/stock';
import { log } from '../utils/logger';

// ML Settings storage key (same as in SettingsPage)
const ML_SETTINGS_STORAGE_KEY = 'daytrader_ml_settings';

/**
 * Get ML settings from localStorage
 * Falls back to defaults if not found
 */
function getMLSettings(): MLSettings {
  try {
    const stored = localStorage.getItem(ML_SETTINGS_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_ML_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    log.warn('Failed to load ML settings from localStorage');
  }
  return { ...DEFAULT_ML_SETTINGS };
}

interface MLForecastPanelProps {
  symbol: string;
  stockData: OHLCV[];
  /** Optional callback to notify parent when predictions are available */
  onPredictionsChange?: (predictions: MLPredictResponse['predictions'] | null) => void;
  /** Callback to register refresh function with parent */
  onRefreshRegister?: (refreshFn: () => void) => void;
}

export function MLForecastPanel({ symbol, stockData, onPredictionsChange, onRefreshRegister }: MLForecastPanelProps) {
  const { t, formatCurrency } = useSettings();
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
    // If service is not available, clear any previous predictions
    if (isAvailable === false) {
      setPrediction(null);
      setHasModel(false);
      onPredictionsChange?.(null);
      return;
    }
    
    // Wait for availability check to complete
    if (isAvailable === null || !symbol) {
      return;
    }
    
    const checkModel = async () => {
      const exists = await mlService.hasModel(symbol);
      setHasModel(exists);
      if (exists) {
        // Auto-load prediction if model exists
        loadPrediction();
      } else {
        // Clear old predictions when switching to a symbol without model
        setPrediction(null);
        onPredictionsChange?.(null);
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
    
    // First, get model info to check required sequence length
    const modelInfo = await mlService.getModelInfo(symbol);
    const sequenceLength = modelInfo?.metadata?.sequence_length;
    const requiredLength = typeof sequenceLength === 'number' ? sequenceLength : 60;
    
    let dataToUse: OHLCV[] = stockData;
    
    // If we don't have enough data, fetch more
    if (stockData.length < requiredLength) {
      log.info(`[ML Predict] Need ${requiredLength} data points, have ${stockData.length}. Fetching more...`);
      try {
        const dataService = getDataService();
        // Request extra days to account for weekends/holidays
        const daysToFetch = Math.ceil(requiredLength * 1.5);
        const fetchedData = await dataService.fetchStockData(symbol, daysToFetch);
        
        if (fetchedData?.data && fetchedData.data.length >= requiredLength) {
          dataToUse = fetchedData.data;
          log.info(`[ML Predict] Fetched ${dataToUse.length} data points`);
        } else {
          setError(`Nicht genug Daten: ${fetchedData?.data?.length || 0}/${requiredLength} verfügbar`);
          setIsLoading(false);
          return;
        }
      } catch (err) {
        log.error('[ML Predict] Failed to fetch additional data:', err);
        setError(`Nicht genug Daten für Vorhersage (${stockData.length}/${requiredLength})`);
        setIsLoading(false);
        return;
      }
    }
    
    try {
      const result = await mlService.predict(symbol, dataToUse, getMLSettings().modelType);
    
      if (result) {
        // Validate that the prediction is for the correct symbol
        if (result.symbol && result.symbol.toUpperCase() !== symbol.toUpperCase()) {
          log.error(`Prediction symbol mismatch: got ${result.symbol}, expected ${symbol}`);
          setError(t('ml.modelError').replace('{predSymbol}', result.symbol).replace('{symbol}', symbol));
          setPrediction(null);
          onPredictionsChange?.(null);
        } else {
          // Also validate that current_price makes sense (within 5% of actual latest price)
          const actualPrice = stockData[stockData.length - 1]?.close;
          if (actualPrice && result.current_price) {
            const priceDiff = Math.abs(result.current_price - actualPrice) / actualPrice;
            if (priceDiff > 0.05) {
              log.error(`Price mismatch: prediction has $${result.current_price.toFixed(2)}, actual is $${actualPrice.toFixed(2)}`);
              setError(t('ml.modelOutdated'));
              setPrediction(null);
              onPredictionsChange?.(null);
              setIsLoading(false);
              return;
            }
          }
          setPrediction(result);
          // Notify parent about new predictions
          onPredictionsChange?.(result.predictions);
        }
      } else {
        setError('Vorhersage fehlgeschlagen');
        onPredictionsChange?.(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Vorhersage fehlgeschlagen';
      log.error('[ML Predict] Prediction error:', err);
      setError(msg);
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
    // Get ML settings from localStorage
    const mlSettings = getMLSettings();
    log.info('[ML Training] Using settings:', mlSettings);
    
    // Calculate minimum required data points
    // Formula: sequence_length + forecast_days + 50 (buffer for train/test split)
    const minRequired = mlSettings.sequenceLength + mlSettings.forecastDays + 50;
    
    let trainingData: OHLCV[] = stockData;
    
    // Check if we have enough data, if not fetch more
    if (!stockData || stockData.length < minRequired) {
      log.info(`[ML Training] Need ${minRequired} data points, have ${stockData?.length || 0}. Fetching more...`);
      setError(null);
      
      try {
        // Create a temporary DataService to fetch more data
        const dataService = new DataService();
        // Request extra days to account for weekends/holidays
        const daysToFetch = Math.ceil(minRequired * 1.5);
        const fetchedData = await dataService.fetchStockData(symbol, daysToFetch);
        
        if (fetchedData?.data && fetchedData.data.length >= minRequired) {
          trainingData = fetchedData.data;
          log.info(`[ML Training] Fetched ${trainingData.length} data points`);
        } else {
          setError(t('ml.notEnoughData').replace('{required}', String(minRequired)).replace('{available}', String(fetchedData?.data?.length || 0)));
          return;
        }
      } catch (err) {
        log.error('[ML Training] Failed to fetch additional data:', err);
        setError(`${t('ml.loadingError')}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        return;
      }
    }

    setIsTraining(true);
    setError(null);
    
    const result = await mlService.startTraining(symbol, trainingData, {
      epochs: mlSettings.epochs,
      learningRate: mlSettings.learningRate,
      sequenceLength: mlSettings.sequenceLength,
      forecastDays: mlSettings.forecastDays,
      useCuda: mlSettings.useCuda,
      modelType: mlSettings.modelType,
    });
    
    if (!result.success) {
      setIsTraining(false);
      setError(result.message);
    }
  };

  const deleteModel = async () => {
    const success = await mlService.deleteModel(symbol, getMLSettings().modelType);
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
          {t('ml.prediction')}
        </h3>
        <p className="text-gray-400 text-sm">
          {t('ml.notAvailable')}
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
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-1.5 sm:gap-2 min-w-0">
          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="truncate">{t('ml.prediction')}</span>
          {health?.device_info.cuda_available && (
            <span className="text-[10px] sm:text-xs bg-green-600/20 text-green-400 px-1.5 sm:px-2 py-0.5 rounded-full whitespace-nowrap">
              GPU: {health.device_info.cuda_device_name?.split(' ')[0] || 'CUDA'}
            </span>
          )}
          <span className="text-[10px] sm:text-xs bg-purple-600/20 text-purple-300 px-1.5 sm:px-2 py-0.5 rounded-full uppercase whitespace-nowrap">
            {getMLSettings().modelType || 'lstm'}
          </span>
        </h3>
        
        {/* Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {hasModel && !isTraining && (
            <>
              <button
                onClick={loadPrediction}
                disabled={isLoading}
                className="text-[11px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-purple-600/20 text-purple-400 rounded-lg hover:bg-purple-600/30 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {isLoading ? t('ml.loading') : t('ml.refresh')}
              </button>
              <button
                onClick={deleteModel}
                className="text-[11px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors whitespace-nowrap"
              >
                {t('ml.deleteModel')}
              </button>
            </>
          )}
          {!hasModel && !isTraining && (
            <button
              onClick={startTraining}
              className="text-[11px] sm:text-xs px-2 sm:px-3 py-1 sm:py-1.5 bg-blue-600/20 text-blue-400 rounded-lg hover:bg-blue-600/30 transition-colors whitespace-nowrap"
            >
              {t('ml.trainModel')}
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
            <span className="text-gray-400">{t('ml.training').replace('{symbol}', symbol)}</span>
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
      {!hasModel && !isTraining && !prediction && (
        <div className="text-center py-6">
          <svg className="w-12 h-12 mx-auto text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-gray-400 text-sm">{t('ml.noModel').replace('{symbol}', symbol)}</p>
          <p className="text-gray-500 text-xs mt-1">
            {t('ml.trainHint')}
          </p>
        </div>
      )}

      {/* Predictions */}
      {prediction && hasModel && !isTraining && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="bg-slate-700/50 rounded-lg p-2 sm:p-3">
              <p className="text-[10px] sm:text-xs text-gray-400">{t('ml.currentPrice')}</p>
              <p className="text-sm sm:text-lg font-semibold text-white">{formatCurrency(prediction.current_price)}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-2 sm:p-3">
              <p className="text-[10px] sm:text-xs text-gray-400">{t('ml.target7day')}</p>
              {prediction.predictions[6] && (
                <>
                  <p className="text-sm sm:text-lg font-semibold text-white">
                    {formatCurrency(prediction.predictions[6].predicted_price)}
                  </p>
                  <p className={`text-[10px] sm:text-xs ${prediction.predictions[6].change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {prediction.predictions[6].change_pct >= 0 ? '+' : ''}{prediction.predictions[6].change_pct.toFixed(2)}%
                  </p>
                </>
              )}
            </div>
            <div className="bg-slate-700/50 rounded-lg p-2 sm:p-3">
              <p className="text-[10px] sm:text-xs text-gray-400">{t('ml.target14day')}</p>
              {prediction.predictions[13] && (
                <>
                  <p className="text-sm sm:text-lg font-semibold text-white">
                    {formatCurrency(prediction.predictions[13].predicted_price)}
                  </p>
                  <p className={`text-[10px] sm:text-xs ${prediction.predictions[13].change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
                  <th className="text-left py-2">{t('ml.day')}</th>
                  <th className="text-right py-2">{t('ml.price')}</th>
                  <th className="text-right py-2">{t('ml.change')}</th>
                  <th className="text-right py-2">{t('forecast.confidence')}</th>
                </tr>
              </thead>
              <tbody>
                {prediction.predictions.map((pred) => (
                  <tr key={pred.day} className="border-b border-slate-700/50">
                    <td className="py-2 text-gray-300">{t('ml.day')} {pred.day}</td>
                    <td className="py-2 text-right text-white">{formatCurrency(pred.predicted_price)}</td>
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
              {t('ml.modelInfo')
                .replace('{points}', String(prediction.model_info.data_points))
                .replace('{device}', prediction.model_info.device)
                .replace('{loss}', prediction.model_info.final_val_loss?.toFixed(6) || 'N/A')}
            </p>
            <p className="mt-1 text-yellow-500/70">
              {t('ml.disclaimer')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
