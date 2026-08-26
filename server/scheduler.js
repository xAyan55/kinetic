const { db } = require('./db');
const { processManager } = require('./process-manager');
const backupManager = require('./backup-manager');

class Scheduler {
  constructor() {
    this.intervalHandle = null;
    this.runningJobs = new Set(); // scheduleId
  }

  /**
   * Initializes the background scheduler loop
   */
  start() {
    if (this.intervalHandle) return;
    console.log('[Scheduler] Background schedule runner started.');

    // Run tick every 60 seconds
    this.intervalHandle = setInterval(() => {
      this.tick().catch(err => {
        console.error('[Scheduler] Error during schedule tick:', err);
      });
    }, 60000);

    // Initial tick after 5 seconds on startup
    setTimeout(() => {
      this.tick().catch(err => {});
    }, 5000);
  }

  /**
   * Stops the background scheduler loop
   */
  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Evaluates if a cron expression matches the current time
   */
  matchesCron(cronExpr, date = new Date()) {
    if (!cronExpr || typeof cronExpr !== 'string') return false;

    const trimmed = cronExpr.trim();

    // Support predefined intervals
    if (trimmed === 'every_1h') return date.getMinutes() === 0;
    if (trimmed === 'every_6h') return date.getMinutes() === 0 && date.getHours() % 6 === 0;
    if (trimmed === 'every_12h') return date.getMinutes() === 0 && date.getHours() % 12 === 0;
    if (trimmed === 'every_24h' || trimmed === 'daily') return date.getMinutes() === 0 && date.getHours() === 4;

    const parts = trimmed.split(/\s+/);
    if (parts.length !== 5) return false;

    const [minRule, hourRule, dayRule, monthRule, dowRule] = parts;
    const currentMin = date.getMinutes();
    const currentHour = date.getHours();
    const currentDay = date.getDate();
    const currentMonth = date.getMonth() + 1; // 1-12
    const currentDow = date.getDay(); // 0-6 (0 is Sunday)

    const checkPart = (rule, value) => {
      if (rule === '*') return true;
      if (rule.startsWith('*/')) {
        const step = parseInt(rule.slice(2), 10);
        return !isNaN(step) && step > 0 && value % step === 0;
      }
      if (rule.includes(',')) {
        return rule.split(',').map(Number).includes(value);
      }
      return parseInt(rule, 10) === value;
    };

    return checkPart(minRule, currentMin) &&
           checkPart(hourRule, currentHour) &&
           checkPart(dayRule, currentDay) &&
           checkPart(monthRule, currentMonth) &&
           checkPart(dowRule, currentDow);
  }

  /**
   * Computes human-friendly next run estimate
   */
  computeNextRun(cronExpr) {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 1);
    d.setSeconds(0);
    d.setMilliseconds(0);

    for (let i = 0; i < 60 * 24 * 7; i++) { // search up to 7 days ahead
      if (this.matchesCron(cronExpr, d)) {
        return d.toISOString();
      }
      d.setMinutes(d.getMinutes() + 1);
    }
    return new Date(Date.now() + 3600000).toISOString();
  }

  /**
   * Executes due schedules
   */
  async tick() {
    const now = new Date();
    const activeSchedules = db.prepare(`
      SELECT s.*, srv.name AS server_name, srv.status AS server_status, srv.directory AS server_directory
      FROM server_schedules s
      JOIN servers srv ON s.server_id = srv.id
      WHERE s.is_enabled = 1
    `).all();

    for (const schedule of activeSchedules) {
      if (this.runningJobs.has(schedule.id)) continue;

      if (this.matchesCron(schedule.cron_expression, now)) {
        this.runScheduleJob(schedule).catch(err => {
          console.error(`[Scheduler] Schedule #${schedule.id} execution failed:`, err);
        });
      }
    }
  }

  /**
   * Runs an individual schedule job
   */
  async runScheduleJob(schedule) {
    this.runningJobs.add(schedule.id);
    const serverId = schedule.server_id;
    const action = schedule.action;
    const nextRun = this.computeNextRun(schedule.cron_expression);

    console.log(`[Scheduler] Running schedule #${schedule.id} ("${schedule.name}") for Server #${serverId}: Action = ${action}`);

    let status = 'success';
    let errorMsg = null;

    try {
      if (action === 'restart') {
        await processManager.restartServer(serverId);
      } else if (action === 'start') {
        await processManager.startServer(serverId);
      } else if (action === 'stop') {
        await processManager.stopServer(serverId);
      } else if (action === 'command') {
        if (!schedule.payload) throw new Error('No command payload provided.');
        processManager.sendCommand(serverId, schedule.payload);
      } else if (action === 'backup') {
        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
        if (server) {
          await backupManager.createBackup(server, `Scheduled: ${schedule.name}`);
        }
      } else {
        throw new Error(`Unknown schedule action "${action}"`);
      }
    } catch (err) {
      status = 'failed';
      errorMsg = err.message;
      console.error(`[Scheduler] Action error in schedule #${schedule.id}:`, err);
    } finally {
      this.runningJobs.delete(schedule.id);

      db.prepare(`
        UPDATE server_schedules
        SET last_run_at = datetime('now'),
            last_status = ?,
            next_run_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(status, nextRun, schedule.id);

      db.prepare(`
        INSERT INTO activity_logs (server_id, action, details, created_at)
        VALUES (?, 'schedule_executed', ?, datetime('now'))
      `).run(serverId, `Executed schedule "${schedule.name}" (${action}): ${status}${errorMsg ? ` - ${errorMsg}` : ''}`);
    }
  }

  /**
   * Manually triggers a schedule immediately
   */
  async triggerNow(scheduleId, serverId) {
    const schedule = db.prepare(`
      SELECT s.*, srv.name AS server_name, srv.status AS server_status, srv.directory AS server_directory
      FROM server_schedules s
      JOIN servers srv ON s.server_id = srv.id
      WHERE s.id = ? AND s.server_id = ?
    `).get(scheduleId, serverId);

    if (!schedule) {
      const err = new Error('Schedule not found.');
      err.code = 'SCHEDULE_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    return this.runScheduleJob(schedule);
  }
}

const scheduler = new Scheduler();

module.exports = {
  scheduler,
  Scheduler
};
