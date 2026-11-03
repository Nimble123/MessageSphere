const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const archiver = require('archiver');
const { query, getClient } = require('../db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { calculateSmsMetrics } = require('./sms');
const MAX_CAMPAIGN_RECIPIENTS = Number(process.env.MAX_CAMPAIGN_RECIPIENTS || 50000);

// Setup multer storage for campaign attachments and reports
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
  }
});

const allowedExtensions = {
  dp_file: ['.jpg', '.jpeg', '.png'],
  image_1: ['.jpg', '.jpeg', '.png'], image_2: ['.jpg', '.jpeg', '.png'],
  image_3: ['.jpg', '.jpeg', '.png'], image_4: ['.jpg', '.jpeg', '.png'],
  video_file: ['.mp4', '.mov', '.mkv', '.webm', '.avi'],
  pdf_file: ['.pdf'], cta_media_file: ['.jpg', '.jpeg', '.png', '.pdf', '.mp4', '.mov', '.mkv', '.webm']
};
const upload = multer({
  storage,
  limits: { fieldSize: 50 * 1024 * 1024, fileSize: 50 * 1024 * 1024, files: 15 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions[file.fieldname] || !allowedExtensions[file.fieldname].includes(ext)) {
      return cb(new Error('Unsupported upload type'));
    }
    cb(null, true);
  }
});
const reportUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(ext === '.csv' || ext === '.txt' ? null : new Error('Report must be a CSV or TXT file'), ext === '.csv' || ext === '.txt');
  }
});

const uploadFields = upload.fields([
  { name: 'dp_file', maxCount: 1 },
  { name: 'image_1', maxCount: 1 },
  { name: 'image_2', maxCount: 1 },
  { name: 'image_3', maxCount: 1 },
  { name: 'image_4', maxCount: 1 },
  { name: 'video_file', maxCount: 1 },
  { name: 'pdf_file', maxCount: 1 },
  { name: 'cta_media_file', maxCount: 1 }
]);

function removeUploadedFiles(files) {
  const values = Array.isArray(files) ? files : Object.values(files || {}).flat();
  values.forEach(file => { if (file && file.path) fs.unlink(file.path, () => {}); });
}

function buildFileUrl(filename) {
  return `/api/campaigns/files/${encodeURIComponent(filename)}`;
}

async function canAccessCampaign(req, campaign) {
  if (req.user.role === 'admin' || campaign.user_id === req.user.id) return true;
  if (req.user.role !== 'reseller') return false;
  const owner = await query('SELECT reseller_id FROM users WHERE id = $1', [campaign.user_id]);
  return owner.rows[0] && owner.rows[0].reseller_id === req.user.id;
}

// Helper to batch insert recipients
async function batchInsertRecipients(client, campaignId, numbers) {
  const BATCH_SIZE = 5000;
  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    const chunk = numbers.slice(i, i + BATCH_SIZE);
    const valuePlaceholders = [];
    const queryParams = [campaignId];

    chunk.forEach((phone, idx) => {
      valuePlaceholders.push(`($1, $${idx + 2}, 'Pending')`);
      queryParams.push(phone);
    });

    const insertSql = `
      INSERT INTO campaign_recipients (campaign_id, phone_number, status)
      VALUES ${valuePlaceholders.join(', ')}
    `;
    await client.query(insertSql, queryParams);
  }
}

