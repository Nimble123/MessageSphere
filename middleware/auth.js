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

    // Check if user is a team member under an organization/parent account
    const teamMemberRes = await query(
      `SELECT tm.parent_user_id, tm.role_title, tm.permissions, tm.status as team_status,
              pu.email as parent_email, pu.role as parent_role, pu.reseller_id as parent_reseller_id,
              u.full_name
       FROM team_members tm
       JOIN users pu ON pu.id = tm.parent_user_id
       JOIN users u ON u.id = tm.user_id
       WHERE tm.user_id = $1`,
      [user.id]
    );

    if (teamMemberRes.rows.length > 0) {
      const tm = teamMemberRes.rows[0];
      if (tm.team_status !== 'active') {
        return res.status(403).json({ error: 'Team member account has been suspended by organization administrator.' });
      }
      user.is_team_member = true;
      user.parent_user_id = tm.parent_user_id;
      user.parent_email = tm.parent_email;
      user.parent_role = tm.parent_role;
      user.team_role = tm.role_title;
      user.permissions = tm.permissions || {};
      user.effective_user_id = tm.parent_user_id;
      user.full_name = tm.full_name || '';
    } else {
      user.is_team_member = false;
      user.effective_user_id = user.id;
      user.team_role = user.role;
      user.permissions = {
        can_send_campaigns: true,
        can_view_campaigns: true,
        can_manage_templates: true,
        can_manage_contacts: true,
        can_export_contacts: true,
        can_view_billing: true,
        can_recharge_wallet: true,
        can_manage_team: true
      };
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

function requirePermission(permKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // Platform super admin always has all permissions
    if (req.user.role === 'admin') return next();

    // If team member and does not have this permission
    if (req.user.is_team_member && !req.user.permissions?.[permKey]) {
      return res.status(403).json({
        error: `Permission Denied: Your assigned team role (${req.user.team_role}) does not have permission '${permKey}'.`
      });
    }
    next();
  };
}

module.exports = {
  authenticate,
  requireRoles,
  requirePermission,
  JWT_SECRET
};
