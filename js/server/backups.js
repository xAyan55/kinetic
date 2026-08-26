/**
 * Backups Tab Controller
 * Non-blocking streaming backup creation, safe restore, and download.
 */
const BackupsTabController = {
  serverId: null,

  mount(serverId) {
    this.serverId = serverId;
    this.loadBackups();
  },

  async loadBackups() {
    const tbody = document.getElementById('backups-table-body');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="tw-py-8 tw-text-center">
            <div class="tw-w-5 tw-h-5 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-2"></div>
            <span class="tw-text-xs tw-font-mono tw-text-neutral-500">Querying backup archives...</span>
          </td>
        </tr>
      `;
    }

    try {
      const data = await ServerAPI.listBackups(this.serverId);
      if (!data.success) return;

      if (!data.backups || data.backups.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="tw-py-12 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">
              No backups created yet. Click "Create Backup" to generate a snapshot.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = data.backups.map(b => {
        const sizeMb = (b.size_bytes / (1024 * 1024)).toFixed(1);
        const dateStr = new Date(b.created_at).toLocaleString();
        const isCompleted = b.status === 'completed';

        return `
          <tr>
            <td>
              <div class="tw-font-bold tw-text-white tw-text-xs">${escapeHtml(b.name)}</div>
              <div class="tw-font-mono tw-text-[10px] tw-text-neutral-500 tw-truncate tw-max-w-xs">${escapeHtml(b.file_name)}</div>
            </td>
            <td class="tw-font-mono tw-text-xs tw-text-neutral-300">${sizeMb} MB</td>
            <td>
              <span class="tw-inline-flex tw-items-center tw-px-2 tw-py-0.5 tw-rounded tw-text-[10px] tw-font-mono ${isCompleted ? 'tw-bg-emerald-500/10 tw-text-emerald-400' : 'tw-bg-yellow-500/10 tw-text-yellow-400'}">
                ${(b.status || 'completed').toUpperCase()}
              </span>
            </td>
            <td class="tw-font-mono tw-text-xs tw-text-neutral-400">${dateStr}</td>
            <td class="tw-text-right">
              <div class="tw-flex tw-items-center tw-justify-end tw-gap-1.5">
                ${isCompleted ? `
                  <button type="button" onclick="BackupsTabController.confirmRestore(${b.id}, '${escapeHtml(b.name)}')" class="tw-px-2.5 tw-py-1 tw-rounded tw-bg-white/[0.04] hover:tw-bg-white/[0.1] tw-border tw-border-white/10 tw-text-xs tw-font-mono tw-text-neutral-200 hover:tw-text-white tw-transition-colors" title="Restore Snapshot">
                    <i class="bi bi-arrow-counterclockwise tw-mr-1"></i> Restore
                  </button>
                  <a href="/api/servers/${this.serverId}/backups/${b.id}/download" target="_blank" class="tw-px-2 tw-py-1 tw-rounded tw-bg-white/[0.04] hover:tw-bg-white/[0.1] tw-border tw-border-white/10 tw-text-xs tw-font-mono tw-text-neutral-400 hover:tw-text-white tw-transition-colors" title="Download Archive">
                    <i class="bi bi-download"></i>
                  </a>
                ` : ''}
                <button type="button" onclick="BackupsTabController.deleteBackup(${b.id})" class="tw-px-2 tw-py-1 tw-rounded tw-bg-red-500/10 hover:tw-bg-red-500/20 tw-border tw-border-red-500/25 tw-text-xs tw-font-mono tw-text-red-400 tw-transition-colors" title="Delete">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5" class="tw-p-4 tw-text-center tw-text-red-400 tw-text-xs font-mono">${escapeHtml(err.message)}</td></tr>`;
      }
    }
  },

  async promptCreateBackup() {
    const name = prompt('Enter a name for this backup (e.g. Pre-Update Snapshot):', `Backup ${new Date().toLocaleDateString()}`);
    if (name === null) return;

    showToast('Creating server backup archive in background...', 'info');

    try {
      await ServerAPI.createBackup(this.serverId, name);
      showToast('Backup archive created successfully!', 'success');
      this.loadBackups();
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async confirmRestore(backupId, backupName) {
    if (!confirm(`Warning: Restoring "${backupName}" will replace all current server files. The server must be offline. Continue?`)) return;

    showToast('Restoring backup files...', 'info');

    try {
      await ServerAPI.restoreBackup(this.serverId, backupId);
      showToast(`Backup "${backupName}" restored successfully.`, 'success');
      this.loadBackups();
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async deleteBackup(backupId) {
    if (!confirm('Are you sure you want to permanently delete this backup archive?')) return;

    try {
      await ServerAPI.deleteBackup(this.serverId, backupId);
      showToast('Backup deleted.', 'success');
      this.loadBackups();
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  teardown() {
    this.serverId = null;
  }
};

window.BackupsTabController = BackupsTabController;
