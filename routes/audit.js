const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

router.get('/events', authenticate, requireRoles('admin'), async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const action = String(req.query.action || '').trim();
  const entityType = String(req.query.entityType || '').trim();
  const params = [];
  const where = [];
  if (action) { params.push(action); where.push(`ae.action = $${params.length}`); }
  if (entityType) { params.push(entityType); where.push(`ae.entity_type = $${params.length}`); }
  params.push(limit);
  try {
    const result = await query(`
      SELECT ae.*, u.email AS actor_email
      FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ae.created_at DESC LIMIT $${params.length}
    `, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('Audit events error:', err);
    return res.status(500).json({ error: 'Failed to load audit events' });
  }
});

router.get('/alerts', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'Submitted')::int AS pending_approval,
        COUNT(*) FILTER (WHERE status = 'Approved')::int AS awaiting_manual_dispatch,
        COUNT(*) FILTER (WHERE status = 'Completed')::int AS awaiting_report
      FROM campaigns
    `);
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load operations alerts' });
  }
});

router.get('/retention', authenticate, requireRoles('admin'), async (req, res) => {
  const result = await query('SELECT * FROM retention_settings ORDER BY setting_key');
  return res.json(result.rows);
});

router.patch('/retention/:key', authenticate, requireRoles('admin'), async (req, res) => {
  const days = Number(req.body.retention_days);
  if (!Number.isInteger(days) || days < 30 || days > 3650) return res.status(400).json({ error: 'Retention must be between 30 and 3650 days' });
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const update = await client.query(`UPDATE retention_settings SET retention_days = $1, updated_by = $2, updated_at = NOW() WHERE setting_key = $3 RETURNING *`, [days, req.user.id, req.params.key]);
    if (!update.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Retention setting not found' }); }
    await logAudit(client, { actorId: req.user.id, entityType: 'retention_setting', action: 'retention_policy_changed', details: { key: req.params.key, retentionDays: days } });
    await client.query('COMMIT');
    return res.json(update.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Failed to update retention policy' });
  } finally { client.release(); }
});

// POST /api/audit/retention/purge-now - Super Admin manually triggers retention policy purge
router.post('/retention/purge-now', authenticate, requireRoles('admin'), async (req, res) => {
  try {
    const { runDataRetentionPurge } = require('../services/scheduler');
    const counts = await runDataRetentionPurge();
    return res.json({
      message: 'Data retention purge executed successfully.',
      purged: counts
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to execute data retention purge' });
  }
});

module.exports = router;
