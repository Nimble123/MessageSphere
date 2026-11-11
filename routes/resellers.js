const express = require('express');
const router = express.Router();
const dns = require('dns').promises;
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query, getClient } = require('../db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const {
  getRenderConfig,
  testRenderConnection,
  addCustomDomainToRender,
  removeCustomDomainFromRender,
  checkRenderDomainStatus,
  triggerRenderDomainVerification
} = require('../services/renderDomains');
const { LOGOS_DIR, FAVICONS_DIR } = require('../services/storage');

const logosDir = LOGOS_DIR;
const faviconsDir = FAVICONS_DIR;

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

const faviconStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, faviconsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.ico', '.png', '.svg', '.webp', '.jpg', '.jpeg'].includes(ext) ? ext : '.ico';
    const resellerId = req.params.id || req.user.id || 'reseller';
    const unique = `favicon-reseller-${resellerId}-${Date.now()}-${Math.round(Math.random() * 1e6)}${safeExt}`;
    cb(null, unique);
  }
});

const uploadFavicon = multer({
  storage: faviconStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB max for favicon
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.ico', '.png', '.svg', '.webp', '.jpg', '.jpeg'];
    const allowedMimes = ['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/svg+xml', 'image/webp', 'image/jpeg'];
    if (allowedExts.includes(ext) || allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only ICO, PNG, SVG, and WebP files are allowed for favicon.'));
    }
  }
});

const colorPattern = /^#[0-9A-Fa-f]{6}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PLATFORM_CNAME_TARGET = process.env.APP_CNAME_TARGET || 'messagesphere.onrender.com';

const RESERVED_DOMAINS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'messagesphere.com',
  'messagesphere.nmedialabs.in',
  'onrender.com',
  'render.com',
  'railway.app',
  'herokuapp.com',
  'vercel.app',
  'netlify.app'
]);

if (process.env.APP_DOMAIN) {
  RESERVED_DOMAINS.add(process.env.APP_DOMAIN.toLowerCase().trim());
}

function normalizeHttpUrl(string) {
  if (!string) return null;
  let str = String(string).trim();
  if (!str) return null;
  if (!/^https?:\/\//i.test(str)) str = `https://${str}`;
  try {
    const url = new URL(str);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
  } catch (_) {
    return null;
  }
}

function isValidHttpUrl(string) {
  if (!string) return true;
  return Boolean(normalizeHttpUrl(string));
}

function cleanProfile(body, fallbackName) {
  const brandName = String(body.brand_name || fallbackName || '').trim();
  const portalTitle = String(body.portal_title || '').trim().slice(0, 150);
  const accentColor = String(body.accent_color || '#4f46e5').trim();
  const logoUrl = String(body.logo_url || '').trim();
  const faviconUrl = String(body.favicon_url || '').trim();
  const supportEmail = String(body.support_email || '').trim();
  const supportPhone = String(body.support_phone || '').trim().slice(0, 30);
  const supportWhatsapp = String(body.support_whatsapp || '').trim().slice(0, 30);
  const companyLegalName = String(body.company_legal_name || '').trim().slice(0, 200);
  const companyGstin = String(body.company_gstin || '').trim().toUpperCase().slice(0, 30);
  const companyAddress = String(body.company_address || '').trim().slice(0, 1000);
  const helpUrl = normalizeHttpUrl(body.help_url);
  const termsUrl = normalizeHttpUrl(body.terms_url);
  const privacyUrl = normalizeHttpUrl(body.privacy_url);
  let customDomain = String(body.custom_domain || '').trim().toLowerCase();
  customDomain = customDomain.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').replace(/\/.*$/, '').trim();

  if (!brandName || brandName.length > 120) throw new Error('Brand name is required and must be under 120 characters');
  if (!colorPattern.test(accentColor)) throw new Error('Accent color must be a hex color such as #4f46e5');
  if (logoUrl && !/^(https?:\/\/|\/api\/resellers\/logo\/|\/api\/campaigns\/files\/|data:image\/)/i.test(logoUrl)) {
    throw new Error('Logo URL must be an HTTPS URL, an uploaded logo (/api/resellers/logo/...), or an image data URI');
  }
  if (faviconUrl && !/^(https?:\/\/|\/api\/resellers\/favicon\/|\/api\/resellers\/logo\/|\/api\/campaigns\/files\/|data:image\/)/i.test(faviconUrl)) {
    throw new Error('Favicon URL must be an HTTPS URL, an uploaded favicon (/api/resellers/favicon/...), or an image data URI');
  }
  if (supportEmail && !emailPattern.test(supportEmail)) throw new Error('Support email is invalid');

  if (customDomain) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(customDomain)) throw new Error('Custom domain is invalid');
    const platformDomain = (process.env.APP_DOMAIN || 'messagesphere.nmedialabs.in').toLowerCase();
    if (RESERVED_DOMAINS.has(customDomain) || customDomain === platformDomain) {
      throw new Error(`The domain "${customDomain}" is a platform reserved domain and cannot be claimed.`);
    }
  }

  return {
    brandName,
    portalTitle: portalTitle || null,
    accentColor,
    logoUrl: logoUrl || null,
    faviconUrl: faviconUrl || null,
    supportEmail: supportEmail || null,
    supportPhone: supportPhone || null,
    supportWhatsapp: supportWhatsapp || null,
    companyLegalName: companyLegalName || null,
    companyGstin: companyGstin || null,
    companyAddress: companyAddress || null,
    helpUrl: helpUrl || null,
    termsUrl: termsUrl || null,
    privacyUrl: privacyUrl || null,
    customDomain: customDomain || null
  };
}

async function resolveResellerId(user) {
  return user.role === 'reseller' ? user.id : user.reseller_id;
}

