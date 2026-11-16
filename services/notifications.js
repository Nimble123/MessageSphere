const { query } = require('../db');

/**
 * Normalizes channel & campaign types into human-friendly telecom labels
 */
function formatChannelName(campaignType, channelType) {
  const normType = String(campaignType || '').toLowerCase().trim();
  const normChan = String(channelType || '').toLowerCase().trim();

  if (normChan === 'sms' || normType === 'gsm_sms') {
    return 'GSM Bulk SMS';
  }
  if (normType === 'normal' || normType === 'normal_text') {
    return 'WhatsApp Normal Text';
  }
  if (normType === 'dp' || normType === 'dp_media') {
    return 'WhatsApp DP (Media)';
  }
  if (normType === 'cta' || normType === 'cta_buttons') {
    return 'WhatsApp CTA (Buttons)';
  }
  if (normType === 'dp_cta' || normType === 'dp_cta_combo') {
    return 'WhatsApp DP + CTA Combo';
  }
  if (normChan === 'own_sim' || normType === 'own_number' || normType === 'own_dedicated_sim') {
    return 'WhatsApp Own Dedicated SIM';
  }
  return campaignType ? String(campaignType).toUpperCase() : 'General Campaign';
}

/**
 * Retrieves all notification integration settings
 */
async function getNotificationSettings() {
  const rows = await query('SELECT key, value FROM system_settings');
  const dict = {};
  for (const r of rows.rows) {
    dict[r.key] = r.value;
  }

  return {
    telegram_bot_token: dict.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '',
    telegram_chat_id: dict.telegram_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID || '',
    telegram_enabled: dict.telegram_enabled === 'true' || Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID),
    admin_alert_webhook: dict.admin_alert_webhook || process.env.ADMIN_ALERT_WEBHOOK_URL || '',
    webhook_enabled: dict.webhook_enabled === 'true' || Boolean(process.env.ADMIN_ALERT_WEBHOOK_URL),
    audio_chime_enabled: dict.audio_chime_enabled !== 'false',
    desktop_push_enabled: dict.desktop_push_enabled !== 'false'
  };
}

/**
 * Updates system notification settings
 */
