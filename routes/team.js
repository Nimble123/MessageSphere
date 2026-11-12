// routes/team.js - Sub-User Team Accounts & Role-Based Access Control (RBAC)
const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db');
const { authenticate, requirePermission } = require('../middleware/auth');
const { hashPassword } = require('../services/hasher');
const { logAudit } = require('../services/audit');

const DEFAULT_ROLE_PERMISSIONS = {
  campaign_manager: {
    can_send_campaigns: true,
    can_view_campaigns: true,
    can_manage_templates: true,
    can_manage_contacts: true,
    can_export_contacts: false, // Strict data protection against contact theft
    can_view_billing: false,
    can_recharge_wallet: false,
    can_manage_team: false
  },
  support_agent: {
    can_send_campaigns: false,
    can_view_campaigns: true,
    can_manage_templates: false,
    can_manage_contacts: false,
    can_export_contacts: false,
    can_view_billing: false,
    can_recharge_wallet: false,
    can_manage_team: false
  },
  accountant: {
    can_send_campaigns: false,
    can_view_campaigns: false,
    can_manage_templates: false,
    can_manage_contacts: false,
    can_export_contacts: false,
    can_view_billing: true,
    can_recharge_wallet: true,
    can_manage_team: false
  },
  viewer: {
    can_send_campaigns: false,
    can_view_campaigns: true,
    can_manage_templates: false,
    can_manage_contacts: false,
    can_export_contacts: false,
    can_view_billing: false,
    can_recharge_wallet: false,
    can_manage_team: false
  },
  team_admin: {
    can_send_campaigns: true,
    can_view_campaigns: true,
    can_manage_templates: true,
    can_manage_contacts: true,
    can_export_contacts: true,
    can_view_billing: true,
    can_recharge_wallet: true,
    can_manage_team: true
  }
};

function normalizePermissions(roleTitle, customPermissions = {}) {
  const base = DEFAULT_ROLE_PERMISSIONS[roleTitle] || DEFAULT_ROLE_PERMISSIONS.campaign_manager;
  return {
    can_send_campaigns: Boolean(customPermissions.can_send_campaigns !== undefined ? customPermissions.can_send_campaigns : base.can_send_campaigns),
    can_view_campaigns: Boolean(customPermissions.can_view_campaigns !== undefined ? customPermissions.can_view_campaigns : base.can_view_campaigns),
    can_manage_templates: Boolean(customPermissions.can_manage_templates !== undefined ? customPermissions.can_manage_templates : base.can_manage_templates),
    can_manage_contacts: Boolean(customPermissions.can_manage_contacts !== undefined ? customPermissions.can_manage_contacts : base.can_manage_contacts),
    can_export_contacts: Boolean(customPermissions.can_export_contacts !== undefined ? customPermissions.can_export_contacts : base.can_export_contacts),
    can_view_billing: Boolean(customPermissions.can_view_billing !== undefined ? customPermissions.can_view_billing : base.can_view_billing),
    can_recharge_wallet: Boolean(customPermissions.can_recharge_wallet !== undefined ? customPermissions.can_recharge_wallet : base.can_recharge_wallet),
    can_manage_team: Boolean(customPermissions.can_manage_team !== undefined ? customPermissions.can_manage_team : base.can_manage_team)
  };
}

// GET /api/team - List all team members for the authenticated organization
router.get('/', authenticate, requirePermission('can_manage_team'), async (req, res) => {
  try {
    const parentId = req.user.effective_user_id || req.user.id;
    const result = await query(`
      SELECT 
        tm.id,
        tm.user_id,
        tm.role_title,
        tm.permissions,
        tm.status,
        tm.is_on_leave,
        tm.backup_agent_id,
        tm.leave_start_date,
        tm.leave_end_date,
        tm.leave_note,
        tm.created_at,
        tm.updated_at,
        u.email,
        u.full_name,
        u.is_blocked,
        bu.email AS backup_agent_email,
        bu.full_name AS backup_agent_name,
        (SELECT COUNT(*) FROM users u2 WHERE u2.assigned_agent_id = tm.user_id)::int AS assigned_clients_count,
        (SELECT COUNT(*) FROM users u3 JOIN team_members tm2 ON u3.assigned_agent_id = tm2.user_id WHERE tm2.is_on_leave = TRUE AND tm2.backup_agent_id = tm.user_id)::int AS coverage_clients_count
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      LEFT JOIN users bu ON bu.id = tm.backup_agent_id
      WHERE tm.parent_user_id = $1
      ORDER BY tm.created_at DESC
    `, [parentId]);

    return res.json({
      members: result.rows,
      rolePresets: DEFAULT_ROLE_PERMISSIONS
    });
  } catch (err) {
    console.error('List team error:', err);
    return res.status(500).json({ error: 'Failed to retrieve team members' });
  }
});