// GET /api/resellers/logo/:filename - Publicly serve brand logo with cache headers and SVG XSS sandbox
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

    if (ext === '.svg') {
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.set('Content-Disposition', 'inline; filename="logo.svg"');
    }

    return res.sendFile(filePath);
  } catch (err) {
    console.error('Serve logo error:', err);
    return res.status(500).json({ error: 'Failed to serve logo' });
  }
});

// Helper to validate SVG safety
function inspectSvgSafety(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (/<script|javascript:|onload|onerror|onclick|onmouseover|href\s*=\s*['"]javascript:/i.test(content)) {
    throw new Error('Security rejection: SVG file contains embedded scripts or dangerous attributes.');
  }
}

// POST /api/resellers/logo - Reseller uploads their brand logo
router.post('/logo', authenticate, requireRoles('reseller'), (req, res) => {
  uploadLogo.single('logo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload logo' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No logo image file was provided' });
    }

    const ext = path.extname(req.file.filename).toLowerCase();
    if (ext === '.svg') {
      try {
        inspectSvgSafety(req.file.path);
      } catch (secErr) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: secErr.message });
      }
    }

    const logoUrl = `/api/resellers/logo/${req.file.filename}`;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const userRes = await client.query('SELECT company_name, email, full_name FROM users WHERE id = $1', [req.user.id]);
      const defaultBrand = userRes.rows[0]?.company_name || userRes.rows[0]?.full_name || userRes.rows[0]?.email?.split('@')[0] || 'Partner Portal';

      const result = await client.query(`
        INSERT INTO reseller_profiles (reseller_id, brand_name, logo_url, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (reseller_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = NOW()
        RETURNING *
      `, [req.user.id, defaultBrand, logoUrl]);

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
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
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

    const ext = path.extname(req.file.filename).toLowerCase();
    if (ext === '.svg') {
      try {
        inspectSvgSafety(req.file.path);
      } catch (secErr) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: secErr.message });
      }
    }

    const logoUrl = `/api/resellers/logo/${req.file.filename}`;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const userRes = await client.query('SELECT company_name, email, full_name FROM users WHERE id = $1', [resellerId]);
      const defaultBrand = userRes.rows[0]?.company_name || userRes.rows[0]?.full_name || userRes.rows[0]?.email?.split('@')[0] || 'Partner Portal';

      const result = await client.query(`
        INSERT INTO reseller_profiles (reseller_id, brand_name, logo_url, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (reseller_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, updated_at = NOW()
        RETURNING *
      `, [resellerId, defaultBrand, logoUrl]);

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
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
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

// GET /api/resellers/favicon/:filename - Publicly serve brand favicon with cache headers and SVG safety
router.get('/favicon/:filename', (req, res) => {
  try {
    const safeFilename = path.basename(req.params.filename);
    if (!/^[a-zA-Z0-9._-]+$/i.test(safeFilename)) {
      return res.status(400).json({ error: 'Invalid favicon filename' });
    }

    const filePath = path.join(faviconsDir, safeFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Favicon not found' });
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const mimeTypes = {
      '.ico': 'image/x-icon',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };

    res.set('Content-Type', mimeTypes[ext] || 'image/x-icon');
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.set('X-Content-Type-Options', 'nosniff');

    if (ext === '.svg') {
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.set('Content-Disposition', 'inline; filename="favicon.svg"');
    }

    return res.sendFile(filePath);
  } catch (err) {
    console.error('Serve favicon error:', err);
    return res.status(500).json({ error: 'Failed to serve favicon' });
  }
});

// POST /api/resellers/favicon - Reseller uploads their brand favicon
router.post('/favicon', authenticate, requireRoles('reseller'), (req, res) => {
  uploadFavicon.single('favicon')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload favicon' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No favicon image file was provided' });
    }

    const ext = path.extname(req.file.filename).toLowerCase();
    if (ext === '.svg') {
      try {
        inspectSvgSafety(req.file.path);
      } catch (secErr) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: secErr.message });
      }
    }

    const faviconUrl = `/api/resellers/favicon/${req.file.filename}`;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const userRes = await client.query('SELECT company_name, email, full_name FROM users WHERE id = $1', [req.user.id]);
      const defaultBrand = userRes.rows[0]?.company_name || userRes.rows[0]?.full_name || userRes.rows[0]?.email?.split('@')[0] || 'Partner Portal';

      const result = await client.query(`
        INSERT INTO reseller_profiles (reseller_id, brand_name, favicon_url, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (reseller_id) DO UPDATE SET favicon_url = EXCLUDED.favicon_url, updated_at = NOW()
        RETURNING *
      `, [req.user.id, defaultBrand, faviconUrl]);

      await logAudit(client, {
        actorId: req.user.id,
        entityType: 'reseller_profile',
        entityId: req.user.id,
        action: 'white_label_favicon_uploaded',
        details: { filename: req.file.filename, faviconUrl }
      });
      await client.query('COMMIT');

      return res.json({
        message: 'Favicon uploaded and updated successfully!',
        favicon_url: faviconUrl,
        profile: result.rows[0]
      });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
      console.error('Update favicon db error:', dbErr);
      return res.status(500).json({ error: 'Failed to update brand favicon' });
    } finally {
      client.release();
    }
  });
});

