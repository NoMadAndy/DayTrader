/**
 * Frontend Logger Utility
 * 
 * Replaces direct console.log/warn/error calls with a centralized logger.
 * - In production: suppresses debug/info logs, only shows warnings and errors
 * - In development: shows all logs with prefixed context
 * 
 * Usage:
 *   import { log } from '../utils/logger';
 *   log.info('[Component]', 'message', data);
 *   log.warn('[Component]', 'warning');
 *   log.error('[Component]', 'error', err);
 *   log.debug('[Component]', 'debug info');
 */

const IS_PROD = import.meta.env.PROD;

type LogFn = (...args: unknown[]) => void;

interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

// No-op function for suppressed logs
const noop: LogFn = () => {};

export const log: Logger = {
  debug: IS_PROD ? noop : (...args) => console.debug(...args),
  info: IS_PROD ? noop : (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

export default log;