async function updateNotificationSettings(settings) {
  const allowed = [
    'telegram_bot_token',
    'telegram_chat_id',
    'telegram_enabled',
    'admin_alert_webhook',
    'webhook_enabled',
    'audio_chime_enabled',
    'desktop_push_enabled'
  ];

  for (const key of allowed) {
    if (settings[key] !== undefined) {
      const val = String(settings[key]).trim();
      await query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) 
        DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      `, [key, val]);
    }
  }

  return await getNotificationSettings();
}

/**
 * Sends a message via Telegram Bot API
 */
async function sendTelegramMessage(botToken, chatId, htmlText) {
  if (!botToken || !chatId) {
    return { success: false, error: 'Telegram bot token and chat ID are required' };
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.error('[TELEGRAM ALERT ERROR]:', data);
      return { success: false, error: data.description || `HTTP ${res.status}` };
    }
    return { success: true, messageId: data.result?.message_id };
  } catch (err) {
    console.error('[TELEGRAM FETCH EXCEPTION]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Sends a JSON payload to an external webhook URL
 */
async function sendWebhookNotification(webhookUrl, payload) {
  if (!webhookUrl) return { success: false, error: 'Webhook URL required' };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MessageSphere-Alert-Dispatcher/1.0'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });

    return { success: res.ok, status: res.status };
  } catch (err) {
    console.error('[WEBHOOK EXCEPTION]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Main dispatcher: Records intent alert in DB and dispatches external alerts (Telegram, Webhook)
 */
async function recordAndDispatchCampaignAlert({
  campaignId,
  userId,
  actorUserId,
  campaignTitle,
  channelType,
  campaignType,
  destination,
  totalNumbers,
  creditCost,
  scheduledAt,
  messageText,
  status
}) {
  try {
    // 1. Fetch User and hierarchy info
    const userRes = await query(`
      SELECT u.id, u.name, u.business_name, u.email, u.phone, u.role, u.reseller_id,
             r.business_name as reseller_company, r.email as reseller_email
      FROM users u
      LEFT JOIN users r ON u.reseller_id = r.id
      WHERE u.id = $1
    `, [userId]);

    const user = userRes.rows[0] || {};
    const creatorName = user.name || 'Account #' + userId;
    const creatorCompany = user.business_name || 'Direct Business';
    const creatorEmail = user.email || 'N/A';
    const creatorPhone = user.phone || 'N/A';
    const creatorRole = user.role || 'user';
    const resellerId = user.reseller_id || null;
    const resellerName = user.reseller_company || (user.reseller_email ? user.reseller_email : null);

    const friendlyChannel = formatChannelName(campaignType, channelType);
    const destLabel = String(destination).toLowerCase() === 'international' ? 'International (Global)' : 'Domestic (India +91)';
    const schedDate = scheduledAt ? new Date(scheduledAt) : null;
    const isScheduled = Boolean(schedDate && !isNaN(schedDate.getTime()));

    // 2. Insert into admin_campaign_alerts
    const meta = {
      actorUserId: actorUserId || userId,
      messagePreview: messageText ? String(messageText).slice(0, 300) : '',
      isScheduled,
      scheduledTime: isScheduled ? schedDate.toISOString() : null
    };

    const alertInsert = await query(`
      INSERT INTO admin_campaign_alerts
        (campaign_id, user_id, campaign_title, channel_type, campaign_type, destination,
         total_numbers, credit_cost, creator_name, creator_company, creator_email,
         creator_phone, creator_role, reseller_id, reseller_name, scheduled_at, status, meta)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
      RETURNING id, created_at
    `, [
      campaignId,
      userId,
      campaignTitle || 'Untitled Campaign',
      channelType || 'shared_gateway',
      campaignType || 'normal',
      destination || 'domestic',
      parseInt(totalNumbers, 10) || 0,
      parseFloat(creditCost) || 0,
      creatorName,
      creatorCompany,
      creatorEmail,
      creatorPhone,
      creatorRole,
      resellerId,
      resellerName,
      isScheduled ? schedDate : null,
      status || 'Submitted',
      JSON.stringify(meta)
    ]);

    const alertId = alertInsert.rows[0]?.id;
    const createdAt = alertInsert.rows[0]?.created_at || new Date();

    // 3. Asynchronously trigger Telegram & Webhooks in background (fire & forget, safe execution)
    setImmediate(async () => {
      try {
        const settings = await getNotificationSettings();

        const timeStr = new Date(createdAt).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          dateStyle: 'medium',
          timeStyle: 'short'
        });

        // A. Telegram Alert
        if (settings.telegram_enabled && settings.telegram_bot_token && settings.telegram_chat_id) {
          const scheduleNotice = isScheduled
            ? `⏰ <b>Schedule:</b> ${new Date(schedDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`
            : `⚡ <b>Dispatch Mode:</b> Instant Broadcast`;

          const resellerLine = resellerName ? `🏢 <b>Reseller:</b> ${escapeHtml(resellerName)}\n` : '';
          const msgSnippet = messageText ? `\n📝 <b>Message:</b> <i>${escapeHtml(String(messageText).slice(0, 160))}${messageText.length > 160 ? '...' : ''}</i>\n` : '';

          const tgHtml = 
`🚀 <b>NEW CAMPAIGN LAUNCHED!</b>
━━━━━━━━━━━━━━━━━━━━━
📌 <b>Campaign:</b> #${campaignId} - "${escapeHtml(campaignTitle || 'Untitled')}"
👤 <b>Client:</b> ${escapeHtml(creatorName)} (${escapeHtml(creatorCompany)})
📧 <b>Email:</b> <code>${escapeHtml(creatorEmail)}</code>
📞 <b>Phone:</b> <code>${escapeHtml(creatorPhone)}</code>
🏷 <b>Role:</b> ${creatorRole.toUpperCase()}
${resellerLine}📡 <b>Channel:</b> ${escapeHtml(friendlyChannel)} (${escapeHtml(destLabel)})
👥 <b>Audience:</b> <b>${Number(totalNumbers).toLocaleString('en-IN')}</b> Numbers
💳 <b>Credits Debited:</b> <b>${Number(creditCost).toLocaleString('en-IN')}</b>
${scheduleNotice}
🕒 <b>Created At:</b> ${timeStr}${msgSnippet}━━━━━━━━━━━━━━━━━━━━━
🌐 <a href="https://messagesphere.nmedialabs.in">Open MessageSphere Admin Console</a>`;

          await sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, tgHtml);
        }

        // B. External Webhook Alert
        if (settings.webhook_enabled && settings.admin_alert_webhook) {
          const webhookPayload = {
            event: 'campaign_created',
            alertId,
            campaign: {
              id: campaignId,
              title: campaignTitle,
              channel: friendlyChannel,
              channelType,
              campaignType,
              destination,
              totalNumbers,
              creditCost,
              status,
              isScheduled,
              scheduledAt: isScheduled ? schedDate.toISOString() : null,
              createdAt: createdAt.toISOString()
            },
            creator: {
              id: userId,
              name: creatorName,
              company: creatorCompany,
              email: creatorEmail,
              phone: creatorPhone,
              role: creatorRole,
              resellerId,
              resellerName
            }
          };

          await sendWebhookNotification(settings.admin_alert_webhook, webhookPayload);
        }
      } catch (externalErr) {
        console.error('[CAMPAIGN ALERT EXTERNAL DISPATCH FAILED]:', externalErr.message);
      }
    });

    return { alertId, success: true };
  } catch (err) {
    console.error('[RECORD CAMPAIGN ALERT ERROR]:', err);
    return { success: false, error: err.message };
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  formatChannelName,
  getNotificationSettings,
  updateNotificationSettings,
  sendTelegramMessage,
  sendWebhookNotification,
  recordAndDispatchCampaignAlert
};
