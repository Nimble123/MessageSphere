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
const { calculateSmsMetrics, normalizePhoneNumber, SMPP_DELIVERED_STATUSES, sanitizeCsvCell, isValidAttachmentUrl } = require('../services/telecom');
const MAX_CAMPAIGN_RECIPIENTS = Number(process.env.MAX_CAMPAIGN_RECIPIENTS || 50000);

// Setup multer storage for campaign attachments and reports (supports persistent volumes)
const { ROOT_UPLOADS_DIR } = require('../services/storage');
const uploadDir = ROOT_UPLOADS_DIR;

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
  if (req.user.is_team_member && !req.user.permissions?.can_view_campaigns) return false;
  const effectiveUserId = req.user.effective_user_id || req.user.id;
  const effectiveRole = (req.user.is_team_member && req.user.parent_role) ? req.user.parent_role : req.user.role;
  if (req.user.role === 'admin' || campaign.user_id === effectiveUserId) return true;
  if (effectiveRole !== 'reseller') return false;

  const owner = await query('SELECT reseller_id, assigned_agent_id FROM users WHERE id = $1', [campaign.user_id]);
  if (!owner.rows[0] || owner.rows[0].reseller_id !== effectiveUserId) return false;

  // If caller is an agent under a reseller without can_manage_team, enforce assigned portfolio or active leave coverage
  if (req.user.is_team_member && !req.user.permissions?.can_manage_team) {
    const assignedAgentId = owner.rows[0].assigned_agent_id;
    if (assignedAgentId === req.user.id) return true;
    const backupCheck = await query(
      `SELECT id FROM team_members WHERE user_id = $1 AND parent_user_id = $2 AND is_on_leave = TRUE AND backup_agent_id = $3`,
      [assignedAgentId, effectiveUserId, req.user.id]
    );
    return backupCheck.rows.length > 0;
  }

  return true;
}

// Helper to batch insert recipients
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

