const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

/**
 * Determine if a transaction is a credit (+) or debit (-) from the perspective of the user
 * @param {object} tx - transaction row
 * @param {number} viewerUserId - ID of the viewing user
 * @returns {{ direction: 'credit'|'debit', signed_amount: number, is_credit: boolean }}
 */
function resolveTransactionDirection(tx, viewerUserId) {
  const reasonLower = String(tx.reason || '').toLowerCase();
  const isDeduction = reasonLower.includes('deduction') || reasonLower.includes('debit') || reasonLower.includes('cost');
  const isRefund = reasonLower.includes('refund');

  // If the viewer is the recipient (to_user_id)
  if (Number(tx.to_user_id) === Number(viewerUserId)) {
    if (isDeduction) {
      return { direction: 'debit', signed_amount: -Math.abs(Number(tx.amount)), is_credit: false };
    }
    return { direction: 'credit', signed_amount: Math.abs(Number(tx.amount)), is_credit: true };
  }

  // If the viewer is the sender (from_user_id) allocating to someone else
  if (Number(tx.from_user_id) === Number(viewerUserId) && Number(tx.to_user_id) !== Number(viewerUserId)) {
    // If reseller transferred credits to client, it left the reseller's balance
    return { direction: 'debit', signed_amount: -Math.abs(Number(tx.amount)), is_credit: false };
  }

  // Default fallback for third-party view (e.g. Admin inspecting client)
  if (isDeduction) {
    return { direction: 'debit', signed_amount: -Math.abs(Number(tx.amount)), is_credit: false };
  }
  return { direction: 'credit', signed_amount: Math.abs(Number(tx.amount)), is_credit: true };
}

/**
 * Helper to build SQL query and params for ledger statements
 */
async function buildLedgerQuery(req, isExport = false) {
  const { userId, credit_type, destination, direction, search, limit, offset } = req.query;
  const whereClauses = [];
  const params = [];
  let paramIdx = 1;

  let viewerUserId = req.user.id;

  if (req.user.role === 'admin') {
    const targetUserId = userId ? parseInt(userId, 10) : null;
    if (targetUserId && !isNaN(targetUserId)) {
      whereClauses.push(`(ct.to_user_id = $${paramIdx} OR ct.from_user_id = $${paramIdx})`);
      params.push(targetUserId);
      paramIdx++;
      viewerUserId = targetUserId;
    }
  } else if (req.user.role === 'reseller') {
    const targetUserId = userId ? parseInt(userId, 10) : null;
    if (targetUserId && !isNaN(targetUserId)) {
      // Ensure target user is the reseller or one of their clients
      const check = await query('SELECT id FROM users WHERE id = $1 AND (id = $2 OR reseller_id = $2)', [targetUserId, req.user.id]);
      if (check.rows.length === 0) {
        throw new Error('Permission denied: You can only view transactions for your managed client accounts.');
      }
      whereClauses.push(`(ct.to_user_id = $${paramIdx} OR ct.from_user_id = $${paramIdx})`);
      params.push(targetUserId);
      paramIdx++;
      viewerUserId = targetUserId;
    } else {
      // Reseller views their own or their clients' transactions
      whereClauses.push(`(
        ct.to_user_id = $${paramIdx} OR 
        ct.from_user_id = $${paramIdx} OR 
        ct.to_user_id IN (SELECT id FROM users WHERE reseller_id = $${paramIdx})
      )`);
      params.push(req.user.id);
      paramIdx++;
    }
  } else {
    // Regular customer only views their own transactions
    whereClauses.push(`(ct.to_user_id = $${paramIdx} OR ct.from_user_id = $${paramIdx})`);
    params.push(req.user.id);
    paramIdx++;
  }

  // Filter by Channel / Credit Type
  if (credit_type && credit_type !== 'all') {
    whereClauses.push(`ct.credit_type = $${paramIdx}`);
    params.push(credit_type);
    paramIdx++;
  }

  // Filter by Destination
  if (destination && destination !== 'all') {
    whereClauses.push(`ct.destination = $${paramIdx}`);
    params.push(destination);
    paramIdx++;
  }

  // Search keyword (Reason or Counterparty email)
  if (search && String(search).trim()) {
    const searchParam = `%${String(search).trim()}%`;
    whereClauses.push(`(
      ct.reason ILIKE $${paramIdx} OR 
      u_from.email ILIKE $${paramIdx} OR 
      u_to.email ILIKE $${paramIdx}
    )`);
    params.push(searchParam);
    paramIdx++;
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limitVal = isExport ? 5000 : (parseInt(limit, 10) || 250);
  const offsetVal = parseInt(offset, 10) || 0;

  const sql = `
    SELECT ct.*, 
           u_from.email as from_email,
           u_to.email as to_email
    FROM credit_transactions ct
    LEFT JOIN users u_from ON ct.from_user_id = u_from.id
    LEFT JOIN users u_to ON ct.to_user_id = u_to.id
    ${whereSql}
    ORDER BY ct.created_at DESC
    LIMIT ${limitVal} OFFSET ${offsetVal}
  `;

  return { sql, params, viewerUserId };
}

// ===========================================================================
// GET /api/credits/transactions - Fetch ledger statement with filters
// ===========================================================================
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { sql, params, viewerUserId } = await buildLedgerQuery(req, false);
    const result = await query(sql, params);

    // Filter by direction if requested ('credit' vs 'debit')
    const directionFilter = req.query.direction;

    const enriched = result.rows
      .map(tx => {
        const dir = resolveTransactionDirection(tx, viewerUserId);
        return {
          ...tx,
          direction: dir.direction,
          signed_amount: dir.signed_amount,
          is_credit: dir.is_credit,
          counterparty_email: Number(tx.to_user_id) === Number(viewerUserId) ? (tx.from_email || 'System / Issuer') : (tx.to_email || 'Recipient Account')
        };
      })
      .filter(tx => {
        if (!directionFilter || directionFilter === 'all') return true;
        return tx.direction === directionFilter;
      });

    return res.json(enriched);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    return res.status(err.message.includes('Permission denied') ? 403 : 500).json({ error: err.message || 'Failed to load ledger transactions' });
  }
});

