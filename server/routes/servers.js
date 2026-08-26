const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { processManager } = require('../process-manager');
const { installMCJarsServer } = require('../installer');
const { mcjars } = require('../mcjars-client');
const { allocatePort } = require('../port-allocator');
const { getProcessMetrics, getDirectorySizeMb } = require('../resource-monitor');
const fileManager = require('../file-manager');
const backupManager = require('../backup-manager');
const { scheduler } = require('../scheduler');
const playerManager = require('../player-manager');

// Power Action Rate Limiter (30 requests per minute)
const powerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many power commands. Please wait a moment before trying again.' } }
});

// Middleware: Verify Auth
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
}

// Middleware: Verify Server Ownership or Admin
function requireServerAccess(req, res, next) {
  const serverId = parseInt(req.params.id, 10);
  if (isNaN(serverId)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid server ID' } });
  }

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  if (!server) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Server not found' } });
  }

  const user = req.session.user;
  if (server.owner_id !== user.id && user.role !== 'admin') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access forbidden: You do not own this server' } });
  }

  req.server = server;
  next();
}

// ==========================================================================
// 1. Server Inventory & Dynamic Software
// ==========================================================================

// GET /api/servers — Get servers owned by user (or all servers for admin overview)
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

// GET /api/servers/software — Dynamic Supported Software Engines
router.get('/software', requireAuth, async (req, res) => {
  try {
    const types = await mcjars.getTypes();
    return res.json({ success: true, software: types });
  } catch (err) {
    console.error('[Software Endpoint Error]:', err);
    return res.status(500).json({ success: false, error: { code: 'MCJARS_ERROR', message: 'Failed to retrieve supported software engines.' } });
  }
});

