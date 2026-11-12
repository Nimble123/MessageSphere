const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { query, getClient } = require('../db');
const { authenticate } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { calculateSmsMetrics } = require('../services/telecom');

const MAX_SMS_RECIPIENTS = Number(process.env.MAX_CAMPAIGN_RECIPIENTS || 50000);

// ---------------------------------------------------------------------------
// Multer: CSV/TXT recipient file upload — 10 MB max, field name: recipients_file
// ---------------------------------------------------------------------------
const { ROOT_UPLOADS_DIR } = require('../services/storage');
const uploadDir = ROOT_UPLOADS_DIR;

const csvStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
  },
});

const csvUpload = multer({
  storage: csvStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.txt') {
      return cb(null, true);
    }
    cb(new Error('Only CSV or TXT files are allowed for recipient lists'));
  },
}).single('recipients_file');

// Wrap multer in a promise so we can use async/await and handle errors gracefully
function runCsvUpload(req, res) {
  return new Promise((resolve, reject) => {
    csvUpload(req, res, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Access control helper (mirrors campaigns.js pattern)
// ---------------------------------------------------------------------------
async function canAccessCampaign(req, campaign) {
  if (req.user.role === 'admin' || campaign.user_id === req.user.id) return true;
  if (req.user.role !== 'reseller') return false;
  const owner = await query('SELECT reseller_id FROM users WHERE id = $1', [campaign.user_id]);
  return owner.rows[0] && owner.rows[0].reseller_id === req.user.id;
}

// ---------------------------------------------------------------------------
// Batch insert recipients (5 000 rows per INSERT — keeps pg packet size sane)
// ---------------------------------------------------------------------------
async function batchInsertRecipients(client, campaignId, numbers) {
  const BATCH_SIZE = 10000;
  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    const chunk = numbers.slice(i, i + BATCH_SIZE);
    await client.query(
      `INSERT INTO campaign_recipients (campaign_id, phone_number, status)
       SELECT $1, unnest($2::text[]), 'Pending'`,
      [campaignId, chunk]
    );
  }
}

// ---------------------------------------------------------------------------
// Phone number parser — supports body text and CSV files
// ---------------------------------------------------------------------------

/**
 * Parse and normalise phone numbers from a raw string.
 * Splits on newlines and commas, deduplicates, and applies basic validation.
 *
 * @param {string}  raw          Raw newline/comma-separated number string
 * @param {boolean} isIntl       true = international (7–15 digits), false = Indian domestic
 * @returns {string[]}  Normalised, deduplicated phone number strings
 */
function parseNumbersFromText(raw, isIntl) {
  const lines = String(raw || '').split(/\r?\n|,/);
  const numberSet = new Set();

  lines.forEach((line) => {
    let str = line.trim();
    if (!str) return;

    // Expand scientific notation (e.g. 9.19876543210e11)
    if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(str)) {
      try {
        const numVal = Number(str);
        if (!isNaN(numVal) && isFinite(numVal)) {
          str = BigInt(Math.round(numVal)).toString();
        }
      } catch (e) {
        /* ignore */
      }
    }

    let cleaned = str.replace(/[^0-9]/g, '').trim();
    if (!cleaned) return;

    if (isIntl) {
      if (/^\d{7,15}$/.test(cleaned)) {
        numberSet.add(cleaned);
      }
    } else {
      if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
      if (/^[6-9]\d{9}$/.test(cleaned)) {
        numberSet.add('91' + cleaned);
      } else if (/^91[6-9]\d{9}$/.test(cleaned)) {
        numberSet.add(cleaned);
      }
    }
  });

  return Array.from(numberSet);
}

/**
 * Parse phone numbers from an uploaded CSV/TXT file using readline (streaming).
 * Handles optional header rows and multiple columns (phone assumed to be first).
 *
 * @param {string}  filePath  Absolute path to the uploaded file
 * @param {boolean} isIntl    true = international validation
 * @returns {Promise<string[]>}  Normalised, deduplicated phone numbers
 */
async function parseNumbersFromFile(filePath, isIntl) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const numberSet = new Set();
  let isFirstLine = true;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip header row if present
    if (isFirstLine) {
      isFirstLine = false;
      if (/^(phone|mobile|number|recipient|msisdn|contact)/i.test(trimmed)) continue;
    }

    // Support comma/tab/semicolon-separated values — phone is first column
    const firstCell = trimmed.split(/[,\t;]+/)[0].trim();
    if (!firstCell) continue;

    let str = firstCell;

    // Expand scientific notation
    if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(str)) {
      try {
        const numVal = Number(str);
        if (!isNaN(numVal) && isFinite(numVal)) {
          str = BigInt(Math.round(numVal)).toString();
        }
      } catch (e) {
        /* ignore */
      }
    }

    let cleaned = str.replace(/[^0-9]/g, '').trim();
    if (!cleaned) continue;

    if (isIntl) {
      if (/^\d{7,15}$/.test(cleaned)) {
        numberSet.add(cleaned);
      }
    } else {
      if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
      if (/^[6-9]\d{9}$/.test(cleaned)) {
        numberSet.add('91' + cleaned);
      } else if (/^91[6-9]\d{9}$/.test(cleaned)) {
        numberSet.add(cleaned);
      }
    }
  }

  return Array.from(numberSet);
}

