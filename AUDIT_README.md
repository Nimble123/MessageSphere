# MessageSphere Enterprise Platform — Audit & Architecture Documentation

## 1. Executive Summary
**MessageSphere** is a high-performance, enterprise-grade Bulk WhatsApp & Multi-Channel Campaign Management Platform. It is engineered with a strict **Virtual Offline Gateway Architecture**, atomic double-entry credit ledger, hierarchical multi-tenant access control (Super Admin, Resellers, End Clients), and comprehensive DND/compliance filtering.

---

## 2. Tech Stack & Architecture
* **Backend Runtime**: Node.js (v18+) with Express.js.
* **Database**: PostgreSQL (Relational schema with ACID compliance, foreign keys, cascade safety, and row-level locking `FOR UPDATE`).
* **Authentication**: Stateless JSON Web Tokens (JWT) with bcrypt password hashing and Bearer token headers.
* **Frontend UI/UX**: Enterprise Vanilla ES6+ Single Page Application (SPA), zero heavy framework overhead, Lucide Icons, Chart.js analytics engine.
* **Storage**: Local persistent file storage (`uploads/`) with strict MIME-type and size validation for marketing media (DP images, Videos, Documents, PDF catalog).
* **Scheduling**: Background cron dispatch engine (`setInterval` / async worker) for scheduled campaign processing and queue state transitions.

---

## 3. Security & Transaction Integrity (Audit Highlights)

### A. Atomic Credit Ledger & Double-Entry Accounting
* All credit transfers (Admin ➔ Reseller, Reseller ➔ Client, or Campaign Dispatches) are executed inside atomic PostgreSQL database transactions (`BEGIN` ... `COMMIT` / `ROLLBACK`).
* Rows are locked with `SELECT balance FROM users WHERE id = $1 FOR UPDATE` to completely eliminate race conditions, double-spending, and negative balance exploits.
* Every single credit movement is permanently logged in `credit_transactions` with immutable timestamp, transfer type, source, destination, and reference notes.

### B. Virtual Offline Gateway Model
* Operates under a compliant, carrier-grade manual dispatch & CSV reconciliation architecture.
* Real customer phone numbers are sanitized and validated against standard E.164 / India 10-digit mobile standards (`91xxxxxxxxxx`).
* Dispatches generate offline gateway packages for operator distribution. Delivery reports (DLR) are ingested and reconciled back via secure CSV upload.
* Failed or un-delivered messages trigger automatic credit refunds directly back into the user's wallet via atomic ledger updates.

### C. Hierarchy & Multi-Tenancy (RBAC)
* **Super Admin (`admin`)**: Full platform control, global DND management, master wallet issuance, system audit log monitoring, reseller hierarchy oversight, user 360° diagnostics.
* **Reseller (`reseller`)**: Dedicated credit quotas, sub-account creation, downstream credit allocation, reseller network reporting. Resellers cannot see or touch other resellers' client data.
* **End Client (`user`)**: Campaign composer, template management, sender header registration, audience phonebook & DND blacklist management, top-up requests.

### D. Compliance & DND Suppression
* Dual-tier suppression list:
  1. **Global Platform DND**: Platform-wide blacklisted numbers managed by Super Admin.
  2. **Account DND**: Per-user opt-out registry.
* During campaign dispatch, target recipient lists are automatically pre-scrubbed against active DND registries before wallet credits are deducted.

---

## 4. Database Schema Structure
The schema is automatically initialized in `db.js` on startup:
* `users`: Account profile, role (`admin`, `reseller`, `user`), parent-reseller link, domestic credits, international credits, status (`active`, `blocked`).
* `credit_transactions`: Immutable double-entry financial ledger.
* `campaigns`: Campaign metadata, route, channel (`text`, `dp_media`, `cta_buttons`, `dp_cta`, `sim`), scheduled time, delivery counters.
* `campaign_messages`: Individual recipient dispatch status (`pending`, `delivered`, `failed`), retry counters, delivery timestamps.
* `contact_groups` & `contacts`: Audience segmentation and address book.
* `blacklist`: DND phone numbers with suppression scope and justification notes.
* `templates`: Standardized marketing and transactional message templates.
* `sender_headers`: Registered sender identities and WhatsApp business profiles.
* `billing_orders`: Top-up credit orders, payment proof verification, and fulfillment logs.
* `audit_logs`: Immutable security tracking for all administrative actions.

---

## 5. Local Setup & Verification Instructions

### Prerequisites
* Node.js v18 or higher.
* PostgreSQL database running locally or accessible via network.

### Steps
1. **Extract & Navigate**:
   ```bash
   cd MessageSphereProject
   ```
2. **Install Dependencies**:
   ```bash
   npm install
   ```
3. **Configure Environment (`.env`)**:
   ```ini
   PORT=3000
   DATABASE_URL=postgresql://localhost:5432/messagesphere
   JWT_SECRET=your_secure_jwt_secret_here
   UPLOAD_DIR=uploads
   ```
4. **Start Application**:
   ```bash
   npm start
   ```
5. **Access Application**:
   Open browser at: `http://localhost:3000`

### Seed Default Credentials
* **Super Admin**: `admin@messagesphere.com` / `admin123`
* System auto-seeds required tables and schemas on first boot.
