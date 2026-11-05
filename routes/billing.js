const express = require('express');
const router = express.Router();
const { query, getClient, CREDIT_TYPES, DESTINATIONS } = require('../db');
const { logAudit } = require('../services/audit');
const { authenticate, requireRoles } = require('../middleware/auth');

// GET /api/billing/summary - Accounts receivable & Khata overview metrics
router.get('/summary', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const summarySql = `
        SELECT
          -- Platform Direct Receivables (Direct platform clients & resellers)
          COALESCE(COUNT(*) FILTER (WHERE u.reseller_id IS NULL), 0) AS platform_orders,
          COALESCE(SUM(cr.amount_inr) FILTER (WHERE u.reseller_id IS NULL), 0) AS platform_billed,
          COALESCE(SUM(cr.paid_amount) FILTER (WHERE u.reseller_id IS NULL), 0) AS platform_paid,
          COALESCE(SUM(GREATEST(0, cr.amount_inr - COALESCE(cr.paid_amount, 0))) FILTER (WHERE u.reseller_id IS NULL), 0) AS platform_due,

          -- Downstream Reseller Client Receivables (Retail)
          COALESCE(COUNT(*) FILTER (WHERE u.reseller_id IS NOT NULL), 0) AS retail_orders,
          COALESCE(SUM(cr.amount_inr) FILTER (WHERE u.reseller_id IS NOT NULL), 0) AS retail_billed,
          COALESCE(SUM(cr.paid_amount) FILTER (WHERE u.reseller_id IS NOT NULL), 0) AS retail_paid,
          COALESCE(SUM(GREATEST(0, cr.amount_inr - COALESCE(cr.paid_amount, 0))) FILTER (WHERE u.reseller_id IS NOT NULL), 0) AS retail_due,

          -- Combined Totals
          COALESCE(COUNT(*), 0) AS total_orders,
          COALESCE(SUM(cr.amount_inr), 0) AS total_billed,
          COALESCE(SUM(cr.paid_amount), 0) AS total_paid,
          COALESCE(SUM(GREATEST(0, cr.amount_inr - COALESCE(cr.paid_amount, 0))), 0) AS total_due,
          COALESCE(COUNT(CASE WHEN cr.payment_status = 'Unpaid' OR (COALESCE(cr.paid_amount, 0) = 0 AND cr.amount_inr > 0) THEN 1 END), 0) AS count_unpaid,
          COALESCE(COUNT(CASE WHEN cr.payment_status = 'Partial' OR (cr.paid_amount > 0 AND cr.paid_amount < cr.amount_inr) THEN 1 END), 0) AS count_partial,
          COALESCE(COUNT(CASE WHEN cr.payment_status = 'Paid' OR (cr.paid_amount >= cr.amount_inr AND cr.amount_inr > 0) THEN 1 END), 0) AS count_paid
        FROM credit_requests cr
        JOIN users u ON cr.user_id = u.id
        WHERE cr.status != 'Rejected'
      `;
      const result = await query(summarySql);
      const row = result.rows[0] || {};
      return res.json({
        total_orders: parseInt(row.total_orders, 10) || 0,
        total_billed: Math.round(parseFloat(row.total_billed || 0) * 100) / 100,
        total_paid: Math.round(parseFloat(row.total_paid || 0) * 100) / 100,
        total_due: Math.round(parseFloat(row.total_due || 0) * 100) / 100,
        count_unpaid: parseInt(row.count_unpaid, 10) || 0,
        count_partial: parseInt(row.count_partial, 10) || 0,
        count_paid: parseInt(row.count_paid, 10) || 0,
        platform_direct: {
          orders: parseInt(row.platform_orders, 10) || 0,
          billed: Math.round(parseFloat(row.platform_billed || 0) * 100) / 100,
          paid: Math.round(parseFloat(row.platform_paid || 0) * 100) / 100,
          due: Math.round(parseFloat(row.platform_due || 0) * 100) / 100
        },
        retail_clients: {
          orders: parseInt(row.retail_orders, 10) || 0,
          billed: Math.round(parseFloat(row.retail_billed || 0) * 100) / 100,
          paid: Math.round(parseFloat(row.retail_paid || 0) * 100) / 100,
          due: Math.round(parseFloat(row.retail_due || 0) * 100) / 100
        }
      });
    } else if (req.user.role === 'reseller') {
      const summarySql = `
        SELECT
          -- Receivables (Client orders owed to Reseller)
          COALESCE(COUNT(*) FILTER (WHERE u.reseller_id = $1 AND cr.user_id != $1), 0) AS recv_orders,
          COALESCE(SUM(cr.amount_inr) FILTER (WHERE u.reseller_id = $1 AND cr.user_id != $1), 0) AS recv_billed,
          COALESCE(SUM(cr.paid_amount) FILTER (WHERE u.reseller_id = $1 AND cr.user_id != $1), 0) AS recv_paid,
          COALESCE(SUM(GREATEST(0, cr.amount_inr - COALESCE(cr.paid_amount, 0))) FILTER (WHERE u.reseller_id = $1 AND cr.user_id != $1), 0) AS recv_due,

          -- Payables (Reseller orders owed to Platform Admin)
          COALESCE(COUNT(*) FILTER (WHERE cr.user_id = $1), 0) AS pay_orders,
          COALESCE(SUM(cr.amount_inr) FILTER (WHERE cr.user_id = $1), 0) AS pay_billed,
          COALESCE(SUM(cr.paid_amount) FILTER (WHERE cr.user_id = $1), 0) AS pay_paid,
          COALESCE(SUM(GREATEST(0, cr.amount_inr - COALESCE(cr.paid_amount, 0))) FILTER (WHERE cr.user_id = $1), 0) AS pay_due,

          -- Counts for client receivables
          COALESCE(COUNT(CASE WHEN (u.reseller_id = $1 AND cr.user_id != $1) AND (cr.payment_status = 'Unpaid' OR (COALESCE(cr.paid_amount, 0) = 0 AND cr.amount_inr > 0)) THEN 1 END), 0) AS count_unpaid,
          COALESCE(COUNT(CASE WHEN (u.reseller_id = $1 AND cr.user_id != $1) AND (cr.payment_status = 'Partial' OR (cr.paid_amount > 0 AND cr.paid_amount < cr.amount_inr)) THEN 1 END), 0) AS count_partial,
          COALESCE(COUNT(CASE WHEN (u.reseller_id = $1 AND cr.user_id != $1) AND (cr.payment_status = 'Paid' OR (cr.paid_amount >= cr.amount_inr AND cr.amount_inr > 0)) THEN 1 END), 0) AS count_paid
        FROM credit_requests cr
        JOIN users u ON cr.user_id = u.id
        WHERE (cr.user_id = $1 OR u.reseller_id = $1) AND cr.status != 'Rejected'
      `;
      const result = await query(summarySql, [req.user.id]);
      const row = result.rows[0] || {};
      return res.json({
        total_orders: parseInt(row.recv_orders, 10) || 0,
        total_billed: Math.round(parseFloat(row.recv_billed || 0) * 100) / 100,
        total_paid: Math.round(parseFloat(row.recv_paid || 0) * 100) / 100,
        total_due: Math.round(parseFloat(row.recv_due || 0) * 100) / 100,
        count_unpaid: parseInt(row.count_unpaid, 10) || 0,
        count_partial: parseInt(row.count_partial, 10) || 0,
        count_paid: parseInt(row.count_paid, 10) || 0,
        receivables: {
          orders: parseInt(row.recv_orders, 10) || 0,
          billed: Math.round(parseFloat(row.recv_billed || 0) * 100) / 100,
          paid: Math.round(parseFloat(row.recv_paid || 0) * 100) / 100,
          due: Math.round(parseFloat(row.recv_due || 0) * 100) / 100
        },
        payables: {
          orders: parseInt(row.pay_orders, 10) || 0,
          billed: Math.round(parseFloat(row.pay_billed || 0) * 100) / 100,
          paid: Math.round(parseFloat(row.pay_paid || 0) * 100) / 100,
          due: Math.round(parseFloat(row.pay_due || 0) * 100) / 100
        }
      });
    } else {
      const sql = `
        SELECT 
          COALESCE(COUNT(*), 0) AS total_orders,
          COALESCE(SUM(cr.amount_inr), 0) AS total_billed,
          COALESCE(SUM(cr.paid_amount), 0) AS total_paid,
          COALESCE(SUM(GREATEST(0, cr.amount_inr - COALESCE(cr.paid_amount, 0))), 0) AS total_due,
          COALESCE(COUNT(CASE WHEN cr.payment_status = 'Unpaid' OR (COALESCE(cr.paid_amount, 0) = 0 AND cr.amount_inr > 0) THEN 1 END), 0) AS count_unpaid,
          COALESCE(COUNT(CASE WHEN cr.payment_status = 'Partial' OR (cr.paid_amount > 0 AND cr.paid_amount < cr.amount_inr) THEN 1 END), 0) AS count_partial,
          COALESCE(COUNT(CASE WHEN cr.payment_status = 'Paid' OR (cr.paid_amount >= cr.amount_inr AND cr.amount_inr > 0) THEN 1 END), 0) AS count_paid
        FROM credit_requests cr
        WHERE cr.user_id = $1 AND cr.status != 'Rejected'
      `;
      const result = await query(sql, [req.user.id]);
      const row = result.rows[0] || {};
      return res.json({
        total_orders: parseInt(row.total_orders, 10) || 0,
        total_billed: Math.round(parseFloat(row.total_billed || 0) * 100) / 100,
        total_paid: Math.round(parseFloat(row.total_paid || 0) * 100) / 100,
        total_due: Math.round(parseFloat(row.total_due || 0) * 100) / 100,
        count_unpaid: parseInt(row.count_unpaid, 10) || 0,
        count_partial: parseInt(row.count_partial, 10) || 0,
        count_paid: parseInt(row.count_paid, 10) || 0
      });
    }
  } catch (err) {
    console.error('Billing summary error:', err);
    return res.status(500).json({ error: 'Failed to compute billing summary' });
  }
});

