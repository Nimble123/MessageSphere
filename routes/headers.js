const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate, requireRoles } = require('../middleware/auth');

// GET /api/headers - List sender headers
router.get('/', authenticate, async (req, res) => {
  try {
    let sql = '';
    let params = [];

    if (req.user.role === 'admin') {
      sql = `
        SELECT sh.*, u.email as user_email 
        FROM sender_headers sh 
        JOIN users u ON sh.user_id = u.id 
        ORDER BY sh.created_at DESC
      `;
    } else {
      sql = `
        SELECT sh.*, u.email as user_email 
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
    console.error('List headers error:', err);
    return res.status(500).json({ error: 'Failed to load sender headers' });
  }
});

// POST /api/headers - Request new sender header
router.post('/', authenticate, async (req, res) => {
  const rawHeader = req.body.header_name || req.body.sender_id;
  const entity = req.body.entity_id || req.body.entity_name;
  if (!rawHeader || rawHeader.trim().length !== 6) {
    return res.status(400).json({ error: 'Sender Header must be exactly 6 characters (e.g. MSGSPH)' });
  }

  const cleanHeader = rawHeader.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(cleanHeader)) {
    return res.status(400).json({ error: 'Sender Header must be alphanumeric (letters and numbers only)' });
  }

  try {
    const result = await query(`
      INSERT INTO sender_headers (user_id, header_name, entity_id, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.user.id, cleanHeader, entity || null, req.user.role === 'admin' ? 'Approved' : 'Pending']);

    return res.status(201).json({
      message: req.user.role === 'admin' ? 'Sender Header approved and registered!' : 'Header submitted for admin review.',
      header: result.rows[0]
    });
  } catch (err) {
    console.error('Create header error:', err);
    return res.status(500).json({ error: 'Failed to submit sender header' });
  }
});

// PATCH /api/headers/:id/status - Admin approves/rejects header
router.patch('/:id/status', authenticate, requireRoles('admin'), async (req, res) => {
  const headerId = parseInt(req.params.id, 10);
  const { status } = req.body;

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    await query(`UPDATE sender_headers SET status = $1 WHERE id = $2`, [status, headerId]);
    return res.json({ message: `Sender Header status updated to ${status}` });
  } catch (err) {
    console.error('Update header status error:', err);
    return res.status(500).json({ error: 'Failed to update header status' });
  }
});

module.exports = router;
