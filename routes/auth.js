const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query, getClient } = require('../db');
const { authenticate, requireRoles, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

// Anti-brute force rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 login attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this IP address. Please try again after 15 minutes.' }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 6, // max 6 reset requests per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again after 15 minutes.' }
});

// Helper to fetch user credits formatted as key-value
async function getUserCredits(userId) {
  const result = await query(
    'SELECT credit_type, destination, balance FROM user_credits WHERE user_id = $1',
    [userId]
  );
  const credits = {};
  result.rows.forEach(r => {
    credits[`credits_${r.credit_type}_${r.destination}`] = parseInt(r.balance, 10);
  });
  return credits;
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    if (result.rows.length === 0) {
      await logAudit(null, {
        actorId: null,
        entityType: 'user',
        entityId: null,
        action: 'login_failed',
        details: { email: cleanEmail, reason: 'unknown_account', ip: clientIp }
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    if (user.is_blocked) {
      await logAudit(null, {
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        action: 'login_blocked',
        details: { email: user.email, reason: 'account_suspended', ip: clientIp }
      });
      return res.status(403).json({ error: 'Your account has been blocked. Please contact support.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await logAudit(null, {
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        action: 'login_failed',
        details: { email: user.email, reason: 'invalid_credentials', ip: clientIp }
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, tokenVersion: user.token_version || 1 },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    await logAudit(null, {
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      action: 'login_success',
      details: { email: user.email, role: user.role, ip: clientIp }
    });

    const credits = await getUserCredits(user.id);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isBlocked: user.is_blocked,
        resellerId: user.reseller_id,
        fullName: user.full_name,
        companyName: user.company_name,
        phone: user.phone,
        businessAddress: user.business_address,
        gstin: user.gstin,
        ...credits
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const userResult = await query(`SELECT full_name, company_name, phone, business_address, gstin FROM users WHERE id = $1`, [req.user.id]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const profile = userResult.rows[0];
    const credits = await getUserCredits(req.user.id);
    return res.json({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      isBlocked: req.user.is_blocked,
      resellerId: req.user.reseller_id,
      fullName: profile.full_name,
      companyName: profile.company_name,
      phone: profile.phone,
      businessAddress: profile.business_address,
      gstin: profile.gstin,
      ...credits
    });
  } catch (err) {
    console.error('Auth/me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout - Invalidate active session via token_version increment
router.post('/logout', authenticate, async (req, res) => {
  try {
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    await logAudit(null, {
      actorId: req.user.id,
      entityType: 'user',
      entityId: req.user.id,
      action: 'logout_session_revoked',
      details: { email: req.user.email, ip: req.ip }
    });
    return res.json({ message: 'Successfully logged out. Active sessions revoked.' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ error: 'Failed to revoke session on logout' });
  }
});

// POST /api/auth/forgot-password - manual reset queue; no email is sent by this portal.
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  // Always return the same response to prevent account enumeration.
  const response = { message: 'If this account exists, a secure reset request has been sent to the account administrator.' };
  if (!email) return res.json(response);
  try {
    const user = await query('SELECT id, role FROM users WHERE email = $1', [email]);
    if (!user.rows.length) return res.json(response);
    // Administrative accounts are deliberately not reset through the self-service queue.
    if (user.rows[0].role === 'admin') return res.json(response);
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const pending = await client.query(`SELECT id FROM password_reset_requests WHERE user_id = $1 AND status = 'Pending' FOR UPDATE`, [user.rows[0].id]);
      if (!pending.rows.length) {
        const created = await client.query(`INSERT INTO password_reset_requests (user_id) VALUES ($1) RETURNING id`, [user.rows[0].id]);
        await logAudit(client, { entityType: 'user', entityId: user.rows[0].id, action: 'password_reset_requested', details: { requestId: created.rows[0].id } });
      }
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
    return res.json(response);
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.json(response);
  }
});

router.get('/password-reset-requests', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    let sql, params = [];
    if (req.user.role === 'admin') {
      sql = `SELECT pr.*, u.email, u.full_name, u.company_name, u.reseller_id 
             FROM password_reset_requests pr 
             JOIN users u ON u.id = pr.user_id 
             WHERE pr.status = 'Pending' 
             ORDER BY pr.requested_at ASC`;
    } else {
      sql = `SELECT pr.*, u.email, u.full_name, u.company_name, u.reseller_id 
             FROM password_reset_requests pr 
             JOIN users u ON u.id = pr.user_id 
             WHERE pr.status = 'Pending' AND u.reseller_id = $1
             ORDER BY pr.requested_at ASC`;
      params = [req.user.id];
    }
    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load password reset requests' });
  }
});

// PATCH /api/auth/password-reset-requests/:id/reject - documented manual verification decision.
router.patch('/password-reset-requests/:id/reject', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const reason = String(req.body.reason || '').trim();
  if (!Number.isInteger(requestId) || requestId <= 0) return res.status(400).json({ error: 'Invalid reset request ID' });
  if (!reason) return res.status(400).json({ error: 'A verification reason is required to reject a reset request' });
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Role check: Resellers can only reject requests belonging to their managed clients
    if (req.user.role === 'reseller') {
      const checkRes = await client.query(`
        SELECT pr.id FROM password_reset_requests pr
        JOIN users u ON u.id = pr.user_id
        WHERE pr.id = $1 AND u.reseller_id = $2
      `, [requestId, req.user.id]);
      if (checkRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Permission denied: Resellers can only reject reset requests for their own clients' });
      }
    }

    const result = await client.query(
      `UPDATE password_reset_requests SET status = 'Rejected', resolved_at = NOW(), resolved_by = $1, resolution_note = $2 WHERE id = $3 AND status = 'Pending' RETURNING user_id`,
      [req.user.id, reason.slice(0, 1000), requestId]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending reset request not found' });
    }
    await logAudit(client, { actorId: req.user.id, entityType: 'user', entityId: result.rows[0].user_id, action: 'password_reset_rejected', details: { requestId, reason: reason.slice(0, 1000) } });
    await client.query('COMMIT');
    return res.json({ message: 'Password reset request rejected and recorded.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reject reset request error:', err);
    return res.status(500).json({ error: 'Failed to reject reset request' });
  } finally { client.release(); }
});

// PATCH /api/auth/profile - users maintain their own business contact data.
router.patch('/profile', authenticate, async (req, res) => {
  const { full_name, company_name, phone, business_address, gstin } = req.body;
  if (!full_name || !String(full_name).trim()) return res.status(400).json({ error: 'Full name is required' });
  if (!phone || String(phone).replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'A valid contact phone number is required' });
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE users SET full_name = $1, company_name = $2, phone = $3, business_address = $4, gstin = $5 WHERE id = $6 RETURNING full_name, company_name, phone, business_address, gstin`, [String(full_name).trim().slice(0, 120), String(company_name || '').trim().slice(0, 160) || null, String(phone).trim().slice(0, 30), String(business_address || '').trim().slice(0, 2000) || null, String(gstin || '').trim().toUpperCase().slice(0, 20) || null, req.user.id]);
    await logAudit(client, { actorId: req.user.id, entityType: 'user', entityId: req.user.id, action: 'profile_updated', details: {} });
    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Profile update error:', err);
    return res.status(500).json({ error: 'Failed to update account profile' });
  } finally { client.release(); }
});

// PATCH /api/auth/change-password
router.patch('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long' });
  }

  try {
    const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [newHash, req.user.id]);

    return res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