// ===========================================================================
// POST /api/sms — Create SMS Campaign
// ===========================================================================
router.post('/', authenticate, async (req, res) => {
  // Parse multipart form including optional CSV recipient file
  try {
    await runCsvUpload(req, res);
  } catch (uploadErr) {
    return res.status(400).json({ error: uploadErr.message || 'File upload error' });
  }

  const uploadedFile = req.file || null;

  const {
    title,
    message,        // message body — also accept 'text' alias
    text,
    numbers: rawNumbers,
    scheduled_at,
    target_user_id,
  } = req.body;

  const messageText = String(message || text || '').trim();

  if (req.user.is_team_member && !req.user.permissions?.can_send_campaigns) {
    if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
    return res.status(403).json({ error: 'Permission Denied: Your assigned team role is not authorized to send SMS broadcasts.' });
  }

  // ------------------------------------------------------------------
  // Resolve effective user (proxy dispatch & team accounts support)
  // ------------------------------------------------------------------
  let effectiveUserId = req.user.effective_user_id || req.user.id;
  let targetUser = null;

  if (req.user.role === 'admin') {
    if (!target_user_id) {
      if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
      return res.status(400).json({
        error:
          'Target Account Required: Admin must select the target beneficiary account (target_user_id).',
      });
    }
    const targetQuery = await query(
      'SELECT id, email, role, reseller_id, is_blocked FROM users WHERE id = $1',
      [parseInt(target_user_id, 10)]
    );
    if (targetQuery.rows.length === 0) {
      if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
      return res.status(404).json({ error: 'Target user account does not exist.' });
    }
    targetUser = targetQuery.rows[0];
    if (targetUser.is_blocked) {
      if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
      return res.status(403).json({
        error: 'Target user account is suspended/blocked. Cannot create SMS campaign.',
      });
    }
    effectiveUserId = targetUser.id;
  } else if (req.user.role === 'reseller') {
    if (
      target_user_id &&
      String(target_user_id) !== 'self' &&
      parseInt(target_user_id, 10) !== req.user.id
    ) {
      const targetQuery = await query(
        'SELECT id, email, role, reseller_id, is_blocked FROM users WHERE id = $1',
        [parseInt(target_user_id, 10)]
      );
      if (targetQuery.rows.length === 0) {
        if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
        return res.status(404).json({ error: 'Target client account does not exist.' });
      }
      targetUser = targetQuery.rows[0];
      if (targetUser.reseller_id !== req.user.id) {
        if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
        return res
          .status(403)
          .json({ error: 'Permission denied: Can only dispatch on behalf of your own clients.' });
      }
      if (targetUser.is_blocked) {
        if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
        return res.status(403).json({ error: 'Target client account is suspended/blocked.' });
      }
      effectiveUserId = targetUser.id;
    }
  }

  // ------------------------------------------------------------------
  // Validate message text
  // ------------------------------------------------------------------
  if (!messageText) {
    if (uploadedFile) fs.unlink(uploadedFile.path, () => {});
    return res.status(400).json({ error: 'SMS message text is required.' });
  }

  // ------------------------------------------------------------------
  // Parse recipients: CSV file takes precedence over body field
  // ------------------------------------------------------------------
  // GSM Bulk SMS is exclusively Domestic
  const isIntl = false;
  const campaignDest = 'domestic';

  let rawNumberList = [];

  if (uploadedFile) {
    try {
      rawNumberList = await parseNumbersFromFile(uploadedFile.path, isIntl);
    } catch (parseErr) {
      console.error('SMS CSV parse error:', parseErr);
      fs.unlink(uploadedFile.path, () => {});
      return res.status(400).json({ error: 'Failed to read recipient file. Ensure it is a valid CSV or TXT.' });
    }
    // Clean up uploaded file — numbers are already in memory
    fs.unlink(uploadedFile.path, () => {});
  } else if (rawNumbers && String(rawNumbers).trim()) {
    rawNumberList = parseNumbersFromText(String(rawNumbers), isIntl);
  } else {
    return res.status(400).json({
      error: 'Recipients are required. Provide numbers in the "numbers" field or upload a CSV file.',
    });
  }

  // ------------------------------------------------------------------
  // DND / Blacklist filter (Indexed ANY query with robust digit normalization)
  // ------------------------------------------------------------------
  const candidateNumbers = Array.from(new Set(rawNumberList.map((n) => String(n).trim()).filter(Boolean)));
  const candidate10Digits = candidateNumbers.map((n) => n.slice(-10)).filter((n) => n.length === 10);

  const blacklistedRes = await query(
    `SELECT phone_number FROM blacklist
     WHERE (
       user_id IN ($1, $2) 
       OR user_id IS NULL 
       OR user_id IN (SELECT id FROM users WHERE role = 'admin')
       OR user_id IN (SELECT reseller_id FROM users WHERE id IN ($1, $2) AND reseller_id IS NOT NULL)
     )
     AND (
       phone_number = ANY($3::varchar[])
       OR RIGHT(phone_number, 10) = ANY($4::varchar[])
     )`,
    [req.user.id, effectiveUserId, candidateNumbers, candidate10Digits]
  );
  
  const blacklistedSet = new Set();
  blacklistedRes.rows.forEach((r) => {
    const raw = String(r.phone_number || '').trim();
    if (!raw) return;
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits) {
      blacklistedSet.add(digits);
      if (digits.length >= 10) {
        blacklistedSet.add(digits.slice(-10));
      }
    }
  });

  const validNumbers = [];
  let skippedBlacklisted = 0;

  rawNumberList.forEach((num) => {
    const digitsOnly = String(num || '').replace(/[^0-9]/g, '');
    const last10 = digitsOnly.slice(-10);
    if (blacklistedSet.has(num) || blacklistedSet.has(digitsOnly) || (last10.length === 10 && blacklistedSet.has(last10))) {
      skippedBlacklisted++;
    } else {
      validNumbers.push(num);
    }
  });

  const messageCount = validNumbers.length;

  if (messageCount === 0) {
    return res.status(400).json({
      error:
        skippedBlacklisted > 0
          ? `All submitted numbers (${skippedBlacklisted}) are in the DND Blacklist.`
          : 'No valid phone numbers found. Please check the format and try again.',
    });
  }

  if (messageCount > MAX_SMS_RECIPIENTS) {
    return res.status(400).json({
      error: `An SMS campaign may contain at most ${MAX_SMS_RECIPIENTS.toLocaleString()} unique recipients.`,
    });
  }

  // ------------------------------------------------------------------
  // Calculate SMS metrics (parts count drives credit cost)
  // ------------------------------------------------------------------
  const smsMetrics = calculateSmsMetrics(messageText);
  const partsPerMessage = smsMetrics.parts_count;
  const creditCost = partsPerMessage * messageCount; // total credits needed

  // ------------------------------------------------------------------
  // Build campaign title
  // ------------------------------------------------------------------
  const now = new Date();
  const autoTitle = `SMS_${campaignDest.toUpperCase()}_${now.toISOString().slice(0, 10).replace(/-/g, '')}_${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}`;
  const campaignTitle = title && String(title).trim() ? String(title).trim() : autoTitle;

  // ------------------------------------------------------------------
  // Validate scheduled_at
  // ------------------------------------------------------------------
  let scheduledDate = null;
  if (scheduled_at) {
    const parsedDate = new Date(scheduled_at);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduled_at date format. Please provide a valid ISO date/time string.' });
    }
    if (parsedDate <= new Date()) {
      return res.status(400).json({ error: 'scheduled_at must be a future date/time.' });
    }
    scheduledDate = parsedDate;
  }

  // ------------------------------------------------------------------
  // Atomic transaction: credit check → deduct → insert campaign + recipients
  // ------------------------------------------------------------------
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the credits row for this user + credit_type + destination
    const creditCheck = await client.query(
      `SELECT balance FROM user_credits
       WHERE user_id = $1 AND credit_type = $2 AND destination = $3
       FOR UPDATE`,
      [effectiveUserId, 'gsm_sms', campaignDest]
    );

    const currentBalance =
      creditCheck.rows.length > 0 ? parseInt(creditCheck.rows[0].balance, 10) : 0;

    if (currentBalance < creditCost) {
      await client.query('ROLLBACK');
      const accountNote =
        effectiveUserId !== req.user.id
          ? `Target account (${targetUser.email}) has insufficient credits`
          : 'Insufficient credits';
      return res.status(400).json({
        error: `${accountNote}. Required: ${creditCost} GSM SMS (${campaignDest}) credits [${messageCount} messages × ${partsPerMessage} part(s)], but only ${currentBalance} available.`,
      });
    }

    // Deduct credits
    await client.query(
      `UPDATE user_credits
       SET balance = balance - $1
       WHERE user_id = $2 AND credit_type = $3 AND destination = $4`,
      [creditCost, effectiveUserId, 'gsm_sms', campaignDest]
    );

    // Insert campaign record
    const insertCampaign = await client.query(
      `INSERT INTO campaigns
         (user_id, title, channel_type, campaign_type, destination, message_text, total_numbers, status, scheduled_at, attachments)
       VALUES ($1, $2, 'sms', 'gsm_sms', $3, $4, $5, 'Submitted', $6, '[]'::jsonb)
       RETURNING id, created_at, status`,
      [effectiveUserId, campaignTitle, campaignDest, messageText, messageCount, scheduledDate]
    );

    const campaignId = insertCampaign.rows[0].id;

    // Batch insert recipients
    await batchInsertRecipients(client, campaignId, validNumbers);

    // Credit transaction log
    const txReason =
      effectiveUserId !== req.user.id
        ? `Deduction for SMS campaign #${campaignId} (${campaignTitle}) [Created by ${req.user.role.toUpperCase()} on behalf of account]`
        : `Deduction for SMS campaign #${campaignId} (${campaignTitle})`;

    await client.query(
      `INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, direction, refund_campaign_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'debit', $7)`,
      [effectiveUserId, effectiveUserId, 'gsm_sms', campaignDest, creditCost, txReason, campaignId]
    );

    // Audit trail
    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'campaign',
      entityId: campaignId,
      action:
        effectiveUserId !== req.user.id
          ? 'sms_campaign_submitted_by_proxy'
          : 'sms_campaign_submitted',
      details: {
        totalNumbers: messageCount,
        partsPerMessage,
        creditCost,
        destination: campaignDest,
        isUnicode: smsMetrics.is_unicode,
        characterCount: smsMetrics.character_count,
        scheduledAt: scheduledDate,
        skippedBlacklisted,
        effectiveUserId,
        targetEmail: targetUser ? targetUser.email : req.user.email,
        proxyRole: req.user.role,
      },
    });

    // Scheduled campaign reminder for Admin/Reseller
    if (scheduledDate) {
      const creatorDisplay = targetUser
        ? `${targetUser.email} (via ${req.user.role.toUpperCase()})`
        : req.user.email;
      const schedFormatted = new Date(scheduledDate).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      await client.query(
        `INSERT INTO admin_reminders (campaign_id, title, message, scheduled_for, reminder_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          campaignId,
          `⏰ Scheduled SMS Campaign #${campaignId}: "${campaignTitle}"`,
          `Scheduled for dispatch on ${schedFormatted} by ${creatorDisplay}. Audience: ${messageCount.toLocaleString()} numbers.`,
          scheduledDate,
          'scheduled_sms_creation',
        ]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'SMS campaign created successfully!',
      id: campaignId,
      campaignId,
      status: 'Submitted',
      scheduled_at: scheduledDate,
      title: campaignTitle,
      messageCount,
      partsPerMessage,
      creditCost,
      destination: campaignDest,
      is_unicode: smsMetrics.is_unicode,
      character_count: smsMetrics.character_count,
      carrier_warning: smsMetrics.carrier_warning,
      skippedBlacklisted,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create SMS campaign error:', err);
    return res.status(500).json({ error: 'Failed to create SMS campaign' });
  } finally {
    client.release();
  }
});

