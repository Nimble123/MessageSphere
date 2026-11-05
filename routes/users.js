const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, getClient, initializeUserCredits, CREDIT_TYPES, DESTINATIONS } = require('../db');
const { authenticate, requireRoles, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/users - List users
router.get('/', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    let usersQuery = '';
    let params = [];

    if (req.user.role === 'admin') {
      usersQuery = `
        SELECT u.id, u.email, u.role, u.is_blocked, u.reseller_id, u.full_name, u.company_name, u.phone, u.business_address, u.gstin, u.created_at, u.tax_mode, u.refund_destination,
               r.email AS reseller_email, r.full_name AS reseller_full_name, r.company_name AS reseller_company_name
        FROM users u
        LEFT JOIN users r ON u.reseller_id = r.id
        WHERE u.id != $1
        ORDER BY u.created_at DESC
      `;
      params = [req.user.id];
    } else {
      usersQuery = `
        SELECT u.id, u.email, u.role, u.is_blocked, u.reseller_id, u.full_name, u.company_name, u.phone, u.business_address, u.gstin, u.created_at, u.tax_mode, u.refund_destination,
               r.email AS reseller_email, r.full_name AS reseller_full_name, r.company_name AS reseller_company_name
        FROM users u
        LEFT JOIN users r ON u.reseller_id = r.id
        WHERE u.reseller_id = $1
        ORDER BY u.created_at DESC
      `;
      params = [req.user.id];
    }

    const usersResult = await query(usersQuery, params);
    const userList = usersResult.rows;

    if (userList.length === 0) {
      return res.json([]);
    }

    // Fetch credits for these users
    const userIds = userList.map(u => u.id);
    const creditsResult = await query(
      `SELECT user_id, credit_type, destination, balance, rate_inr FROM user_credits WHERE user_id = ANY($1::int[])`,
      [userIds]
    );

    const creditsMap = {};
    creditsResult.rows.forEach(r => {
      if (!creditsMap[r.user_id]) creditsMap[r.user_id] = {};
      creditsMap[r.user_id][`credits_${r.credit_type}_${r.destination}`] = parseInt(r.balance, 10);
      creditsMap[r.user_id][`rate_${r.credit_type}_${r.destination}`] = parseFloat(r.rate_inr) || 0.1500;
    });

    const response = userList.map(u => ({
      id: u.id,
      email: u.email,
      role: u.role,
      isBlocked: u.is_blocked,
      resellerId: u.reseller_id,
      resellerEmail: u.reseller_email,
      resellerFullName: u.reseller_full_name,
      resellerCompanyName: u.reseller_company_name,
      fullName: u.full_name,
      companyName: u.company_name,
      phone: u.phone,
      businessAddress: u.business_address,
      gstin: u.gstin,
      taxMode: u.tax_mode || 'non_gst',
      refundDestination: u.refund_destination || 'user',
      createdAt: u.created_at,
      ...(creditsMap[u.id] || {})
    }));

    return res.json(response);
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id/360 - Comprehensive User 360 Profile
router.get('/:id/360', authenticate, async (req, res) => {
  try {
    const rawId = req.params.id;
    const targetId = rawId === 'me' ? req.user.id : parseInt(rawId, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });

    // Authorization:
    // admin: can view anyone
    // reseller: can view self or users under their reseller_id
    // user: can only view self
    if (req.user.role === 'user' && targetId !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: You can only view your own 360 profile.' });
    }

    if (req.user.role === 'reseller' && targetId !== req.user.id) {
      const parentCheck = await query('SELECT reseller_id FROM users WHERE id = $1', [targetId]);
      if (!parentCheck.rows.length || parentCheck.rows[0].reseller_id !== req.user.id) {
        return res.status(403).json({ error: 'Permission denied: This user is not under your reseller account.' });
      }
    }

    // 1. User base profile & managing reseller
    const userResult = await query(`
      SELECT u.id, u.email, u.role, u.is_blocked, u.reseller_id, u.full_name, u.company_name, u.phone, u.business_address, u.gstin, u.tax_mode, u.refund_destination, u.created_at,
             r.email AS reseller_email, r.full_name AS reseller_name
      FROM users u
      LEFT JOIN users r ON u.reseller_id = r.id
      WHERE u.id = $1
    `, [targetId]);

    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    // 2. Credits breakdown
    const creditsResult = await query(`
      SELECT credit_type, destination, balance, rate_inr
      FROM user_credits
      WHERE user_id = $1
      ORDER BY destination, credit_type
    `, [targetId]);

    let totalDomestic = 0;
    let totalInternational = 0;
    const creditBalances = {};
    const creditRates = {};
    creditsResult.rows.forEach(r => {
      const bal = parseInt(r.balance, 10) || 0;
      creditBalances[`${r.credit_type}_${r.destination}`] = bal;
      creditRates[`${r.credit_type}_${r.destination}`] = parseFloat(r.rate_inr) || 0.1500;
      if (r.destination === 'domestic') totalDomestic += bal;
      else if (r.destination === 'international') totalInternational += bal;
    });

    // Sub-clients & White-label profile if this user is a reseller
    let resellerClients = [];
    let resellerProfile = null;
    let targetUserIds = [targetId];

    if (user.role === 'reseller') {
      const clientsResult = await query(`
        SELECT u.id, u.email, u.full_name, u.company_name, u.phone, u.is_blocked, u.created_at,
          COALESCE((SELECT SUM(balance) FROM user_credits WHERE user_id = u.id AND destination = 'domestic'), 0)::bigint AS dom_balance,
          COALESCE((SELECT SUM(balance) FROM user_credits WHERE user_id = u.id AND destination = 'international'), 0)::bigint AS intl_balance,
          (SELECT COUNT(*) FROM campaigns WHERE user_id = u.id)::int AS campaign_count,
          COALESCE((SELECT SUM(total_numbers) FROM campaigns WHERE user_id = u.id), 0)::bigint AS total_recipients
        FROM users u
        WHERE u.reseller_id = $1
        ORDER BY u.created_at DESC
      `, [targetId]);
      resellerClients = clientsResult.rows;
      if (resellerClients.length > 0) {
        targetUserIds = [targetId, ...resellerClients.map(c => c.id)];
      }

      const rpRes = await query(`SELECT * FROM reseller_profiles WHERE reseller_id = $1`, [targetId]);
      resellerProfile = rpRes.rows[0] || null;
    }

    // 3. Campaign Performance Stats (Self + Clients for Reseller)
    const campaignStatsResult = await query(`
      SELECT 
        COUNT(*)::int AS total_campaigns,
        COALESCE(SUM(total_numbers), 0)::bigint AS total_numbers,
        COALESCE(SUM(delivered_count), 0)::bigint AS delivered_count,
        COALESCE(SUM(failed_count), 0)::bigint AS failed_count,
        COUNT(CASE WHEN status = 'Submitted' THEN 1 END)::int AS pending_count,
        COUNT(CASE WHEN status = 'Approved' THEN 1 END)::int AS approved_count,
        COUNT(CASE WHEN status = 'Completed' THEN 1 END)::int AS completed_count,
        COUNT(CASE WHEN status = 'Report Updated' THEN 1 END)::int AS reported_count,
        COUNT(CASE WHEN status = 'Rejected' THEN 1 END)::int AS rejected_count
      FROM campaigns
      WHERE user_id = ANY($1::int[])
    `, [targetUserIds]);
    const campaignStats = campaignStatsResult.rows[0] || {};
    const totalDelivered = Number(campaignStats.delivered_count || 0);
    const totalSent = Number(campaignStats.total_numbers || 0);
    const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;

    // 4. Recent Campaigns (up to 12)
    const recentCampaignsResult = await query(`
      SELECT c.id, c.user_id, c.title, c.campaign_type, c.destination, c.total_numbers, c.status, c.delivered_count, c.failed_count, c.created_at,
             u.email AS user_email, u.full_name AS user_name
      FROM campaigns c
      JOIN users u ON c.user_id = u.id
      WHERE c.user_id = ANY($1::int[])
      ORDER BY c.created_at DESC
      LIMIT 12
    `, [targetUserIds]);

    // 5. Recent Credit Transactions (up to 50)
    const transactionsResult = await query(`
      SELECT ct.id, ct.from_user_id, ct.to_user_id, ct.credit_type, ct.destination, ct.amount, ct.reason, ct.created_at,
             ct.refund_campaign_id, ct.refund_client_email,
             fu.email AS from_email, tu.email AS to_email,
             fu.full_name AS from_name, tu.full_name AS to_name
      FROM credit_transactions ct
      LEFT JOIN users fu ON ct.from_user_id = fu.id
      LEFT JOIN users tu ON ct.to_user_id = tu.id
      WHERE ct.to_user_id = $1 OR ct.from_user_id = $1
      ORDER BY ct.created_at DESC
      LIMIT 50
    `, [targetId]);

    // 6. Audience & Assets summary
    const assetsResult = await query(`
      SELECT 
        (SELECT COUNT(*)::int FROM contact_groups WHERE user_id = $1) AS total_groups,
        (SELECT COUNT(*)::int FROM contacts WHERE user_id = $1) AS total_contacts,
        (SELECT COUNT(*)::int FROM templates WHERE user_id = $1) AS total_templates,
        (SELECT COUNT(*)::int FROM templates WHERE user_id = $1 AND is_approved = TRUE) AS approved_templates,
        (SELECT COUNT(*)::int FROM blacklist WHERE user_id = $1) AS blacklisted_count
    `, [targetId]);
    const assets = assetsResult.rows[0] || {};

    // Sanitize and classify transactions with precise flow types, signs, and badges
    const sanitizedTransactions = transactionsResult.rows.map(t => {
      let reason = t.reason || '';
      let fromEmail = t.from_email || 'System / Platform';
      if (req.user.role !== 'admin') {
        reason = reason
          .replace(/Allotted by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Telecom Balance Allotment: ')
          .replace(/Deduction by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Balance Adjustment: ')
          .replace(/\bby reseller\b/gi, 'via Telecom Gateway')
          .replace(/\[Created by [^\]]+ on behalf of account\]/gi, '');
        if (req.user.role === 'user') {
          fromEmail = 'Direct Telecom Platform';
        }
      }

      const reasonLower = String(t.reason || '').toLowerCase();
      const isRefund = Boolean(t.refund_campaign_id) || reasonLower.includes('refund') || reasonLower.includes('auto-refund');
      const isDeduction = reasonLower.includes('deduction') || reasonLower.includes('debit') || reasonLower.includes('burn') || reasonLower.includes('cost');
      const isTransferredOut = Number(t.from_user_id) === Number(targetId) && Number(t.to_user_id) !== Number(targetId);
      const amt = Math.abs(Number(t.amount) || 0);

      let category = 'allotment';
      let signedAmount = amt;
      let badgeText = 'Allotment (+)';
      let badgeColor = '#15803d';
      let badgeBg = '#ecfdf5';
      let badgeBorder = '#bbf7d0';
      let isCredit = true;

      if (isRefund) {
        category = 'refund';
        signedAmount = amt;
        badgeText = 'Auto-Refund (+)';
        badgeColor = '#0284c7';
        badgeBg = '#f0f9ff';
        badgeBorder = '#bae6fd';
        isCredit = true;
      } else if (isTransferredOut) {
        category = 'allotment_out';
        signedAmount = -amt;
        badgeText = 'Transferred to Client (-)';
        badgeColor = '#d97706';
        badgeBg = '#fffbeb';
        badgeBorder = '#fde68a';
        isCredit = false;
      } else if (isDeduction) {
        category = 'campaign_deduction';
        signedAmount = -amt;
        badgeText = 'Campaign Debit (-)';
        badgeColor = '#b91c1c';
        badgeBg = '#fef2f2';
        badgeBorder = '#fecaca';
        isCredit = false;
      }

      return {
        ...t,
        reason,
        from_email: fromEmail,
        to_email: t.to_email,
        to_name: t.to_name,
        category,
        signed_amount: signedAmount,
        badge_text: badgeText,
        badge_color: badgeColor,
        badge_bg: badgeBg,
        badge_border: badgeBorder,
        is_credit: isCredit
      };
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isBlocked: user.is_blocked,
        resellerId: user.reseller_id,
        resellerEmail: user.reseller_email,
        resellerName: user.reseller_name,
        fullName: user.full_name,
        companyName: user.company_name,
        phone: user.phone,
        businessAddress: user.business_address,
        gstin: user.gstin,
        taxMode: user.tax_mode || 'non_gst',
        refundDestination: user.refund_destination || 'user',
        createdAt: user.created_at
      },
      credits: {
        balances: creditBalances,
        rates: creditRates,
        totalDomestic,
        totalInternational,
        totalBalance: totalDomestic + totalInternational
      },
      campaignStats: {
        totalCampaigns: Number(campaignStats.total_campaigns || 0),
        totalNumbers: totalSent,
        deliveredCount: totalDelivered,
        failedCount: Number(campaignStats.failed_count || 0),
        pendingCount: Number(campaignStats.pending_count || 0),
        approvedCount: Number(campaignStats.approved_count || 0),
        completedCount: Number(campaignStats.completed_count || 0),
        reportedCount: Number(campaignStats.reported_count || 0),
        rejectedCount: Number(campaignStats.rejected_count || 0),
        deliveryRate
      },
      recentCampaigns: recentCampaignsResult.rows,
      recentTransactions: sanitizedTransactions,
      resellerClients: resellerClients,
      resellerProfile: resellerProfile,
      assets: {
        totalGroups: Number(assets.total_groups || 0),
        totalContacts: Number(assets.total_contacts || 0),
        totalTemplates: Number(assets.total_templates || 0),
        approvedTemplates: Number(assets.approved_templates || 0),
        blacklistedCount: Number(assets.blacklisted_count || 0)
      }
    });
  } catch (err) {
    console.error('User 360 profile error:', err);
    return res.status(500).json({ error: 'Failed to load user 360 profile' });
  }
});

// POST /api/users - Create a new user
router.post('/', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const { email, password, role, full_name, company_name, phone, business_address, gstin, reseller_id, tax_mode, refund_destination } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  if (!full_name || !String(full_name).trim()) {
    return res.status(400).json({ error: 'Full name is required' });
  }
  if (!phone || String(phone).replace(/\D/g, '').length < 10) {
    return res.status(400).json({ error: 'A valid contact phone number is required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  const assignedRole = role || 'user';
  if (req.user.role === 'reseller' && assignedRole === 'reseller') {
    return res.status(403).json({ error: 'Resellers can only create Users.' });
  }
  if (req.user.role === 'reseller' && role && role !== 'user') {
    return res.status(403).json({ error: 'Resellers can only create Users.' });
  }

  const allowedRoles = req.user.role === 'admin' ? ['user', 'reseller', 'admin'] : ['user'];
  if (!allowedRoles.includes(assignedRole)) {
    return res.status(400).json({ error: `Invalid role specified. Permitted: ${allowedRoles.join(', ')}` });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Check if email already exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let resellerId = req.user.role === 'reseller' ? req.user.id : null;
    if (req.user.role === 'admin' && assignedRole === 'user' && reseller_id) {
      const resellerCheck = await client.query(`SELECT id FROM users WHERE id = $1 AND role = 'reseller'`, [parseInt(reseller_id, 10)]);
      if (!resellerCheck.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Selected reseller account is invalid' });
      }
      resellerId = resellerCheck.rows[0].id;
    }

    const finalTaxMode = ['with_gst', 'non_gst'].includes(tax_mode)
      ? tax_mode
      : ((gstin && String(gstin).trim()) ? 'with_gst' : 'non_gst');

    const finalRefundDest = ['user', 'reseller'].includes(refund_destination)
      ? refund_destination
      : 'user';

    const insertResult = await client.query(`
      INSERT INTO users (email, password_hash, role, reseller_id, full_name, company_name, phone, business_address, gstin, tax_mode, refund_destination)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, email, role, is_blocked, reseller_id, full_name, company_name, phone, business_address, gstin, tax_mode, refund_destination, created_at
    `, [email.trim().toLowerCase(), passwordHash, assignedRole, resellerId, String(full_name).trim().slice(0, 120), String(company_name || '').trim().slice(0, 160) || null, String(phone).trim().slice(0, 30), String(business_address || '').trim().slice(0, 2000) || null, String(gstin || '').trim().toUpperCase().slice(0, 20) || null, finalTaxMode, finalRefundDest]);

    const newUser = insertResult.rows[0];
    await initializeUserCredits(client, newUser.id);
    if (newUser.role === 'reseller') {
      const defaultBrand = newUser.company_name || newUser.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
      await client.query(`INSERT INTO reseller_profiles (reseller_id, brand_name) VALUES ($1, $2)`, [newUser.id, defaultBrand || 'Reseller Portal']);
    }
    await logAudit(client, { actorId: req.user.id, entityType: 'user', entityId: newUser.id, action: 'user_created', details: { role: newUser.role, resellerId: newUser.reseller_id } });

    await client.query('COMMIT');
    return res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create user error:', err);
    return res.status(500).json({ error: 'Failed to create user' });
  } finally {
    client.release();
  }
});

// PATCH /api/users/:id/block - Toggle block/unblock
router.patch('/:id/block', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });

  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot block yourself' });
  }

  try {
    const userCheck = await query('SELECT id, reseller_id, is_blocked FROM users WHERE id = $1', [targetId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userCheck.rows[0];
    const targetRole = await query('SELECT role FROM users WHERE id = $1', [targetId]);
    if (targetRole.rows[0] && targetRole.rows[0].role === 'admin') {
      return res.status(403).json({ error: 'Administrator accounts cannot be modified here' });
    }
    if (req.user.role === 'reseller' && targetUser.reseller_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: Cannot modify users from other accounts' });
    }

    const newBlockedState = !targetUser.is_blocked;
    await query('UPDATE users SET is_blocked = $1, token_version = token_version + 1 WHERE id = $2', [newBlockedState, targetId]);

    return res.json({ message: `User ${newBlockedState ? 'blocked' : 'unblocked'} successfully`, isBlocked: newBlockedState });
  } catch (err) {
    console.error('Block user error:', err);
    return res.status(500).json({ error: 'Failed to update user block status' });
  }
});

// PATCH /api/users/:id/settings - Update tax invoicing mode, auto-refund destination & profile
router.patch('/:id/settings', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });

  const { tax_mode, refund_destination, full_name, company_name, phone, gstin, business_address } = req.body;

  try {
    const userCheck = await query('SELECT id, email, role, reseller_id FROM users WHERE id = $1', [targetId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const targetUser = userCheck.rows[0];

    // Resellers can only update their own sub-users
    if (req.user.role === 'reseller' && targetUser.reseller_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: You can only update your own users' });
    }

    const updates = [];
    const values = [];
    let pIdx = 1;

    if (tax_mode !== undefined && ['with_gst', 'non_gst'].includes(tax_mode)) {
      updates.push(`tax_mode = $${pIdx++}`);
      values.push(tax_mode);
    }
    if (refund_destination !== undefined && ['user', 'reseller'].includes(refund_destination)) {
      updates.push(`refund_destination = $${pIdx++}`);
      values.push(refund_destination);
    }
    if (full_name !== undefined && String(full_name).trim()) {
      updates.push(`full_name = $${pIdx++}`);
      values.push(String(full_name).trim().slice(0, 120));
    }
    if (company_name !== undefined) {
      updates.push(`company_name = $${pIdx++}`);
      values.push(String(company_name || '').trim().slice(0, 160) || null);
    }
    if (phone !== undefined && String(phone).trim()) {
      updates.push(`phone = $${pIdx++}`);
      values.push(String(phone).trim().slice(0, 30));
    }
    if (gstin !== undefined) {
      updates.push(`gstin = $${pIdx++}`);
      values.push(String(gstin || '').trim().toUpperCase().slice(0, 20) || null);
    }
    if (business_address !== undefined) {
      updates.push(`business_address = $${pIdx++}`);
      values.push(String(business_address || '').trim().slice(0, 2000) || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    values.push(targetId);
    const updateSql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${pIdx} RETURNING id, email, role, full_name, company_name, phone, gstin, tax_mode, refund_destination`;
    const updated = await query(updateSql, values);

    return res.json({
      message: 'Account settings updated successfully',
      user: updated.rows[0]
    });
  } catch (err) {
    console.error('Update user settings error:', err);
    return res.status(500).json({ error: 'Failed to update user settings' });
  }
});

// POST /api/users/:id/credits - Add/allot credits
router.post('/:id/credits', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });

  const { updates, reason } = req.body;
  // updates is expected as an object: { 'normal_domestic': 500, 'dp_international': 100, ... }
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Please specify credits to add' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required for manual credit allocation' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Verify target user exists
    const targetCheck = await client.query('SELECT id, email, reseller_id, tax_mode, gstin FROM users WHERE id = $1', [targetId]);
    if (targetCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Target user not found' });
    }
    const targetUser = targetCheck.rows[0];

    // Check permissions
    if (req.user.role === 'reseller' && targetUser.reseller_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: Reseller can only allocate credits to own users' });
    }

    const mode = req.body.mode === 'debit' ? 'debit' : 'credit';
    const effectiveTaxMode = ['with_gst', 'non_gst'].includes(req.body.tax_mode)
      ? req.body.tax_mode
      : ((targetUser.tax_mode === 'with_gst' || (targetUser.gstin && String(targetUser.gstin).trim())) ? 'with_gst' : 'non_gst');

    // Process each credit update
    for (const [key, rawVal] of Object.entries(updates)) {
      const amount = parseInt(rawVal, 10);
      if (isNaN(amount) || amount <= 0) continue;

      // Extract credit_type and destination from key (e.g., normal_domestic, dp_cta_domestic, etc.)
      let destination = '';
      let creditType = '';
      if (key.endsWith('_domestic')) {
        destination = 'domestic';
        creditType = key.replace(/_domestic$/, '');
      } else if (key.endsWith('_international')) {
        destination = 'international';
        creditType = key.replace(/_international$/, '');
      } else {
        continue;
      }

      if (!CREDIT_TYPES.includes(creditType) || !DESTINATIONS.includes(destination)) {
        continue;
      }

      if (mode === 'debit') {
        // --- DEBIT / CLAWBACK MODE ---
        const targetCredit = await client.query(
          `SELECT balance FROM user_credits WHERE user_id = $1 AND credit_type = $2 AND destination = $3 FOR UPDATE`,
          [targetId, creditType, destination]
        );
        const targetBal = targetCredit.rows.length > 0 ? parseInt(targetCredit.rows[0].balance, 10) : 0;
        if (targetBal < amount) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Insufficient balance to deduct for ${creditType} (${destination}). Client only has ${targetBal.toLocaleString()} credits.`
          });
        }

        // Deduct from target user
        await client.query(
          `UPDATE user_credits SET balance = balance - $1 WHERE user_id = $2 AND credit_type = $3 AND destination = $4`,
          [amount, targetId, creditType, destination]
        );

        // If reseller is recovering stock from client, add back to reseller stock
        if (req.user.role === 'reseller') {
          await client.query(`
            INSERT INTO user_credits (user_id, credit_type, destination, balance)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, credit_type, destination)
            DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance
          `, [req.user.id, creditType, destination, amount]);
        }

        // Record debit transaction in passbook
        await client.query(`
          INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, direction)
          VALUES ($1, $2, $3, $4, $5, $6, 'debit')
        `, [req.user.id, targetId, creditType, destination, amount, `Balance Adjustment / Debit: ${String(reason || 'Manual Adjustment').trim().slice(0, 180)}`]);

        await logAudit(client, { actorId: req.user.id, entityType: 'user', entityId: targetId, action: 'credits_deducted', details: { creditType, destination, amount, reason: String(reason || '').trim().slice(0, 1000) } });

      } else {
        // --- CREDIT ALLOTMENT MODE ---
        // If reseller, deduct from reseller balance first
        if (req.user.role === 'reseller') {
          const resellerCredit = await client.query(
            `SELECT balance FROM user_credits WHERE user_id = $1 AND credit_type = $2 AND destination = $3 FOR UPDATE`,
            [req.user.id, creditType, destination]
          );
          const currentBal = resellerCredit.rows.length > 0 ? parseInt(resellerCredit.rows[0].balance, 10) : 0;
          if (currentBal < amount) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: `Insufficient balance in your account for ${creditType} (${destination}). Available: ${currentBal}, Needed: ${amount}`
            });
          }

          // Deduct from reseller
          await client.query(
            `UPDATE user_credits SET balance = balance - $1 WHERE user_id = $2 AND credit_type = $3 AND destination = $4`,
            [amount, req.user.id, creditType, destination]
          );
        }

        // Add to target user
        await client.query(`
          INSERT INTO user_credits (user_id, credit_type, destination, balance)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, credit_type, destination)
          DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance
        `, [targetId, creditType, destination, amount]);

        // Record credit transaction in passbook
        await client.query(`
          INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, tax_mode, base_amount, gst_amount, direction)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'credit')
        `, [req.user.id, targetId, creditType, destination, amount, `Allotted via Telecom Gateway: ${String(reason || 'Top-up allocation').trim().slice(0, 180)}`, effectiveTaxMode, 0.00, 0.00]);

        await logAudit(client, { actorId: req.user.id, entityType: 'user', entityId: targetId, action: 'credits_allocated', details: { creditType, destination, amount, reason: String(reason || '').trim().slice(0, 1000) } });
      }
    }

    const incomingRates = req.body.rates || {};

    // Commercial Billing: create invoice record in credit_requests for credit allotments with itemized channel rates
    if (mode !== 'debit') {
      let totalAllotted = 0;
      let totalBill = 0;
      let primaryType = 'gsm_sms';
      let primaryDest = 'domestic';
      const channelRatesBreakdown = {};

      for (const [key, rawVal] of Object.entries(updates)) {
        const val = parseInt(rawVal, 10) || 0;
        if (val > 0) {
          totalAllotted += val;
          let dest = 'domestic';
          let cType = '';
          if (key.endsWith('_international')) {
            dest = 'international';
            cType = key.replace(/_international$/, '');
          } else {
            dest = 'domestic';
            cType = key.replace(/_domestic$/, '');
          }

          primaryDest = dest;
          primaryType = cType;

          // Get channel rate (either incoming custom rate or user's existing rate or default)
          let chRate = 0.1500;
          if (incomingRates[key] !== undefined && incomingRates[key] !== '') {
            chRate = parseFloat(incomingRates[key]) || 0.1500;
          } else {
            const chRateRes = await client.query(
              `SELECT rate_inr FROM user_credits WHERE user_id = $1 AND credit_type = $2 AND destination = $3`,
              [targetId, cType, dest]
            );
            if (chRateRes.rows.length > 0 && chRateRes.rows[0].rate_inr !== null) {
              chRate = parseFloat(chRateRes.rows[0].rate_inr);
            }
          }

          // Persist user's custom rate for this channel
          await client.query(`
            UPDATE user_credits 
            SET rate_inr = $1 
            WHERE user_id = $2 AND credit_type = $3 AND destination = $4
          `, [chRate, targetId, cType, dest]);

          const channelCost = Math.round((val * chRate) * 100) / 100;
          totalBill += channelCost;
          channelRatesBreakdown[key] = {
            credits: val,
            rate: chRate,
            cost: channelCost
          };
        }
      }

      if (totalAllotted > 0) {
        let baseSubtotal = Math.round(totalBill * 100) / 100;
        let gstAmount = 0.00;
        let grossInvoice = baseSubtotal;

        if (effectiveTaxMode === 'with_gst') {
          gstAmount = Math.round(baseSubtotal * 0.18 * 100) / 100;
          grossInvoice = Math.round((baseSubtotal + gstAmount) * 100) / 100;
        }

        if (req.body.total_bill !== undefined && req.body.total_bill !== '') {
          const explicitBill = parseFloat(req.body.total_bill) || 0;
          if (explicitBill > 0) {
            grossInvoice = explicitBill;
            if (effectiveTaxMode === 'with_gst') {
              baseSubtotal = Math.round((grossInvoice / 1.18) * 100) / 100;
              gstAmount = Math.round((grossInvoice - baseSubtotal) * 100) / 100;
            } else {
              baseSubtotal = grossInvoice;
              gstAmount = 0.00;
            }
          }
        }

        const avgRate = totalAllotted > 0 ? (grossInvoice / totalAllotted) : 0.1500;
        
        let paymentStatus = (req.body.payment_status || 'unpaid').toLowerCase();
        let paidAmount = 0.00;

        if (paymentStatus === 'paid') {
          paidAmount = grossInvoice;
          paymentStatus = 'Paid';
        } else if (paymentStatus === 'partial') {
          paidAmount = parseFloat(req.body.paid_amount) || 0.00;
          if (paidAmount >= grossInvoice && grossInvoice > 0) paymentStatus = 'Paid';
          else if (paidAmount <= 0) paymentStatus = 'Unpaid';
          else paymentStatus = 'Partial';
        } else {
          paidAmount = 0.00;
          paymentStatus = 'Unpaid';
        }

        const invNumber = `INV-${Date.now().toString().slice(-6)}`;
        const notes = String(reason || `Direct Telecom Allocation`).trim();

        await client.query(`
          INSERT INTO credit_requests 
            (user_id, package_name, credits_requested, credit_type, destination, amount_inr, rate_per_credit, paid_amount, payment_status, utr_number, status, billing_type, payment_notes, channel_rates, tax_mode, base_amount, gst_amount, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Approved', 'postpaid_credit', $11, $12::jsonb, $13, $14, $15, CURRENT_TIMESTAMP)
        `, [
          targetId,
          `Credit Allotment (${req.user.role === 'admin' ? 'Super Admin' : 'Reseller'})`,
          totalAllotted,
          primaryType,
          primaryDest,
          grossInvoice,
          avgRate,
          paidAmount,
          paymentStatus,
          invNumber,
          notes,
          JSON.stringify(channelRatesBreakdown),
          effectiveTaxMode,
          baseSubtotal,
          gstAmount
        ]);
      }
    }

    await client.query('COMMIT');
    return res.json({ message: 'Credits updated successfully!' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update credits error:', err);
    return res.status(500).json({ error: 'Failed to update credits' });
  } finally {
    client.release();
  }
});