// POST /api/campaigns - Create a new campaign with atomic credit deduction
router.post('/', authenticate, uploadFields, async (req, res) => {
  const { title, text, numbers: rawNumbers, destination, channel_type, scheduled_at, cta_data, sender_header, target_user_id } = req.body;
  const files = req.files || {};

  // Resolve Effective Account (Self vs On-Behalf-Of Proxy Dispatch)
  let effectiveUserId = req.user.id;
  let targetUser = null;

  if (req.user.role === 'admin') {
    if (!target_user_id) {
      removeUploadedFiles(files);
      return res.status(400).json({ 
        error: 'Target Account Required: Super Admin creates and dispatches campaigns on behalf of a specific User or Reseller. Please select the target beneficiary account.' 
      });
    }
    const targetQuery = await query(`
      SELECT id, email, role, reseller_id, is_blocked 
      FROM users 
      WHERE id = $1
    `, [parseInt(target_user_id, 10)]);

    if (targetQuery.rows.length === 0) {
      removeUploadedFiles(files);
      return res.status(404).json({ error: 'Selected target user account does not exist.' });
    }
    targetUser = targetQuery.rows[0];
    if (targetUser.is_blocked) {
      removeUploadedFiles(files);
      return res.status(403).json({ error: 'Target user account is suspended/blocked. Cannot dispatch campaign.' });
    }
    effectiveUserId = targetUser.id;
  } else if (req.user.role === 'reseller') {
    if (target_user_id && String(target_user_id) !== 'self' && parseInt(target_user_id, 10) !== req.user.id) {
      const targetQuery = await query(`
        SELECT id, email, role, reseller_id, is_blocked 
        FROM users 
        WHERE id = $1
      `, [parseInt(target_user_id, 10)]);

      if (targetQuery.rows.length === 0) {
        removeUploadedFiles(files);
        return res.status(404).json({ error: 'Selected target client account does not exist.' });
      }
      targetUser = targetQuery.rows[0];
      if (targetUser.reseller_id !== req.user.id) {
        removeUploadedFiles(files);
        return res.status(403).json({ error: 'Permission denied: Resellers can only dispatch campaigns on behalf of their own registered clients.' });
      }
      if (targetUser.is_blocked) {
        removeUploadedFiles(files);
        return res.status(403).json({ error: 'Target client account is suspended/blocked.' });
      }
      effectiveUserId = targetUser.id;
    }
  } else {
    // Regular Client / User: strictly self
    effectiveUserId = req.user.id;
  }

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Campaign message text is required' });
  }

  if (!rawNumbers || !rawNumbers.trim()) {
    return res.status(400).json({ error: 'Mobile numbers are required' });
  }

  // Process and validate attachments
  const attachments = [];
  function addAttachment(file, type, label) {
    attachments.push({
      type,
      label,
      url: buildFileUrl(file.filename),
      filename: file.originalname,
      size: file.size,
      mimetype: file.mimetype
    });
  }

  // 1. DP: Strictly JPEG or PNG, Max 3 MB
  if (files['dp_file'] && files['dp_file'][0]) {
    const dp = files['dp_file'][0];
    const ext = path.extname(dp.originalname).toLowerCase();
    const validMimes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validMimes.includes(dp.mimetype) && !['.jpg', '.jpeg', '.png'].includes(ext)) {
      return res.status(400).json({ error: 'DP file must be strictly a JPEG or PNG image.' });
    }
    if (dp.size > 3 * 1024 * 1024) {
      return res.status(400).json({ error: 'DP file exceeds maximum size of 3 MB.' });
    }
    addAttachment(dp, 'dp', 'Profile Picture (DP)');
  }

  // 2. Images 1-4: Strictly JPEG or PNG, Max 3 MB each
  for (let i = 1; i <= 4; i++) {
    const key = `image_${i}`;
    if (files[key] && files[key][0]) {
      const img = files[key][0];
      const ext = path.extname(img.originalname).toLowerCase();
      const validMimes = ['image/jpeg', 'image/jpg', 'image/png'];
      if (!validMimes.includes(img.mimetype) && !['.jpg', '.jpeg', '.png'].includes(ext)) {
        return res.status(400).json({ error: `Image ${i} must be strictly a JPEG or PNG image.` });
      }
      if (img.size > 3 * 1024 * 1024) {
        return res.status(400).json({ error: `Image ${i} exceeds maximum size of 3 MB.` });
      }
      addAttachment(img, 'image', `Gallery Image ${i}`);
    }
  }

  // 3. Video: Video file, Max 20 MB
  if (files['video_file'] && files['video_file'][0]) {
    const vid = files['video_file'][0];
    const ext = path.extname(vid.originalname).toLowerCase();
    const isVideo = vid.mimetype.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext);
    if (!isVideo) {
      return res.status(400).json({ error: 'Video file must be a valid video file (e.g. MP4).' });
    }
    if (vid.size > 20 * 1024 * 1024) {
      return res.status(400).json({ error: 'Video file exceeds maximum size of 20 MB.' });
    }
    addAttachment(vid, 'video', 'Campaign Video');
  }

  // 4. PDF: Document, Max 10 MB
  if (files['pdf_file'] && files['pdf_file'][0]) {
    const pdf = files['pdf_file'][0];
    const ext = path.extname(pdf.originalname).toLowerCase();
    if (pdf.mimetype !== 'application/pdf' && ext !== '.pdf') {
      return res.status(400).json({ error: 'Document must be a valid PDF file.' });
    }
    if (pdf.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'PDF file exceeds maximum size of 10 MB.' });
    }
    addAttachment(pdf, 'pdf', 'PDF Document');
  }

  // 5. CTA Media Attachment: Exactly 1 media (Image max 3MB, PDF max 10MB, Video max 20MB)
  if (files['cta_media_file'] && files['cta_media_file'][0]) {
    const ctaFile = files['cta_media_file'][0];
    const ext = path.extname(ctaFile.originalname).toLowerCase();
    const mime = ctaFile.mimetype;
    let ctaMediaType = 'unknown';

    if (mime === 'application/pdf' || ext === '.pdf') {
      ctaMediaType = 'pdf';
      if (ctaFile.size > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'CTA PDF attachment exceeds maximum size of 10 MB.' });
      }
    } else if (mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm'].includes(ext)) {
      ctaMediaType = 'video';
      if (ctaFile.size > 20 * 1024 * 1024) {
        return res.status(400).json({ error: 'CTA Video attachment exceeds maximum size of 20 MB.' });
      }
    } else if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png'].includes(ext)) {
      ctaMediaType = 'image';
      if (!['image/jpeg', 'image/jpg', 'image/png'].includes(mime) && !['.jpg', '.jpeg', '.png'].includes(ext)) {
        return res.status(400).json({ error: 'CTA Image attachment must be strictly JPEG or PNG.' });
      }
      if (ctaFile.size > 3 * 1024 * 1024) {
        return res.status(400).json({ error: 'CTA Image attachment exceeds maximum size of 3 MB.' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid CTA attachment format. Allowed: Image (JPEG/PNG max 3MB), PDF (max 10MB), or Video (max 20MB).' });
    }

    addAttachment(ctaFile, `cta_${ctaMediaType}`, `CTA Media (${ctaMediaType.toUpperCase()})`);
  }

  // Clean, format and normalize mobile numbers
  const lines = rawNumbers.split(/\r?\n|,/);
  const numberSet = new Set();
  const isIntl = (destination === 'international');

  lines.forEach(line => {
    let str = String(line).trim();
    if (!str) return;
    // Auto-expand scientific notation if present
    if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(str)) {
      try {
        const numVal = Number(str);
        if (!isNaN(numVal) && isFinite(numVal)) {
          str = BigInt(Math.round(numVal)).toString();
        }
      } catch(e) {}
    }
    let cleaned = str.replace(/[^0-9]/g, '').trim();
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

  // Query DND blacklist for user and exclude (includes global & admin-level blacklists + effective user + user's reseller)
  const blacklistedRes = await query(`
    SELECT phone_number FROM blacklist 
    WHERE user_id IN ($1, $2) 
       OR user_id IS NULL 
       OR user_id IN (SELECT id FROM users WHERE role = 'admin')
       OR user_id IN (SELECT reseller_id FROM users WHERE id IN ($1, $2) AND reseller_id IS NOT NULL)
  `, [req.user.id, effectiveUserId]);
  const blacklistedSet = new Set(blacklistedRes.rows.map(r => r.phone_number));
  
  const validNumbers = [];
  let skippedBlacklisted = 0;
  numberSet.forEach(num => {
    if (blacklistedSet.has(num)) {
      skippedBlacklisted++;
    } else {
      validNumbers.push(num);
    }
  });

  const uniqueNumbers = validNumbers;
  const messageCount = uniqueNumbers.length;
  if (messageCount === 0) {
    return res.status(400).json({ 
      error: skippedBlacklisted > 0 
        ? `All submitted numbers (${skippedBlacklisted}) are in your DND Blacklist.` 
        : 'Please provide at least one valid mobile number' 
    });
  }
  if (messageCount > MAX_CAMPAIGN_RECIPIENTS) {
    removeUploadedFiles(files);
    return res.status(400).json({ error: `A campaign may contain at most ${MAX_CAMPAIGN_RECIPIENTS.toLocaleString()} unique recipients.` });
  }

  const campaignDest = destination === 'international' ? 'international' : 'domestic';
  const campaignChannel = channel_type === 'own_number' ? 'own_number' : 'shared_gateway';

  // Parse CTA if present
  let parsedCta = null;
  let hasCta = false;
  if (cta_data) {
    try {
      parsedCta = typeof cta_data === 'string' ? JSON.parse(cta_data) : cta_data;
      if (parsedCta && (parsedCta.callText || parsedCta.urlText)) {
        hasCta = true;
      }
    } catch (e) {
      console.warn('CTA parse error:', e);
    }
  }

  // Determine campaign type and corresponding credit bucket
  const validCampaignTypes = ['normal', 'dp', 'cta', 'dp_cta', 'own_number'];
  let campaignType = 'normal';

  // Support pre-saved template attachment URL if no new files were uploaded
  const templateAttachmentUrl = (req.body.attachment_url && typeof req.body.attachment_url === 'string') ? req.body.attachment_url.trim() : null;
  if (templateAttachmentUrl && attachments.length === 0) {
    attachments.push({
      type: 'image',
      label: 'Template Media Banner',
      url: templateAttachmentUrl,
      filename: 'template_banner.jpg',
      size: 0,
      mimetype: 'image/jpeg'
    });
  }
  const hasAttachment = attachments.length > 0;
  
  if (req.body.campaign_type && validCampaignTypes.includes(req.body.campaign_type)) {
    campaignType = req.body.campaign_type;
  } else if (campaignChannel === 'own_number') {
    campaignType = 'own_number';
  } else {
    if (hasAttachment && hasCta) campaignType = 'dp_cta';
    else if (hasAttachment) campaignType = 'dp';
    else if (hasCta) campaignType = 'cta';
  }

  const attachmentUrl = attachments.length > 0 ? attachments[0].url : (templateAttachmentUrl || null);
  const now = new Date();
  const autoTitleFallback = `${(campaignType || 'CAMPAIGN').toUpperCase()}_${(destination === 'international' ? 'INTL' : 'DOM')}_${now.toISOString().slice(0, 10).replace(/-/g, '')}_${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}`;
  const campaignTitle = (title && title.trim()) ? title.trim() : autoTitleFallback;

  // Check scheduling
  let initialStatus = 'Submitted';
  let scheduledDate = null;
  if (scheduled_at) {
    const parsedDate = new Date(scheduled_at);
    if (!isNaN(parsedDate.getTime())) {
      if (parsedDate <= new Date()) {
        removeUploadedFiles(files);
        return res.status(400).json({ error: 'Scheduled time must be in the future.' });
      }
      scheduledDate = parsedDate;
      initialStatus = 'Submitted'; // Queued for scheduled dispatch
    }
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Lock effective user credits row for update (prevents race conditions)
    const creditCheck = await client.query(
      `SELECT balance FROM user_credits 
       WHERE user_id = $1 AND credit_type = $2 AND destination = $3 
       FOR UPDATE`,
      [effectiveUserId, campaignType, campaignDest]
    );

    const currentBalance = creditCheck.rows.length > 0 ? parseInt(creditCheck.rows[0].balance, 10) : 0;
    if (currentBalance < messageCount) {
      await client.query('ROLLBACK');
      removeUploadedFiles(files);
      const accountNotice = effectiveUserId !== req.user.id 
        ? `Target account (${targetUser.email}) has insufficient credits` 
        : 'Insufficient credits';
      return res.status(400).json({
        error: `${accountNotice}. Needed: ${messageCount} ${campaignType} (${campaignDest}) credits, but only has ${currentBalance}.`
      });
    }

    // 2. Deduct credits from effective user balance
    await client.query(
      `UPDATE user_credits 
       SET balance = balance - $1 
       WHERE user_id = $2 AND credit_type = $3 AND destination = $4`,
      [messageCount, effectiveUserId, campaignType, campaignDest]
    );

    // 3. Create campaign record with user_id = effectiveUserId
    const insertCampaign = await client.query(`
      INSERT INTO campaigns 
        (user_id, title, channel_type, scheduled_at, campaign_type, destination, message_text, total_numbers, status, attachment_url, attachments, cta_data, sender_header)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, created_at, status
    `, [
      effectiveUserId, 
      campaignTitle, 
      campaignChannel, 
      scheduledDate, 
      campaignType, 
      campaignDest, 
      text.trim(), 
      messageCount, 
      initialStatus, 
      attachmentUrl, 
      JSON.stringify(attachments),
      parsedCta ? JSON.stringify(parsedCta) : null, 
      sender_header ? sender_header.trim() : null
    ]);

    const campaignId = insertCampaign.rows[0].id;

    // 4. Batch insert recipients
    await batchInsertRecipients(client, campaignId, uniqueNumbers);

    // 5. Record credit transaction
    const txReason = effectiveUserId !== req.user.id
      ? `Deduction for campaign #${campaignId} (${campaignTitle}) [Created by ${req.user.role.toUpperCase()} on behalf of account]`
      : `Deduction for campaign #${campaignId} (${campaignTitle})`;

    await client.query(`
      INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [req.user.id, effectiveUserId, campaignType, campaignDest, messageCount, txReason]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'campaign',
      entityId: campaignId,
      action: effectiveUserId !== req.user.id ? 'campaign_submitted_by_proxy' : 'campaign_submitted',
      details: {
        totalNumbers: messageCount,
        campaignType,
        destination: campaignDest,
        scheduledAt: scheduledDate,
        skippedBlacklisted,
        effectiveUserId,
        targetEmail: targetUser ? targetUser.email : req.user.email,
        proxyRole: req.user.role
      }
    });

    // If campaign is scheduled, record reminder notification for Admin/Reseller
    if (scheduledDate) {
      const creatorDisplay = targetUser 
        ? `${targetUser.email} (via ${req.user.role.toUpperCase()})` 
        : req.user.email;
      const schedFormatted = new Date(scheduledDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      await client.query(`
        INSERT INTO admin_reminders (campaign_id, title, message, scheduled_for, reminder_type)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        campaignId,
        `⏰ Scheduled Campaign #${campaignId}: "${campaignTitle}"`,
        `Scheduled for dispatch on ${schedFormatted} by ${creatorDisplay}. Total audience: ${messageCount.toLocaleString()} numbers.`,
        scheduledDate,
        'scheduled_creation'
      ]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Campaign created successfully!',
      id: campaignId,
      campaignId,
      status: initialStatus,
      scheduled_at: scheduledDate,
      messageCount,
      title: campaignTitle,
      type: campaignType,
      destination: campaignDest
    });
  } catch (err) {
    await client.query('ROLLBACK');
    removeUploadedFiles(files);
    console.error('Create campaign error:', err);
    return res.status(500).json({ error: 'Failed to create campaign' });
  } finally {
    client.release();
  }
});

