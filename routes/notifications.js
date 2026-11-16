const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate, requireRoles } = require('../middleware/auth');
const {
  getNotificationSettings,
  updateNotificationSettings,
  sendTelegramMessage,
  sendWebhookNotification
} = require('../services/notifications');

/**
 * GET /api/notifications/alerts
 * Returns recent campaign alerts with unread counter.
 * Super Admin sees ALL platform campaign alerts.
 * Resellers see alerts for their mapped child clients.
 */
router.get('/alerts', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const unreadOnly = req.query.unread_only === 'true';

    let listSql = '';
    let countSql = '';
    let params = [];

    if (req.user.role === 'admin') {
      params = [limit];
      listSql = `
        SELECT a.*, c.title as current_campaign_title, c.status as current_status
        FROM admin_campaign_alerts a
        LEFT JOIN campaigns c ON a.campaign_id = c.id
        ${unreadOnly ? 'WHERE a.is_read = FALSE' : ''}
        ORDER BY a.created_at DESC
        LIMIT $1
      `;
      countSql = `SELECT COUNT(*) as unread_count FROM admin_campaign_alerts WHERE is_read = FALSE`;
    } else {
      // Reseller
      params = [req.user.id, limit];
      listSql = `
        SELECT a.*, c.title as current_campaign_title, c.status as current_status
        FROM admin_campaign_alerts a
        LEFT JOIN campaigns c ON a.campaign_id = c.id
        WHERE (a.reseller_id = $1 OR a.user_id = $1)
        ${unreadOnly ? 'AND a.is_read = FALSE' : ''}
        ORDER BY a.created_at DESC
        LIMIT $2
      `;
      countSql = `
        SELECT COUNT(*) as unread_count 
        FROM admin_campaign_alerts 
        WHERE (reseller_id = $1 OR user_id = $1) AND is_read = FALSE
      `;
    }

    const [listRes, countRes] = await Promise.all([
      query(listSql, params),
      req.user.role === 'admin' ? query(countSql) : query(countSql, [req.user.id])
    ]);

    const unreadCount = parseInt(countRes.rows[0]?.unread_count || 0, 10);

    return res.json({
      alerts: listRes.rows,
      unreadCount
    });
  } catch (err) {
    console.error('Fetch campaign alerts error:', err);
    return res.status(500).json({ error: 'Failed to fetch campaign alerts' });
  }
});

/**
 * POST /api/notifications/alerts/:id/read
 * Marks a campaign alert as read
 */
router.post('/alerts/:id/read', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    const alertId = parseInt(req.params.id, 10);
    if (!alertId) return res.status(400).json({ error: 'Invalid alert ID' });

    if (req.user.role === 'admin') {
      await query(`UPDATE admin_campaign_alerts SET is_read = TRUE WHERE id = $1`, [alertId]);
    } else {
      await query(
        `UPDATE admin_campaign_alerts SET is_read = TRUE WHERE id = $1 AND (reseller_id = $2 OR user_id = $2)`,
        [alertId, req.user.id]
      );
    }

    return res.json({ success: true, message: 'Alert marked as read' });
  } catch (err) {
    console.error('Mark alert read error:', err);
    return res.status(500).json({ error: 'Failed to mark alert as read' });
  }
});

/**
 * POST /api/notifications/alerts/read-all
 * Marks all alerts as read
 */
router.post('/alerts/read-all', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      await query(`UPDATE admin_campaign_alerts SET is_read = TRUE WHERE is_read = FALSE`);
    } else {
      await query(
        `UPDATE admin_campaign_alerts SET is_read = TRUE WHERE (reseller_id = $1 OR user_id = $1) AND is_read = FALSE`,
        [req.user.id]
      );
    }

    return res.json({ success: true, message: 'All alerts marked as read' });
  } catch (err) {
    console.error('Mark all alerts read error:', err);
    return res.status(500).json({ error: 'Failed to mark all alerts as read' });
  }
});

/**
 * GET /api/notifications/settings
 * Super Admin only: returns external notification settings
 */
router.get('/settings', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const settings = await getNotificationSettings();
    // Mask token for safe UI display if set
    let maskedToken = '';
    if (settings.telegram_bot_token) {
      const tok = settings.telegram_bot_token;
      maskedToken = tok.length > 10 ? `${tok.slice(0, 6)}...${tok.slice(-4)}` : '••••••••';
    }

    return res.json({
      telegram_enabled: settings.telegram_enabled,
      telegram_chat_id: settings.telegram_chat_id,
      has_telegram_token: Boolean(settings.telegram_bot_token),
      masked_telegram_token: maskedToken,
      admin_alert_webhook: settings.admin_alert_webhook,
      webhook_enabled: settings.webhook_enabled,
      audio_chime_enabled: settings.audio_chime_enabled,
      desktop_push_enabled: settings.desktop_push_enabled
    });
  } catch (err) {
    console.error('Get notification settings error:', err);
    return res.status(500).json({ error: 'Failed to get notification settings' });
  }
});