// PATCH /api/users/:id/reset-password - Admin or Reseller resets user password
router.patch('/:id/reset-password', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { newPassword, reset_request_id } = req.body;

  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long' });
  }

  try {
    const userCheck = await query('SELECT id, email, reseller_id FROM users WHERE id = $1', [targetId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userCheck.rows[0];
    const targetRole = await query('SELECT role FROM users WHERE id = $1', [targetId]);
    if (targetRole.rows[0] && targetRole.rows[0].role === 'admin') {
      return res.status(403).json({ error: 'Administrator accounts cannot be modified here' });
    }
    if (req.user.role === 'reseller' && targetUser.reseller_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: Cannot modify users from other accounts' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [hash, targetId]);
      if (reset_request_id && (req.user.role === 'admin' || req.user.role === 'reseller')) {
        await client.query(`UPDATE password_reset_requests SET status = 'Resolved', resolved_at = NOW(), resolved_by = $1, resolution_note = $4 WHERE id = $2 AND user_id = $3 AND status = 'Pending'`, [req.user.id, parseInt(reset_request_id, 10), targetId, `Password reset completed by ${req.user.role}`]);
      }
      await logAudit(client, { actorId: req.user.id, entityType: 'user', entityId: targetId, action: 'password_reset_completed', details: { resetRequestId: reset_request_id || null } });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }

    return res.json({ message: `Password for ${targetUser.email} has been reset successfully.` });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// DELETE /api/users/:id - Admin or Reseller deletes user
router.delete('/:id', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });

  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    const userCheck = await query('SELECT id, email, reseller_id FROM users WHERE id = $1', [targetId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userCheck.rows[0];
    const targetRoleRes = await query('SELECT role FROM users WHERE id = $1', [targetId]);
    const targetRole = targetRoleRes.rows[0] ? targetRoleRes.rows[0].role : 'user';

    if (targetRole === 'admin') {
      return res.status(403).json({ error: 'Administrator accounts cannot be deleted' });
    }
    if (req.user.role === 'reseller' && targetUser.reseller_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: Cannot delete users from other accounts' });
    }

    // Safety Rule 1: Cannot delete a reseller with active managed sub-accounts
    if (targetRole === 'reseller') {
      const clientCountRes = await query('SELECT COUNT(*)::int as count FROM users WHERE reseller_id = $1', [targetId]);
      const subClientCount = clientCountRes.rows[0].count;
      if (subClientCount > 0) {
        return res.status(400).json({
          error: `Cannot delete reseller account: There are ${subClientCount} active client accounts managed under this reseller. Please re-assign or delete those client accounts first.`
        });
      }
    }

    // Safety Rule 2: Cannot delete an account with campaigns in dispatch progress
    const activeCampRes = await query(
      `SELECT COUNT(*)::int as count FROM campaigns WHERE user_id = $1 AND status IN ('Submitted', 'Approved')`,
      [targetId]
    );
    if (activeCampRes.rows[0].count > 0) {
      return res.status(400).json({
        error: `Cannot delete account: This user has ${activeCampRes.rows[0].count} campaign(s) currently pending or in the operator dispatch queue. Please cancel or process them first.`
      });
    }

    // Safety Rule 3: For resellers, prevent accidental loss of unspent client credit stock
    if (req.user.role === 'reseller') {
      const balRes = await query(
        `SELECT COALESCE(SUM(balance), 0)::bigint as total_bal FROM user_credits WHERE user_id = $1`,
        [targetId]
      );
      const totalBal = parseInt(balRes.rows[0].total_bal, 10) || 0;
      if (totalBal > 0) {
        return res.status(400).json({
          error: `Cannot delete account: Client still has ${totalBal.toLocaleString()} unspent credits in their wallet. Please claw back/deduct these credits back to your reseller stock before deleting the account.`
        });
      }
    }

    await query('DELETE FROM users WHERE id = $1', [targetId]);
    return res.json({ message: `User ${targetUser.email} deleted successfully.` });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// POST /api/users/:id/reassign-clients - Super Admin reassigns managed client accounts to another reseller or to platform
router.post('/:id/reassign-clients', authenticate, requireRoles('admin'), async (req, res) => {
  const sourceResellerId = parseInt(req.params.id, 10);
  if (isNaN(sourceResellerId)) return res.status(400).json({ error: 'Invalid source reseller ID' });

  // target_reseller_id: null (platform root) OR positive integer of destination reseller
  let targetResellerId = req.body.target_reseller_id;
  if (targetResellerId === 'null' || targetResellerId === '' || targetResellerId === undefined) {
    targetResellerId = null;
  } else {
    targetResellerId = parseInt(targetResellerId, 10);
    if (isNaN(targetResellerId)) {
      return res.status(400).json({ error: 'Target reseller ID must be a valid ID or null' });
    }
  }

  if (targetResellerId !== null && targetResellerId === sourceResellerId) {
    return res.status(400).json({ error: 'Target reseller cannot be the same as the source reseller' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Verify source reseller exists and is actually a reseller
    const sourceCheck = await client.query('SELECT id, email, role FROM users WHERE id = $1', [sourceResellerId]);
    if (sourceCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source account not found' });
    }
    if (sourceCheck.rows[0].role !== 'reseller') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Source account is not a reseller' });
    }

    // 2. If target is provided, verify it exists and is an active reseller
    let targetEmail = 'Platform Root (Direct Client)';
    if (targetResellerId !== null) {
      const targetCheck = await client.query('SELECT id, email, role, is_blocked FROM users WHERE id = $1', [targetResellerId]);
      if (targetCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Target destination reseller not found' });
      }
      if (targetCheck.rows[0].role !== 'reseller') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Target destination account is not a reseller' });
      }
      targetEmail = targetCheck.rows[0].email;
    }

    // 3. Count clients currently assigned
    const countRes = await client.query('SELECT COUNT(*)::int as count FROM users WHERE reseller_id = $1', [sourceResellerId]);
    const clientCount = countRes.rows[0].count;

    if (clientCount === 0) {
      await client.query('ROLLBACK');
      return res.json({ message: 'No client accounts currently assigned to this reseller.', reassignedCount: 0 });
    }

    // 4. Atomically reassign clients
    await client.query(`UPDATE users SET reseller_id = $1 WHERE reseller_id = $2`, [targetResellerId, sourceResellerId]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'reseller',
      entityId: sourceResellerId,
      action: 'clients_reassigned',
      details: {
        sourceReseller: sourceCheck.rows[0].email,
        targetResellerId,
        targetResellerEmail: targetEmail,
        reassignedCount: clientCount
      }
    });

    await client.query('COMMIT');
    return res.json({
      message: `Successfully reassigned ${clientCount} client account(s) from ${sourceCheck.rows[0].email} to ${targetEmail}.`,
      reassignedCount: clientCount,
      targetResellerId
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reassign clients error:', err);
    return res.status(500).json({ error: 'Failed to reassign client accounts' });
  } finally {
    client.release();
  }
});

// POST /api/users/:id/impersonate - Super Admin or Reseller logs into client account
router.post('/:id/impersonate', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });

  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'Cannot impersonate your own account' });
  }

  try {
    const userCheck = await query(
      `SELECT id, email, role, is_blocked, reseller_id, full_name, company_name, token_version FROM users WHERE id = $1`,
      [targetId]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userCheck.rows[0];

    // Security Rules:
    // Admin can impersonate any non-admin
    // Reseller can only impersonate their own client
    if (targetUser.role === 'admin') {
      return res.status(403).json({ error: 'Super Admin accounts cannot be impersonated' });
    }

    if (req.user.role === 'reseller') {
      if (targetUser.reseller_id !== req.user.id) {
        return res.status(403).json({ error: 'Permission denied: You can only impersonate accounts under your reseller network' });
      }
    }

    if (targetUser.is_blocked) {
      return res.status(400).json({ error: 'Cannot impersonate a blocked/suspended account' });
    }

    // Sign JWT token for the target user, encoding impersonator metadata
    const token = jwt.sign(
      {
        userId: targetUser.id,
        email: targetUser.email,
        role: targetUser.role,
        tokenVersion: targetUser.token_version || 1,
        impersonatedBy: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role
        }
      },
      JWT_SECRET,
      { expiresIn: '2d' }
    );

    // Audit log
    await logAudit(null, {
      actorId: req.user.id,
      entityType: 'user',
      entityId: targetId,
      action: 'user_impersonated',
      details: {
        targetEmail: targetUser.email,
        impersonatorEmail: req.user.email,
        impersonatorRole: req.user.role
      }
    });

    return res.json({
      message: `Impersonation session created for ${targetUser.email}`,
      token,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        role: targetUser.role,
        fullName: targetUser.full_name,
        companyName: targetUser.company_name,
        resellerId: targetUser.reseller_id
      },
      impersonator: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role
      }
    });
  } catch (err) {
    console.error('Impersonate user error:', err);
    return res.status(500).json({ error: 'Failed to initiate impersonation session' });
  }
});