// GET /api/campaigns/reminders/active - Active admin/reseller scheduled reminders
router.get('/reminders/active', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    let sql = '';
    let params = [];

    if (req.user.role === 'admin') {
      sql = `
        SELECT r.*, c.title as campaign_title, c.status as campaign_status, c.total_numbers, u.email as owner_email
        FROM admin_reminders r
        JOIN campaigns c ON r.campaign_id = c.id
        JOIN users u ON c.user_id = u.id
        WHERE r.is_read = FALSE
        ORDER BY r.scheduled_for ASC
        LIMIT 50
      `;
    } else {
      sql = `
        SELECT r.*, c.title as campaign_title, c.status as campaign_status, c.total_numbers, u.email as owner_email
        FROM admin_reminders r
        JOIN campaigns c ON r.campaign_id = c.id
        JOIN users u ON c.user_id = u.id
        WHERE r.is_read = FALSE AND (c.user_id = $1 OR u.reseller_id = $1)
        ORDER BY r.scheduled_for ASC
        LIMIT 50
      `;
      params = [req.user.id];
    }

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('Fetch reminders error:', err);
    return res.status(500).json({ error: 'Failed to fetch scheduled reminders' });
  }
});

// POST /api/campaigns/reminders/:id/dismiss - Dismiss a single reminder
router.post('/reminders/:id/dismiss', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const reminderId = parseInt(req.params.id, 10);
  if (isNaN(reminderId)) return res.status(400).json({ error: 'Invalid reminder ID' });
  try {
    await query('UPDATE admin_reminders SET is_read = TRUE WHERE id = $1', [reminderId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to dismiss reminder' });
  }
});

// POST /api/campaigns/reminders/dismiss-all - Dismiss all active reminders
router.post('/reminders/dismiss-all', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      await query('UPDATE admin_reminders SET is_read = TRUE WHERE is_read = FALSE');
    } else {
      await query(`
        UPDATE admin_reminders SET is_read = TRUE 
        WHERE is_read = FALSE AND campaign_id IN (
          SELECT c.id FROM campaigns c JOIN users u ON c.user_id = u.id 
          WHERE c.user_id = $1 OR u.reseller_id = $1
        )
      `, [req.user.id]);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to dismiss reminders' });
  }
});

