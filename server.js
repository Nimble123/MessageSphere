const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db');
const { initScheduler } = require('./services/scheduler');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Reverse proxy trust: Only enable if explicitly configured in environment (e.g., behind Nginx, Cloudflare)
// Default is false to prevent rate limiter bypass via forged X-Forwarded-For headers
if (process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
} else if (process.env.TRUST_PROXY && !isNaN(Number(process.env.TRUST_PROXY))) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY));
} else if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY);
} else {
  app.set('trust proxy', false);
}

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Middlewares. The browser may send an Origin header even for a same-origin POST,
// so allow the request host itself. Any external origin remains explicit opt-in.
app.use((req, res, next) => cors({
  origin(origin, callback) {
    let isSameOrigin = false;
    try {
      isSameOrigin = Boolean(origin && new URL(origin).host === req.get('host'));
    } catch (_) { /* Invalid Origin is not trusted. */ }
    if (!origin || isSameOrigin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  }
})(req, res, next));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging and cache busting
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Static files
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/credits', require('./routes/credits'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/resellers', require('./routes/resellers'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/sms', require('./routes/sms'));

// Global error handler - Never leak raw stack traces or internal errors to clients in production
app.use((err, req, res, _next) => {
  console.error('Unhandled server error:', err);
  const isProd = process.env.NODE_ENV === 'production';
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    error: isProd ? 'Internal Server Error' : (err.message || 'Internal Server Error')
  });
});

async function startServer() {
  try {
    await initDB();
    initScheduler();
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 MessageSphere High-Performance Server is running!`);
      console.log(`🌐 Local URL: http://localhost:${PORT}`);
      if (process.env.NODE_ENV !== 'production') console.log(`🔑 Development admin: admin@messagesphere.com / admin123`);
      console.log(`====================================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
