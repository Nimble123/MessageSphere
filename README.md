# MessageSphere Enterprise Messaging & Broadcast Platform

This application is a **manual dispatch coordination portal**. It does not call an SMS, WhatsApp, or other messaging-provider API.

Campaigns are submitted to the PostgreSQL-backed queue, exported only by a Super Admin for external processing, and reconciled after the Super Admin uploads an external delivery report.

## Run

1. Copy `.env.example` to `.env` and set a unique `JWT_SECRET` and `DATABASE_URL`.
2. Run `npm install`.
3. Start with `NODE_ENV=production npm start` in production, or `npm run dev` locally.

The Node.js server is the authoritative deployment target. Do not deploy the legacy Firebase Hosting/Functions configuration as the application backend; it is not connected to this portal's PostgreSQL API.

## Production controls

- Set `NODE_ENV=production`; this disables default-admin seeding and requires `JWT_SECRET`.
- Set `CORS_ORIGIN` to the portal origin if the UI is hosted separately.
- Keep TLS termination in front of the Node server.
- Back up PostgreSQL and the private `uploads` directory. Uploads must not be served publicly.
