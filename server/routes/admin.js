const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { getSystemMetrics } = require('../resource-monitor');
const { processManager } = require('../process-manager');

// Middleware: Require Admin Role
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Forbidden: Administrator privileges required' });
}

router.use(requireAdmin);

// GET /api/admin/overview — Platform Summary & Real Hardware Metrics
router.get('/overview', (req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const serversCount = db.prepare('SELECT COUNT(*) AS count FROM servers').get().count;
  const runningServersCount = db.prepare("SELECT COUNT(*) AS count FROM servers WHERE status = 'running'").get().count;
  const nodesCount = db.prepare('SELECT COUNT(*) AS count FROM nodes').get().count;

  const nodeStats = getSystemMetrics();

  // Fetch recent real activity logs
  const activityLogs = db.prepare(`
    SELECT a.*, u.name AS user_name, u.email AS user_email, s.name AS server_name
    FROM activity_logs a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN servers s ON a.server_id = s.id
    ORDER BY a.id DESC
    LIMIT 15
  `).all();

  return res.json({
    success: true,
    stats: {
      total_users: usersCount,
      total_servers: serversCount,
      running_servers: runningServersCount,
      total_nodes: nodesCount
    },
    node: nodeStats,
    recent_activity: activityLogs
  });
});

// GET /api/admin/users — List all registered accounts
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.max_servers, u.max_ram_mb, u.created_at,
           COUNT(s.id) AS servers_count,
           COALESCE(SUM(s.ram_mb), 0) AS allocated_ram_mb
    FROM users u
    LEFT JOIN servers s ON u.id = s.owner_id
    GROUP BY u.id
    ORDER BY u.id ASC
  `).all();

  return res.json({ success: true, users });
});

// GET /api/admin/users/:id — Get single user details & their assigned servers
router.get('/users/:id', (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  const user = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.max_servers, u.max_ram_mb, u.created_at,
           COUNT(s.id) AS servers_count,
           COALESCE(SUM(s.ram_mb), 0) AS allocated_ram_mb
    FROM users u
    LEFT JOIN servers s ON u.id = s.owner_id
    WHERE u.id = ?
    GROUP BY u.id
  `).get(targetUserId);

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const userServers = db.prepare(`
    SELECT s.id, s.name, s.port, s.ram_mb, s.software, s.version, s.status, s.created_at, n.name AS node_name
    FROM servers s
    JOIN nodes n ON s.node_id = n.id
    WHERE s.owner_id = ?
    ORDER BY s.id DESC
  `).all(targetUserId);

  return res.json({ success: true, user: { ...user, servers: userServers } });
});

// PATCH /api/admin/users/:id — Modify user role or quotas
router.patch('/users/:id', (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  const { role, maxServers, maxRamMb } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  // Prevent demoting the final admin
  if (user.role === 'admin' && role && role !== 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ success: false, error: 'Cannot demote the last remaining administrator account.' });
    }
  }

  const newRole = (role === 'admin' || role === 'user') ? role : user.role;
  const newMaxServers = maxServers ? Math.max(1, Math.min(50, parseInt(maxServers, 10))) : user.max_servers;
  const newMaxRam = maxRamMb ? Math.max(1024, Math.min(65536, parseInt(maxRamMb, 10))) : user.max_ram_mb;

  db.prepare(`
    UPDATE users
    SET role = ?, max_servers = ?, max_ram_mb = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newRole, newMaxServers, newMaxRam, targetUserId);

  db.prepare(`
    INSERT INTO activity_logs (user_id, action, details, created_at)
    VALUES (?, 'admin_user_update', ?, datetime('now'))
  `).run(req.session.user.id, `Admin ${req.session.user.name} modified User #${targetUserId} (${user.name}): role=${newRole}, max_servers=${newMaxServers}, max_ram=${newMaxRam}MB`);

  return res.json({
    success: true,
    message: `User #${targetUserId} (${user.name}) updated successfully.`,
    user: { id: targetUserId, role: newRole, max_servers: newMaxServers, max_ram_mb: newMaxRam }
  });
});

// GET /api/admin/nodes — Node infrastructure details
router.get('/nodes', (req, res) => {
  const nodes = db.prepare('SELECT * FROM nodes ORDER BY id ASC').all();
  const systemMetrics = getSystemMetrics();

  const enrichedNodes = nodes.map(n => ({
    ...n,
    metrics: systemMetrics,
    server_count: db.prepare('SELECT COUNT(*) AS count FROM servers WHERE node_id = ?').get(n.id).count,
    running_count: db.prepare("SELECT COUNT(*) AS count FROM servers WHERE node_id = ? AND status = 'running'").get(n.id).count
  }));

  return res.json({ success: true, nodes: enrichedNodes });
});

// GET /api/admin/servers — Platform-wide server list
router.get('/servers', (req, res) => {
  const servers = db.prepare(`
    SELECT s.*, u.name AS owner_name, u.email AS owner_email, n.name AS node_name
    FROM servers s
    JOIN users u ON s.owner_id = u.id
    JOIN nodes n ON s.node_id = n.id
    ORDER BY s.id DESC
  `).all();

  return res.json({ success: true, servers });
});

// GET /api/admin/settings — Platform configuration
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM platform_settings').all();
  const settings = {};
  for (const r of rows) {
    settings[r.key] = r.value;
  }
  return res.json({ success: true, settings });
});

// Allowlist of permissible settings keys
const ALLOWED_SETTINGS_KEYS = new Set([
  'panel_name',
  'discord_invite_url',
  'billing_url',
  'documentation_url',
  'terms_url',
  'public_hostname',
  'default_ram_mb',
  'max_servers_per_user'
]);

// PATCH /api/admin/settings — Update platform settings with strict allowlist & validation
router.patch('/settings', (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid settings payload' });
  }

  const updateStmt = db.prepare(`
    INSERT INTO platform_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  let appliedCount = 0;
  const applyTx = db.transaction(() => {
    for (const [key, rawValue] of Object.entries(updates)) {
      if (!ALLOWED_SETTINGS_KEYS.has(key)) continue;

      let value = String(rawValue).trim();
      if (key === 'default_ram_mb') {
        const num = parseInt(value, 10);
        value = String(Math.max(1024, Math.min(32768, isNaN(num) ? 4096 : num)));
      } else if (key === 'max_servers_per_user') {
        const num = parseInt(value, 10);
        value = String(Math.max(1, Math.min(50, isNaN(num) ? 3 : num)));
      }

      updateStmt.run(key, value);
      appliedCount++;
    }
  });

  applyTx();

  db.prepare(`
    INSERT INTO activity_logs (user_id, action, details, created_at)
    VALUES (?, 'admin_settings_update', ?, datetime('now'))
  `).run(req.session.user.id, `Admin ${req.session.user.name} updated ${appliedCount} platform configuration keys`);

  return res.json({ success: true, message: 'Platform settings saved successfully.' });
});

module.exports = router;