// PATCH /api/users/:id/rates - Update per-user custom rate card
router.patch('/:id/rates', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid user ID' });

  try {
    const userCheck = await query('SELECT id, email, role, reseller_id FROM users WHERE id = $1', [targetId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userCheck.rows[0];
    if (req.user.role === 'reseller' && targetUser.reseller_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: Cannot edit rates for users outside your network' });
    }

    const { rates } = req.body;
    if (!rates || typeof rates !== 'object') {
      return res.status(400).json({ error: 'Invalid rates payload' });
    }

    const client = await getClient();
    const updatedRates = {};

    try {
      await client.query('BEGIN');

      for (const [key, rawRate] of Object.entries(rates)) {
        let destination = '';
        let creditType = '';

        if (key.endsWith('_domestic') || key.endsWith('-domestic')) {
          destination = 'domestic';
          creditType = key.replace(/[-_]domestic$/, '');
        } else if (key.endsWith('_international') || key.endsWith('-international')) {
          destination = 'international';
          creditType = key.replace(/[-_]international$/, '');
        } else {
          continue;
        }

        if (!CREDIT_TYPES.includes(creditType) || !DESTINATIONS.includes(destination)) {
          continue;
        }

        const rateNum = parseFloat(rawRate);
        if (isNaN(rateNum) || rateNum <= 0 || rateNum > 100 || !isFinite(rateNum)) continue;
        const validRate = Math.round(rateNum * 10000) / 10000;

        await client.query(`
          INSERT INTO user_credits (user_id, credit_type, destination, balance, rate_inr)
          VALUES ($1, $2, $3, 0, $4)
          ON CONFLICT (user_id, credit_type, destination)
          DO UPDATE SET rate_inr = EXCLUDED.rate_inr
        `, [targetId, creditType, destination, validRate]);

        updatedRates[`${creditType}_${destination}`] = validRate;
      }

      await logAudit(client, {
        actorId: req.user.id,
        entityType: 'user',
        entityId: targetId,
        action: 'user_rates_updated',
        details: { updatedRates }
      });

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return res.json({
      message: `Rate card for ${targetUser.email} updated successfully.`,
      rates: updatedRates
    });
  } catch (err) {
    console.error('Update rates error:', err);
    return res.status(500).json({ error: 'Failed to update rates' });
  }
});

module.exports = router;