// POST /api/resellers/:id/favicon - Super Admin uploads brand favicon for a reseller
router.post('/:id/favicon', authenticate, requireRoles('admin'), (req, res) => {
  const resellerId = parseInt(req.params.id, 10);
  if (isNaN(resellerId)) {
    return res.status(400).json({ error: 'Invalid reseller ID' });
  }

  uploadFavicon.single('favicon')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Failed to upload favicon' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No favicon image file was provided' });
    }

    const ext = path.extname(req.file.filename).toLowerCase();
    if (ext === '.svg') {
      try {
        inspectSvgSafety(req.file.path);
      } catch (secErr) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: secErr.message });
      }
    }

    const faviconUrl = `/api/resellers/favicon/${req.file.filename}`;
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const userRes = await client.query('SELECT company_name, email, full_name FROM users WHERE id = $1', [resellerId]);
      const defaultBrand = userRes.rows[0]?.company_name || userRes.rows[0]?.full_name || userRes.rows[0]?.email?.split('@')[0] || 'Partner Portal';

      const result = await client.query(`
        INSERT INTO reseller_profiles (reseller_id, brand_name, favicon_url, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (reseller_id) DO UPDATE SET favicon_url = EXCLUDED.favicon_url, updated_at = NOW()
        RETURNING *
      `, [resellerId, defaultBrand, faviconUrl]);

      await logAudit(client, {
        actorId: req.user.id,
        entityType: 'reseller_profile',
        entityId: resellerId,
        action: 'white_label_favicon_uploaded_by_admin',
        details: { filename: req.file.filename, faviconUrl }
      });
      await client.query('COMMIT');

      return res.json({
        message: 'Reseller favicon uploaded and updated successfully!',
        favicon_url: faviconUrl,
        profile: result.rows[0]
      });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
      console.error('Admin update favicon db error:', dbErr);
      return res.status(500).json({ error: 'Failed to update reseller brand favicon' });
    } finally {
      client.release();
    }
  });
});

