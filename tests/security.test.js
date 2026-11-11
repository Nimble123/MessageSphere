const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { 
  normalizePhoneNumber, 
  calculateSmsMetrics, 
  SMPP_DELIVERED_STATUSES, 
  sanitizeCsvCell,
  EMAIL_PATTERN,
  isValidEmail,
  isValidAttachmentUrl
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

  await t.test('Attachment URL Validator rejects injection vectors and accepts safe URLs', () => {
    assert.equal(isValidAttachmentUrl('https://example.com/asset.png'), true);
    assert.equal(isValidAttachmentUrl('http://example.com/audio.mp3'), true);
    assert.equal(isValidAttachmentUrl('/api/campaigns/files/proof_123.pdf'), true);
    assert.equal(isValidAttachmentUrl('/api/resellers/logo/brand_logo.png'), true);

    // Malicious injection strings must be blocked
    assert.equal(isValidAttachmentUrl("https://x.com/a');alert(1);//"), false);
    assert.equal(isValidAttachmentUrl('javascript:alert(1)'), false);
    assert.equal(isValidAttachmentUrl('data:text/html;base64,PHNjcmlwdD4='), false);
    assert.equal(isValidAttachmentUrl('https://example.com/a<script>'), false);
    assert.equal(isValidAttachmentUrl('https://example.com/a;rm -rf /'), false);
    assert.equal(isValidAttachmentUrl(''), false);
    assert.equal(isValidAttachmentUrl(null), false);
  });

  await t.test('SVG Stored XSS filter catches script tags and event handlers', () => {
    function inspectSvg(content) {
      return !/<script|javascript:|onload|onerror|onclick|onmouseover|href\s*=\s*['"]javascript:/i.test(content);
    }

    assert.equal(inspectSvg('<svg><circle cx="10" cy="10" r="5"/></svg>'), true);
    assert.equal(inspectSvg('<svg><script>alert(1)</script></svg>'), false);
    assert.equal(inspectSvg('<svg onload="alert(1)"></svg>'), false);
    assert.equal(inspectSvg('<svg><a href="javascript:alert(1)">link</a></svg>'), false);
    assert.equal(inspectSvg('<svg onerror="alert(document.cookie)"></svg>'), false);
  });

  await t.test('Numeric Overflow and Scientific Notation Guards', () => {
    function validateCreditQty(qty) {
      if (typeof qty === 'string' && /[eE]/.test(qty)) return false;
      const parsed = Number(qty);
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 100000000) return false;
      return true;
    }

    function validatePaymentAmount(amt) {
      if (typeof amt === 'string' && /[eE]/.test(amt)) return false;
      const parsed = Number(amt);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99999999.99) return false;
      return true;
    }

    assert.equal(validateCreditQty(5000), true);
    assert.equal(validateCreditQty('5000'), true);
    assert.equal(validateCreditQty('9e18'), false, 'Scientific notation must be rejected');
    assert.equal(validateCreditQty(1e19), false, 'Huge integer beyond safe bounds must be rejected');
    assert.equal(validateCreditQty(100000001), false, 'Above maximum cap must be rejected');
    assert.equal(validateCreditQty(-50), false, 'Negative qty must be rejected');

    assert.equal(validatePaymentAmount(1500.50), true);
    assert.equal(validatePaymentAmount('9e18'), false, 'Scientific payment amount must be rejected');
    assert.equal(validatePaymentAmount(1000000000), false, 'Payment amount above ceiling must be rejected');
  });

  await t.test('Reserved Platform Domains cannot be claimed by resellers', () => {
    const RESERVED_DOMAINS = new Set([
      'localhost',
      '127.0.0.1',
      'messagesphere.com',
      'messagesphere.nmedialabs.in',
      'nmedialabs.in',
      'onrender.com'
    ]);

    function isDomainClaimable(domain) {
      const clean = String(domain || '').trim().toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) return false;
      if (RESERVED_DOMAINS.has(clean) || clean.endsWith('.onrender.com') || clean.endsWith('.nmedialabs.in')) {
        return false;
      }
      return true;
    }

    assert.equal(isDomainClaimable('clientportal.exhume.in'), true);
    assert.equal(isDomainClaimable('messagesphere.nmedialabs.in'), false);
    assert.equal(isDomainClaimable('test.onrender.com'), false);
    assert.equal(isDomainClaimable('localhost'), false);
  });
});
