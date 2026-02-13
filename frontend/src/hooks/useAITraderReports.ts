/**
 * useAITraderReports Hook
 * 
 * Custom hook for fetching and managing AI trader reports.
 */

import { useState, useEffect } from 'react';
import {
  getAITraderReports,
  getAITraderReportByDate,
  generateAITraderReport,
} from '../services/aiTraderService';
import type { AITraderDailyReport } from '../types/aiTrader';
import { log } from '../utils/logger';

export function useAITraderReports(traderId: number | undefined) {
  const [reports, setReports] = useState<AITraderDailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = async () => {
    if (!traderId) return;
    
    try {
      setLoading(true);
      setError(null);
      const data = await getAITraderReports(traderId);
      setReports(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reports');
      log.error('Error fetching reports:', err);
    } finally {
      setLoading(false);
    }
  };

  const getReportByDate = async (date: string) => {
    if (!traderId) return null;
    
    try {
      return await getAITraderReportByDate(traderId, date);
    } catch (err) {
      log.error('Error fetching report by date:', err);
      return null;
    }
  };

  const generateReport = async (date?: string) => {
    if (!traderId) return null;
    
    try {
      const report = await generateAITraderReport(traderId, date);
      // Refresh reports after generating
      await fetchReports();
      return report;
    } catch (err) {
      log.error('Error generating report:', err);
      return null;
    }
  };

  useEffect(() => {
    fetchReports();
  }, [traderId]);

  return {
    reports,
    loading,
    error,
    fetchReports,
    getReportByDate,
    generateReport,
  };
}
