const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

// GET /api/credits/transactions - Fetch ledger statement
router.get('/transactions', authenticate, async (req, res) => {
  try {
    let sql = '';
    let params = [];

    if (req.user.role === 'admin') {
      const targetUserId = req.query.userId ? parseInt(req.query.userId, 10) : null;
      if (targetUserId) {
        sql = `
          SELECT ct.*, 
                 u_from.email as from_email,
                 u_to.email as to_email
          FROM credit_transactions ct
          LEFT JOIN users u_from ON ct.from_user_id = u_from.id
          LEFT JOIN users u_to ON ct.to_user_id = u_to.id
          WHERE ct.to_user_id = $1 OR ct.from_user_id = $1
          ORDER BY ct.created_at DESC
          LIMIT 200
        `;
        params = [targetUserId];
      } else {
        sql = `
          SELECT ct.*, 
                 u_from.email as from_email,
                 u_to.email as to_email
          FROM credit_transactions ct
          LEFT JOIN users u_from ON ct.from_user_id = u_from.id
          LEFT JOIN users u_to ON ct.to_user_id = u_to.id
          ORDER BY ct.created_at DESC
          LIMIT 200
        `;
      }
    } else {
      sql = `
        SELECT ct.*, 
               u_from.email as from_email,
               u_to.email as to_email
        FROM credit_transactions ct
        LEFT JOIN users u_from ON ct.from_user_id = u_from.id
        LEFT JOIN users u_to ON ct.to_user_id = u_to.id
        WHERE ct.to_user_id = $1 OR ct.from_user_id = $1
        ORDER BY ct.created_at DESC
        LIMIT 200
      `;
      params = [req.user.id];
    }

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