// GET /api/campaigns - List campaigns
router.get('/', authenticate, async (req, res) => {
  try {
    let listSql = '';
    let params = [];

    if (req.user.role === 'admin') {
      listSql = `
        SELECT c.*, u.email as owner_email,
          (SELECT action FROM audit_events WHERE entity_type = 'campaign' AND entity_id = c.id AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user') ORDER BY id DESC LIMIT 1) as rejection_action,
          (SELECT details->>'reason' FROM audit_events WHERE entity_type = 'campaign' AND entity_id = c.id AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user') ORDER BY id DESC LIMIT 1) as rejection_reason
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        ORDER BY c.created_at DESC
      `;
    } else if (req.user.role === 'reseller') {
      listSql = `
        SELECT c.*, u.email as owner_email,
          (SELECT action FROM audit_events WHERE entity_type = 'campaign' AND entity_id = c.id AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user') ORDER BY id DESC LIMIT 1) as rejection_action,
          (SELECT details->>'reason' FROM audit_events WHERE entity_type = 'campaign' AND entity_id = c.id AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user') ORDER BY id DESC LIMIT 1) as rejection_reason
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        WHERE c.user_id = $1 OR u.reseller_id = $1
        ORDER BY c.created_at DESC
      `;
      params = [req.user.id];
    } else {
      listSql = `
        SELECT c.*, u.email as owner_email,
          (SELECT action FROM audit_events WHERE entity_type = 'campaign' AND entity_id = c.id AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user') ORDER BY id DESC LIMIT 1) as rejection_action,
          (SELECT details->>'reason' FROM audit_events WHERE entity_type = 'campaign' AND entity_id = c.id AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user') ORDER BY id DESC LIMIT 1) as rejection_reason
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        WHERE c.user_id = $1
        ORDER BY c.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await query(listSql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('List campaigns error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/campaigns/:id - Detailed Campaign View
router.get('/:id', authenticate, async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  if (isNaN(campaignId)) return res.status(400).json({ error: 'Invalid campaign ID' });

  try {
    const campResult = await query(`
      SELECT c.*, u.email as owner_email,
        (SELECT action FROM audit_events WHERE entity_type = 'campaign' AND entity_id = c.id AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user') ORDER BY id DESC LIMIT 1) as rejection_action,
        (SELECT details->>'reason' FROM audit_events WHERE entity_type = 'campaign' AND entity_id = c.id AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user') ORDER BY id DESC LIMIT 1) as rejection_reason
      FROM campaigns c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.id = $1
    `, [campaignId]);

    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campResult.rows[0];
    if (typeof campaign.attachments === 'string') {
      try {
        campaign.attachments = JSON.parse(campaign.attachments);
      } catch (e) {
        campaign.attachments = [];
      }
    } else if (!campaign.attachments) {
      campaign.attachments = [];
    }

    if (!(await canAccessCampaign(req, campaign))) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Get sample recipients (up to 200)
    const recipientsResult = await query(`
      SELECT phone_number, status, updated_at 
      FROM campaign_recipients 
      WHERE campaign_id = $1 
      ORDER BY id ASC 
      LIMIT 200
    `, [campaignId]);

    // Recipient counts by status
    const statsResult = await query(`
      SELECT status, COUNT(*) as count 
      FROM campaign_recipients 
      WHERE campaign_id = $1 
      GROUP BY status
    `, [campaignId]);

    const statusCounts = {};
    statsResult.rows.forEach(r => { statusCounts[r.status] = parseInt(r.count, 10); });

    return res.json({
      campaign,
      statusCounts,
      recipients: recipientsResult.rows
    });
  } catch (err) {
    console.error('Get campaign details error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/campaigns/files/:filename - authenticated download of a campaign asset.
// Files are never exposed through a public static directory.
router.get('/files/:filename', authenticate, async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename || filename !== req.params.filename) return res.status(400).json({ error: 'Invalid file name' });
  try {
    const result = await query(
      `SELECT * FROM campaigns
       WHERE attachments::text LIKE $1 OR attachment_url LIKE $2
       ORDER BY id DESC LIMIT 1`,
      [`%${filename}%`, `%${filename}`]
    );
    if (result.rows.length === 0 || !(await canAccessCampaign(req, result.rows[0]))) {
      return res.status(404).json({ error: 'File not found' });
    }
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[\r\n"]/g, '_')}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.sendFile(filePath);
  } catch (err) {
    console.error('Download asset error:', err);
    return res.status(500).json({ error: 'Failed to download file' });
  }
});

// GET /api/campaigns/:id/export - Download Delivery Report CSV
router.get('/:id/export', authenticate, async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  if (isNaN(campaignId)) return res.status(400).json({ error: 'Invalid campaign ID' });

  try {
    const campResult = await query(`SELECT user_id, title FROM campaigns WHERE id = $1`, [campaignId]);
    if (campResult.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });

    const campaign = campResult.rows[0];
    if (!(await canAccessCampaign(req, campaign))) {
      return res.status(403).json({ error: 'Permission denied: Cannot export report for another account' });
    }

    const recipients = await query(`
      SELECT phone_number, status, updated_at 
      FROM campaign_recipients 
      WHERE campaign_id = $1 
      ORDER BY id ASC
    `, [campaignId]);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="campaign_${campaignId}_report.csv"`);

    let csvContent = 'Phone Number,Status,Timestamp\n';
    recipients.rows.forEach(r => {
      csvContent += `${r.phone_number},${r.status},${new Date(r.updated_at).toISOString()}\n`;
    });

    return res.send(csvContent);
  } catch (err) {
    console.error('Export report error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/campaigns/:id/export-numbers - Download Clean Numbers Only (TXT or CSV)
router.get('/:id/export-numbers', authenticate, async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const format = req.query.format || 'txt';
  if (isNaN(campaignId)) return res.status(400).json({ error: 'Invalid campaign ID' });

  try {
    const campResult = await query(`SELECT user_id, title, message_text FROM campaigns WHERE id = $1`, [campaignId]);
    if (campResult.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });

    const campaign = campResult.rows[0];
    if (!(await canAccessCampaign(req, campaign))) {
      return res.status(403).json({ error: 'Permission denied: Cannot export audience numbers for this campaign' });
    }

    const auditClient = await getClient();
    try {
      await auditClient.query('BEGIN');
      await logAudit(auditClient, {
        actorId: req.user.id,
        entityType: 'campaign',
        entityId: campaignId,
        action: 'recipient_exported_for_manual_dispatch',
        details: { format }
      });
      await auditClient.query('COMMIT');
    } catch (auditErr) {
      await auditClient.query('ROLLBACK');
      return res.status(500).json({ error: 'Could not record export audit event' });
    } finally {
      auditClient.release();
    }

    const recipients = await query(`
      SELECT phone_number 
      FROM campaign_recipients 
      WHERE campaign_id = $1 
      ORDER BY id ASC
    `, [campaignId]);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="campaign_${campaignId}_numbers.csv"`);
      let csvContent = 'Mobile Number\n';
      recipients.rows.forEach(r => { csvContent += `${r.phone_number}\n`; });
      return res.send(csvContent);
    } else {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="campaign_${campaignId}_numbers.txt"`);
      let txtContent = recipients.rows.map(r => r.phone_number).join('\n');
      return res.send(txtContent);
    }
  } catch (err) {
    console.error('Export numbers error:', err);
    return res.status(500).json({ error: 'Failed to export numbers' });
  }
});

// PATCH /api/campaigns/:id/status - Explicit manual workflow transitions only.
router.patch('/:id/status', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const { status, reason, external_reference: externalReference } = req.body;

  const validStatuses = ['Approved', 'Rejected', 'Completed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required for every manual campaign status change' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const campaignResult = await client.query(
      `SELECT * FROM campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId]
    );

    if (campaignResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campaignResult.rows[0];
    if (!(await canAccessCampaign(req, campaign))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: Cannot update campaign for another account' });
    }

    const previousStatus = campaign.status;

    const allowedTransitions = {
      Submitted: ['Approved', 'Rejected'],
      Approved: ['Completed', 'Rejected']
    };
    if (!allowedTransitions[previousStatus] || !allowedTransitions[previousStatus].includes(status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot change a ${previousStatus} campaign to ${status}.` });
    }

    // Check if status is being updated to 'Rejected' and wasn't already rejected
    if (status === 'Rejected' && previousStatus !== 'Rejected') {
      const alreadyRefunded = campaign.failed_refunded ? (campaign.failed_count || 0) : 0;
      const refundAmount = Math.max(0, campaign.total_numbers - alreadyRefunded);
      if (refundAmount > 0) {
        // Auto-refund remaining credits to the user
        await client.query(`
          UPDATE user_credits 
          SET balance = balance + $1 
          WHERE user_id = $2 AND credit_type = $3 AND destination = $4
        `, [refundAmount, campaign.user_id, campaign.campaign_type, campaign.destination]);

        await client.query(`
          INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [req.user.id, campaign.user_id, campaign.campaign_type, campaign.destination, refundAmount, `Automatic refund for rejected campaign #${campaignId}`]);
      }
      await client.query(`UPDATE campaigns SET failed_refunded = TRUE WHERE id = $1`, [campaignId]);
    }

    await client.query(`UPDATE campaigns SET status = $1 WHERE id = $2`, [status, campaignId]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'campaign',
      entityId: campaignId,
      action: `status_changed_to_${status.toLowerCase()}`,
      details: { previousStatus, status, reason: String(reason).trim().slice(0, 1000), externalReference: String(externalReference || '').trim().slice(0, 255), manualDispatch: true }
    });

    await client.query('COMMIT');
    return res.json({ message: `Campaign status updated to ${status}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update campaign status error:', err);
    return res.status(500).json({ error: 'Failed to update campaign status' });
  } finally {
    client.release();
  }
});

// POST /api/campaigns/:id/cancel - Customer self-cancellation for 'Submitted' campaigns
router.post('/:id/cancel', authenticate, async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  if (isNaN(campaignId)) return res.status(400).json({ error: 'Invalid campaign ID' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const campResult = await client.query('SELECT * FROM campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    if (campResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaign = campResult.rows[0];

    // Check ownership (Admin, owner, or managing Reseller)
    if (!(await canAccessCampaign(req, campaign))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: You can only cancel your own or your managed client campaigns' });
    }

    if (campaign.status !== 'Submitted') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Cannot cancel campaign. Current status is '${campaign.status}'. Only 'Submitted' campaigns can be cancelled.` });
    }

    // 100% Refund credits to user (accounting for multi-part SMS if channel is SMS)
    let refundMultiplier = 1;
    if (campaign.channel_type === 'sms' && typeof calculateSmsMetrics === 'function') {
      const smsMetrics = calculateSmsMetrics(campaign.message_text);
      refundMultiplier = smsMetrics.parts_count || 1;
    }
    const refundCredits = (parseInt(campaign.total_numbers, 10) || 0) * refundMultiplier;

    await client.query(`
      UPDATE user_credits 
      SET balance = balance + $1 
      WHERE user_id = $2 AND credit_type = $3 AND destination = $4
    `, [refundCredits, campaign.user_id, campaign.campaign_type, campaign.destination]);

    await client.query(`
      INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [req.user.id, campaign.user_id, campaign.campaign_type, campaign.destination, refundCredits, `User self-cancellation for campaign #${campaignId} (${campaign.title})`]);

    await client.query(`UPDATE campaigns SET status = 'Rejected', failed_refunded = TRUE WHERE id = $1`, [campaignId]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'campaign',
      entityId: campaignId,
      action: 'campaign_cancelled_by_user',
      details: { refundedCredits: refundCredits, channelType: campaign.channel_type, partsMultiplier: refundMultiplier }
    });

    await client.query('COMMIT');
    return res.json({ message: `Campaign #${campaignId} cancelled and ${refundCredits} credits refunded to your wallet!`, refunded: refundCredits });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cancel campaign error:', err);
    return res.status(500).json({ error: 'Failed to cancel campaign' });
  } finally {
    client.release();
  }
});