/**
 * POST /api/notifications/settings
 * Super Admin only: updates notification settings
 */
router.post('/settings', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const {
      telegram_enabled,
      telegram_bot_token,
      telegram_chat_id,
      admin_alert_webhook,
      webhook_enabled,
      audio_chime_enabled,
      desktop_push_enabled
    } = req.body;

    const updates = {};
    if (telegram_enabled !== undefined) updates.telegram_enabled = telegram_enabled ? 'true' : 'false';
    if (telegram_chat_id !== undefined) updates.telegram_chat_id = String(telegram_chat_id).trim();
    if (admin_alert_webhook !== undefined) updates.admin_alert_webhook = String(admin_alert_webhook).trim();
    if (webhook_enabled !== undefined) updates.webhook_enabled = webhook_enabled ? 'true' : 'false';
    if (audio_chime_enabled !== undefined) updates.audio_chime_enabled = audio_chime_enabled ? 'true' : 'false';
    if (desktop_push_enabled !== undefined) updates.desktop_push_enabled = desktop_push_enabled ? 'true' : 'false';

    // Only update token if provided and non-empty (and not the masked string)
    if (telegram_bot_token && typeof telegram_bot_token === 'string' && !telegram_bot_token.includes('...')) {
      updates.telegram_bot_token = telegram_bot_token.trim();
    }

    await updateNotificationSettings(updates);
    return res.json({ success: true, message: 'Notification settings saved successfully' });
  } catch (err) {
    console.error('Update notification settings error:', err);
    return res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

/**
 * POST /api/notifications/test-telegram
 * Super Admin only: sends a live test message to verify Telegram Bot & Chat ID
 */
router.post('/test-telegram', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const current = await getNotificationSettings();
    let token = req.body.telegram_bot_token;
    if (!token || token.includes('...')) {
      token = current.telegram_bot_token;
    }
    const chatId = req.body.telegram_chat_id ? String(req.body.telegram_chat_id).trim() : current.telegram_chat_id;

    if (!token || !chatId) {
      return res.status(400).json({ error: 'Please enter both Telegram Bot Token and Chat ID to test.' });
    }

    const testTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const testMessage = 
`🔔 <b>MessageSphere Notification Test</b>
━━━━━━━━━━━━━━━━━━━━━
✅ <b>Status:</b> Telegram Bot Connected Successfully!
🛡 <b>Admin:</b> ${req.user.email}
🕒 <b>Time:</b> ${testTime}
📡 <b>Intent Alerts:</b> Active & Ready
━━━━━━━━━━━━━━━━━━━━━
Whenever any user or reseller launches a campaign (GSM Bulk SMS or WhatsApp), you will instantly receive full campaign details here on your mobile device!`;

    const result = await sendTelegramMessage(token, chatId, testMessage);
    if (!result.success) {
      return res.status(400).json({ error: `Telegram delivery failed: ${result.error}` });
    }

    return res.json({ success: true, message: 'Test alert sent successfully to Telegram! Check your phone.' });
  } catch (err) {
    console.error('Test telegram error:', err);
    return res.status(500).json({ error: err.message || 'Telegram test failed' });
  }
});

/**
 * POST /api/notifications/test-webhook
 * Super Admin only: sends a live test payload to external webhook
 */
router.post('/test-webhook', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const current = await getNotificationSettings();
    const url = req.body.admin_alert_webhook ? String(req.body.admin_alert_webhook).trim() : current.admin_alert_webhook;

    if (!url) {
      return res.status(400).json({ error: 'Please enter a valid Webhook URL to test.' });
    }

    const testPayload = {
      event: 'test_notification',
      timestamp: new Date().toISOString(),
      adminEmail: req.user.email,
      message: 'MessageSphere Webhook Integration Test'
    };

    const result = await sendWebhookNotification(url, testPayload);
    if (!result.success) {
      return res.status(400).json({ error: `Webhook returned HTTP status ${result.status || 'Error'}` });
    }

    return res.json({ success: true, message: 'Test webhook delivered successfully!' });
  } catch (err) {
    console.error('Test webhook error:', err);
    return res.status(500).json({ error: err.message || 'Webhook test failed' });
  }
});

module.exports = router;
