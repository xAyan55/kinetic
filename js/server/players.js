/**
 * Players Tab Controller
 * Real Minecraft player management: Whitelist, Operators, and Bans.
 */
const PlayersTabController = {
  serverId: null,

  mount(serverId) {
    this.serverId = serverId;
    this.loadPlayers();
  },

  async loadPlayers() {
    const tbodyWhitelist = document.getElementById('players-whitelist-table');
    const tbodyOps = document.getElementById('players-ops-table');
    const tbodyBans = document.getElementById('players-bans-table');
    const whitelistToggle = document.getElementById('btn-toggle-whitelist');

    try {
      const data = await ServerAPI.listPlayers(this.serverId);
      if (!data.success) return;

      // 1. Whitelist toggle state
      if (whitelistToggle) {
        whitelistToggle.textContent = data.whitelistEnabled ? 'Whitelist: ENABLED' : 'Whitelist: DISABLED';
        whitelistToggle.className = data.whitelistEnabled
          ? 'tw-px-3 tw-py-1.5 tw-rounded-lg tw-bg-emerald-500/20 tw-border tw-border-emerald-500/30 tw-text-emerald-400 tw-text-xs tw-font-mono'
          : 'tw-px-3 tw-py-1.5 tw-rounded-lg tw-bg-white/[0.05] tw-border tw-border-white/10 tw-text-neutral-400 tw-text-xs tw-font-mono';
        whitelistToggle.onclick = () => this.toggleWhitelist(!data.whitelistEnabled);
      }

      // 2. Render Whitelist
      if (tbodyWhitelist) {
        if (!data.whitelist || data.whitelist.length === 0) {
          tbodyWhitelist.innerHTML = '<tr><td colspan="2" class="tw-p-4 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">No whitelisted players.</td></tr>';
        } else {
          tbodyWhitelist.innerHTML = data.whitelist.map(p => `
            <tr>
              <td class="tw-font-mono tw-text-xs tw-text-white tw-py-2">${escapeHtml(p.name)}</td>
              <td class="tw-text-right tw-py-2">
                <button type="button" onclick="PlayersTabController.removeWhitelist('${escapeHtml(p.name)}')" class="tw-px-2 tw-py-1 tw-rounded tw-bg-red-500/10 hover:tw-bg-red-500/20 tw-text-red-400 tw-text-xs" title="Remove">
                  <i class="bi bi-trash"></i>
                </button>
              </td>
            </tr>
          `).join('');
        }
      }

      // 3. Render Ops
      if (tbodyOps) {
        if (!data.ops || data.ops.length === 0) {
          tbodyOps.innerHTML = '<tr><td colspan="2" class="tw-p-4 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">No operators assigned.</td></tr>';
        } else {
          tbodyOps.innerHTML = data.ops.map(o => `
            <tr>
              <td class="tw-font-mono tw-text-xs tw-text-white tw-py-2">${escapeHtml(o.name)}</td>
              <td class="tw-text-right tw-py-2">
                <button type="button" onclick="PlayersTabController.removeOp('${escapeHtml(o.name)}')" class="tw-px-2 tw-py-1 tw-rounded tw-bg-red-500/10 hover:tw-bg-red-500/20 tw-text-red-400 tw-text-xs" title="Revoke OP">
                  <i class="bi bi-person-dash"></i>
                </button>
              </td>
            </tr>
          `).join('');
        }
      }

      // 4. Render Bans
      if (tbodyBans) {
        if (!data.bannedPlayers || data.bannedPlayers.length === 0) {
          tbodyBans.innerHTML = '<tr><td colspan="3" class="tw-p-4 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">No banned players.</td></tr>';
        } else {
          tbodyBans.innerHTML = data.bannedPlayers.map(b => `
            <tr>
              <td class="tw-font-mono tw-text-xs tw-text-white tw-py-2">${escapeHtml(b.name)}</td>
              <td class="tw-font-mono tw-text-xs tw-text-neutral-400 tw-py-2">${escapeHtml(b.reason || 'Banned')}</td>
              <td class="tw-font-mono tw-text-[11px] tw-text-neutral-500 tw-py-2">${new Date(b.created).toLocaleDateString()}</td>
            </tr>
          `).join('');
        }
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async toggleWhitelist(enabled) {
    try {
      await ServerAPI.toggleWhitelist(this.serverId, enabled);
      showToast(`Whitelist ${enabled ? 'enabled' : 'disabled'}.`, 'success');
      this.loadPlayers();
    } catch (e) { showToast(e.message, 'error'); }
  },

  promptAddWhitelist() {
    const name = prompt('Enter Minecraft player username to whitelist:');
    if (!name || !name.trim()) return;

    ServerAPI.addWhitelist(this.serverId, name.trim())
      .then(() => {
        showToast(`Player "${name.trim()}" added to whitelist.`, 'success');
        this.loadPlayers();
      })
      .catch(e => showToast(e.message, 'error'));
  },

  removeWhitelist(name) {
    ServerAPI.removeWhitelist(this.serverId, name)
      .then(() => {
        showToast(`Removed "${name}" from whitelist.`, 'success');
        this.loadPlayers();
      })
      .catch(e => showToast(e.message, 'error'));
  },

  promptAddOp() {
    const name = prompt('Enter Minecraft player username to grant OP:');
    if (!name || !name.trim()) return;

    ServerAPI.addOp(this.serverId, name.trim())
      .then(() => {
        showToast(`Operator status granted to "${name.trim()}".`, 'success');
        this.loadPlayers();
      })
      .catch(e => showToast(e.message, 'error'));
  },

  removeOp(name) {
    ServerAPI.removeOp(this.serverId, name)
      .then(() => {
        showToast(`Revoked OP from "${name}".`, 'success');
        this.loadPlayers();
      })
      .catch(e => showToast(e.message, 'error'));
  },

  teardown() {
    this.serverId = null;
  }
};

window.PlayersTabController = PlayersTabController;
