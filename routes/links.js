const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  isValidDestinationUrl,
  generateRandomCode,
  recordLinkClick
} = require('../services/links');

/**
 * Builds the full public short URL based on the request host
 */
function buildFullShortUrl(req, code) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host || 'messagesphere.nmedialabs.in';
  return `${protocol}://${host}/s/${code}`;
}

/**
 * Public Redirection Handler: GET /s/:code
 * Ultra-fast HTTP 302 redirect with asynchronous click analytics recording
 */
async function handlePublicRedirect(req, res) {
  const code = String(req.params.code || '').trim();
  if (!code) {
    return res.status(404).send('Short link not found.');
  }

  try {
    const linkRes = await query(
      `SELECT id, original_url, is_active FROM short_links WHERE short_code = $1 LIMIT 1`,
      [code]
    );

    if (linkRes.rows.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Link Not Found - MessageSphere</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px;background:#f8fafc;color:#1e293b;">
          <h2 style="color:#ef4444;font-size:1.8rem;margin-bottom:8px;">Link Not Found</h2>
          <p style="color:#64748b;max-width:400px;margin:0 auto 24px;">The short link you are attempting to visit does not exist or has expired.</p>
          <a href="/" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Go to MessageSphere</a>
        </body>
        </html>
      `);
    }

    const link = linkRes.rows[0];

    if (!link.is_active) {
      return res.status(410).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Link Inactive - MessageSphere</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 20px;background:#f8fafc;color:#1e293b;">
          <h2 style="color:#d97706;font-size:1.8rem;margin-bottom:8px;">Link Paused</h2>
          <p style="color:#64748b;max-width:400px;margin:0 auto 24px;">This campaign link is currently paused or inactive by the broadcaster.</p>
        </body>
        </html>
      `);
    }

    // Extract visitor details for click audit
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const visitorIp = String(rawIp).split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';
    const referrer = req.headers.referer || req.headers.referrer || '';
    const phoneNumber = req.query.r || req.query.u || req.query.p || req.query.phone || null;

    // Asynchronously record click (fire & forget, zero latency for user redirect)
    setImmediate(() => {
      recordLinkClick({
        linkId: link.id,
        ip: visitorIp,
        phoneNumber,
        userAgent,
        referrer
      }).catch(err => console.error('[CLICK RECORD FAILED]:', err.message));
    });

    // Immediate 302 redirect to original destination
    return res.redirect(302, link.original_url);
  } catch (err) {
    console.error('Redirect error:', err);
    return res.status(500).send('Internal redirect error');
  }
}