router.get('/:id/notes', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  if (!Number.isInteger(campaignId)) return res.status(400).json({ error: 'Invalid campaign ID' });
  try {
    const exists = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const campaign = exists.rows[0];
    if (!(await canAccessCampaign(req, campaign))) {
      return res.status(403).json({ error: 'Permission denied: Cannot view notes for another account\'s campaign' });
    }
    const result = await query(`
      SELECT cn.*, u.email AS author_email
      FROM campaign_notes cn LEFT JOIN users u ON u.id = cn.author_id
      WHERE cn.campaign_id = $1 ORDER BY cn.created_at DESC
    `, [campaignId]);
    return res.json(result.rows);
  } catch (err) { return res.status(500).json({ error: 'Failed to load campaign notes' }); }
});

router.post('/:id/notes', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const note = String(req.body.note || '').trim();
  const externalReference = String(req.body.external_reference || '').trim();
  if (!Number.isInteger(campaignId) || !note) return res.status(400).json({ error: 'A campaign note is required' });
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT * FROM campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
    if (!exists.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Campaign not found' }); }
    const campaign = exists.rows[0];
    if (!(await canAccessCampaign(req, campaign))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: Cannot add notes to another account\'s campaign' });
    }
    const inserted = await client.query(`INSERT INTO campaign_notes (campaign_id, author_id, note, external_reference) VALUES ($1, $2, $3, $4) RETURNING *`, [campaignId, req.user.id, note.slice(0, 5000), externalReference.slice(0, 255) || null]);
    await logAudit(client, { actorId: req.user.id, entityType: 'campaign', entityId: campaignId, action: 'manual_operation_note_added', details: { note: note.slice(0, 1000), externalReference: externalReference.slice(0, 255) } });
    await client.query('COMMIT');
    return res.status(201).json(inserted.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); return res.status(500).json({ error: 'Failed to add campaign note' }); }
  finally { client.release(); }
});

