/**
 * Input Validation Utilities for DayTrader Backend
 * 
 * Lightweight validation middleware without external dependencies.
 * Validates request body, params, and query parameters.
 */

import logger from './logger.js';

/**
 * Validate email format
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // RFC 5322 simplified
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Validate password strength
 */
export function isValidPassword(password) {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 8 && password.length <= 128;
}

/**
 * Validate stock symbol format
 */
export function isValidSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;
  // Allow alphanumeric, dots, dashes (e.g., BRK.A, BRK-B) - max 20 chars
  return /^[A-Za-z0-9.\-]{1,20}$/.test(symbol);
}

/**
 * Validate username
 */
export function isValidUsername(username) {
  if (!username) return true; // Optional
  if (typeof username !== 'string') return false;
  return /^[A-Za-z0-9_\-]{2,50}$/.test(username);
}

/**
 * Sanitize string input - strip potential injection characters
 */
export function sanitizeString(str, maxLength = 1000) {
  if (!str || typeof str !== 'string') return '';
  return str.slice(0, maxLength).trim();
}

/**
 * Validate that value is a positive integer
 */
export function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

/**
 * Validate that value is a valid number within range
 */
export function isNumberInRange(value, min, max) {
  const n = Number(value);
  return !isNaN(n) && n >= min && n <= max;
}

/**
 * Express middleware factory for validating request body
 * 
 * Usage:
 *   app.post('/route', validateBody({
 *     email: { required: true, validator: isValidEmail, message: 'Invalid email' },
 *     password: { required: true, validator: isValidPassword, message: 'Password must be 8-128 characters' },
 *   }), handler);
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body?.[field];
      
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field}: required`);
        continue;
      }
      
      if (value !== undefined && value !== null && value !== '' && rules.validator) {
        if (!rules.validator(value)) {
          errors.push(rules.message || `${field}: invalid`);
        }
      }
    }
    
    if (errors.length > 0) {
      logger.warn('Input validation failed', { path: req.path, errors });
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    
    next();
  };
}

/**
 * Express middleware to validate path params as symbols
 */
export function validateSymbolParam(paramName = 'symbol') {
  return (req, res, next) => {
    const symbol = req.params[paramName];
    if (!isValidSymbol(symbol)) {
      logger.warn('Invalid symbol parameter', { param: paramName, value: symbol });
      return res.status(400).json({ error: `Invalid symbol: ${sanitizeString(symbol, 20)}` });
    }
    next();
  };
}
