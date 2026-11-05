const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db');
const { authenticate, requireRoles } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

// GET /api/headers - List sender headers
router.get('/', authenticate, async (req, res) => {
  try {
    let sql, params = [];
    if (req.user.role === 'admin') {
      sql = `
        SELECT sh.*, u.email as user_email, u.company_name
        FROM sender_headers sh
        JOIN users u ON sh.user_id = u.id
        ORDER BY sh.created_at DESC
      `;
    } else {
      sql = `
        SELECT sh.*, u.email as user_email, u.company_name
        FROM sender_headers sh
        JOIN users u ON sh.user_id = u.id
        WHERE sh.user_id = $1
        ORDER BY sh.created_at DESC
      `;
      params = [req.user.id];
    }
    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('List sender headers error:', err);
    return res.status(500).json({ error: 'Failed to load sender headers' });
  }
});

// POST /api/headers - Register a new sender header
router.post('/', authenticate, async (req, res) => {
  const headerName = String(req.body.header_name || '').trim().toUpperCase();
  const entityId = String(req.body.entity_id || '').trim();

  if (!headerName || headerName.length < 3 || headerName.length > 20) {
    return res.status(400).json({ error: 'Sender header must be between 3 and 20 characters.' });
  }

  if (!/^[A-Z0-9_-]+$/.test(headerName)) {
    return res.status(400).json({ error: 'Sender header can only contain uppercase letters, numbers, hyphens, and underscores.' });
  }

  try {
    const existing = await query(
      'SELECT id FROM sender_headers WHERE user_id = $1 AND header_name = $2',
      [req.user.id, headerName]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `Sender header "${headerName}" is already registered or pending for your account.` });
    }

    // Admins auto-approve their own headers; users/resellers start as Pending
    const initialStatus = req.user.role === 'admin' ? 'Approved' : 'Pending';

    const result = await query(`
      INSERT INTO sender_headers (user_id, header_name, entity_id, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.user.id, headerName, entityId || null, initialStatus]);

    await logAudit(null, {
      actorId: req.user.id,
      entityType: 'sender_header',
      entityId: result.rows[0].id,
      action: 'header_registered',
      details: { headerName, entityId, status: initialStatus }
    });

    return res.status(201).json({
      message: initialStatus === 'Approved' ? 'Sender header activated successfully.' : 'Sender header submitted for verification.',
      header: result.rows[0]
    });
  } catch (err) {
    console.error('Register sender header error:', err);
    return res.status(500).json({ error: 'Failed to register sender header' });
  }
});

// PATCH /api/headers/:id/status - Super Admin approves or rejects sender header
router.patch('/:id/status', authenticate, requireRoles('admin'), async (req, res) => {
  const headerId = parseInt(req.params.id, 10);
  const status = String(req.body.status || '').trim();

  if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid header status. Must be Approved, Rejected, or Pending.' });
  }

  try {
    const check = await query('SELECT * FROM sender_headers WHERE id = $1', [headerId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Sender header not found' });
    }

    const result = await query(
      `UPDATE sender_headers SET status = $1 WHERE id = $2 RETURNING *`,
      [status, headerId]
    );

    await logAudit(null, {
      actorId: req.user.id,
      entityType: 'sender_header',
      entityId: headerId,
      action: `header_status_${status.toLowerCase()}`,
      details: { previousStatus: check.rows[0].status, newStatus: status }
    });

    return res.json({ message: `Sender header marked as ${status}`, header: result.rows[0] });
  } catch (err) {
    console.error('Update sender header status error:', err);
    return res.status(500).json({ error: 'Failed to update sender header status' });
  }
});

// DELETE /api/headers/:id - Delete sender header
router.delete('/:id', authenticate, async (req, res) => {
  const headerId = parseInt(req.params.id, 10);
  try {
    const check = await query('SELECT * FROM sender_headers WHERE id = $1', [headerId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Sender header not found' });
    }

    if (req.user.role !== 'admin' && check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: Cannot delete headers belonging to another account' });
    }

    await query('DELETE FROM sender_headers WHERE id = $1', [headerId]);
    return res.json({ message: 'Sender header deleted successfully' });
  } catch (err) {
    console.error('Delete sender header error:', err);
    return res.status(500).json({ error: 'Failed to delete sender header' });
  }
});

module.exports = router;
