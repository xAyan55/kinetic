const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Authentication required' });
}

// GET /api/account/profile
router.get('/profile', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const user = db.prepare(`
    SELECT id, name, email, role, avatar_url, max_servers, max_ram_mb, created_at
    FROM users WHERE id = ?
  `).get(userId);

  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  // Calculate current quota utilization
  const serverStats = db.prepare(`
    SELECT COUNT(*) AS total_servers, COALESCE(SUM(ram_mb), 0) AS used_ram_mb
    FROM servers WHERE owner_id = ?
  `).get(userId);

  return res.json({
    success: true,
    user: {
      ...user,
      avatar_url: user.avatar_url || 'assets/images/control-panel/avatar-1.png',
      servers_count: serverStats.total_servers,
      used_ram_mb: serverStats.used_ram_mb
    }
  });
});

// PATCH /api/account/profile
router.patch('/profile', requireAuth, (req, res) => {
  try {
    const userId = req.session.user.id;
    const { name, avatarUrl, currentPassword, newPassword } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let updatedName = user.name;
    if (name && name.trim().length >= 2) {
      updatedName = name.trim();
      db.prepare(`UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(updatedName, userId);
      req.session.user.name = updatedName;
    }

    let updatedAvatar = user.avatar_url || 'assets/images/control-panel/avatar-1.png';
    if (avatarUrl && typeof avatarUrl === 'string') {
      const allowedAvatars = [
        'assets/images/control-panel/avatar-1.png',
        'assets/images/control-panel/avatar-2.jpg'
      ];
      if (allowedAvatars.includes(avatarUrl)) {
        updatedAvatar = avatarUrl;
        db.prepare(`UPDATE users SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?`).run(updatedAvatar, userId);
        req.session.user.avatar_url = updatedAvatar;
      }
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: 'Current password is required to set a new password.' });
      }
      if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
        return res.status(400).json({ success: false, error: 'Incorrect current password.' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, error: 'New password must be at least 8 characters long.' });
      }

      const salt = bcrypt.genSaltSync(10);
      const newHash = bcrypt.hashSync(newPassword, salt);
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(newHash, userId);
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        name: updatedName,
        email: user.email,
        role: user.role,
        avatar_url: updatedAvatar
      }
    });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
});

module.exports = router;