// POST /api/servers — Create a new Minecraft server instance (Admin Only)
router.post('/', requireAuth, async (req, res) => {
  const user = req.session.user;

  if (user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: { code: 'ADMIN_REQUIRED', message: 'Only administrators can create and deploy servers. Please contact an administrator to have a server assigned to your account.' }
    });
  }

  const {
    name,
    softwareType = 'PAPER',
    software,
    version = '1.20.4',
    buildUuid,
    ramMb = 4096,
    eulaAccepted,
    ownerId
  } = req.body;

  const targetSoftwareType = (softwareType || software || 'PAPER').toUpperCase();

  try {
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_NAME', message: 'Server name must be at least 2 characters long.' } });
    }

    if (!eulaAccepted) {
      return res.status(400).json({ success: false, error: { code: 'EULA_REQUIRED', message: 'You must accept the Minecraft EULA to create a server.' } });
    }

    let targetOwnerId = user.id;
    if (ownerId) {
      const parsedOwner = parseInt(ownerId, 10);
      if (!isNaN(parsedOwner)) {
        const ownerCheck = db.prepare('SELECT id FROM users WHERE id = ?').get(parsedOwner);
        if (ownerCheck) targetOwnerId = ownerCheck.id;
      }
    }

    const requestedRam = Math.max(1024, Math.min(16384, parseInt(ramMb, 10) || 4096));

    const settingsDir = db.prepare("SELECT value FROM platform_settings WHERE key = 'servers_base_dir'").get();
    const baseDir = settingsDir ? settingsDir.value : path.join(__dirname, '..', '..', 'data', 'servers');

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const port = await allocatePort(1);
    const cleanSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'minecraft-server';
    const uniqueSlug = `${cleanSlug}-${Date.now().toString(36)}`;
    const eulaTimestamp = new Date().toISOString();

    const reserveStmt = db.prepare(`
      INSERT INTO servers (
        owner_id, node_id, name, slug, software, software_type, software_name,
        version, build, directory, server_jar, port, ram_mb, cpu_limit_percent,
        storage_limit_mb, auto_start, eula_accepted, eula_accepted_at, status,
        status_message, created_at, updated_at
      ) VALUES (
        ?, 1, ?, ?, ?, ?, ?,
        ?, '#latest', '', 'server.jar', ?, ?, 200,
        25600, 0, 1, ?, 'installing',
        'Downloading and installing server files...', datetime('now'), datetime('now')
      )
    `);

    const insertResult = reserveStmt.run(
      targetOwnerId,
      name.trim(),
      uniqueSlug,
      targetSoftwareType.toLowerCase(),
      targetSoftwareType,
      targetSoftwareType,
      version,
      port,
      requestedRam,
      eulaTimestamp
    );

    const serverId = Number(insertResult.lastInsertRowid);
    const serverDir = path.join(baseDir, String(serverId));

    db.prepare(`UPDATE servers SET directory = ? WHERE id = ?`).run(serverDir, serverId);

    try {
      const installResult = await installMCJarsServer({
        serverId,
        baseDir,
        finalServerDir: serverDir,
        softwareType: targetSoftwareType,
        version,
        buildUuid,
        port,
        name: name.trim(),
        eulaAcceptedAt: eulaTimestamp
      });

      db.prepare(`
        UPDATE servers
        SET software_type = ?,
            software_name = ?,
            version = ?,
            build = ?,
            build_uuid = ?,
            artifact_url = ?,
            artifact_type = ?,
            artifact_sha256 = ?,
            java_version = ?,
            java_path = ?,
            server_jar = ?,
            status = 'offline',
            status_message = 'Ready to start',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        installResult.softwareType,
        installResult.softwareName,
        installResult.version,
        installResult.build,
        installResult.buildUuid || null,
        installResult.artifactUrl || null,
        installResult.artifactType || 'jar',
        installResult.artifactSha256 || null,
        installResult.javaVersion || 21,
        installResult.javaPath || null,
        installResult.serverJar || 'server.jar',
        serverId
      );

      db.prepare(`
        INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
        VALUES (?, ?, 'server_created', ?, datetime('now'))
      `).run(user.id, serverId, `Created ${installResult.softwareName} ${version} server "${name}" on port ${port}`);

      const createdServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
      return res.status(201).json({
        success: true,
        message: 'Minecraft server created successfully',
        server: createdServer
      });
    } catch (installErr) {
      console.error(`[Server Creation] Installation failed for Server #${serverId}:`, installErr);
      if (fs.existsSync(serverDir)) {
        try { fs.rmSync(serverDir, { recursive: true, force: true }); } catch (rmErr) {}
      }
      db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
      return res.status(500).json({
        success: false,
        error: { code: 'INSTALL_FAILED', message: `Failed to install Minecraft server files: ${installErr.message}` }
      });
    }
  } catch (err) {
    console.error('[Server Creation Error]:', err);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Failed to create server.' } });
  }
});

// ==========================================================================
// 2. Server Details, Real-Time Telemetry & Unified SSE Stream
// ==========================================================================