/**
 * GET /api/links
 * Lists all shortened links for the authenticated user/reseller/admin
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : '';

    let whereClause = '';
    let params = [];

    if (req.user.role === 'admin') {
      if (search) {
        whereClause = `WHERE (l.title ILIKE $1 OR l.short_code ILIKE $1 OR l.original_url ILIKE $1)`;
        params.push(`%${search}%`);
      }
    } else if (req.user.role === 'reseller') {
      if (search) {
        whereClause = `WHERE (l.user_id = $1 OR u.reseller_id = $1) AND (l.title ILIKE $2 OR l.short_code ILIKE $2 OR l.original_url ILIKE $2)`;
        params.push(req.user.id, `%${search}%`);
      } else {
        whereClause = `WHERE (l.user_id = $1 OR u.reseller_id = $1)`;
        params.push(req.user.id);
      }
    } else {
      // Regular user
      if (search) {
        whereClause = `WHERE l.user_id = $1 AND (l.title ILIKE $2 OR l.short_code ILIKE $2 OR l.original_url ILIKE $2)`;
        params.push(req.user.id, `%${search}%`);
      } else {
        whereClause = `WHERE l.user_id = $1`;
        params.push(req.user.id);
      }
    }

    const countSql = `
      SELECT COUNT(*) as total, 
             COALESCE(SUM(l.clicks_count), 0) as total_clicks,
             COALESCE(SUM(l.unique_clicks_count), 0) as total_unique_clicks
      FROM short_links l
      LEFT JOIN users u ON l.user_id = u.id
      ${whereClause}
    `;

    const countRes = await query(countSql, params);
    const totalCount = parseInt(countRes.rows[0]?.total || 0, 10);
    const totalClicks = parseInt(countRes.rows[0]?.total_clicks || 0, 10);
    const totalUniqueClicks = parseInt(countRes.rows[0]?.total_unique_clicks || 0, 10);

    const listParams = [...params, limit, offset];
    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;

    const listSql = `
      SELECT l.*, u.email as owner_email, u.name as owner_name, u.business_name as owner_company
      FROM short_links l
      LEFT JOIN users u ON l.user_id = u.id
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    `;

    const listRes = await query(listSql, listParams);

    const links = listRes.rows.map(row => ({
      ...row,
      short_url: buildFullShortUrl(req, row.short_code)
    }));

    return res.json({
      links,
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
      metrics: { totalLinks: totalCount, totalClicks, totalUniqueClicks }
    });
  } catch (err) {
    console.error('List short links error:', err);
    return res.status(500).json({ error: 'Failed to retrieve short links' });
  }
});

/**
 * POST /api/links
 * Shortens a URL and creates a trackable link record
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { original_url, title, custom_alias } = req.body;

    if (!isValidDestinationUrl(original_url)) {
      return res.status(400).json({
        error: 'Please enter a valid destination URL starting with http:// or https://'
      });
    }

    const linkTitle = title && String(title).trim() ? String(title).trim().slice(0, 255) : 'Tracked Link';

    let finalCode = '';
    if (custom_alias && String(custom_alias).trim()) {
      const cleanAlias = String(custom_alias).trim();
      if (!/^[a-zA-Z0-9_-]{3,30}$/.test(cleanAlias)) {
        return res.status(400).json({
          error: 'Custom alias must be 3-30 characters long and contain only letters, numbers, hyphens, and underscores.'
        });
      }

      // Check collision
      const checkRes = await query(`SELECT id FROM short_links WHERE short_code = $1 LIMIT 1`, [cleanAlias]);
      if (checkRes.rows.length > 0) {
        return res.status(409).json({ error: 'This custom alias is already taken. Please choose another.' });
      }
      finalCode = cleanAlias;
    } else {
      // Generate random code with collision avoidance
      let attempts = 0;
      while (attempts < 5) {
        const candidate = generateRandomCode(6);
        const checkRes = await query(`SELECT id FROM short_links WHERE short_code = $1 LIMIT 1`, [candidate]);
        if (checkRes.rows.length === 0) {
          finalCode = candidate;
          break;
        }
        attempts++;
      }
      if (!finalCode) {
        finalCode = generateRandomCode(8);
      }
    }

    const insertRes = await query(
      `INSERT INTO short_links (user_id, title, original_url, short_code, custom_alias)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, linkTitle, original_url.trim(), finalCode, custom_alias ? String(custom_alias).trim() : null]
    );

    const created = insertRes.rows[0];
    created.short_url = buildFullShortUrl(req, created.short_code);

    return res.status(201).json({
      message: 'Short link created successfully!',
      link: created
    });
  } catch (err) {
    console.error('Create short link error:', err);
    return res.status(500).json({ error: 'Failed to create short link' });
  }
});

/**
 * GET /api/links/:id/analytics
 * Comprehensive CTR, device, OS, browser, and click audit report
 */
