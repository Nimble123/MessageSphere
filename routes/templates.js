const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

// Multer storage for message template media attachments (Image, PDF, Video)
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max limit
});

// GSM-7 Basic & Extended Character Set (Standard Latin Telecom Specification 3GPP TS 23.038)
const GSM_7_EXTENDED_CHARS = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);
const GSM_7_REGEX = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#$%&'()*+,\-./:;<=>?¡¿\^{}\[~\]|€]*$/;

// Calculate SMS Segments & Encoding based on exact GSM rules
function calculateTemplateMetrics(text, channel = 'whatsapp') {
  const content = String(text || '').trim();
  const rawGlyphCount = Array.from(content).length;

  if (channel === 'whatsapp') {
    return {
      character_count: rawGlyphCount,
      is_unicode: false,
      parts_count: 1,
      carrier_warning: null
    };
  }

  // Check if any character triggers Unicode (e.g. Hindi, Emojis, Regional scripts)
  const isUnicode = !GSM_7_REGEX.test(content);

  let effectiveCharCount = 0;
  let partsCount = 1;

  if (isUnicode) {
    effectiveCharCount = rawGlyphCount;
    // Unicode Rule: Single = 70 chars; Multi-part = 67 chars per part
    if (effectiveCharCount > 70) {
      partsCount = Math.ceil(effectiveCharCount / 67);
    }
  } else {
    // GSM-7 Rule: basic chars count as 1, extended chars (^ { } \ [ ~ ] | €) count as 2
    for (const ch of content) {
      effectiveCharCount += GSM_7_EXTENDED_CHARS.has(ch) ? 2 : 1;
    }
    // GSM-7 Rule: Single = 160 chars; Multi-part = 153 chars per part
    if (effectiveCharCount > 160) {
      partsCount = Math.ceil(effectiveCharCount / 153);
    }
  }

  let carrierWarning = null;
  if (partsCount >= 5) {
    carrierWarning = `High Segment Warning: Message requires ${partsCount} SMS parts (${partsCount} credits per number). Carriers may throttle or drop messages exceeding 4 parts.`;
  }

  return {
    character_count: effectiveCharCount,
    is_unicode: isUnicode,
    parts_count: partsCount || 1,
    carrier_warning: carrierWarning
  };
}

// Unified Template Access Checker
async function checkTemplateAccess(templateId, user) {
  const isSuperAdmin = user.role === 'admin';
  const isReseller = user.role === 'reseller';

  let sql = 'SELECT * FROM templates WHERE id = $1';
  let params = [templateId];

  if (!isSuperAdmin) {
    if (isReseller) {
      sql += ' AND (user_id = $2 OR user_id IN (SELECT id FROM users WHERE reseller_id = $2))';
      params.push(user.id);
    } else {
      sql += ' AND user_id = $2';
      params.push(user.id);
    }
  }

  const res = await query(sql, params);
  return res.rows[0] || null;
}