// GET /api/servers/:id — Get complete details of a single server
router.get('/:id', requireAuth, requireServerAccess, (req, res) => {
  const server = req.server;
  const isLive = server.pid && processManager.verifyProcessIdentity(server, server.pid);
  const procMetrics = isLive ? getProcessMetrics(server.pid) : { memoryMb: 0, cpuPercent: 0 };
  const diskMb = getDirectorySizeMb(server.directory);

  const node = db.prepare('SELECT public_address, hostname, name FROM nodes WHERE id = ?').get(server.node_id);
  const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(server.owner_id);

  return res.json({
    success: true,
    server: {
      ...server,
      is_live: !!isLive,
      owner_name: owner ? owner.name : 'Unknown User',
      owner_email: owner ? owner.email : '',
      node_name: node ? node.name : 'Node #1',
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

// GET /api/servers/:id/state — Quick state check
router.get('/:id/state', requireAuth, requireServerAccess, (req, res) => {
  const server = req.server;
  const isLive = server.pid && processManager.verifyProcessIdentity(server, server.pid);
  const procMetrics = isLive ? getProcessMetrics(server.pid) : { memoryMb: 0, cpuPercent: 0 };
  const diskMb = getDirectorySizeMb(server.directory);

  return res.json({
    success: true,
    state: {
      status: server.status,
      statusMessage: server.status_message,
      pid: isLive ? server.pid : null,
      memoryMb: procMetrics.memoryMb,
      ramMaxMb: server.ram_mb,
      cpuPercent: procMetrics.cpuPercent,
      diskMb: diskMb,
      diskLimitMb: server.storage_limit_mb
    }
  });
});

// GET /api/servers/:id/events (and alias /console/stream) — Unified SSE live event stream
router.get(['/:id/events', '/:id/console/stream'], requireAuth, requireServerAccess, (req, res) => {
  const serverId = req.server.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const session = processManager.getServerSession(serverId);
  session.sseClients.add(res);

  // Send initial state & buffered console logs
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  res.write(`data: ${JSON.stringify({ type: 'status', status: server.status, statusMessage: server.status_message, pid: server.pid })}\n\n`);

  for (const line of session.logBuffer) {
    res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
  }

  // Heartbeat ping every 15s
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

// ==========================================================================
// 3. Power Controls & Interactive Console
// ==========================================================================

// POST /api/servers/:id/start — Start server
router.post('/:id/start', requireAuth, requireServerAccess, powerLimiter, async (req, res) => {
  try {
    const result = await processManager.startServer(req.server.id);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_start', 'Server process launched', datetime('now'))
    `).run(req.session.user.id, req.server.id);

    return res.json({ success: true, message: 'Server starting...', result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'START_FAILED', message: err.message } });
  }
});

// POST /api/servers/:id/stop — Graceful stop
router.post('/:id/stop', requireAuth, requireServerAccess, powerLimiter, async (req, res) => {
  try {
    const result = await processManager.stopServer(req.server.id);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_stop', 'Server stop command issued', datetime('now'))
    `).run(req.session.user.id, req.server.id);

    return res.json({ success: true, message: 'Server stopping...', result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'STOP_FAILED', message: err.message } });
  }
});

// POST /api/servers/:id/restart — Restart server
router.post('/:id/restart', requireAuth, requireServerAccess, powerLimiter, async (req, res) => {
  try {
    const result = await processManager.restartServer(req.server.id);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_restart', 'Server process restarted', datetime('now'))
    `).run(req.session.user.id, req.server.id);
    return res.json({ success: true, message: 'Server restarting...', result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'RESTART_FAILED', message: err.message } });
  }
});

// POST /api/servers/:id/kill — Force kill server
router.post('/:id/kill', requireAuth, requireServerAccess, powerLimiter, async (req, res) => {
  try {
    const result = await processManager.killServer(req.server.id);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_kill', 'Server process terminated (SIGKILL)', datetime('now'))
    `).run(req.session.user.id, req.server.id);
    return res.json({ success: true, message: 'Server killed.', result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'KILL_FAILED', message: err.message } });
  }
});

// POST /api/servers/:id/console — Send command to Minecraft stdin
router.post('/:id/console', requireAuth, requireServerAccess, (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ success: false, error: { code: 'INVALID_COMMAND', message: 'Command string is required.' } });
  }

  try {
    const result = processManager.sendCommand(req.server.id, command);
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(400).json({ success: false, error: { code: 'COMMAND_FAILED', message: err.message } });
  }
});

// ==========================================================================
// 4. Real File Manager
// ==========================================================================

// GET /api/servers/:id/files — Directory list
router.get('/:id/files', requireAuth, requireServerAccess, (req, res) => {
  const subPath = req.query.path || '';
  try {
    const result = fileManager.listFiles(req.server.directory, subPath);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'FILE_ERROR', message: err.message } });
  }
});

