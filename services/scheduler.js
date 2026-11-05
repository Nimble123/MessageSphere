const { query } = require('../db');
const { getClient } = require('../db');
const { logAudit } = require('./audit');

let schedulerInterval = null;
let isSchedulerRunning = false;

async function checkScheduledCampaigns() {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;
  try {
    // Find all scheduled campaigns that have reached or passed their dispatch time
    const result = await query(`
      SELECT c.*, u.email as owner_email 
      FROM campaigns c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.scheduled_at IS NOT NULL 
        AND c.scheduled_at <= NOW() 
        AND (c.scheduled_triggered IS NOT TRUE)
        AND c.status = 'Submitted'
      ORDER BY c.scheduled_at ASC
    `);

    if (result.rows.length === 0) return;

    console.log(`[SCHEDULED WORKER] Found ${result.rows.length} scheduled campaign(s) ready for dispatch.`);

    for (const c of result.rows) {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        const updateRes = await client.query(`
          UPDATE campaigns 
          SET scheduled_triggered = TRUE
          WHERE id = $1 AND status = 'Submitted'
        `, [c.id]);

        if (updateRes.rowCount > 0) {
          await logAudit(client, {
            entityType: 'campaign', entityId: c.id, action: 'scheduled_campaign_time_reached',
            details: { scheduledAt: c.scheduled_at, manualReviewRequired: true }
          });
          await client.query(`
            INSERT INTO admin_reminders (campaign_id, title, message, scheduled_for, reminder_type)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            c.id,
            `⚡ Scheduled Time Reached: Campaign #${c.id} Ready for Review`,
            `Campaign #${c.id} ("${c.title}") [${c.owner_email}] reached its scheduled dispatch time and is awaiting Super Admin review in the queue.`,
            c.scheduled_at,
            'scheduled_dispatch_ready'
          ]);
        }
        await client.query('COMMIT');
      } catch (updateErr) {
        await client.query('ROLLBACK');
        throw updateErr;
      } finally {
        client.release();
      }

      console.log(`[SCHEDULED WORKER] ⏰ Released Campaign #${c.id} ("${c.title}") [${c.owner_email}] to the manual dispatch queue.`);
    }
  } catch (err) {
    console.error('[SCHEDULED WORKER ERROR]:', err);
  } finally {
    isSchedulerRunning = false;
  }
}

let purgeInterval = null;

// Periodic Data Retention Worker - Enforces retention policies configured in retention_settings
async function runDataRetentionPurge() {
  try {
    const settingsRes = await query('SELECT setting_key, retention_days FROM retention_settings');
    const settings = {};
    settingsRes.rows.forEach(r => { settings[r.setting_key] = parseInt(r.retention_days, 10); });

    let purgedCounts = { audit_logs: 0, delivery_reports: 0, campaigns: 0 };

    // 1. Purge Audit Events
    if (settings.audit_logs && settings.audit_logs > 0) {
      const res = await query(
        `DELETE FROM audit_events WHERE created_at < NOW() - ($1 || ' days')::interval`,
        [settings.audit_logs]
      );
      purgedCounts.audit_logs = res.rowCount || 0;
    }

    // 2. Purge Delivery Reports
    if (settings.delivery_reports && settings.delivery_reports > 0) {
      const res = await query(
        `DELETE FROM delivery_reports WHERE uploaded_at < NOW() - ($1 || ' days')::interval`,
        [settings.delivery_reports]
      );
      purgedCounts.delivery_reports = res.rowCount || 0;
    }

    // 3. Purge Completed / Rejected Campaigns & Recipients
    if (settings.campaign_data && settings.campaign_data > 0) {
      const res = await query(
        `DELETE FROM campaigns 
         WHERE status IN ('Completed', 'Rejected') 
           AND created_at < NOW() - ($1 || ' days')::interval`,
        [settings.campaign_data]
      );
      purgedCounts.campaigns = res.rowCount || 0;
    }

    console.log(`[RETENTION PURGE] 🧹 Data retention clean-up executed: ${purgedCounts.audit_logs} audit events, ${purgedCounts.delivery_reports} delivery reports, ${purgedCounts.campaigns} campaigns removed.`);
    return purgedCounts;
  } catch (err) {
    console.error('[RETENTION PURGE ERROR]:', err.message);
    return null;
  }
}

function initScheduler(intervalMs = 15000) {
  if (schedulerInterval) clearInterval(schedulerInterval);
  if (purgeInterval) clearInterval(purgeInterval);
  
  // Run immediate initial check
  checkScheduledCampaigns();
  runDataRetentionPurge();

  // Run on interval
  schedulerInterval = setInterval(checkScheduledCampaigns, intervalMs);
  // Run retention purge every 24 hours
  purgeInterval = setInterval(runDataRetentionPurge, 24 * 60 * 60 * 1000);

  console.log(`[SCHEDULED WORKER] 🕒 Background dispatch cron worker initialized (Polling every ${intervalMs / 1000}s).`);
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (purgeInterval) {
    clearInterval(purgeInterval);
    purgeInterval = null;
  }
}

module.exports = {
  initScheduler,
  stopScheduler,
  checkScheduledCampaigns,
  runDataRetentionPurge
};