// Pre-built Starter Templates for 1-Click Library (All Marketing)
const STARTER_TEMPLATES = [
  // WhatsApp Marketing Starters with CTA Buttons & Attachments
  {
    title: 'Festive Mega Offer (CTA Buttons + Media)',
    channel: 'whatsapp',
    template_type: 'cta',
    category: 'MARKETING',
    media_type: 'image',
    attachment_name: 'festive_sale.jpg',
    attachment_url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=700&q=80',
    content: '🎉 Festive Special! Enjoy up to 50% OFF on all premium collections. Use promo code FESTIVE50 at checkout.\n\nClick the buttons below to visit our store or speak to an advisor directly!',
    cta_data: {
      url_text: 'Shop Now (50% OFF)',
      url_link: 'https://messagesphere.com/shop',
      call_text: 'Call Sales Support',
      call_number: '+919876543210'
    }
  },
  {
    title: 'Flash Sale 24 Hours Only (CTA Buttons)',
    channel: 'whatsapp',
    template_type: 'cta',
    category: 'MARKETING',
    media_type: 'none',
    attachment_name: '',
    attachment_url: '',
    content: '⚡ FLASH SALE ALERT! Flat 40% OFF on your favorite items for the next 24 hours only. Don\'t miss out!\n\nTap below to claim your discount coupon before the timer expires.',
    cta_data: {
      url_text: 'Claim 40% Discount',
      url_link: 'https://messagesphere.com/flash-sale',
      call_text: 'Instant Helpline',
      call_number: '+919876543210'
    }
  },
  {
    title: 'New Collection Launch (Banner Media)',
    channel: 'whatsapp',
    template_type: 'standard',
    category: 'MARKETING',
    media_type: 'image',
    attachment_name: 'new_collection.jpg',
    attachment_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=80',
    content: '🚀 Just Dropped! Explore our brand new collection online with exclusive early bird discounts. Browse catalog: https://messagesphere.com/new'
  },
  {
    title: 'Exclusive VIP Club Discount (Text)',
    channel: 'whatsapp',
    template_type: 'standard',
    category: 'MARKETING',
    media_type: 'none',
    attachment_name: '',
    attachment_url: '',
    content: '👑 Exclusive VIP Offer: Because you are a valued member, get an extra 20% discount + FREE express shipping on your next purchase. Use code: VIP20'
  },

  // SMS (GSM) Marketing Starters
  {
    title: 'Flash Sale Alert (GSM-7 Latin)',
    channel: 'sms',
    template_type: 'standard',
    category: 'MARKETING',
    media_type: 'none',
    attachment_name: '',
    attachment_url: '',
    content: 'FLASH SALE: 40% OFF today only on all items! Visit your nearest store or order online at msg.im/sale. Opt-out reply STOP'
  },
  {
    title: 'Weekend Special Voucher (GSM-7 Latin)',
    channel: 'sms',
    template_type: 'standard',
    category: 'MARKETING',
    media_type: 'none',
    attachment_name: '',
    attachment_url: '',
    content: 'Weekend Special: Get flat Rs.500 OFF on orders above Rs.1999. Use voucher WEEKEND500 at checkout. Valid till Sunday midnight: msg.im/deal'
  },
  {
    title: 'Limited Stock Clearance (GSM-7 Latin)',
    channel: 'sms',
    template_type: 'standard',
    category: 'MARKETING',
    media_type: 'none',
    attachment_name: '',
    attachment_url: '',
    content: 'CLEARANCE SALE: Up to 60% OFF on remaining stock. Hurry, offers valid until stocks last! Shop: msg.im/clearance'
  },
  {
    title: 'Diwali Hindi Wishes (Unicode Regional)',
    channel: 'sms',
    template_type: 'standard',
    category: 'MARKETING',
    media_type: 'none',
    attachment_name: '',
    attachment_url: '',
    content: 'दिवाली की हार्दिक शुभकामनाएं! इस पावन पर्व पर हमारे सभी उत्पादों पर 50% की विशेष छूट पाएं। आज ही ऑर्डर करें: msg.im/diwali'
  }
];

// GET /api/templates/starters - List pre-built starter templates
router.get('/starters', authenticate, async (req, res) => {
  return res.json(STARTER_TEMPLATES);
});

