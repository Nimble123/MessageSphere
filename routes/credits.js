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
function resolveTransactionDirection(tx, viewerUserId, viewerRole) {
  const reasonLower = String(tx.reason || '').toLowerCase();
  const isRefund = Boolean(tx.refund_campaign_id) || reasonLower.includes('refund') || reasonLower.includes('auto-refund');
  const isDeduction = reasonLower.includes('deduction') || reasonLower.includes('debit') || reasonLower.includes('burn') || reasonLower.includes('cost');
  const amt = Math.abs(Number(tx.amount) || 0);

  // 1. REFUND / REVERSAL FLOW
  // Any refund or auto-refund restores credits to the user/reseller. It is ALWAYS positive (+).
  if (isRefund) {
    return {
      direction: 'refund',
      category: 'refund',
      signed_amount: amt,
      is_credit: true,
      flow_type: 'refund',
      badge_text: 'Refund Restored (+)',
      badge_color: '#0284c7',
      badge_bg: '#f0f9ff',
      badge_border: '#bae6fd'
    };
  }

  // 2. CAMPAIGN DEDUCTION / USAGE FLOW
  // Deductions for campaigns are ALWAYS negative (-) debits, regardless of who views them.
  if (isDeduction) {
    return {
      direction: 'debit',
      category: 'campaign_deduction',
      signed_amount: -amt,
      is_credit: false,
      flow_type: 'debit',
      badge_text: 'Campaign Debit (-)',
      badge_color: '#b91c1c',
      badge_bg: '#fef2f2',
      badge_border: '#fecaca'
    };
  }

  // 3. CREDIT ALLOTMENT / RECHARGE / SALE FLOW
  // If viewer is recipient (to_user_id):
  if (Number(tx.to_user_id) === Number(viewerUserId)) {
    return {
      direction: 'credit',
      category: 'allotment',
      signed_amount: amt,
      is_credit: true,
      flow_type: 'credit',
      badge_text: 'Credit In (+)',
      badge_color: '#15803d',
      badge_bg: '#ecfdf5',
      badge_border: '#bbf7d0'
    };
  }

  // If viewer is sender (from_user_id) allocating to a client
  if (Number(tx.from_user_id) === Number(viewerUserId) && Number(tx.to_user_id) !== Number(viewerUserId)) {
    if (viewerRole === 'admin') {
      return {
        direction: 'credit',
        category: 'allotment',
        signed_amount: amt,
        is_credit: true,
        flow_type: 'credit',
        badge_text: 'Allotment (+)',
        badge_color: '#15803d',
        badge_bg: '#ecfdf5',
        badge_border: '#bbf7d0'
      };
    }

    return {
      direction: 'debit',
      category: 'allotment_out',
      signed_amount: -amt,
      is_credit: false,
      flow_type: 'debit',
      badge_text: 'Transferred Out (-)',
      badge_color: '#d97706',
      badge_bg: '#fffbeb',
      badge_border: '#fde68a'
    };
  }

  // Fallback for third-party view (e.g. Admin inspecting any account's transaction)
  return {
    direction: 'credit',
    category: 'allotment',
    signed_amount: amt,
    is_credit: true,
    flow_type: 'credit',
    badge_text: 'Credit In (+)',
    badge_color: '#15803d',
    badge_bg: '#ecfdf5',
    badge_border: '#bbf7d0'
  };
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

  // Date range filters (from_date, to_date)
  if (req.query.from_date && String(req.query.from_date).trim()) {
    const fDate = new Date(req.query.from_date);
    if (!isNaN(fDate.getTime())) {
      whereClauses.push(`ct.created_at >= $${paramIdx}`);
      params.push(fDate);
      paramIdx++;
    }
  }

  if (req.query.to_date && String(req.query.to_date).trim()) {
    const tDate = new Date(req.query.to_date);
    if (!isNaN(tDate.getTime())) {
      tDate.setHours(23, 59, 59, 999);
      whereClauses.push(`ct.created_at <= $${paramIdx}`);
      params.push(tDate);
      paramIdx++;
    }
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
  const limitVal = isExport ? 5000 : (parseInt(limit, 10) || 50);
  const offsetVal = parseInt(offset, 10) || 0;

  const countSql = `
    SELECT COUNT(*) as total_count
    FROM credit_transactions ct
    LEFT JOIN users u_from ON ct.from_user_id = u_from.id
    LEFT JOIN users u_to ON ct.to_user_id = u_to.id
    ${whereSql}
  `;

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

  return { sql, countSql, countParams: params.slice(), params, viewerUserId, limitVal, offsetVal };
}

// ===========================================================================
// GET /api/credits/transactions - Fetch ledger statement with filters
// ===========================================================================
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { sql, countSql, countParams, params, viewerUserId, limitVal, offsetVal } = await buildLedgerQuery(req, false);
    const [result, countResult] = await Promise.all([
      query(sql, params),
      query(countSql, countParams)
    ]);

    const totalCount = parseInt(countResult.rows[0]?.total_count || 0, 10);

    // Filter by direction if requested ('credit' vs 'debit')
    const directionFilter = req.query.direction;

    const enriched = result.rows
      .map(tx => {
        const dir = resolveTransactionDirection(tx, viewerUserId, req.user.role);
        let safeReason = tx.reason || '';
        let counterparty = Number(tx.to_user_id) === Number(viewerUserId) ? (tx.from_email || 'System / Issuer') : (tx.to_email || 'Recipient Account');
        if (req.user.role !== 'admin') {
          safeReason = safeReason
            .replace(/Allotted by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Telecom Balance Allotment: ')
            .replace(/Deduction by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Balance Adjustment: ')
            .replace(/\bby reseller\b/gi, 'via Telecom Gateway')
            .replace(/\[Created by [^\]]+ on behalf of account\]/gi, '');
          if (req.user.role === 'user') {
            counterparty = 'Direct Telecom Platform';
          }
        }
        return {
          ...tx,
          reason: safeReason,
          direction: dir.direction,
          category: dir.category,
          flow_type: dir.flow_type,
          badge_text: dir.badge_text,
          badge_color: dir.badge_color,
          badge_bg: dir.badge_bg,
          badge_border: dir.badge_border,
          signed_amount: dir.signed_amount,
          is_credit: dir.is_credit,
          counterparty_email: counterparty
        };
      })
      .filter(tx => {
        if (!directionFilter || directionFilter === 'all') return true;
        if (directionFilter === 'credit' || directionFilter === 'allotment') {
          return tx.category === 'allotment';
        }
        if (directionFilter === 'debit' || directionFilter === 'deduction' || directionFilter === 'campaign_deduction') {
          return tx.category === 'campaign_deduction' || tx.direction === 'debit';
        }
        if (directionFilter === 'refund') {
          return tx.category === 'refund' || tx.direction === 'refund';
        }
        return tx.direction === directionFilter;
      });

    let totalInflow = 0;
    let totalOutflow = 0;
    let totalRefunds = 0;
    enriched.forEach(t => {
      if (t.category === 'refund' || t.direction === 'refund') {
        totalRefunds += Math.abs(t.signed_amount);
      } else if (t.is_credit) {
        totalInflow += Math.abs(t.signed_amount);
      } else {
        totalOutflow += Math.abs(t.signed_amount);
      }
    });

    if (req.query.paginate === 'true' || req.query.page) {
      return res.json({
        transactions: enriched,
        total: totalCount,
        limit: limitVal,
        offset: offsetVal,
        summary: {
          totalInflow,
          totalOutflow,
          totalRefunds
        }
      });
    }

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
        const dir = resolveTransactionDirection(tx, viewerUserId, req.user.role);
        let safeReason = tx.reason || '';
        let counterparty = Number(tx.to_user_id) === Number(viewerUserId) ? (tx.from_email || 'System') : (tx.to_email || 'Recipient');
        if (req.user.role !== 'admin') {
          safeReason = safeReason
            .replace(/Allotted by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Telecom Balance Allotment: ')
            .replace(/Deduction by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Balance Adjustment: ')
            .replace(/\bby reseller\b/gi, 'via Telecom Gateway')
            .replace(/\[Created by [^\]]+ on behalf of account\]/gi, '');
          if (req.user.role === 'user') {
            counterparty = 'Direct Telecom Platform';
          }
        }
        return {
          ...tx,
          reason: safeReason,
          direction: dir.direction,
          category: dir.category,
          flow_type: dir.flow_type,
          badge_text: dir.badge_text,
          signed_amount: dir.signed_amount,
          is_credit: dir.is_credit,
          counterparty_email: counterparty
        };
      })
      .filter(tx => {
        if (!directionFilter || directionFilter === 'all') return true;
        if (directionFilter === 'credit' || directionFilter === 'allotment') {
          return tx.category === 'allotment';
        }
        if (directionFilter === 'debit' || directionFilter === 'deduction' || directionFilter === 'campaign_deduction') {
          return tx.category === 'campaign_deduction' || tx.direction === 'debit';
        }
        if (directionFilter === 'refund') {
          return tx.category === 'refund' || tx.direction === 'refund';
        }
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
