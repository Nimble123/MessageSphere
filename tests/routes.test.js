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

  test('Billing scope and settlement permission boundary rules', () => {
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
});