// GET /api/servers/:id/files/content — Read text file
router.get('/:id/files/content', requireAuth, requireServerAccess, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ success: false, error: { code: 'PATH_REQUIRED', message: 'File path is required.' } });
  }
  try {
    const result = fileManager.getFileContent(req.server.directory, filePath);
    return res.json({ success: true, file: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'FILE_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/files/content — Save text file
router.post('/:id/files/content', requireAuth, requireServerAccess, (req, res) => {
  const { path: filePath, content = '' } = req.body;
  if (!filePath) {
    return res.status(400).json({ success: false, error: { code: 'PATH_REQUIRED', message: 'File path is required.' } });
  }
  try {
    const result = fileManager.saveFileContent(req.server.directory, filePath, content);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'file_edit', ?, datetime('now'))
    `).run(req.session.user.id, req.server.id, `Saved file "${filePath}"`);

    return res.json({ success: true, message: 'File saved successfully.', file: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'FILE_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/files/new-file — Create new file
router.post('/:id/files/new-file', requireAuth, requireServerAccess, (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    return res.status(400).json({ success: false, error: { code: 'PATH_REQUIRED', message: 'File path is required.' } });
  }
  try {
    const result = fileManager.createFile(req.server.directory, filePath);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'file_create', ?, datetime('now'))
    `).run(req.session.user.id, req.server.id, `Created file "${filePath}"`);

    return res.json({ success: true, message: 'File created successfully.', file: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'FILE_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/files/new-folder — Create directory
router.post('/:id/files/new-folder', requireAuth, requireServerAccess, (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    return res.status(400).json({ success: false, error: { code: 'PATH_REQUIRED', message: 'Directory path is required.' } });
  }
  try {
    const result = fileManager.createDirectory(req.server.directory, dirPath);
    return res.json({ success: true, message: 'Folder created successfully.', directory: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'FILE_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/files/rename — Rename file or directory
router.post('/:id/files/rename', requireAuth, requireServerAccess, (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) {
    return res.status(400).json({ success: false, error: { code: 'PARAMS_REQUIRED', message: 'oldPath and newPath are required.' } });
  }
  try {
    const result = fileManager.renamePath(req.server.directory, oldPath, newPath);
    return res.json({ success: true, message: 'Item renamed successfully.', result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'FILE_ERROR', message: err.message } });
  }
});

// DELETE /api/servers/:id/files — Delete file or directory
router.delete('/:id/files', requireAuth, requireServerAccess, (req, res) => {
  const targetPath = req.body.path || req.query.path;
  if (!targetPath) {
    return res.status(400).json({ success: false, error: { code: 'PATH_REQUIRED', message: 'Path is required.' } });
  }
  try {
    const result = fileManager.deletePath(req.server.directory, targetPath);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'file_delete', ?, datetime('now'))
    `).run(req.session.user.id, req.server.id, `Deleted "${targetPath}"`);

    return res.json({ success: true, message: 'Deleted successfully.', result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'FILE_ERROR', message: err.message } });
  }
});

// GET /api/servers/:id/files/download — Download file
router.get('/:id/files/download', requireAuth, requireServerAccess, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ success: false, error: { code: 'PATH_REQUIRED', message: 'File path is required.' } });
  }
  try {
    const { stream, name, sizeBytes } = fileManager.getDownloadStream(req.server.directory, filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', sizeBytes);
    stream.pipe(res);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'FILE_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/files/upload — Upload file safely
router.post('/:id/files/upload', requireAuth, requireServerAccess, async (req, res) => {
  const targetDir = req.query.directory || '';
  try {
    const result = await fileManager.handleFileUpload(req.server.directory, targetDir, req);
    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'file_upload', ?, datetime('now'))
    `).run(req.session.user.id, req.server.id, `Uploaded "${result.name}" (${(result.sizeBytes / 1024).toFixed(1)} KB)`);

    return res.json({ success: true, message: 'File uploaded successfully.', file: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'UPLOAD_FAILED', message: err.message } });
  }
});

// ==========================================================================
// 5. Backups Management
// ==========================================================================

// GET /api/servers/:id/backups — List backups
router.get('/:id/backups', requireAuth, requireServerAccess, (req, res) => {
  const backups = backupManager.listBackups(req.server.id);
  return res.json({ success: true, backups });
});

// POST /api/servers/:id/backups — Create backup
router.post('/:id/backups', requireAuth, requireServerAccess, async (req, res) => {
  const { name } = req.body;
  try {
    const backup = await backupManager.createBackup(req.server, name);
    return res.json({ success: true, message: 'Backup created successfully.', backup });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'BACKUP_FAILED', message: err.message } });
  }
});

// POST /api/servers/:id/backups/:backupId/restore — Restore backup
router.post('/:id/backups/:backupId/restore', requireAuth, requireServerAccess, async (req, res) => {
  const backupId = parseInt(req.params.backupId, 10);
  try {
    const result = await backupManager.restoreBackup(req.server, backupId);
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'RESTORE_FAILED', message: err.message } });
  }
});

