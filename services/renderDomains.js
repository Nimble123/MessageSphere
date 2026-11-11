// ===========================================================================
// Render Cloud Automated Custom Domain & SSL Provisioning Service
// Automatically binds reseller custom domains and provisions free SSL certs
// ===========================================================================
require('dotenv').config();

async function getRenderConfig() {
  let apiKey = (process.env.RENDER_API_KEY || '').trim();
  let serviceId = (process.env.RENDER_SERVICE_ID || '').trim();

  try {
    const { query } = require('../db');
    const res = await query(
      `SELECT config_key, config_value FROM platform_integrations WHERE config_key IN ('RENDER_API_KEY', 'RENDER_SERVICE_ID')`
    );
    res.rows.forEach(r => {
      if (r.config_key === 'RENDER_API_KEY' && r.config_value) apiKey = r.config_value.trim();
      if (r.config_key === 'RENDER_SERVICE_ID' && r.config_value) serviceId = r.config_value.trim();
    });
  } catch (_) {}

  return {
    apiKey,
    serviceId,
    isConfigured: Boolean(apiKey && serviceId)
  };
}

/**
 * Test Render API Key & Service ID connectivity
 */
async function testRenderConnection(overrideApiKey, overrideServiceId) {
  const cfg = await getRenderConfig();
  const apiKey = overrideApiKey || cfg.apiKey;
  const serviceId = overrideServiceId || cfg.serviceId;

  if (!apiKey || !serviceId) {
    return {
      connected: false,
      error: 'Render API Key and Service ID are required.'
    };
  }

  try {
    const res = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      }
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        connected: false,
        status: res.status,
        error: errData.message || `Render API error (HTTP ${res.status}). Verify API Key and Service ID.`
      };
    }

    const data = await res.json();
    return {
      connected: true,
      serviceName: data.name || data.service?.name || serviceId,
      serviceType: data.type || data.service?.type || 'web_service',
      domainsCount: (data.customDomains || []).length
    };
  } catch (err) {
    return {
      connected: false,
      error: 'Network error connecting to api.render.com: ' + err.message
    };
  }
}

/**
 * Automatically register a reseller's custom domain with Render's infrastructure.
 * Render generates and auto-renews free Let's Encrypt / Cloudflare SSL certificates.
 */
async function addCustomDomainToRender(domain) {
  const cfg = await getRenderConfig();
  if (!cfg.isConfigured || !domain) {
    return {
      success: false,
      configured: cfg.isConfigured,
      reason: !cfg.apiKey ? 'RENDER_API_KEY not configured' : (!cfg.serviceId ? 'RENDER_SERVICE_ID not configured' : 'Domain missing')
    };
  }

  const cleanDomain = String(domain).trim().toLowerCase();

  try {
    console.log(`[RENDER DOMAINS] 🌐 Requesting automated SSL & domain provisioning for: ${cleanDomain}`);
    const res = await fetch(`https://api.render.com/v1/services/${cfg.serviceId}/custom-domains`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
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
      await fetch(`https://api.render.com/v1/services/${cfg.serviceId}/custom-domains/${encodeURIComponent(cleanDomain)}/verify`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`
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
  const cfg = await getRenderConfig();
  if (!cfg.isConfigured || !domain) return;
  const cleanDomain = String(domain).trim().toLowerCase();

  try {
    console.log(`[RENDER DOMAINS] 🗑️ Removing obsolete custom domain: ${cleanDomain}`);
    await fetch(`https://api.render.com/v1/services/${cfg.serviceId}/custom-domains/${encodeURIComponent(cleanDomain)}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
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
  const cfg = await getRenderConfig();
  if (!cfg.isConfigured || !domain) return null;
  const cleanDomain = String(domain).trim().toLowerCase();

  try {
    const res = await fetch(`https://api.render.com/v1/services/${cfg.serviceId}/custom-domains/${encodeURIComponent(cleanDomain)}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

module.exports = {
  getRenderConfig,
  testRenderConnection,
  addCustomDomainToRender,
  removeCustomDomainFromRender,
  checkRenderDomainStatus
};
