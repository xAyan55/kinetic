const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');

// Auth Rate Limiter (15 requests per 15 minutes)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many authentication attempts. Please try again in 15 minutes.' }
});

// Atomic First-User-Admin Registration Transaction
const registerUserTx = db.transaction((name, email, passwordHash) => {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const role = userCount === 0 ? 'admin' : 'user';
  const stmt = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, max_servers, max_ram_mb, created_at, updated_at)
    VALUES (?, ?, ?, ?, 3, 8192, datetime('now'), datetime('now'))
  `);
  const result = stmt.run(name, email, passwordHash, role);

  // Log activity
  db.prepare(`
    INSERT INTO activity_logs (user_id, action, details, created_at)
    VALUES (?, 'user_registered', ?, datetime('now'))
  `).run(result.lastInsertRowid, `User ${name} registered with role ${role}`);

  return {
    id: Number(result.lastInsertRowid),
    name,
    email,
    role
  };
});

// POST /api/auth/register
router.post('/register', authLimiter, (req, res) => {
  try {
    delete req.body.role; // Strict security: strip role injection

    const { name, email, password, confirmPassword, terms } = req.body;

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

    const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email.trim());
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email address already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const user = registerUserTx(name.trim(), email.trim().toLowerCase(), passwordHash);

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

// POST /api/auth/login
router.post('/login', authLimiter, (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide both email and password.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email.trim());
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar_url: user.avatar_url || 'assets/images/control-panel/avatar-1.png'
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

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Failed to logout session.' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully' });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  return res.json({ authenticated: false, user: null });
});

module.exports = router;