// ===========================================================================
// GET /api/credits/transactions/export - 1-Click CSV Statement Download
// ===========================================================================
router.get('/transactions/export', authenticate, async (req, res) => {
  try {
    const { sql, params, viewerUserId } = await buildLedgerQuery(req, true);
    const result = await query(sql, params);

    const directionFilter = req.query.direction;
    const enriched = result.rows
      .map(tx => {
        const dir = resolveTransactionDirection(tx, viewerUserId);
        return {
          ...tx,
          direction: dir.direction,
          signed_amount: dir.signed_amount,
          is_credit: dir.is_credit,
          counterparty_email: Number(tx.to_user_id) === Number(viewerUserId) ? (tx.from_email || 'System') : (tx.to_email || 'Recipient')
        };
      })
      .filter(tx => {
        if (!directionFilter || directionFilter === 'all') return true;
        return tx.direction === directionFilter;
      });

    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="MessageSphere_Ledger_Statement_${timestamp}.csv"`);

    let csv = 'Transaction ID,Timestamp (IST),Direction,Amount,Channel,Destination,Reason / Reference,From Account,To Account\n';
    enriched.forEach(tx => {
      const id = tx.id;
      const dateStr = `"${new Date(tx.created_at).toLocaleString('en-IN')}"`;
      const dir = tx.direction === 'credit' ? 'CREDIT IN (+)' : 'DEBIT OUT (-)';
      const amt = tx.signed_amount;
      const channel = `"${tx.credit_type}"`;
      const dest = `"${tx.destination}"`;
      const reason = `"${(tx.reason || '').replace(/"/g, '""')}"`;
      const fromAcc = `"${(tx.from_email || 'System').replace(/"/g, '""')}"`;
      const toAcc = `"${(tx.to_email || 'User').replace(/"/g, '""')}"`;

      csv += `${id},${dateStr},${dir},${amt},${channel},${dest},${reason},${fromAcc},${toAcc}\n`;
    });

    return res.send(csv);
  } catch (err) {
    console.error('Error exporting ledger:', err);
    return res.status(500).json({ error: 'Failed to export ledger statement' });
  }
});

module.exports = router;
