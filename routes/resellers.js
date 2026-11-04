const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const colorPattern = /^#[0-9A-Fa-f]{6}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanProfile(body, fallbackName) {
  const brandName = String(body.brand_name || fallbackName || '').trim();
  const accentColor = String(body.accent_color || '#4f46e5').trim();
  const logoUrl = String(body.logo_url || '').trim();
  const supportEmail = String(body.support_email || '').trim();
  const supportPhone = String(body.support_phone || '').trim();
  const customDomain = String(body.custom_domain || '').trim().toLowerCase();
  if (!brandName || brandName.length > 120) throw new Error('Brand name is required and must be under 120 characters');
  if (!colorPattern.test(accentColor)) throw new Error('Accent color must be a hex color such as #4f46e5');
  if (logoUrl && !/^https:\/\//i.test(logoUrl)) throw new Error('Logo URL must use HTTPS');
  if (supportEmail && !emailPattern.test(supportEmail)) throw new Error('Support email is invalid');
  if (customDomain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(customDomain)) throw new Error('Custom domain is invalid');
  return { brandName, accentColor, logoUrl: logoUrl || null, supportEmail: supportEmail || null, supportPhone: supportPhone.slice(0, 30) || null, customDomain: customDomain || null };
}

async function resolveResellerId(user) {
  return user.role === 'reseller' ? user.id : user.reseller_id;
}

router.get('/me', authenticate, async (req, res) => {
  const resellerId = await resolveResellerId(req.user);
  if (!resellerId) return res.json(null);
  const result = await query('SELECT rp.*, u.email AS reseller_email FROM reseller_profiles rp JOIN users u ON u.id = rp.reseller_id WHERE rp.reseller_id = $1', [resellerId]);
  return res.json(result.rows[0] || null);
});

router.get('/', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.email, u.full_name, u.phone, u.company_name, u.is_blocked, u.created_at, u.gstin,
        rp.brand_name, rp.accent_color, rp.support_email, rp.support_phone, rp.logo_url, rp.custom_domain, rp.domain_status,
        COUNT(DISTINCT client.id)::int AS client_count,
        COUNT(DISTINCT c.id)::int AS campaign_count,
        COALESCE(SUM(c.total_numbers), 0)::bigint AS total_recipients
      FROM users u
      LEFT JOIN reseller_profiles rp ON rp.reseller_id = u.id
      LEFT JOIN users client ON client.reseller_id = u.id
      LEFT JOIN campaigns c ON c.user_id = client.id
      WHERE u.role = 'reseller'
      GROUP BY u.id, rp.reseller_id
      ORDER BY u.created_at DESC
    `);

    const resellerIds = result.rows.map(r => r.id);
    let creditsMap = {};
    if (resellerIds.length > 0) {
      const crRes = await query(
        `SELECT user_id, credit_type, destination, balance FROM user_credits WHERE user_id = ANY($1::int[])`,
        [resellerIds]
      );
      crRes.rows.forEach(r => {
        if (!creditsMap[r.user_id]) creditsMap[r.user_id] = {};
        creditsMap[r.user_id][`${r.credit_type}_${r.destination}`] = parseInt(r.balance, 10);
      });
    }

    const rows = result.rows.map(r => {
      const cr = creditsMap[r.id] || {};
      const domCredits = (cr['gsm_sms_domestic'] ?? cr['sms_domestic'] ?? 0) + (cr['whatsapp_domestic'] ?? 0);
      const intlCredits = (cr['gsm_sms_international'] ?? cr['sms_international'] ?? 0) + (cr['whatsapp_international'] ?? 0);
      return {
        ...r,
        dom_credits: domCredits,
        intl_credits: intlCredits,
        dom_sms_credits: cr['gsm_sms_domestic'] ?? cr['sms_domestic'] ?? 0,
        dom_wa_credits: cr['whatsapp_domestic'] ?? 0,
        intl_sms_credits: cr['gsm_sms_international'] ?? cr['sms_international'] ?? 0,
        intl_wa_credits: cr['whatsapp_international'] ?? 0,
      };
    });

    return res.json(rows);
  } catch (err) {
    console.error('Failed to load reseller network:', err);
    return res.status(500).json({ error: 'Failed to load reseller management data' });
  }
});

async function saveProfile(req, res, resellerId, actorId) {
  const owner = await query('SELECT id, email, role FROM users WHERE id = $1 AND role = $2', [resellerId, 'reseller']);
  if (!owner.rows.length) return res.status(404).json({ error: 'Reseller not found' });
  let profile;
  try { profile = cleanProfile(req.body, owner.rows[0].email.split('@')[0]); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO reseller_profiles (reseller_id, brand_name, logo_url, accent_color, support_email, support_phone, custom_domain, domain_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 IS NULL THEN 'Not configured' ELSE 'Pending verification' END)
      ON CONFLICT (reseller_id) DO UPDATE SET
        brand_name = EXCLUDED.brand_name, logo_url = EXCLUDED.logo_url, accent_color = EXCLUDED.accent_color,
        support_email = EXCLUDED.support_email, support_phone = EXCLUDED.support_phone,
        custom_domain = EXCLUDED.custom_domain,
        domain_status = CASE WHEN reseller_profiles.custom_domain IS DISTINCT FROM EXCLUDED.custom_domain THEN CASE WHEN EXCLUDED.custom_domain IS NULL THEN 'Not configured' ELSE 'Pending verification' END ELSE reseller_profiles.domain_status END,
        updated_at = NOW()
      RETURNING *
    `, [resellerId, profile.brandName, profile.logoUrl, profile.accentColor, profile.supportEmail, profile.supportPhone, profile.customDomain]);
    await logAudit(client, { actorId, entityType: 'reseller_profile', entityId: resellerId, action: 'white_label_profile_updated', details: { brandName: profile.brandName, customDomain: profile.customDomain } });
    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); return res.status(500).json({ error: 'Failed to save reseller brand profile' }); }
  finally { client.release(); }
}

router.put('/me', authenticate, requireRoles('reseller'), async (req, res) => saveProfile(req, res, req.user.id, req.user.id));
router.put('/:id', authenticate, requireRoles('admin'), async (req, res) => saveProfile(req, res, parseInt(req.params.id, 10), req.user.id));

router.patch('/:id/domain-status', authenticate, requireRoles('admin'), async (req, res) => {
  const status = String(req.body.status || '');
  const reason = String(req.body.reason || '').trim();
  if (!['Not configured', 'Pending verification', 'Verified'].includes(status)) return res.status(400).json({ error: 'Invalid domain status' });
  if (!reason) return res.status(400).json({ error: 'A verification reason is required' });
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query('UPDATE reseller_profiles SET domain_status = $1, updated_at = NOW() WHERE reseller_id = $2 RETURNING *', [status, req.params.id]);
    if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Reseller profile not found' }); }
    await logAudit(client, { actorId: req.user.id, entityType: 'reseller_profile', entityId: Number(req.params.id), action: 'custom_domain_status_changed', details: { status, reason: reason.slice(0, 1000) } });
    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); return res.status(500).json({ error: 'Failed to update domain status' }); }
  finally { client.release(); }
});

module.exports = router;
