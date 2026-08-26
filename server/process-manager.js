const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { db } = require('./db');
const { resolveJavaRuntime } = require('./java-runtime');

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map(); // serverId -> { child, logBuffer, sseClients, startTime }
    this.javaPath = null;
    this.javaVersion = null;
  }

  /**
   * Detects Java runtime on the host
   */
  detectJava() {
    if (this.javaPath) return { path: this.javaPath, version: this.javaVersion };

    const candidates = ['java', '/usr/bin/java', '/usr/lib/jvm/java-21-openjdk-amd64/bin/java', '/usr/lib/jvm/java-17-openjdk-amd64/bin/java'];

    for (const bin of candidates) {
      try {
        const out = execSync(`"${bin}" -version 2>&1`, { timeout: 3000 }).toString();
        this.javaPath = bin;
        const versionMatch = out.match(/version "([^"]+)"/) || out.match(/openjdk (\d+)/i) || out.match(/(\d+\.\d+[\.\_\d]*)/);
        this.javaVersion = versionMatch ? versionMatch[1] : 'Detected';
        console.log(`[ProcessManager] Detected Java Runtime: ${this.javaPath} (${this.javaVersion})`);
        return { path: this.javaPath, version: this.javaVersion };
      } catch (err) {
        // Try next candidate
      }
    }

    console.warn('[ProcessManager] Warning: Java runtime not found in PATH or standard directories.');
    return { path: null, version: null };
  }

  /**
   * Verifies that an OS process PID belongs to a specific KineticHost server
   */
  verifyProcessIdentity(server, pid) {
    if (!pid || typeof pid !== 'number') return false;

    // 1. Check if PID is alive
    try {
      process.kill(pid, 0);
    } catch (err) {
      return false; // PID does not exist
    }

    // 2. On Linux, inspect /proc/[pid]/cmdline and /proc/[pid]/cwd
    if (os.platform() === 'linux') {
      try {
        const cmdlineFile = `/proc/${pid}/cmdline`;
        if (fs.existsSync(cmdlineFile)) {
          const cmdline = fs.readFileSync(cmdlineFile, 'utf8');
          const expectedJar = server.server_jar || 'server.jar';
          // Verify process is java and mentions expected jar
          if (!cmdline.includes('java') || !cmdline.includes(expectedJar)) {
            return false;
          }
        }

        const cwdLink = `/proc/${pid}/cwd`;
        if (fs.existsSync(cwdLink)) {
          const actualCwd = fs.readlinkSync(cwdLink);
          if (actualCwd !== path.resolve(server.directory)) {
            return false;
          }
        }
        return true;
      } catch (err) {
        // Proc entry disappeared or inaccessible
        return false;
      }
    }

    // Fallback for Windows/macOS development
    return true;
  }

  /**
   * Gets or initializes the server session object (log buffer, clients)
   */
  getServerSession(serverId) {
    if (!this.processes.has(serverId)) {
      this.processes.set(serverId, {
        child: null,
        logBuffer: [], // Circular buffer max 500 lines
        sseClients: new Set(),
        startTime: null
      });
    }
    return this.processes.get(serverId);
  }

  /**
   * Appends log line to memory buffer and broadcasts to SSE clients
   */
  appendLog(serverId, line) {
    const session = this.getServerSession(serverId);
    const cleanLine = line.replace(/\r?\n$/, '');
    if (!cleanLine) return;

    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const formatted = `[${timestamp}] ${cleanLine}`;

    session.logBuffer.push(formatted);
    if (session.logBuffer.length > 500) {
      session.logBuffer.shift();
    }

    // Broadcast to SSE clients
    const eventPayload = `data: ${JSON.stringify({ type: 'log', message: formatted })}\n\n`;
    for (const client of session.sseClients) {
      try {
        client.write(eventPayload);
      } catch (err) {
        session.sseClients.delete(client);
      }
    }
  }

  /**
   * Spawns a real Minecraft Java server process
   */
  async startServer(serverId) {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    // Dynamically resolve appropriate Java runtime for this server's software and version
    let runtimePath = server.java_path;
    if (!runtimePath || !fs.existsSync(runtimePath)) {
      const resolved = resolveJavaRuntime({
        softwareType: server.software_type || server.software,
        version: server.version,
        javaRequirement: server.java_version
      });
      runtimePath = resolved.javaPath;
    }

    if (!runtimePath) {
      throw new Error('Java runtime is not installed on this host. Please contact the administrator.');
    }

    if (!server.eula_accepted) {
      throw new Error('Minecraft EULA must be accepted before starting the server.');
    }

    const session = this.getServerSession(serverId);

    // Prevent concurrent duplicate start
    if (session.child && !session.child.killed) {
      throw new Error('Server process is already running.');
    }

    if (server.pid && this.verifyProcessIdentity(server, server.pid)) {
      throw new Error('Server process is already alive with verified PID.');
    }

    const serverDir = path.resolve(server.directory);
    const jarPath = path.join(serverDir, server.server_jar || 'server.jar');

    if (!fs.existsSync(jarPath)) {
      throw new Error(`Server JAR file not found at ${jarPath}. Reinstallation required.`);
    }

    // Transition state to starting
    db.prepare(`
      UPDATE servers
      SET status = 'starting', status_message = 'Starting Java process...', updated_at = datetime('now')
      WHERE id = ?
    `).run(serverId);

    const ramMb = server.ram_mb || 4096;
    const initialHeap = Math.min(1024, Math.round(ramMb / 2));
    const args = [
      `-Xms${initialHeap}M`,
      `-Xmx${ramMb}M`,
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:+AlwaysPreTouch',
      '-jar',
      server.server_jar || 'server.jar',
      'nogui'
    ];

    this.appendLog(serverId, `[KineticHost] Spawning process: ${runtimePath} ${args.join(' ')}`);

    const child = spawn(runtimePath, args, {
      cwd: serverDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });

    const startTime = Date.now();
    session.child = child;
    session.startTime = startTime;

    // Update DB with PID & status
    db.prepare(`
      UPDATE servers
      SET status = 'running', status_message = 'Online', pid = ?, process_start_time = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(child.pid, startTime, serverId);

    this.appendLog(serverId, `[KineticHost] Server process started with PID ${child.pid}`);

    // Stream stdout
    child.stdout.on('data', (data) => {
      const text = data.toString('utf8');
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) this.appendLog(serverId, line);
      }
    });

    // Stream stderr
    child.stderr.on('data', (data) => {
      const text = data.toString('utf8');
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) this.appendLog(serverId, `[ERROR] ${line}`);
      }
    });

    // Exit handler
    child.on('close', (code, signal) => {
      console.log(`[ProcessManager] Server #${serverId} (PID ${child.pid}) exited with code ${code}, signal ${signal}`);
      session.child = null;
      session.startTime = null;

      const isClean = code === 0 || signal === 'SIGTERM';
      const newStatus = isClean ? 'offline' : 'crashed';
      const statusMsg = isClean ? 'Offline' : `Server process terminated unexpectedly (exit code ${code})`;

      db.prepare(`
        UPDATE servers
        SET status = ?, status_message = ?, pid = NULL, process_start_time = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(newStatus, statusMsg, serverId);

      this.appendLog(serverId, `[KineticHost] Server stopped (${newStatus.toUpperCase()}).`);
      this.emit('serverStatusChanged', { serverId, status: newStatus });
    });

    child.on('error', (err) => {
      console.error(`[ProcessManager] Spawn error on server #${serverId}:`, err);
      session.child = null;
      db.prepare(`
        UPDATE servers
        SET status = 'error', status_message = ?, pid = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(err.message, serverId);
      this.appendLog(serverId, `[KineticHost] Fatal Process Error: ${err.message}`);
    });

    return {
      success: true,
      serverId,
      pid: child.pid,
      status: 'running'
    };
  }

  /**
   * Gracefully stops a Minecraft server process by sending 'stop' to stdin
   */
  async stopServer(serverId, force = false) {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const session = this.getServerSession(serverId);

    db.prepare(`
      UPDATE servers
      SET status = 'stopping', status_message = 'Stopping server...', updated_at = datetime('now')
      WHERE id = ?
    `).run(serverId);

    this.appendLog(serverId, `[KineticHost] Stopping server...`);

    if (force || !session.child) {
      if (server.pid && this.verifyProcessIdentity(server, server.pid)) {
        try {
          process.kill(server.pid, 'SIGKILL');
        } catch (e) {}
      }
      db.prepare(`
        UPDATE servers
        SET status = 'offline', status_message = 'Offline', pid = NULL, process_start_time = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(serverId);
      return { success: true, status: 'offline' };
    }

    // Graceful Minecraft shutdown command
    try {
      session.child.stdin.write('stop\n');
    } catch (err) {
      session.child.kill('SIGTERM');
    }

    // Fallback force termination timer
    setTimeout(() => {
      if (session.child && !session.child.killed) {
        this.appendLog(serverId, `[KineticHost] Graceful shutdown timed out (15s). Terminating process...`);
        try {
          session.child.kill('SIGKILL');
        } catch (e) {}
      }
    }, 15000);

    return { success: true, status: 'stopping' };
  }

  /**
   * Restarts a Minecraft server process
   */
  async restartServer(serverId) {
    await this.stopServer(serverId);

    // Poll until offline, then restart
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const current = db.prepare('SELECT status FROM servers WHERE id = ?').get(serverId);
      if (current.status === 'offline' || current.status === 'crashed' || attempts > 20) {
        clearInterval(interval);
        try {
          await this.startServer(serverId);
        } catch (err) {
          console.error(`[ProcessManager] Restart failed for server #${serverId}:`, err);
        }
      }
    }, 1000);

    return { success: true, status: 'restarting' };
  }

  /**
   * Force kills a Minecraft server process immediately
   */
  async killServer(serverId) {
    return this.stopServer(serverId, true);
  }

  /**
   * Sends a command directly to the Minecraft process stdin
   */
  sendCommand(serverId, command) {
    const session = this.getServerSession(serverId);
    if (!session.child || !session.child.stdin) {
      throw new Error('Server process is offline or stdin is unavailable.');
    }

    const cleanCommand = command.trim().replace(/[\r\n]/g, '');
    this.appendLog(serverId, `> ${cleanCommand}`);
    session.child.stdin.write(`${cleanCommand}\n`);
    return { success: true, command: cleanCommand };
  }

  /**
   * Reconciles database state with real OS processes on system startup
   */
  reconcileOnBoot() {
    console.log('[ProcessManager] Starting process reconciliation...');
    this.detectJava();

    const activeServers = db.prepare(`
      SELECT * FROM servers WHERE status IN ('starting', 'running', 'stopping', 'restarting')
    `).all();

    for (const server of activeServers) {
      const isAlive = server.pid && this.verifyProcessIdentity(server, server.pid);
      if (isAlive) {
        console.log(`[ProcessManager] Verified live PID ${server.pid} for Server #${server.id} (${server.name})`);
        db.prepare(`
          UPDATE servers SET status = 'running', status_message = 'Online (Reattached)' WHERE id = ?
        `).run(server.id);
      } else {
        console.log(`[ProcessManager] Stale PID ${server.pid} detected for Server #${server.id}. Clearing state to offline.`);
        db.prepare(`
          UPDATE servers SET status = 'offline', status_message = 'Offline', pid = NULL, process_start_time = NULL WHERE id = ?
        `).run(server.id);
      }
    }

    // Auto-start enabled servers
    const autoStartServers = db.prepare(`
      SELECT * FROM servers WHERE auto_start = 1 AND status = 'offline'
    `).all();

    for (const server of autoStartServers) {
      console.log(`[ProcessManager] Auto-starting Server #${server.id} (${server.name})...`);
      this.startServer(server.id).catch(err => {
        console.error(`[ProcessManager] Auto-start failed for Server #${server.id}:`, err);
      });
    }

    console.log('[ProcessManager] Process reconciliation completed.');
  }
}

const processManager = new ProcessManager();

module.exports = {
  processManager,
  ProcessManager
};