// POST /api/campaigns/:id/report - Upload and stream-process delivery report with auto-refund
router.post('/:id/report', authenticate, requireRoles('admin'), reportUpload.single('reportFile'), async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const reportFile = req.file;

  if (!reportFile) {
    return res.status(400).json({ error: 'Report file is required' });
  }
  if (req.body.confirm !== 'true') {
    fs.unlink(reportFile.path, () => {});
    return res.status(400).json({ error: 'Preview the report and confirm reconciliation before processing it.' });
  }

  const fileStream = fs.createReadStream(reportFile.path);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  function normalizeReportPhone(raw) {
    if (!raw) return '';
    let cleaned = raw.replace(/[^0-9]/g, '').trim();
    if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
    if (/^[6-9]\d{9}$/.test(cleaned)) cleaned = '91' + cleaned;
    return cleaned;
  }

  const deliveredNumbers = [];
  const failedNumbers = [];

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Skip header line if present
      if (/^(phone|mobile|number|recipient|msisdn)/i.test(trimmed)) continue;

      // Split by comma, tab, or semicolon
      const parts = trimmed.split(/[\t,;]+/);
      if (parts.length >= 2) {
        const phone = normalizeReportPhone(parts[0]);
        const statusText = parts[1].trim().toLowerCase();
        if (!phone) continue;

        if (statusText === 'delivered' || statusText === 'sent' || statusText === 'success' || statusText === 'd' || statusText === 'true' || statusText === '1') {
          deliveredNumbers.push(phone);
        } else {
          failedNumbers.push(phone);
        }
      } else if (parts.length === 1) {
        // If only phone number is provided in a list, assume Delivered
        const phone = normalizeReportPhone(parts[0]);
        if (phone) deliveredNumbers.push(phone);
      }
    }
  } catch (err) {
    fs.unlink(reportFile.path, () => {});
    return res.status(400).json({ error: 'Could not read delivery report file' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const campRes = await client.query(`SELECT * FROM campaigns WHERE id = $1 FOR UPDATE`, [campaignId]);
    if (campRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaign = campRes.rows[0];
    if (!['Approved', 'Completed'].includes(campaign.status) || campaign.report_processed_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A delivery report may be processed once for an Approved or Completed campaign.' });
    }

    // Update delivered statuses in campaign_recipients in chunks
    const BATCH_SIZE = 2000;
    for (let i = 0; i < deliveredNumbers.length; i += BATCH_SIZE) {
      const chunk = deliveredNumbers.slice(i, i + BATCH_SIZE);
      await client.query(
        `UPDATE campaign_recipients SET status = 'Delivered', updated_at = NOW() 
         WHERE campaign_id = $1 AND phone_number = ANY($2::text[])`,
        [campaignId, chunk]
      );
    }

    // Mark explicit failed numbers or any remaining numbers not delivered as Failed
    if (failedNumbers.length > 0) {
      for (let i = 0; i < failedNumbers.length; i += BATCH_SIZE) {
        const chunk = failedNumbers.slice(i, i + BATCH_SIZE);
        await client.query(
          `UPDATE campaign_recipients SET status = 'Failed', updated_at = NOW() 
           WHERE campaign_id = $1 AND phone_number = ANY($2::text[])`,
          [campaignId, chunk]
        );
      }
    }

    // Any remaining pending recipients are marked Failed
    await client.query(
      `UPDATE campaign_recipients SET status = 'Failed', updated_at = NOW() 
       WHERE campaign_id = $1 AND status != 'Delivered'`,
      [campaignId]
    );

    // Compute exact delivered and failed counts from database
    const countCheck = await client.query(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'Delivered') as delivered,
         COUNT(*) FILTER (WHERE status = 'Failed') as failed
       FROM campaign_recipients 
       WHERE campaign_id = $1`,
      [campaignId]
    );

    const actualDelivered = parseInt(countCheck.rows[0].delivered, 10) || 0;
    const actualFailed = parseInt(countCheck.rows[0].failed, 10) || 0;

    // Auto-refund failed credits if not already refunded (accounting for multi-part SMS)
    let refundedFailedCount = 0;
    if (actualFailed > 0 && !campaign.failed_refunded) {
      let refundMultiplier = 1;
      if (campaign.channel_type === 'sms' && typeof calculateSmsMetrics === 'function') {
        const smsMetrics = calculateSmsMetrics(campaign.message_text);
        refundMultiplier = smsMetrics.parts_count || 1;
      }
      const refundCredits = actualFailed * refundMultiplier;
      refundedFailedCount = refundCredits;

      await client.query(`
        UPDATE user_credits 
        SET balance = balance + $1 
        WHERE user_id = $2 AND credit_type = $3 AND destination = $4
      `, [refundCredits, campaign.user_id, campaign.campaign_type, campaign.destination]);

      await client.query(`
        INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [req.user.id, campaign.user_id, campaign.campaign_type, campaign.destination, refundCredits, `Auto-refund for ${actualFailed} failed deliveries in campaign #${campaignId} (${refundCredits} credits)`]);

      await client.query(`UPDATE campaigns SET failed_refunded = TRUE WHERE id = $1`, [campaignId]);
    }

    // Update campaign record
    await client.query(`
      UPDATE campaigns 
      SET status = 'Report Updated', 
          delivered_count = $1, 
          failed_count = $2,
          report_processed_at = NOW(),
          report_processed_by = $3
      WHERE id = $4
    `, [actualDelivered, actualFailed, req.user.id, campaignId]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'campaign',
      entityId: campaignId,
      action: 'delivery_report_processed',
      details: { deliveredCount: actualDelivered, failedCount: actualFailed, refundedCredits: refundedFailedCount, sourceFile: reportFile.originalname, reason: String(req.body.reason || 'Verified external delivery report').slice(0, 1000) }
    });

    await client.query('COMMIT');

    return res.json({
      message: 'Report processed successfully!',
      deliveredCount: actualDelivered,
      failedCount: actualFailed,
      refundedCredits: refundedFailedCount
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Process report error:', err);
    return res.status(500).json({ error: 'Failed to process report' });
  } finally {
    client.release();
    if (reportFile && reportFile.path) fs.unlink(reportFile.path, () => {});
  }
});