// DELETE /api/servers/:id/backups/:backupId — Delete backup
router.delete('/:id/backups/:backupId', requireAuth, requireServerAccess, (req, res) => {
  const backupId = parseInt(req.params.backupId, 10);
  try {
    const result = backupManager.deleteBackup(req.server.id, backupId);
    return res.json({ success: true, message: 'Backup deleted successfully.', result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'DELETE_FAILED', message: err.message } });
  }
});

// GET /api/servers/:id/backups/:backupId/download — Download backup archive
router.get('/:id/backups/:backupId/download', requireAuth, requireServerAccess, (req, res) => {
  const backupId = parseInt(req.params.backupId, 10);
  try {
    const { stream, name, sizeBytes } = backupManager.getBackupDownloadStream(req.server.id, backupId);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Length', sizeBytes);
    stream.pipe(res);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'DOWNLOAD_FAILED', message: err.message } });
  }
});

// ==========================================================================
// 6. Automated Schedules
// ==========================================================================

// GET /api/servers/:id/schedules — List schedules
router.get('/:id/schedules', requireAuth, requireServerAccess, (req, res) => {
  const schedules = db.prepare(`
    SELECT * FROM server_schedules WHERE server_id = ? ORDER BY id DESC
  `).all(req.server.id);
  return res.json({ success: true, schedules });
});

// POST /api/servers/:id/schedules — Create schedule
router.post('/:id/schedules', requireAuth, requireServerAccess, (req, res) => {
  const { name, action, payload = '', cronExpression } = req.body;

  if (!name || !action || !cronExpression) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_SCHEDULE', message: 'Name, action, and cronExpression are required.' } });
  }

  const allowedActions = ['restart', 'start', 'stop', 'command', 'backup'];
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_ACTION', message: `Action must be one of: ${allowedActions.join(', ')}` } });
  }

  const nextRun = scheduler.computeNextRun(cronExpression);

  const insertResult = db.prepare(`
    INSERT INTO server_schedules (
      server_id, name, action, payload, cron_expression, is_enabled, next_run_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
  `).run(req.server.id, name.trim(), action, payload.trim(), cronExpression.trim(), nextRun);

  const created = db.prepare('SELECT * FROM server_schedules WHERE id = ?').get(insertResult.lastInsertRowid);
  return res.status(201).json({ success: true, message: 'Schedule created successfully.', schedule: created });
});

