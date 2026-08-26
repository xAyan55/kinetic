/**
 * Startup Tab Controller
 * Manages Java runtime, memory limits, and JVM flags.
 */
const StartupTabController = {
  serverId: null,

  async mount(serverId) {
    this.serverId = serverId;
    await this.loadStartupData();
    this.setupListeners();
  },

  async loadStartupData() {
    try {
      const data = await ServerAPI.getStartup(this.serverId);
      if (data.success && data.startup) {
        const s = data.startup;

        document.getElementById('startup-software').textContent = s.softwareName || s.softwareType;
        document.getElementById('startup-version').textContent = s.version;
        document.getElementById('startup-build').textContent = s.build || '#latest';
        document.getElementById('startup-java-info').textContent = `Java ${s.javaVersion} (${s.javaPath || '/usr/bin/java'})`;
        document.getElementById('startup-jar-name').textContent = s.serverJar || 'server.jar';

        const ramInput = document.getElementById('startup-ram-input');
        const ramLabel = document.getElementById('startup-ram-val');
        const jvmFlagsInput = document.getElementById('startup-jvm-flags');
        const autoStartChk = document.getElementById('startup-auto-start');

        if (ramInput) {
          ramInput.max = s.userMaxRamMb || 16384;
          ramInput.value = s.ramMb || 4096;
          if (ramLabel) ramLabel.textContent = `${ramInput.value} MB`;
        }

        if (jvmFlagsInput) {
          jvmFlagsInput.value = s.jvmFlags || '';
        }

        if (autoStartChk) {
          autoStartChk.checked = !!s.autoStart;
        }
      }
    } catch (err) {
      showToast(err.message || 'Failed to load startup parameters', 'error');
    }
  },

  setupListeners() {
    const ramInput = document.getElementById('startup-ram-input');
    const ramLabel = document.getElementById('startup-ram-val');
    const form = document.getElementById('form-startup-config');

    if (ramInput && ramLabel) {
      ramInput.oninput = (e) => {
        ramLabel.textContent = `${e.target.value} MB`;
      };
    }

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btnSave = document.getElementById('btn-save-startup');
        if (btnSave) btnSave.disabled = true;

        const ramMb = parseInt(document.getElementById('startup-ram-input').value, 10);
        const jvmFlags = document.getElementById('startup-jvm-flags').value;
        const autoStart = document.getElementById('startup-auto-start').checked;

        try {
          await ServerAPI.updateStartup(this.serverId, { ramMb, jvmFlags, autoStart });
          showToast('Startup parameters updated. Restart server for memory changes to apply.', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          if (btnSave) btnSave.disabled = false;
        }
      };
    }
  },

  teardown() {
    this.serverId = null;
  }
};

window.StartupTabController = StartupTabController;