// GET /api/campaigns/operator/queue - Get campaigns waiting for dispatch
router.get('/operator/queue', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    let sql = '';
    let params = [];
    if (req.user.role === 'admin') {
      sql = `
        SELECT c.*, u.email as owner_email
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        WHERE c.status IN ('Submitted', 'Approved')
        ORDER BY 
          CASE WHEN c.scheduled_at IS NOT NULL AND c.scheduled_at <= NOW() THEN 0 ELSE 1 END,
          c.created_at ASC
      `;
    } else {
      sql = `
        SELECT c.*, u.email as owner_email
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        WHERE c.status IN ('Submitted', 'Approved')
          AND (c.user_id = $1 OR u.reseller_id = $1)
        ORDER BY 
          CASE WHEN c.scheduled_at IS NOT NULL AND c.scheduled_at <= NOW() THEN 0 ELSE 1 END,
          c.created_at ASC
      `;
      params = [req.user.id];
    }
    const result = await query(sql, params);

    // Parse attachments for each campaign
    const campaigns = result.rows.map(c => {
      let attachments = c.attachments;
      if (typeof attachments === 'string') {
        try { attachments = JSON.parse(attachments); } catch(e) { attachments = []; }
      }
      return {
        ...c,
        attachments: attachments || []
      };
    });

    return res.json(campaigns);
  } catch (err) {
    console.error('Operator queue error:', err);
    return res.status(500).json({ error: 'Failed to load operator queue' });
  }
});

