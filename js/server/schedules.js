/**
 * Schedules Tab Controller
 * Cron-based automated task scheduling for restarts, commands, and backups.
 */
const SchedulesTabController = {
  serverId: null,

  mount(serverId) {
    this.serverId = serverId;
    this.loadSchedules();
  },

  async loadSchedules() {
    const tbody = document.getElementById('schedules-table-body');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="tw-py-8 tw-text-center">
            <div class="tw-w-5 tw-h-5 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-2"></div>
            <span class="tw-text-xs tw-font-mono tw-text-neutral-500">Loading automation schedules...</span>
          </td>
        </tr>
      `;
    }

    try {
      const data = await ServerAPI.listSchedules(this.serverId);
      if (!data.success) return;

      if (!data.schedules || data.schedules.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="tw-py-12 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">
              No automation schedules configured. Click "Create Schedule" to add automated restarts or backups.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = data.schedules.map(s => {
        const isEnabled = !!s.is_enabled;
        const nextRun = s.next_run_at ? new Date(s.next_run_at).toLocaleString() : 'Pending';
        const lastRun = s.last_run_at ? new Date(s.last_run_at).toLocaleString() : 'Never';

        return `
          <tr>
            <td>
              <div class="tw-font-bold tw-text-white tw-text-xs">${escapeHtml(s.name)}</div>
              <div class="tw-font-mono tw-text-[11px] tw-text-neutral-400">${escapeHtml(s.cron_expression)}</div>
            </td>
            <td>
              <span class="tw-inline-flex tw-items-center tw-px-2 tw-py-0.5 tw-rounded tw-text-[10px] tw-font-mono tw-bg-white/[0.06] tw-text-neutral-300">
                ${s.action.toUpperCase()}
              </span>
              ${s.payload ? `<div class="tw-font-mono tw-text-[10px] tw-text-neutral-500 tw-truncate tw-max-w-xs mt-0.5">${escapeHtml(s.payload)}</div>` : ''}
            </td>
            <td class="tw-font-mono tw-text-xs tw-text-neutral-300">${nextRun}</td>
            <td class="tw-font-mono tw-text-xs tw-text-neutral-500">${lastRun}</td>
            <td>
              <button type="button" onclick="SchedulesTabController.toggleSchedule(${s.id}, ${!isEnabled})" class="tw-px-2.5 tw-py-1 tw-rounded tw-text-xs tw-font-mono ${isEnabled ? 'tw-bg-emerald-500/20 tw-text-emerald-400' : 'tw-bg-neutral-800 tw-text-neutral-500'}">
                ${isEnabled ? 'Active' : 'Disabled'}
              </button>
            </td>
            <td class="tw-text-right">
              <div class="tw-flex tw-items-center tw-justify-end tw-gap-1.5">
                <button type="button" onclick="SchedulesTabController.runScheduleNow(${s.id})" class="tw-px-2.5 tw-py-1 tw-rounded tw-bg-white/[0.04] hover:tw-bg-white/[0.1] tw-border tw-border-white/10 tw-text-xs tw-font-mono tw-text-neutral-300 hover:tw-text-white" title="Execute Now">
                  <i class="bi bi-play-fill tw-mr-1"></i> Run
                </button>
                <button type="button" onclick="SchedulesTabController.deleteSchedule(${s.id})" class="tw-px-2 tw-py-1 tw-rounded tw-bg-red-500/10 hover:tw-bg-red-500/20 tw-border tw-border-red-500/25 tw-text-xs tw-font-mono tw-text-red-400" title="Delete">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="tw-p-4 tw-text-center tw-text-red-400 tw-text-xs">${escapeHtml(err.message)}</td></tr>`;
    }
  },

  promptCreateSchedule() {
    const name = prompt('Schedule Name (e.g. Daily Restart):');
    if (!name || !name.trim()) return;

    const action = prompt('Action (restart, backup, command, stop, start):', 'restart');
    if (!action) return;

    let payload = '';
    if (action === 'command') {
      payload = prompt('Enter command to execute (e.g. say Server restarting in 5 minutes!):', '');
    }

    const cron = prompt('Cron Expression or Interval (e.g. 0 4 * * * for 4:00 AM daily, or every_6h, every_12h, every_24h):', '0 4 * * *');
    if (!cron) return;

    ServerAPI.createSchedule(this.serverId, {
      name: name.trim(),
      action: action.trim().toLowerCase(),
      payload: payload ? payload.trim() : '',
      cronExpression: cron.trim()
    }).then(() => {
      showToast('Schedule created.', 'success');
      this.loadSchedules();
    }).catch(e => showToast(e.message, 'error'));
  },

  async toggleSchedule(scheduleId, isEnabled) {
    try {
      await ServerAPI.updateSchedule(this.serverId, scheduleId, { isEnabled });
      showToast(`Schedule ${isEnabled ? 'activated' : 'disabled'}.`, 'success');
      this.loadSchedules();
    } catch (e) { showToast(e.message, 'error'); }
  },

  async runScheduleNow(scheduleId) {
    showToast('Executing schedule...', 'info');
    try {
      await ServerAPI.runScheduleNow(this.serverId, scheduleId);
      showToast('Schedule executed.', 'success');
      this.loadSchedules();
    } catch (e) { showToast(e.message, 'error'); }
  },

  async deleteSchedule(scheduleId) {
    if (!confirm('Are you sure you want to delete this schedule?')) return;
    try {
      await ServerAPI.deleteSchedule(this.serverId, scheduleId);
      showToast('Schedule deleted.', 'success');
      this.loadSchedules();
    } catch (e) { showToast(e.message, 'error'); }
  },

  teardown() {
    this.serverId = null;
  }
};

window.SchedulesTabController = SchedulesTabController;
