const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');
const { sanitizeCsvCell } = require('../services/telecom');

/**
 * Determine if a transaction is a credit (+) or debit (-) from the perspective of the viewing user.
 * Structured direction (direction column) has absolute authority over legacy regex/keywords.
 *
 * @param {object} tx - transaction row
 * @param {number} viewerUserId - ID of the viewing user
 * @param {string} viewerRole - 'admin', 'reseller', or 'user'
 * @returns {{ direction: 'credit'|'debit'|'refund', signed_amount: number, is_credit: boolean, category: string, flow_type: string, badge_text: string, badge_color: string, badge_bg: string, badge_border: string }}
 */
function resolveTransactionDirection(tx, viewerUserId, viewerRole) {
  const amt = Math.abs(Number(tx.amount) || 0);
  const structuredDir = tx.direction ? String(tx.direction).toLowerCase() : null;
  const reasonLower = String(tx.reason || '').toLowerCase();

  // 1. Structured Direction has absolute precedence
  if (structuredDir === 'debit') {
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

  if (structuredDir === 'refund') {
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

  if (structuredDir === 'credit') {
    // If viewer is sender (from_user_id) allocating to client, and viewer is not admin:
    if (Number(tx.from_user_id) === Number(viewerUserId) && Number(tx.to_user_id) !== Number(viewerUserId) && viewerRole !== 'admin') {
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

  // 2. Legacy fallback when structuredDir is null
  const isExplicitDebit = reasonLower.includes('deduction for') || reasonLower.includes('clawback') || reasonLower.includes('reversal adjustment');
  if (isExplicitDebit) {
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

  const isRefund = (Boolean(tx.refund_campaign_id) && !reasonLower.includes('reversal adjustment')) ||
                   reasonLower.includes('auto-refund') ||
                   (reasonLower.includes('refund for') && !reasonLower.includes('reversal'));
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

  // 3. Sender vs Recipient perspective for legacy rows
  if (Number(tx.from_user_id) === Number(viewerUserId) && Number(tx.to_user_id) !== Number(viewerUserId) && viewerRole !== 'admin') {
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

  const isPlatformWide = (req.user.role === 'admin' && (!userId || isNaN(parseInt(userId, 10))));

  // Filter by direction BEFORE pagination
  if (direction && direction !== 'all') {
    if (direction === 'credit' || direction === 'allotment') {
      if (isPlatformWide) {
        whereClauses.push(`(ct.direction = 'credit' OR ct.direction IS NULL)`);
      } else {
        whereClauses.push(`((ct.direction = 'credit' AND ct.to_user_id = $${paramIdx}) OR (ct.direction IS NULL AND ct.to_user_id = $${paramIdx}))`);
        params.push(viewerUserId);
        paramIdx++;
      }
    } else if (direction === 'debit' || direction === 'deduction' || direction === 'campaign_deduction') {
      if (isPlatformWide) {
        whereClauses.push(`ct.direction = 'debit'`);
      } else {
        whereClauses.push(`(ct.direction = 'debit' OR (ct.direction = 'credit' AND ct.from_user_id = $${paramIdx} AND ct.to_user_id != $${paramIdx}) OR (ct.direction IS NULL AND ct.from_user_id = $${paramIdx}))`);
        params.push(viewerUserId);
        paramIdx++;
      }
    } else if (direction === 'refund') {
      whereClauses.push(`(ct.direction = 'refund' OR (ct.direction IS NULL AND ct.refund_campaign_id IS NOT NULL))`);
    }
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

  // SQL-level aggregate summary across entire dataset (independent of pagination limit)
  let summarySql;
  let summaryParams;
  if (isPlatformWide) {
    summarySql = `
      SELECT
        COALESCE(SUM(CASE WHEN ct.direction = 'refund' OR (ct.direction IS NULL AND ct.refund_campaign_id IS NOT NULL) THEN ct.amount ELSE 0 END), 0) as total_refunds,
        COALESCE(SUM(CASE WHEN ct.direction = 'credit' OR (ct.direction IS NULL AND ct.to_user_id IS NOT NULL) THEN ct.amount ELSE 0 END), 0) as total_inflow,
        COALESCE(SUM(CASE WHEN ct.direction = 'debit' OR (ct.direction IS NULL AND ct.from_user_id IS NOT NULL) THEN ct.amount ELSE 0 END), 0) as total_outflow
      FROM credit_transactions ct
      LEFT JOIN users u_from ON ct.from_user_id = u_from.id
      LEFT JOIN users u_to ON ct.to_user_id = u_to.id
      ${whereSql}
    `;
    summaryParams = [...params];
  } else {
    summarySql = `
      SELECT
        COALESCE(SUM(CASE WHEN ct.direction = 'refund' OR (ct.direction IS NULL AND ct.refund_campaign_id IS NOT NULL) THEN ct.amount ELSE 0 END), 0) as total_refunds,
        COALESCE(SUM(CASE WHEN (ct.direction = 'credit' AND ct.to_user_id = $${paramIdx}) OR (ct.direction IS NULL AND ct.to_user_id = $${paramIdx}) THEN ct.amount ELSE 0 END), 0) as total_inflow,
        COALESCE(SUM(CASE WHEN ct.direction = 'debit' OR (ct.direction = 'credit' AND ct.from_user_id = $${paramIdx} AND ct.to_user_id != $${paramIdx}) OR (ct.direction IS NULL AND ct.from_user_id = $${paramIdx}) THEN ct.amount ELSE 0 END), 0) as total_outflow
      FROM credit_transactions ct
      LEFT JOIN users u_from ON ct.from_user_id = u_from.id
      LEFT JOIN users u_to ON ct.to_user_id = u_to.id
      ${whereSql}
    `;
    summaryParams = [...params, viewerUserId];
  }

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

  return { sql, countSql, countParams: params.slice(), summarySql, summaryParams, params, viewerUserId, limitVal, offsetVal };
}

// ===========================================================================
// GET /api/credits/transactions - Fetch ledger statement with filters
// ===========================================================================
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { sql, countSql, countParams, summarySql, summaryParams, params, viewerUserId, limitVal, offsetVal } = await buildLedgerQuery(req, false);
    const [result, countResult, summaryResult] = await Promise.all([
      query(sql, params),
      query(countSql, countParams),
      query(summarySql, summaryParams)
    ]);

    const totalCount = parseInt(countResult.rows[0]?.total_count || 0, 10);
    const sumRow = summaryResult.rows[0] || {};
    const totalInflow = Number(sumRow.total_inflow) || 0;
    const totalOutflow = Number(sumRow.total_outflow) || 0;
    const totalRefunds = Number(sumRow.total_refunds) || 0;

    const enriched = result.rows.map(tx => {
      const dir = resolveTransactionDirection(tx, viewerUserId, req.user.role);
      let safeReason = tx.reason || '';
      let fromEmail = tx.from_email || 'System';
      let toEmail = tx.to_email || 'Recipient';
      let counterparty = Number(tx.to_user_id) === Number(viewerUserId) ? (tx.from_email || 'System / Issuer') : (tx.to_email || 'Recipient Account');

      if (req.user.role !== 'admin') {
        safeReason = safeReason
          .replace(/Allotted by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Telecom Balance Allotment: ')
          .replace(/Deduction by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Balance Adjustment: ')
          .replace(/\bby reseller\b/gi, 'via Telecom Gateway')
          .replace(/\[Created by [^\]]+ on behalf of account\]/gi, '');
        if (req.user.role === 'user') {
          counterparty = 'Direct Telecom Platform';
          fromEmail = 'Direct Telecom Platform';
          toEmail = req.user.email;
        }
      }

      return {
        ...tx,
        reason: safeReason,
        from_email: fromEmail,
        to_email: toEmail,
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

    const enriched = result.rows.map(tx => {
      const dir = resolveTransactionDirection(tx, viewerUserId, req.user.role);
      let safeReason = tx.reason || '';
      let fromEmail = tx.from_email || 'System';
      let toEmail = tx.to_email || 'Recipient';
      let counterparty = Number(tx.to_user_id) === Number(viewerUserId) ? (tx.from_email || 'System') : (tx.to_email || 'Recipient');

      if (req.user.role !== 'admin') {
        safeReason = safeReason
          .replace(/Allotted by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Telecom Balance Allotment: ')
          .replace(/Deduction by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Balance Adjustment: ')
          .replace(/\bby reseller\b/gi, 'via Telecom Gateway')
          .replace(/\[Created by [^\]]+ on behalf of account\]/gi, '');
        if (req.user.role === 'user') {
          counterparty = 'Direct Telecom Platform';
          fromEmail = 'Direct Telecom Platform';
          toEmail = req.user.email;
        }
      }

      return {
        ...tx,
        reason: safeReason,
        from_email: fromEmail,
        to_email: toEmail,
        direction: dir.direction,
        category: dir.category,
        flow_type: dir.flow_type,
        badge_text: dir.badge_text,
        signed_amount: dir.signed_amount,
        is_credit: dir.is_credit,
        counterparty_email: counterparty
      };
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="MessageSphere_Ledger_Statement_${timestamp}.csv"`);

    let csv = 'Transaction ID,Timestamp (IST),Direction,Amount,Channel,Destination,Reason / Reference,From Account,To Account\n';
    enriched.forEach(tx => {
      const id = tx.id;
      const dateStr = sanitizeCsvCell(new Date(tx.created_at).toLocaleString('en-IN'));
      let dir = tx.badge_text ? tx.badge_text.toUpperCase() : (tx.is_credit ? 'CREDIT IN (+)' : 'DEBIT OUT (-)');
      const dirCell = sanitizeCsvCell(dir);
      const amt = tx.signed_amount;
      const channel = sanitizeCsvCell(tx.credit_type);
      const dest = sanitizeCsvCell(tx.destination);
      const reason = sanitizeCsvCell(tx.reason || '');
      const fromAcc = sanitizeCsvCell(tx.from_email);
      const toAcc = sanitizeCsvCell(tx.to_email);

      csv += `${id},${dateStr},${dirCell},${amt},${channel},${dest},${reason},${fromAcc},${toAcc}\n`;
    });

    return res.send(csv);
  } catch (err) {
    console.error('Error exporting ledger:', err);
    return res.status(500).json({ error: 'Failed to export ledger statement' });
  }
});

module.exports = router;