// GET /api/campaigns/operator/bulk-export - 1-Click ZIP Package containing numbers + messages + media for offline dispatch
router.get('/operator/bulk-export', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    let campaignsQuery = '';
    let params = [];
    const isReseller = req.user.role === 'reseller';

    if (req.query.campaign_ids) {
      const ids = req.query.campaign_ids.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      if (ids.length === 0) return res.status(400).json({ error: 'Invalid campaign IDs' });
      if (isReseller) {
        campaignsQuery = `
          SELECT c.*, u.email as owner_email
          FROM campaigns c
          JOIN users u ON c.user_id = u.id
          WHERE c.id = ANY($1::int[]) AND (c.user_id = $2 OR u.reseller_id = $2)
          ORDER BY c.id ASC
        `;
        params = [ids, req.user.id];
      } else {
        campaignsQuery = `
          SELECT c.*, u.email as owner_email
          FROM campaigns c
          JOIN users u ON c.user_id = u.id
          WHERE c.id = ANY($1::int[])
          ORDER BY c.id ASC
        `;
        params = [ids];
      }
    } else {
      if (isReseller) {
        campaignsQuery = `
          SELECT c.*, u.email as owner_email
          FROM campaigns c
          JOIN users u ON c.user_id = u.id
          WHERE c.status IN ('Submitted', 'Approved') AND (c.user_id = $1 OR u.reseller_id = $1)
          ORDER BY c.id ASC
        `;
        params = [req.user.id];
      } else {
        campaignsQuery = `
          SELECT c.*, u.email as owner_email
          FROM campaigns c
          JOIN users u ON c.user_id = u.id
          WHERE c.status IN ('Submitted', 'Approved')
          ORDER BY c.id ASC
        `;
      }
    }

    const campResult = await query(campaignsQuery, params);
    if (campResult.rows.length === 0) {
      return res.status(404).send('No pending campaigns found for export.');
    }

    const campaigns = campResult.rows;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFilename = `MessageSphere_Dispatch_Package_${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const ZipConstructor = archiver.ZipArchive || archiver;
    const archive = typeof archiver === 'function' ? archiver('zip', { zlib: { level: 9 } }) : new ZipConstructor({ zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('Archiver error:', err);
      if (!res.headersSent) res.status(500).send('Archiver compression error');
    });

    archive.pipe(res);

    // 1. Create DISPATCH_MANIFEST.csv
    let manifestCsv = 'Campaign ID,Title,User Email,Status,Total Numbers,Channel Type,Campaign Type,Destination,Scheduled At,Sender Header,Created At\n';

    for (const c of campaigns) {
      const sanitizedTitle = (c.title || 'Campaign_' + c.id).replace(/"/g, '""');
      const cleanHeader = (c.sender_header || 'None').replace(/"/g, '""');
      manifestCsv += `${c.id},"${sanitizedTitle}","${c.owner_email}","${c.status}",${c.total_numbers},"${c.channel_type}","${c.campaign_type}","${c.destination}","${c.scheduled_at || 'Immediate'}","${cleanHeader}","${c.created_at}"\n`;

      const safeFolder = `Campaign_${c.id}_${(c.title || 'Untitled').replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      // 2. Fetch recipients
      const recipientsRes = await query(`
        SELECT phone_number FROM campaign_recipients WHERE campaign_id = $1 ORDER BY id ASC
      `, [c.id]);

      const numbersTxt = recipientsRes.rows.map(r => r.phone_number).join('\n');
      const numbersCsv = 'Mobile Number\n' + recipientsRes.rows.map(r => r.phone_number).join('\n');

      archive.append(numbersTxt, { name: `${safeFolder}/numbers.txt` });
      archive.append(numbersCsv, { name: `${safeFolder}/numbers.csv` });

      // 3. Format message payload file
      let messagePayload = `=======================================================\n`;
      messagePayload += `CAMPAIGN #${c.id}: ${c.title || 'Untitled'}\n`;
      messagePayload += `Owner: ${c.owner_email}\n`;
      messagePayload += `Status: ${c.status}\n`;
      messagePayload += `Route: ${c.campaign_type} (${c.destination})\n`;
      messagePayload += `Total Recipients: ${c.total_numbers}\n`;
      if (c.sender_header) messagePayload += `Sender Header: ${c.sender_header}\n`;
      if (c.scheduled_at) messagePayload += `Scheduled For: ${c.scheduled_at}\n`;
      messagePayload += `=======================================================\n\n`;
      messagePayload += `--- MESSAGE TEXT / CAPTION ---\n`;
      messagePayload += `${c.message_text}\n\n`;

      if (c.cta_data) {
        let cta = c.cta_data;
        if (typeof cta === 'string') {
          try { cta = JSON.parse(cta); } catch(e) {}
        }
        messagePayload += `--- INTERACTIVE ACTION BUTTONS (CTA) ---\n`;
        if (cta.callText) messagePayload += `Call Button: "${cta.callText}" -> ${cta.callNumber || 'N/A'}\n`;
        if (cta.urlText) messagePayload += `Web URL Button: "${cta.urlText}" -> ${cta.urlLink || 'N/A'}\n`;
        messagePayload += `\n`;
      }

      archive.append(messagePayload, { name: `${safeFolder}/message_content.txt` });

      // 4. Metadata JSON
      archive.append(JSON.stringify(c, null, 2), { name: `${safeFolder}/campaign_metadata.json` });

      // 5. Assets / Media attachments
      let attachments = c.attachments;
      if (typeof attachments === 'string') {
        try { attachments = JSON.parse(attachments); } catch(e) { attachments = []; }
      }
      if ((!attachments || attachments.length === 0) && c.attachment_url) {
        attachments = [{ url: c.attachment_url, label: 'Attachment', filename: path.basename(c.attachment_url) }];
      }

      if (attachments && Array.isArray(attachments)) {
        attachments.forEach((att, attIdx) => {
          if (att.url) {
            const rawFilename = path.basename(att.url);
            const diskPath = path.join(__dirname, '../uploads', rawFilename);
            if (fs.existsSync(diskPath)) {
              const exportFilename = att.filename ? `${attIdx + 1}_${att.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}` : `${attIdx + 1}_${rawFilename}`;
              archive.file(diskPath, { name: `${safeFolder}/assets/${exportFilename}` });
            }
          }
        });
      }
    }

    archive.append(manifestCsv, { name: 'DISPATCH_MANIFEST.csv' });

    await archive.finalize();
  } catch (err) {
    console.error('Bulk export error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to generate bulk export package' });
    }
  }
});

// POST /api/campaigns/operator/bulk-status - Bulk update status for multiple campaigns
router.post('/operator/bulk-status', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const { campaign_ids, status, reason, external_reference: externalReference } = req.body;
  if (!Array.isArray(campaign_ids) || campaign_ids.length === 0) {
    return res.status(400).json({ error: 'Campaign IDs required' });
  }

  const validStatuses = ['Approved', 'Completed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason is required for every bulk status change' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const ids = [...new Set(campaign_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)))];
    if (ids.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No valid campaign IDs supplied' });
    }

    const isReseller = req.user.role === 'reseller';
    const expectedCurrentStatus = status === 'Approved' ? 'Submitted' : 'Approved';
    let selected;
    if (isReseller) {
      selected = await client.query(
        `SELECT c.id FROM campaigns c
         JOIN users u ON c.user_id = u.id
         WHERE c.id = ANY($1::int[]) AND c.status = $2 AND (c.user_id = $3 OR u.reseller_id = $3)
         FOR UPDATE`,
        [ids, expectedCurrentStatus, req.user.id]
      );
    } else {
      selected = await client.query(
        `SELECT id FROM campaigns WHERE id = ANY($1::int[]) AND status = $2 FOR UPDATE`,
        [ids, expectedCurrentStatus]
      );
    }
    if (selected.rows.length !== ids.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `All selected campaigns must currently be ${expectedCurrentStatus}.` });
    }

    await client.query(`
      UPDATE campaigns 
      SET status = $1 
      WHERE id = ANY($2::int[])
    `, [status, ids]);

    for (const id of ids) {
      await logAudit(client, {
        actorId: req.user.id,
        entityType: 'campaign',
        entityId: id,
        action: `status_changed_to_${status.toLowerCase()}_bulk`,
        details: { previousStatus: expectedCurrentStatus, status, reason: String(reason).trim().slice(0, 1000), externalReference: String(externalReference || '').trim().slice(0, 255), manualDispatch: true }
      });
    }

    await client.query('COMMIT');
    return res.json({ message: `Successfully updated ${ids.length} campaigns to ${status}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk status update error:', err);
    return res.status(500).json({ error: 'Failed to update campaign statuses' });
  } finally {
    client.release();
  }
});

module.exports = router;
