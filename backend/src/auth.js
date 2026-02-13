/**
 * Authentication Module
 * 
 * Handles user registration, login, session management, and password hashing.
 * Uses bcrypt for password hashing and crypto for token generation.
 */

import crypto from 'crypto';
import { query, getClient } from './db.js';
import logger from './logger.js';

// Simple bcrypt-like hashing using Node's built-in crypto
// In production, consider using the bcrypt package
const SALT_ROUNDS = 10;

/**
 * Hash a password using PBKDF2
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 */
async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Stored hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(key === derivedKey.toString('hex'));
    });
  });
}

/**
 * Generate a secure random token
 * @returns {string}
 */
function generateToken() {
  return crypto.randomBytes(48).toString('base64url');
}

/**
 * Register a new user
 * @param {string} email - User email
 * @param {string} password - Plain text password
 * @param {string} username - Optional username
 * @returns {Promise<{success: boolean, user?: object, error?: string}>}
 */
export async function registerUser(email, password, username = null) {
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    logger.info(`Registration validation failed: Invalid email format for ${email}`);
    return { success: false, error: 'Invalid email format' };
  }

  // Validate password strength
  if (password.length < 8) {
    logger.info(`Registration validation failed: Password too short for ${email}`);
    return { success: false, error: 'Password must be at least 8 characters' };
  }

  try {
    // Check if user already exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      logger.info(`Registration failed: Email already exists - ${email}`);
      return { success: false, error: 'Email already registered' };
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (email, password_hash, username) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, username, created_at`,
      [email.toLowerCase(), passwordHash, username]
    );

    const user = result.rows[0];

    // Create default user settings
    await query(
      `INSERT INTO user_settings (user_id) VALUES ($1)`,
      [user.id]
    );

    logger.info(`User registered successfully: ${email} (ID: ${user.id})`);
    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.created_at,
      },
    };
  } catch (e) {
    logger.error('Registration database error:', e.message);
    logger.error('Stack trace:', e.stack);
    if (e.code === '23505') {
      // PostgreSQL unique violation
      return { success: false, error: 'Email already registered' };
    }
    if (e.code === '42P01') {
      // PostgreSQL table does not exist
      return { success: false, error: 'Database not properly initialized' };
    }
    return { success: false, error: 'Registration failed. Please try again later.' };
  }
}

/**
 * Login a user and create a session
 * @param {string} email - User email
 * @param {string} password - Plain text password
 * @param {string} userAgent - Optional user agent
 * @param {string} ipAddress - Optional IP address
 * @returns {Promise<{success: boolean, token?: string, user?: object, error?: string}>}
 */
export async function loginUser(email, password, userAgent = null, ipAddress = null) {
  try {
    // Find user by email
    const result = await query(
      `SELECT id, email, username, password_hash, is_active FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      logger.info(`Login failed: User not found - ${email}`);
      return { success: false, error: 'Invalid email or password' };
    }

    const user = result.rows[0];

    // Check if user is active
    if (!user.is_active) {
      logger.info(`Login failed: Account deactivated - ${email}`);
      return { success: false, error: 'Account is deactivated' };
    }

    // Verify password
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      logger.info(`Login failed: Invalid password - ${email}`);
      return { success: false, error: 'Invalid email or password' };
    }

    // Generate session token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create session
    await query(
      `INSERT INTO sessions (user_id, token, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, token, expiresAt, userAgent, ipAddress]
    );

    // Update last login
    await query(
      `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
      [user.id]
    );

    logger.info(`Login successful: ${email} (ID: ${user.id})`);
    return {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    };
  } catch (e) {
    logger.error('Login database error:', e.message);
    logger.error('Stack trace:', e.stack);
    if (e.code === '42P01') {
      // PostgreSQL table does not exist
      return { success: false, error: 'Database not properly initialized' };
    }
    return { success: false, error: 'Login failed. Please try again later.' };
  }
}

/**
 * Validate a session token and return the user
 * @param {string} token - Session token
 * @returns {Promise<{valid: boolean, user?: object}>}
 */
export async function validateSession(token) {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.username 
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = true`,
      [token]
    );

    if (result.rows.length === 0) {
      return { valid: false };
    }

    return {
      valid: true,
      user: result.rows[0],
    };
  } catch (e) {
    logger.error('Session validation error:', e);
    return { valid: false };
  }
}

/**
 * Logout a user (invalidate session)
 * @param {string} token - Session token
 * @returns {Promise<boolean>}
 */
export async function logoutUser(token) {
  try {
    await query('DELETE FROM sessions WHERE token = $1', [token]);
    return true;
  } catch (e) {
    logger.error('Logout error:', e);
    return false;
  }
}

/**
 * Middleware to authenticate requests
 * Extracts token from Authorization header and validates it
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.substring(7);
  
  validateSession(token).then(({ valid, user }) => {
    if (!valid) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  }).catch(() => {
    res.status(500).json({ error: 'Authentication error' });
  });
}

/**
 * Optional auth middleware - attaches user if token is valid, but doesn't require it
 */
export function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.substring(7);
  
  validateSession(token).then(({ valid, user }) => {
    req.user = valid ? user : null;
    next();
  }).catch(() => {
    req.user = null;
    next();
  });
}

export default {
  registerUser,
  loginUser,
  validateSession,
  logoutUser,
  authMiddleware,
  optionalAuthMiddleware,
};
