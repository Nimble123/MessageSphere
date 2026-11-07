const express = require('express');
const router = express.Router();
const dns = require('dns').promises;
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query, getClient } = require('../db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { addCustomDomainToRender, removeCustomDomainFromRender, checkRenderDomainStatus } = require('../services/renderDomains');

const logosDir = path.join(__dirname, '../uploads/logos');
if (!fs.existsSync(logosDir)) {
  try {
    fs.mkdirSync(logosDir, { recursive: true });
  } catch (dirErr) {
    console.error('Failed to create logos directory:', dirErr.message);
  }
}

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, logosDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext) ? ext : '.png';
    const resellerId = req.params.id || req.user.id || 'reseller';
    const unique = `logo-reseller-${resellerId}-${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`;
    cb(null, unique);
  }
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
    if (allowedExts.includes(ext) || allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPG, JPEG, WebP, SVG, and GIF image files are allowed.'));
    }
  }
});

const colorPattern = /^#[0-9A-Fa-f]{6}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanProfile(body, fallbackName) {
  const brandName = String(body.brand_name || fallbackName || '').trim();
  const accentColor = String(body.accent_color || '#4f46e5').trim();
  const logoUrl = String(body.logo_url || '').trim();
  const supportEmail = String(body.support_email || '').trim();
  const supportPhone = String(body.support_phone || '').trim();
  let customDomain = String(body.custom_domain || '').trim().toLowerCase();
  customDomain = customDomain.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').replace(/\/.*$/, '').trim();

  if (!brandName || brandName.length > 120) throw new Error('Brand name is required and must be under 120 characters');
  if (!colorPattern.test(accentColor)) throw new Error('Accent color must be a hex color such as #4f46e5');
  if (logoUrl && !/^(https?:\/\/|\/api\/resellers\/logo\/|\/api\/campaigns\/files\/|data:image\/)/i.test(logoUrl)) {
    throw new Error('Logo URL must be an HTTPS URL, an uploaded logo (/api/resellers/logo/...), or an image data URI');
  }
  if (supportEmail && !emailPattern.test(supportEmail)) throw new Error('Support email is invalid');
  if (customDomain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(customDomain)) throw new Error('Custom domain is invalid');
  return { brandName, accentColor, logoUrl: logoUrl || null, supportEmail: supportEmail || null, supportPhone: supportPhone.slice(0, 30) || null, customDomain: customDomain || null };
}

async function resolveResellerId(user) {
  return user.role === 'reseller' ? user.id : user.reseller_id;
}

// GET /api/resellers/logo/:filename - Publicly serve brand logo with cache headers
router.get('/logo/:filename', (req, res) => {
  try {
    const safeFilename = path.basename(req.params.filename);
    if (!/^[a-zA-Z0-9._-]+$/i.test(safeFilename)) {
      return res.status(400).json({ error: 'Invalid logo filename' });
    }

    const filePath = path.join(logosDir, safeFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Logo not found' });
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.gif': 'image/gif'
    };

    res.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.sendFile(filePath);
  } catch (err) {
    console.error('Serve logo error:', err);
    return res.status(500).json({ error: 'Failed to serve logo' });
  }
});

// POST /api/resellers/logo - Reseller uploads their brand logo
router.post('/logo', authenticate, requireRoles('reseller'), (req, res) => {
  uploadLogo.single('logo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload logo' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No logo image file was provided' });
    }

    const logoUrl = `/api/resellers/logo/${req.file.filename}`;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        INSERT INTO reseller_profiles (reseller_id, logo_url, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (reseller_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = NOW()
        RETURNING *
      `, [req.user.id, logoUrl]);

      await logAudit(client, {
        actorId: req.user.id,
        entityType: 'reseller_profile',
        entityId: req.user.id,
        action: 'white_label_logo_uploaded',
        details: { filename: req.file.filename, logoUrl }
      });
      await client.query('COMMIT');

      return res.json({
        message: 'Logo uploaded and updated successfully!',
        logo_url: logoUrl,
        profile: result.rows[0]
      });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error('Update logo db error:', dbErr);
      return res.status(500).json({ error: 'Failed to update brand logo' });
    } finally {
      client.release();
    }
  });
});

// POST /api/resellers/:id/logo - Super Admin uploads brand logo for a reseller
router.post('/:id/logo', authenticate, requireRoles('admin'), (req, res) => {
  const resellerId = parseInt(req.params.id, 10);
  if (isNaN(resellerId)) {
    return res.status(400).json({ error: 'Invalid reseller ID' });
  }

  uploadLogo.single('logo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload logo' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No logo image file was provided' });
    }

    const logoUrl = `/api/resellers/logo/${req.file.filename}`;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        INSERT INTO reseller_profiles (reseller_id, logo_url, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (reseller_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = NOW()
        RETURNING *
      `, [resellerId, logoUrl]);

      await logAudit(client, {
        actorId: req.user.id,
        entityType: 'reseller_profile',
        entityId: resellerId,
        action: 'white_label_logo_uploaded_by_admin',
        details: { filename: req.file.filename, logoUrl }
      });
      await client.query('COMMIT');

      return res.json({
        message: 'Reseller logo uploaded and updated successfully!',
        logo_url: logoUrl,
        profile: result.rows[0]
      });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      console.error('Admin update logo db error:', dbErr);
      return res.status(500).json({ error: 'Failed to update reseller brand logo' });
    } finally {
      client.release();
    }
  });
});