// ===========================================================================
// GET /api/sms — List SMS campaigns
// ===========================================================================
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.is_team_member && !req.user.permissions?.can_view_campaigns) {
      return res.status(403).json({ error: 'Permission Denied: Your assigned team role cannot view campaigns.' });
    }
    const baseSelect = `
      SELECT c.*, 
        u.email AS owner_email,
        u.full_name AS owner_name,
        u.company_name AS owner_company,
        u.phone AS owner_phone,
        u.reseller_id,
        ru.email AS reseller_email,
        ru.full_name AS reseller_name,
        (SELECT details->>'reason'
         FROM audit_events
         WHERE entity_type = 'campaign' AND entity_id = c.id
           AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user')
         ORDER BY id DESC LIMIT 1) AS rejection_reason
      FROM campaigns c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN users ru ON u.reseller_id = ru.id
      WHERE (c.channel_type = 'sms' OR c.campaign_type = 'gsm_sms' OR c.channel_type ILIKE '%sms%' OR c.campaign_type ILIKE '%sms%')
    `;

    let sql = baseSelect;
    let params = [];

    if (req.user.role === 'admin') {
      const filterUserId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
      const filterResellerId = req.query.reseller_id ? parseInt(req.query.reseller_id, 10) : null;

      if (filterUserId && !isNaN(filterUserId)) {
        params.push(filterUserId);
        sql += ` AND c.user_id = $${params.length}`;
      } else if (filterResellerId && !isNaN(filterResellerId)) {
        params.push(filterResellerId);
        sql += ` AND (u.reseller_id = $${params.length} OR u.id = $${params.length})`;
      }
    } else if (req.user.role === 'reseller') {
      // Reseller sees own campaigns + their clients' campaigns
      params.push(req.user.id);
      sql += ` AND (c.user_id = $${params.length} OR u.reseller_id = $${params.length})`;

      const filterUserId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
      if (filterUserId && !isNaN(filterUserId)) {
        params.push(filterUserId);
        sql += ` AND c.user_id = $${params.length}`;
      }
    } else {
      // Regular user sees only their own (or team parent's)
      const targetUserId = req.user.effective_user_id || req.user.id;
      params.push(targetUserId);
      sql += ` AND c.user_id = $${params.length}`;
    }

    sql += ` ORDER BY c.created_at DESC`;

    const result = await query(sql, params);

    // Enrich rows with real computed SMS metrics, delivery rates & clean white-labeling
    const enriched = result.rows.map((c) => {
      const metrics = calculateSmsMetrics(c.message_text);
      const parts = metrics.parts_count || 1;
      const totalNums = parseInt(c.total_numbers, 10) || 0;
      const creditsUsed = totalNums * parts;
      const deliv = parseInt(c.delivered_count, 10) || 0;
      const failed = parseInt(c.failed_count, 10) || 0;
      const rate = totalNums > 0 && (deliv + failed > 0) ? Math.min(100, Math.round((deliv / totalNums) * 1000) / 10) : 0;

      const obj = {
        ...c,
        sms_parts: parts,
        credits_used: creditsUsed,
        delivery_rate: rate,
        is_unicode: metrics.is_unicode,
        character_count: metrics.character_count,
        carrier_warning: metrics.carrier_warning,
      };

      // Strict White-labeling: Mask reseller details for non-admins
      if (req.user.role !== 'admin') {
        delete obj.reseller_email;
        delete obj.reseller_name;
      }

      return obj;
    });

    return res.json(enriched);
  } catch (err) {
    console.error('List SMS campaigns error:', err);
    return res.status(500).json({ error: 'Failed to load SMS campaigns' });
  }
});


