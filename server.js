require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite Database with better-sqlite3
const dbPath = path.join(dataDir, 'kinetic.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize Users Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Atomic First-User-Admin Registration Transaction
const registerUserTx = db.transaction((name, email, passwordHash) => {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const role = userCount === 0 ? 'admin' : 'user';
  const stmt = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const result = stmt.run(name, email, passwordHash, role);
  return {
    id: Number(result.lastInsertRowid),
    name,
    email,
    role
  };
});

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

// Auth Rate Limiting (15 requests per 15 minutes)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, error: 'Too many authentication attempts. Please try again in 15 minutes.' }
});

// Authentication Middlewares
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

// Static Assets
app.use(express.static(__dirname));

// ==========================================
// API ROUTES
// ==========================================

// Register Endpoint
app.post('/api/auth/register', authLimiter, (req, res) => {
  try {
    // 1. Strict Security: Strip any client-submitted role
    delete req.body.role;

    const { name, email, password, confirmPassword, terms } = req.body;

    // 2. Validation
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Please enter a valid name (minimum 2 characters).' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }

    if (!terms) {
      return res.status(400).json({ success: false, error: 'You must accept the terms of service.' });
    }

    // 3. Unique Email Check (Security-conscious)
    const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email.trim());
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email address already exists.' });
    }

    // 4. Hash Password with bcryptjs
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    // 5. Execute Atomic Transaction
    const user = registerUserTx(name.trim(), email.trim().toLowerCase(), passwordHash);

    // 6. Create Session
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: req.session.user
    });
  } catch (err) {
    console.error('Registration Error:', err);
    return res.status(500).json({ success: false, error: 'An internal server error occurred during registration.' });
  }
});

// Login Endpoint
app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide both email and password.' });
    }

    // Find User
    const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim());
    if (!user) {
      // Security-conscious response to prevent enumeration
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Validate Password
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Set Session
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    return res.json({
      success: true,
      message: 'Logged in successfully',
      user: req.session.user
    });
  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ success: false, error: 'An internal server error occurred during login.' });
  }
});

// Logout Endpoint
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Failed to logout session.' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Get Current User Profile
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  return res.json({ authenticated: false, user: null });
});

// Admin-Only Users Directory Endpoint
app.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY id ASC').all();
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch user directory.' });
  }
});

// ==========================================
// PAGE ROUTES & REDIRECTS
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
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback for static html routes
app.use((req, res) => {
  const possibleFile = path.join(__dirname, req.path);
  if (fs.existsSync(possibleFile) && fs.statSync(possibleFile).isFile()) {
    return res.sendFile(possibleFile);
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`KineticHost production server running on http://localhost:${PORT}`);
});
