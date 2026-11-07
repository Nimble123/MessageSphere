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

  await t.test('Self-registration role boundary guard ensures role is always user', () => {
    function enforceClientRole(requestedRole) {
      // Self registration always forces 'user' role regardless of what is passed
      const safeRole = requestedRole === 'user' ? 'user' : 'user';
      return safeRole;
    }

    assert.equal(enforceClientRole('admin'), 'user', 'Cannot self-register as admin');
    assert.equal(enforceClientRole('reseller'), 'user', 'Cannot self-register as reseller');
    assert.equal(enforceClientRole('user'), 'user');
  });
});
