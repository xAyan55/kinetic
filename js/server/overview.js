/**
 * Overview Tab Controller
 * Displays real telemetry cards and instance metadata without full DOM re-renders.
 */
const OverviewTabController = {
  serverId: null,

  mount(serverId, serverData) {
    this.serverId = serverId;
    if (serverData) {
      this.renderMetadata(serverData);
    }
  },

  renderMetadata(s) {
    const nodeEl = document.getElementById('overview-node-name');
    const portEl = document.getElementById('overview-port-val');
    const pidEl = document.getElementById('overview-pid-val');
    const swEl = document.getElementById('overview-software-val');
    const javaEl = document.getElementById('overview-java-val');

    if (nodeEl) nodeEl.textContent = s.node_name || 'Primary VPS';
    if (portEl) portEl.textContent = `:${s.port}`;
    if (pidEl) pidEl.textContent = s.pid ? `#${s.pid}` : 'Offline';
    if (swEl) swEl.textContent = `${s.software_name || s.software} ${s.version}`;
    if (javaEl) javaEl.textContent = `Java ${s.java_version || 21}`;

    if (s.metrics) {
      this.updateMetrics({
        memoryMb: s.metrics.memory_used_mb,
        ramMaxMb: s.ram_mb,
        cpuPercent: s.metrics.cpu_percent,
        diskMb: s.metrics.disk_used_mb,
        diskLimitMb: s.storage_limit_mb
      });
    }
  },

  updateMetrics(m) {
    const ramText = document.getElementById('stat-ram-used');
    const ramBar = document.getElementById('stat-ram-bar');
    const cpuText = document.getElementById('stat-cpu-used');
    const cpuBar = document.getElementById('stat-cpu-bar');
    const diskText = document.getElementById('stat-disk-used');
    const diskBar = document.getElementById('stat-disk-bar');

    if (ramText && m.ramMaxMb) {
      const used = m.memoryMb || 0;
      ramText.textContent = `${used} MB / ${m.ramMaxMb} MB`;
      if (ramBar) {
        const pct = Math.min(100, Math.round((used / m.ramMaxMb) * 100));
        ramBar.style.width = `${pct}%`;
        ramBar.className = `tw-h-full tw-transition-all tw-duration-300 ${pct > 85 ? 'tw-bg-red-400' : (pct > 65 ? 'tw-bg-yellow-400' : 'tw-bg-white')}`;
      }
    }

    if (cpuText && m.cpuPercent !== undefined) {
      cpuText.textContent = `${m.cpuPercent}%`;
      if (cpuBar) {
        const pct = Math.min(100, m.cpuPercent);
        cpuBar.style.width = `${pct}%`;
        cpuBar.className = `tw-h-full tw-transition-all tw-duration-300 ${pct > 85 ? 'tw-bg-red-400' : (pct > 50 ? 'tw-bg-yellow-400' : 'tw-bg-white')}`;
      }
    }

    if (diskText && m.diskLimitMb) {
      const diskUsed = m.diskMb || 0;
      diskText.textContent = `${diskUsed} MB / ${m.diskLimitMb} MB`;
      if (diskBar) {
        const pct = Math.max(1, Math.min(100, Math.round((diskUsed / m.diskLimitMb) * 100)));
        diskBar.style.width = `${pct}%`;
      }
    }
  },

  teardown() {
    this.serverId = null;
  }
};

window.OverviewTabController = OverviewTabController;