// POST /api/campaigns - Create a new campaign with atomic credit deduction
router.post('/', authenticate, uploadFields, async (req, res) => {
  const { title, text, numbers: rawNumbers, destination, channel_type, scheduled_at, cta_data, target_user_id } = req.body;
  const files = req.files || {};

  if (req.user.is_team_member && !req.user.permissions?.can_send_campaigns) {
    removeUploadedFiles(files);
    return res.status(403).json({ error: 'Permission Denied: Your assigned team role is not authorized to create or dispatch campaigns.' });
  }

  // Resolve Effective Account (Self vs On-Behalf-Of Proxy Dispatch vs Team Organization)
  let effectiveUserId = req.user.effective_user_id || req.user.id;
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
    removeUploadedFiles(files);
    return res.status(400).json({ error: 'Campaign message text is required' });
  }

  if (!rawNumbers || !rawNumbers.trim()) {
    removeUploadedFiles(files);
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
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'DP file must be strictly a JPEG or PNG image.' });
    }
    if (dp.size > 3 * 1024 * 1024) {
      removeUploadedFiles(files);
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
        removeUploadedFiles(files);
        return res.status(400).json({ error: `Image ${i} must be strictly a JPEG or PNG image.` });
      }
      if (img.size > 3 * 1024 * 1024) {
        removeUploadedFiles(files);
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
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'Video file must be a valid video file (e.g. MP4).' });
    }
    if (vid.size > 20 * 1024 * 1024) {
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'Video file exceeds maximum size of 20 MB.' });
    }
    addAttachment(vid, 'video', 'Campaign Video');
  }

  // 4. PDF: Document, Max 10 MB
  if (files['pdf_file'] && files['pdf_file'][0]) {
    const pdf = files['pdf_file'][0];
    const ext = path.extname(pdf.originalname).toLowerCase();
    if (pdf.mimetype !== 'application/pdf' && ext !== '.pdf') {
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'Document must be a valid PDF file.' });
    }
    if (pdf.size > 10 * 1024 * 1024) {
      removeUploadedFiles(files);
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
        removeUploadedFiles(files);
        return res.status(400).json({ error: 'CTA PDF attachment exceeds maximum size of 10 MB.' });
      }
    } else if (mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm'].includes(ext)) {
      ctaMediaType = 'video';
      if (ctaFile.size > 20 * 1024 * 1024) {
        removeUploadedFiles(files);
        return res.status(400).json({ error: 'CTA Video attachment exceeds maximum size of 20 MB.' });
      }
    } else if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png'].includes(ext)) {
      ctaMediaType = 'image';
      if (!['image/jpeg', 'image/jpg', 'image/png'].includes(mime) && !['.jpg', '.jpeg', '.png'].includes(ext)) {
        removeUploadedFiles(files);
        return res.status(400).json({ error: 'CTA Image attachment must be strictly JPEG or PNG.' });
      }
      if (ctaFile.size > 3 * 1024 * 1024) {
        removeUploadedFiles(files);
        return res.status(400).json({ error: 'CTA Image attachment exceeds maximum size of 3 MB.' });
      }
    } else {
      removeUploadedFiles(files);
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
  const candidateNumbers = Array.from(numberSet);
  const candidate10Digits = candidateNumbers.map(n => n.slice(-10)).filter(n => n.length === 10);

  const blacklistedRes = await query(`
    SELECT phone_number FROM blacklist 
    WHERE (
       user_id IN ($1, $2) 
       OR user_id IS NULL 
       OR user_id IN (SELECT id FROM users WHERE role = 'admin')
       OR user_id IN (SELECT reseller_id FROM users WHERE id IN ($1, $2) AND reseller_id IS NOT NULL)
    )
    AND (
       phone_number = ANY($3::varchar[])
       OR RIGHT(phone_number, 10) = ANY($4::varchar[])
    )
  `, [req.user.id, effectiveUserId, candidateNumbers, candidate10Digits]);

  const blacklistedSet = new Set();
  blacklistedRes.rows.forEach(r => {
    const raw = String(r.phone_number || '').trim();
    if (!raw) return;
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits) {
      blacklistedSet.add(digits);
      if (digits.length >= 10) blacklistedSet.add(digits.slice(-10));
    }
  });
  
  const validNumbers = [];
  let skippedBlacklisted = 0;
  numberSet.forEach(num => {
    const digitsOnly = String(num).replace(/[^0-9]/g, '');
    const last10 = digitsOnly.slice(-10);
    if (blacklistedSet.has(num) || blacklistedSet.has(digitsOnly) || (last10.length === 10 && blacklistedSet.has(last10))) {
      skippedBlacklisted++;
    } else {
      validNumbers.push(num);
    }
  });

  const uniqueNumbers = validNumbers;
  const messageCount = uniqueNumbers.length;
  if (messageCount === 0) {
    removeUploadedFiles(files);
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
      if (parsedCta && typeof parsedCta === 'object') {
        const hasBtn = !!(parsedCta.callText || parsedCta.urlText || parsedCta.call_text || parsedCta.url_text ||
                          parsedCta.callNumber || parsedCta.call_number || parsedCta.urlLink || parsedCta.url_link);
        if (hasBtn) hasCta = true;
      }
    } catch (e) {
      console.warn('CTA parse error:', e);
    }
  }
  if (req.body.cta_call_number || req.body.cta_call_text || req.body.cta_url_link || req.body.cta_url_text) {
    hasCta = true;
  }
  if (req.body.campaign_type === 'cta' || req.body.campaign_type === 'dp_cta') {
    hasCta = true;
  }

  // Strict CTA Business Rules Validation (Character Limit 1024, Button Text 20, HTTPS & No Direct WhatsApp)
  const isCtaCampaign = hasCta || req.body.campaign_type === 'cta' || req.body.campaign_type === 'dp_cta';
  if (isCtaCampaign) {
    // 1. Message text character limit - 1,024 characters
    if (text && text.trim().length > 1024) {
      removeUploadedFiles(files);
      return res.status(400).json({
        error: `WhatsApp CTA campaigns allow a maximum of 1,024 characters for message text. Your message currently has ${text.trim().length} characters.`
      });
    }

    // 2. CTA button text & URL rules
    if (parsedCta) {
      const callText = String(parsedCta.callText || parsedCta.call_text || '').trim();
      const callNumber = String(parsedCta.callNumber || parsedCta.call_number || '').trim();
      const urlText = String(parsedCta.urlText || parsedCta.url_text || '').trim();
      const urlLink = String(parsedCta.urlLink || parsedCta.url_link || '').trim();

      if (callText && !callNumber) {
        removeUploadedFiles(files);
        return res.status(400).json({ error: 'CTA Call button requires a phone number to dial.' });
      }

      // Rule: Button text max 20 characters
      if (callText && callText.length > 20) {
        removeUploadedFiles(files);
        return res.status(400).json({
          error: `CTA Call button text cannot exceed 20 characters (currently ${callText.length} characters).`
        });
      }

      if (urlText && urlText.length > 20) {
        removeUploadedFiles(files);
        return res.status(400).json({
          error: `CTA Web link button text cannot exceed 20 characters (currently ${urlText.length} characters).`
        });
      }

      if (urlLink) {
        // Rule: URL must start with https://
        if (!/^https:\/\//i.test(urlLink)) {
          removeUploadedFiles(files);
          return res.status(400).json({
            error: 'CTA Website URL must start with https:// (e.g. https://yourwebsite.com). Links without https:// or with http:// are not supported.'
          });
        }

        // Rule: Direct WhatsApp links not allowed
        const lowerUrl = urlLink.toLowerCase();
        if (
          lowerUrl.includes('wa.me') ||
          lowerUrl.includes('api.whatsapp.com') ||
          lowerUrl.includes('chat.whatsapp.com') ||
          lowerUrl.includes('web.whatsapp.com') ||
          lowerUrl.includes('whatsapp.com/send') ||
          lowerUrl.includes('whatsapp.com/dl')
        ) {
          removeUploadedFiles(files);
          return res.status(400).json({
            error: 'Direct WhatsApp links (wa.me, api.whatsapp.com, chat.whatsapp.com) are not supported in CTA buttons. Please provide a standard website or landing page URL.'
          });
        }
      }
    }
  }

  // Determine campaign type and corresponding credit bucket
  let campaignType = 'normal';

  // Support pre-saved template attachment URL if no new files were uploaded
  const templateAttachmentUrl = (req.body.attachment_url && typeof req.body.attachment_url === 'string') ? req.body.attachment_url.trim() : null;
  if (templateAttachmentUrl) {
    if (!isValidAttachmentUrl(templateAttachmentUrl)) {
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'Invalid attachment URL format or dangerous character detected.' });
    }
    // Cross-tenant protection: verify user has permission to reference this local file
    if (!/^https?:\/\//i.test(templateAttachmentUrl) && req.user.role !== 'admin') {
      const localFile = path.basename(templateAttachmentUrl);
      const fileOwnerCheck = await query(
        `SELECT c.id FROM campaigns c JOIN users u ON c.user_id = u.id 
         WHERE (c.attachments::text LIKE $1 OR c.attachment_url LIKE $1) 
           AND (c.user_id = $2 OR u.reseller_id = $2 OR c.user_id = (SELECT reseller_id FROM users WHERE id = $2))
         UNION
         SELECT t.id FROM templates t JOIN users u ON t.user_id = u.id 
         WHERE (t.attachments::text LIKE $1 OR t.attachment_url LIKE $1) 
           AND (t.user_id = $2 OR u.reseller_id = $2 OR t.user_id = (SELECT reseller_id FROM users WHERE id = $2))
         LIMIT 1`,
        [`%${localFile}%`, req.user.id]
      );
      if (fileOwnerCheck.rows.length === 0) {
        removeUploadedFiles(files);
        return res.status(403).json({ error: 'Permission denied: You do not have permission to attach this file.' });
      }
    }
  }

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
  
  // Server-side derive campaign_type strictly from features & channel (prevents rate bypass)
  if (campaignChannel === 'own_number') {
    campaignType = 'own_number';
  } else if (hasAttachment && hasCta) {
    campaignType = 'dp_cta';
  } else if (hasAttachment) {
    campaignType = 'dp';
  } else if (hasCta) {
    campaignType = 'cta';
  } else {
    campaignType = 'normal';
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
    if (isNaN(parsedDate.getTime())) {
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'Invalid scheduled_at date format. Please provide a valid date/time string.' });
    }
    if (parsedDate <= new Date()) {
      removeUploadedFiles(files);
      return res.status(400).json({ error: 'Scheduled time must be in the future.' });
    }
    scheduledDate = parsedDate;
    initialStatus = 'Submitted'; // Queued for scheduled dispatch
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
    const subUserId = req.user.is_team_member ? req.user.id : null;
    const insertCampaign = await client.query(`
      INSERT INTO campaigns 
        (user_id, title, channel_type, scheduled_at, campaign_type, destination, message_text, total_numbers, status, attachment_url, attachments, cta_data, created_by_sub_user_id)
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
      subUserId
    ]);

    const campaignId = insertCampaign.rows[0].id;

    // 4. Batch insert recipients
    await batchInsertRecipients(client, campaignId, uniqueNumbers);

    // 5. Record credit transaction
    let txReason = `Deduction for campaign #${campaignId} (${campaignTitle})`;
    if (req.user.is_team_member) {
      txReason += ` [Dispatched by Team Member: ${req.user.email}]`;
    } else if (effectiveUserId !== req.user.id) {
      txReason += ` [Created by ${req.user.role.toUpperCase()} on behalf of account]`;
    }

    await client.query(`
      INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, direction, refund_campaign_id)
      VALUES ($1, $2, $3, $4, $5, $6, 'debit', $7)
    `, [effectiveUserId, effectiveUserId, campaignType, campaignDest, messageCount, txReason, campaignId]);

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
    let params = [req.user.id];

    if (req.user.role === 'admin') {
      sql = `
        SELECT r.*, c.title as campaign_title, c.status as campaign_status, c.total_numbers, u.email as owner_email
        FROM admin_reminders r
        JOIN campaigns c ON r.campaign_id = c.id
        JOIN users u ON c.user_id = u.id
        WHERE r.is_read = FALSE
          AND r.id NOT IN (SELECT reminder_id FROM reminder_dismissals WHERE user_id = $1)
        ORDER BY r.scheduled_for ASC
        LIMIT 50
      `;
    } else {
      sql = `
        SELECT r.*, c.title as campaign_title, c.status as campaign_status, c.total_numbers, u.email as owner_email
        FROM admin_reminders r
        JOIN campaigns c ON r.campaign_id = c.id
        JOIN users u ON c.user_id = u.id
        WHERE r.is_read = FALSE 
          AND (c.user_id = $1 OR u.reseller_id = $1)
          AND r.id NOT IN (SELECT reminder_id FROM reminder_dismissals WHERE user_id = $1)
        ORDER BY r.scheduled_for ASC
        LIMIT 50
      `;
    }

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('Fetch reminders error:', err);
    return res.status(500).json({ error: 'Failed to fetch scheduled reminders' });
  }
});

