const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { processManager } = require('../process-manager');
const { getInstaller } = require('../installer');
const { allocatePort } = require('../port-allocator');
const { getProcessMetrics, getDirectorySizeMb } = require('../resource-monitor');

// Power Action Rate Limiter (30 requests per minute)
const powerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many power commands. Please wait a moment before trying again.' }
});

// Middleware: Verify Auth
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Authentication required' });
}

// Middleware: Verify Server Ownership or Admin
function requireServerAccess(req, res, next) {
  const serverId = parseInt(req.params.id, 10);
  if (isNaN(serverId)) {
    return res.status(400).json({ success: false, error: 'Invalid server ID' });
  }

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!server) {
    return res.status(404).json({ success: false, error: 'Server not found' });
  }

  const user = req.session.user;
  if (server.owner_id !== user.id && user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Access denied: You do not own this server' });
  }

  req.server = server;
  next();
}

// GET /api/servers — List all servers belonging to current user
router.get('/', requireAuth, (req, res) => {
  const user = req.session.user;
  let servers;

  if (req.query.all === 'true' && user.role === 'admin') {
    servers = db.prepare(`
      SELECT s.*, u.name AS owner_name, u.email AS owner_email, n.public_address AS node_public_address
      FROM servers s
      JOIN users u ON s.owner_id = u.id
      JOIN nodes n ON s.node_id = n.id
      ORDER BY s.id DESC
    `).all();
  } else {
    servers = db.prepare(`
      SELECT s.*, n.public_address AS node_public_address
      FROM servers s
      JOIN nodes n ON s.node_id = n.id
      WHERE s.owner_id = ?
      ORDER BY s.id DESC
    `).all(user.id);
  }

  // Attach live process metrics & real storage info
  const enriched = servers.map(s => {
    const isLive = s.pid && processManager.verifyProcessIdentity(s, s.pid);
    const procMetrics = isLive ? getProcessMetrics(s.pid) : { memoryMb: 0, cpuPercent: 0 };
    const diskMb = s.directory && fs.existsSync(s.directory) ? getDirectorySizeMb(s.directory) : 0;
    return {
      ...s,
      is_live: !!isLive,
      used_memory_mb: procMetrics.memoryMb,
      used_cpu_percent: procMetrics.cpuPercent,
      disk_used_mb: diskMb,
      storage_limit_mb: s.storage_limit_mb || 25600,
      public_connection: `${s.node_public_address || 'play.kinetichost.pro'}:${s.port}`
    };
  });

  return res.json({ success: true, servers: enriched });
});

// GET /api/servers/software — Dynamic Supported Software Engines & Versions
router.get('/software', requireAuth, async (req, res) => {
  try {
    const paperInstaller = getInstaller('paper');
    const vanillaInstaller = getInstaller('vanilla');

    const [paperVersions, vanillaVersions] = await Promise.all([
      paperInstaller.getSupportedVersions(),
      vanillaInstaller.getSupportedVersions()
    ]);

    return res.json({
      success: true,
      software: [
        {
          id: 'paper',
          name: 'PaperMC',
          tagline: 'High Performance & Plugins',
          description: 'Optimized Minecraft server software with Spigot/Bukkit plugin compatibility and high tick rate performance.',
          recommended: true,
          badge: 'RECOMMENDED',
          versions: paperVersions,
          defaultVersion: paperVersions[0]
        },
        {
          id: 'vanilla',
          name: 'Vanilla Mojang',
          tagline: 'Official Minecraft Server',
          description: 'Official Mojang server software for standard pure vanilla gameplay without modifications.',
          recommended: false,
          badge: 'OFFICIAL',
          versions: vanillaVersions,
          defaultVersion: vanillaVersions[0]
        }
      ]
    });
  } catch (err) {
    console.error('[Software Endpoint Error]:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve supported software engines.' });
  }
});