// GET /api/billing/requests - List top-up requests
router.get('/requests', authenticate, async (req, res) => {
  try {
    let sql = '';
    let params = [];

    if (req.user.role === 'admin') {
      sql = `
        SELECT 
          cr.*, 
          u.email as user_email,
          u.role as user_role,
          u.reseller_id,
          GREATEST(0, COALESCE(cr.amount_inr, 0) - COALESCE(cr.paid_amount, 0)) AS due_amount
        FROM credit_requests cr 
        JOIN users u ON cr.user_id = u.id 
        ORDER BY cr.created_at DESC
      `;
    } else if (req.user.role === 'reseller') {
      sql = `
        SELECT 
          cr.*, 
          u.email as user_email,
          u.role as user_role,
          u.reseller_id,
          GREATEST(0, COALESCE(cr.amount_inr, 0) - COALESCE(cr.paid_amount, 0)) AS due_amount
        FROM credit_requests cr 
        JOIN users u ON cr.user_id = u.id 
        WHERE cr.user_id = $1 OR u.reseller_id = $1
        ORDER BY cr.created_at DESC
      `;
      params = [req.user.id];
    } else {
      sql = `
        SELECT 
          cr.*, 
          u.email as user_email,
          u.role as user_role,
          u.reseller_id,
          GREATEST(0, COALESCE(cr.amount_inr, 0) - COALESCE(cr.paid_amount, 0)) AS due_amount
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

  // Security: Ignore client-supplied rate, amount, and payment status
  let userRate = 0.1500;
  try {
    const rateCheck = await query(
      `SELECT rate_inr FROM user_credits WHERE user_id = $1 AND credit_type = $2 AND destination = $3`,
      [req.user.id, cType, cDest]
    );
    if (rateCheck.rows.length > 0 && Number(rateCheck.rows[0].rate_inr) > 0) {
      userRate = Number(rateCheck.rows[0].rate_inr);
    }
  } catch (err) {
    console.error('Failed to lookup rate_inr, using default rate:', err.message);
  }

  const calculatedAmount = Number((requestedQty * userRate).toFixed(4));
  const receiptUrl = (req.body.receipt_url || '').trim() || null;
  const paymentStatus = 'Unpaid';
  const paidAmount = 0.00;

  try {
    const result = await query(`
      INSERT INTO credit_requests 
        (user_id, package_name, credits_requested, credit_type, destination, amount_inr, rate_per_credit, paid_amount, payment_status, utr_number, receipt_url, status, invoice_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Pending', 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(nextval('invoice_number_seq')::text, 6, '0'))
      RETURNING *
    `, [req.user.id, package_name, requestedQty, cType, cDest, calculatedAmount, userRate, paidAmount, paymentStatus, utr.trim(), receiptUrl]);

    return res.status(201).json({
      message: 'Top-up request submitted successfully. Credits will be allocated upon verification.',
      request: result.rows[0]
    });
  } catch (err) {
    console.error('Create credit request error:', err);
    return res.status(500).json({ error: 'Failed to submit credit request' });
  }
});

// PATCH & POST /api/billing/requests/:id/approve - Admin or Reseller approves request
const approveHandler = async (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A verification reason is required to approve a top-up request' });
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const check = await client.query(`
      SELECT cr.*, u.reseller_id, u.email as user_email, u.role as user_role, u.tax_mode, u.gstin
      FROM credit_requests cr
      JOIN users u ON cr.user_id = u.id
      WHERE cr.id = $1
      FOR UPDATE OF cr
    `, [reqId]);

    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }

    const item = check.rows[0];
    if (item.status !== 'Pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only pending requests can be approved' });
    }

    // Role-based permission & quota checks:
    // If reseller is approving, the user MUST be under this reseller
    if (req.user.role === 'reseller') {
      if (item.reseller_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Permission denied: Resellers can only approve orders from their own clients' });
      }

      // Check reseller's own available balance in this credit type & destination
      const resellerCredit = await client.query(
        `SELECT balance FROM user_credits 
         WHERE user_id = $1 AND credit_type = $2 AND destination = $3 
         FOR UPDATE`,
        [req.user.id, item.credit_type, item.destination]
      );

      const resellerBal = resellerCredit.rows.length > 0 ? parseInt(resellerCredit.rows[0].balance, 10) : 0;
      if (resellerBal < item.credits_requested) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient reseller stock. You need ${item.credits_requested.toLocaleString()} ${item.credit_type} (${item.destination}) credits to fulfill this client order, but you only have ${resellerBal.toLocaleString()} in your balance. Please top up your reseller stock first.`
        });
      }

      // Deduct from reseller stock
      await client.query(
        `UPDATE user_credits 
         SET balance = balance - $1 
         WHERE user_id = $2 AND credit_type = $3 AND destination = $4`,
        [item.credits_requested, req.user.id, item.credit_type, item.destination]
      );
    }

    // Add credits to beneficiary client's wallet
    await client.query(`
      INSERT INTO user_credits (user_id, credit_type, destination, balance)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, credit_type, destination)
      DO UPDATE SET balance = user_credits.balance + EXCLUDED.balance
    `, [item.user_id, item.credit_type, item.destination, item.credits_requested]);

    // Record in ledger
    const ledgerReason = req.user.role === 'reseller'
      ? `Top-up Order #${item.id} approved by Reseller (UTR: ${item.utr_number || 'N/A'})`
      : `Top-up Order #${item.id} approved by Platform Root (UTR: ${item.utr_number || 'N/A'})`;

    await client.query(`
      INSERT INTO credit_transactions (from_user_id, to_user_id, credit_type, destination, amount, reason, tax_mode, base_amount, gst_amount, direction)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'credit')
    `, [
      req.user.id,
      item.user_id,
      item.credit_type,
      item.destination,
      item.credits_requested,
      ledgerReason,
      item.tax_mode || 'non_gst',
      item.base_amount || item.amount_inr || 0,
      item.gst_amount || 0
    ]);

    // Mark as approved
    await client.query(`UPDATE credit_requests SET status = 'Approved' WHERE id = $1`, [reqId]);
    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'credit_request',
      entityId: reqId,
      action: 'credit_request_approved',
      details: {
        userId: item.user_id,
        userEmail: item.user_email,
        credits: item.credits_requested,
        approvedByRole: req.user.role,
        reason: reason.slice(0, 1000)
      }
    });

    await client.query('COMMIT');
    return res.json({ message: `Request #${reqId} approved and ${item.credits_requested.toLocaleString()} credits allocated!` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Approve credit request error:', err);
    return res.status(500).json({ error: 'Failed to approve credit request' });
  } finally {
    client.release();
  }
};

