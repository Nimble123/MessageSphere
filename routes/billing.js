const express = require('express');
const router = express.Router();
const { query, getClient, CREDIT_TYPES, DESTINATIONS } = require('../db');
const { logAudit } = require('../services/audit');
const { authenticate, requireRoles } = require('../middleware/auth');

// GET /api/billing/requests - List top-up requests
router.get('/requests', authenticate, async (req, res) => {
  try {
    let sql = '';
    let params = [];

    if (req.user.role === 'admin') {
      sql = `
        SELECT cr.*, u.email as user_email 
        FROM credit_requests cr 
        JOIN users u ON cr.user_id = u.id 
        ORDER BY cr.created_at DESC
      `;
    } else {
      sql = `
        SELECT cr.*, u.email as user_email 
        FROM credit_requests cr 
        JOIN users u ON cr.user_id = u.id 
        WHERE cr.user_id = $1 
        ORDER BY cr.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('List credit requests error:', err);
    return res.status(500).json({ error: 'Failed to load credit requests' });
  }
});

// POST /api/billing/requests - Submit new credit purchase request
router.post('/requests', authenticate, async (req, res) => {
  const credits = req.body.credits_requested || req.body.credits;
  const utr = req.body.utr_number || req.body.notes || 'ONLINE_REQ';
  const cType = req.body.credit_type || 'normal';
  const cDest = req.body.destination || 'domestic';
  const package_name = req.body.package_name || 'Standard Credit Topup';

  if (credits === undefined || credits === null || credits === '') {
    return res.status(400).json({ error: 'Credits requested is required' });
  }

  const requestedQty = parseInt(credits, 10);
  if (!Number.isSafeInteger(requestedQty) || requestedQty <= 0 || requestedQty > 100000000) {
    return res.status(400).json({ error: 'Credits requested must be a positive whole number within the allowed limit' });
  }
  if (!CREDIT_TYPES.includes(cType) || !DESTINATIONS.includes(cDest)) {
    return res.status(400).json({ error: 'Invalid credit type or destination' });
  }
  const suppliedAmount = req.body.amount_inr === undefined || req.body.amount_inr === '' ? null : Number(req.body.amount_inr);
  if (suppliedAmount !== null && (!Number.isFinite(suppliedAmount) || suppliedAmount < 0)) {
    return res.status(400).json({ error: 'Invalid payment amount' });
  }
  const calculatedAmount = suppliedAmount === null ? requestedQty * 0.15 : suppliedAmount;

  try {
    const result = await query(`
      INSERT INTO credit_requests 
        (user_id, package_name, credits_requested, credit_type, destination, amount_inr, utr_number, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
      RETURNING *
    `, [req.user.id, package_name, requestedQty, cType, cDest, calculatedAmount, utr.trim()]);

    return res.status(201).json({
      message: 'Top-up request submitted successfully. Credits will be allocated upon verification.',
      request: result.rows[0]
    });
  } catch (err) {
    console.error('Create credit request error:', err);
    return res.status(500).json({ error: 'Failed to submit credit request' });
  }
});

// PATCH & POST /api/billing/requests/:id/approve - Admin approves request
const approveHandler = async (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A verification reason is required to approve a top-up request' });
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const check = await client.query(`SELECT * FROM credit_requests WHERE id = $1 FOR UPDATE`, [reqId]);
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }

    const item = check.rows[0];
    if (item.status !== 'Pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only pending requests can be approved' });
    }

    // Add credits to user's wallet
    await client.query(`
      INSERT INTO user_credits (user_id, credit_type, destination, balance)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, credit_type, destination)
      DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance
    `, [item.user_id, item.credit_type, item.destination, item.credits_requested]);

    // Record in ledger
    await client.query(`
      INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [req.user.id, item.user_id, item.credit_type, item.destination, item.credits_requested, `Top-up Order #${item.id} (UTR: ${item.utr_number})`]);

    // Mark as approved
    await client.query(`UPDATE credit_requests SET status = 'Approved' WHERE id = $1`, [reqId]);
    await logAudit(client, { actorId: req.user.id, entityType: 'credit_request', entityId: reqId, action: 'credit_request_approved', details: { userId: item.user_id, credits: item.credits_requested, reason: reason.slice(0, 1000) } });

    await client.query('COMMIT');
    return res.json({ message: `Request #${reqId} approved and ${item.credits_requested} credits allocated!` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve credit request error:', err);
    return res.status(500).json({ error: 'Failed to approve credit request' });
  } finally {
    client.release();
  }
};

router.patch('/requests/:id/approve', authenticate, requireRoles('admin'), approveHandler);
router.post('/requests/:id/approve', authenticate, requireRoles('admin'), approveHandler);

// PATCH & POST /api/billing/requests/:id/reject - Admin rejects request
const rejectHandler = async (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required' });
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const request = await client.query('SELECT * FROM credit_requests WHERE id = $1 FOR UPDATE', [reqId]);
    if (request.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    if (request.rows[0].status !== 'Pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only pending requests can be rejected' });
    }
    await client.query(`UPDATE credit_requests SET status = 'Rejected' WHERE id = $1`, [reqId]);
    await logAudit(client, { actorId: req.user.id, entityType: 'credit_request', entityId: reqId, action: 'credit_request_rejected', details: { reason: reason.slice(0, 1000) } });
    await client.query('COMMIT');
    return res.json({ message: `Request #${reqId} marked as rejected.` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reject credit request error:', err);
    return res.status(500).json({ error: 'Failed to reject request' });
  } finally {
    client.release();
  }
};

router.patch('/requests/:id/reject', authenticate, requireRoles('admin'), rejectHandler);
router.post('/requests/:id/reject', authenticate, requireRoles('admin'), rejectHandler);

module.exports = router;