// POST /api/campaigns/reminders/:id/dismiss - Dismiss a single reminder per-user with ownership check
router.post('/reminders/:id/dismiss', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const reminderId = parseInt(req.params.id, 10);
  if (isNaN(reminderId)) return res.status(400).json({ error: 'Invalid reminder ID' });
  try {
    // Ownership check: Verify user has permission to see this reminder's campaign
    const checkSql = req.user.role === 'admin'
      ? `SELECT r.id FROM admin_reminders r WHERE r.id = $1`
      : `SELECT r.id FROM admin_reminders r 
         JOIN campaigns c ON r.campaign_id = c.id 
         JOIN users u ON c.user_id = u.id 
         WHERE r.id = $1 AND (c.user_id = $2 OR u.reseller_id = $2)`;
    const checkParams = req.user.role === 'admin' ? [reminderId] : [reminderId, req.user.id];
    const checkRes = await query(checkSql, checkParams);

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found or access denied' });
    }

    // Insert user-scoped dismissal record
    await query(`
      INSERT INTO reminder_dismissals (reminder_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (reminder_id, user_id) DO NOTHING
    `, [reminderId, req.user.id]);

    return res.json({ success: true });
  } catch (err) {
    console.error('Dismiss reminder error:', err);
    return res.status(500).json({ error: 'Failed to dismiss reminder' });
  }
});

// POST /api/campaigns/reminders/dismiss-all - Dismiss all active reminders per-user
router.post('/reminders/dismiss-all', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      await query(`
        INSERT INTO reminder_dismissals (reminder_id, user_id)
        SELECT r.id, $1 FROM admin_reminders r
        WHERE r.is_read = FALSE
        ON CONFLICT (reminder_id, user_id) DO NOTHING
      `, [req.user.id]);
    } else {
      await query(`
        INSERT INTO reminder_dismissals (reminder_id, user_id)
        SELECT r.id, $1 FROM admin_reminders r
        JOIN campaigns c ON r.campaign_id = c.id
        JOIN users u ON c.user_id = u.id
        WHERE r.is_read = FALSE AND (c.user_id = $1 OR u.reseller_id = $1)
        ON CONFLICT (reminder_id, user_id) DO NOTHING
      `, [req.user.id]);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Dismiss all reminders error:', err);
    return res.status(500).json({ error: 'Failed to dismiss reminders' });
  }
});