router.get('/:id/analytics', authenticate, async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    if (!linkId) return res.status(400).json({ error: 'Invalid link ID' });

    // Fetch link with permission check
    const linkRes = await query(
      `SELECT l.*, u.email as owner_email, u.reseller_id
       FROM short_links l
       JOIN users u ON l.user_id = u.id
       WHERE l.id = $1`,
      [linkId]
    );

    if (linkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const link = linkRes.rows[0];

    // Ownership & permission guard
    if (req.user.role !== 'admin') {
      if (req.user.role === 'reseller') {
        if (link.user_id !== req.user.id && link.reseller_id !== req.user.id) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } else if (link.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    link.short_url = buildFullShortUrl(req, link.short_code);

    // 1. Device breakdown
    const deviceRes = await query(
      `SELECT device_type, COUNT(*) as count 
       FROM short_link_clicks 
       WHERE link_id = $1 
       GROUP BY device_type 
       ORDER BY count DESC`,
      [linkId]
    );

    // 2. OS breakdown
    const osRes = await query(
      `SELECT os, COUNT(*) as count 
       FROM short_link_clicks 
       WHERE link_id = $1 
       GROUP BY os 
       ORDER BY count DESC 
       LIMIT 8`,
      [linkId]
    );

    // 3. Browser breakdown
    const browserRes = await query(
      `SELECT browser, COUNT(*) as count 
       FROM short_link_clicks 
       WHERE link_id = $1 
       GROUP BY browser 
       ORDER BY count DESC 
       LIMIT 8`,
      [linkId]
    );

    // 4. Recent Click Logs (latest 100)
    const logsRes = await query(
      `SELECT id, visitor_ip, phone_number, device_type, os, browser, referrer, clicked_at
       FROM short_link_clicks
       WHERE link_id = $1
       ORDER BY clicked_at DESC
       LIMIT 100`,
      [linkId]
    );

    // Mask IPs for non-admin for privacy compliance (e.g. 103.24.xxx.xxx)
    const isAdmin = req.user.role === 'admin';
    const clickLogs = logsRes.rows.map(c => {
      let displayIp = c.visitor_ip || 'N/A';
      if (!isAdmin && displayIp.includes('.')) {
        const parts = displayIp.split('.');
        if (parts.length === 4) {
          displayIp = `${parts[0]}.${parts[1]}.*.*`;
        }
      }
      return {
        ...c,
        visitor_ip: displayIp
      };
    });

    // 5. Timeline (last 14 days)
    const timelineRes = await query(
      `SELECT TO_CHAR(clicked_at, 'YYYY-MM-DD') as click_date, COUNT(*) as clicks
       FROM short_link_clicks
       WHERE link_id = $1 AND clicked_at >= NOW() - INTERVAL '14 days'
       GROUP BY click_date
       ORDER BY click_date ASC`,
      [linkId]
    );

    return res.json({
      link,
      devices: deviceRes.rows,
      operatingSystems: osRes.rows,
      browsers: browserRes.rows,
      timeline: timelineRes.rows,
      logs: clickLogs
    });
  } catch (err) {
    console.error('Link analytics error:', err);
    return res.status(500).json({ error: 'Failed to fetch link analytics' });
  }
});

/**
 * GET /api/links/:id/export
 * Downloads full click audit log as CSV
 */
router.get('/:id/export', authenticate, async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    if (!linkId) return res.status(400).send('Invalid link ID');

    const linkRes = await query(
      `SELECT l.*, u.reseller_id FROM short_links l JOIN users u ON l.user_id = u.id WHERE l.id = $1`,
      [linkId]
    );
    if (linkRes.rows.length === 0) return res.status(404).send('Link not found');
    const link = linkRes.rows[0];

    if (req.user.role !== 'admin') {
      if (req.user.role === 'reseller') {
        if (link.user_id !== req.user.id && link.reseller_id !== req.user.id) {
          return res.status(403).send('Access denied');
        }
      } else if (link.user_id !== req.user.id) {
        return res.status(403).send('Access denied');
      }
    }

    const logsRes = await query(
      `SELECT clicked_at, phone_number, device_type, os, browser, visitor_ip, referrer
       FROM short_link_clicks
       WHERE link_id = $1
       ORDER BY clicked_at DESC`,
      [linkId]
    );

    let csv = 'Timestamp (IST),Phone Number,Device,Operating System,Browser,IP Address,Referrer\r\n';
    for (const r of logsRes.rows) {
      const timeStr = new Date(r.clicked_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const phone = r.phone_number ? `"${r.phone_number}"` : 'Anonymous';
      const dev = `"${r.device_type || 'mobile'}"`;
      const os = `"${r.os || 'Other'}"`;
      const browser = `"${r.browser || 'Other'}"`;
      const ip = `"${r.visitor_ip || ''}"`;
      const ref = `"${(r.referrer || '').replace(/"/g, '""')}"`;
      csv += `${timeStr},${phone},${dev},${os},${browser},${ip},${ref}\r\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="link_clicks_${link.short_code}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export clicks error:', err);
    return res.status(500).send('Failed to export clicks');
  }
});

/**
 * PATCH /api/links/:id/toggle
 * Toggles link active/paused status
 */
router.patch('/:id/toggle', authenticate, async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    const updateRes = await query(
      `UPDATE short_links 
       SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND (user_id = $2 OR $3 = 'admin')
       RETURNING is_active`,
      [linkId, req.user.id, req.user.role]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found or permission denied' });
    }

    return res.json({
      success: true,
      is_active: updateRes.rows[0].is_active,
      message: updateRes.rows[0].is_active ? 'Link activated' : 'Link paused'
    });
  } catch (err) {
    console.error('Toggle link error:', err);
    return res.status(500).json({ error: 'Failed to update link status' });
  }
});

/**
 * DELETE /api/links/:id
 * Deletes short link and associated click logs
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    const delRes = await query(
      `DELETE FROM short_links WHERE id = $1 AND (user_id = $2 OR $3 = 'admin')`,
      [linkId, req.user.id, req.user.role]
    );

    if (delRes.rowCount === 0) {
      return res.status(404).json({ error: 'Link not found or permission denied' });
    }

    return res.json({ success: true, message: 'Short link deleted successfully' });
  } catch (err) {
    console.error('Delete link error:', err);
    return res.status(500).json({ error: 'Failed to delete link' });
  }
});

module.exports = {
  router,
  handlePublicRedirect
};
