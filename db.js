const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const isRemoteDb = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (process.env.NODE_ENV !== 'production' ? 'postgresql://localhost:5432/messagesphere' : undefined),
  ssl: isRemoteDb ? { rejectUnauthorized: false } : false
});

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

const CREDIT_TYPES = ['normal', 'dp', 'cta', 'dp_cta', 'own_number'];
const DESTINATIONS = ['domestic', 'international'];

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'reseller', 'user')),
        reseller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_blocked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. User Credits table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_credits (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credit_type VARCHAR(50) NOT NULL,
        destination VARCHAR(50) NOT NULL,
        balance BIGINT DEFAULT 0,
        UNIQUE(user_id, credit_type, destination)
      );
    `);

    // 3. Credit Transactions Audit Log
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id SERIAL PRIMARY KEY,
        from_user_id INTEGER REFERENCES users(id),
        to_user_id INTEGER NOT NULL REFERENCES users(id),
        credit_type VARCHAR(50) NOT NULL,
        destination VARCHAR(50) NOT NULL,
        amount BIGINT NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Campaigns Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        campaign_type VARCHAR(50) NOT NULL,
        destination VARCHAR(50) NOT NULL,
        message_text TEXT NOT NULL,
        total_numbers INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Approved', 'Rejected', 'Completed', 'Report Updated')),
        delivered_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        attachment_url TEXT,
        cta_data JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Campaign Recipients Table (Bulk indexed)
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_recipients (
        id BIGSERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        phone_number VARCHAR(30) NOT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recipients_phone ON campaign_recipients(phone_number);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON credit_transactions(to_user_id, created_at DESC);`);

    // Schema migrations for enterprise features
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT 'Untitled Campaign';`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel_type VARCHAR(50) DEFAULT 'shared_gateway';`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE;`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS failed_refunded BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sender_header VARCHAR(20);`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_triggered BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS report_processed_at TIMESTAMP WITH TIME ZONE;`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS report_processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(120);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(160);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_address TEXT;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gstin VARCHAR(20);`);

    // 6. Contact Groups & Contacts
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_groups (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contact_groups_user ON contact_groups(user_id, created_at DESC);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id BIGSERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone_number VARCHAR(30) NOT NULL,
        name VARCHAR(255),
        custom_fields JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contacts_group ON contacts(group_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contacts_group_phone ON contacts(group_id, phone_number);`);

    // Immutable operational log for the intentionally manual dispatch workflow.
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id BIGSERIAL PRIMARY KEY,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER,
        action VARCHAR(100) NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at DESC);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Resolved', 'Rejected')),
        requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP WITH TIME ZONE,
        resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        resolution_note VARCHAR(1000)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status ON password_reset_requests(status, requested_at DESC);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS campaign_notes (
        id BIGSERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        note TEXT NOT NULL,
        external_reference VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaign_notes_campaign ON campaign_notes(campaign_id, created_at DESC);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS retention_settings (
        setting_key VARCHAR(80) PRIMARY KEY,
        retention_days INTEGER NOT NULL CHECK (retention_days BETWEEN 30 AND 3650),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO retention_settings (setting_key, retention_days)
      VALUES ('campaign_data', 365), ('uploaded_assets', 365), ('audit_events', 2555)
      ON CONFLICT (setting_key) DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reseller_profiles (
        reseller_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        brand_name VARCHAR(120) NOT NULL,
        logo_url TEXT,
        accent_color VARCHAR(7) NOT NULL DEFAULT '#4f46e5',
        support_email VARCHAR(255),
        support_phone VARCHAR(30),
        custom_domain VARCHAR(255),
        domain_status VARCHAR(30) NOT NULL DEFAULT 'Not configured' CHECK (domain_status IN ('Not configured', 'Pending verification', 'Verified')),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. Blacklist / DND Numbers
    await client.query(`
      CREATE TABLE IF NOT EXISTS blacklist (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        phone_number VARCHAR(30) NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_blacklist_phone ON blacklist(phone_number);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_blacklist_user_phone ON blacklist(user_id, phone_number);`);

    // 8. Message Templates
    await client.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel VARCHAR(20) DEFAULT 'whatsapp',
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) DEFAULT 'MARKETING',
        sub_category VARCHAR(50),
        content TEXT NOT NULL,
        is_unicode BOOLEAN DEFAULT FALSE,
        character_count INTEGER DEFAULT 0,
        parts_count INTEGER DEFAULT 1,
        dlt_template_id VARCHAR(100),
        is_approved BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS channel VARCHAR(20) DEFAULT 'whatsapp';`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS sub_category VARCHAR(50);`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_unicode BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS character_count INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS parts_count INTEGER DEFAULT 1;`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS template_type VARCHAR(20) DEFAULT 'standard';`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS attachment_url TEXT;`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'none';`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255);`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS attachment_size INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS cta_data JSONB;`);
    await client.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_templates_user_channel ON templates(user_id, channel);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_templates_channel_created ON templates(channel, created_at DESC);`);


    // 10. Sender Headers
    await client.query(`
      CREATE TABLE IF NOT EXISTS sender_headers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        header_name VARCHAR(10) NOT NULL,
        entity_id VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 12. Scheduled Campaign Admin Reminders & Notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_reminders (
        id BIGSERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
        reminder_type VARCHAR(50) DEFAULT 'scheduled_campaign',
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_reminders_status ON admin_reminders(is_read, scheduled_for ASC);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        package_name VARCHAR(100),
        credits_requested INTEGER NOT NULL,
        credit_type VARCHAR(50) NOT NULL,
        destination VARCHAR(50) NOT NULL,
        amount_inr NUMERIC(10, 2) DEFAULT 0,
        utr_number VARCHAR(100),
        status VARCHAR(20) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE credit_requests ADD COLUMN IF NOT EXISTS receipt_url TEXT;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_credit_requests_user ON credit_requests(user_id, status);`);

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@messagesphere.com').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const adminCheck = await client.query(`SELECT id, password_hash FROM users WHERE email = $1`, [adminEmail]);

    if (adminCheck.rows.length === 0) {
      console.log(`[AUTH] Seeding initial admin account: ${adminEmail}`);
      const hash = await bcrypt.hash(adminPassword, 10);
      const insertUser = await client.query(`
        INSERT INTO users (email, password_hash, role)
        VALUES ($1, $2, 'admin')
        RETURNING id
      `, [adminEmail, hash]);

      const adminId = insertUser.rows[0].id;
      for (const dest of DESTINATIONS) {
        for (const type of CREDIT_TYPES) {
          await client.query(`
            INSERT INTO user_credits (user_id, credit_type, destination, balance)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, credit_type, destination) DO NOTHING
          `, [adminId, type, dest, 10000000]);
        }
      }
      console.log(`[AUTH] Admin successfully provisioned: ${adminEmail}`);
    } else {
      const currentHash = adminCheck.rows[0].password_hash;
      const isMatch = await bcrypt.compare(adminPassword, currentHash);
      if (!isMatch && (process.env.RESET_ADMIN === 'true' || adminPassword === 'admin123')) {
        const newHash = await bcrypt.hash(adminPassword, 10);
        await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, adminCheck.rows[0].id]);
        console.log(`[AUTH] Admin password synchronized to: ${adminPassword}`);
      }
    }

    await client.query('COMMIT');
    console.log('PostgreSQL tables initialized successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Helper to initialize zero credits for a newly created user
async function initializeUserCredits(client, userId) {
  for (const dest of DESTINATIONS) {
    for (const type of CREDIT_TYPES) {
      await client.query(`
        INSERT INTO user_credits (user_id, credit_type, destination, balance)
        VALUES ($1, $2, $3, 0)
        ON CONFLICT (user_id, credit_type, destination) DO NOTHING
      `, [userId, type, dest]);
    }
  }
}

module.exports = {
  pool,
  query,
  getClient,
  initDB,
  initializeUserCredits,
  CREDIT_TYPES,
  DESTINATIONS
};
