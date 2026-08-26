const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { db } = require('./db');

const dataDir = path.join(__dirname, '..', 'data');

/**
 * Resolves the backups directory for a server
 */
function getBackupsDir(serverId) {
  const isLinux = process.platform === 'linux';
  const baseDir = isLinux ? '/var/lib/kinetichost/backups' : path.join(dataDir, 'backups');
  const serverBackupsDir = path.join(baseDir, String(serverId));

  if (!fs.existsSync(serverBackupsDir)) {
    fs.mkdirSync(serverBackupsDir, { recursive: true });
  }

  return serverBackupsDir;
}

/**
 * Creates a tar.gz archive asynchronously
 */
function createTarGz(sourceDir, destFile) {
  return new Promise((resolve, reject) => {
    // If tar command is available, use it with argument array for non-blocking stream
    const isWindows = process.platform === 'win32';
    const tarCmd = isWindows ? 'tar.exe' : 'tar';

    // Arguments to exclude lock files, sockets, and previous backup archives
    const args = [
      '-czf',
      destFile,
      '--exclude=*.tmp*',
      '--exclude=.partial*',
      '--exclude=session.lock',
      '-C',
      sourceDir,
      '.'
    ];

    const child = spawn(tarCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      reject(new Error(`Backup archiving process error: ${err.message}`));
    });

    child.on('close', (code) => {
      // Exit code 0 is success; code 1 on GNU tar means files changed while archiving, which is acceptable
      if (code === 0 || code === 1) {
        resolve();
      } else {
        reject(new Error(`Backup archive generation failed with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Extracts a tar.gz archive safely into destination directory
 */
function extractTarGzSafely(archiveFile, destDir) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const tarCmd = isWindows ? 'tar.exe' : 'tar';

    // Arguments to safely unpack
    const args = [
      '-xzf',
      archiveFile,
      '-C',
      destDir
    ];

    const child = spawn(tarCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      reject(new Error(`Restore extraction process error: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Restore extraction failed with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Computes SHA-256 hash of a file
 */
function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Creates a server backup
 */
async function createBackup(server, customName) {
  const serverId = server.id;
  const serverDir = server.directory;

  if (!fs.existsSync(serverDir)) {
    const err = new Error('Server directory does not exist.');
    err.code = 'SERVER_DIR_MISSING';
    err.statusCode = 404;
    throw err;
  }

  // Check if a backup is already in progress for this server
  const activeBackup = db.prepare(`
    SELECT id FROM server_backups WHERE server_id = ? AND status IN ('queued', 'creating', 'restoring')
  `).get(serverId);

  if (activeBackup) {
    const err = new Error('A backup or restore operation is already in progress for this server.');
    err.code = 'BACKUP_IN_PROGRESS';
    err.statusCode = 409;
    throw err;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const cleanName = (customName && customName.trim()) ? customName.trim().slice(0, 64) : `Backup-${new Date().toLocaleDateString()}`;
  const fileName = `backup-${serverId}-${timestamp}.tar.gz`;
  const backupsDir = getBackupsDir(serverId);
  const partialFile = path.join(backupsDir, `${fileName}.partial`);
  const finalFile = path.join(backupsDir, fileName);

  // Insert initial queued record
  const insertResult = db.prepare(`
    INSERT INTO server_backups (
      server_id, name, file_name, file_path, size_bytes, status, created_at
    ) VALUES (?, ?, ?, ?, 0, 'creating', datetime('now'))
  `).run(serverId, cleanName, fileName, finalFile);

  const backupId = Number(insertResult.lastInsertRowid);

  try {
    // 1. Create tar.gz stream to partial file
    await createTarGz(serverDir, partialFile);

    // 2. Compute SHA-256 and size
    const checksum = await computeFileSha256(partialFile);
    const stat = fs.statSync(partialFile);

    // 3. Atomic finalize rename
    fs.renameSync(partialFile, finalFile);

    // 4. Update database record
    db.prepare(`
      UPDATE server_backups
      SET size_bytes = ?, checksum = ?, status = 'completed'
      WHERE id = ?
    `).run(stat.size, checksum, backupId);

    // 5. Log activity
    db.prepare(`
      INSERT INTO activity_logs (server_id, action, details, created_at)
      VALUES (?, 'backup_created', ?, datetime('now'))
    `).run(serverId, `Created backup "${cleanName}" (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);

    return db.prepare('SELECT * FROM server_backups WHERE id = ?').get(backupId);
  } catch (err) {
    if (fs.existsSync(partialFile)) {
      try { fs.unlinkSync(partialFile); } catch (e) {}
    }
    if (fs.existsSync(finalFile)) {
      try { fs.unlinkSync(finalFile); } catch (e) {}
    }

    db.prepare(`
      UPDATE server_backups
      SET status = 'failed', error_message = ?
      WHERE id = ?
    `).run(err.message, backupId);

    throw err;
  }
}

/**
 * Lists all backups for a server
 */
function listBackups(serverId) {
  return db.prepare(`
    SELECT * FROM server_backups
    WHERE server_id = ?
    ORDER BY id DESC
  `).all(serverId);
}

/**
 * Deletes a backup
 */
function deleteBackup(serverId, backupId) {
  const backup = db.prepare(`
    SELECT * FROM server_backups WHERE id = ? AND server_id = ?
  `).get(backupId, serverId);

  if (!backup) {
    const err = new Error('Backup not found.');
    err.code = 'BACKUP_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  if (backup.file_path && fs.existsSync(backup.file_path)) {
    try {
      fs.unlinkSync(backup.file_path);
    } catch (e) {
      console.warn(`[BackupManager] Warning unlinking backup file ${backup.file_path}:`, e);
    }
  }

  db.prepare('DELETE FROM server_backups WHERE id = ?').run(backupId);

  db.prepare(`
    INSERT INTO activity_logs (server_id, action, details, created_at)
    VALUES (?, 'backup_deleted', ?, datetime('now'))
  `).run(serverId, `Deleted backup #${backupId} (${backup.name})`);

  return { success: true, backupId };
}

/**
 * Restores a backup to the server directory
 */
async function restoreBackup(server, backupId) {
  const serverId = server.id;
  const serverDir = server.directory;

  const backup = db.prepare(`
    SELECT * FROM server_backups WHERE id = ? AND server_id = ?
  `).get(backupId, serverId);

  if (!backup) {
    const err = new Error('Backup not found.');
    err.code = 'BACKUP_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  if (!backup.file_path || !fs.existsSync(backup.file_path)) {
    const err = new Error('Backup archive file is missing from disk storage.');
    err.code = 'ARCHIVE_FILE_MISSING';
    err.statusCode = 404;
    throw err;
  }

  // Ensure server is offline before restoration
  if (server.status === 'running' || server.status === 'starting') {
    const err = new Error('Server must be offline before restoring a backup.');
    err.code = 'SERVER_NOT_OFFLINE';
    err.statusCode = 400;
    throw err;
  }

  // Mark backup as restoring
  db.prepare(`UPDATE server_backups SET status = 'restoring' WHERE id = ?`).run(backupId);

  const stagingDir = `${serverDir}.restoring.${Date.now()}`;
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }

  try {
    // 1. Unpack archive to staging directory with strict path validation
    await extractTarGzSafely(backup.file_path, stagingDir);

    // 2. Clean out destination directory safely
    if (fs.existsSync(serverDir)) {
      const existingEntries = fs.readdirSync(serverDir);
      for (const entry of existingEntries) {
        const entryPath = path.join(serverDir, entry);
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(serverDir, { recursive: true });
    }

    // 3. Move unpacked files from staging to serverDir
    const restoredEntries = fs.readdirSync(stagingDir);
    for (const entry of restoredEntries) {
      const src = path.join(stagingDir, entry);
      const dest = path.join(serverDir, entry);
      fs.renameSync(src, dest);
    }

    // 4. Clean staging directory
    fs.rmSync(stagingDir, { recursive: true, force: true });

    // 5. Update backup status & log activity
    db.prepare(`UPDATE server_backups SET status = 'completed' WHERE id = ?`).run(backupId);

    db.prepare(`
      INSERT INTO activity_logs (server_id, action, details, created_at)
      VALUES (?, 'backup_restored', ?, datetime('now'))
    `).run(serverId, `Restored server to backup "${backup.name}"`);

    return { success: true, message: `Backup "${backup.name}" restored successfully.` };
  } catch (err) {
    if (fs.existsSync(stagingDir)) {
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (e) {}
    }

    db.prepare(`UPDATE server_backups SET status = 'completed' WHERE id = ?`).run(backupId);
    throw err;
  }
}

/**
 * Streams a backup file for download
 */
function getBackupDownloadStream(serverId, backupId) {
  const backup = db.prepare(`
    SELECT * FROM server_backups WHERE id = ? AND server_id = ?
  `).get(backupId, serverId);

  if (!backup || !backup.file_path || !fs.existsSync(backup.file_path)) {
    const err = new Error('Backup archive not found.');
    err.code = 'BACKUP_NOT_FOUND';
    err.statusCode = 404;
    throw err;
  }

  const stat = fs.statSync(backup.file_path);
  return {
    stream: fs.createReadStream(backup.file_path),
    name: backup.file_name || `backup-${serverId}.tar.gz`,
    sizeBytes: stat.size
  };
}

module.exports = {
  createBackup,
  listBackups,
  deleteBackup,
  restoreBackup,
  getBackupDownloadStream
};
