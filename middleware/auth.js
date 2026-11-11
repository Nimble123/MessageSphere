const jwt = require('jsonwebtoken');
const { query } = require('../db');
require('dotenv').config();

const INSECURE_JWT_PLACEHOLDERS = new Set([
  'super_secret_jwt_key_change_in_production',
  'development-only-change-me',
  'change_in_production',
  'messagesphere_super_secret_jwt_key_2026_change_in_production',
  'your_jwt_secret_here',
  'generate_a_random_32_character_hex_or_base64_secret_here',
  'secret'
]);

function isPlaceholderSecret(secret) {
  if (!secret) return true;
  const s = secret.trim().toLowerCase();
  if (INSECURE_JWT_PLACEHOLDERS.has(s)) return true;
  if (/^(generate|change|placeholder|your_secret|default|example|test|dev)/i.test(s)) return true;
  return false;
}

if (process.env.NODE_ENV === 'production') {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (!secret || isPlaceholderSecret(secret) || secret.length < 32) {
    throw new Error('FATAL SECURITY CONFIGURATION: In production, JWT_SECRET must be set to a strong, unique secret of at least 32 characters (cannot be a default placeholder).');
  }
}
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';

async function authenticate(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await query(
      'SELECT id, email, role, reseller_id, is_blocked, token_version FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized: User not found' });
    }

    const user = result.rows[0];
    if (user.is_blocked) {
      return res.status(403).json({ error: 'Account blocked. Please contact support.' });
    }

    if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.token_version) {
      return res.status(401).json({ error: 'Session invalidated. Please sign in again.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
}

module.exports = {
  authenticate,
  requireRoles,
  JWT_SECRET
};