// GET /api/templates/export/csv - Download user's templates as CSV
router.get('/export/csv', authenticate, async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === 'admin';
    const isReseller = req.user.role === 'reseller';

    let sql = `
      SELECT t.id, t.title, t.channel, t.template_type, t.attachment_url, t.cta_data, t.category, t.is_unicode, t.character_count, t.parts_count, t.content, t.created_at, u.email as owner_email
      FROM templates t
      JOIN users u ON t.user_id = u.id
    `;
    let params = [];
    if (!isSuperAdmin) {
      if (isReseller) {
        sql += ' WHERE (t.user_id = $1 OR t.user_id IN (SELECT id FROM users WHERE reseller_id = $1))';
        params.push(req.user.id);
      } else {
        sql += ' WHERE t.user_id = $1';
        params.push(req.user.id);
      }
    }
    sql += ' ORDER BY t.created_at DESC';

    const result = await query(sql, params);

    // Build CSV with UTF-8 BOM so Hindi/Unicode characters open cleanly in Excel
    let csv = '\uFEFF"ID","Title","Channel","Format Type","Category","Encoding","Characters","SMS Parts","Attachment URL","CTA Web Link","CTA Call Phone","Owner","Created At","Message Content"\n';
    for (const r of result.rows) {
      const isSms = r.channel === 'sms';
      const encoding = isSms ? (r.is_unicode ? 'Unicode' : 'GSM-7') : 'WhatsApp (1 Credit)';
      const safeTitle = (r.title || '').replace(/"/g, '""');
      const safeContent = (r.content || '').replace(/"/g, '""');
      const safeOwner = (r.owner_email || '').replace(/"/g, '""');
      const safeCreated = r.created_at ? new Date(r.created_at).toISOString() : '';
      const safeFormat = (r.template_type || 'standard').toUpperCase();
      const safeAttachment = (r.attachment_url || '').replace(/"/g, '""');
      let ctaLink = '';
      let ctaCall = '';
      if (r.cta_data) {
        const cta = typeof r.cta_data === 'string' ? JSON.parse(r.cta_data) : r.cta_data;
        if (cta.url_link) ctaLink = `${cta.url_text || 'Link'}: ${cta.url_link}`;
        if (cta.call_number) ctaCall = `${cta.call_text || 'Call'}: ${cta.call_number}`;
      }

      csv += `"${r.id}","${safeTitle}","${r.channel}","${safeFormat}","${r.category || 'MARKETING'}","${encoding}","${r.character_count || 0}","${r.parts_count || 1}","${safeAttachment}","${ctaLink.replace(/"/g, '""')}","${ctaCall.replace(/"/g, '""')}","${safeOwner}","${safeCreated}","${safeContent}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="MessageSphere_Marketing_Templates.csv"');
    return res.send(csv);
  } catch (err) {
    console.error('Export templates CSV error:', err);
    return res.status(500).json({ error: 'Failed to export templates' });
  }
});

// GET /api/templates - List templates with role filtering & search
router.get('/', authenticate, async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === 'admin';
    const isReseller = req.user.role === 'reseller';
    const channel = req.query.channel; // 'whatsapp' or 'sms'
    const category = req.query.category;
    const search = (req.query.search || '').trim().toLowerCase();
    const targetUserId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;

    let baseSql = `
      SELECT t.*, u.email as owner_email, u.role as owner_role
      FROM templates t
      JOIN users u ON t.user_id = u.id
    `;
    let whereClauses = [];
    let params = [];

    // Role-based visibility
    if (isSuperAdmin) {
      if (targetUserId) {
        params.push(targetUserId);
        whereClauses.push(`t.user_id = $${params.length}`);
      }
    } else if (isReseller) {
      params.push(req.user.id);
      if (targetUserId) {
        params.push(targetUserId);
        whereClauses.push(`(t.user_id = $${params.length} AND (t.user_id = $1 OR t.user_id IN (SELECT id FROM users WHERE reseller_id = $1)))`);
      } else {
        whereClauses.push(`(t.user_id = $1 OR t.user_id IN (SELECT id FROM users WHERE reseller_id = $1) OR t.user_id IN (SELECT id FROM users WHERE role = 'admin'))`);
      }
    } else {
      params.push(req.user.id);
      whereClauses.push(`(t.user_id = $1 OR t.user_id IN (SELECT id FROM users WHERE role = 'admin'))`);
    }

    // Filter by channel (whatsapp / sms)
    if (channel && (channel === 'whatsapp' || channel === 'sms')) {
      params.push(channel);
      whereClauses.push(`t.channel = $${params.length}`);
    }

    // Filter by category
    if (category) {
      params.push(category.toUpperCase());
      whereClauses.push(`UPPER(t.category) = $${params.length}`);
    }

    // Filter by search query
    if (search) {
      params.push(`%${search}%`);
      whereClauses.push(`(LOWER(t.title) LIKE $${params.length} OR LOWER(t.content) LIKE $${params.length})`);
    }

    const whereStr = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sql = `${baseSql} ${whereStr} ORDER BY t.created_at DESC`;

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('List templates error:', err);
    return res.status(500).json({ error: 'Failed to load templates' });
  }
});

// POST /api/templates - Create new template (with GSM / WhatsApp calculation & Multi-Attachments)
router.post('/', authenticate, upload.any(), async (req, res) => {
  const { title, channel, template_type, cta_data, category, sub_category, content, body, target_user_id } = req.body;
  const templateText = String(content || body || '').trim();

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Template title is required' });
  }
  if (!templateText) {
    return res.status(400).json({ error: 'Template message content is required' });
  }

  const cleanChannel = (channel === 'sms') ? 'sms' : 'whatsapp';
  const cleanType = (cleanChannel === 'whatsapp' && template_type === 'cta') ? 'cta' : 'standard';

  let attachments = [];

  if (cleanChannel === 'whatsapp') {
    // Process any uploaded files
    if (Array.isArray(req.files) && req.files.length > 0) {
      req.files.forEach(file => {
        let type = 'image';
        const ext = path.extname(file.originalname).toLowerCase();
        const mime = file.mimetype || '';
        if (file.fieldname === 'pdf_file' || mime === 'application/pdf' || ext === '.pdf') {
          type = 'pdf';
        } else if (file.fieldname === 'video_file' || mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext)) {
          type = 'video';
        } else {
          type = 'image';
        }
        attachments.push({
          slot: file.fieldname,
          type,
          url: '/uploads/' + file.filename,
          filename: file.originalname,
          size: file.size,
          mimetype: file.mimetype
        });
      });
    }
  }

  const primary = attachments[0] || null;
  const cleanAttachment = primary ? primary.url : null;
  const cleanMediaType = primary ? primary.type : 'none';
  const cleanAttachmentName = primary ? primary.filename : null;
  const cleanAttachmentSize = primary ? primary.size : 0;

  let cleanCta = null;
  if (cleanType === 'cta' && cta_data) {
    cleanCta = (typeof cta_data === 'object') ? JSON.stringify(cta_data) : cta_data;
  }

  const cleanCat = 'MARKETING';
  const cleanSubCat = 'MARKETING';

  // Determine effective user ID for proxy creation (Admin & Reseller)
  let effectiveUserId = req.user.id;
  if (target_user_id && (req.user.role === 'admin' || req.user.role === 'reseller')) {
    const targetInt = parseInt(target_user_id, 10);
    if (!isNaN(targetInt)) {
      if (req.user.role === 'admin') {
        effectiveUserId = targetInt;
      } else {
        const check = await query('SELECT id FROM users WHERE id = $1 AND (id = $2 OR reseller_id = $2)', [targetInt, req.user.id]);
        if (check.rows.length > 0) effectiveUserId = targetInt;
      }
    }
  }

  // Calculate GSM/Unicode parameters
  const metrics = calculateTemplateMetrics(templateText, cleanChannel);

  try {
    const result = await query(`
      INSERT INTO templates (user_id, channel, template_type, attachment_url, media_type, attachment_name, attachment_size, attachments, cta_data, title, category, sub_category, content, is_unicode, character_count, parts_count, is_approved)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, TRUE)
      RETURNING *
    `, [
      effectiveUserId,
      cleanChannel,
      cleanType,
      cleanAttachment,
      cleanMediaType,
      cleanAttachmentName,
      cleanAttachmentSize,
      JSON.stringify(attachments),
      cleanCta,
      title.trim().slice(0, 255),
      cleanCat,
      cleanSubCat,
      templateText,
      metrics.is_unicode,
      metrics.character_count,
      metrics.parts_count
    ]);

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create template error:', err);
    return res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /api/templates/:id - Update existing template
router.put('/:id', authenticate, upload.any(), async (req, res) => {
  const templateId = parseInt(req.params.id, 10);
  const { title, channel, template_type, cta_data, category, sub_category, content, body, remove_attachment, existing_attachments } = req.body;
  const templateText = String(content || body || '').trim();

  if (isNaN(templateId)) return res.status(400).json({ error: 'Invalid template ID' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'Template title is required' });
  if (!templateText) return res.status(400).json({ error: 'Template message content is required' });

  try {
    const existing = await checkTemplateAccess(templateId, req.user);
    if (!existing) {
      return res.status(404).json({ error: 'Template not found or unauthorized' });
    }

    const cleanChannel = channel ? ((channel === 'sms') ? 'sms' : 'whatsapp') : (existing.channel || 'whatsapp');
    const cleanType = (cleanChannel === 'whatsapp' && (template_type === 'cta' || template_type === 'standard')) 
      ? template_type 
      : (existing.template_type || 'standard');

    let attachments = [];
    if (cleanChannel === 'whatsapp' && remove_attachment !== 'true' && remove_attachment !== true) {
      // Keep any retained existing attachments
      if (existing_attachments) {
        try {
          const parsed = typeof existing_attachments === 'string' ? JSON.parse(existing_attachments) : existing_attachments;
          if (Array.isArray(parsed)) attachments = parsed;
        } catch(e) {}
      } else if (!req.files || req.files.length === 0) {
        // If no new files and no explicit existing list, preserve existing attachments
        if (existing.attachments) {
          try {
            attachments = typeof existing.attachments === 'string' ? JSON.parse(existing.attachments) : existing.attachments;
          } catch(e) {}
        }
        if ((!attachments || attachments.length === 0) && existing.attachment_url) {
          attachments = [{
            slot: 'primary',
            type: existing.media_type || 'image',
            url: existing.attachment_url,
            filename: existing.attachment_name || 'attachment',
            size: existing.attachment_size || 0
          }];
        }
      }

      // Append newly uploaded files
      if (Array.isArray(req.files) && req.files.length > 0) {
        req.files.forEach(file => {
          let type = 'image';
          const ext = path.extname(file.originalname).toLowerCase();
          const mime = file.mimetype || '';
          if (file.fieldname === 'pdf_file' || mime === 'application/pdf' || ext === '.pdf') {
            type = 'pdf';
          } else if (file.fieldname === 'video_file' || mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext)) {
            type = 'video';
          } else {
            type = 'image';
          }
          // Remove any previous file in the same slot
          attachments = attachments.filter(a => a.slot !== file.fieldname);
          attachments.push({
            slot: file.fieldname,
            type,
            url: '/uploads/' + file.filename,
            filename: file.originalname,
            size: file.size,
            mimetype: file.mimetype
          });
        });
      }
    }

    const primary = attachments[0] || null;
    const cleanAttachment = primary ? primary.url : null;
    const cleanMediaType = primary ? primary.type : 'none';
    const cleanAttachmentName = primary ? primary.filename : null;
    const cleanAttachmentSize = primary ? primary.size : 0;

    let cleanCta = null;
    if (cleanType === 'cta') {
      if (cta_data !== undefined) {
        cleanCta = (typeof cta_data === 'object') ? JSON.stringify(cta_data) : cta_data;
      } else {
        cleanCta = existing.cta_data;
      }
    }

    const cleanCat = 'MARKETING';
    const cleanSubCat = 'MARKETING';

    const metrics = calculateTemplateMetrics(templateText, cleanChannel);

    const result = await query(`
      UPDATE templates
      SET title = $1, channel = $2, template_type = $3, attachment_url = $4,
          media_type = $5, attachment_name = $6, attachment_size = $7, attachments = $8, cta_data = $9,
          category = $10, sub_category = $11, content = $12,
          is_unicode = $13, character_count = $14, parts_count = $15
      WHERE id = $16
      RETURNING *
    `, [
      title.trim().slice(0, 255),
      cleanChannel,
      cleanType,
      cleanAttachment,
      cleanMediaType,
      cleanAttachmentName,
      cleanAttachmentSize,
      JSON.stringify(attachments),
      cleanCta,
      cleanCat,
      cleanSubCat,
      templateText,
      metrics.is_unicode,
      metrics.character_count,
      metrics.parts_count,
      templateId
    ]);

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update template error:', err);
    return res.status(500).json({ error: 'Failed to update template' });
  }
});

// POST /api/templates/:id/duplicate - 1-Click Duplicate Template
router.post('/:id/duplicate', authenticate, async (req, res) => {
  const templateId = parseInt(req.params.id, 10);
  if (isNaN(templateId)) return res.status(400).json({ error: 'Invalid template ID' });

  try {
    const existing = await checkTemplateAccess(templateId, req.user);
    if (!existing) return res.status(404).json({ error: 'Template not found or unauthorized' });

    const newTitle = `${existing.title} (Copy)`.slice(0, 255);
    const result = await query(`
      INSERT INTO templates (user_id, channel, template_type, attachment_url, media_type, attachment_name, attachment_size, attachments, cta_data, title, category, sub_category, content, is_unicode, character_count, parts_count, is_approved)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, TRUE)
      RETURNING *
    `, [
      req.user.id,
      existing.channel || 'whatsapp',
      existing.template_type || 'standard',
      existing.attachment_url,
      existing.media_type || 'none',
      existing.attachment_name,
      existing.attachment_size || 0,
      existing.attachments || '[]',
      existing.cta_data,
      newTitle,
      existing.category,
      existing.sub_category,
      existing.content,
      existing.is_unicode,
      existing.character_count,
      existing.parts_count
    ]);

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Duplicate template error:', err);
    return res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

// PATCH /api/templates/:id/status - Toggle template active / approved status (Admin & Reseller for clients)
router.patch('/:id/status', authenticate, async (req, res) => {
  const templateId = parseInt(req.params.id, 10);
  const isApproved = req.body.is_approved === true || req.body.status === 'Approved';

  try {
    const existing = await checkTemplateAccess(templateId, req.user);
    if (!existing) return res.status(404).json({ error: 'Template not found or unauthorized' });

    const result = await query(`
      UPDATE templates SET is_approved = $1 WHERE id = $2 RETURNING *
    `, [isApproved, templateId]);

    return res.json({ message: `Template ${isApproved ? 'activated' : 'deactivated'} successfully`, template: result.rows[0] });
  } catch (err) {
    console.error('Update template status error:', err);
    return res.status(500).json({ error: 'Failed to update template status' });
  }
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', authenticate, async (req, res) => {
  const templateId = parseInt(req.params.id, 10);
  if (isNaN(templateId)) return res.status(400).json({ error: 'Invalid template ID' });

  try {
    const existing = await checkTemplateAccess(templateId, req.user);
    if (!existing) return res.status(404).json({ error: 'Template not found or unauthorized' });

    await query('DELETE FROM templates WHERE id = $1', [templateId]);
    return res.json({ message: 'Template deleted successfully' });
  } catch (err) {
    console.error('Delete template error:', err);
    return res.status(500).json({ error: 'Failed to delete template' });
  }
});

module.exports = router;
