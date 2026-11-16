const crypto = require('crypto');
const { query } = require('../db');

/**
 * Validates that an original destination URL is safe and well-formed
 */
function isValidDestinationUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Generates a collision-resistant random short code
 */
function generateRandomCode(length = 6) {
  const chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Lightweight, zero-dependency User-Agent parser for telecom and marketing analytics
 */
function parseUserAgent(uaString) {
  if (!uaString || typeof uaString !== 'string') {
    return { deviceType: 'mobile', os: 'Other', browser: 'Other' };
  }

  const ua = uaString.toLowerCase();

  // 1. Device Type
  let deviceType = 'desktop';
  if (/ipad|tablet|(android(?!.*mobile))|kindle|silk|playbook/.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile|wpdesktop/.test(ua)) {
    deviceType = 'mobile';
  }

  // 2. Operating System
  let os = 'Other';
  if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) os = 'iOS';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('macintosh') || ua.includes('mac os x')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('cros')) os = 'Chrome OS';

  // 3. Browser / In-App Client
  let browser = 'Other';
  if (ua.includes('whatsapp')) {
    browser = 'WhatsApp In-App';
  } else if (ua.includes('instagram')) {
    browser = 'Instagram In-App';
  } else if (ua.includes('fban') || ua.includes('fbav')) {
    browser = 'Facebook In-App';
  } else if (ua.includes('samsungbrowser')) {
    browser = 'Samsung Browser';
  } else if (ua.includes('edg/') || ua.includes('edge/')) {
    browser = 'Microsoft Edge';
  } else if (ua.includes('opr/') || ua.includes('opera/')) {
    browser = 'Opera';
  } else if (ua.includes('chrome/') || ua.includes('crios/')) {
    browser = 'Google Chrome';
  } else if (ua.includes('firefox/') || ua.includes('fxios/')) {
    browser = 'Mozilla Firefox';
  } else if (ua.includes('safari/') && !ua.includes('chrome')) {
    browser = 'Apple Safari';
  }

  return { deviceType, os, browser };
}

/**
 * Records an incoming click event asynchronously without blocking the redirect
 */
async function recordLinkClick({ linkId, ip, phoneNumber, userAgent, referrer }) {
  try {
    const { deviceType, os, browser } = parseUserAgent(userAgent);
    const cleanPhone = phoneNumber ? String(phoneNumber).replace(/[^0-9]/g, '').slice(-12) : null;
    const cleanIp = ip ? String(ip).slice(0, 64) : null;
    const cleanRef = referrer ? String(referrer).slice(0, 500) : null;

    // Check if this visitor IP is unique for this link
    let isUnique = false;
    if (cleanIp) {
      const checkRes = await query(
        `SELECT id FROM short_link_clicks WHERE link_id = $1 AND visitor_ip = $2 LIMIT 1`,
        [linkId, cleanIp]
      );
      if (checkRes.rows.length === 0) {
        isUnique = true;
      }
    } else {
      isUnique = true;
    }

    // Insert click event
    await query(
      `INSERT INTO short_link_clicks 
        (link_id, visitor_ip, phone_number, user_agent, device_type, os, browser, referrer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [linkId, cleanIp, cleanPhone, userAgent ? userAgent.slice(0, 1000) : null, deviceType, os, browser, cleanRef]
    );

    // Update click count metrics on the parent short_link
    if (isUnique) {
      await query(
        `UPDATE short_links 
         SET clicks_count = clicks_count + 1, unique_clicks_count = unique_clicks_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [linkId]
      );
    } else {
      await query(
        `UPDATE short_links 
         SET clicks_count = clicks_count + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [linkId]
      );
    }
  } catch (err) {
    console.error('[LINK CLICK RECORD ERROR]:', err.message);
  }
}

module.exports = {
  isValidDestinationUrl,
  generateRandomCode,
  parseUserAgent,
  recordLinkClick
};