// DELETE /api/resellers/favicon - Reseller removes their favicon
router.delete('/favicon', authenticate, requireRoles('reseller'), async (req, res) => {
  try {
    const result = await query(
      `UPDATE reseller_profiles SET favicon_url = NULL, updated_at = NOW() WHERE reseller_id = $1 RETURNING *`,
      [req.user.id]
    );
    return res.json({ message: 'Favicon removed successfully', profile: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove favicon' });
  }
});

// DELETE /api/resellers/:id/favicon - Admin removes reseller favicon
router.delete('/:id/favicon', authenticate, requireRoles('admin'), async (req, res) => {
  const resellerId = parseInt(req.params.id, 10);
  try {
    const result = await query(
      `UPDATE reseller_profiles SET favicon_url = NULL, updated_at = NOW() WHERE reseller_id = $1 RETURNING *`,
      [resellerId]
    );
    return res.json({ message: 'Reseller favicon removed successfully', profile: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove favicon' });
  }
});

// GET /api/resellers/cname-target - Platform DNS CNAME target for white-label domains
router.get('/cname-target', (req, res) => {
  return res.json({
    cname_target: PLATFORM_CNAME_TARGET,
    platform_domain: process.env.APP_DOMAIN || 'messagesphere.nmedialabs.in',
    instructions: `Add a CNAME record in your DNS manager pointing your custom subdomain (e.g. portal) or domain to ${PLATFORM_CNAME_TARGET}`
  });
});

// GET /api/resellers/branding/resolve - Public branding lookup by incoming Host header or ?host= or ?domain= or ?reseller_id=
router.get('/branding/resolve', async (req, res) => {
  try {
    // Support direct testing/preview via query parameters e.g. ?reseller_id=... or ?domain=...
    if (req.query.reseller_id) {
      const resId = parseInt(req.query.reseller_id, 10);
      if (!isNaN(resId)) {
        const testRes = await query(`
          SELECT rp.brand_name, rp.portal_title, rp.logo_url, rp.favicon_url, rp.accent_color,
                 rp.support_email, rp.support_phone, rp.support_whatsapp,
                 rp.company_legal_name, rp.company_gstin, rp.company_address,
                 rp.help_url, rp.terms_url, rp.privacy_url,
                 rp.custom_domain, rp.domain_status, rp.invite_code, rp.allow_self_registration
          FROM reseller_profiles rp
          JOIN users u ON u.id = rp.reseller_id
          WHERE rp.reseller_id = $1 AND u.is_blocked = FALSE
        `, [resId]);
        if (testRes.rows.length > 0) {
          return res.json({ custom_branding: true, branding: testRes.rows[0] });
        }
      }
    }

    // Support invite / referral slug resolution e.g. /signup?ref=exhumenexus or ?invite=...
    const refCode = req.query.ref || req.query.invite || req.query.code;
    if (refCode) {
      const cleanRef = String(refCode).trim().toLowerCase();
      const refRes = await query(`
        SELECT rp.brand_name, rp.portal_title, rp.logo_url, rp.favicon_url, rp.accent_color,
               rp.support_email, rp.support_phone, rp.support_whatsapp,
               rp.company_legal_name, rp.company_gstin, rp.company_address,
               rp.help_url, rp.terms_url, rp.privacy_url,
               rp.custom_domain, rp.domain_status, rp.invite_code, rp.allow_self_registration
        FROM reseller_profiles rp
        JOIN users u ON u.id = rp.reseller_id
        WHERE LOWER(rp.invite_code) = $1 AND u.is_blocked = FALSE
      `, [cleanRef]);
      if (refRes.rows.length > 0) {
        return res.json({ custom_branding: true, branding: refRes.rows[0] });
      }
    }

    const hostQuery = req.query.domain || req.query.host;
    let rawHost = String(hostQuery || req.hostname || req.get('host') || '').toLowerCase().split(':')[0];
    if (rawHost.startsWith('www.')) rawHost = rawHost.slice(4);

    if (!rawHost || RESERVED_DOMAINS.has(rawHost)) {
      return res.json({ custom_branding: false });
    }

    const result = await query(`
      SELECT rp.reseller_id, rp.brand_name, rp.portal_title, rp.logo_url, rp.favicon_url, rp.accent_color,
             rp.support_email, rp.support_phone, rp.support_whatsapp,
             rp.company_legal_name, rp.company_gstin, rp.company_address,
             rp.help_url, rp.terms_url, rp.privacy_url,
             rp.custom_domain, rp.domain_status, rp.invite_code, rp.allow_self_registration
      FROM reseller_profiles rp
      JOIN users u ON u.id = rp.reseller_id
      WHERE (LOWER(rp.custom_domain) = LOWER($1) OR LOWER(rp.custom_domain) = LOWER($2))
        AND u.is_blocked = FALSE
    `, [rawHost, `www.${rawHost}`]);

    if (result.rows.length === 0) {
      return res.json({ custom_branding: false });
    }

    const row = result.rows[0];
    // Reaching our server with this custom domain confirms DNS routing is functional!
    if (row.domain_status !== 'Verified') {
      await query(`UPDATE reseller_profiles SET domain_status = 'Verified', updated_at = NOW() WHERE reseller_id = $1`, [row.reseller_id]).catch(() => {});
      row.domain_status = 'Verified';
    }

    return res.json({
      custom_branding: true,
      branding: row
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
        rp.brand_name, rp.portal_title, rp.accent_color, rp.logo_url, rp.favicon_url,
        rp.support_email, rp.support_phone, rp.support_whatsapp,
        rp.company_legal_name, rp.company_gstin, rp.company_address,
        rp.help_url, rp.terms_url, rp.privacy_url,
        rp.custom_domain, rp.domain_status, rp.invite_code, rp.allow_self_registration, rp.default_rates,
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
      INSERT INTO reseller_profiles (
        reseller_id, brand_name, portal_title, logo_url, favicon_url, accent_color,
        support_email, support_phone, support_whatsapp,
        company_legal_name, company_gstin, company_address,
        help_url, terms_url, privacy_url,
        custom_domain, domain_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::varchar, $17)
      ON CONFLICT (reseller_id) DO UPDATE SET
        brand_name = EXCLUDED.brand_name,
        portal_title = EXCLUDED.portal_title,
        logo_url = EXCLUDED.logo_url,
        favicon_url = EXCLUDED.favicon_url,
        accent_color = EXCLUDED.accent_color,
        support_email = EXCLUDED.support_email,
        support_phone = EXCLUDED.support_phone,
        support_whatsapp = EXCLUDED.support_whatsapp,
        company_legal_name = EXCLUDED.company_legal_name,
        company_gstin = EXCLUDED.company_gstin,
        company_address = EXCLUDED.company_address,
        help_url = EXCLUDED.help_url,
        terms_url = EXCLUDED.terms_url,
        privacy_url = EXCLUDED.privacy_url,
        custom_domain = EXCLUDED.custom_domain,
        domain_status = CASE 
          WHEN $18::varchar IS NOT NULL THEN $18::varchar
          WHEN reseller_profiles.custom_domain IS DISTINCT FROM EXCLUDED.custom_domain THEN 
            CASE WHEN EXCLUDED.custom_domain IS NULL THEN 'Not configured' ELSE 'Pending verification' END 
          ELSE reseller_profiles.domain_status 
        END,
        updated_at = NOW()
      RETURNING *
    `, [
      resellerId,
      profile.brandName,
      profile.portalTitle,
      profile.logoUrl,
      profile.faviconUrl,
      profile.accentColor,
      profile.supportEmail,
      profile.supportPhone,
      profile.supportWhatsapp,
      profile.companyLegalName,
      profile.companyGstin,
      profile.companyAddress,
      profile.helpUrl,
      profile.termsUrl,
      profile.privacyUrl,
      profile.customDomain,
      initialStatus,
      explicitStatus
    ]);

    await logAudit(client, {
      actorId,
      entityType: 'reseller_profile',
      entityId: resellerId,
      action: 'white_label_profile_updated',
      details: {
        brandName: profile.brandName,
        portalTitle: profile.portalTitle,
        customDomain: profile.customDomain,
        domainStatus: result.rows[0]?.domain_status
      }
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

// ---------------------------------------------------------------------------
// RESELLER PROFIT & MARGINS COMMERCIAL ANALYTICS ENGINE
// ---------------------------------------------------------------------------
const WHOLESALE_BENCHMARK_RATES = {
  gsm_sms_domestic: 0.0900,
  gsm_sms_international: 0.9000,
  normal_domestic: 0.1000,
  dp_domestic: 0.1400,
  cta_domestic: 0.1600,
  dp_cta_domestic: 0.2200,
  own_number_domestic: 0.0500,
  normal_international: 1.2000,
  dp_international: 1.5000,
  cta_international: 1.5000,
  dp_cta_international: 1.8000,
  own_number_international: 0.8000
};

const CHANNEL_DEFINITIONS = {
  gsm_sms_domestic: { label: 'GSM Bulk SMS (Domestic)', category: 'GSM SMS' },
  gsm_sms_international: { label: 'GSM Bulk SMS (Intl)', category: 'GSM SMS' },
  normal_domestic: { label: 'WhatsApp Standard (Domestic)', category: 'WhatsApp' },
  dp_domestic: { label: 'WhatsApp DP (Domestic)', category: 'WhatsApp' },
  cta_domestic: { label: 'WhatsApp CTA Button (Domestic)', category: 'WhatsApp' },
  dp_cta_domestic: { label: 'WhatsApp DP + CTA (Domestic)', category: 'WhatsApp' },
  own_number_domestic: { label: 'WhatsApp Own Number (Domestic)', category: 'WhatsApp' },
  normal_international: { label: 'WhatsApp Standard (Intl)', category: 'WhatsApp' },
  dp_international: { label: 'WhatsApp DP (Intl)', category: 'WhatsApp' },
  cta_international: { label: 'WhatsApp CTA (Intl)', category: 'WhatsApp' },
  dp_cta_international: { label: 'WhatsApp DP + CTA (Intl)', category: 'WhatsApp' },
  own_number_international: { label: 'WhatsApp Own Number (Intl)', category: 'WhatsApp' }
};

function calculateResellerMargins(wholesaleRates = {}, allotments = []) {
  let totalCreditsSold = 0;
  let grossRevenue = 0;
  let wholesaleCogs = 0;
  let cashCollected = 0;

  const channelMap = {};
  for (const [k, def] of Object.entries(CHANNEL_DEFINITIONS)) {
    const wRate = (wholesaleRates[k] !== undefined && wholesaleRates[k] !== null && Number(wholesaleRates[k]) > 0)
      ? parseFloat(wholesaleRates[k])
      : (WHOLESALE_BENCHMARK_RATES[k] || 0.1000);
    channelMap[k] = {
      key: k,
      label: def.label,
      category: def.category,
      wholesale_rate: wRate,
      credits_sold: 0,
      revenue: 0,
      cogs: 0,
      net_profit: 0,
      margin_pct: 0,
      selling_rate: 0
    };
  }

  const clientMap = {};
  const processedInvoices = [];

  for (const alt of allotments) {
    const clientId = alt.user_id;
    const clientName = alt.client_name || alt.full_name || alt.company_name || alt.email || `Client #${clientId}`;
    const clientEmail = alt.client_email || alt.email || '';
    const clientCompany = alt.client_company || alt.company_name || '';

    if (!clientMap[clientId]) {
      clientMap[clientId] = {
        client_id: clientId,
        name: clientName,
        email: clientEmail,
        company: clientCompany,
        credits_bought: 0,
        revenue: 0,
        cogs: 0,
        net_profit: 0,
        margin_pct: 0,
        paid_amount: 0,
        balance_due: 0,
        last_allotment_at: alt.created_at
      };
    }

    const paidAmt = parseFloat(alt.paid_amount || 0) || 0;
    cashCollected += paidAmt;
    clientMap[clientId].paid_amount += paidAmt;

    let invoiceCredits = 0;
    let invoiceRevenue = 0;
    let invoiceCogs = 0;

    let crMap = alt.channel_rates;
    if (typeof crMap === 'string') {
      try { crMap = JSON.parse(crMap); } catch (_) { crMap = {}; }
    }

    if (crMap && typeof crMap === 'object' && Object.keys(crMap).length > 0) {
      for (const [chKey, chVal] of Object.entries(crMap)) {
        if (!chVal || typeof chVal !== 'object') continue;
        const cSold = parseInt(chVal.credits || 0, 10) || 0;
        if (cSold <= 0) continue;
        const sRate = parseFloat(chVal.rate || 0) || 0;
        const sRev = (chVal.cost !== undefined && chVal.cost !== null)
          ? parseFloat(chVal.cost)
          : Math.round(cSold * sRate * 100) / 100;

        const wRate = (wholesaleRates[chKey] !== undefined && wholesaleRates[chKey] !== null && Number(wholesaleRates[chKey]) > 0)
          ? parseFloat(wholesaleRates[chKey])
          : (WHOLESALE_BENCHMARK_RATES[chKey] || 0.1000);
        const sCogs = Math.round(cSold * wRate * 100) / 100;

        invoiceCredits += cSold;
        invoiceRevenue += sRev;
        invoiceCogs += sCogs;

        if (!channelMap[chKey]) {
          channelMap[chKey] = {
            key: chKey,
            label: chKey,
            category: chKey.startsWith('gsm') ? 'GSM SMS' : 'WhatsApp',
            wholesale_rate: wRate,
            credits_sold: 0,
            revenue: 0,
            cogs: 0,
            net_profit: 0,
            margin_pct: 0,
            selling_rate: 0
          };
        }
        channelMap[chKey].credits_sold += cSold;
        channelMap[chKey].revenue += sRev;
        channelMap[chKey].cogs += sCogs;
      }
    } else {
      const primaryKey = (alt.credit_type && alt.destination)
        ? `${alt.credit_type}_${alt.destination}`
        : 'gsm_sms_domestic';
      const cSold = parseInt(alt.credits_requested || 0, 10) || 0;
      const sRev = parseFloat(alt.base_amount || alt.amount_inr || 0) || 0;
      const wRate = (wholesaleRates[primaryKey] !== undefined && wholesaleRates[primaryKey] !== null && Number(wholesaleRates[primaryKey]) > 0)
        ? parseFloat(wholesaleRates[primaryKey])
        : (WHOLESALE_BENCHMARK_RATES[primaryKey] || 0.1000);
      const sCogs = Math.round(cSold * wRate * 100) / 100;

      invoiceCredits += cSold;
      invoiceRevenue += sRev;
      invoiceCogs += sCogs;

      if (!channelMap[primaryKey]) {
        channelMap[primaryKey] = {
          key: primaryKey,
          label: primaryKey,
          category: primaryKey.startsWith('gsm') ? 'GSM SMS' : 'WhatsApp',
          wholesale_rate: wRate,
          credits_sold: 0,
          revenue: 0,
          cogs: 0,
          net_profit: 0,
          margin_pct: 0,
          selling_rate: 0
        };
      }
      channelMap[primaryKey].credits_sold += cSold;
      channelMap[primaryKey].revenue += sRev;
      channelMap[primaryKey].cogs += sCogs;
    }

    const invoiceProfit = Math.round((invoiceRevenue - invoiceCogs) * 100) / 100;
    totalCreditsSold += invoiceCredits;
    grossRevenue += invoiceRevenue;
    wholesaleCogs += invoiceCogs;

    clientMap[clientId].credits_bought += invoiceCredits;
    clientMap[clientId].revenue += invoiceRevenue;
    clientMap[clientId].cogs += invoiceCogs;
    clientMap[clientId].net_profit += invoiceProfit;
    if (alt.created_at && (!clientMap[clientId].last_allotment_at || new Date(alt.created_at) > new Date(clientMap[clientId].last_allotment_at))) {
      clientMap[clientId].last_allotment_at = alt.created_at;
    }

    processedInvoices.push({
      id: alt.id,
      invoice_number: alt.invoice_number || `INV-${alt.id}`,
      client_id: clientId,
      client_name: clientName,
      client_email: clientEmail,
      credits_allotted: invoiceCredits,
      gross_billed: Math.round(invoiceRevenue * 100) / 100,
      wholesale_cost: Math.round(invoiceCogs * 100) / 100,
      net_profit: invoiceProfit,
      margin_pct: invoiceRevenue > 0 ? Math.round((invoiceProfit / invoiceRevenue) * 1000) / 10 : 0,
      paid_amount: paidAmt,
      payment_status: alt.payment_status || 'Unpaid',
      created_at: alt.created_at
    });
  }

  const netProfit = Math.round((grossRevenue - wholesaleCogs) * 100) / 100;
  const overallMarginPct = grossRevenue > 0 ? Math.round((netProfit / grossRevenue) * 1000) / 10 : 0;
  const balanceDue = Math.round(Math.max(0, grossRevenue - cashCollected) * 100) / 100;
  const collectionRatePct = grossRevenue > 0 ? Math.round((cashCollected / grossRevenue) * 1000) / 10 : 0;

  // Finalize channels
  let waCredits = 0, waRevenue = 0, waCogs = 0;
  let gsmCredits = 0, gsmRevenue = 0, gsmCogs = 0;

  const channelList = Object.values(channelMap).map(ch => {
    ch.revenue = Math.round(ch.revenue * 100) / 100;
    ch.cogs = Math.round(ch.cogs * 100) / 100;
    ch.net_profit = Math.round((ch.revenue - ch.cogs) * 100) / 100;
    ch.margin_pct = ch.revenue > 0 ? Math.round((ch.net_profit / ch.revenue) * 1000) / 10 : 0;
    ch.selling_rate = ch.credits_sold > 0 ? Math.round((ch.revenue / ch.credits_sold) * 10000) / 10000 : 0;

    if (ch.category === 'WhatsApp') {
      waCredits += ch.credits_sold;
      waRevenue += ch.revenue;
      waCogs += ch.cogs;
    } else {
      gsmCredits += ch.credits_sold;
      gsmRevenue += ch.revenue;
      gsmCogs += ch.cogs;
    }
    return ch;
  });

  const waProfit = Math.round((waRevenue - waCogs) * 100) / 100;
  const gsmProfit = Math.round((gsmRevenue - gsmCogs) * 100) / 100;

  // Finalize top clients
  const topClients = Object.values(clientMap).map(cl => {
    cl.revenue = Math.round(cl.revenue * 100) / 100;
    cl.cogs = Math.round(cl.cogs * 100) / 100;
    cl.net_profit = Math.round(cl.net_profit * 100) / 100;
    cl.margin_pct = cl.revenue > 0 ? Math.round((cl.net_profit / cl.revenue) * 1000) / 10 : 0;
    cl.paid_amount = Math.round(cl.paid_amount * 100) / 100;
    cl.balance_due = Math.round(Math.max(0, cl.revenue - cl.paid_amount) * 100) / 100;
    return cl;
  }).sort((a, b) => b.net_profit - a.net_profit);

  return {
    summary: {
      total_credits_sold: totalCreditsSold,
      gross_revenue: Math.round(grossRevenue * 100) / 100,
      wholesale_cogs: Math.round(wholesaleCogs * 100) / 100,
      net_profit: netProfit,
      profit_margin_pct: overallMarginPct,
      cash_collected: Math.round(cashCollected * 100) / 100,
      balance_due: balanceDue,
      collection_rate_pct: collectionRatePct,
      avg_wholesale_rate: totalCreditsSold > 0 ? Math.round((wholesaleCogs / totalCreditsSold) * 10000) / 10000 : 0,
      avg_selling_rate: totalCreditsSold > 0 ? Math.round((grossRevenue / totalCreditsSold) * 10000) / 10000 : 0
    },
    channel_summary: {
      whatsapp: {
        label: 'WhatsApp Messaging',
        credits_sold: waCredits,
        revenue: Math.round(waRevenue * 100) / 100,
        cogs: Math.round(waCogs * 100) / 100,
        net_profit: waProfit,
        margin_pct: waRevenue > 0 ? Math.round((waProfit / waRevenue) * 1000) / 10 : 0
      },
      gsm_sms: {
        label: 'GSM Bulk SMS',
        credits_sold: gsmCredits,
        revenue: Math.round(gsmRevenue * 100) / 100,
        cogs: Math.round(gsmCogs * 100) / 100,
        net_profit: gsmProfit,
        margin_pct: gsmRevenue > 0 ? Math.round((gsmProfit / gsmRevenue) * 1000) / 10 : 0
      }
    },
    channels: channelList,
    top_clients: topClients,
    recent_invoices: processedInvoices.slice(0, 15)
  };
}

// GET /api/resellers/analytics/margins - Comprehensive Profit & Margins Analytics for Resellers
router.get('/analytics/margins', authenticate, requireRoles('reseller', 'admin'), async (req, res) => {
  try {
    let targetResellerId = req.user.role === 'reseller' ? req.user.id : parseInt(req.query.reseller_id || req.user.id, 10);
    if (!targetResellerId || isNaN(targetResellerId)) {
      return res.status(400).json({ error: 'Valid reseller ID is required' });
    }

    // Verify reseller exists
    const rCheck = await query(`SELECT id, full_name, email, company_name FROM users WHERE id = $1`, [targetResellerId]);
    if (!rCheck.rows.length) {
      return res.status(404).json({ error: 'Reseller account not found' });
    }
    const resellerUser = rCheck.rows[0];

    // 1. Fetch reseller's wholesale rates from user_credits
    const ucRes = await query(
      `SELECT credit_type, destination, rate_inr FROM user_credits WHERE user_id = $1`,
      [targetResellerId]
    );
    const wholesaleRates = {};
    for (const row of ucRes.rows) {
      const key = `${row.credit_type}_${row.destination}`;
      if (row.rate_inr !== null && Number(row.rate_inr) > 0) {
        wholesaleRates[key] = parseFloat(row.rate_inr);
      }
    }

    // 2. Determine date filter range
    const range = (req.query.range || 'this_month').toLowerCase();
    let dateClause = '';
    if (range === 'this_month') {
      dateClause = `AND cr.created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)`;
    } else if (range === 'last_30_days') {
      dateClause = `AND cr.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`;
    }

    // 3. Query all client allotments made by this reseller
    const allotmentsQuery = `
      SELECT 
        cr.id,
        cr.user_id,
        u.full_name AS client_name,
        u.email AS client_email,
        u.company_name AS client_company,
        cr.credits_requested,
        cr.credit_type,
        cr.destination,
        cr.amount_inr,
        cr.base_amount,
        cr.rate_per_credit,
        cr.paid_amount,
        cr.payment_status,
        cr.channel_rates,
        cr.invoice_number,
        cr.created_at
      FROM credit_requests cr
      JOIN users u ON u.id = cr.user_id
      WHERE u.reseller_id = $1
        AND cr.status = 'Approved'
        ${dateClause}
      ORDER BY cr.created_at DESC
    `;
    const altRes = await query(allotmentsQuery, [targetResellerId]);

    // 4. Calculate margins and breakdown
    const report = calculateResellerMargins(wholesaleRates, altRes.rows);

    return res.json({
      reseller_id: targetResellerId,
      reseller_name: resellerUser.company_name || resellerUser.full_name || resellerUser.email,
      range,
      ...report
    });
  } catch (err) {
    console.error('Failed to compute reseller margin analytics:', err);
    return res.status(500).json({ error: 'Failed to compute margin analytics: ' + (err.message || 'Server error') });
  }
});

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

// GET /api/resellers/render/config - Get current Render API integration status (Admin only)
router.get('/render/config', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const cfg = await getRenderConfig();
    const testResult = cfg.isConfigured ? await testRenderConnection() : null;
    return res.json({
      configured: cfg.isConfigured,
      service_id: cfg.serviceId ? `${cfg.serviceId.slice(0, 8)}...` : '',
      service_id_raw: cfg.serviceId || '',
      api_key_masked: cfg.apiKey ? `rnd_${cfg.apiKey.slice(4, 8)}...${cfg.apiKey.slice(-4)}` : '',
      connection: testResult
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read Render configuration: ' + err.message });
  }
});

// PUT /api/resellers/render/config - Save Render API key & Service ID (Admin only)
router.put('/render/config', authenticate, requireRoles('admin'), async (req, res) => {
  const apiKey = String(req.body.api_key || '').trim();
  const serviceId = String(req.body.service_id || '').trim();

  if (!apiKey || !serviceId) {
    return res.status(400).json({ error: 'Both Render API Key and Service ID are required.' });
  }

  // Test the key live with Render
  const test = await testRenderConnection(apiKey, serviceId);
  if (!test.connected) {
    return res.status(400).json({
      error: `Could not connect to Render with provided credentials: ${test.error || 'Invalid API key or service ID'}`
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO platform_integrations (config_key, config_value, updated_at)
      VALUES ('RENDER_API_KEY', $1, NOW())
      ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
    `, [apiKey]);
    await client.query(`
      INSERT INTO platform_integrations (config_key, config_value, updated_at)
      VALUES ('RENDER_SERVICE_ID', $1, NOW())
      ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
    `, [serviceId]);
    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'platform_integration',
      entityId: 0,
      action: 'render_cloud_integration_configured',
      details: { serviceId, serviceName: test.serviceName }
    });
    await client.query('COMMIT');

    return res.json({
      message: `Render API connected successfully to service: "${test.serviceName}"! All reseller custom domains will now be automatically provisioned with free SSL.`,
      service_name: test.serviceName,
      domains_count: test.domainsCount
    });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Failed to save Render configuration: ' + err.message });
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

// POST /api/resellers/my-domain/verify - Reseller (or Admin) triggers live DNS verification for their custom domain
router.post('/my-domain/verify', authenticate, requireRoles('reseller', 'admin'), async (req, res) => {
  const resellerId = req.user.role === 'reseller' ? req.user.id : parseInt(req.body.reseller_id || req.user.id, 10);
  try {
    const profileRes = await query('SELECT custom_domain, domain_status FROM reseller_profiles WHERE reseller_id = $1', [resellerId]);
    if (!profileRes.rows.length || !profileRes.rows[0].custom_domain) {
      return res.status(400).json({ error: 'Please enter and save a custom domain first before running verification.' });
    }
    const domain = profileRes.rows[0].custom_domain;
    let dnsRecords = [];
    let resolved = false;

    try {
      dnsRecords = await dns.resolve(domain);
      resolved = Boolean(dnsRecords && dnsRecords.length);
    } catch (_) {}

    if (!resolved) {
      try {
        dnsRecords = await dns.resolveCname(domain);
        resolved = Boolean(dnsRecords && dnsRecords.length);
      } catch (_) {}
    }

    if (!resolved) {
      try {
        const lk = await dns.lookup(domain);
        if (lk && lk.address) {
          dnsRecords = [lk.address];
          resolved = true;
        }
      } catch (_) {}
    }

    const forceBypass = Boolean((req.user.role === 'admin' && req.body.force) || req.query.force === 'true');

    if (!resolved && !forceBypass) {
      return res.status(400).json({
        verified: false,
        domain,
        target: PLATFORM_CNAME_TARGET,
        error: `DNS resolution is not active for "${domain}". Please add a CNAME record with Host/Name "${domain.split('.')[0]}" pointing to "${PLATFORM_CNAME_TARGET}" in your DNS manager (e.g. Cloudflare, GoDaddy). If you recently added it, DNS propagation can take 2-15 minutes.`
      });
    }

    // Auto-update domain_status to Verified in database!
    await query(`UPDATE reseller_profiles SET domain_status = 'Verified', updated_at = NOW() WHERE reseller_id = $1`, [resellerId]);

    try {
      await logAudit(null, {
        actorId: req.user.id,
        entityType: 'reseller_profile',
        entityId: resellerId,
        action: 'white_label_domain_dns_verified',
        details: { domain, dnsRecords, forceBypass }
      });
    } catch (_) {}

    // Automated Cloud Domain & SSL Provisioning
    let renderInfo = null;
    try {
      const renderProv = await addCustomDomainToRender(domain);
      await triggerRenderDomainVerification(domain);
      const renderStatus = await checkRenderDomainStatus(domain);
      renderInfo = {
        registered: renderProv.success,
        ssl_status: renderStatus?.verificationStatus || 'provisioning',
        certificate_status: renderStatus?.certificateStatus || 'waiting_for_verification'
      };
    } catch (_) {}

    return res.json({
      verified: true,
      domain_status: 'Verified',
      domain,
      resolved_to: dnsRecords,
      render: renderInfo,
      message: `Success! Domain "${domain}" is active and verified!`
    });
  } catch (err) {
    console.error('Self domain verify error:', err);
    return res.status(500).json({ error: 'Failed to verify DNS domain: ' + (err.message || 'Network error') });
  }
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
    let resolved = false;

    try {
      dnsRecords = await dns.resolve(domain);
      resolved = Boolean(dnsRecords && dnsRecords.length);
    } catch (_) {}

    if (!resolved) {
      try {
        dnsRecords = await dns.resolveCname(domain);
        resolved = Boolean(dnsRecords && dnsRecords.length);
      } catch (_) {}
    }

    if (!resolved) {
      try {
        const lk = await dns.lookup(domain);
        if (lk && lk.address) {
          dnsRecords = [lk.address];
          resolved = true;
        }
      } catch (_) {}
    }

    const forceBypass = Boolean(req.body.force || req.query.force === 'true');

    if (!resolved && !forceBypass) {
      return res.status(400).json({
        verified: false,
        domain,
        target: PLATFORM_CNAME_TARGET,
        error: `DNS resolution is not active for "${domain}". Ensure the domain has an active CNAME pointing to ${PLATFORM_CNAME_TARGET}. (Admin can also set status to "Verified" directly from the dropdown).`
      });
    }

    // Auto-update domain_status to Verified in database!
    await query(`UPDATE reseller_profiles SET domain_status = 'Verified', updated_at = NOW() WHERE reseller_id = $1`, [resellerId]);

    try {
      await logAudit(null, {
        actorId: req.user.id,
        entityType: 'reseller_profile',
        entityId: resellerId,
        action: 'white_label_domain_dns_verified_by_admin',
        details: { domain, dnsRecords, forceBypass }
      });
    } catch (_) {}

    // Also check and provision with Render cloud if configured
    let renderInfo = null;
    try {
      const renderProv = await addCustomDomainToRender(domain);
      await triggerRenderDomainVerification(domain);
      const renderStatus = await checkRenderDomainStatus(domain);
      renderInfo = {
        registered: renderProv.success,
        ssl_status: renderStatus?.verificationStatus || 'provisioning',
        certificate_status: renderStatus?.certificateStatus || 'waiting_for_verification'
      };
    } catch (_) {}

    return res.json({
      verified: true,
      domain_status: 'Verified',
      domain,
      resolved_to: dnsRecords,
      render: renderInfo,
      message: `Domain "${domain}" successfully marked as Verified!`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to run DNS check: ' + (err.message || 'Server error') });
  }
});

// GET /api/resellers/:id/render-status - Live Render SSL & domain certificate status check
router.get('/:id/render-status', authenticate, requireRoles('reseller', 'admin'), async (req, res) => {
  const resellerId = req.user.role === 'reseller' ? req.user.id : parseInt(req.params.id, 10);
  try {
    const profileRes = await query('SELECT custom_domain, domain_status FROM reseller_profiles WHERE reseller_id = $1', [resellerId]);
    if (!profileRes.rows.length || !profileRes.rows[0].custom_domain) {
      return res.status(404).json({ error: 'No custom domain configured for this partner.' });
    }
    const domain = profileRes.rows[0].custom_domain;
    const renderStatus = await checkRenderDomainStatus(domain);
    return res.json({
      domain,
      domain_status: profileRes.rows[0].domain_status,
      render: renderStatus
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch Render status: ' + (err.message || 'Server error') });
  }
});

router.calculateResellerMargins = calculateResellerMargins;
router.WHOLESALE_BENCHMARK_RATES = WHOLESALE_BENCHMARK_RATES;

module.exports = router;
