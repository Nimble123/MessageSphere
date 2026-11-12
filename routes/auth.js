const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query, getClient, initializeUserCredits } = require('../db');
const { authenticate, requireRoles, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { hashPassword, comparePassword } = require('../services/hasher');
const { isValidEmail, normalizePhoneNumber } = require('../services/telecom');

// Anti-brute force rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 login attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this IP address. Please try again after 15 minutes.' }
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // max 15 registration attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many account registrations attempted from this IP. Please wait 15 minutes.' }
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
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

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

    const isMatch = await comparePassword(password, user.password_hash);
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

    // Check if user is a team member under an organization
    const teamMemberRes = await query(
      `SELECT tm.parent_user_id, tm.role_title, tm.permissions, tm.status as team_status,
              pu.email as parent_email, pu.role as parent_role
       FROM team_members tm
       JOIN users pu ON pu.id = tm.parent_user_id
       WHERE tm.user_id = $1`,
      [user.id]
    );

    let isTeamMember = false;
    let teamRole = user.role;
    let permissions = {
      can_send_campaigns: true,
      can_view_campaigns: true,
      can_manage_templates: true,
      can_manage_contacts: true,
      can_export_contacts: true,
      can_view_billing: true,
      can_recharge_wallet: true,
      can_manage_team: true
    };
    let effectiveUserId = user.id;
    let parentEmail = null;
    let parentRole = null;

    if (teamMemberRes.rows.length > 0) {
      const tm = teamMemberRes.rows[0];
      if (tm.team_status !== 'active') {
        return res.status(403).json({ error: 'Your staff account has been suspended by your organization administrator.' });
      }
      isTeamMember = true;
      teamRole = tm.role_title;
      permissions = tm.permissions || {};
      effectiveUserId = tm.parent_user_id;
      parentEmail = tm.parent_email;
      parentRole = tm.parent_role;
    }

    const credits = await getUserCredits(effectiveUserId);

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
        isTeamMember,
        teamRole,
        parentEmail,
        parentRole,
        permissions,
        effectiveUserId,
        ...credits
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/invite/:codeOrDomain - Public invite verification (Strict code/domain only, safe sanitized metadata)
router.get('/invite/:codeOrDomain', async (req, res) => {
  try {
    const rawParam = String(req.params.codeOrDomain || '').trim();
    if (!rawParam) {
      return res.status(400).json({ valid: false, error: 'Invite code or domain parameter is required' });
    }
    let cleanParam = rawParam.toLowerCase().replace(/^https?:\/\//i, '').replace(/:\d+$/, '').replace(/\/.*$/, '').trim();
    if (cleanParam.startsWith('www.')) cleanParam = cleanParam.slice(4);

    // Strictly match explicit invite code OR verified custom domain (NEVER raw numeric reseller_id)
    const result = await query(`
      SELECT rp.brand_name, rp.logo_url, rp.accent_color, rp.support_email, rp.support_phone,
             rp.custom_domain, rp.domain_status, rp.invite_code, rp.allow_self_registration,
             u.company_name, u.is_blocked
      FROM reseller_profiles rp
      JOIN users u ON u.id = rp.reseller_id
      WHERE (LOWER(rp.invite_code) = LOWER($1) OR (LOWER(rp.custom_domain) = LOWER($1) AND rp.domain_status = 'Verified'))
        AND u.is_blocked = FALSE
    `, [cleanParam]);

    if (result.rows.length === 0) {
      return res.status(404).json({ valid: false, error: 'Invalid or inactive invite code' });
    }

    const row = result.rows[0];
    return res.json({
      valid: true,
      invite_code: row.invite_code,
      allow_self_registration: row.allow_self_registration !== false,
      reseller: {
        brand_name: row.brand_name || row.company_name || 'Partner',
        logo_url: row.logo_url,
        accent_color: row.accent_color || '#4f46e5',
        support_email: row.support_email,
        support_phone: row.support_phone,
        custom_domain: row.domain_status === 'Verified' ? row.custom_domain : null
      }
    });
  } catch (err) {
    console.error('Invite lookup error:', err);
    return res.status(500).json({ valid: false, error: 'Failed to verify invite link' });
  }
});

// POST /api/auth/register - Client self-registration via invite link or partner domain
router.post('/register', registerLimiter, async (req, res) => {
  const { email, password, full_name, phone, company_name, business_address, gstin, invite_code, account_type } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!full_name || !String(full_name).trim()) {
    return res.status(400).json({ error: 'Full name is required' });
  }
  const normalizedPhone = normalizePhoneNumber(phone, 'domestic') || normalizePhoneNumber(phone, 'international');
  if (!normalizedPhone || normalizedPhone.length < 10) {
    return res.status(400).json({ error: 'A valid 10-15 digit mobile number is required' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  const isResellerSignup = String(account_type).trim().toLowerCase() === 'reseller';

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  let resellerId = null;
  let customRates = null;
  let partnerBrandName = null;

  let candidateSlug = String(invite_code || req.query.ref || '').trim().toLowerCase();
  let candidateHost = String(req.body.domain || req.hostname || req.get('host') || '').toLowerCase().split(':')[0];
  if (candidateHost.startsWith('www.')) candidateHost = candidateHost.slice(4);

  const WHOLESALE_BASE_RATES = {
    gsm_sms_domestic: 0.1200,
    normal_domestic: 0.1500,
    cta_domestic: 0.2400,
    dp_domestic: 0.2800,
    dp_cta_domestic: 0.3500,
    own_number_domestic: 0.0800,
    gsm_sms_international: 1.5000,
    normal_international: 2.0000,
    cta_international: 2.5000,
    dp_international: 2.5000,
    dp_cta_international: 3.0000,
    own_number_international: 1.2000
  };

  let commitmentQty = 0;
  let commitmentChannel = 'gsm_sms_domestic';
  let commitmentRate = 0.1200;
  let baseAmount = 0;
  let gstAmount = 0;
  let totalAmount = 0;
  let cType = 'gsm_sms';
  let cDest = 'domestic';

  if (isResellerSignup) {
    const rawQty = req.body.commitment_quantity;
    if (typeof rawQty === 'string' && /[eE]/.test(rawQty)) {
      return res.status(400).json({ error: 'Invalid commitment quantity format.' });
    }
    commitmentQty = parseInt(rawQty, 10);
    if (isNaN(commitmentQty) || commitmentQty < 100000) {
      return res.status(400).json({ error: 'Reseller partner registration requires an initial minimum purchase commitment of 1,00,000 (1 Lakh) credits.' });
    }
    if (!Number.isSafeInteger(commitmentQty) || commitmentQty > 100000000) {
      return res.status(400).json({ error: 'Commitment quantity exceeds maximum permissible limit.' });
    }

    commitmentChannel = String(req.body.commitment_channel || 'gsm_sms_domestic').trim();
    if (!WHOLESALE_BASE_RATES[commitmentChannel]) {
      commitmentChannel = 'gsm_sms_domestic';
    }
    commitmentRate = WHOLESALE_BASE_RATES[commitmentChannel];
    const isIntl = commitmentChannel.endsWith('_international');
    cDest = isIntl ? 'international' : 'domestic';
    cType = commitmentChannel.replace(/_(domestic|international)$/, '');

    baseAmount = Number((commitmentQty * commitmentRate).toFixed(2));
    const gstinVal = String(req.body.gstin || gstin || '').trim().toUpperCase();
    const hasGst = Boolean(gstinVal && gstinVal.length >= 10);
    gstAmount = hasGst ? Number((baseAmount * 0.18).toFixed(2)) : 0.00;
    totalAmount = Number((baseAmount + gstAmount).toFixed(2));
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Duplicate account check - Consistent response to protect against user enumeration
    const dupCheck = await client.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (dupCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Unable to register account with the provided details. Please verify your email or sign in.' });
    }

    if (!isResellerSignup) {
      if (candidateSlug) {
        // Strictly match invite_code (never match numeric reseller_id)
        const rpRes = await client.query(`
          SELECT rp.reseller_id, rp.brand_name, rp.allow_self_registration, rp.default_rates, u.is_blocked
          FROM reseller_profiles rp
          JOIN users u ON u.id = rp.reseller_id
          WHERE LOWER(rp.invite_code) = LOWER($1)
        `, [candidateSlug]);

        if (rpRes.rows.length === 0 || rpRes.rows[0].is_blocked) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'The provided invite link is invalid or no longer active.' });
        }

        if (rpRes.rows[0].allow_self_registration === false) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Self-registration is currently paused by this partner. Please contact their support.' });
        }

        resellerId = rpRes.rows[0].reseller_id;
        customRates = rpRes.rows[0].default_rates;
        partnerBrandName = rpRes.rows[0].brand_name;
      } else if (candidateHost && candidateHost !== 'localhost' && candidateHost !== '127.0.0.1') {
        // Custom domain auto-binding strictly requires domain_status = 'Verified'
        const domainRes = await client.query(`
          SELECT rp.reseller_id, rp.brand_name, rp.allow_self_registration, rp.default_rates, u.is_blocked
          FROM reseller_profiles rp
          JOIN users u ON u.id = rp.reseller_id
          WHERE (LOWER(rp.custom_domain) = LOWER($1) OR LOWER(rp.custom_domain) = LOWER($2))
            AND rp.domain_status = 'Verified'
        `, [candidateHost, `www.${candidateHost}`]);

        if (domainRes.rows.length > 0 && !domainRes.rows[0].is_blocked) {
          if (domainRes.rows[0].allow_self_registration === false) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Self-registration is currently paused on this portal.' });
          }
          resellerId = domainRes.rows[0].reseller_id;
          customRates = domainRes.rows[0].default_rates;
          partnerBrandName = domainRes.rows[0].brand_name;
        }
      }
    }

    const passwordHash = await hashPassword(password);
    const assignedRole = isResellerSignup ? 'reseller' : 'user';
    const effectiveGstin = String(req.body.gstin || gstin || '').trim().toUpperCase().slice(0, 20) || null;
    const taxMode = (effectiveGstin && effectiveGstin.length >= 10) ? 'with_gst' : 'non_gst';

    const insertResult = await client.query(`
      INSERT INTO users (email, password_hash, role, reseller_id, full_name, company_name, phone, business_address, gstin, tax_mode, refund_destination)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'user')
      RETURNING id, email, role, is_blocked, reseller_id, full_name, company_name, phone, business_address, gstin, tax_mode, refund_destination, created_at
    `, [
      cleanEmail,
      passwordHash,
      assignedRole,
      resellerId,
      String(full_name).trim().slice(0, 120),
      String(company_name || '').trim().slice(0, 160) || null,
      String(normalizedPhone).slice(0, 30),
      String(business_address || '').trim().slice(0, 2000) || null,
      effectiveGstin,
      taxMode
    ]);

    const newUser = insertResult.rows[0];

    // Seed credits with reseller's default rates or standard system rates
    await initializeUserCredits(client, newUser.id, customRates);

    if (isResellerSignup) {
      const brandName = String(req.body.brand_name || company_name || full_name).trim().slice(0, 120) || 'Partner Portal';
      let codeCandidate = brandName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
      if (!codeCandidate || codeCandidate.length < 3) {
        codeCandidate = `partner${newUser.id}`;
      }
      let finalCode = codeCandidate;
      let sfx = 1;
      while (true) {
        const clash = await client.query('SELECT 1 FROM reseller_profiles WHERE LOWER(invite_code) = LOWER($1)', [finalCode]);
        if (clash.rows.length === 0) break;
        sfx++;
        finalCode = `${codeCandidate}${sfx}`;
      }

      await client.query(`
        INSERT INTO reseller_profiles (reseller_id, brand_name, invite_code, allow_self_registration, default_rates)
        VALUES ($1, $2, $3, TRUE, '{}'::jsonb)
        ON CONFLICT (reseller_id) DO UPDATE SET brand_name = EXCLUDED.brand_name
      `, [newUser.id, brandName, finalCode]);

      // Create official onboarding initial commitment order in credit_requests
      await client.query(`
        INSERT INTO credit_requests 
          (user_id, user_email, package_name, credits_requested, credit_type, destination, amount_inr, rate_per_credit, paid_amount, payment_status, utr_number, receipt_url, status, invoice_number, tax_mode, base_amount, gst_amount)
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, 0.00, 'Unpaid', 'PENDING-ONBOARDING', NULL, 'Pending', 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(nextval('invoice_number_seq')::text, 6, '0'), $9, $10, $11)
      `, [
        newUser.id,
        cleanEmail,
        `Partner Onboarding Commitment (1 Lakh Min - ${commitmentChannel})`,
        commitmentQty,
        cType,
        cDest,
        totalAmount,
        commitmentRate,
        taxMode,
        baseAmount,
        gstAmount
      ]);
    }

    await logAudit(client, {
      actorId: newUser.id,
      entityType: 'user',
      entityId: newUser.id,
      action: isResellerSignup ? 'reseller_partner_self_registered' : 'client_self_registered',
      details: {
        role: assignedRole,
        resellerId,
        partnerBrandName,
        inviteCode: candidateSlug || null,
        commitmentQty: isResellerSignup ? commitmentQty : 0,
        commitmentChannel: isResellerSignup ? commitmentChannel : null,
        totalAmount: isResellerSignup ? totalAmount : 0,
        ip: clientIp
      }
    });

    await client.query('COMMIT');

    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role, tokenVersion: 1 },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const credits = await getUserCredits(newUser.id);

    return res.status(201).json({
      message: isResellerSignup 
        ? 'Reseller partner registration successful! Your 1 Lakh credit onboarding order is awaiting verification.'
        : 'Registration successful! Welcome to MessageSphere.',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        isBlocked: newUser.is_blocked,
        resellerId: newUser.reseller_id,
        fullName: newUser.full_name,
        companyName: newUser.company_name,
        phone: newUser.phone,
        businessAddress: newUser.business_address,
        gstin: newUser.gstin,
        taxMode: newUser.tax_mode,
        createdAt: newUser.created_at,
        partnerBrandName
      },
      credits,
      onboardingOrder: isResellerSignup ? {
        channel: commitmentChannel,
        quantity: commitmentQty,
        rate: commitmentRate,
        baseAmount,
        gstAmount,
        totalAmount,
        status: 'Pending'
      } : null
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Failed to complete registration. Please try again later.' });
  } finally {
    client.release();
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const targetUserId = req.user.effective_user_id || req.user.id;
    const userResult = await query(`SELECT full_name, company_name, phone, business_address, gstin FROM users WHERE id = $1`, [targetUserId]);
    if (!userResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const profile = userResult.rows[0];
    const credits = await getUserCredits(targetUserId);
    return res.json({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      isBlocked: req.user.is_blocked,
      resellerId: req.user.reseller_id,
      fullName: req.user.full_name || profile.full_name,
      companyName: profile.company_name,
      phone: profile.phone,
      businessAddress: profile.business_address,
      gstin: profile.gstin,
      isTeamMember: Boolean(req.user.is_team_member),
      teamRole: req.user.team_role || req.user.role,
      parentEmail: req.user.parent_email || null,
      parentRole: req.user.parent_role || null,
      permissions: req.user.permissions || {},
      effectiveUserId: targetUserId,
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
    let result;
    if (req.user.is_team_member) {
      // Team members only update their own personal name and phone; company info remains bounded by parent organization
      result = await client.query(
        `UPDATE users SET full_name = $1, phone = $2 WHERE id = $3 RETURNING full_name, company_name, phone, business_address, gstin`,
        [String(full_name).trim().slice(0, 120), String(phone).trim().slice(0, 30), req.user.id]
      );
    } else {
      result = await client.query(
        `UPDATE users SET full_name = $1, company_name = $2, phone = $3, business_address = $4, gstin = $5 WHERE id = $6 RETURNING full_name, company_name, phone, business_address, gstin`,
        [String(full_name).trim().slice(0, 120), String(company_name || '').trim().slice(0, 160) || null, String(phone).trim().slice(0, 30), String(business_address || '').trim().slice(0, 2000) || null, String(gstin || '').trim().toUpperCase().slice(0, 20) || null, req.user.id]
      );
    }
    await logAudit(client, { actorId: req.user.id, entityType: 'user', entityId: req.user.id, action: 'profile_updated', details: { isTeamMember: Boolean(req.user.is_team_member) } });
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

    const isMatch = await comparePassword(currentPassword, userRes.rows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    const newHash = await hashPassword(newPassword);
    await query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [newHash, req.user.id]);

    return res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