// GET /api/team/agents - Quick list of active agents/account managers for dropdown mapping
router.get('/agents', authenticate, async (req, res) => {
  try {
    const parentId = req.user.effective_user_id || req.user.id;
    const result = await query(`
      SELECT 
        u.id, 
        u.email, 
        u.full_name, 
        tm.id AS team_member_id,
        tm.role_title, 
        tm.is_on_leave, 
        tm.backup_agent_id,
        bu.full_name AS backup_agent_name,
        (SELECT COUNT(*) FROM users u2 WHERE u2.assigned_agent_id = tm.user_id)::int AS assigned_clients_count
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      LEFT JOIN users bu ON tm.backup_agent_id = bu.id
      WHERE tm.parent_user_id = $1 AND tm.status = 'active'
      ORDER BY u.full_name ASC, u.email ASC
    `, [parentId]);

    return res.json(result.rows);
  } catch (err) {
    console.error('List agents error:', err);
    return res.status(500).json({ error: 'Failed to retrieve active agents' });
  }
});

// POST /api/team/:id/leave-status - Toggle Leave / Vacation mode and assign backup coverage agent
router.post('/:id/leave-status', authenticate, requirePermission('can_manage_team'), async (req, res) => {
  const client = await getClient();
  try {
    const parentId = req.user.effective_user_id || req.user.id;
    const memberId = parseInt(req.params.id, 10);
    const { is_on_leave, backup_agent_id, leave_end_date, leave_note } = req.body;

    await client.query('BEGIN');

    // Verify member exists under this organization
    const memberRes = await client.query(
      `SELECT tm.*, u.email, u.full_name FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.id = $1 AND tm.parent_user_id = $2`,
      [memberId, parentId]
    );
    if (memberRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Staff member not found in your organization.' });
    }

    const member = memberRes.rows[0];
    const willBeOnLeave = Boolean(is_on_leave);
    let finalBackupId = null;

    if (willBeOnLeave) {
      if (backup_agent_id) {
        const backupInt = parseInt(backup_agent_id, 10);
        if (backupInt === member.user_id) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Staff member cannot be their own backup coverage agent.' });
        }
        // Verify backup agent is an active team member of the same parent
        const backupCheck = await client.query(
          `SELECT tm.user_id, u.email, u.full_name FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.user_id = $1 AND tm.parent_user_id = $2 AND tm.status = 'active'`,
          [backupInt, parentId]
        );
        if (backupCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Selected backup coverage agent is not an active team member.' });
        }
        finalBackupId = backupInt;
      }
    }

    const updateRes = await client.query(`
      UPDATE team_members
      SET 
        is_on_leave = $1,
        backup_agent_id = $2,
        leave_start_date = CASE WHEN $1 = TRUE THEN CURRENT_DATE ELSE NULL END,
        leave_end_date = CASE WHEN $1 = TRUE THEN $3::date ELSE NULL END,
        leave_note = CASE WHEN $1 = TRUE THEN $4 ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `, [willBeOnLeave, finalBackupId, leave_end_date || null, leave_note ? String(leave_note).trim().slice(0, 255) : null, memberId]);

    // Count affected clients
    const clientCountRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE assigned_agent_id = $1`,
      [member.user_id]
    );
    const affectedClients = clientCountRes.rows[0]?.count || 0;

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'team_member',
      entityId: memberId,
      action: willBeOnLeave ? 'agent_leave_started' : 'agent_leave_ended',
      details: {
        agentEmail: member.email,
        agentName: member.full_name,
        isOnLeave: willBeOnLeave,
        backupAgentId: finalBackupId,
        leaveEndDate: leave_end_date || null,
        affectedClients
      }
    });

    await client.query('COMMIT');

    const message = willBeOnLeave
      ? `${member.full_name || member.email} is now marked On Leave. ${affectedClients} clients temporarily delegated${finalBackupId ? ' to backup agent.' : '.'}`
      : `${member.full_name || member.email} has resumed duty. Client access restored to original agent.`;

    return res.json({
      message,
      member: updateRes.rows[0],
      affectedClients
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update leave status error:', err);
    return res.status(500).json({ error: 'Failed to update leave coverage status' });
  } finally {
    client.release();
  }
});

// POST /api/team/reassign-clients - Transfer an agent's entire client portfolio to another agent
router.post('/reassign-clients', authenticate, requirePermission('can_manage_team'), async (req, res) => {
  const client = await getClient();
  try {
    const parentId = req.user.effective_user_id || req.user.id;
    const { from_agent_id, to_agent_id } = req.body;

    const fromId = parseInt(from_agent_id, 10);
    const toId = to_agent_id ? parseInt(to_agent_id, 10) : null;

    if (isNaN(fromId)) {
      return res.status(400).json({ error: 'Source agent ID is required' });
    }
    if (fromId === toId) {
      return res.status(400).json({ error: 'Source and destination agent cannot be the same.' });
    }

    await client.query('BEGIN');

    // Verify source agent
    const fromCheck = await client.query(
      `SELECT tm.user_id, u.email, u.full_name FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.user_id = $1 AND tm.parent_user_id = $2`,
      [fromId, parentId]
    );
    if (fromCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source agent not found in your organization.' });
    }

    // Verify target agent (if specified)
    let toName = 'Unassigned';
    if (toId) {
      const toCheck = await client.query(
        `SELECT tm.user_id, u.email, u.full_name FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.user_id = $1 AND tm.parent_user_id = $2 AND tm.status = 'active'`,
        [toId, parentId]
      );
      if (toCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Target agent is not an active team member.' });
      }
      toName = toCheck.rows[0].full_name || toCheck.rows[0].email;
    }

    // Reassign clients
    const updateRes = await client.query(
      `UPDATE users SET assigned_agent_id = $1 WHERE reseller_id = $2 AND assigned_agent_id = $3 RETURNING id, email, full_name, company_name`,
      [toId, parentId, fromId]
    );

    const transferredCount = updateRes.rowCount;

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'team_member',
      entityId: fromId,
      action: 'clients_portfolio_reassigned',
      details: {
        fromAgentId: fromId,
        fromAgentName: fromCheck.rows[0].full_name,
        toAgentId: toId,
        toAgentName: toName,
        transferredCount
      }
    });

    await client.query('COMMIT');

    return res.json({
      message: `Successfully transferred ${transferredCount} clients from ${fromCheck.rows[0].full_name || fromCheck.rows[0].email} to ${toName}.`,
      transferredCount,
      clients: updateRes.rows
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reassign clients error:', err);
    return res.status(500).json({ error: 'Failed to reassign client portfolio' });
  } finally {
    client.release();
  }
});

// POST /api/team - Create and invite a new team member
router.post('/', authenticate, requirePermission('can_manage_team'), async (req, res) => {
  const client = await getClient();
  try {
    const parentId = req.user.effective_user_id || req.user.id;
    const { email, password, full_name, role_title = 'campaign_manager', permissions = {} } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ error: 'Please provide a valid corporate email address' });
    }
    const cleanEmail = String(email).trim().toLowerCase();

    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const cleanName = String(full_name || '').trim().slice(0, 100) || cleanEmail.split('@')[0];
    const finalPermissions = normalizePermissions(role_title, permissions);

    // Privilege escalation guard: A team member cannot grant permissions that they themselves do not possess
    if (req.user.is_team_member) {
      for (const [permKey, val] of Object.entries(finalPermissions)) {
        if (val && !req.user.permissions?.[permKey]) {
          return res.status(403).json({ error: `Privilege escalation blocked: You cannot grant permission '${permKey}' because you do not hold it.` });
        }
      }
    }

    await client.query('BEGIN');

    // Check if email already registered in system
    const existingUser = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'An account with this email already exists in the system' });
    }

    // Determine parent user's reseller context so branding & rates propagate cleanly
    const parentRes = await client.query('SELECT role, reseller_id FROM users WHERE id = $1', [parentId]);
    const parentData = parentRes.rows[0];
    const resellerId = parentData?.role === 'reseller' ? parentId : (parentData?.reseller_id || null);

    const hashed = await hashPassword(password);
    const userInsert = await client.query(`
      INSERT INTO users (email, password_hash, role, reseller_id, full_name)
      VALUES ($1, $2, 'user', $3, $4)
      RETURNING id
    `, [cleanEmail, hashed, resellerId, cleanName]);

    const newUserId = userInsert.rows[0].id;

    const teamInsert = await client.query(`
      INSERT INTO team_members (parent_user_id, user_id, role_title, permissions, status)
      VALUES ($1, $2, $3, $4, 'active')
      RETURNING id, parent_user_id, user_id, role_title, permissions, status, created_at
    `, [parentId, newUserId, role_title, JSON.stringify(finalPermissions)]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'team_member',
      entityId: teamInsert.rows[0].id,
      action: 'team_member_created',
      details: {
        parent_id: parentId,
        member_email: cleanEmail,
        role_title,
        permissions: finalPermissions
      }
    });

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Team member created successfully',
      member: {
        ...teamInsert.rows[0],
        email: cleanEmail,
        full_name: cleanName
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create team member error:', err);
    return res.status(500).json({ error: 'Failed to create team member' });
  } finally {
    client.release();
  }
});

// PUT /api/team/:id - Update team member role, permissions, status, or name
router.put('/:id', authenticate, requirePermission('can_manage_team'), async (req, res) => {
  const client = await getClient();
  try {
    const parentId = req.user.effective_user_id || req.user.id;
    const memberId = parseInt(req.params.id, 10);
    const { role_title, permissions, status, full_name } = req.body;

    if (!memberId || isNaN(memberId)) {
      return res.status(400).json({ error: 'Invalid team member ID' });
    }

    await client.query('BEGIN');

    const checkRes = await client.query(
      `SELECT tm.*, u.id as user_id, u.email FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.id = $1 AND tm.parent_user_id = $2`,
      [memberId, parentId]
    );

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Team member not found or does not belong to your organization' });
    }

    const current = checkRes.rows[0];
    const newRole = role_title || current.role_title;
    const newPermissions = permissions ? normalizePermissions(newRole, permissions) : current.permissions;

    // Privilege escalation guard: A team member cannot grant permissions that they themselves do not possess
    if (req.user.is_team_member && permissions) {
      for (const [permKey, val] of Object.entries(newPermissions)) {
        if (val && !req.user.permissions?.[permKey]) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: `Privilege escalation blocked: You cannot grant permission '${permKey}' because you do not hold it.` });
        }
      }
    }
    const newStatus = (status === 'suspended' || status === 'active') ? status : current.status;
    const cleanName = full_name !== undefined ? String(full_name).trim().slice(0, 100) : null;

    if (cleanName !== null) {
      await client.query('UPDATE users SET full_name = $1 WHERE id = $2', [cleanName, current.user_id]);
    }

    // If suspended, also set is_blocked = true and invalidate active sessions
    if (newStatus === 'suspended') {
      await client.query('UPDATE users SET is_blocked = TRUE, token_version = token_version + 1 WHERE id = $1', [current.user_id]);
    } else if (newStatus === 'active') {
      await client.query('UPDATE users SET is_blocked = FALSE WHERE id = $1', [current.user_id]);
    }

    const updateRes = await client.query(`
      UPDATE team_members
      SET role_title = $1, permissions = $2, status = $3, updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [newRole, JSON.stringify(newPermissions), newStatus, memberId]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'team_member',
      entityId: memberId,
      action: 'team_member_updated',
      details: {
        role_title: newRole,
        status: newStatus,
        permissions: newPermissions
      }
    });

    await client.query('COMMIT');

    return res.json({
      message: 'Team member updated successfully',
      member: {
        ...updateRes.rows[0],
        email: current.email,
        full_name: cleanName || current.full_name
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update team member error:', err);
    return res.status(500).json({ error: 'Failed to update team member' });
  } finally {
    client.release();
  }
});

