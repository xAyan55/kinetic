const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'kinetic.db');
const db = new Database(dbPath);

// Enable WAL mode & foreign key constraints
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Creates automated timestamped backup of the SQLite database
 */
function backupDatabase() {
  if (fs.existsSync(dbPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(dataDir, `kinetic.db.backup.${timestamp}`);
    try {
      db.backup(backupFile)
        .then(() => {
          console.log(`[Database] Automated backup created: ${backupFile}`);
        })
        .catch(err => {
          console.error('[Database] Backup error:', err);
        });
    } catch (err) {
      // Synchronous copy fallback if db.backup is busy
      fs.copyFileSync(dbPath, backupFile);
      console.log(`[Database] Synchronous backup copied: ${backupFile}`);
    }
  }
}

/**
 * Migration runner
 */
function runMigrations() {
  console.log('[Database] Checking database schema and migrations...');
  backupDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const appliedVersions = new Set(appliedRows.map(r => r.version));

  const migrations = [
    {
      version: 1,
      name: 'initial_core_schema',
      up: (dbInstance) => {
        dbInstance.exec(`
          -- Users Table
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            max_servers INTEGER DEFAULT 3,
            max_ram_mb INTEGER DEFAULT 8192,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          -- Ensure columns exist if table already existed previously
          const userCols = dbInstance.prepare("PRAGMA table_info(users)").all().map(c => c.name);
          if (!userCols.includes('max_servers')) {
            dbInstance.exec("ALTER TABLE users ADD COLUMN max_servers INTEGER DEFAULT 3");
          }
          if (!userCols.includes('max_ram_mb')) {
            dbInstance.exec("ALTER TABLE users ADD COLUMN max_ram_mb INTEGER DEFAULT 8192");
          }

          -- Nodes Table (Physical VPS Nodes)
          CREATE TABLE IF NOT EXISTS nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT 'Local Node (Primary VPS)',
            hostname TEXT NOT NULL,
            node_address TEXT NOT NULL,
            public_address TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'online',
            total_ram_mb INTEGER NOT NULL,
            total_cpu_cores INTEGER NOT NULL,
            total_storage_mb INTEGER NOT NULL,
            port_range_start INTEGER NOT NULL DEFAULT 25565,
            port_range_end INTEGER NOT NULL DEFAULT 25620,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          -- Servers Table
          CREATE TABLE IF NOT EXISTS servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            software TEXT NOT NULL,
            version TEXT NOT NULL,
            directory TEXT NOT NULL,
            server_jar TEXT NOT NULL DEFAULT 'server.jar',
            port INTEGER NOT NULL,
            ram_mb INTEGER NOT NULL DEFAULT 4096,
            cpu_limit_percent INTEGER NOT NULL DEFAULT 200,
            storage_limit_mb INTEGER NOT NULL DEFAULT 25600,
            auto_start INTEGER NOT NULL DEFAULT 0,
            eula_accepted INTEGER NOT NULL DEFAULT 1,
            eula_accepted_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'creating',
            status_message TEXT,
            pid INTEGER,
            process_start_time INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CONSTRAINT unique_node_port UNIQUE (node_id, port)
          );

          -- Platform Settings Table
          CREATE TABLE IF NOT EXISTS platform_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          -- Activity Audit Logs Table
          CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers(owner_id);
          CREATE INDEX IF NOT EXISTS idx_servers_node_port ON servers(node_id, port);
          CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at);
        `);
      }
    },
    {
      version: 2,
      name: 'seed_defaults_and_local_node',
      up: (dbInstance) => {
        // Seed default platform settings if not already present
        const defaultSettings = [
          ['panel_name', 'KineticHost Control Panel'],
          ['maintenance_mode', 'false'],
          ['default_ram_mb', '4096'],
          ['default_cpu_limit', '200'],
          ['default_storage_mb', '25600'],
          ['max_ram_per_server_mb', '16384'],
          ['max_servers_per_user', '3'],
          ['public_hostname', process.env.PUBLIC_HOSTNAME || 'play.kinetichost.pro'],
          ['servers_base_dir', process.env.SERVERS_DIR || (os.platform() === 'linux' ? '/var/lib/kinetichost/servers' : path.join(dataDir, 'servers'))]
        ];

        const insertSetting = dbInstance.prepare(`
          INSERT OR IGNORE INTO platform_settings (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
        `);

        for (const [k, v] of defaultSettings) {
          insertSetting.run(k, v);
        }

        // Detect dynamic VPS specs
        const totalRamMb = Math.round(os.totalmem() / (1024 * 1024));
        const totalCpuCores = os.cpus().length;
        const totalStorageMb = 291 * 1024; // Detected 291GB storage
        const hostname = os.hostname() || 'kinetic-vps-01';
        const publicAddress = process.env.PUBLIC_HOSTNAME || 'play.kinetichost.pro';

        const existingNode = dbInstance.prepare('SELECT id FROM nodes WHERE id = 1').get();
        if (!existingNode) {
          dbInstance.prepare(`
            INSERT INTO nodes (
              id, name, hostname, node_address, public_address, status,
              total_ram_mb, total_cpu_cores, total_storage_mb,
              port_range_start, port_range_end, created_at, updated_at
            ) VALUES (
              1, 'Local Node (Primary VPS)', ?, '127.0.0.1', ?, 'online',
              ?, ?, ?, 25565, 25620, datetime('now'), datetime('now')
            )
          `).run(hostname, publicAddress, totalRamMb, totalCpuCores, totalStorageMb);
          console.log(`[Database] Seeded Local Node with ${totalCpuCores} cores and ${totalRamMb} MB RAM.`);
        }
      }
    },
    {
      version: 3,
      name: 'add_user_quota_columns',
      up: (dbInstance) => {
        const userCols = dbInstance.prepare("PRAGMA table_info(users)").all().map(c => c.name);
        if (!userCols.includes('max_servers')) {
          dbInstance.exec("ALTER TABLE users ADD COLUMN max_servers INTEGER DEFAULT 3");
        }
        if (!userCols.includes('max_ram_mb')) {
          dbInstance.exec("ALTER TABLE users ADD COLUMN max_ram_mb INTEGER DEFAULT 8192");
        }
      }
    }
  ];

  const applyTx = db.transaction(() => {
    for (const m of migrations) {
      if (!appliedVersions.has(m.version)) {
        console.log(`[Database] Applying migration ${m.version}: ${m.name}`);
        m.up(db);
        db.prepare(`
          INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (?, ?, datetime('now'))
        `).run(m.version, m.name);
      }
    }
  });

  applyTx();
  console.log('[Database] Migrations verified and up to date.');
}

module.exports = {
  db,
  runMigrations,
  backupDatabase
};
