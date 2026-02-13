/**
 * ML Service Client
 * 
 * Client for the ML prediction service. Provides methods for:
 * - Training models on historical data
 * - Getting price predictions
 * - Managing trained models
 */

import type { OHLCV } from '../types/stock';
import { log } from '../utils/logger';

// Use backend proxy for ML service
const ML_API_BASE = '/api/ml';

export interface MLPrediction {
  date: string;
  day: number;
  predicted_price: number;
  confidence: number;
  change_pct: number;
}

export interface MLPredictResponse {
  symbol: string;
  current_price: number;
  predictions: MLPrediction[];
  model_info: {
    symbol: string;
    trained_at: string;
    training_duration_seconds: number;
    epochs_completed: number;
    final_val_loss: number;
    device: string;
    data_points: number;
  };
  generated_at: string;
}

export interface MLTrainStatus {
  symbol: string;
  status: 'starting' | 'training' | 'completed' | 'failed';
  progress: number;
  message: string;
  model_type?: 'lstm' | 'transformer';
  result?: {
    success: boolean;
    metadata: Record<string, unknown>;
    history: Array<{ epoch: number; train_loss: number; val_loss: number }>;
  };
}

export interface MLModelInfo {
  symbol: string;
  model_type?: 'lstm' | 'transformer';
  is_trained: boolean;
  metadata?: Record<string, unknown>;
  device?: string;
}

export interface MLServiceHealth {
  status: string;
  timestamp: string;
  version: string;
  commit: string;
  build_time: string;
  device_info: {
    device: string;
    cuda_available: boolean;
    cuda_enabled: boolean;
    cuda_device_name?: string;
    cuda_memory_total?: string;
  };
}

class MLServiceClient {
  /**
   * Check ML service health and GPU status
   */
  async getHealth(): Promise<MLServiceHealth | null> {
    try {
      const response = await fetch(`${ML_API_BASE}/health`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      log.warn('ML Service health check failed:', error);
      return null;
    }
  }

  /**
   * Check if ML service is available
   */
  async isAvailable(): Promise<boolean> {
    const health = await this.getHealth();
    return health?.status === 'healthy';
  }

  /**
   * Get list of trained models
   */
  async listModels(): Promise<MLModelInfo[]> {
    try {
      const response = await fetch(`${ML_API_BASE}/models`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      log.warn('Failed to list ML models:', error);
      return [];
    }
  }

  /**
   * Get info about a specific model
   */
  async getModelInfo(symbol: string): Promise<MLModelInfo | null> {
    try {
      const response = await fetch(`${ML_API_BASE}/models/${symbol}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      log.warn(`Failed to get model info for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Check if a model exists for a symbol
   */
  async hasModel(symbol: string): Promise<boolean> {
    const info = await this.getModelInfo(symbol);
    return info?.is_trained ?? false;
  }

  /**
   * Start training a model
   * Training happens asynchronously - poll getTrainingStatus for progress
   */
  async startTraining(
    symbol: string,
    data: OHLCV[],
    options?: { 
      epochs?: number; 
      learningRate?: number;
      sequenceLength?: number;
      forecastDays?: number;
      useCuda?: boolean;
      modelType?: 'lstm' | 'transformer';
    }
  ): Promise<{ success: boolean; message: string; statusUrl?: string }> {
    try {
      const response = await fetch(`${ML_API_BASE}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          data: data.map(d => ({
            timestamp: d.time * 1000,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume
          })),
          epochs: options?.epochs,
          learning_rate: options?.learningRate,
          sequence_length: options?.sequenceLength,
          forecast_days: options?.forecastDays,
          use_cuda: options?.useCuda,
          model_type: options?.modelType
        })
      });

      const result = await response.json();
      
      if (!response.ok) {
        return { 
          success: false, 
          message: result.detail || result.error || 'Training failed to start' 
        };
      }

      return {
        success: true,
        message: result.message,
        statusUrl: result.status_url
      };
    } catch (error) {
      log.error('Failed to start training:', error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to start training' 
      };
    }
  }

  /**
   * Get training status for a symbol
   */
  async getTrainingStatus(symbol: string, modelType?: string): Promise<MLTrainStatus | null> {
    try {
      const params = modelType ? `?model_type=${modelType}` : '';
      const response = await fetch(`${ML_API_BASE}/train/${symbol}/status${params}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      log.warn(`Failed to get training status for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get price predictions for a symbol
   * Requires a trained model
   */
  async predict(symbol: string, data: OHLCV[], modelType?: 'lstm' | 'transformer'): Promise<MLPredictResponse | null> {
    try {
      const response = await fetch(`${ML_API_BASE}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          data: data.map(d => ({
            timestamp: d.time * 1000,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume
          })),
          model_type: modelType
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        const detail = typeof error.detail === 'string' ? error.detail : response.statusText;
        log.warn(`Prediction failed for ${symbol}:`, error);
        throw new Error(detail);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.message !== 'Failed to fetch') {
        throw error; // Re-throw API errors with details
      }
      log.error('Prediction error:', error);
      throw new Error('ML Service nicht erreichbar');
    }
  }

  /**
   * Delete a trained model
   */
  async deleteModel(symbol: string, modelType?: string): Promise<boolean> {
    try {
      const params = modelType ? `?model_type=${modelType}` : '';
      const response = await fetch(`${ML_API_BASE}/models/${symbol}${params}`, {
        method: 'DELETE'
      });
      return response.ok;
    } catch (error) {
      log.warn(`Failed to delete model for ${symbol}:`, error);
      return false;
    }
  }
}

// Export singleton instance
export const mlService = new MLServiceClient();
