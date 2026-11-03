const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db');
const { authenticate } = require('../middleware/auth');

function normalizePhone(raw) {
  let value = String(raw || '').replace(/\D/g, '');
  if (value.startsWith('0')) value = value.slice(1);
  if (/^[6-9]\d{9}$/.test(value)) value = `91${value}`;
  return value;
}

// Unified Group Access Checker: Normal User (own), Reseller (own + downline clients), Super Admin (all)
async function checkGroupAccess(groupId, user, clientOrPool = null) {
  const isSuperAdmin = user.role === 'admin';
  const isReseller = user.role === 'reseller';

  let sql = 'SELECT * FROM contact_groups WHERE id = $1';
  let params = [groupId];

  if (!isSuperAdmin) {
    if (isReseller) {
      sql += ' AND (user_id = $2 OR user_id IN (SELECT id FROM users WHERE reseller_id = $2))';
      params.push(user.id);
    } else {
      sql += ' AND user_id = $2';
      params.push(user.id);
    }
  }

  const executor = clientOrPool ? (clientOrPool.query ? clientOrPool.query.bind(clientOrPool) : clientOrPool) : query;
  const res = await executor(sql, params);
  return res.rows[0] || null;
}

// GET /api/contacts/groups - List all groups with contact counts
router.get('/groups', authenticate, async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === 'admin';
    const isReseller = req.user.role === 'reseller';

    let sql = '';
    let params = [];

    if (isSuperAdmin) {
      sql = `
        SELECT g.*, COUNT(c.id)::int as total_contacts, COUNT(c.id)::int as contact_count,
               u.email as owner_email, u.role as owner_role
        FROM contact_groups g
        LEFT JOIN contacts c ON g.id = c.group_id
        LEFT JOIN users u ON g.user_id = u.id
        GROUP BY g.id, u.email, u.role
        ORDER BY g.created_at DESC
      `;
    } else if (isReseller) {
      sql = `
        SELECT g.*, COUNT(c.id)::int as total_contacts, COUNT(c.id)::int as contact_count,
               u.email as owner_email, u.role as owner_role
        FROM contact_groups g
        LEFT JOIN contacts c ON g.id = c.group_id
        LEFT JOIN users u ON g.user_id = u.id
        WHERE g.user_id = $1 OR g.user_id IN (SELECT id FROM users WHERE reseller_id = $1)
        GROUP BY g.id, u.email, u.role
        ORDER BY g.created_at DESC
      `;
      params = [req.user.id];
    } else {
      sql = `
        SELECT g.*, COUNT(c.id)::int as total_contacts, COUNT(c.id)::int as contact_count,
               u.email as owner_email, u.role as owner_role
        FROM contact_groups g
        LEFT JOIN contacts c ON g.id = c.group_id
        LEFT JOIN users u ON g.user_id = u.id
        WHERE g.user_id = $1
        GROUP BY g.id, u.email, u.role
        ORDER BY g.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('List groups error:', err);
    return res.status(500).json({ error: 'Failed to load contact groups' });
  }
});

// POST /api/contacts/groups - Create contact group (with optional initial numbers and proxy assignment)
router.post('/groups', authenticate, async (req, res) => {
  const { name, description, numbers, target_user_id } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  let effectiveUserId = req.user.id;
  if (target_user_id && (req.user.role === 'admin' || req.user.role === 'reseller')) {
    const targetInt = parseInt(target_user_id, 10);
    if (!isNaN(targetInt)) {
      if (req.user.role === 'admin') {
        effectiveUserId = targetInt;
      } else {
        const check = await query('SELECT id FROM users WHERE id = $1 AND (id = $2 OR reseller_id = $2)', [targetInt, req.user.id]);
        if (check.rows.length > 0) {
          effectiveUserId = targetInt;
        }
      }
    }
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO contact_groups (user_id, name, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [effectiveUserId, name.trim(), description || '']);
    const group = result.rows[0];

    if (Array.isArray(numbers) && numbers.length > 0) {
      const seenSet = new Set();
      const validNumbers = [];
      for (const item of numbers) {
        const rawPhone = (typeof item === 'object' && item !== null) ? (item.phone || item.phone_number) : item;
        const rawName = (typeof item === 'object' && item !== null) ? (item.name || '') : '';
        const phone = normalizePhone(rawPhone);
        if (phone && phone.length >= 10 && phone.length <= 15 && !seenSet.has(phone)) {
          seenSet.add(phone);
          validNumbers.push({ phone, name: String(rawName || '').trim().slice(0, 255) });
        }
      }

      const BATCH_SIZE = 1000;
      for (let i = 0; i < validNumbers.length; i += BATCH_SIZE) {
        const chunk = validNumbers.slice(i, i + BATCH_SIZE);
        const placeholders = [];
        const params = [group.id, effectiveUserId];
        chunk.forEach((c, idx) => {
          const base = idx * 2 + 3;
          placeholders.push(`($1, $2, $${base}, $${base + 1})`);
          params.push(c.phone, c.name);
        });
        await client.query(`
          INSERT INTO contacts (group_id, user_id, phone_number, name)
          VALUES ${placeholders.join(', ')}
        `, params);
      }
    }

    await client.query('COMMIT');
    return res.status(201).json(group);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create group error:', err);
    return res.status(500).json({ error: 'Failed to create group' });
  } finally {
    client.release();
  }
});

// POST /api/contacts/groups/merge - Merge two contact groups
router.post('/groups/merge', authenticate, async (req, res) => {
  const { source_group_id, target_group_id, delete_source } = req.body;
  const srcId = parseInt(source_group_id, 10);
  const tgtId = parseInt(target_group_id, 10);

  if (isNaN(srcId) || isNaN(tgtId) || srcId === tgtId) {
    return res.status(400).json({ error: 'Please select two different valid groups to merge' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const srcCheck = await checkGroupAccess(srcId, req.user, client);
    const tgtCheck = await checkGroupAccess(tgtId, req.user, client);

    if (!srcCheck || !tgtCheck) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source or target group not found or unauthorized' });
    }

    const tgtUserId = tgtCheck.user_id;

    const srcContacts = await client.query('SELECT phone_number, name FROM contacts WHERE group_id = $1', [srcId]);
    const tgtContacts = await client.query('SELECT phone_number FROM contacts WHERE group_id = $1', [tgtId]);
    const existingSet = new Set(tgtContacts.rows.map(r => r.phone_number));

    const toInsert = [];
    let duplicatesSkipped = 0;

    for (const c of srcContacts.rows) {
      if (existingSet.has(c.phone_number)) {
        duplicatesSkipped++;
      } else {
        existingSet.add(c.phone_number);
        toInsert.push(c);
      }
    }

    const BATCH_SIZE = 1000;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const chunk = toInsert.slice(i, i + BATCH_SIZE);
      const placeholders = [];
      const params = [tgtId, tgtUserId];
      chunk.forEach((c, idx) => {
        const base = idx * 2 + 3;
        placeholders.push(`($1, $2, $${base}, $${base + 1})`);
        params.push(c.phone_number, c.name || '');
      });
      await client.query(`
        INSERT INTO contacts (group_id, user_id, phone_number, name)
        VALUES ${placeholders.join(', ')}
      `, params);
    }

    if (delete_source) {
      await client.query('DELETE FROM contact_groups WHERE id = $1', [srcId]);
    }

    await client.query('COMMIT');
    return res.json({
      message: `Successfully merged ${toInsert.length} contacts into "${tgtCheck.name}"!`,
      mergedCount: toInsert.length,
      contactsMerged: toInsert.length,
      duplicatesSkipped,
      targetGroupId: tgtId,
      sourceDeleted: Boolean(delete_source)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Merge groups error:', err);
    return res.status(500).json({ error: 'Failed to merge contact groups' });
  } finally {
    client.release();
  }
});

// PUT /api/contacts/groups/:id - Update group name and description
router.put('/groups/:id', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  try {
    const group = await checkGroupAccess(groupId, req.user);
    if (!group) {
      return res.status(404).json({ error: 'Contact group not found or unauthorized' });
    }

    const updateRes = await query(`
      UPDATE contact_groups 
      SET name = $1, description = $2
      WHERE id = $3
      RETURNING *
    `, [name.trim(), description !== undefined ? description : '', groupId]);

    return res.json(updateRes.rows[0]);
  } catch (err) {
    console.error('Update group error:', err);
    return res.status(500).json({ error: 'Failed to update contact group' });
  }
});

// DELETE /api/contacts/groups/:id - Delete group
router.delete('/groups/:id', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  try {
    const group = await checkGroupAccess(groupId, req.user);
    if (!group) {
      return res.status(404).json({ error: 'Contact group not found or unauthorized' });
    }

    await query('DELETE FROM contact_groups WHERE id = $1', [groupId]);
    return res.json({ message: 'Group deleted successfully' });
  } catch (err) {
    console.error('Delete group error:', err);
    return res.status(500).json({ error: 'Failed to delete group' });
  }
});

// DELETE /api/contacts/groups/:id/clear - Empty all contacts in a group
router.delete('/groups/:id/clear', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  try {
    const group = await checkGroupAccess(groupId, req.user);
    if (!group) {
      return res.status(404).json({ error: 'Contact group not found or unauthorized' });
    }

    await query('DELETE FROM contacts WHERE group_id = $1', [groupId]);
    return res.json({ message: 'All contacts cleared from group successfully' });
  } catch (err) {
    console.error('Clear group contacts error:', err);
    return res.status(500).json({ error: 'Failed to clear contacts' });
  }
});

// GET /api/contacts/groups/:id/contacts - List contacts in a group (supports search & high volume)
router.get('/groups/:id/contacts', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  try {
    const groupCheck = await checkGroupAccess(groupId, req.user);
    if (!groupCheck) {
      return res.status(404).json({ error: 'Contact group not found or unauthorized' });
    }

    const searchQuery = (req.query.search || '').trim().toLowerCase();
    let sql = 'SELECT * FROM contacts WHERE group_id = $1';
    const params = [groupId];

    if (searchQuery) {
      sql += ' AND (LOWER(phone_number) LIKE $2 OR LOWER(name) LIKE $2)';
      params.push(`%${searchQuery}%`);
    }
    sql += ' ORDER BY id ASC LIMIT 5000';

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('List contacts error:', err);
    return res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// GET /api/contacts/groups/:id/all-numbers - Get all phone numbers for composer integration
router.get('/groups/:id/all-numbers', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  try {
    const groupCheck = await checkGroupAccess(groupId, req.user);
    if (!groupCheck) {
      return res.status(404).json({ error: 'Contact group not found or unauthorized' });
    }

    const result = await query(`
      SELECT phone_number, name 
      FROM contacts 
      WHERE group_id = $1 
      ORDER BY id ASC
    `, [groupId]);

    return res.json({
      groupId,
      groupName: groupCheck.name,
      group: { id: groupId, name: groupCheck.name },
      total: result.rows.length,
      count: result.rows.length,
      numbers: result.rows.map(r => r.phone_number),
      contacts: result.rows
    });
  } catch (err) {
    console.error('Get group all numbers error:', err);
    return res.status(500).json({ error: 'Failed to load group numbers' });
  }
});

// DELETE /api/contacts/groups/:groupId/contacts/:contactId - Delete single contact from group
router.delete('/groups/:groupId/contacts/:contactId', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  const contactId = parseInt(req.params.contactId, 10);
  if (isNaN(groupId) || isNaN(contactId)) return res.status(400).json({ error: 'Invalid ID parameters' });

  try {
    const groupCheck = await checkGroupAccess(groupId, req.user);
    if (!groupCheck) return res.status(404).json({ error: 'Contact group not found or unauthorized' });

    const del = await query('DELETE FROM contacts WHERE id = $1 AND group_id = $2 RETURNING id', [contactId, groupId]);
    if (!del.rows.length) return res.status(404).json({ error: 'Contact not found in this group' });

    return res.json({ message: 'Contact deleted successfully' });
  } catch (err) {
    console.error('Delete individual contact error:', err);
    return res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// POST /api/contacts/groups/:id/contacts - Add single contact to group (Name is optional)
router.post('/groups/:id/contacts', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  const { phone_number, name } = req.body;
  const phone = normalizePhone(phone_number);
  if (!phone || phone.length < 10 || phone.length > 15) {
    return res.status(400).json({ error: 'Valid 10-15 digit phone number is required' });
  }

  try {
    const groupCheck = await checkGroupAccess(groupId, req.user);
    if (!groupCheck) {
      return res.status(404).json({ error: 'Contact group not found or unauthorized' });
    }

    const cleanName = name ? String(name).trim().slice(0, 255) : '';

    // Check existing contact in group to avoid duplicates
    const existing = await query('SELECT * FROM contacts WHERE group_id = $1 AND phone_number = $2', [groupId, phone]);
    if (existing.rows.length > 0) {
      if (cleanName && cleanName !== existing.rows[0].name) {
        const updated = await query('UPDATE contacts SET name = $1 WHERE id = $2 RETURNING *', [cleanName, existing.rows[0].id]);
        return res.json(updated.rows[0]);
      }
      return res.json(existing.rows[0]);
    }

    const insertRes = await query(
      'INSERT INTO contacts (group_id, user_id, phone_number, name) VALUES ($1, $2, $3, $4) RETURNING *',
      [groupId, groupCheck.user_id, phone, cleanName]
    );
    return res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    console.error('Add single contact error:', err);
    return res.status(500).json({ error: 'Failed to add contact' });
  }
});

// POST /api/contacts/groups/:id/bulk-numbers - Add multiple numbers (with or without names) to existing group
router.post('/groups/:id/bulk-numbers', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  const { numbers } = req.body; // Array of strings or array of { phone, name }

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'No phone numbers provided' });
  }
  if (numbers.length > 50000) {
    return res.status(400).json({ error: 'Maximum 50,000 contacts allowed per batch' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const groupCheck = await checkGroupAccess(groupId, req.user, client);
    if (!groupCheck) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contact group not found or unauthorized' });
    }

    // Get existing numbers in this group to avoid duplicates
    const existingRows = await client.query('SELECT phone_number FROM contacts WHERE group_id = $1', [groupId]);
    const existingSet = new Set(existingRows.rows.map(r => r.phone_number));

    const seenInBatch = new Set();
    const toInsert = [];
    let duplicatesSkipped = 0;
    let invalidSkipped = 0;

    for (const item of numbers) {
      const rawPhone = (typeof item === 'object' && item !== null) ? (item.phone || item.phone_number) : item;
      const rawName = (typeof item === 'object' && item !== null) ? (item.name || '') : '';
      const phone = normalizePhone(rawPhone);

      if (!phone || phone.length < 10 || phone.length > 15) {
        invalidSkipped++;
        continue;
      }
      if (existingSet.has(phone) || seenInBatch.has(phone)) {
        duplicatesSkipped++;
        continue;
      }

      seenInBatch.add(phone);
      toInsert.push({ phone, name: String(rawName || '').trim().slice(0, 255) });
    }

    // Batch insert
    const BATCH_SIZE = 1000;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const chunk = toInsert.slice(i, i + BATCH_SIZE);
      const placeholders = [];
      const params = [groupId, groupCheck.user_id];
      chunk.forEach((c, idx) => {
        const base = idx * 2 + 3;
        placeholders.push(`($1, $2, $${base}, $${base + 1})`);
        params.push(c.phone, c.name);
      });
      await client.query(`
        INSERT INTO contacts (group_id, user_id, phone_number, name)
        VALUES ${placeholders.join(', ')}
      `, params);
    }

    await client.query('COMMIT');
    return res.json({
      message: `Successfully added ${toInsert.length} contacts!`,
      addedCount: toInsert.length,
      duplicatesSkipped,
      invalidSkipped,
      totalContacts: existingSet.size + toInsert.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk numbers add error:', err);
    return res.status(500).json({ error: 'Failed to add contacts' });
  } finally {
    client.release();
  }
});

// POST /api/contacts/groups/:id/import - Bulk import contacts from file or array
router.post('/groups/:id/import', authenticate, async (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  const { contacts: rawList } = req.body;

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return res.status(400).json({ error: 'No contacts provided' });
  }
  if (rawList.length > 100000) {
    return res.status(400).json({ error: 'A contact import may contain at most 100,000 contacts' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const groupCheck = await checkGroupAccess(groupId, req.user, client);
    if (!groupCheck) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contact group not found or unauthorized' });
    }

    const existingRows = await client.query('SELECT phone_number FROM contacts WHERE group_id = $1', [groupId]);
    const existingSet = new Set(existingRows.rows.map(r => r.phone_number));

    const seenInBatch = new Set();
    const validList = [];
    let duplicatesSkipped = 0;
    let invalidSkipped = 0;

    for (const item of rawList) {
      const rawPhone = (typeof item === 'object' && item !== null) ? (item.phone || item.phone_number) : item;
      const rawName = (typeof item === 'object' && item !== null) ? (item.name || '') : '';
      const phone = normalizePhone(rawPhone);

      if (!phone || phone.length < 10 || phone.length > 15) {
        invalidSkipped++;
        continue;
      }
      if (existingSet.has(phone) || seenInBatch.has(phone)) {
        duplicatesSkipped++;
        continue;
      }
      seenInBatch.add(phone);
      validList.push({
        phone,
        name: String(rawName || '').trim().slice(0, 255),
        custom_fields: (item && item.custom_fields) || {}
      });
    }

    const BATCH_SIZE = 1000;
    for (let i = 0; i < validList.length; i += BATCH_SIZE) {
      const chunk = validList.slice(i, i + BATCH_SIZE);
      const placeholders = [];
      const params = [groupId, groupCheck.user_id];

      chunk.forEach((item, idx) => {
        const base = idx * 3 + 3;
        placeholders.push(`($1, $2, $${base}, $${base + 1}, $${base + 2})`);
        params.push(item.phone, item.name, JSON.stringify(item.custom_fields));
      });

      const insertSql = `
        INSERT INTO contacts (group_id, user_id, phone_number, name, custom_fields)
        VALUES ${placeholders.join(', ')}
      `;
      await client.query(insertSql, params);
    }

    await client.query('COMMIT');
    return res.json({
      message: `Successfully imported ${validList.length} contacts!`,
      addedCount: validList.length,
      duplicatesSkipped,
      invalidSkipped
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import contacts error:', err);
    return res.status(500).json({ error: 'Failed to import contacts' });
  } finally {
    client.release();
  }
});

// GET /api/contacts/blacklist - List blacklisted numbers (Role-aware)
router.get('/blacklist', authenticate, async (req, res) => {
  try {
    const isSuperAdmin = req.user.role === 'admin';
    const isReseller = req.user.role === 'reseller';

    let sql = '';
    let params = [];

    if (isSuperAdmin) {
      sql = `
        SELECT b.*, u.email as owner_email, u.role as owner_role
        FROM blacklist b
        LEFT JOIN users u ON b.user_id = u.id
        ORDER BY b.created_at DESC
      `;
    } else if (isReseller) {
      sql = `
        SELECT b.*, u.email as owner_email, u.role as owner_role
        FROM blacklist b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.user_id = $1 OR b.user_id IS NULL OR b.user_id IN (SELECT id FROM users WHERE reseller_id = $1)
        ORDER BY b.created_at DESC
      `;
      params = [req.user.id];
    } else {
      sql = `
        SELECT b.*, u.email as owner_email, u.role as owner_role
        FROM blacklist b
        LEFT JOIN users u ON b.user_id = u.id
        WHERE b.user_id = $1 OR b.user_id IS NULL
        ORDER BY b.created_at DESC
      `;
      params = [req.user.id];
    }

    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('List blacklist error:', err);
    return res.status(500).json({ error: 'Failed to load blacklist' });
  }
});

// POST /api/contacts/blacklist - Add single number to blacklist (with duplicate prevention)
router.post('/blacklist', authenticate, async (req, res) => {
  const { phone_number, reason, is_global } = req.body;
  const normalizedPhone = normalizePhone(phone_number);
  if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return res.status(400).json({ error: 'Valid 10-15 digit phone number is required' });
  }

  const assignedUserId = (req.user.role === 'admin' && Boolean(is_global)) ? null : req.user.id;

  try {
    const existing = await query(`
      SELECT * FROM blacklist 
      WHERE phone_number = $1 AND (user_id = $2 OR (user_id IS NULL AND $2 IS NULL))
    `, [normalizedPhone, assignedUserId]);

    if (existing.rows.length > 0) {
      return res.status(200).json(existing.rows[0]);
    }

    const result = await query(`
      INSERT INTO blacklist (user_id, phone_number, reason)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [assignedUserId, normalizedPhone, String(reason || 'User requested opt-out').slice(0, 255)]);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add blacklist error:', err);
    return res.status(500).json({ error: 'Failed to add to blacklist' });
  }
});

