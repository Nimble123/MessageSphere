const express = require('express');
const router = express.Router();
const { query, getClient, CREDIT_TYPES, DESTINATIONS } = require('../db');
const { logAudit } = require('../services/audit');
const { authenticate, requireRoles } = require('../middleware/auth');

// GET /api/billing/summary - Accounts receivable & Khata overview metrics
router.get('/summary', authenticate, async (req, res) => {
  try {
    if (req.user.is_team_member && !req.user.permissions?.can_view_billing) {
      return res.status(403).json({ error: 'Permission Denied: Your assigned team role is not authorized to access billing financial data.' });
    }
    if (req.user.role === 'admin') {
      const scope = req.query.scope || 'direct'; // 'direct' (default) or 'reseller_sales'
      const summarySql = `
        SELECT
          -- Platform Direct Receivables (Admin direct clients & Reseller partner accounts)
          COALESCE(COUNT(*) FILTER (WHERE u.reseller_id IS NULL OR u.role = 'reseller'), 0) AS platform_orders,
          COALESCE(SUM(cr.amount_inr) FILTER (WHERE u.reseller_id IS NULL OR u.role = 'reseller'), 0) AS platform_billed,
          COALESCE(SUM(cr.paid_amount) FILTER (WHERE u.reseller_id IS NULL OR u.role = 'reseller'), 0) AS platform_paid,
          COALESCE(SUM(GREATEST(0, cr.amount_inr - COALESCE(cr.paid_amount, 0))) FILTER (WHERE u.reseller_id IS NULL OR u.role = 'reseller'), 0) AS platform_due,

          -- Downstream Reseller Client Sales (Internal transactions between Reseller & their clients)
          COALESCE(COUNT(*) FILTER (WHERE u.reseller_id IS NOT NULL AND u.role != 'reseller'), 0) AS retail_orders,
          COALESCE(SUM(cr.amount_inr) FILTER (WHERE u.reseller_id IS NOT NULL AND u.role != 'reseller'), 0) AS retail_billed,
          COALESCE(SUM(cr.paid_amount) FILTER (WHERE u.reseller_id IS NOT NULL AND u.role != 'reseller'), 0) AS retail_paid,
          COALESCE(SUM(GREATEST(0, cr.amount_inr - COALESCE(cr.paid_amount, 0))) FILTER (WHERE u.reseller_id IS NOT NULL AND u.role != 'reseller'), 0) AS retail_due,

          -- Payment status counts strictly for Platform Direct (where Admin collects money)
          COALESCE(COUNT(CASE WHEN (u.reseller_id IS NULL OR u.role = 'reseller') AND (cr.payment_status = 'Unpaid' OR (COALESCE(cr.paid_amount, 0) = 0 AND cr.amount_inr > 0)) THEN 1 END), 0) AS platform_unpaid,
          COALESCE(COUNT(CASE WHEN (u.reseller_id IS NULL OR u.role = 'reseller') AND (cr.payment_status = 'Partial' OR (cr.paid_amount > 0 AND cr.paid_amount < cr.amount_inr)) THEN 1 END), 0) AS platform_partial,
          COALESCE(COUNT(CASE WHEN (u.reseller_id IS NULL OR u.role = 'reseller') AND (cr.payment_status = 'Paid' OR (cr.paid_amount >= cr.amount_inr AND cr.amount_inr > 0)) THEN 1 END), 0) AS platform_paid_count,

          -- Payment status counts for Reseller Client Sales
          COALESCE(COUNT(CASE WHEN (u.reseller_id IS NOT NULL AND u.role != 'reseller') AND (cr.payment_status = 'Unpaid' OR (COALESCE(cr.paid_amount, 0) = 0 AND cr.amount_inr > 0)) THEN 1 END), 0) AS retail_unpaid,
          COALESCE(COUNT(CASE WHEN (u.reseller_id IS NOT NULL AND u.role != 'reseller') AND (cr.payment_status = 'Partial' OR (cr.paid_amount > 0 AND cr.paid_amount < cr.amount_inr)) THEN 1 END), 0) AS retail_partial,
          COALESCE(COUNT(CASE WHEN (u.reseller_id IS NOT NULL AND u.role != 'reseller') AND (cr.payment_status = 'Paid' OR (cr.paid_amount >= cr.amount_inr AND cr.amount_inr > 0)) THEN 1 END), 0) AS retail_paid_count
        FROM credit_requests cr
        JOIN users u ON cr.user_id = u.id
        WHERE cr.status != 'Rejected'
      `;
      const result = await query(summarySql);
      const row = result.rows[0] || {};

      if (scope === 'reseller_sales') {
        return res.json({
          scope: 'reseller_sales',
          total_orders: parseInt(row.retail_orders, 10) || 0,
          total_billed: Math.round(parseFloat(row.retail_billed || 0) * 100) / 100,
          total_paid: Math.round(parseFloat(row.retail_paid || 0) * 100) / 100,
          total_due: Math.round(parseFloat(row.retail_due || 0) * 100) / 100,
          count_unpaid: parseInt(row.retail_unpaid, 10) || 0,
          count_partial: parseInt(row.retail_partial, 10) || 0,
          count_paid: parseInt(row.retail_paid_count, 10) || 0,
          platform_direct: {
            orders: parseInt(row.platform_orders, 10) || 0,
            billed: Math.round(parseFloat(row.platform_billed || 0) * 100) / 100,
            paid: Math.round(parseFloat(row.platform_paid || 0) * 100) / 100,
            due: Math.round(parseFloat(row.platform_due || 0) * 100) / 100
          },
          reseller_sales: {
            orders: parseInt(row.retail_orders, 10) || 0,
            billed: Math.round(parseFloat(row.retail_billed || 0) * 100) / 100,
            paid: Math.round(parseFloat(row.retail_paid || 0) * 100) / 100,
            due: Math.round(parseFloat(row.retail_due || 0) * 100) / 100
          }
        });
      }

      return res.json({
        scope: 'direct',
        total_orders: parseInt(row.platform_orders, 10) || 0,
        total_billed: Math.round(parseFloat(row.platform_billed || 0) * 100) / 100,
        total_paid: Math.round(parseFloat(row.platform_paid || 0) * 100) / 100,
        total_due: Math.round(parseFloat(row.platform_due || 0) * 100) / 100,
        count_unpaid: parseInt(row.platform_unpaid, 10) || 0,
        count_partial: parseInt(row.platform_partial, 10) || 0,
        count_paid: parseInt(row.platform_paid_count, 10) || 0,
        platform_direct: {
          orders: parseInt(row.platform_orders, 10) || 0,
          billed: Math.round(parseFloat(row.platform_billed || 0) * 100) / 100,
          paid: Math.round(parseFloat(row.platform_paid || 0) * 100) / 100,
          due: Math.round(parseFloat(row.platform_due || 0) * 100) / 100
        },
        reseller_sales: {
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
      const targetUserId = req.user.effective_user_id || req.user.id;
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
      const result = await query(sql, [targetUserId]);
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
    if (req.user.is_team_member && !req.user.permissions?.can_view_billing) {
      return res.status(403).json({ error: 'Permission Denied: Your assigned team role cannot access billing requests.' });
    }
    let sql = '';
    let params = [];

    if (req.user.role === 'admin') {
      const scope = req.query.scope || 'direct'; // 'direct' (default), 'reseller_sales', or 'all'
      let whereClause = '';
      if (scope === 'reseller_sales') {
        whereClause = `WHERE (u.reseller_id IS NOT NULL AND u.role != 'reseller')`;
      } else if (scope === 'all') {
        whereClause = '';
      } else {
        // Default: strictly Admin's direct counterparties (Direct Users & Resellers)
        whereClause = `WHERE (u.reseller_id IS NULL OR u.role = 'reseller')`;
      }

      sql = `
        SELECT 
          cr.*, 
          u.email as user_email,
          u.role as user_role,
          u.company_name as user_company,
          u.full_name as user_name,
          u.reseller_id,
          ru.email as reseller_email,
          ru.company_name as reseller_company,
          ru.full_name as reseller_name,
          (u.reseller_id IS NOT NULL AND u.role != 'reseller') as is_downstream_client,
          GREATEST(0, COALESCE(cr.amount_inr, 0) - COALESCE(cr.paid_amount, 0)) AS due_amount
        FROM credit_requests cr 
        JOIN users u ON cr.user_id = u.id 
        LEFT JOIN users ru ON u.reseller_id = ru.id
        ${whereClause}
        ORDER BY cr.created_at DESC
      `;
    } else if (req.user.role === 'reseller') {
      sql = `
        SELECT 
          cr.*, 
          u.email as user_email,
          u.role as user_role,
          u.company_name as user_company,
          u.full_name as user_name,
          u.reseller_id,
          ru.email as reseller_email,
          ru.company_name as reseller_company,
          (u.reseller_id IS NOT NULL AND u.role != 'reseller') as is_downstream_client,
          GREATEST(0, COALESCE(cr.amount_inr, 0) - COALESCE(cr.paid_amount, 0)) AS due_amount
        FROM credit_requests cr 
        JOIN users u ON cr.user_id = u.id 
        LEFT JOIN users ru ON u.reseller_id = ru.id
        WHERE cr.user_id = $1 OR u.reseller_id = $1
        ORDER BY cr.created_at DESC
      `;
      params = [req.user.id];
    } else {
      const targetUserId = req.user.effective_user_id || req.user.id;
      sql = `
        SELECT 
          cr.*, 
          u.email as user_email,
          u.role as user_role,
          u.company_name as user_company,
          u.full_name as user_name,
          u.reseller_id,
          false as is_downstream_client,
          GREATEST(0, COALESCE(cr.amount_inr, 0) - COALESCE(cr.paid_amount, 0)) AS due_amount
        FROM credit_requests cr 
        JOIN users u ON cr.user_id = u.id 
        WHERE cr.user_id = $1 
        ORDER BY cr.created_at DESC
      `;
      params = [targetUserId];
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
  if (req.user.is_team_member && !req.user.permissions?.can_recharge_wallet) {
    return res.status(403).json({ error: 'Permission Denied: Your assigned team role cannot request credit recharges.' });
  }
  const effectiveUserId = req.user.effective_user_id || req.user.id;
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
  let effectiveTaxMode = 'non_gst';
  try {
    const userRow = await query(`SELECT tax_mode, gstin FROM users WHERE id = $1`, [effectiveUserId]);
    if (userRow.rows.length > 0) {
      const u = userRow.rows[0];
      if (u.tax_mode === 'with_gst' || (u.gstin && String(u.gstin).trim())) {
        effectiveTaxMode = 'with_gst';
      }
    }
    const rateCheck = await query(
      `SELECT rate_inr FROM user_credits WHERE user_id = $1 AND credit_type = $2 AND destination = $3`,
      [effectiveUserId, cType, cDest]
    );
    if (rateCheck.rows.length > 0 && Number(rateCheck.rows[0].rate_inr) > 0) {
      userRate = Number(rateCheck.rows[0].rate_inr);
    }
  } catch (err) {
    console.error('Failed to lookup rate_inr or tax_mode, using default:', err.message);
  }

  const baseAmount = Number((requestedQty * userRate).toFixed(2));
  const gstAmount = effectiveTaxMode === 'with_gst' ? Number((baseAmount * 0.18).toFixed(2)) : 0.00;
  const calculatedAmount = Number((baseAmount + gstAmount).toFixed(2));
  let receiptUrl = (req.body.receipt_url || '').trim() || null;
  if (receiptUrl) {
    if (!/^(https?:\/\/[^\s<>"'`]+|\/api\/campaigns\/files\/[a-zA-Z0-9._-]+)$/i.test(receiptUrl)) {
      return res.status(400).json({ error: 'Invalid receipt URL format. Only HTTP, HTTPS, or uploaded receipt paths are accepted.' });
    }
  }
  const paymentStatus = 'Unpaid';
  const paidAmount = 0.00;

  try {
    const result = await query(`
      INSERT INTO credit_requests 
        (user_id, package_name, credits_requested, credit_type, destination, amount_inr, rate_per_credit, paid_amount, payment_status, utr_number, receipt_url, status, invoice_number, tax_mode, base_amount, gst_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Pending', 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(nextval('invoice_number_seq')::text, 6, '0'), $12, $13, $14)
      RETURNING *
    `, [effectiveUserId, package_name, requestedQty, cType, cDest, calculatedAmount, userRate, paidAmount, paymentStatus, utr.trim(), receiptUrl, effectiveTaxMode, baseAmount, gstAmount]);

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
    // A user cannot approve their own credit request
    if (item.user_id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: You cannot approve your own credit request.' });
    }

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

    // Mark as approved and track approving authority
    await client.query(`UPDATE credit_requests SET status = 'Approved', issuer_id = $2, issuer_role = $3 WHERE id = $1`, [reqId, req.user.id, req.user.role]);
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
  const amtStr = String(req.body.amount || '');
  if (/[eE]/.test(amtStr)) {
    return res.status(400).json({ error: 'Scientific notation is not permitted for payment amounts.' });
  }
  const paymentAmount = parseFloat(amtStr);
  const paymentMode = String(req.body.payment_mode || 'UPI').trim();
  const utr = String(req.body.utr_number || req.body.reference || '').trim();
  const notes = String(req.body.notes || '').trim();
  const settleFull = Boolean(req.body.settle_full);

  if ((isNaN(paymentAmount) || paymentAmount <= 0 || paymentAmount > 99999999) && !settleFull) {
    return res.status(400).json({ error: 'Valid payment amount between ₹0.01 and ₹99,999,999 is required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Fetch order with user info for role permission checking
    const orderRes = await client.query(`
      SELECT cr.*, u.reseller_id, u.email as user_email, u.role as user_role, ru.email as reseller_email
      FROM credit_requests cr
      JOIN users u ON cr.user_id = u.id
      LEFT JOIN users ru ON u.reseller_id = ru.id
      WHERE cr.id = $1
      FOR UPDATE OF cr
    `, [reqId]);

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderRes.rows[0];

    // Permission check: A user cannot record payment on or settle their own invoice
    if (order.user_id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: You cannot record payment or settle your own invoice.' });
    }

    // Permission check: Admin settles directly with Platform direct users and Reseller partner accounts only
    if (req.user.role === 'admin') {
      const isDownstreamClient = order.reseller_id && order.user_role !== 'reseller';
      if (isDownstreamClient) {
        await client.query('ROLLBACK');
        return res.status(403).json({ 
          error: `Permission denied: This invoice is between Reseller (${order.reseller_email || 'partner'}) and their client. Only the managing Reseller can record client settlements.` 
        });
      }
    } else if (req.user.role === 'reseller') {
      const isMyClient = order.reseller_id === req.user.id && order.user_id !== req.user.id;
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

// ==========================================
// CREDIT PLANS & PRICING PACKAGES API
// ==========================================

// GET /api/billing/plans - List credit plans
router.get('/plans', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const { scope, target_role, credit_type, destination } = req.query;

    if (role === 'admin') {
      let conditions = [];
      let params = [];

      if (target_role && ['user', 'reseller'].includes(target_role)) {
        params.push(target_role);
        conditions.push(`cp.target_role = $${params.length}`);
      }
      if (credit_type && CREDIT_TYPES.includes(credit_type)) {
        params.push(credit_type);
        conditions.push(`cp.credit_type = $${params.length}`);
      }
      if (destination && DESTINATIONS.includes(destination)) {
        params.push(destination);
        conditions.push(`cp.destination = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `
        SELECT cp.*, u.email as creator_email, u.role as creator_role, u.company_name as creator_company
        FROM credit_plans cp
        JOIN users u ON cp.created_by = u.id
        ${whereClause}
        ORDER BY cp.target_role DESC, cp.credit_type ASC, cp.credits ASC
      `;
      const result = await query(sql, params);
      return res.json(result.rows);

    } else if (role === 'reseller') {
      if (scope === 'wholesale' || scope === 'buy') {
        // Wholesale plans from Super Admin to purchase
        const sql = `
          SELECT cp.*, u.email as creator_email
          FROM credit_plans cp
          JOIN users u ON cp.created_by = u.id
          WHERE cp.target_role = 'reseller' AND cp.is_active = TRUE
          ORDER BY cp.credit_type ASC, cp.credits ASC
        `;
        const result = await query(sql);
        return res.json(result.rows);
      } else if (scope === 'client_plans' || scope === 'manage') {
        // Plans created by this reseller for their clients
        const sql = `
          SELECT cp.*, u.email as creator_email
          FROM credit_plans cp
          JOIN users u ON cp.created_by = u.id
          WHERE cp.created_by = $1 AND cp.target_role = 'user'
          ORDER BY cp.created_at DESC
        `;
        const result = await query(sql, [req.user.id]);
        return res.json(result.rows);
      } else {
        // Return both wholesale plans & reseller's own client plans
        const wholesaleRes = await query(`
          SELECT cp.*, u.email as creator_email
          FROM credit_plans cp
          JOIN users u ON cp.created_by = u.id
          WHERE cp.target_role = 'reseller' AND cp.is_active = TRUE
          ORDER BY cp.credit_type ASC, cp.credits ASC
        `);
        const clientPlansRes = await query(`
          SELECT cp.*, u.email as creator_email
          FROM credit_plans cp
          JOIN users u ON cp.created_by = u.id
          WHERE cp.created_by = $1 AND cp.target_role = 'user'
          ORDER BY cp.created_at DESC
        `, [req.user.id]);

        return res.json({
          wholesale_plans: wholesaleRes.rows,
          my_client_plans: clientPlansRes.rows
        });
      }

    } else {
      // Standard Client (user)
      if (req.user.reseller_id) {
        // Check if managing reseller created custom plans
        const resellerPlansRes = await query(`
          SELECT cp.*, u.email as creator_email
          FROM credit_plans cp
          JOIN users u ON cp.created_by = u.id
          WHERE cp.created_by = $1 AND cp.target_role = 'user' AND cp.is_active = TRUE
          ORDER BY cp.credit_type ASC, cp.credits ASC
        `, [req.user.reseller_id]);

        if (resellerPlansRes.rows.length > 0) {
          return res.json(resellerPlansRes.rows);
        }
      }

      // Default platform user plans created by admin
      const platformPlansRes = await query(`
        SELECT cp.*, u.email as creator_email
        FROM credit_plans cp
        JOIN users u ON cp.created_by = u.id
        WHERE cp.target_role = 'user' AND cp.is_active = TRUE
        ORDER BY cp.credit_type ASC, cp.credits ASC
      `);
      return res.json(platformPlansRes.rows);
    }

  } catch (err) {
    console.error('List credit plans error:', err);
    return res.status(500).json({ error: 'Failed to load credit plans' });
  }
});

// POST /api/billing/plans - Create a new credit plan
router.post('/plans', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const {
    plan_name,
    description,
    credit_type,
    destination = 'domestic',
    credits,
    rate_per_credit,
    badge_text
  } = req.body;

  let target_role = String(req.body.target_role || 'user').toLowerCase().trim();

  // Permission enforcement on target_role
  if (req.user.role === 'reseller') {
    target_role = 'user'; // Resellers can only create plans for their downstream clients
  } else if (!['user', 'reseller'].includes(target_role)) {
    target_role = 'user';
  }

  const name = String(plan_name || '').trim();
  if (!name || name.length < 2 || name.length > 150) {
    return res.status(400).json({ error: 'Plan name is required and must be between 2 and 150 characters' });
  }

  if (!CREDIT_TYPES.includes(credit_type)) {
    return res.status(400).json({ error: `Invalid channel. Must be one of: ${CREDIT_TYPES.join(', ')}` });
  }

  if (!DESTINATIONS.includes(destination)) {
    return res.status(400).json({ error: `Invalid destination. Must be one of: ${DESTINATIONS.join(', ')}` });
  }

  const qty = parseInt(credits, 10);
  if (!Number.isSafeInteger(qty) || qty < 100 || qty > 100000000) {
    return res.status(400).json({ error: 'Credits quantity must be a positive number between 100 and 100,000,000' });
  }

  if (target_role === 'reseller' && qty < 100000) {
    return res.status(400).json({ error: 'Wholesale reseller plans require a minimum quantity of 1,00,000 credits' });
  }

  const rate = parseFloat(rate_per_credit);
  if (isNaN(rate) || rate <= 0 || rate > 100) {
    return res.status(400).json({ error: 'Rate per credit must be a valid positive amount in INR (e.g. 0.1200)' });
  }

  let totalAmt = parseFloat(req.body.total_amount);
  if (isNaN(totalAmt) || totalAmt <= 0) {
    totalAmt = Math.round(qty * rate * 100) / 100;
  }

  const badge = String(badge_text || '').trim().slice(0, 50) || null;
  const desc = String(description || '').trim().slice(0, 500) || null;
  const isActive = req.body.is_active !== false;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const insertSql = `
      INSERT INTO credit_plans (
        created_by, target_role, plan_name, description, credit_type, destination,
        credits, rate_per_credit, total_amount, badge_text, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const result = await client.query(insertSql, [
      req.user.id, target_role, name, desc, credit_type, destination,
      qty, rate, totalAmt, badge, isActive
    ]);

    const createdPlan = result.rows[0];

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'credit_plan',
      entityId: createdPlan.id,
      action: 'credit_plan_created',
      details: {
        plan_name: name,
        target_role,
        credit_type,
        destination,
        credits: qty,
        rate_per_credit: rate,
        total_amount: totalAmt
      }
    });

    await client.query('COMMIT');
    return res.status(201).json({
      message: `Credit Plan "${name}" created successfully.`,
      plan: createdPlan
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create credit plan error:', err);
    return res.status(500).json({ error: 'Failed to create credit plan' });
  } finally {
    client.release();
  }
});

// PUT /api/billing/plans/:id - Update existing plan
router.put('/plans/:id', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const planId = parseInt(req.params.id, 10);
  if (isNaN(planId)) return res.status(400).json({ error: 'Invalid plan ID' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const planCheck = await client.query(`SELECT * FROM credit_plans WHERE id = $1 FOR UPDATE`, [planId]);
    if (planCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Plan not found' });
    }

    const existingPlan = planCheck.rows[0];

    // Ownership check: Admin can update any admin plan; Reseller can ONLY update their own plans
    if (req.user.role !== 'admin' && existingPlan.created_by !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: You can only edit your own plans' });
    }

    const name = req.body.plan_name ? String(req.body.plan_name).trim().slice(0, 150) : existingPlan.plan_name;
    const desc = req.body.description !== undefined ? String(req.body.description).trim().slice(0, 500) || null : existingPlan.description;
    const cType = req.body.credit_type && CREDIT_TYPES.includes(req.body.credit_type) ? req.body.credit_type : existingPlan.credit_type;
    const dest = req.body.destination && DESTINATIONS.includes(req.body.destination) ? req.body.destination : existingPlan.destination;
    
    let qty = parseInt(req.body.credits, 10);
    if (isNaN(qty) || qty <= 0) qty = existingPlan.credits;

    let rate = parseFloat(req.body.rate_per_credit);
    if (isNaN(rate) || rate <= 0) rate = parseFloat(existingPlan.rate_per_credit);

    let totalAmt = parseFloat(req.body.total_amount);
    if (isNaN(totalAmt) || totalAmt <= 0) totalAmt = Math.round(qty * rate * 100) / 100;

    const badge = req.body.badge_text !== undefined ? (String(req.body.badge_text).trim().slice(0, 50) || null) : existingPlan.badge_text;
    const isActive = req.body.is_active !== undefined ? Boolean(req.body.is_active) : existingPlan.is_active;

    let targetRole = existingPlan.target_role;
    if (req.user.role === 'admin' && req.body.target_role && ['user', 'reseller'].includes(req.body.target_role)) {
      targetRole = req.body.target_role;
    }

    const updateSql = `
      UPDATE credit_plans
      SET plan_name = $1, description = $2, credit_type = $3, destination = $4,
          credits = $5, rate_per_credit = $6, total_amount = $7, badge_text = $8,
          is_active = $9, target_role = $10, updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `;
    const updateRes = await client.query(updateSql, [
      name, desc, cType, dest, qty, rate, totalAmt, badge, isActive, targetRole, planId
    ]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'credit_plan',
      entityId: planId,
      action: 'credit_plan_updated',
      details: { plan_name: name, credits: qty, rate_per_credit: rate, total_amount: totalAmt }
    });

    await client.query('COMMIT');
    return res.json({ message: 'Plan updated successfully', plan: updateRes.rows[0] });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update plan error:', err);
    return res.status(500).json({ error: 'Failed to update plan' });
  } finally {
    client.release();
  }
});

// PATCH /api/billing/plans/:id/toggle - Toggle active status
router.patch('/plans/:id/toggle', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const planId = parseInt(req.params.id, 10);
  if (isNaN(planId)) return res.status(400).json({ error: 'Invalid plan ID' });

  try {
    const planCheck = await query(`SELECT * FROM credit_plans WHERE id = $1`, [planId]);
    if (planCheck.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const p = planCheck.rows[0];
    if (req.user.role !== 'admin' && p.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: You can only toggle your own plans' });
    }

    const newStatus = !p.is_active;
    const updateRes = await query(`UPDATE credit_plans SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [newStatus, planId]);
    return res.json({ message: `Plan is now ${newStatus ? 'Active' : 'Inactive'}`, plan: updateRes.rows[0] });
  } catch (err) {
    console.error('Toggle plan error:', err);
    return res.status(500).json({ error: 'Failed to toggle plan status' });
  }
});

// DELETE /api/billing/plans/:id - Delete a plan
router.delete('/plans/:id', authenticate, requireRoles('admin', 'reseller'), async (req, res) => {
  const planId = parseInt(req.params.id, 10);
  if (isNaN(planId)) return res.status(400).json({ error: 'Invalid plan ID' });

  try {
    const planCheck = await query(`SELECT * FROM credit_plans WHERE id = $1`, [planId]);
    if (planCheck.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const p = planCheck.rows[0];
    if (req.user.role !== 'admin' && p.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied: You can only delete your own plans' });
    }

    await query(`DELETE FROM credit_plans WHERE id = $1`, [planId]);
    return res.json({ message: `Plan #${planId} deleted successfully.` });
  } catch (err) {
    console.error('Delete plan error:', err);
    return res.status(500).json({ error: 'Failed to delete plan' });
  }
});

// POST /api/billing/plans/:id/order - Instant book / order from plan
router.post('/plans/:id/order', authenticate, async (req, res) => {
  if (req.user.is_team_member && !req.user.permissions?.can_recharge_wallet) {
    return res.status(403).json({ error: 'Permission Denied: Your assigned team role cannot order credit plans.' });
  }
  const effectiveUserId = req.user.effective_user_id || req.user.id;
  const planId = parseInt(req.params.id, 10);
  if (isNaN(planId)) return res.status(400).json({ error: 'Invalid plan ID' });

  try {
    const planRes = await query(`SELECT * FROM credit_plans WHERE id = $1`, [planId]);
    if (planRes.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const plan = planRes.rows[0];
    if (!plan.is_active) {
      return res.status(400).json({ error: 'This plan is currently inactive and cannot be ordered' });
    }

    // Role check: Only resellers can order wholesale reseller plans
    if (plan.target_role === 'reseller' && req.user.role !== 'reseller' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Wholesale reseller plans can only be ordered by reseller partner accounts' });
    }

    let effectiveTaxMode = 'non_gst';
    const userRow = await query(`SELECT tax_mode, gstin FROM users WHERE id = $1`, [effectiveUserId]);
    if (userRow.rows.length > 0) {
      const u = userRow.rows[0];
      if (u.tax_mode === 'with_gst' || (u.gstin && String(u.gstin).trim())) {
        effectiveTaxMode = 'with_gst';
      }
    }

    const baseAmount = Number(parseFloat(plan.total_amount).toFixed(2));
    const gstAmount = effectiveTaxMode === 'with_gst' ? Number((baseAmount * 0.18).toFixed(2)) : 0.00;
    const finalAmount = Number((baseAmount + gstAmount).toFixed(2));
    const utr = String(req.body.utr_number || req.body.notes || 'PLAN_ORDER').trim();

    const insertRes = await query(`
      INSERT INTO credit_requests 
        (user_id, package_name, credits_requested, credit_type, destination, amount_inr, rate_per_credit, paid_amount, payment_status, utr_number, status, invoice_number, tax_mode, base_amount, gst_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, 'Unpaid', $8, 'Pending', 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(nextval('invoice_number_seq')::text, 6, '0'), $9, $10, $11)
      RETURNING *
    `, [
      effectiveUserId,
      plan.plan_name,
      plan.credits,
      plan.credit_type,
      plan.destination,
      finalAmount,
      plan.rate_per_credit,
      utr,
      effectiveTaxMode,
      baseAmount,
      gstAmount
    ]);

    return res.status(201).json({
      message: `Order for "${plan.plan_name}" (${Number(plan.credits).toLocaleString()} credits) submitted successfully!`,
      request: insertRes.rows[0]
    });

  } catch (err) {
    console.error('Order plan error:', err);
    return res.status(500).json({ error: 'Failed to submit order for plan' });
  }
});

module.exports = router;