// ===========================================================================
// GET /api/sms/:id — Single SMS campaign detail with recipient count
// ===========================================================================
router.get('/:id', authenticate, async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  if (isNaN(campaignId)) return res.status(400).json({ error: 'Invalid campaign ID' });

  try {
    const campResult = await query(
      `SELECT c.*, u.email AS owner_email
       FROM campaigns c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = $1 AND (c.channel_type = 'sms' OR c.campaign_type = 'gsm_sms' OR c.channel_type ILIKE '%sms%' OR c.campaign_type ILIKE '%sms%')`,
      [campaignId]
    );

    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: 'SMS campaign not found' });
    }

    const campaign = campResult.rows[0];

    if (!(await canAccessCampaign(req, campaign))) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Recipient status breakdown
    const statsResult = await query(
      `SELECT status, COUNT(*) AS count
       FROM campaign_recipients
       WHERE campaign_id = $1
       GROUP BY status`,
      [campaignId]
    );
    const statusCounts = {};
    statsResult.rows.forEach((r) => {
      statusCounts[r.status] = parseInt(r.count, 10);
    });

    const recipientCount = Object.values(statusCounts).reduce((a, b) => a + b, 0);

    // Sample up to 200 recipients
    const recipientsResult = await query(
      `SELECT phone_number, status, updated_at
       FROM campaign_recipients
       WHERE campaign_id = $1
       ORDER BY id ASC
       LIMIT 200`,
      [campaignId]
    );

    return res.json({
      campaign,
      recipientCount,
      statusCounts,
      recipients: recipientsResult.rows,
    });
  } catch (err) {
    console.error('Get SMS campaign error:', err);
    return res.status(500).json({ error: 'Failed to load SMS campaign' });
  }
});