// POST /api/contacts/blacklist/bulk - Add multiple numbers to blacklist
router.post('/blacklist/bulk', authenticate, async (req, res) => {
  const { numbers, reason, is_global } = req.body;
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'No phone numbers provided' });
  }

  const assignedUserId = (req.user.role === 'admin' && Boolean(is_global)) ? null : req.user.id;
  const blockReason = String(reason || 'Bulk opt-out / DND list import').slice(0, 255);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const existingRows = await client.query(`
      SELECT phone_number FROM blacklist 
      WHERE user_id = $1 OR (user_id IS NULL AND $1 IS NULL)
    `, [assignedUserId]);
    const existingSet = new Set(existingRows.rows.map(r => r.phone_number));

    const seenInBatch = new Set();
    const toInsert = [];
    let skippedCount = 0;

    for (const raw of numbers) {
      const phone = normalizePhone(raw);
      if (phone && phone.length >= 10 && phone.length <= 15) {
        if (!existingSet.has(phone) && !seenInBatch.has(phone)) {
          seenInBatch.add(phone);
          toInsert.push(phone);
        } else {
          skippedCount++;
        }
      } else {
        skippedCount++;
      }
    }

    const BATCH_SIZE = 1000;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const chunk = toInsert.slice(i, i + BATCH_SIZE);
      const placeholders = [];
      const params = [assignedUserId, blockReason];
      chunk.forEach((p, idx) => {
        placeholders.push(`($1, $${idx + 3}, $2)`);
        params.push(p);
      });
      await client.query(`
        INSERT INTO blacklist (user_id, phone_number, reason)
        VALUES ${placeholders.join(', ')}
      `, params);
    }

    await client.query('COMMIT');
    return res.json({
      message: `Successfully blocked ${toInsert.length} numbers!`,
      addedCount: toInsert.length,
      skippedCount
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk blacklist error:', err);
    return res.status(500).json({ error: 'Failed to bulk add to blacklist' });
  } finally {
    client.release();
  }
});

