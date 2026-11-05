#!/usr/bin/env node
/**
 * Emergency Admin Password Recovery & Provisioning CLI Tool
 * Usage: node scripts/reset-admin.js [admin_email] [new_password]
 * Example: node scripts/reset-admin.js admin@messagesphere.com MyNewSecretPass123
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, initializeUserCredits } = require('../db');

async function resetAdmin() {
  const targetEmail = (process.argv[2] || process.env.ADMIN_EMAIL || 'admin@messagesphere.com').trim().toLowerCase();
  const targetPassword = process.argv[3] || process.env.ADMIN_PASSWORD;

  if (!targetPassword) {
    console.error('❌ Error: New password must be supplied.');
    console.error('Usage: node scripts/reset-admin.js [admin_email] <new_password>');
    process.exit(1);
  }

  if (targetPassword.length < 8) {
    console.error('❌ Error: Password must be at least 8 characters long.');
    process.exit(1);
  }

  console.log(`[RECOVERY] Initiating admin recovery for: ${targetEmail}`);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hash = await bcrypt.hash(targetPassword, 10);
    const existing = await client.query('SELECT id, role FROM users WHERE email = $1', [targetEmail]);

    let adminId;
    if (existing.rows.length === 0) {
      console.log(`[RECOVERY] No existing account found. Creating new Administrator: ${targetEmail}`);
      const res = await client.query(`
        INSERT INTO users (email, password_hash, role, token_version, is_blocked)
        VALUES ($1, $2, 'admin', 1, false)
        RETURNING id
      `, [targetEmail, hash]);
      adminId = res.rows[0].id;
      await initializeUserCredits(client, adminId);
    } else {
      adminId = existing.rows[0].id;
      console.log(`[RECOVERY] Updating existing account (ID #${adminId}) to Administrator...`);
      await client.query(`
        UPDATE users
        SET password_hash = $1,
            role = 'admin',
            is_blocked = false,
            token_version = token_version + 1
        WHERE id = $2
      `, [hash, adminId]);
      await initializeUserCredits(client, adminId);
    }

    await client.query('COMMIT');
    console.log(`✅ Success! Administrator [${targetEmail}] password reset successfully.`);
    console.log(`🔒 All prior active JWT sessions have been invalidated via token_version revocation.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to reset admin account:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

resetAdmin().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
