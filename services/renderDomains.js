// ===========================================================================
// Render Cloud Automated Custom Domain & SSL Provisioning Service
// Automatically binds reseller custom domains and provisions free SSL certs
// ===========================================================================
require('dotenv').config();

const RENDER_SERVICE_ID = (process.env.RENDER_SERVICE_ID || '').trim();

/**
 * Automatically register a reseller's custom domain with Render's infrastructure.
 * Render generates and auto-renews free Let's Encrypt / Cloudflare SSL certificates.
 */
async function addCustomDomainToRender(domain) {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey || !RENDER_SERVICE_ID || !domain) {
    return {
      success: false,
      configured: Boolean(apiKey && RENDER_SERVICE_ID),
      reason: !apiKey ? 'RENDER_API_KEY not configured' : (!RENDER_SERVICE_ID ? 'RENDER_SERVICE_ID not configured' : 'Domain missing')
    };
  }

  const cleanDomain = String(domain).trim().toLowerCase();

  try {
    console.log(`[RENDER DOMAINS] 🌐 Requesting automated SSL & domain provisioning for: ${cleanDomain}`);
    const res = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({ name: cleanDomain })
    });

    if (res.status === 409) {
      console.log(`[RENDER DOMAINS] Domain ${cleanDomain} is already registered on Render service.`);
      return { success: true, alreadyExists: true, configured: true };
    }

    const data = await res.json();
    if (!res.ok) {
      console.warn('[RENDER DOMAINS] Failed to register domain:', data);
      return { success: false, configured: true, error: data.message || 'Render API rejected custom domain' };
    }

    // Trigger immediate DNS / SSL verification on Render
    try {
      await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains/${encodeURIComponent(cleanDomain)}/verify`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        }
      });
    } catch (_) {}

    console.log(`[RENDER DOMAINS] ✅ Automated domain & SSL provisioning initialized for ${cleanDomain}`);
    return { success: true, configured: true, data };
  } catch (err) {
    console.error('[RENDER DOMAINS ERROR]:', err.message);
    return { success: false, configured: true, error: err.message };
  }
}

/**
 * Remove obsolete custom domain from Render when a reseller changes or deletes domain
 */
async function removeCustomDomainFromRender(domain) {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey || !RENDER_SERVICE_ID || !domain) return;
  const cleanDomain = String(domain).trim().toLowerCase();

  try {
    console.log(`[RENDER DOMAINS] 🗑️ Removing obsolete custom domain: ${cleanDomain}`);
    await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains/${encodeURIComponent(cleanDomain)}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      }
    });
  } catch (err) {
    console.error('[RENDER DOMAINS DELETE ERROR]:', err.message);
  }
}

/**
 * Check Render's live SSL and domain verification status
 */
async function checkRenderDomainStatus(domain) {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey || !RENDER_SERVICE_ID || !domain) return null;
  const cleanDomain = String(domain).trim().toLowerCase();

  try {
    const res = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/custom-domains/${encodeURIComponent(cleanDomain)}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

module.exports = {
  addCustomDomainToRender,
  removeCustomDomainFromRender,
  checkRenderDomainStatus
};
