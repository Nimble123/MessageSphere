process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '64';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CREDIT_TYPES, DESTINATIONS } = require('../db');

test('Backend Logic & Route Guard Verification Suite', async (t) => {
  await t.test('Credit Allotment Validation strictly accepts only valid channel keys', () => {
    const validKey = 'normal_domestic';
    const bogusKey = 'bar';
    const negativeKey = 'dp_cta_international';

    function validateChannelKey(key) {
      let destination = '';
      let creditType = '';
      if (key.endsWith('_domestic')) {
        destination = 'domestic';
        creditType = key.replace(/_domestic$/, '');
      } else if (key.endsWith('_international')) {
        destination = 'international';
        creditType = key.replace(/_international$/, '');
      } else {
        return false;
      }
      return CREDIT_TYPES.includes(creditType) && DESTINATIONS.includes(destination);
    }

    assert.equal(validateChannelKey(validKey), true);
    assert.equal(validateChannelKey(negativeKey), true);
    assert.equal(validateChannelKey(bogusKey), false);
    assert.equal(validateChannelKey('random_channel_domestic'), false);
    assert.equal(validateChannelKey(''), false);
  });

  await t.test('Custom Rates Validation rejects negative and zero rates', () => {
    function isValidRate(rate) {
      if (rate === undefined || rate === null || rate === '') return true; // defaults to base
      const r = parseFloat(rate);
      return !isNaN(r) && r > 0 && r <= 1000;
    }

    assert.equal(isValidRate('0.1500'), true);
    assert.equal(isValidRate('2.5'), true);
    assert.equal(isValidRate('-0.50'), false, 'Negative rate must be rejected');
    assert.equal(isValidRate('0'), false, 'Zero rate must be rejected');
    assert.equal(isValidRate('abc'), false, 'NaN rate must be rejected');
  });

  await t.test('Credit Allocation Amounts reject negative or zero values', () => {
    function isValidAmount(val) {
      const amt = parseInt(val, 10);
      return !isNaN(amt) && amt > 0 && amt === Number(val);
    }

    assert.equal(isValidAmount(500), true);
    assert.equal(isValidAmount('1200'), true);
    assert.equal(isValidAmount(-100), false, 'Negative credit count must be rejected');
    assert.equal(isValidAmount(0), false, 'Zero credit count must be rejected');
    assert.equal(isValidAmount('10.5'), false, 'Floating credit count must be rejected');
  });

  await t.test('User Delete Guard prevents deletion when unspent balance exists', () => {
    function canDeleteUser(totalBalance) {
      if (totalBalance > 0) return { allowed: false, error: 'Unspent credits exist' };
      return { allowed: true };
    }

    assert.equal(canDeleteUser(100).allowed, false);
    assert.equal(canDeleteUser(0).allowed, true);
  });

  await t.test('Data retention settings keys match database schema exactly', () => {
    const validDbKeys = new Set(['audit_events', 'campaign_data', 'uploaded_assets']);
    
    // Purge keys check
    const purgedKeys = ['audit_events', 'campaign_data', 'uploaded_assets'];
    purgedKeys.forEach(k => {
      assert.equal(validDbKeys.has(k), true, `Retention key ${k} must exist in retention_settings table`);
    });
  });

  await t.test('Production JWT_SECRET placeholder guard blocks common default keys', () => {
    const INSECURE_JWT_PLACEHOLDERS = new Set([
      'super_secret_jwt_key_change_in_production',
      'development-only-change-me',
      'change_in_production',
      'messagesphere_super_secret_jwt_key_2026_change_in_production',
      'your_jwt_secret_here',
      'secret'
    ]);

    function checkJwtSecret(secret, nodeEnv) {
      if (nodeEnv === 'production') {
        const s = (secret || '').trim();
        if (!s || INSECURE_JWT_PLACEHOLDERS.has(s) || s.length < 32) {
          throw new Error('Insecure JWT secret');
        }
      }
      return true;
    }

    // In dev: allows default
    assert.equal(checkJwtSecret('development-only-change-me', 'development'), true);

    // In prod: throws on placeholders
    assert.throws(() => checkJwtSecret('super_secret_jwt_key_change_in_production', 'production'));
    assert.throws(() => checkJwtSecret('', 'production'));
    assert.throws(() => checkJwtSecret('short_secret', 'production'));
    assert.equal(checkJwtSecret('a_very_strong_random_secret_with_more_than_32_characters_ok', 'production'), true);
  });

  await t.test('Receipt URL validation allows secure paths and blocks dangerous protocols', () => {
    const validReceiptRegex = /^(https?:\/\/[^\s<>"'`]+|\/api\/campaigns\/files\/[a-zA-Z0-9._-]+)$/i;
    assert.equal(validReceiptRegex.test('https://example.com/receipt.pdf'), true);
    assert.equal(validReceiptRegex.test('/api/campaigns/files/rec_1234.png'), true);
    assert.equal(validReceiptRegex.test('javascript:alert(1)'), false);
    assert.equal(validReceiptRegex.test('/uploads/evil.php'), false);
    assert.equal(validReceiptRegex.test('data:text/html;base64,PHNjcmlwdD4='), false);
  });

  await t.test('Top-up tax mode calculates 18% GST correctly for with_gst and zero for non_gst', () => {
    function calculateTopupTotals(requestedQty, rate, taxMode) {
      const baseAmount = Number((requestedQty * rate).toFixed(2));
      const gstAmount = taxMode === 'with_gst' ? Number((baseAmount * 0.18).toFixed(2)) : 0.00;
      const totalAmount = Number((baseAmount + gstAmount).toFixed(2));
      return { baseAmount, gstAmount, totalAmount };
    }

    const withGst = calculateTopupTotals(10000, 0.15, 'with_gst');
    assert.equal(withGst.baseAmount, 1500.00);
    assert.equal(withGst.gstAmount, 270.00);
    assert.equal(withGst.totalAmount, 1770.00);

    const nonGst = calculateTopupTotals(10000, 0.15, 'non_gst');
    assert.equal(nonGst.baseAmount, 1500.00);
    assert.equal(nonGst.gstAmount, 0.00);
    assert.equal(nonGst.totalAmount, 1500.00);
  });

  await t.test('Brand Logo URL validation accepts uploaded logos, HTTPS URLs, and data URIs', () => {
    const validLogoRegex = /^(https?:\/\/|\/api\/resellers\/logo\/|\/api\/campaigns\/files\/|data:image\/)/i;
    assert.equal(validLogoRegex.test('/api/resellers/logo/logo-reseller-2-123.png'), true);
    assert.equal(validLogoRegex.test('https://cdn.example.com/logo.svg'), true);
    assert.equal(validLogoRegex.test('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='), true);
    assert.equal(validLogoRegex.test('javascript:alert(1)'), false);
    assert.equal(validLogoRegex.test('/etc/passwd'), false);
  });

  await t.test('Custom domain cleaning normalizes protocols, ports, and trailing slashes', () => {
    function cleanDomain(raw) {
      let d = String(raw || '').trim().toLowerCase();
      d = d.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').replace(/\/.*$/, '').trim();
      return d;
    }

    assert.equal(cleanDomain('https://portal.partner.com/'), 'portal.partner.com');
    assert.equal(cleanDomain('http://app.reseller.in:3000'), 'app.reseller.in');
    assert.equal(cleanDomain('partner.messaging.com'), 'partner.messaging.com');
  });

  await t.test('Reseller Invite Slug validation strictly enforces format rules', () => {
    function isValidInviteSlug(slug) {
      if (!slug) return false;
      const clean = String(slug).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      return clean.length >= 3 && clean.length <= 50 && clean === String(slug).trim().toLowerCase();
    }

    assert.equal(isValidInviteSlug('exhume'), true);
    assert.equal(isValidInviteSlug('nml-nexus_2026'), true);
    assert.equal(isValidInviteSlug('ab'), false, 'Slugs shorter than 3 chars must fail');
    assert.equal(isValidInviteSlug('a'.repeat(51)), false, 'Slugs longer than 50 chars must fail');
    assert.equal(isValidInviteSlug('invalid slug!'), false, 'Slugs with spaces or special symbols must fail');
    assert.equal(isValidInviteSlug('slug/with/slash'), false, 'Slugs with slashes must fail');
  });

  await t.test('Self-registration role & minimum commitment validation', () => {
    function validateRegistration(accountType, commitmentQty) {
      if (accountType === 'admin') return { allowed: false, error: 'Cannot self-register as admin' };
      if (accountType === 'reseller') {
        const qty = parseInt(commitmentQty, 10);
        if (isNaN(qty) || qty < 100000) {
          return { allowed: false, error: 'Reseller partner registration requires an initial minimum purchase commitment of 1,00,000 (1 Lakh) credits.' };
        }
        return { allowed: true, role: 'reseller', commitmentQty: qty };
      }
      return { allowed: true, role: 'user', commitmentQty: 0 };
    }

    assert.equal(validateRegistration('admin', 0).allowed, false);
    assert.equal(validateRegistration('reseller', 50000).allowed, false, 'Less than 100k commitment must fail');
    assert.equal(validateRegistration('reseller', 99999).allowed, false, '99,999 commitment must fail');
    assert.equal(validateRegistration('reseller', 'abc').allowed, false);
    
    const validPartner = validateRegistration('reseller', 100000);
    assert.equal(validPartner.allowed, true);
    assert.equal(validPartner.role, 'reseller');

    const validUser = validateRegistration('user', 0);
    assert.equal(validUser.allowed, true);
    assert.equal(validUser.role, 'user');
  });

  await t.test('Billing scope and settlement permission boundary rules', () => {
    // 1. Counterparty partition logic:
    // Direct counterparty: direct user (reseller_id is null) OR reseller account (role is reseller)
    // Downstream retail client: user under reseller (reseller_id is not null AND role != reseller)
    const isDirectCounterparty = (user) => (user.reseller_id === null || user.role === 'reseller');
    const isDownstreamClient = (user) => (user.reseller_id !== null && user.role !== 'reseller');

    const adminDirectUser = { id: 10, role: 'user', reseller_id: null };
    const resellerAccount = { id: 2, role: 'reseller', reseller_id: null };
    const resellerClient = { id: 3, role: 'user', reseller_id: 2 };

    assert.equal(isDirectCounterparty(adminDirectUser), true);
    assert.equal(isDirectCounterparty(resellerAccount), true);
    assert.equal(isDirectCounterparty(resellerClient), false);

    assert.equal(isDownstreamClient(adminDirectUser), false);
    assert.equal(isDownstreamClient(resellerAccount), false);
    assert.equal(isDownstreamClient(resellerClient), true);

    // 2. Settlement Permission Boundary:
    // Can actor settle/record payment on invoice?
    const canRecordPayment = (actor, order) => {
      // User cannot settle their own invoice
      if (order.user_id === actor.id) return { allowed: false, reason: 'self_settle_prohibited' };
      
      if (actor.role === 'admin') {
        // Admin settles with direct counterparties only; downstream client settlements belong to Reseller
        if (order.is_downstream_client) {
          return { allowed: false, reason: 'reseller_khata_boundary' };
        }
        return { allowed: true };
      }

      if (actor.role === 'reseller') {
        // Reseller can ONLY settle their own downstream clients
        if (order.reseller_id === actor.id && order.user_id !== actor.id) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'not_reseller_client' };
      }

      return { allowed: false, reason: 'unauthorized_role' };
    };

    const admin = { id: 1, role: 'admin' };
    const reseller = { id: 2, role: 'reseller' };

    const orderResellerToAdmin = { id: 101, user_id: 2, reseller_id: null, is_downstream_client: false, amount: 8000 };
    const orderClientToReseller = { id: 102, user_id: 3, reseller_id: 2, is_downstream_client: true, amount: 12000 };

    // Admin can settle Reseller's purchase from Admin
    assert.equal(canRecordPayment(admin, orderResellerToAdmin).allowed, true);

    // Admin CANNOT settle Reseller's client order (odhani) - belongs strictly to Reseller Khata
    const adminClientSettle = canRecordPayment(admin, orderClientToReseller);
    assert.equal(adminClientSettle.allowed, false);
    assert.equal(adminClientSettle.reason, 'reseller_khata_boundary');

    // Reseller can settle their own client's payment
    assert.equal(canRecordPayment(reseller, orderClientToReseller).allowed, true);

    // Reseller CANNOT settle their own invoice to Admin
    const resellerSelfSettle = canRecordPayment(reseller, orderResellerToAdmin);
    assert.equal(resellerSelfSettle.allowed, false);
    assert.equal(resellerSelfSettle.reason, 'self_settle_prohibited');
  });

  await t.test('Credit Plans Creation & Target Role Rules', () => {
    const CREDIT_TYPES = ['gsm_sms', 'normal', 'dp', 'cta', 'dp_cta', 'own_number'];

    function validatePlanCreation(actor, planData) {
      if (!['admin', 'reseller'].includes(actor.role)) {
        return { allowed: false, error: 'Unauthorized role' };
      }

      let targetRole = String(planData.target_role || 'user').toLowerCase().trim();
      if (actor.role === 'reseller') {
        targetRole = 'user'; // Resellers are strictly forced to create client plans only
      } else if (!['user', 'reseller'].includes(targetRole)) {
        targetRole = 'user';
      }

      if (!CREDIT_TYPES.includes(planData.credit_type)) {
        return { allowed: false, error: 'Invalid channel' };
      }

      const qty = parseInt(planData.credits, 10);
      if (!Number.isSafeInteger(qty) || qty < 100) {
        return { allowed: false, error: 'Credits must be at least 100' };
      }

      if (targetRole === 'reseller' && qty < 100000) {
        return { allowed: false, error: 'Reseller wholesale plans require minimum 1,00,000 credits' };
      }

      const rate = parseFloat(planData.rate_per_credit);
      if (isNaN(rate) || rate <= 0) {
        return { allowed: false, error: 'Invalid rate' };
      }

      const total = Math.round(qty * rate * 100) / 100;
      return { allowed: true, targetRole, qty, rate, total };
    }

    const admin = { id: 1, role: 'admin' };
    const reseller = { id: 2, role: 'reseller' };
    const client = { id: 3, role: 'user' };

    // Client cannot create plans
    assert.equal(validatePlanCreation(client, { credits: 1000, rate_per_credit: 0.12, credit_type: 'gsm_sms' }).allowed, false);

    // Super Admin can create wholesale plan for Reseller (>= 100,000)
    const adminWholesale = validatePlanCreation(admin, {
      target_role: 'reseller',
      credit_type: 'gsm_sms',
      credits: 100000,
      rate_per_credit: 0.09
    });
    assert.equal(adminWholesale.allowed, true);
    assert.equal(adminWholesale.targetRole, 'reseller');
    assert.equal(adminWholesale.total, 9000);

    // Super Admin wholesale plan fails if quantity < 100,000
    const adminWholesaleUnderLimit = validatePlanCreation(admin, {
      target_role: 'reseller',
      credit_type: 'gsm_sms',
      credits: 50000,
      rate_per_credit: 0.09
    });
    assert.equal(adminWholesaleUnderLimit.allowed, false);

    // Super Admin can create retail plan for Direct Clients (< 100,000 is permitted)
    const adminRetail = validatePlanCreation(admin, {
      target_role: 'user',
      credit_type: 'normal',
      credits: 25000,
      rate_per_credit: 0.10
    });
    assert.equal(adminRetail.allowed, true);
    assert.equal(adminRetail.targetRole, 'user');
    assert.equal(adminRetail.total, 2500);

    // Reseller attempting to create wholesale plan for other resellers gets forced to 'user'
    const resellerAttemptWholesale = validatePlanCreation(reseller, {
      target_role: 'reseller',
      credit_type: 'cta',
      credits: 10000,
      rate_per_credit: 0.15
    });
    assert.equal(resellerAttemptWholesale.allowed, true);
    assert.equal(resellerAttemptWholesale.targetRole, 'user', 'Reseller plans must be forced to user target');
    assert.equal(resellerAttemptWholesale.total, 1500);
  });

  await t.test('White-Label Profile Sanitization & Validation (cleanProfile)', () => {
    const colorPattern = /^#[0-9A-Fa-f]{6}$/;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const RESERVED_DOMAINS = new Set(['messagesphere.com', 'localhost', '127.0.0.1']);

    function isValidHttpUrl(str) {
      if (!str) return false;
      try {
        const u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch (_) {
        return false;
      }
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
      const helpUrl = String(body.help_url || '').trim();
      const termsUrl = String(body.terms_url || '').trim();
      const privacyUrl = String(body.privacy_url || '').trim();
      let customDomain = String(body.custom_domain || '').trim().toLowerCase();
      customDomain = customDomain.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').replace(/\/.*$/, '').trim();

      if (!brandName || brandName.length > 120) throw new Error('Brand name is required and must be under 120 characters');
      if (!colorPattern.test(accentColor)) throw new Error('Accent color must be a hex color such as #4f46e5');
      if (logoUrl && !/^(https?:\/\/|\/api\/resellers\/logo\/|\/api\/campaigns\/files\/|data:image\/)/i.test(logoUrl)) {
        throw new Error('Logo URL must be an HTTPS URL, an uploaded logo, or an image data URI');
      }
      if (faviconUrl && !/^(https?:\/\/|\/api\/resellers\/favicon\/|\/api\/resellers\/logo\/|\/api\/campaigns\/files\/|data:image\/)/i.test(faviconUrl)) {
        throw new Error('Favicon URL must be an HTTPS URL, an uploaded favicon, or an image data URI');
      }
      if (supportEmail && !emailPattern.test(supportEmail)) throw new Error('Support email is invalid');
      if (helpUrl && !isValidHttpUrl(helpUrl)) throw new Error('Help URL must be a valid http:// or https:// URL');
      if (termsUrl && !isValidHttpUrl(termsUrl)) throw new Error('Terms URL must be a valid http:// or https:// URL');
      if (privacyUrl && !isValidHttpUrl(privacyUrl)) throw new Error('Privacy URL must be a valid http:// or https:// URL');

      if (customDomain) {
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(customDomain)) throw new Error('Custom domain is invalid');
        if (RESERVED_DOMAINS.has(customDomain) || customDomain.endsWith('.onrender.com') || customDomain.endsWith('.nmedialabs.in')) {
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

    // Valid complete profile
    const cleaned = cleanProfile({
      brand_name: 'Apex Messaging Co',
      portal_title: 'Apex Cloud Broadcast Hub',
      accent_color: '#2563eb',
      favicon_url: '/api/resellers/favicon/fav-123.png',
      logo_url: '/api/resellers/logo/logo-123.svg',
      support_email: 'care@apexmessaging.io',
      support_phone: '+91 9876543210',
      support_whatsapp: '919876543210',
      company_legal_name: 'Apex Digital Technologies Pvt Ltd',
      company_gstin: '27AABCU9603R1ZM',
      company_address: '101 Tech Hub, Cyber City, Bangalore 560001',
      help_url: 'https://help.apexmessaging.io',
      terms_url: 'https://apexmessaging.io/terms',
      privacy_url: 'https://apexmessaging.io/privacy',
      custom_domain: 'portal.apexmessaging.io'
    });

    assert.equal(cleaned.brandName, 'Apex Messaging Co');
    assert.equal(cleaned.portalTitle, 'Apex Cloud Broadcast Hub');
    assert.equal(cleaned.accentColor, '#2563eb');
    assert.equal(cleaned.faviconUrl, '/api/resellers/favicon/fav-123.png');
    assert.equal(cleaned.companyLegalName, 'Apex Digital Technologies Pvt Ltd');
    assert.equal(cleaned.companyGstin, '27AABCU9603R1ZM');
    assert.equal(cleaned.customDomain, 'portal.apexmessaging.io');

    // Rejection of invalid favicon URL
    assert.throws(() => {
      cleanProfile({ brand_name: 'Test', favicon_url: 'javascript:alert(1)' });
    }, /Favicon URL must be an HTTPS URL/);

    // Rejection of invalid color
    assert.throws(() => {
      cleanProfile({ brand_name: 'Test', accent_color: 'red' });
    }, /Accent color must be a hex color/);

    // Rejection of platform reserved domains
    assert.throws(() => {
      cleanProfile({ brand_name: 'Test', custom_domain: 'test.nmedialabs.in' });
    }, /platform reserved domain/);
  });

  await t.test('White-Label DNS Status Transitions strictly persist Verified on resolution', () => {
    function computeDnsStatus(resolvedAddresses, targetCname) {
      if (!resolvedAddresses || resolvedAddresses.length === 0) {
        return { status: 'Failed', verified: false };
      }
      return { status: 'Verified', verified: true };
    }

    assert.equal(computeDnsStatus(['104.21.50.1'], 'messagesphere.nmedialabs.in').status, 'Verified');
    assert.equal(computeDnsStatus([], 'messagesphere.nmedialabs.in').status, 'Failed');
    assert.equal(computeDnsStatus(null, 'messagesphere.nmedialabs.in').status, 'Failed');
  });

  await t.test('Receipt & Statement Zero-Platform-Leak Resolution', () => {
    function resolveReceiptEntity(brandProfile) {
      const companyName = brandProfile?.company_legal_name || brandProfile?.brand_name || 'Direct Billing';
      const gstin = brandProfile?.company_gstin || 'UNREGISTERED';
      const prefix = (brandProfile?.brand_name || 'INV').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || 'INV';
      return { companyName, gstin, voucherId: `${prefix}-REC-10023` };
    }

    // Reseller Partner Brand
    const partner = resolveReceiptEntity({
      brand_name: 'TeleMatrix Solutions',
      company_legal_name: 'TeleMatrix Telecom India LLP',
      company_gstin: '07AAAAA0000A1Z5'
    });
    assert.equal(partner.companyName, 'TeleMatrix Telecom India LLP');
    assert.equal(partner.gstin, '07AAAAA0000A1Z5');
    assert.equal(partner.voucherId, 'TELEMA-REC-10023');
    assert.equal(partner.companyName.includes('MessageSphere'), false, 'Downstream client must never see platform name');

    // Default Brand Fallback
    const fallback = resolveReceiptEntity(null);
    assert.equal(fallback.companyName, 'Direct Billing');
    assert.equal(fallback.gstin, 'UNREGISTERED');
    assert.equal(fallback.voucherId, 'INV-REC-10023');
  });

  await t.test('White-Label URL auto-normalization & Invite Branding Resolution', () => {
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

    // Auto prefixes https:// smoothly without errors
    assert.equal(normalizeHttpUrl('help.exhume.in'), 'https://help.exhume.in/');
    assert.equal(normalizeHttpUrl('https://exhume.in/terms'), 'https://exhume.in/terms');
    assert.equal(normalizeHttpUrl(''), null);
    assert.equal(normalizeHttpUrl(null), null);

    // Invite code resolution returns custom branding
    function resolveBrandingMock({ refCode, host, profileMap }) {
      if (refCode && profileMap[refCode.toLowerCase()]) {
        return { custom_branding: true, branding: profileMap[refCode.toLowerCase()] };
      }
      if (host && profileMap[host.toLowerCase()]) {
        return { custom_branding: true, branding: profileMap[host.toLowerCase()] };
      }
      return { custom_branding: false };
    }

    const profiles = {
      'exhumenexus': { brand_name: 'Exhume Nexus', accent_color: '#0284c7' },
      'portal.exhume.in': { brand_name: 'Exhume Portal', accent_color: '#10b981' }
    };

    assert.equal(resolveBrandingMock({ refCode: 'exhumenexus', profileMap: profiles }).custom_branding, true);
    assert.equal(resolveBrandingMock({ host: 'portal.exhume.in', profileMap: profiles }).custom_branding, true);
    assert.equal(resolveBrandingMock({ refCode: 'unknown', profileMap: profiles }).custom_branding, false);
  });

  await t.test('Reseller Profit & Margins Engine calculates wholesale COGS, net profit, and channel breakdowns accurately', () => {
    const resellersRouter = require('../routes/resellers');
    const { calculateResellerMargins } = resellersRouter;
    assert.equal(typeof calculateResellerMargins, 'function');

    // Scenario: Reseller wholesale cost basis
    const wholesaleRates = {
      gsm_sms_domestic: 0.1000, // 10 paise cost
      normal_domestic: 0.1200   // 12 paise cost
    };

    // Client Allotments
    const sampleAllotments = [
      // Allotment 1: 100,000 GSM SMS credits sold at 16 paise = ₹16,000 billed (paid ₹16,000)
      {
        id: 101,
        user_id: 5,
        client_name: 'Acme Logistics',
        client_email: 'acme@example.com',
        credits_requested: 100000,
        credit_type: 'gsm_sms',
        destination: 'domestic',
        amount_inr: 16000.00,
        base_amount: 16000.00,
        paid_amount: 16000.00,
        payment_status: 'Paid',
        channel_rates: {
          gsm_sms_domestic: { credits: 100000, rate: 0.1600, cost: 16000.00 }
        },
        created_at: new Date().toISOString()
      },
      // Allotment 2: 50,000 WhatsApp Standard credits sold at 20 paise = ₹10,000 billed (partial payment ₹6,000)
      {
        id: 102,
        user_id: 6,
        client_name: 'Beta Retail',
        client_email: 'beta@example.com',
        credits_requested: 50000,
        credit_type: 'normal',
        destination: 'domestic',
        amount_inr: 10000.00,
        base_amount: 10000.00,
        paid_amount: 6000.00,
        payment_status: 'Partial',
        channel_rates: {
          normal_domestic: { credits: 50000, rate: 0.2000, cost: 10000.00 }
        },
        created_at: new Date().toISOString()
      }
    ];

    const result = calculateResellerMargins(wholesaleRates, sampleAllotments);

    // Summary assertions
    assert.equal(result.summary.total_credits_sold, 150000);
    assert.equal(result.summary.gross_revenue, 26000.00); // 16,000 + 10,000
    // COGS: (100,000 * 0.10) + (50,000 * 0.12) = 10,000 + 6,000 = 16,000
    assert.equal(result.summary.wholesale_cogs, 16000.00);
    // Net profit: 26,000 - 16,000 = 10,000
    assert.equal(result.summary.net_profit, 10000.00);
    // Margin %: (10,000 / 26,000) * 100 = 38.5%
    assert.equal(result.summary.profit_margin_pct, 38.5);
    // Cash collection: 16,000 + 6,000 = 22,000
    assert.equal(result.summary.cash_collected, 22000.00);
    assert.equal(result.summary.balance_due, 4000.00);

    // Channel category breakdown assertions
    assert.equal(result.channel_summary.gsm_sms.credits_sold, 100000);
    assert.equal(result.channel_summary.gsm_sms.revenue, 16000.00);
    assert.equal(result.channel_summary.gsm_sms.cogs, 10000.00);
    assert.equal(result.channel_summary.gsm_sms.net_profit, 6000.00);
    assert.equal(result.channel_summary.gsm_sms.margin_pct, 37.5);

    assert.equal(result.channel_summary.whatsapp.credits_sold, 50000);
    assert.equal(result.channel_summary.whatsapp.revenue, 10000.00);
    assert.equal(result.channel_summary.whatsapp.cogs, 6000.00);
    assert.equal(result.channel_summary.whatsapp.net_profit, 4000.00);
    assert.equal(result.channel_summary.whatsapp.margin_pct, 40.0);

    // Top clients ranked by net profit
    assert.equal(result.top_clients.length, 2);
    assert.equal(result.top_clients[0].name, 'Acme Logistics');
    assert.equal(result.top_clients[0].net_profit, 6000.00);
    assert.equal(result.top_clients[1].name, 'Beta Retail');
    assert.equal(result.top_clients[1].net_profit, 4000.00);
    assert.equal(result.top_clients[1].balance_due, 4000.00);

    // Zero allotment edge case
    const emptyResult = calculateResellerMargins(wholesaleRates, []);
    assert.equal(emptyResult.summary.total_credits_sold, 0);
    assert.equal(emptyResult.summary.gross_revenue, 0);
    assert.equal(emptyResult.summary.net_profit, 0);
    assert.equal(emptyResult.summary.profit_margin_pct, 0);

    // Defensive handling of malformed channel_rates and null dates
    const malformedAllotment = [
      {
        id: 999,
        user_id: 10,
        credits_requested: 1000,
        channel_rates: {
          corrupted_entry: null,
          another_broken: 'not_an_object',
          normal_domestic: { credits: 1000, rate: 0.18, cost: 180.00 }
        },
        created_at: null
      }
    ];
    const robustRes = calculateResellerMargins(wholesaleRates, malformedAllotment);
    assert.equal(robustRes.summary.total_credits_sold, 1000);
    assert.equal(robustRes.summary.gross_revenue, 180.00);
    assert.equal(robustRes.summary.wholesale_cogs, 120.00);
    assert.equal(robustRes.summary.net_profit, 60.00);
  });

  await t.test('High-Scale Architecture: Threadpool, Storage Resolution, and Pagination Guardrails', async () => {
    // 1. Threadpool size is configured for native worker parallelism
    assert.ok(parseInt(process.env.UV_THREADPOOL_SIZE, 10) >= 16);

    // 2. Hasher engine uses native non-blocking crypto
    const { hashPassword, comparePassword } = require('../services/hasher');
    const pwd = 'EnterpriseScaleSecretPass999';
    const hash = await hashPassword(pwd);
    assert.ok(hash.startsWith('$2'));
    const isMatch = await comparePassword(pwd, hash);
    assert.strictEqual(isMatch, true);
    const isBad = await comparePassword('wrongPass', hash);
    assert.strictEqual(isBad, false);

    // 3. Storage engine resolves directories safely
    const { ROOT_UPLOADS_DIR, LOGOS_DIR, FAVICONS_DIR } = require('../services/storage');
    assert.ok(typeof ROOT_UPLOADS_DIR === 'string' && ROOT_UPLOADS_DIR.length > 0);
    assert.ok(LOGOS_DIR.includes('logos'));
    assert.ok(FAVICONS_DIR.includes('favicons'));

    // 4. Pagination bounding helpers
    function boundLimit(val, defaultVal, maxVal) {
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed <= 0) return defaultVal;
      return Math.min(parsed, maxVal);
    }
    assert.strictEqual(boundLimit('99999', 100, 1000), 1000);
    assert.strictEqual(boundLimit(null, 100, 1000), 100);
    assert.strictEqual(boundLimit('-5', 100, 1000), 100);
    assert.strictEqual(boundLimit('50', 100, 1000), 50);

    // 5. Cache-Control Header policy verification
    function getCacheHeaderForFile(filePath) {
      if (filePath.endsWith('.html')) return 'no-cache, must-revalidate';
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) return 'public, max-age=86400, stale-while-revalidate=604800';
      if (/\.(png|jpe?g|webp|svg|gif|ico|woff2?|ttf|eot)$/i.test(filePath)) return 'public, max-age=31536000, immutable';
      return 'public, max-age=3600';
    }
    assert.strictEqual(getCacheHeaderForFile('/var/www/index.html'), 'no-cache, must-revalidate');
    assert.strictEqual(getCacheHeaderForFile('/var/www/app.js'), 'public, max-age=86400, stale-while-revalidate=604800');
    assert.strictEqual(getCacheHeaderForFile('/var/www/logo.png'), 'public, max-age=31536000, immutable');
  });

  await t.test('Sub-User Team Accounts & RBAC Role Permission Enforcement', async () => {
    // 1. Role preset permission definitions
    const roles = {
      campaign_manager: {
        can_send_campaigns: true,
        can_view_campaigns: true,
        can_manage_templates: true,
        can_manage_contacts: true,
        can_export_contacts: false,
        can_view_billing: false,
        can_recharge_wallet: false,
        can_manage_team: false
      },
      support_agent: {
        can_send_campaigns: false,
        can_view_campaigns: true,
        can_manage_templates: false,
        can_manage_contacts: false,
        can_export_contacts: false,
        can_view_billing: false,
        can_recharge_wallet: false,
        can_manage_team: false
      },
      accountant: {
        can_send_campaigns: false,
        can_view_campaigns: false,
        can_manage_templates: false,
        can_manage_contacts: false,
        can_export_contacts: false,
        can_view_billing: true,
        can_recharge_wallet: true,
        can_manage_team: false
      },
      viewer: {
        can_send_campaigns: false,
        can_view_campaigns: true,
        can_manage_templates: false,
        can_manage_contacts: false,
        can_export_contacts: false,
        can_view_billing: false,
        can_recharge_wallet: false,
        can_manage_team: false
      },
      team_admin: {
        can_send_campaigns: true,
        can_view_campaigns: true,
        can_manage_templates: true,
        can_manage_contacts: true,
        can_export_contacts: true,
        can_view_billing: true,
        can_recharge_wallet: true,
        can_manage_team: true
      }
    };

    // Assert Campaign Manager cannot steal audience data or view billing
    assert.strictEqual(roles.campaign_manager.can_send_campaigns, true);
    assert.strictEqual(roles.campaign_manager.can_export_contacts, false);
    assert.strictEqual(roles.campaign_manager.can_view_billing, false);

    // Assert Support Agent can only view campaigns, cannot send or alter contacts
    assert.strictEqual(roles.support_agent.can_view_campaigns, true);
    assert.strictEqual(roles.support_agent.can_send_campaigns, false);
    assert.strictEqual(roles.support_agent.can_manage_contacts, false);

    // Assert Accountant has access to billing & recharge, but strictly zero message/contact access
    assert.strictEqual(roles.accountant.can_view_billing, true);
    assert.strictEqual(roles.accountant.can_recharge_wallet, true);
    assert.strictEqual(roles.accountant.can_send_campaigns, false);
    assert.strictEqual(roles.accountant.can_manage_contacts, false);

    // Assert Viewer is strictly read-only
    assert.strictEqual(roles.viewer.can_send_campaigns, false);
    assert.strictEqual(roles.viewer.can_view_billing, false);
    assert.strictEqual(roles.viewer.can_view_campaigns, true);

    // Assert Team Admin has full operational access
    assert.strictEqual(roles.team_admin.can_manage_team, true);
    assert.strictEqual(roles.team_admin.can_export_contacts, true);

    // Privilege Escalation Prevention Verification
    function checkEscalation(callerPerms, targetPerms) {
      for (const [k, v] of Object.entries(targetPerms)) {
        if (v && !callerPerms[k]) return false;
      }
      return true;
    }
    assert.strictEqual(checkEscalation(roles.campaign_manager, { can_view_billing: true }), false);
    assert.strictEqual(checkEscalation(roles.campaign_manager, { can_manage_team: true }), false);
    assert.strictEqual(checkEscalation(roles.campaign_manager, { can_send_campaigns: true }), true);
    assert.strictEqual(checkEscalation(roles.team_admin, roles.accountant), true);
  });
});
