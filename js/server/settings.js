/**
 * Settings Tab Controller
 * Server general settings, network allocations, and danger zone operations.
 */
const SettingsTabController = {
  serverId: null,
  serverData: null,

  mount(serverId, serverData) {
    this.serverId = serverId;
    this.serverData = serverData;
    this.populateForm();
    this.setupListeners();
  },

  populateForm() {
    if (!this.serverData) return;
    const s = this.serverData;

    const nameInput = document.getElementById('settings-server-name');
    const descInput = document.getElementById('settings-server-desc');
    const portText = document.getElementById('settings-port-display');
    const nodeText = document.getElementById('settings-node-display');

    if (nameInput) nameInput.value = s.name || '';
    if (descInput) descInput.value = s.description || '';
    if (portText) portText.textContent = `:${s.port}`;
    if (nodeText) nodeText.textContent = s.node_name || 'Primary VPS';
  },

  setupListeners() {
    const formGeneral = document.getElementById('form-server-settings');
    const btnReinstall = document.getElementById('btn-reinstall-server');
    const btnDelete = document.getElementById('btn-delete-server');

    if (formGeneral) {
      formGeneral.onsubmit = async (e) => {
        e.preventDefault();
        const btnSave = document.getElementById('btn-save-settings');
        if (btnSave) btnSave.disabled = true;

        const name = document.getElementById('settings-server-name').value.trim();
        const description = document.getElementById('settings-server-desc').value.trim();

        try {
          await ServerAPI.updateSettings(this.serverId, { name, description });
          showToast('Server settings updated successfully.', 'success');
          const headerName = document.getElementById('detail-server-name');
          if (headerName) headerName.textContent = name;
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          if (btnSave) btnSave.disabled = false;
        }
      };
    }

    if (btnReinstall) {
      btnReinstall.onclick = () => this.handleReinstall();
    }

    if (btnDelete) {
      btnDelete.onclick = () => this.handleDelete();
    }
  },

  async handleReinstall() {
    const s = this.serverData;
    if (!s) return;

    if (s.status === 'running' || s.status === 'starting') {
      showToast('Server must be offline before reinstalling software.', 'warning');
      return;
    }

    const inputName = prompt(`Type "${s.name}" to confirm software reinstallation:`);
    if (!inputName || inputName !== s.name) {
      if (inputName !== null) showToast('Confirmation server name did not match.', 'error');
      return;
    }

    const preserveChoice = confirm('Preserve existing world, plugins, and configuration files? (Click Cancel to wipe clean)');

    showToast('Reinstalling server software via MCJars...', 'info');

    try {
      await ServerAPI.reinstallServer(this.serverId, {
        confirmName: inputName,
        preserveConfig: preserveChoice,
        softwareType: s.software_type || s.software,
        version: s.version,
        buildUuid: s.build_uuid
      });
      showToast('Server reinstallation completed successfully!', 'success');
      loadServerWorkspace(this.serverId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  async handleDelete() {
    const s = this.serverData;
    if (!s) return;

    const inputName = prompt(`DANGER: Type "${s.name}" to permanently delete this server and all its files:`);
    if (!inputName || inputName !== s.name) {
      if (inputName !== null) showToast('Confirmation server name did not match. Deletion aborted.', 'error');
      return;
    }

    showToast('Deleting server...', 'info');

    try {
      await ServerAPI.deleteServer(this.serverId, inputName);
      showToast('Server permanently deleted.', 'success');
      window.location.hash = 'dashboard';
    } catch (err) {
      showToast(err.message, 'error');
    }
  },

  teardown() {
    this.serverId = null;
    this.serverData = null;
  }
};

window.SettingsTabController = SettingsTabController;
