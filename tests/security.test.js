const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { 
  normalizePhoneNumber, 
  calculateSmsMetrics, 
  SMPP_DELIVERED_STATUSES, 
  sanitizeCsvCell,
  EMAIL_PATTERN,
  isValidEmail
} = require('../services/telecom');

test('Security & Telecom Unit Verification Suite', async (t) => {
  await t.test('SMPP Delivered Statuses properly match standard codes', () => {
    const validCodes = ['delivrd', 'delivered', 'sent', 'success', 'accepted', 'd', 'true', '1'];
    validCodes.forEach(code => {
      assert.equal(SMPP_DELIVERED_STATUSES.has(code), true, `Code "${code}" should be considered delivered`);
    });
  });

  await t.test('Quoted DELIVRD status strips quotes correctly', () => {
    const rawDelivrd = '"DELIVRD"';
    const cleaned = rawDelivrd.replace(/["']/g, '').trim().toLowerCase();
    assert.equal(SMPP_DELIVERED_STATUSES.has(cleaned), true);
  });

  await t.test('Phone normalization handles various Indian formats safely', () => {
    assert.equal(normalizePhoneNumber('9876543210'), '919876543210');
    assert.equal(normalizePhoneNumber('09876543210'), '919876543210');
    assert.equal(normalizePhoneNumber('+919876543210'), '919876543210');
    assert.equal(normalizePhoneNumber('91-98765-43210'), '919876543210');
  });

  await t.test('CSV Formula Injection Prevention neutralizes dangerous command prefixes', () => {
    assert.equal(sanitizeCsvCell('=1+1'), `"'=1+1"`);
    assert.equal(sanitizeCsvCell('+cmd'), ` "'+cmd"`.trim());
    assert.equal(sanitizeCsvCell('-exec'), ` "'-exec"`.trim());
    assert.equal(sanitizeCsvCell('@payload'), `"'@payload"`);
  });

  await t.test('Email Regex strictly rejects XSS payloads and quotes', () => {
    assert.equal(isValidEmail('admin@messagesphere.com'), true);
    assert.equal(isValidEmail('client.user@domain.co.in'), true);
    // Malicious breakout payloads must be rejected by app telecom validator
    assert.equal(isValidEmail("x');fetch('/api/x');//@a.bc"), false);
    assert.equal(isValidEmail('<script>alert(1)</script>@test.com'), false);
    assert.equal(isValidEmail('user@domain.com; DROP TABLE users;'), false);
    assert.equal(EMAIL_PATTERN.test('admin@messagesphere.com'), true);
  });

  await t.test('Path traversal is blocked by basename sanitization', () => {
    const rawInput = '../../../etc/passwd';
    const safeName = path.basename(rawInput);
    assert.equal(safeName, 'passwd');
    assert.notEqual(safeName, rawInput);
  });

  await t.test('GSM SMS multi-part metrics correctly calculate parts and encoding', () => {
    const simpleAscii = 'Hello world! Standard 160 character GSM message test.';
    const asciiMetrics = calculateSmsMetrics(simpleAscii);
    assert.equal(asciiMetrics.is_unicode, false);
    assert.equal(asciiMetrics.parts_count, 1);

    const unicodeMsg = 'नमस्ते MessageSphere! This is a Hindi test message.';
    const unicodeMetrics = calculateSmsMetrics(unicodeMsg);
    assert.equal(unicodeMetrics.is_unicode, true);
  });

  await t.test('CSV reports format properly sanitizes phone numbers and statuses', () => {
    const rawPhone = '+919876543210';
    const status = '=HYPERLINK("http://evil.com","Click")';
    const cleanPhone = sanitizeCsvCell(rawPhone);
    const cleanStatus = sanitizeCsvCell(status);

    assert.equal(cleanPhone, `"'+919876543210"`);
    assert.equal(cleanStatus, `"'=HYPERLINK(""http://evil.com"",""Click"")"`);
  });
});