// PATCH /api/servers/:id/schedules/:scheduleId — Update schedule / toggle
router.patch('/:id/schedules/:scheduleId', requireAuth, requireServerAccess, (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId, 10);
  const schedule = db.prepare('SELECT * FROM server_schedules WHERE id = ? AND server_id = ?').get(scheduleId, req.server.id);

  if (!schedule) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Schedule not found.' } });
  }

  const { isEnabled, name, action, payload, cronExpression } = req.body;

  const newEnabled = typeof isEnabled === 'boolean' ? (isEnabled ? 1 : 0) : schedule.is_enabled;
  const newName = name ? name.trim() : schedule.name;
  const newAction = action || schedule.action;
  const newPayload = payload !== undefined ? payload.trim() : schedule.payload;
  const newCron = cronExpression ? cronExpression.trim() : schedule.cron_expression;
  const nextRun = scheduler.computeNextRun(newCron);

  db.prepare(`
    UPDATE server_schedules
    SET is_enabled = ?, name = ?, action = ?, payload = ?, cron_expression = ?, next_run_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newEnabled, newName, newAction, newPayload, newCron, nextRun, scheduleId);

  const updated = db.prepare('SELECT * FROM server_schedules WHERE id = ?').get(scheduleId);
  return res.json({ success: true, message: 'Schedule updated successfully.', schedule: updated });
});

// DELETE /api/servers/:id/schedules/:scheduleId — Delete schedule
router.delete('/:id/schedules/:scheduleId', requireAuth, requireServerAccess, (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId, 10);
  db.prepare('DELETE FROM server_schedules WHERE id = ? AND server_id = ?').run(scheduleId, req.server.id);
  return res.json({ success: true, message: 'Schedule deleted successfully.' });
});

// POST /api/servers/:id/schedules/:scheduleId/run-now — Trigger schedule immediately
router.post('/:id/schedules/:scheduleId/run-now', requireAuth, requireServerAccess, async (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId, 10);
  try {
    await scheduler.triggerNow(scheduleId, req.server.id);
    return res.json({ success: true, message: 'Schedule executed successfully.' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: { code: 'EXEC_FAILED', message: err.message } });
  }
});

// ==========================================================================
// 7. Player Management
// ==========================================================================

// GET /api/servers/:id/players — Get player state
router.get('/:id/players', requireAuth, requireServerAccess, (req, res) => {
  const state = playerManager.getPlayersState(req.server);
  return res.json({ success: true, ...state });
});

// POST /api/servers/:id/players/whitelist — Add to whitelist
router.post('/:id/players/whitelist', requireAuth, requireServerAccess, (req, res) => {
  const { name } = req.body;
  try {
    const result = playerManager.addWhitelist(req.server, name);
    return res.json({ success: true, message: `Player "${result.name}" added to whitelist.`, player: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'PLAYER_ERROR', message: err.message } });
  }
});

// DELETE /api/servers/:id/players/whitelist — Remove from whitelist
router.delete('/:id/players/whitelist', requireAuth, requireServerAccess, (req, res) => {
  const { name } = req.body;
  try {
    const result = playerManager.removeWhitelist(req.server, name);
    return res.json({ success: true, message: `Player "${result.name}" removed from whitelist.`, player: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'PLAYER_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/players/whitelist/toggle — Enable/disable whitelist
router.post('/:id/players/whitelist/toggle', requireAuth, requireServerAccess, (req, res) => {
  const { enabled } = req.body;
  try {
    const result = playerManager.setWhitelistState(req.server, !!enabled);
    return res.json({ success: true, message: `Whitelist ${result.enabled ? 'enabled' : 'disabled'}.`, whitelistEnabled: result.enabled });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'PLAYER_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/players/op — Add operator
router.post('/:id/players/op', requireAuth, requireServerAccess, (req, res) => {
  const { name } = req.body;
  try {
    const result = playerManager.addOp(req.server, name);
    return res.json({ success: true, message: `Player "${result.name}" is now an operator.`, player: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'PLAYER_ERROR', message: err.message } });
  }
});

// DELETE /api/servers/:id/players/op — Remove operator
router.delete('/:id/players/op', requireAuth, requireServerAccess, (req, res) => {
  const { name } = req.body;
  try {
    const result = playerManager.removeOp(req.server, name);
    return res.json({ success: true, message: `Player "${result.name}" is no longer an operator.`, player: result });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'PLAYER_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/players/kick — Kick player
router.post('/:id/players/kick', requireAuth, requireServerAccess, (req, res) => {
  const { name, reason } = req.body;
  try {
    const result = playerManager.kickPlayer(req.server, name, reason);
    return res.json({ success: true, message: `Player "${result.name}" kicked.` });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'PLAYER_ERROR', message: err.message } });
  }
});

// POST /api/servers/:id/players/ban — Ban player
router.post('/:id/players/ban', requireAuth, requireServerAccess, (req, res) => {
  const { name, reason } = req.body;
  try {
    const result = playerManager.banPlayer(req.server, name, reason);
    return res.json({ success: true, message: `Player "${result.name}" banned.` });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ success: false, error: { code: err.code || 'PLAYER_ERROR', message: err.message } });
  }
});

// ==========================================================================
// 8. Startup Configuration & Settings
// ==========================================================================

// GET /api/servers/:id/startup — Get startup configuration
router.get('/:id/startup', requireAuth, requireServerAccess, (req, res) => {
  const server = req.server;
  const user = req.session.user;

  return res.json({
    success: true,
    startup: {
      softwareType: server.software_type || server.software,
      softwareName: server.software_name || server.software,
      version: server.version,
      build: server.build || '#latest',
      buildUuid: server.build_uuid,
      javaVersion: server.java_version || 21,
      javaPath: server.java_path,
      serverJar: server.server_jar || 'server.jar',
      ramMb: server.ram_mb,
      userMaxRamMb: user.max_ram_mb || 16384,
      jvmFlags: server.jvm_flags || '',
      autoStart: !!server.auto_start
    }
  });
});

// PATCH /api/servers/:id/startup — Update startup parameters
router.patch('/:id/startup', requireAuth, requireServerAccess, (req, res) => {
  const server = req.server;
  const user = req.session.user;
  const { ramMb, jvmFlags, autoStart } = req.body;

  let newRam = server.ram_mb;
  if (ramMb) {
    const parsedRam = parseInt(ramMb, 10);
    const maxAllowed = user.role === 'admin' ? 32768 : (user.max_ram_mb || 16384);
    if (parsedRam >= 1024 && parsedRam <= maxAllowed) {
      newRam = parsedRam;
    } else {
      return res.status(400).json({ success: false, error: { code: 'QUOTA_EXCEEDED', message: `Requested RAM must be between 1024 MB and ${maxAllowed} MB.` } });
    }
  }

  let newFlags = server.jvm_flags || '';
  if (jvmFlags !== undefined) {
    newFlags = String(jvmFlags).slice(0, 500);
  }

  const newAutoStart = typeof autoStart === 'boolean' ? (autoStart ? 1 : 0) : server.auto_start;

  db.prepare(`
    UPDATE servers
    SET ram_mb = ?, jvm_flags = ?, auto_start = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newRam, newFlags, newAutoStart, server.id);

  db.prepare(`
    INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
    VALUES (?, ?, 'startup_update', ?, datetime('now'))
  `).run(user.id, server.id, `Updated startup configuration (RAM: ${newRam}M, AutoStart: ${newAutoStart})`);

  return res.json({
    success: true,
    message: 'Startup configuration updated successfully. Restart server for changes to apply.',
    startup: {
      ramMb: newRam,
      jvmFlags: newFlags,
      autoStart: !!newAutoStart
    }
  });
});