// DELETE /api/resellers/logo - Reseller removes their logo
router.delete('/logo', authenticate, requireRoles('reseller'), async (req, res) => {
  try {
    const result = await query(
      `UPDATE reseller_profiles SET logo_url = NULL, updated_at = NOW() WHERE reseller_id = $1 RETURNING *`,
      [req.user.id]
    );
    return res.json({ message: 'Logo removed successfully', profile: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove logo' });
  }
});

// DELETE /api/resellers/:id/logo - Admin removes reseller logo
router.delete('/:id/logo', authenticate, requireRoles('admin'), async (req, res) => {
  const resellerId = parseInt(req.params.id, 10);
  try {
    const result = await query(
      `UPDATE reseller_profiles SET logo_url = NULL, updated_at = NOW() WHERE reseller_id = $1 RETURNING *`,
      [resellerId]
    );
    return res.json({ message: 'Reseller logo removed successfully', profile: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove logo' });
  }
});

// GET /api/resellers/branding/resolve - Public branding lookup by incoming Host header or ?host= or ?domain= or ?reseller_id=
router.get('/branding/resolve', async (req, res) => {
  try {
    // Support direct testing/preview via query parameters e.g. ?reseller_id=... or ?domain=...
    if (req.query.reseller_id) {
      const resId = parseInt(req.query.reseller_id, 10);
      if (!isNaN(resId)) {
        const testRes = await query(`
          SELECT rp.brand_name, rp.logo_url, rp.accent_color, rp.support_email, rp.support_phone, rp.custom_domain, rp.domain_status, rp.invite_code, rp.allow_self_registration
          FROM reseller_profiles rp
          JOIN users u ON u.id = rp.reseller_id
          WHERE rp.reseller_id = $1 AND u.is_blocked = FALSE
        `, [resId]);
        if (testRes.rows.length > 0) {
          return res.json({ custom_branding: true, branding: testRes.rows[0] });
        }
      }
    }

    const hostQuery = req.query.domain || req.query.host;
    let rawHost = String(hostQuery || req.hostname || req.get('host') || '').toLowerCase().split(':')[0];
    if (rawHost.startsWith('www.')) rawHost = rawHost.slice(4);

    if (!rawHost || rawHost === 'localhost' || rawHost === '127.0.0.1') {
      return res.json({ custom_branding: false });
    }

    const result = await query(`
      SELECT rp.brand_name, rp.logo_url, rp.accent_color, rp.support_email, rp.support_phone, rp.custom_domain, rp.domain_status, rp.invite_code, rp.allow_self_registration
      FROM reseller_profiles rp
      JOIN users u ON u.id = rp.reseller_id
      WHERE (LOWER(rp.custom_domain) = LOWER($1) OR LOWER(rp.custom_domain) = LOWER($2))
        AND u.is_blocked = FALSE
    `, [rawHost, `www.${rawHost}`]);

    if (result.rows.length === 0) {
      return res.json({ custom_branding: false });
    }

    return res.json({
      custom_branding: true,
      branding: result.rows[0]
    });
  } catch (err) {
    console.error('Branding resolve error:', err);
    return res.status(500).json({ error: 'Failed to resolve branding' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  const resellerId = await resolveResellerId(req.user);
  if (!resellerId) return res.json(null);
  const result = await query(`
    SELECT rp.*, u.email AS reseller_email, u.company_name, u.full_name
    FROM users u
    LEFT JOIN reseller_profiles rp ON rp.reseller_id = u.id
    WHERE u.id = $1
  `, [resellerId]);
  if (!result.rows.length) return res.json(null);
  const row = result.rows[0];
  if (!row.brand_name) {
    row.brand_name = row.company_name || row.full_name || 'Partner Portal';
  }
  if (!row.accent_color) {
    row.accent_color = '#4f46e5';
  }
  if (req.user.role === 'user') {
    delete row.reseller_email;
  }
  return res.json(row);
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
      const domWaCredits = (cr['normal_domestic'] || 0) + (cr['dp_domestic'] || 0) + (cr['cta_domestic'] || 0) + (cr['dp_cta_domestic'] || 0) + (cr['own_number_domestic'] || 0) + (cr['whatsapp_domestic'] || 0);
      const intlWaCredits = (cr['normal_international'] || 0) + (cr['dp_international'] || 0) + (cr['cta_international'] || 0) + (cr['dp_cta_international'] || 0) + (cr['own_number_international'] || 0) + (cr['whatsapp_international'] || 0);
      const domSmsCredits = cr['gsm_sms_domestic'] ?? cr['sms_domestic'] ?? 0;
      const intlSmsCredits = cr['gsm_sms_international'] ?? cr['sms_international'] ?? 0;
      const domCredits = domSmsCredits + domWaCredits;
      const intlCredits = intlSmsCredits + intlWaCredits;

      return {
        ...r,
        dom_credits: domCredits,
        intl_credits: intlCredits,
        dom_sms_credits: domSmsCredits,
        dom_wa_credits: domWaCredits,
        intl_sms_credits: intlSmsCredits,
        intl_wa_credits: intlWaCredits,
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

  // Check custom domain uniqueness
  if (profile.customDomain) {
    const domainCheck = await query(
      'SELECT reseller_id FROM reseller_profiles WHERE LOWER(custom_domain) = LOWER($1) AND reseller_id != $2',
      [profile.customDomain, resellerId]
    );
    if (domainCheck.rows.length > 0) {
      return res.status(400).json({ error: `Custom domain "${profile.customDomain}" is already claimed by another reseller.` });
    }
  }

  // If Admin explicitly provided domain_status (e.g., 'Verified', 'Pending verification', 'Not configured')
  const isAdmin = req.user && req.user.role === 'admin';
  const explicitStatus = isAdmin && ['Not configured', 'Pending verification', 'Verified'].includes(req.body.domain_status)
    ? req.body.domain_status
    : null;

  const initialStatus = explicitStatus || (profile.customDomain ? 'Pending verification' : 'Not configured');

  const prevProfile = await query('SELECT custom_domain FROM reseller_profiles WHERE reseller_id = $1', [resellerId]);
  const oldDomain = prevProfile.rows[0]?.custom_domain;

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO reseller_profiles (reseller_id, brand_name, logo_url, accent_color, support_email, support_phone, custom_domain, domain_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7::varchar, $8)
      ON CONFLICT (reseller_id) DO UPDATE SET
        brand_name = EXCLUDED.brand_name,
        logo_url = EXCLUDED.logo_url,
        accent_color = EXCLUDED.accent_color,
        support_email = EXCLUDED.support_email,
        support_phone = EXCLUDED.support_phone,
        custom_domain = EXCLUDED.custom_domain,
        domain_status = CASE 
          WHEN $9::varchar IS NOT NULL THEN $9::varchar
          WHEN reseller_profiles.custom_domain IS DISTINCT FROM EXCLUDED.custom_domain THEN 
            CASE WHEN EXCLUDED.custom_domain IS NULL THEN 'Not configured' ELSE 'Pending verification' END 
          ELSE reseller_profiles.domain_status 
        END,
        updated_at = NOW()
      RETURNING *
    `, [resellerId, profile.brandName, profile.logoUrl, profile.accentColor, profile.supportEmail, profile.supportPhone, profile.customDomain, initialStatus, explicitStatus]);

    await logAudit(client, {
      actorId,
      entityType: 'reseller_profile',
      entityId: resellerId,
      action: 'white_label_profile_updated',
      details: { brandName: profile.brandName, customDomain: profile.customDomain, domainStatus: result.rows[0]?.domain_status }
    });

    await client.query('COMMIT');

    // Automated Cloud Domain & SSL Provisioning (Asynchronous background task)
    if (oldDomain && oldDomain.toLowerCase() !== (profile.customDomain || '').toLowerCase()) {
      removeCustomDomainFromRender(oldDomain).catch(() => {});
    }
    if (profile.customDomain) {
      addCustomDomainToRender(profile.customDomain).then(renderRes => {
        if (renderRes.success) {
          console.log(`[WHITE-LABEL] Automated Render domain registered for: ${profile.customDomain}`);
        } else if (!renderRes.configured) {
          console.log('[WHITE-LABEL] RENDER_API_KEY not configured; manual Render domain binding required.');
        }
      }).catch(e => console.error('[WHITE-LABEL] Automated domain provisioning error:', e.message));
    }

    return res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to save reseller brand profile:', err);
    return res.status(500).json({ error: 'Failed to save reseller brand profile: ' + (err.message || 'Database error') });
  } finally {
    client.release();
  }
}

// GET /api/resellers/invite-settings - Reseller views their invite code, toggle & rate settings
router.get('/invite-settings', authenticate, requireRoles('reseller', 'admin'), async (req, res) => {
  try {
    let targetResellerId = req.user.role === 'reseller' ? req.user.id : parseInt(req.query.reseller_id || req.user.id, 10);
    if (!targetResellerId || isNaN(targetResellerId)) {
      return res.status(400).json({ error: 'Valid reseller ID is required' });
    }

    const result = await query(`
      SELECT rp.reseller_id, rp.brand_name, rp.invite_code, rp.allow_self_registration, rp.default_rates,
             rp.custom_domain, rp.domain_status, u.company_name, u.email
      FROM reseller_profiles rp
      JOIN users u ON u.id = rp.reseller_id
      WHERE rp.reseller_id = $1
    `, [targetResellerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reseller profile not found' });
    }

    const row = result.rows[0];
    let inviteCode = row.invite_code;

    // Auto-generate if missing
    if (!inviteCode) {
      inviteCode = (row.brand_name || row.company_name || 'reseller').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || `reseller${row.reseller_id}`;
      await query(`UPDATE reseller_profiles SET invite_code = $1 WHERE reseller_id = $2`, [inviteCode, targetResellerId]);
    }

    const hostHeader = req.get('host') || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const platformUrl = `${protocol}://${hostHeader}/signup?ref=${encodeURIComponent(inviteCode)}`;
    const customDomainUrl = row.custom_domain ? `https://${row.custom_domain}/signup?ref=${encodeURIComponent(inviteCode)}` : null;

    const primaryShareableUrl = (row.custom_domain && row.domain_status === 'Verified') ? customDomainUrl : platformUrl;

    const DEFAULT_RATES = {
      normal_domestic: 0.1500,
      dp_domestic: 0.2800,
      cta_domestic: 0.2400,
      dp_cta_domestic: 0.3500,
      gsm_sms_domestic: 0.1200,
      own_number_domestic: 0.0800,
      normal_international: 2.0000,
      dp_international: 2.5000,
      cta_international: 2.5000,
      dp_cta_international: 3.0000,
      gsm_sms_international: 1.5000,
      own_number_international: 1.2000
    };

    return res.json({
      reseller_id: row.reseller_id,
      brand_name: row.brand_name,
      invite_code: inviteCode,
      allow_self_registration: row.allow_self_registration !== false,
      default_rates: { ...DEFAULT_RATES, ...(row.default_rates || {}) },
      platform_url: platformUrl,
      custom_domain_url: customDomainUrl,
      shareable_url: primaryShareableUrl
    });
  } catch (err) {
    console.error('Get invite settings error:', err);
    return res.status(500).json({ error: 'Failed to retrieve invite settings' });
  }
});

// PUT /api/resellers/invite-settings - Reseller or Admin updates invite code, toggle & default margins
router.put('/invite-settings', authenticate, requireRoles('reseller', 'admin'), async (req, res) => {
  let targetResellerId = req.user.role === 'reseller' ? req.user.id : parseInt(req.body.reseller_id || req.user.id, 10);
  if (!targetResellerId || isNaN(targetResellerId)) {
    return res.status(400).json({ error: 'Valid reseller ID is required' });
  }

  const { invite_code, allow_self_registration, default_rates } = req.body;

  let cleanInviteCode = undefined;
  if (invite_code !== undefined) {
    cleanInviteCode = String(invite_code).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (cleanInviteCode.length < 3 || cleanInviteCode.length > 50) {
      return res.status(400).json({ error: 'Invite code must be 3-50 alphanumeric characters (hyphens and underscores allowed).' });
    }

    const clash = await query(`
      SELECT 1 FROM reseller_profiles 
      WHERE LOWER(invite_code) = LOWER($1) AND reseller_id != $2
    `, [cleanInviteCode, targetResellerId]);
    if (clash.rows.length > 0) {
      return res.status(400).json({ error: `Invite slug '${cleanInviteCode}' is already taken by another partner. Please choose another.` });
    }
  }

  let cleanAllowSelfReg = undefined;
  if (allow_self_registration !== undefined) {
    cleanAllowSelfReg = allow_self_registration === true || allow_self_registration === 'true' || allow_self_registration === 1;
  }

  let cleanRates = undefined;
  if (default_rates && typeof default_rates === 'object') {
    cleanRates = {};
    const validKeys = [
      'normal_domestic', 'dp_domestic', 'cta_domestic', 'dp_cta_domestic', 'gsm_sms_domestic', 'own_number_domestic',
      'normal_international', 'dp_international', 'cta_international', 'dp_cta_international', 'gsm_sms_international', 'own_number_international'
    ];
    for (const key of validKeys) {
      if (default_rates[key] !== undefined && default_rates[key] !== null) {
        const parsed = parseFloat(default_rates[key]);
        if (isNaN(parsed) || parsed < 0.0001 || parsed > 100) {
          return res.status(400).json({ error: `Invalid rate for ${key}. Must be a positive number between ₹0.0001 and ₹100.` });
        }
        cleanRates[key] = parseFloat(parsed.toFixed(4));
      }
    }
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(`
      UPDATE reseller_profiles
      SET invite_code = COALESCE($1, invite_code),
          allow_self_registration = COALESCE($2, allow_self_registration),
          default_rates = CASE WHEN $3::jsonb IS NOT NULL THEN (COALESCE(default_rates, '{}'::jsonb) || $3::jsonb) ELSE default_rates END,
          updated_at = NOW()
      WHERE reseller_id = $4
      RETURNING *
    `, [cleanInviteCode, cleanAllowSelfReg, cleanRates ? JSON.stringify(cleanRates) : null, targetResellerId]);

    if (updateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reseller profile not found' });
    }

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'reseller_profile',
      entityId: targetResellerId,
      action: 'reseller_invite_settings_updated',
      details: {
        inviteCode: cleanInviteCode,
        allowSelfRegistration: cleanAllowSelfReg,
        defaultRates: cleanRates
      }
    });

    await client.query('COMMIT');

    const updated = updateRes.rows[0];
    const hostHeader = req.get('host') || 'localhost:3000';
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const platformUrl = `${protocol}://${hostHeader}/signup?ref=${encodeURIComponent(updated.invite_code)}`;
    const customDomainUrl = updated.custom_domain ? `https://${updated.custom_domain}/signup?ref=${encodeURIComponent(updated.invite_code)}` : null;
    const primaryShareableUrl = (updated.custom_domain && updated.domain_status === 'Verified') ? customDomainUrl : platformUrl;

    return res.json({
      message: 'Invite & self-registration settings saved successfully!',
      reseller_id: updated.reseller_id,
      invite_code: updated.invite_code,
      allow_self_registration: updated.allow_self_registration,
      default_rates: updated.default_rates,
      platform_url: platformUrl,
      custom_domain_url: customDomainUrl,
      shareable_url: primaryShareableUrl
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update invite settings error:', err);
    return res.status(500).json({ error: 'Failed to update invite settings: ' + (err.message || 'Database error') });
  } finally {
    client.release();
  }
});

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

// POST /api/resellers/:id/verify-dns - Super Admin checks DNS resolution for reseller custom domain
router.post('/:id/verify-dns', authenticate, requireRoles('admin'), async (req, res) => {
  const resellerId = parseInt(req.params.id, 10);
  try {
    const profileRes = await query('SELECT custom_domain, domain_status FROM reseller_profiles WHERE reseller_id = $1', [resellerId]);
    if (!profileRes.rows.length || !profileRes.rows[0].custom_domain) {
      return res.status(400).json({ error: 'No custom domain configured for this reseller.' });
    }
    const domain = profileRes.rows[0].custom_domain;
    let dnsRecords = [];
    try {
      dnsRecords = await dns.resolve(domain);
    } catch (dnsErr) {
      try {
        dnsRecords = await dns.resolveCname(domain);
      } catch (cnameErr) {
        return res.status(400).json({
          verified: false,
          domain,
          error: `DNS resolution failed: ${dnsErr.code || dnsErr.message}. Ensure the domain has an active A record or CNAME pointing to this host.`
        });
      }
    }
    // Also check and provision with Render cloud if configured
    let renderInfo = null;
    try {
      const renderProv = await addCustomDomainToRender(domain);
      const renderStatus = await checkRenderDomainStatus(domain);
      renderInfo = {
        registered: renderProv.success,
        ssl_status: renderStatus?.verificationStatus || 'provisioning'
      };
    } catch (_) {}

    return res.json({
      verified: true,
      domain,
      resolved_to: dnsRecords,
      render: renderInfo,
      message: `DNS records successfully resolved for ${domain}: ${dnsRecords.join(', ')}`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to run DNS check' });
  }
});

module.exports = router;
