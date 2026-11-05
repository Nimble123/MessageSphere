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
        await client.query(`
          UPDATE campaigns 
          SET scheduled_triggered = TRUE, 
              status = 'Approved'
          WHERE id = $1 AND status = 'Submitted'
        `, [c.id]);
        await logAudit(client, {
          entityType: 'campaign', entityId: c.id, action: 'scheduled_campaign_released_to_manual_queue',
          details: { scheduledAt: c.scheduled_at, manualDispatch: true }
        });
        await client.query(`
          INSERT INTO admin_reminders (campaign_id, title, message, scheduled_for, reminder_type)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          c.id,
          `⚡ Dispatch Ready: Campaign #${c.id} in Queue`,
          `Campaign #${c.id} ("${c.title}") [${c.owner_email}] reached its scheduled dispatch time and is now waiting in the Operator Dispatch Queue.`,
          c.scheduled_at,
          'scheduled_dispatch_ready'
        ]);
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

function initScheduler(intervalMs = 15000) {
  if (schedulerInterval) clearInterval(schedulerInterval);
  
  // Run immediate initial check
  checkScheduledCampaigns();

  // Run on interval
  schedulerInterval = setInterval(checkScheduledCampaigns, intervalMs);
  console.log(`[SCHEDULED WORKER] 🕒 Background dispatch cron worker initialized (Polling every ${intervalMs / 1000}s).`);
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = {
  initScheduler,
  stopScheduler,
  checkScheduledCampaigns
};