// PATCH /api/servers/:id/settings — Update server settings
router.patch('/:id/settings', requireAuth, requireServerAccess, (req, res) => {
  const server = req.server;
  const { name, description } = req.body;

  let newName = server.name;
  if (name && name.trim().length >= 2) {
    newName = name.trim().slice(0, 48);
  }

  let newDesc = server.description || '';
  if (description !== undefined) {
    newDesc = String(description).trim().slice(0, 200);
  }

  db.prepare(`
    UPDATE servers
    SET name = ?, description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newName, newDesc, server.id);

  return res.json({
    success: true,
    message: 'Server settings updated successfully.',
    server: {
      ...server,
      name: newName,
      description: newDesc
    }
  });
});

// POST /api/servers/:id/reinstall — Reinstall server software
router.post('/:id/reinstall', requireAuth, requireServerAccess, async (req, res) => {
  const server = req.server;
  const { confirmName, preserveConfig = true, softwareType, version, buildUuid } = req.body;

  if (confirmName !== server.name) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_CONFIRMATION', message: 'Confirmation server name does not match.' } });
  }

  if (server.status === 'running' || server.status === 'starting') {
    return res.status(400).json({ success: false, error: { code: 'SERVER_NOT_OFFLINE', message: 'Server must be offline before reinstalling.' } });
  }

  const targetSoftware = (softwareType || server.software_type || 'PAPER').toUpperCase();
  const targetVersion = version || server.version;

  const settingsDir = db.prepare("SELECT value FROM platform_settings WHERE key = 'servers_base_dir'").get();
  const baseDir = settingsDir ? settingsDir.value : path.join(__dirname, '..', '..', 'data', 'servers');

  try {
    // If not preserving config, clean directory
    if (!preserveConfig && fs.existsSync(server.directory)) {
      fs.rmSync(server.directory, { recursive: true, force: true });
    }

    const installResult = await installMCJarsServer({
      serverId: server.id,
      baseDir,
      finalServerDir: server.directory,
      softwareType: targetSoftware,
      version: targetVersion,
      buildUuid: buildUuid || undefined,
      port: server.port,
      name: server.name,
      eulaAcceptedAt: new Date().toISOString()
    });

    db.prepare(`
      UPDATE servers
      SET software_type = ?,
          software_name = ?,
          version = ?,
          build = ?,
          build_uuid = ?,
          artifact_url = ?,
          artifact_sha256 = ?,
          java_version = ?,
          java_path = ?,
          server_jar = ?,
          status = 'offline',
          status_message = 'Reinstallation completed',
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      installResult.softwareType,
      installResult.softwareName,
      installResult.version,
      installResult.build,
      installResult.buildUuid || null,
      installResult.artifactUrl || null,
      installResult.artifactSha256 || null,
      installResult.javaVersion || 21,
      installResult.javaPath || null,
      installResult.serverJar || 'server.jar',
      server.id
    );

    db.prepare(`
      INSERT INTO activity_logs (user_id, server_id, action, details, created_at)
      VALUES (?, ?, 'server_reinstall', ?, datetime('now'))
    `).run(req.session.user.id, server.id, `Reinstalled server software to ${installResult.softwareName} ${targetVersion} (Build ${installResult.build})`);

    return res.json({ success: true, message: `Server reinstalled to ${installResult.softwareName} ${targetVersion} successfully.` });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'REINSTALL_FAILED', message: `Reinstallation failed: ${err.message}` } });
  }
});