// POST /api/team/:id/reset-password - Reset team member's password and revoke active sessions
router.post('/:id/reset-password', authenticate, requirePermission('can_manage_team'), async (req, res) => {
  try {
    const parentId = req.user.effective_user_id || req.user.id;
    const memberId = parseInt(req.params.id, 10);
    const { new_password } = req.body;

    if (!new_password || String(new_password).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const memberRes = await query(
      `SELECT tm.user_id, u.email FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.id = $1 AND tm.parent_user_id = $2`,
      [memberId, parentId]
    );

    if (memberRes.rows.length === 0) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    const { user_id, email } = memberRes.rows[0];
    const hashed = await hashPassword(new_password);

    await query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
      [hashed, user_id]
    );

    await logAudit(null, {
      actorId: req.user.id,
      entityType: 'team_member',
      entityId: memberId,
      action: 'team_member_password_reset',
      details: { email }
    });

    return res.json({ message: `Password for ${email} has been reset. All prior active sessions have been revoked.` });
  } catch (err) {
    console.error('Reset team password error:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

// DELETE /api/team/:id - Remove team member
router.delete('/:id', authenticate, requirePermission('can_manage_team'), async (req, res) => {
  const client = await getClient();
  try {
    const parentId = req.user.effective_user_id || req.user.id;
    const memberId = parseInt(req.params.id, 10);

    await client.query('BEGIN');

    const checkRes = await client.query(
      `SELECT tm.user_id, u.email FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.id = $1 AND tm.parent_user_id = $2`,
      [memberId, parentId]
    );

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Team member not found' });
    }

    const { user_id, email } = checkRes.rows[0];

    // Delete team_member row and the user record
    await client.query('DELETE FROM team_members WHERE id = $1', [memberId]);
    await client.query('DELETE FROM users WHERE id = $1', [user_id]);

    await logAudit(client, {
      actorId: req.user.id,
      entityType: 'team_member',
      entityId: memberId,
      action: 'team_member_deleted',
      details: { email }
    });

    await client.query('COMMIT');

    return res.json({ message: `Team member ${email} removed successfully` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete team member error:', err);
    return res.status(500).json({ error: 'Failed to remove team member' });
  } finally {
    client.release();
  }
});

module.exports = router;
