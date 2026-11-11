const { Pool } = require('pg');
const { hashPassword } = require('./services/hasher');
require('dotenv').config();

const isRemoteDb = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || (process.env.NODE_ENV !== 'production' ? 'postgresql://localhost:5432/messagesphere' : undefined),
  ssl: isRemoteDb ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true' } : false,
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

const CREDIT_TYPES = ['gsm_sms', 'normal', 'dp', 'cta', 'dp_cta', 'own_number'];
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
        title VARCHAR(255) DEFAULT 'Untitled Campaign',
        channel_type VARCHAR(50) DEFAULT 'shared_gateway',
        campaign_type VARCHAR(50) NOT NULL,
        destination VARCHAR(50) NOT NULL,
        message_text TEXT NOT NULL,
        total_numbers INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Approved', 'Rejected', 'Completed', 'Report Updated')),
        delivered_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        attachment_url TEXT,
        attachments JSONB DEFAULT '[]'::jsonb,
        cta_data JSONB,
        scheduled_at TIMESTAMP WITH TIME ZONE,
        scheduled_triggered BOOLEAN DEFAULT FALSE,
        failed_refunded BOOLEAN DEFAULT FALSE,
        report_processed_at TIMESTAMP WITH TIME ZONE,
        report_processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recipients_camp_status ON campaign_recipients(campaign_id, status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recipients_phone ON campaign_recipients(phone_number);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON credit_transactions(to_user_id, created_at DESC);`);

    // Schema migrations for enterprise features
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS title VARCHAR(255) DEFAULT 'Untitled Campaign';`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel_type VARCHAR(50) DEFAULT 'shared_gateway';`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_channel_created ON campaigns(channel_type, created_at DESC);`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE;`);
    await client.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS failed_refunded BOOLEAN DEFAULT FALSE;`);
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
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_group_phone ON contacts(group_id, phone_number);`);

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
      CREATE TABLE IF NOT EXISTS reminder_dismissals (
        reminder_id BIGINT NOT NULL REFERENCES admin_reminders(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (reminder_id, user_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reminder_dismissals_user ON reminder_dismissals(user_id);`);

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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE credit_requests 
        ALTER COLUMN created_at TYPE TIMESTAMP WITH TIME ZONE;
    `);
    await client.query(`
      ALTER TABLE credit_requests 
        ADD COLUMN IF NOT EXISTS receipt_url TEXT,
        ADD COLUMN IF NOT EXISTS rate_per_credit NUMERIC(10, 4) DEFAULT 0.1500,
        ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(10, 2) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'Unpaid',
        ADD COLUMN IF NOT EXISTS billing_type VARCHAR(20) DEFAULT 'postpaid_credit',
        ADD COLUMN IF NOT EXISTS payment_notes TEXT,
        ADD COLUMN IF NOT EXISTS due_date DATE,
        ADD COLUMN IF NOT EXISTS payment_history JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS channel_rates JSONB DEFAULT '{}'::jsonb;
    `);
    await client.query(`ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS rate_inr NUMERIC(10, 4) DEFAULT 0.1500;`);
    
    // Balance non-negative integrity constraint
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'user_credits_balance_non_negative'
        ) THEN
          UPDATE user_credits SET balance = 0 WHERE balance < 0;
          ALTER TABLE user_credits ADD CONSTRAINT user_credits_balance_non_negative CHECK (balance >= 0);
        END IF;
      END $$;
    `);
    
    // GST vs Non-GST Invoicing & Smart Reseller Auto-Refund Schema Migrations
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(20) DEFAULT 'non_gst';`);

    // Credit Plans & Pricing Packages (Admin Direct Clients vs Wholesale Resellers vs Reseller Custom Client Plans)
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_plans (
        id SERIAL PRIMARY KEY,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_role VARCHAR(20) NOT NULL DEFAULT 'user', -- 'user' (direct clients) or 'reseller' (wholesale partners)
        plan_name VARCHAR(150) NOT NULL,
        description TEXT,
        credit_type VARCHAR(50) NOT NULL,
        destination VARCHAR(50) NOT NULL DEFAULT 'domestic',
        credits INTEGER NOT NULL,
        rate_per_credit NUMERIC(10, 4) NOT NULL,
        total_amount NUMERIC(12, 2) NOT NULL,
        badge_text VARCHAR(50),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_credit_plans_created_by ON credit_plans(created_by);
      CREATE INDEX IF NOT EXISTS idx_credit_plans_target_role ON credit_plans(target_role);
      CREATE INDEX IF NOT EXISTS idx_credit_plans_active ON credit_plans(is_active);
    `);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS refund_destination VARCHAR(20) DEFAULT 'user';`);
    await client.query(`UPDATE users SET tax_mode = 'with_gst' WHERE gstin IS NOT NULL AND TRIM(gstin) != '' AND (tax_mode IS NULL OR tax_mode = 'non_gst');`);

    await client.query(`ALTER TABLE credit_requests ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(20) DEFAULT 'non_gst';`);
    await client.query(`ALTER TABLE credit_requests ADD COLUMN IF NOT EXISTS base_amount NUMERIC(10, 2) DEFAULT 0.00;`);
    await client.query(`ALTER TABLE credit_requests ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10, 2) DEFAULT 0.00;`);

    await client.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(20) DEFAULT 'non_gst';`);
    await client.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS base_amount NUMERIC(10, 2) DEFAULT 0.00;`);
    await client.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10, 2) DEFAULT 0.00;`);
    await client.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS refund_client_email VARCHAR(255);`);
    await client.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS refund_campaign_id INTEGER;`);
    await client.query(`
      UPDATE user_credits SET rate_inr = 0.1200 WHERE credit_type = 'gsm_sms' AND destination = 'domestic' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 0.2800 WHERE credit_type = 'dp' AND destination = 'domestic' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 0.2400 WHERE credit_type = 'cta' AND destination = 'domestic' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 0.3500 WHERE credit_type = 'dp_cta' AND destination = 'domestic' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 0.0800 WHERE credit_type = 'own_number' AND destination = 'domestic' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 1.5000 WHERE credit_type = 'gsm_sms' AND destination = 'international' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 2.0000 WHERE credit_type = 'normal' AND destination = 'international' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 2.5000 WHERE credit_type = 'dp' AND destination = 'international' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 2.5000 WHERE credit_type = 'cta' AND destination = 'international' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 3.0000 WHERE credit_type = 'dp_cta' AND destination = 'international' AND (rate_inr IS NULL OR rate_inr = 0.1500);
      UPDATE user_credits SET rate_inr = 1.2000 WHERE credit_type = 'own_number' AND destination = 'international' AND (rate_inr IS NULL OR rate_inr = 0.1500);
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_credit_requests_user ON credit_requests(user_id, status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_credit_requests_payment ON credit_requests(payment_status, status);`);
    await client.query(`
      ALTER TABLE credit_transactions ALTER COLUMN to_user_id DROP NOT NULL;
      ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_from_user_id_fkey;
      ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_to_user_id_fkey;
      ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE credit_requests ALTER COLUMN user_id DROP NOT NULL;
      ALTER TABLE credit_requests DROP CONSTRAINT IF EXISTS credit_requests_user_id_fkey;
      ALTER TABLE credit_requests ADD CONSTRAINT credit_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    `);

    await client.query(`ALTER TABLE credit_requests ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);`);
    await client.query(`ALTER TABLE credit_requests ALTER COLUMN utr_number DROP NOT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_from_user ON credit_transactions(from_user_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_to_user_created ON credit_transactions(to_user_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_from_to ON credit_transactions(from_user_id, to_user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_operator_queue ON campaigns(created_at ASC) WHERE status IN ('Submitted', 'Approved');`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_status_created ON campaigns(status, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_user_created ON campaigns(user_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_reseller_id ON users(reseller_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_role_reseller ON users(role, reseller_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_blacklist_user_created ON blacklist(user_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_blacklist_phone ON blacklist(phone_number);`);

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;`);
    await client.query(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'credit';`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_transactions_direction ON credit_transactions(direction);`);
    await client.query(`CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1001;`);
    await client.query(`ALTER TABLE credit_requests ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50);`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_requests_invoice_no ON credit_requests(invoice_number) WHERE invoice_number IS NOT NULL;`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS brand_name VARCHAR(120) NOT NULL DEFAULT 'Partner Portal';`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS logo_url TEXT;`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7) NOT NULL DEFAULT '#4f46e5';`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS support_email VARCHAR(255);`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS support_phone VARCHAR(30);`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255);`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS domain_status VARCHAR(30) NOT NULL DEFAULT 'Not configured';`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reseller_custom_domain ON reseller_profiles(LOWER(custom_domain)) WHERE custom_domain IS NOT NULL AND custom_domain != '';`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS invite_code VARCHAR(64);`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS allow_self_registration BOOLEAN NOT NULL DEFAULT TRUE;`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS default_rates JSONB DEFAULT '{}'::jsonb;`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reseller_invite_code ON reseller_profiles(LOWER(invite_code)) WHERE invite_code IS NOT NULL AND invite_code != '';`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS favicon_url TEXT;`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS portal_title VARCHAR(150);`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS company_legal_name VARCHAR(200);`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS company_gstin VARCHAR(30);`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS company_address TEXT;`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS support_whatsapp VARCHAR(30);`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS help_url TEXT;`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS terms_url TEXT;`);
    await client.query(`ALTER TABLE reseller_profiles ADD COLUMN IF NOT EXISTS privacy_url TEXT;`);

    // Automated Cloud & SaaS Infrastructure Integrations (Render.com API Key & Service ID)
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_integrations (
        config_key VARCHAR(80) PRIMARY KEY,
        config_value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Backfill clean invite codes for any reseller profiles missing one
    const unseededInvites = await client.query(`SELECT reseller_id, brand_name FROM reseller_profiles WHERE invite_code IS NULL OR invite_code = ''`);
    for (const rRow of unseededInvites.rows) {
      let codeCandidate = (rRow.brand_name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
      if (!codeCandidate || codeCandidate.length < 3) {
        codeCandidate = `reseller${rRow.reseller_id}`;
      }
      let finalCode = codeCandidate;
      let suffix = 1;
      while (true) {
        const clashRes = await client.query(`SELECT 1 FROM reseller_profiles WHERE LOWER(invite_code) = LOWER($1) AND reseller_id != $2`, [finalCode, rRow.reseller_id]);
        if (clashRes.rows.length === 0) break;
        suffix++;
        finalCode = `${codeCandidate}${suffix}`;
      }
      await client.query(`UPDATE reseller_profiles SET invite_code = $1 WHERE reseller_id = $2`, [finalCode, rRow.reseller_id]);
    }

    // Schema Migrations Table: guarantees migrations run ONCE and never mutate runtime data on boot
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const hasMigratedDirection = await client.query(`SELECT 1 FROM schema_migrations WHERE id = 'migrate_legacy_ledger_directions'`);
    if (hasMigratedDirection.rows.length === 0) {
      await client.query(`
        UPDATE credit_transactions 
        SET direction = (
          CASE 
            WHEN refund_campaign_id IS NOT NULL THEN 'refund'
            WHEN reason ILIKE '%deduction%' OR reason ILIKE '%debit%' OR reason ILIKE '%campaign #%' OR reason ILIKE '%transferred out%' THEN 'debit'
            ELSE 'credit'
          END
        )
        WHERE direction IS NULL;
      `);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ('migrate_legacy_ledger_directions') ON CONFLICT DO NOTHING;`);
    }

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@messagesphere.com').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const isProduction = process.env.NODE_ENV === 'production';
    const adminCheck = await client.query(`SELECT id, password_hash FROM users WHERE email = $1`, [adminEmail]);

    if (adminCheck.rows.length === 0) {
      if (isProduction && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin123')) {
        console.warn(`[AUTH] Production environment detected: Default admin account creation skipped. Set explicit ADMIN_PASSWORD or run 'npm run reset-admin' to initialize.`);
      } else {
        console.log(`[AUTH] Seeding initial admin account: ${adminEmail}`);
        const hash = await hashPassword(adminPassword);
        const insertUser = await client.query(`
          INSERT INTO users (email, password_hash, role, token_version)
          VALUES ($1, $2, 'admin', 1)
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
      }
    } else if (process.env.RESET_ADMIN === 'true') {
      const newHash = await hashPassword(adminPassword);
      await client.query(`UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`, [newHash, adminCheck.rows[0].id]);
      console.log(`[AUTH] Admin password reset requested via RESET_ADMIN=true`);
    }

    // Ensure all existing users have user_credits rows for all CREDIT_TYPES (Single atomic query)
    await client.query(`
      INSERT INTO user_credits (user_id, credit_type, destination, balance)
      SELECT u.id, c.credit_type, d.destination, (CASE WHEN u.role = 'admin' THEN 10000000 ELSE 0 END)
      FROM users u
      CROSS JOIN (SELECT unnest(ARRAY['gsm_sms', 'normal', 'dp', 'cta', 'dp_cta', 'own_number']) AS credit_type) c
      CROSS JOIN (SELECT unnest(ARRAY['domestic', 'international']) AS destination) d
      ON CONFLICT (user_id, credit_type, destination) DO NOTHING;
    `);

    // Seed initial credit plans if credit_plans table is empty
    const planCountRes = await client.query(`SELECT COUNT(*) FROM credit_plans`);
    if (parseInt(planCountRes.rows[0].count, 10) === 0) {
      const adminUserRow = await client.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
      if (adminUserRow.rows.length > 0) {
        const creatorId = adminUserRow.rows[0].id;
        const seedPlans = [
          // DIRECT CLIENT PLANS (target_role = 'user')
          { target: 'user', name: 'GSM SMS Starter Pack', desc: 'Instant domestic GSM bulk SMS delivery for transactional and promo campaigns', type: 'gsm_sms', dest: 'domestic', qty: 10000, rate: 0.1500, badge: 'Starter' },
          { target: 'user', name: 'GSM SMS Growth Pack', desc: 'High-volume domestic GSM SMS with priority routing and verified DLR report', type: 'gsm_sms', dest: 'domestic', qty: 50000, rate: 0.1350, badge: 'Popular' },
          { target: 'user', name: 'GSM SMS Pro Volume Pack', desc: 'Carrier-grade GSM bulk SMS broadcast capacity for business scale', type: 'gsm_sms', dest: 'domestic', qty: 100000, rate: 0.1200, badge: 'Best Value' },
          { target: 'user', name: 'WhatsApp Normal Text Pack', desc: 'Standard WhatsApp bulk broadcast messaging without buttons', type: 'normal', dest: 'domestic', qty: 25000, rate: 0.1600, badge: 'Popular' },
          { target: 'user', name: 'WhatsApp CTA Interactive Pack', desc: 'WhatsApp campaigns with interactive Click-to-Action button links and phone dials', type: 'cta', dest: 'domestic', qty: 25000, rate: 0.2600, badge: 'High Conversion' },
          { target: 'user', name: 'WhatsApp DP + CTA Master Pack', desc: 'High priority custom DP display image plus interactive call-to-action buttons', type: 'dp_cta', dest: 'domestic', qty: 50000, rate: 0.3600, badge: 'Enterprise' },
          
          // RESELLER WHOLESALE PARTNER PLANS (target_role = 'reseller', min 1 Lakh)
          { target: 'reseller', name: 'Reseller Wholesale GSM Tier-1', desc: 'Wholesale entry package for reseller partners with white-label portal access', type: 'gsm_sms', dest: 'domestic', qty: 100000, rate: 0.1000, badge: 'Partner Starter' },
          { target: 'reseller', name: 'Reseller Wholesale GSM Tier-2', desc: 'Volume partner wholesale rates for active reseller distributors', type: 'gsm_sms', dest: 'domestic', qty: 500000, rate: 0.0900, badge: 'Volume Partner' },
          { target: 'reseller', name: 'Reseller Wholesale GSM Mega Pack', desc: 'Maximum margin distributor pricing for high-throughput telecom broadcast', type: 'gsm_sms', dest: 'domestic', qty: 1000000, rate: 0.0800, badge: 'Mega Distributor' },
          { target: 'reseller', name: 'Reseller Wholesale WhatsApp Text', desc: 'Bulk wholesale WhatsApp messaging package for white-label reseller network', type: 'normal', dest: 'domestic', qty: 100000, rate: 0.1200, badge: 'Wholesale WA' },
          { target: 'reseller', name: 'Reseller Wholesale WhatsApp CTA', desc: 'Interactive CTA WhatsApp messaging wholesale pool for client allotment', type: 'cta', dest: 'domestic', qty: 100000, rate: 0.2000, badge: 'Partner CTA' },
          { target: 'reseller', name: 'Reseller Wholesale WhatsApp DP+CTA', desc: 'Premium DP + CTA wholesale package with dedicated operator dispatch queue', type: 'dp_cta', dest: 'domestic', qty: 100000, rate: 0.2800, badge: 'Partner Premium' }
        ];

        for (const p of seedPlans) {
          const totalAmt = Math.round(p.qty * p.rate * 100) / 100;
          await client.query(`
            INSERT INTO credit_plans (created_by, target_role, plan_name, description, credit_type, destination, credits, rate_per_credit, total_amount, badge_text, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
          `, [creatorId, p.target, p.name, p.desc, p.type, p.dest, p.qty, p.rate, totalAmt, p.badge]);
        }
        console.log(`[PLANS] Seeded initial credit plans for Direct Users & Reseller Wholesale Partners.`);
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

// Helper to initialize credits for a newly created user (zero for users/resellers, 10M for admin)
async function initializeUserCredits(client, userId, customRates = null) {
  const roleRes = await client.query('SELECT role FROM users WHERE id = $1', [userId]);
  const isAdmin = roleRes.rows.length > 0 && roleRes.rows[0].role === 'admin';
  const defaultBal = isAdmin ? 10000000 : 0;
  const DEFAULT_CHANNEL_RATES = {
    normal_domestic: 0.1500,
    dp_domestic: 0.2800,
    cta_domestic: 0.2400,
    dp_cta_domestic: 0.3500,
    gsm_sms_domestic: 0.1200,
    own_number_domestic: 0.0800,
    normal_international: 2.0000,
    dp_international: 2.5000,
    cta_international: 2.5000,
    dp_cta_international: 3.0000,
    gsm_sms_international: 1.5000,
    own_number_international: 1.2000
  };
  for (const dest of DESTINATIONS) {
    for (const type of CREDIT_TYPES) {
      const key = `${type}_${dest}`;
      let rate = DEFAULT_CHANNEL_RATES[key] || 0.1500;
      if (customRates && customRates[key] !== undefined && customRates[key] !== null) {
        const parsed = parseFloat(customRates[key]);
        if (!isNaN(parsed) && parsed > 0) {
          rate = parsed;
        }
      }
      await client.query(`
        INSERT INTO user_credits (user_id, credit_type, destination, balance, rate_inr)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, credit_type, destination) 
        DO UPDATE SET rate_inr = COALESCE(EXCLUDED.rate_inr, user_credits.rate_inr)
      `, [userId, type, dest, defaultBal, rate]);
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