// ===========================================================================
// DELETE /api/sms/:id — Cancel & delete an SMS campaign (only if Submitted)
//   Refunds all deducted normal credits to the campaign owner.
// ===========================================================================
router.delete('/:id', authenticate, async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  if (isNaN(campaignId)) return res.status(400).json({ error: 'Invalid campaign ID' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const campResult = await client.query(
      `SELECT * FROM campaigns WHERE id = $1 AND (channel_type = 'sms' OR campaign_type = 'gsm_sms' OR channel_type ILIKE '%sms%' OR campaign_type ILIKE '%sms%') FOR UPDATE`,
      [campaignId]
    );

    if (campResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'SMS campaign not found' });
    }

    const campaign = campResult.rows[0];

    if (!(await canAccessCampaign(req, campaign))) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Permission denied: You can only cancel your own or managed client campaigns',
      });
    }

    if (campaign.status !== 'Submitted') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Cannot cancel campaign. Current status is '${campaign.status}'. Only 'Submitted' campaigns can be cancelled.`,
      });
    }

    // Calculate exact refund based on multi-part metrics and recipient count
    const metrics = calculateSmsMetrics(campaign.message_text);
    const computedRefund = (metrics.parts_count || 1) * (parseInt(campaign.total_numbers, 10) || 0);

    const txResult = await client.query(
      `SELECT ABS(amount) AS amount
       FROM credit_transactions
       WHERE to_user_id = $1 AND credit_type = 'gsm_sms' AND destination = $2
         AND refund_campaign_id = $3 AND direction = 'debit'
       ORDER BY id DESC LIMIT 1`,
      [campaign.user_id, campaign.destination, campaignId]
    );

    const refundAmount =
      txResult.rows.length > 0
        ? parseInt(txResult.rows[0].amount, 10)
        : computedRefund;

    const ownerRes = await client.query(
      `SELECT id, email, role, reseller_id, refund_destination FROM users WHERE id = $1`,
      [campaign.user_id]
    );
    const owner = ownerRes.rows[0];
    let refundRecipientId = campaign.user_id;
    let isRoutedToReseller = false;
    if (owner && owner.refund_destination === 'reseller' && owner.reseller_id) {
      refundRecipientId = owner.reseller_id;
      isRoutedToReseller = true;
    }

    if (refundAmount > 0) {
      await client.query(
        `INSERT INTO user_credits (user_id, credit_type, destination, balance)
         VALUES ($2, 'gsm_sms', $3, $1)
         ON CONFLICT (user_id, credit_type, destination)
         DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance`,
        [refundAmount, refundRecipientId, campaign.destination]
      );

      const refundReason = isRoutedToReseller
        ? `Refund for cancelled SMS campaign #${campaignId} ("${campaign.title}") of client ${owner ? owner.email : 'client'} (${refundAmount} credits)`
        : `Refund for cancelled SMS campaign #${campaignId} (${campaign.title})`;

      await client.query(
        `INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, tax_mode, base_amount, gst_amount, refund_client_email, refund_campaign_id, direction)
         VALUES ($1, $2, $3, $4, $5, $6, 'non_gst', 0.00, 0.00, $7, $8, 'refund')`,
        [
          req.user.id,
          refundRecipientId,
          'gsm_sms',
          campaign.destination,
          refundAmount,
          refundReason,
          owner ? owner.email : null,
          campaignId
        ]
      );
    }

    // Mark campaign as Rejected (canonical cancelled state) and record refund
    await client.query(
      `UPDATE campaigns SET status = 'Rejected', failed_refunded = TRUE WHERE id = $1`,
      [campaignId]
    );

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'campaign',
      entityId: campaignId,
      action: 'sms_campaign_cancelled_by_user',
      details: { refundedCredits: refundAmount, cancelledBy: req.user.role },
    });

    await client.query('COMMIT');

    return res.json({
      message: `SMS campaign #${campaignId} cancelled and ${refundAmount} credits refunded.`,
      refunded: refundAmount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cancel SMS campaign error:', err);
    return res.status(500).json({ error: 'Failed to cancel SMS campaign' });
  } finally {
    client.release();
  }
});

router.calculateSmsMetrics = calculateSmsMetrics;
module.exports = router;