// GET /api/campaigns - List campaigns (Strictly WhatsApp campaigns by default)
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.is_team_member && !req.user.permissions?.can_view_campaigns) {
      return res.status(403).json({ error: 'Permission Denied: Your assigned team role is not authorized to view campaigns.' });
    }
    const channelFilter = req.query.channel_type;
    let channelClause = "AND COALESCE(c.channel_type, 'whatsapp') != 'sms' AND COALESCE(c.campaign_type, '') != 'gsm_sms'";
    if (channelFilter === 'all') {
      channelClause = "";
    } else if (channelFilter === 'sms') {
      channelClause = "AND (c.channel_type = 'sms' OR c.campaign_type = 'gsm_sms')";
    }

    let listSql = '';
    let params = [];
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 100, 1000) : (req.query.all === 'true' ? 500 : 250);
    const offset = parseInt(req.query.offset, 10) || 0;
    const paginationClause = limit ? ` LIMIT ${limit} OFFSET ${offset}` : '';

    const listColumns = `
      c.id, c.user_id, c.title, c.credit_type, c.destination, c.channel_type, c.campaign_type,
      c.status, c.total_numbers, c.delivered_count, c.failed_count, c.credits_used, c.refunded_credits,
      c.scheduled_at, c.created_at, c.updated_at, c.report_processed_at,
      SUBSTRING(c.message_text, 1, 150) AS message_preview,
      u.email as owner_email,
      ae.rejection_action,
      ae.rejection_reason
    `;

    const lateralAuditJoin = `
      LEFT JOIN LATERAL (
        SELECT action AS rejection_action, details->>'reason' AS rejection_reason
        FROM audit_events
        WHERE entity_type = 'campaign' AND entity_id = c.id
          AND action IN ('status_changed_to_rejected', 'status_changed_to_rejected_bulk', 'campaign_cancelled_by_user')
        ORDER BY id DESC LIMIT 1
      ) ae ON true
    `;

    if (req.user.role === 'admin') {
      listSql = `
        SELECT ${listColumns}
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        ${lateralAuditJoin}
        WHERE 1=1 ${channelClause}
        ORDER BY c.created_at DESC
        ${paginationClause}
      `;
    } else if (req.user.role === 'reseller') {
      listSql = `
        SELECT ${listColumns}
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        ${lateralAuditJoin}
        WHERE (c.user_id = $1 OR u.reseller_id = $1) ${channelClause}
        ORDER BY c.created_at DESC
        ${paginationClause}
      `;
      params = [req.user.id];
    } else {
      const targetUserId = req.user.effective_user_id || req.user.id;
      listSql = `
        SELECT ${listColumns}
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        ${lateralAuditJoin}
        WHERE c.user_id = $1 ${channelClause}
        ORDER BY c.created_at DESC
        ${paginationClause}
      `;
      params = [targetUserId];
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
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    let hasAccess = req.user.role === 'admin';

    if (!hasAccess) {
      // Cross-tenant security: check original creator/uploader (earliest record)
      const originalCampaign = await query(
        `SELECT c.id, c.user_id, u.reseller_id
         FROM campaigns c
         JOIN users u ON c.user_id = u.id
         WHERE c.attachments::text LIKE $1 OR c.attachment_url LIKE $1
         ORDER BY c.id ASC
         LIMIT 1`,
        [`%${filename}%`]
      );

      const originalTemplate = await query(
        `SELECT t.id, t.user_id, u.reseller_id
         FROM templates t
         JOIN users u ON t.user_id = u.id
         WHERE t.attachments::text LIKE $1 OR t.attachment_url LIKE $1
         ORDER BY t.id ASC
         LIMIT 1`,
        [`%${filename}%`]
      );

      let ownerUserId = null;
      let ownerResellerId = null;

      if (originalCampaign.rows.length > 0 && originalTemplate.rows.length > 0) {
        ownerUserId = originalCampaign.rows[0].user_id;
        ownerResellerId = originalCampaign.rows[0].reseller_id;
      } else if (originalCampaign.rows.length > 0) {
        ownerUserId = originalCampaign.rows[0].user_id;
        ownerResellerId = originalCampaign.rows[0].reseller_id;
      } else if (originalTemplate.rows.length > 0) {
        ownerUserId = originalTemplate.rows[0].user_id;
        ownerResellerId = originalTemplate.rows[0].reseller_id;
      }

      if (ownerUserId) {
        if (
          ownerUserId === req.user.id ||
          (req.user.role === 'reseller' && ownerResellerId === req.user.id) ||
          (req.user.role === 'user' && req.user.reseller_id === ownerUserId)
        ) {
          hasAccess = true;
        }
      }
    }

    if (!hasAccess) {
      return res.status(404).json({ error: 'File not found or access denied' });
    }

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
    const campResult = await query(`SELECT user_id, title, status, report_processed_at FROM campaigns WHERE id = $1`, [campaignId]);
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

    const shouldMaskNumbers = req.user.is_team_member && !req.user.permissions?.can_export_contacts;
    let csvContent = 'Phone Number,Status,Timestamp\n';
    recipients.rows.forEach(r => {
      let exportStatus = r.status || 'Pending';
      if (exportStatus === 'Pending') {
        if (campaign.status === 'Completed') {
          exportStatus = campaign.report_processed_at ? 'Delivered' : 'Dispatched to Carrier (DLR Processing)';
        } else if (campaign.status === 'Approved') {
          exportStatus = 'In Dispatch Queue';
        } else if (campaign.status === 'Submitted') {
          exportStatus = 'Queued';
        }
      }
      let exportPhone = r.phone_number;
      if (shouldMaskNumbers && exportPhone && exportPhone.length >= 7) {
        exportPhone = exportPhone.slice(0, 4) + '******' + exportPhone.slice(-2);
      }
      csvContent += `${sanitizeCsvCell(exportPhone)},${sanitizeCsvCell(exportStatus)},${sanitizeCsvCell(new Date(r.updated_at).toISOString())}\n`;
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
    if (req.user.is_team_member && !req.user.permissions?.can_export_contacts) {
      return res.status(403).json({ error: 'Permission Denied: Organization security policy restricts exporting raw audience phone numbers.' });
    }
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
      recipients.rows.forEach(r => { csvContent += `${sanitizeCsvCell(r.phone_number)}\n`; });
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
  if (status === 'Completed' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Permission denied: Only Super Admin can mark campaigns as Completed upon carrier dispatch' });
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
        let refundMultiplier = 1;
        if (campaign.channel_type === 'sms' && typeof calculateSmsMetrics === 'function') {
          const smsMetrics = calculateSmsMetrics(campaign.message_text);
          refundMultiplier = smsMetrics.parts_count || 1;
        }
        const totalRefundCredits = refundAmount * refundMultiplier;

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

        // Auto-refund remaining credits to the beneficiary wallet (reseller or user)
        await client.query(`
          INSERT INTO user_credits (user_id, credit_type, destination, balance)
          VALUES ($2, $3, $4, $1)
          ON CONFLICT (user_id, credit_type, destination)
          DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance
        `, [totalRefundCredits, refundRecipientId, campaign.campaign_type, campaign.destination]);

        const rejectReason = isRoutedToReseller
          ? `Automatic refund for rejected campaign #${campaignId} ("${campaign.title}") of client ${owner.email} (${totalRefundCredits} credits)`
          : `Automatic refund for rejected campaign #${campaignId} (${totalRefundCredits} credits)`;

        await client.query(`
          INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, tax_mode, base_amount, gst_amount, refund_client_email, refund_campaign_id, direction)
          VALUES ($1, $2, $3, $4, $5, $6, 'non_gst', 0.00, 0.00, $7, $8, 'refund')
        `, [req.user.id, refundRecipientId, campaign.campaign_type, campaign.destination, totalRefundCredits, rejectReason, owner ? owner.email : null, campaignId]);
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
  if (req.user.is_team_member && !req.user.permissions?.can_send_campaigns) {
    return res.status(403).json({ error: 'Permission Denied: Your assigned team role cannot cancel campaigns.' });
  }
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

    // 100% Refund credits (accounting for multi-part SMS if channel is SMS)
    let refundMultiplier = 1;
    if (campaign.channel_type === 'sms' && typeof calculateSmsMetrics === 'function') {
      const smsMetrics = calculateSmsMetrics(campaign.message_text);
      refundMultiplier = smsMetrics.parts_count || 1;
    }
    const refundCredits = (parseInt(campaign.total_numbers, 10) || 0) * refundMultiplier;

    // Check campaign owner's refund destination setting
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

    await client.query(`
      INSERT INTO user_credits (user_id, credit_type, destination, balance)
      VALUES ($2, $3, $4, $1)
      ON CONFLICT (user_id, credit_type, destination)
      DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance
    `, [refundCredits, refundRecipientId, campaign.campaign_type, campaign.destination]);

    const cancelReason = isRoutedToReseller
      ? `Refund for cancelled campaign #${campaignId} ("${campaign.title}") of client ${owner ? owner.email : 'client'} (${refundCredits} credits)`
      : `User self-cancellation for campaign #${campaignId} (${campaign.title})`;

    await client.query(`
      INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, tax_mode, base_amount, gst_amount, refund_client_email, refund_campaign_id, direction)
      VALUES ($1, $2, $3, $4, $5, $6, 'non_gst', 0.00, 0.00, $7, $8, 'refund')
    `, [req.user.id, refundRecipientId, campaign.campaign_type, campaign.destination, refundCredits, cancelReason, owner ? owner.email : null, campaignId]);

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

// POST /api/campaigns/:id/report/preview - Dry-run validation of delivery report against campaign recipients
router.post('/:id/report/preview', authenticate, requireRoles('admin'), reportUpload.single('reportFile'), async (req, res) => {
  const campaignId = parseInt(req.params.id, 10);
  const reportFile = req.file;

  if (!reportFile) {
    return res.status(400).json({ error: 'Report file is required for preview' });
  }

  try {
    const campRes = await query(`SELECT id, title, total_numbers, status, delivered_count, failed_count, report_processed_at FROM campaigns WHERE id = $1`, [campaignId]);
    if (campRes.rows.length === 0) {
      if (reportFile.path) fs.unlink(reportFile.path, () => {});
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaign = campRes.rows[0];

    // Get all recipient phone numbers for this campaign
    const recipsRes = await query(`SELECT phone_number FROM campaign_recipients WHERE campaign_id = $1`, [campaignId]);
    const campaignPhoneSet = new Set(recipsRes.rows.map(r => r.phone_number));
    const totalCampaignNumbers = campaignPhoneSet.size || parseInt(campaign.total_numbers, 10) || 0;

    const fileStream = fs.createReadStream(reportFile.path);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let fileTotalRows = 0;
    let unmatchedInFileCount = 0;
    const matchedPhonesSet = new Set();
    const matchedDeliveredPhones = new Set();
    const matchedFailedPhones = new Set();

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(phone|mobile|number|recipient|msisdn)/i.test(trimmed)) continue;

      fileTotalRows++;
      const parts = trimmed.split(/[\t,;]+/);
      const cleanPhone = parts[0].replace(/["']/g, '').trim();
      const phone = normalizePhoneNumber(cleanPhone);
      if (!phone) continue;

      let isDeliv = true;
      if (parts.length >= 2) {
        const statusText = parts[1].replace(/["']/g, '').trim().toLowerCase();
        isDeliv = SMPP_DELIVERED_STATUSES.has(statusText);
      }

      if (campaignPhoneSet.has(phone)) {
        matchedPhonesSet.add(phone);
        if (isDeliv) {
          matchedDeliveredPhones.add(phone);
        } else {
          matchedFailedPhones.add(phone);
        }
      } else {
        unmatchedInFileCount++;
      }
    }

    if (reportFile.path) fs.unlink(reportFile.path, () => {});

    // Missing numbers handling
    const treatMissingAsFailed = req.query.treat_missing_as_failed === 'true' || req.body.treat_missing_as_failed === 'true';
    const missingFromCampaignCount = Math.max(0, totalCampaignNumbers - matchedPhonesSet.size);
    const projectedDelivered = matchedDeliveredPhones.size;
    const projectedFailed = matchedFailedPhones.size + (treatMissingAsFailed ? missingFromCampaignCount : 0);
    const matchRate = totalCampaignNumbers > 0 ? Math.min(100, Math.round((matchedPhonesSet.size / totalCampaignNumbers) * 1000) / 10) : 0;

    let warnings = [];
    let isSevereMismatch = false;

    if (fileTotalRows !== totalCampaignNumbers) {
      warnings.push(`File contains ${fileTotalRows.toLocaleString()} numbers, while this campaign has ${totalCampaignNumbers.toLocaleString()} recipients.`);
    }

    if (unmatchedInFileCount > 0) {
      warnings.push(`${unmatchedInFileCount.toLocaleString()} numbers in the file do not belong to this campaign and will be safely ignored.`);
    }

    if (matchRate < 50) {
      isSevereMismatch = true;
      warnings.push(`CRITICAL WARNING: Only ${matchRate}% (${matchedPhonesSet.size.toLocaleString()} / ${totalCampaignNumbers.toLocaleString()}) of campaign numbers match! You might have selected a file from a different campaign.`);
    } else if (missingFromCampaignCount > 0) {
      warnings.push(
        treatMissingAsFailed
          ? `${missingFromCampaignCount.toLocaleString()} campaign numbers were missing from this report file and will be treated as Failed (auto-refunded).`
          : `${missingFromCampaignCount.toLocaleString()} campaign numbers were not found in this report file and will remain in their current status.`
      );
    }

    const isRevision = Boolean(campaign.report_processed_at || campaign.status === 'Report Updated');
    let deltaFailed = 0;
    if (isRevision) {
      const prevFailed = parseInt(campaign.failed_count, 10) || 0;
      deltaFailed = projectedFailed - prevFailed;
    }

    return res.json({
      campaignId,
      campaignTitle: campaign.title,
      totalCampaignNumbers,
      fileTotalRows,
      matchedNumbersCount: matchedPhonesSet.size,
      unmatchedInFileCount,
      missingFromCampaignCount,
      matchRate,
      projectedDelivered,
      projectedFailed,
      isRevision,
      deltaFailed,
      isSevereMismatch,
      warnings
    });
  } catch (err) {
    if (reportFile && reportFile.path) fs.unlink(reportFile.path, () => {});
    console.error('Report preview error:', err);
    return res.status(500).json({ error: 'Failed to preview delivery report' });
  }
});

// POST /api/campaigns/:id/report - Upload and stream-process delivery report with auto-refund & revision support
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
        const cleanPhone = parts[0].replace(/["']/g, '').trim();
        const phone = normalizePhoneNumber(cleanPhone);
        const statusText = parts[1].replace(/["']/g, '').trim().toLowerCase();
        if (!phone) continue;

        if (SMPP_DELIVERED_STATUSES.has(statusText)) {
          deliveredNumbers.push(phone);
        } else {
          failedNumbers.push(phone);
        }
      } else if (parts.length === 1) {
        // If only phone number is provided in a list, assume Delivered
        const cleanPhone = parts[0].replace(/["']/g, '').trim();
        const phone = normalizePhoneNumber(cleanPhone);
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

    // Allow Approved, Completed, AND Report Updated (for Admin DLR revisions)
    if (!['Approved', 'Completed', 'Report Updated'].includes(campaign.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot process delivery report for campaign in status "${campaign.status}".` });
    }

    const isRevision = Boolean(campaign.report_processed_at || campaign.status === 'Report Updated');
    const prevFailed = parseInt(campaign.failed_count, 10) || 0;

    // If re-uploading / revising, reset all recipients to Pending first
    if (isRevision) {
      await client.query(`UPDATE campaign_recipients SET status = 'Pending', updated_at = NOW() WHERE campaign_id = $1`, [campaignId]);
    }

    // Update delivered statuses in campaign_recipients in chunks (strictly scoped to this campaign_id)
    const BATCH_SIZE = 2000;
    for (let i = 0; i < deliveredNumbers.length; i += BATCH_SIZE) {
      const chunk = deliveredNumbers.slice(i, i + BATCH_SIZE);
      await client.query(
        `UPDATE campaign_recipients SET status = 'Delivered', updated_at = NOW() 
         WHERE campaign_id = $1 AND phone_number = ANY($2::text[])`,
        [campaignId, chunk]
      );
    }

    // Mark explicit failed numbers in campaign_recipients in chunks
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

    // If treatMissingAsFailed is explicitly true, mark unconfirmed pending recipients as Failed
    const treatMissingAsFailed = req.body.treat_missing_as_failed === 'true' || req.body.treatMissingAsFailed === 'true';
    if (treatMissingAsFailed) {
      await client.query(
        `UPDATE campaign_recipients SET status = 'Failed', updated_at = NOW() 
         WHERE campaign_id = $1 AND status != 'Delivered'`,
        [campaignId]
      );
    }

    // Compute exact delivered and failed counts strictly from this campaign's database rows
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

    // Compute SMS multi-part credit multiplier if applicable
    let refundMultiplier = 1;
    if (campaign.channel_type === 'sms' && typeof calculateSmsMetrics === 'function') {
      const smsMetrics = calculateSmsMetrics(campaign.message_text);
      refundMultiplier = smsMetrics.parts_count || 1;
    }

    // Check campaign owner's refund destination rule
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

    let netRefundDelta = 0;

    if (!isRevision) {
      // INITIAL REPORT SETTLEMENT
      if (actualFailed > 0 && !campaign.failed_refunded) {
        const refundCredits = actualFailed * refundMultiplier;
        netRefundDelta = refundCredits;

        // Add credits to beneficiary wallet
        await client.query(`
          INSERT INTO user_credits (user_id, credit_type, destination, balance)
          VALUES ($2, $3, $4, $1)
          ON CONFLICT (user_id, credit_type, destination)
          DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance
        `, [refundCredits, refundRecipientId, campaign.campaign_type, campaign.destination]);

        const refundReason = isRoutedToReseller
          ? `Auto-refund for ${actualFailed} failed deliveries in Campaign #${campaignId} ("${campaign.title}") of client ${owner.email} (${refundCredits} credits)`
          : `Auto-refund for ${actualFailed} failed deliveries in campaign #${campaignId} (${refundCredits} credits)`;

        await client.query(`
          INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, tax_mode, base_amount, gst_amount, refund_client_email, refund_campaign_id, direction)
          VALUES ($1, $2, $3, $4, $5, $6, 'non_gst', 0.00, 0.00, $7, $8, 'refund')
        `, [req.user.id, refundRecipientId, campaign.campaign_type, campaign.destination, refundCredits, refundReason, owner ? owner.email : null, campaignId]);

        await client.query(`UPDATE campaigns SET failed_refunded = TRUE WHERE id = $1`, [campaignId]);
      }
    } else {
      // REVISION / RE-RECONCILIATION DELTA SETTLEMENT
      const deltaFailedCount = actualFailed - prevFailed;
      const deltaCredits = deltaFailedCount * refundMultiplier;
      netRefundDelta = deltaCredits;

      if (deltaCredits > 0) {
        // More failed than previously: Grant additional refund
        await client.query(`
          INSERT INTO user_credits (user_id, credit_type, destination, balance)
          VALUES ($2, $3, $4, $1)
          ON CONFLICT (user_id, credit_type, destination)
          DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance
        `, [deltaCredits, refundRecipientId, campaign.campaign_type, campaign.destination]);

        const refundReason = isRoutedToReseller
          ? `DLR Revision (+): Additional refund for ${deltaFailedCount} failed deliveries in Campaign #${campaignId} of client ${owner.email} (+${deltaCredits} credits)`
          : `DLR Revision (+): Additional refund for ${deltaFailedCount} failed deliveries in campaign #${campaignId} (+${deltaCredits} credits)`;

        await client.query(`
          INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, tax_mode, base_amount, gst_amount, refund_client_email, refund_campaign_id, direction)
          VALUES ($1, $2, $3, $4, $5, $6, 'non_gst', 0.00, 0.00, $7, $8, 'refund')
        `, [req.user.id, refundRecipientId, campaign.campaign_type, campaign.destination, deltaCredits, refundReason, owner ? owner.email : null, campaignId]);
      } else if (deltaCredits < 0) {
        // Fewer failed than previously: Deduct over-refunded credits safely without allowing negative balance
        const deductionAmt = Math.abs(deltaCredits);

        const walletRes = await client.query(`
          SELECT balance FROM user_credits 
          WHERE user_id = $1 AND credit_type = $2 AND destination = $3
          FOR UPDATE
        `, [refundRecipientId, campaign.campaign_type, campaign.destination]);

        const currentBalance = walletRes.rows.length > 0 ? Number(walletRes.rows[0].balance) : 0;
        const actualDeduction = Math.min(deductionAmt, currentBalance);
        const uncollectibleDeficit = deductionAmt - actualDeduction;

        if (actualDeduction > 0) {
          await client.query(`
            UPDATE user_credits 
            SET balance = balance - $1 
            WHERE user_id = $2 AND credit_type = $3 AND destination = $4
          `, [actualDeduction, refundRecipientId, campaign.campaign_type, campaign.destination]);
        }

        let adjustReason = isRoutedToReseller
          ? `DLR Revision (-): Reversal adjustment for ${Math.abs(deltaFailedCount)} recovered deliveries in Campaign #${campaignId} of client ${owner.email} (-${actualDeduction} credits)`
          : `DLR Revision (-): Reversal adjustment for ${Math.abs(deltaFailedCount)} recovered deliveries in campaign #${campaignId} (-${actualDeduction} credits)`;

        if (uncollectibleDeficit > 0) {
          adjustReason += ` [Warning: ${uncollectibleDeficit} credits uncollectible due to insufficient wallet balance]`;
        }

        // Note: direction is 'debit' and refund_campaign_id is null so this reversal is never classified as a positive refund!
        await client.query(`
          INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, tax_mode, base_amount, gst_amount, refund_client_email, refund_campaign_id, direction)
          VALUES ($1, $2, $3, $4, $5, $6, 'non_gst', 0.00, 0.00, $7, NULL, 'debit')
        `, [req.user.id, refundRecipientId, campaign.campaign_type, campaign.destination, actualDeduction, adjustReason, owner ? owner.email : null]);
      }
    }

    // Update campaign record with new counts
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
      action: isRevision ? 'delivery_report_re_processed' : 'delivery_report_processed',
      details: { 
        isRevision,
        previousFailedCount: prevFailed,
        deliveredCount: actualDelivered, 
        failedCount: actualFailed, 
        refundDelta: netRefundDelta, 
        sourceFile: reportFile.originalname, 
        reason: String(req.body.reason || (isRevision ? 'Super Admin revised DLR delivery report' : 'Verified external delivery report')).slice(0, 1000) 
      }
    });

    await client.query('COMMIT');

    return res.json({
      message: isRevision ? 'Delivery report revised successfully!' : 'Report processed successfully!',
      isRevision,
      deliveredCount: actualDelivered,
      failedCount: actualFailed,
      refundedCredits: netRefundDelta
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Process report error:', err);
    return res.status(500).json({ error: 'Failed to process report: ' + err.message });
  } finally {
    client.release();
    if (reportFile && reportFile.path) fs.unlink(reportFile.path, () => {});
  }
});

// GET /api/campaigns/operator/queue - Get campaigns waiting for dispatch (Super Admin only, paginated & lean)
router.get('/operator/queue', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const sql = `
      SELECT 
        c.id, c.user_id, c.title, c.credit_type, c.destination, c.channel_type, c.campaign_type,
        c.status, c.total_numbers, c.delivered_count, c.failed_count, c.credits_used,
        c.scheduled_at, c.created_at, c.updated_at, c.media_url, c.attachments,
        c.message_text,
        u.email as owner_email,
        COUNT(*) OVER() AS total_queue_count
      FROM campaigns c
      JOIN users u ON c.user_id = u.id
      WHERE c.status IN ('Submitted', 'Approved')
        AND COALESCE(c.channel_type, 'whatsapp') != 'sms'
        AND COALESCE(c.campaign_type, '') != 'gsm_sms'
      ORDER BY 
        CASE WHEN c.scheduled_at IS NOT NULL AND c.scheduled_at <= NOW() THEN 0 ELSE 1 END,
        c.created_at ASC
      LIMIT $1 OFFSET $2
    `;
    const result = await query(sql, [limit, offset]);
    const totalCount = parseInt(result.rows[0]?.total_queue_count || 0, 10);

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

    if (req.query.paginate === 'true') {
      return res.json({
        queue: campaigns,
        total: totalCount,
        limit,
        offset
      });
    }

    return res.json(campaigns);
  } catch (err) {
    console.error('Operator queue error:', err);
    return res.status(500).json({ error: 'Failed to load operator queue' });
  }
});

// GET /api/campaigns/operator/bulk-export - 1-Click ZIP Package containing numbers + messages + media for offline dispatch (Super Admin only)
router.get('/operator/bulk-export', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    let campaignsQuery = '';
    let params = [];

    if (req.query.campaign_ids) {
      const ids = req.query.campaign_ids.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      if (ids.length === 0) return res.status(400).json({ error: 'Invalid campaign IDs' });
      campaignsQuery = `
        SELECT c.*, u.email as owner_email
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        WHERE c.id = ANY($1::int[])
        ORDER BY c.id ASC
      `;
      params = [ids];
    } else {
      campaignsQuery = `
        SELECT c.*, u.email as owner_email
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        WHERE c.status IN ('Submitted', 'Approved')
          AND COALESCE(c.channel_type, 'whatsapp') != 'sms'
          AND COALESCE(c.campaign_type, '') != 'gsm_sms'
        ORDER BY c.id ASC
      `;
    }

    const campResult = await query(campaignsQuery, params);
    if (campResult.rows.length === 0) {
      return res.status(404).send('No pending campaigns found for export.');
    }

    const campaigns = campResult.rows;

    // Audit logging for bulk dispatch export
    const auditClient = await getClient();
    try {
      await auditClient.query('BEGIN');
      await logAudit(auditClient, {
        actorId: req.user.id,
        entityType: 'campaign',
        entityId: campaigns[0] ? campaigns[0].id : null,
        action: 'operator_bulk_export_downloaded',
        details: {
          campaignCount: campaigns.length,
          campaignIds: campaigns.map(c => c.id)
        }
      });
      await auditClient.query('COMMIT');
    } catch (auditErr) {
      await auditClient.query('ROLLBACK');
      console.error('Bulk export audit log error:', auditErr);
    } finally {
      auditClient.release();
    }

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
    let manifestCsv = 'Campaign ID,Title,User Email,Status,Total Numbers,Channel Type,Campaign Type,Destination,Scheduled At,Created At\n';

    for (const c of campaigns) {
      const safeId = sanitizeCsvCell(c.id);
      const safeTitle = sanitizeCsvCell(c.title || 'Campaign_' + c.id);
      const safeEmail = sanitizeCsvCell(c.owner_email);
      const safeStatus = sanitizeCsvCell(c.status);
      const safeTotal = sanitizeCsvCell(c.total_numbers);
      const safeChannel = sanitizeCsvCell(c.channel_type);
      const safeType = sanitizeCsvCell(c.campaign_type);
      const safeDest = sanitizeCsvCell(c.destination);
      const safeSched = sanitizeCsvCell(c.scheduled_at || 'Immediate');
      const safeDate = sanitizeCsvCell(c.created_at);
      manifestCsv += `${safeId},${safeTitle},${safeEmail},${safeStatus},${safeTotal},${safeChannel},${safeType},${safeDest},${safeSched},${safeDate}\n`;

      const safeFolder = `Campaign_${c.id}_${(c.title || 'Untitled').replace(/[^a-zA-Z0-9_-]/g, '_')}`;

      // 2. Fetch recipients
      const recipientsRes = await query(`
        SELECT phone_number FROM campaign_recipients WHERE campaign_id = $1 ORDER BY id ASC
      `, [c.id]);

      const numbersTxt = recipientsRes.rows.map(r => r.phone_number).join('\n');
      const numbersCsv = 'Mobile Number\n' + recipientsRes.rows.map(r => sanitizeCsvCell(r.phone_number)).join('\n');

      archive.append(numbersTxt, { name: `${safeFolder}/numbers.txt` });
      archive.append(numbersCsv, { name: `${safeFolder}/numbers.csv` });

      // 3. Format message payload file
      let messagePayload = `=======================================================\n`;
      messagePayload += `CAMPAIGN #${c.id}: ${c.title || 'Untitled'}\n`;
      messagePayload += `Owner: ${c.owner_email}\n`;
      messagePayload += `Status: ${c.status}\n`;
      messagePayload += `Route: ${c.campaign_type} (${c.destination})\n`;
      messagePayload += `Total Recipients: ${c.total_numbers}\n`;
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

// POST /api/campaigns/operator/bulk-status - Bulk update status for multiple campaigns (Super Admin only)
router.post('/operator/bulk-status', authenticate, requireRoles('admin'), async (req, res) => {
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
         FOR UPDATE OF c`,
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