router.patch('/requests/:id/approve', authenticate, requireRoles('admin', 'reseller'), approveHandler);
router.post('/requests/:id/approve', authenticate, requireRoles('admin', 'reseller'), approveHandler);

// PATCH & POST /api/billing/requests/:id/reject - Admin or Reseller rejects request
const rejectHandler = async (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required' });
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const request = await client.query(`
      SELECT cr.*, u.reseller_id 
      FROM credit_requests cr
      JOIN users u ON cr.user_id = u.id
      WHERE cr.id = $1 
      FOR UPDATE OF cr
    `, [reqId]);

    if (request.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }

    const item = request.rows[0];
    if (item.status !== 'Pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only pending requests can be rejected' });
    }

    if (req.user.role === 'reseller' && item.reseller_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: Cannot reject requests from other accounts' });
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

router.patch('/requests/:id/reject', authenticate, requireRoles('admin', 'reseller'), rejectHandler);
router.post('/requests/:id/reject', authenticate, requireRoles('admin', 'reseller'), rejectHandler);

// POST /api/billing/requests/:id/record-payment - Super Admin or Reseller records payment (settles full or partial Khata)
router.post('/requests/:id/record-payment', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const paymentAmount = parseFloat(req.body.amount);
  const paymentMode = String(req.body.payment_mode || 'UPI').trim();
  const utr = String(req.body.utr_number || req.body.reference || '').trim();
  const notes = String(req.body.notes || '').trim();
  const settleFull = Boolean(req.body.settle_full);

  if ((isNaN(paymentAmount) || paymentAmount <= 0) && !settleFull) {
    return res.status(400).json({ error: 'Valid payment amount greater than zero is required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Fetch order with user info for role permission checking
    const orderRes = await client.query(`
      SELECT cr.*, u.reseller_id, u.email as user_email
      FROM credit_requests cr
      JOIN users u ON cr.user_id = u.id
      WHERE cr.id = $1
      FOR UPDATE OF cr
    `, [reqId]);

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderRes.rows[0];

    // Permission check: Admin can record payment for all; Reseller can ONLY record for their downstream clients
    if (req.user.role !== 'admin') {
      const isMyClient = order.reseller_id === req.user.id;
      if (!isMyClient) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Permission denied: Resellers can only record payments for their own assigned clients' });
      }
    }

    const totalBill = parseFloat(order.amount_inr) || 0;
    const currentPaid = parseFloat(order.paid_amount) || 0;
    const currentDue = Math.max(0, totalBill - currentPaid);

    let incomingPayment = settleFull ? currentDue : paymentAmount;
    if (incomingPayment > currentDue) {
      incomingPayment = currentDue; // Prevent overpayment
    }

    const newPaidTotal = currentPaid + incomingPayment;
    let newPaymentStatus = 'Unpaid';
    if (newPaidTotal >= totalBill && totalBill > 0) {
      newPaymentStatus = 'Paid';
    } else if (newPaidTotal > 0) {
      newPaymentStatus = 'Partial';
    }

    const paymentEntry = {
      recorded_at: new Date().toISOString(),
      recorded_by: req.user.email,
      recorded_by_role: req.user.role,
      amount: incomingPayment,
      payment_mode: paymentMode,
      utr_number: utr,
      notes: notes,
      previous_paid: currentPaid,
      new_paid: newPaidTotal,
      balance_remaining: Math.max(0, totalBill - newPaidTotal)
    };

    const existingHistory = Array.isArray(order.payment_history) ? order.payment_history : [];
    existingHistory.push(paymentEntry);

    const updateRes = await client.query(`
      UPDATE credit_requests
      SET 
        paid_amount = $1,
        payment_status = $2,
        payment_history = $3::jsonb,
        payment_notes = COALESCE(payment_notes || E'\n' || $4, $4)
      WHERE id = $5
      RETURNING *
    `, [newPaidTotal, newPaymentStatus, JSON.stringify(existingHistory), `[${new Date().toLocaleDateString()}] Received ₹${incomingPayment} via ${paymentMode} (${utr}) by ${req.user.email}`, reqId]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'credit_request',
      entityId: reqId,
      action: 'payment_recorded',
      details: paymentEntry
    });

    await client.query('COMMIT');
    return res.json({
      message: `Payment of ₹${incomingPayment.toLocaleString()} recorded successfully! Order #${reqId} status is now ${newPaymentStatus}.`,
      order: updateRes.rows[0],
      balance_due: Math.max(0, totalBill - newPaidTotal)
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Record payment error:', err);
    return res.status(500).json({ error: 'Failed to record payment' });
  } finally {
    client.release();
  }
});

module.exports = router;