// POST /api/servers — Create a new Minecraft server instance (Admin Only)
router.post('/', requireAuth, async (req, res) => {
  const user = req.session.user;

  // STRICT REQUIREMENT: Normal users cannot create servers; only admins can create & assign servers
  if (user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Only administrators can create and deploy servers. Please contact an administrator to have a server assigned to your account.'
    });
  }

  const { name, software = 'paper', version = '1.20.4', ramMb = 4096, eulaAccepted, ownerId } = req.body;

  try {
    // 1. Validate basic input
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Server name must be at least 2 characters long.' });
    }

    if (!eulaAccepted) {
      return res.status(400).json({ success: false, error: 'You must accept the Minecraft EULA to create a server.' });
    }

    // 2. Determine and validate target owner
    let targetOwnerId = user.id;
    if (ownerId) {
      const parsedOwner = parseInt(ownerId, 10);
      if (!isNaN(parsedOwner)) {
        const ownerCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(parsedOwner);
        if (ownerCheck) {
          targetOwnerId = ownerCheck.id;
        }
      }
    }

    // 3. Validate software & version
    const installer = getInstaller(software);
    const supportedVersions = await installer.getSupportedVersions();
    if (!supportedVersions.includes(version)) {
      return res.status(400).json({
        success: false,
        error: `Version ${version} is not supported for ${software}. Supported: ${supportedVersions.join(', ')}`
      });
    }

    const requestedRam = Math.max(1024, Math.min(16384, parseInt(ramMb, 10) || 4096));

    // 4. Determine base directory & allocate port
    const settingsDir = db.prepare("SELECT value FROM platform_settings WHERE key = 'servers_base_dir'").get();
    const baseDir = settingsDir ? settingsDir.value : path.join(__dirname, '..', '..', 'data', 'servers');

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const port = await allocatePort(1);
    const cleanSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'minecraft-server';
    const uniqueSlug = `${cleanSlug}-${Date.now().toString(36)}`;
    const eulaTimestamp = new Date().toISOString();

    // 5. Reserve server record in SQLite
    const reserveStmt = db.prepare(`
      INSERT INTO servers (
        owner_id, node_id, name, slug, software, version, directory,
        server_jar, port, ram_mb, cpu_limit_percent, storage_limit_mb,
        auto_start, eula_accepted, eula_accepted_at, status, status_message,
        created_at, updated_at
      ) VALUES (
        ?, 1, ?, ?, ?, ?, '',
        'server.jar', ?, ?, 200, 25600,
        0, 1, ?, 'installing', 'Downloading and installing server files...',
        datetime('now'), datetime('now')
      )
    `);

    const insertResult = reserveStmt.run(
      targetOwnerId,
      name.trim(),
      uniqueSlug,
      software.toLowerCase(),
      version,
      port,
      requestedRam,
      eulaTimestamp
    );

    const serverId = Number(insertResult.lastInsertRowid);
    const serverDir = path.join(baseDir, String(serverId));

    // Update directory path in DB
    db.prepare(`UPDATE servers SET directory = ? WHERE id = ?`).run(serverDir, serverId);

    // 6. Perform Installation Workflow
    try {
      await installer.install(serverDir, version, {
        port,
        name: name.trim(),
        eulaAcceptedAt: eulaTimestamp
      });

      // Mark as ready / offline
      db.prepare(`
        UPDATE servers
        SET status = 'offline', status_message = 'Ready to start', updated_at = datetime('now')
        WHERE id = ?
      `).run(serverId);

      // Log audit activity
      db.prepare(`
        INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
        VALUES (?, ?, 'server_created', ?, datetime('now'))
      `).run(user.id, serverId, `Created ${software} ${version} server "${name}" on port ${port}`);

      const createdServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
      return res.status(201).json({
        success: true,
        message: 'Minecraft server created successfully',
        server: createdServer
      });
    } catch (installErr) {
      console.error(`[Server Creation] Installation failed for Server #${serverId}:`, installErr);
      // Clean rollback
      try {
        if (fs.existsSync(serverDir)) {
          fs.rmSync(serverDir, { recursive: true, force: true });
        }
      } catch (rmErr) {}

      db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
      return res.status(500).json({
        success: false,
        error: `Failed to install Minecraft server files: ${installErr.message}`
      });
    }
  } catch (err) {
    console.error('[Server Creation Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to create server.' });
  }
});

// GET /api/servers/:id — Get details of a single server
router.get('/:id', requireAuth, requireServerAccess, (req, res) => {
  const server = req.server;
  const isLive = server.pid && processManager.verifyProcessIdentity(server, server.pid);
  const procMetrics = isLive ? getProcessMetrics(server.pid) : { memoryMb: 0, cpuPercent: 0 };
  const diskMb = getDirectorySizeMb(server.directory);

  const node = db.prepare('SELECT public_address, hostname FROM nodes WHERE id = ?').get(server.node_id);

  return res.json({
    success: true,
    server: {
      ...server,
      is_live: !!isLive,
      metrics: {
        memory_used_mb: procMetrics.memoryMb,
        memory_limit_mb: server.ram_mb,
        cpu_percent: procMetrics.cpuPercent,
        disk_used_mb: diskMb,
        disk_limit_mb: server.storage_limit_mb
      },
      public_connection: `${node ? node.public_address : 'play.kinetichost.pro'}:${server.port}`
    }
  });
});

