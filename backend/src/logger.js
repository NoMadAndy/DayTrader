/**
 * Structured Logger for DayTrader Backend
 * 
 * Replaces console.log/warn/error with Winston structured logging.
 * Supports JSON format in production and colorized console in development.
 * 
 * Usage:
 *   import logger from './logger.js';
 *   logger.info('message', { key: 'value' });
 *   logger.warn('warning');
 *   logger.error('error', { err });
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Human-readable format for development
const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss.SSS' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    if (stack) {
      return `${timestamp} ${level}: ${message}\n${stack}${metaStr}`;
    }
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// JSON format for production (structured, machine-parseable)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: NODE_ENV === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: 'daytrader-backend' },
  transports: [
    new winston.transports.Console(),
  ],
});

// Create child loggers with context
logger.child = (meta) => {
  return winston.createLogger({
    level: LOG_LEVEL,
    format: NODE_ENV === 'production' ? prodFormat : devFormat,
    defaultMeta: { service: 'daytrader-backend', ...meta },
    transports: [
      new winston.transports.Console(),
    ],
  });
};

export default logger;
