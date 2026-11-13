const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

// GET /api/reports/dashboard - Atomic, role-specific dashboard metrics
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const role = (req.user.is_team_member && req.user.parent_role) ? req.user.parent_role : req.user.role;
    const userId = req.user.effective_user_id || req.user.id;

    if (role === 'admin') {
      // 1. SUPER ADMIN METRICS
      const campStats = await query(`
        SELECT 
          COUNT(*)::int as total_campaigns,
          COALESCE(SUM(total_numbers), 0)::bigint as total_recipients,
          COALESCE(SUM(delivered_count), 0)::bigint as total_delivered,
          COALESCE(SUM(failed_count), 0)::bigint as total_failed,
          COALESCE(SUM(total_numbers) FILTER (WHERE status IN ('Submitted', 'Approved', 'Completed')), 0)::bigint as pending_recipients,
          COALESCE(SUM(total_numbers) FILTER (WHERE status = 'Rejected'), 0)::bigint as rejected_recipients,
          COUNT(*) FILTER (WHERE status IN ('Submitted', 'Approved') AND COALESCE(channel_type, 'whatsapp') NOT ILIKE '%sms%' AND COALESCE(campaign_type, '') NOT ILIKE '%sms%')::int as operator_queue_pending
        FROM campaigns
      `);

      const userStats = await query(`
        SELECT 
          COUNT(*)::int as total_accounts,
          COUNT(*) FILTER (WHERE role = 'user')::int as total_clients,
          COUNT(*) FILTER (WHERE role = 'reseller')::int as total_resellers,
          COUNT(*) FILTER (WHERE is_blocked = TRUE)::int as blocked_accounts
        FROM users
        WHERE id != $1
      `, [userId]);

      const orderStats = await query(`
        SELECT COUNT(*)::int as pending_orders 
        FROM credit_requests 
        WHERE status ILIKE 'pending'
      `);

      const recentCamps = await query(`
        SELECT c.*, u.email as owner_email, u.company_name as owner_company
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        ORDER BY c.created_at DESC
        LIMIT 5
      `);

      const timelineCamps = await query(`
        SELECT id, title, total_numbers, created_at, status, delivered_count, failed_count
        FROM (
          SELECT id, title, total_numbers, created_at, status, delivered_count, failed_count
          FROM campaigns
          ORDER BY created_at DESC
          LIMIT 8
        ) sub
        ORDER BY created_at ASC
      `);

      return res.json({
        role: 'admin',
        kpi: {
          total_campaigns: campStats.rows[0].total_campaigns,
          total_recipients: campStats.rows[0].total_recipients,
          operator_queue_pending: campStats.rows[0].operator_queue_pending,
          total_accounts: userStats.rows[0].total_accounts,
          total_clients: userStats.rows[0].total_clients,
          total_resellers: userStats.rows[0].total_resellers,
          pending_orders: orderStats.rows[0].pending_orders,
          total_delivered: campStats.rows[0].total_delivered,
          total_failed: campStats.rows[0].total_failed,
          pending_recipients: campStats.rows[0].pending_recipients,
          rejected_recipients: campStats.rows[0].rejected_recipients
        },
        recentCampaigns: recentCamps.rows,
        timelineCampaigns: timelineCamps.rows
      });

    } else if (role === 'reseller') {
      // 2. RESELLER METRICS
      const campStats = await query(`
        SELECT 
          COUNT(c.id)::int as client_campaigns,
          COALESCE(SUM(c.total_numbers), 0)::bigint as total_recipients,
          COALESCE(SUM(c.delivered_count), 0)::bigint as total_delivered,
          COALESCE(SUM(c.failed_count), 0)::bigint as total_failed,
          COALESCE(SUM(c.total_numbers) FILTER (WHERE c.status IN ('Submitted', 'Approved', 'Completed')), 0)::bigint as pending_recipients,
          COALESCE(SUM(c.total_numbers) FILTER (WHERE c.status = 'Rejected'), 0)::bigint as rejected_recipients,
          COUNT(c.id) FILTER (WHERE c.status IN ('Submitted', 'Approved') AND COALESCE(c.channel_type, 'whatsapp') NOT ILIKE '%sms%' AND COALESCE(c.campaign_type, '') NOT ILIKE '%sms%')::int as operator_queue_pending
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        WHERE u.reseller_id = $1 OR c.user_id = $1
      `, [userId]);

      const clientStats = await query(`
        SELECT 
          COUNT(*)::int as managed_clients,
          COUNT(*) FILTER (WHERE is_blocked = TRUE)::int as blocked_clients
        FROM users
        WHERE reseller_id = $1
      `, [userId]);

      const balanceStats = await query(`
        SELECT 
          COALESCE(SUM(balance) FILTER (WHERE destination = 'domestic'), 0)::bigint as domestic_stock,
          COALESCE(SUM(balance) FILTER (WHERE destination = 'international'), 0)::bigint as intl_stock
        FROM user_credits
        WHERE user_id = $1
      `, [userId]);

      const circStats = await query(`
        SELECT 
          COALESCE(SUM(uc.balance), 0)::bigint as credits_in_circulation,
          COALESCE(SUM(uc.balance) FILTER (WHERE uc.destination = 'domestic'), 0)::bigint as domestic_in_circulation,
          COALESCE(SUM(uc.balance) FILTER (WHERE uc.destination = 'international'), 0)::bigint as intl_in_circulation
        FROM user_credits uc
        JOIN users u ON uc.user_id = u.id
        WHERE u.reseller_id = $1
      `, [userId]);

      const recentCamps = await query(`
        SELECT c.*, u.email as owner_email, u.company_name as owner_company
        FROM campaigns c
        JOIN users u ON c.user_id = u.id
        WHERE u.reseller_id = $1 OR c.user_id = $1
        ORDER BY c.created_at DESC
        LIMIT 5
      `, [userId]);

      const timelineCamps = await query(`
        SELECT id, title, total_numbers, created_at, status, delivered_count, failed_count
        FROM (
          SELECT c.id, c.title, c.total_numbers, c.created_at, c.status, c.delivered_count, c.failed_count
          FROM campaigns c
          JOIN users u ON c.user_id = u.id
          WHERE u.reseller_id = $1 OR c.user_id = $1
          ORDER BY c.created_at DESC
          LIMIT 8
        ) sub
        ORDER BY created_at ASC
      `, [userId]);

      return res.json({
        role: 'reseller',
        kpi: {
          client_campaigns: campStats.rows[0].client_campaigns,
          managed_clients: clientStats.rows[0].managed_clients,
          reseller_domestic_stock: balanceStats.rows[0].domestic_stock,
          reseller_intl_stock: balanceStats.rows[0].intl_stock,
          credits_in_circulation: circStats.rows[0].credits_in_circulation,
          total_recipients: campStats.rows[0].total_recipients,
          total_delivered: campStats.rows[0].total_delivered,
          total_failed: campStats.rows[0].total_failed,
          pending_recipients: campStats.rows[0].pending_recipients,
          rejected_recipients: campStats.rows[0].rejected_recipients,
          operator_queue_pending: campStats.rows[0].operator_queue_pending
        },
        recentCampaigns: recentCamps.rows,
        timelineCampaigns: timelineCamps.rows
      });

    } else {
      // 3. END CLIENT / USER METRICS
      const campStats = await query(`
        SELECT 
          COUNT(*)::int as my_campaigns,
          COALESCE(SUM(total_numbers), 0)::bigint as total_recipients,
          COALESCE(SUM(delivered_count), 0)::bigint as total_delivered,
          COALESCE(SUM(failed_count), 0)::bigint as total_failed,
          COALESCE(SUM(total_numbers) FILTER (WHERE status IN ('Submitted', 'Approved', 'Completed')), 0)::bigint as pending_recipients,
          COALESCE(SUM(total_numbers) FILTER (WHERE status = 'Rejected'), 0)::bigint as rejected_recipients,
          COUNT(*) FILTER (WHERE status = 'Report Updated')::int as completed_campaigns
        FROM campaigns
        WHERE user_id = $1
      `, [userId]);

      const balanceStats = await query(`
        SELECT 
          COALESCE(SUM(balance) FILTER (WHERE destination = 'domestic'), 0)::bigint as domestic_balance,
          COALESCE(SUM(balance) FILTER (WHERE destination = 'international'), 0)::bigint as intl_balance
        FROM user_credits
        WHERE user_id = $1
      `, [userId]);

      const detailedBalance = await query(`
        SELECT credit_type, destination, balance
        FROM user_credits
        WHERE user_id = $1
      `, [userId]);

      const recentCamps = await query(`
        SELECT * FROM campaigns
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 5
      `, [userId]);

      const timelineCamps = await query(`
        SELECT id, title, total_numbers, created_at, status, delivered_count, failed_count
        FROM (
          SELECT id, title, total_numbers, created_at, status, delivered_count, failed_count
          FROM campaigns
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 8
        ) sub
        ORDER BY created_at ASC
      `, [userId]);

      return res.json({
        role: 'user',
        kpi: {
          my_campaigns: campStats.rows[0].my_campaigns,
          total_recipients: campStats.rows[0].total_recipients,
          total_delivered: campStats.rows[0].total_delivered,
          total_failed: campStats.rows[0].total_failed,
          pending_recipients: campStats.rows[0].pending_recipients,
          rejected_recipients: campStats.rows[0].rejected_recipients,
          domestic_balance: balanceStats.rows[0].domestic_balance,
          intl_balance: balanceStats.rows[0].intl_balance,
          balance_breakdown: detailedBalance.rows
        },
        recentCampaigns: recentCamps.rows,
        timelineCampaigns: timelineCamps.rows
      });
    }
  } catch (err) {
    console.error('Dashboard stats API error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard statistics' });
  }
});

module.exports = router;