// GET /api/servers/:id/activity — Server Audit Activity Trail
router.get('/:id/activity', requireAuth, requireServerAccess, (req, res) => {
  const logs = db.prepare(`
    SELECT a.*, u.name AS actor_name, u.email AS actor_email
    FROM activity_logs a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.server_id = ?
    ORDER BY a.id DESC
    LIMIT 60
  `).all(req.server.id);

  return res.json({ success: true, activity: logs });
});

// DELETE /api/servers/:id — Safe Deletion
router.delete('/:id', requireAuth, requireServerAccess, async (req, res) => {
  const server = req.server;
  const { confirmName } = req.body;

  if (confirmName && confirmName !== server.name) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_CONFIRMATION', message: 'Confirmation server name does not match.' } });
  }

  try {
    if (server.pid || processManager.getServerSession(server.id).child) {
      await processManager.killServer(server.id);
    }

    if (server.directory && fs.existsSync(server.directory)) {
      try {
        fs.rmSync(server.directory, { recursive: true, force: true });
      } catch (rmErr) {
        console.warn(`[Server Delete] Warning deleting directory ${server.directory}:`, rmErr);
      }
    }

    db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);

    db.prepare(`
      INSERT INTO activity_logs (user_id, action, details, created_at)
      VALUES (?, 'server_deleted', ?, datetime('now'))
    `).run(req.session.user.id, `Deleted server #${server.id} (${server.name})`);

    return res.json({ success: true, message: `Server #${server.id} has been permanently deleted.` });
  } catch (err) {
    console.error(`[Server Deletion Error]:`, err);
    return res.status(500).json({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete server.' } });
  }
});

module.exports = router;