// POST /api/servers/:id/start — Start server
router.post('/:id/start', requireAuth, requireServerAccess, powerLimiter, async (req, res) => {
  try {
    const result = await processManager.startServer(req.server.id);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_started', 'Server process launched', datetime('now'))
    `).run(req.session.user.id, req.server.id);

    return res.json({ success: true, message: 'Server starting...', result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/servers/:id/stop — Graceful stop
router.post('/:id/stop', requireAuth, requireServerAccess, powerLimiter, async (req, res) => {
  try {
    const result = await processManager.stopServer(req.server.id);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_stopped', 'Server stop command issued', datetime('now'))
    `).run(req.session.user.id, req.server.id);

    return res.json({ success: true, message: 'Server stopping...', result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/servers/:id/restart — Restart server
router.post('/:id/restart', requireAuth, requireServerAccess, powerLimiter, async (req, res) => {
  try {
    const result = await processManager.restartServer(req.server.id);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_restarted', 'Server process restarted', datetime('now'))
    `).run(req.session.user.id, req.server.id);
    return res.json({ success: true, message: 'Server restarting...', result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/servers/:id/kill — Force kill server
router.post('/:id/kill', requireAuth, requireServerAccess, powerLimiter, async (req, res) => {
  try {
    const result = await processManager.killServer(req.server.id);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_killed', 'Server process terminated (SIGKILL)', datetime('now'))
    `).run(req.session.user.id, req.server.id);
    return res.json({ success: true, message: 'Server killed.', result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/servers/:id/console/stream — Real-time SSE live console feed
router.get('/:id/console/stream', requireAuth, requireServerAccess, (req, res) => {
  const serverId = req.server.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

  const session = processManager.getServerSession(serverId);
  session.sseClients.add(res);

  // Send initial backfill of buffered lines
  for (const line of session.logBuffer) {
    res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
  }

  // Heartbeat ping every 15s to keep connection alive
  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      clearInterval(pingInterval);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    session.sseClients.delete(res);
  });
});

// POST /api/servers/:id/console — Send command to Minecraft stdin
router.post('/:id/console', requireAuth, requireServerAccess, (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ success: false, error: 'Command string is required.' });
  }

  try {
    const result = processManager.sendCommand(req.server.id, command);
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// PATCH /api/servers/:id/settings — Update server configuration
router.patch('/:id/settings', requireAuth, requireServerAccess, (req, res) => {
  const server = req.server;
  const { name, ramMb, autoStart } = req.body;

  try {
    let newName = server.name;
    if (name && name.trim().length >= 2) {
      newName = name.trim();
    }

    let newRam = server.ram_mb;
    if (ramMb) {
      const parsedRam = parseInt(ramMb, 10);
      if (parsedRam >= 1024 && parsedRam <= 16384) {
        newRam = parsedRam;
      }
    }

    const newAutoStart = typeof autoStart === 'boolean' ? (autoStart ? 1 : 0) : server.auto_start;

    db.prepare(`
      UPDATE servers
      SET name = ?, ram_mb = ?, auto_start = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newName, newRam, newAutoStart, server.id);

    return res.json({
      success: true,
      message: 'Server settings updated successfully. Restart the server for memory adjustments to take effect.',
      server: {
        ...server,
        name: newName,
        ram_mb: newRam,
        auto_start: newAutoStart
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update server settings.' });
  }
});

// DELETE /api/servers/:id — Safe Deletion
router.delete('/:id', requireAuth, requireServerAccess, async (req, res) => {
  const server = req.server;

  try {
    // 1. Force stop process if running
    if (server.pid || processManager.getServerSession(server.id).child) {
      await processManager.killServer(server.id);
    }

    // 2. Remove files
    if (server.directory && fs.existsSync(server.directory)) {
      try {
        fs.rmSync(server.directory, { recursive: true, force: true });
      } catch (rmErr) {
        console.warn(`[Server Delete] Warning deleting directory ${server.directory}:`, rmErr);
      }
    }

    // 3. Remove DB record
    db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);

    // 4. Log audit activity
    db.prepare(`
      INSERT INTO activity_logs (user_id, action, details, created_at)
      VALUES (?, 'server_deleted', ?, datetime('now'))
    `).run(req.session.user.id, `Deleted server #${server.id} (${server.name})`);

    return res.json({ success: true, message: `Server #${server.id} has been permanently deleted.` });
  } catch (err) {
    console.error(`[Server Deletion Error]:`, err);
    return res.status(500).json({ success: false, error: 'Failed to delete server.' });
  }
});

module.exports = router;
