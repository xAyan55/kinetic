require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const { db, runMigrations } = require('./server/db');
const { processManager } = require('./server/process-manager');

// Run database migrations and seed local node
runMigrations();

// Run process reconciliation on boot
processManager.reconcileOnBoot();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const dataDir = path.join(__dirname, 'data');

// Trust Cloudflare Reverse Proxy
app.set('trust proxy', 1);

// Middleware & Security Headers
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts/styles and Bootstrap icons CDN
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Persistent SQLite Session Store
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: dataDir
  }),
  secret: process.env.SESSION_SECRET || 'kinetic_host_super_secret_session_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Route Protection Middlewares
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  return res.redirect('/auth/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ success: false, error: 'Forbidden: Administrator privileges required' });
  }
  return res.status(403).redirect('/dashboard?error=unauthorized');
}

// ==========================================
// MOUNT API ROUTERS
// ==========================================
app.use('/api/auth', require('./server/routes/auth'));
app.use('/api/account', require('./server/routes/account'));
app.use('/api/servers', require('./server/routes/servers'));
app.use('/api/mcjars', require('./server/routes/mcjars'));
app.use('/api/admin', require('./server/routes/admin'));

// Public Static Assets (CSS, JS, Assets, Auth)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/auth', express.static(path.join(__dirname, 'auth')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/components', express.static(path.join(__dirname, 'components')));

// ==========================================
// PAGE ROUTES & VIEW CONTROLLERS
// ==========================================

app.get('/auth/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'auth', 'login.html'));
});

app.get('/auth/register', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'auth', 'register.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
  // Render the unified dashboard with the admin view active
  res.redirect('/dashboard#admin-overview');
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback for public static files
app.use((req, res) => {
  // Prevent path traversal or serving data/ directory
  if (req.path.includes('..') || req.path.startsWith('/data') || req.path.startsWith('/.env')) {
    return res.status(403).send('Forbidden');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  KineticHost Control Panel running on :${PORT}`);
  console.log(`  Mode: ${IS_PRODUCTION ? 'Production' : 'Development'}`);
  console.log(`====================================================`);
});
