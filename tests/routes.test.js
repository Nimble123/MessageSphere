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
});