// DELETE /api/contacts/blacklist/:target - Remove from blacklist by ID or phone number
router.delete('/blacklist/:target', authenticate, async (req, res) => {
  const target = req.params.target;
  try {
    const isSmallId = /^\d+$/.test(target) && target.length <= 9;
    const norm = normalizePhone(target);
    const isSuperAdmin = req.user.role === 'admin';
    const isReseller = req.user.role === 'reseller';

    let authCondition = '';
    let params = [];

    if (isSuperAdmin) {
      authCondition = '1=1';
      params = [target, norm];
    } else if (isReseller) {
      authCondition = `(user_id = $3 OR user_id IN (SELECT id FROM users WHERE reseller_id = $3))`;
      params = [target, norm, req.user.id];
    } else {
      authCondition = `user_id = $3`;
      params = [target, norm, req.user.id];
    }

    if (isSmallId) {
      const idVal = parseInt(target, 10);
      await query(`DELETE FROM blacklist WHERE (id = ${idVal} OR phone_number = $1 OR phone_number = $2) AND ${authCondition}`, params);
    } else {
      await query(`DELETE FROM blacklist WHERE (phone_number = $1 OR phone_number = $2) AND ${authCondition}`, params);
    }
    return res.json({ message: 'Number removed from blacklist' });
  } catch (err) {
    console.error('Delete blacklist error:', err);
    return res.status(500).json({ error: 'Failed to remove from blacklist' });
  }
});

module.exports = router;
