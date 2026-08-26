/**
 * KineticHost Server Detail Master Controller
 * Orchestrates 9 workspace tabs, unified SSE stream, and process action locking.
 */

let activeServerId = null;
let activeServerData = null;
let currentActiveTab = 'overview';
let unifiedEventSource = null;
let sseReconnectAttempts = 0;
let sseReconnectTimer = null;
let metricsPollTimer = null;

// Tab module controller registry
const TabControllers = {
  overview: null,
  console: null,
  files: null,
  startup: null,
  players: null,
  backups: null,
  schedules: null,
  activity: null,
  settings: null
};

async function loadServerWorkspace(serverId) {
  activeServerId = parseInt(serverId, 10);
  if (isNaN(activeServerId)) {
    window.location.hash = 'dashboard';
    return;
  }

  const view = document.getElementById('view-server-detail');
  if (view) view.classList.remove('tw-hidden');

  // Clean previous subscriptions
  teardownServerWorkspace();

  try {
    const data = await ServerAPI.getServer(activeServerId);
    if (!data.success || !data.server) {
      showToast('Server instance not found', 'error');
      window.location.hash = 'dashboard';
      return;
    }

    activeServerData = data.server;
    renderServerWorkspaceHeader(activeServerData);
    initUnifiedServerStream(activeServerId);
    setupPowerControlButtons();

    // Default to active tab or overview
    const targetTab = currentActiveTab || 'overview';
    switchServerWorkspaceTab(targetTab);

    // Background light metrics poll every 5s
    metricsPollTimer = setInterval(pollServerTelemetry, 5000);
  } catch (err) {
    showToast(err.message || 'Failed to load server details', 'error');
    window.location.hash = 'dashboard';
  }
}

function teardownServerWorkspace() {
  if (unifiedEventSource) {
    unifiedEventSource.close();
    unifiedEventSource = null;
  }
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
  if (metricsPollTimer) {
    clearInterval(metricsPollTimer);
    metricsPollTimer = null;
  }

  // Teardown active tab controller
  Object.values(TabControllers).forEach(ctrl => {
    if (ctrl && typeof ctrl.teardown === 'function') {
      ctrl.teardown();
    }
  });
}

function renderServerWorkspaceHeader(s) {
  const nameEl = document.getElementById('detail-server-name');
  const swEl = document.getElementById('detail-server-software');
  const addrEl = document.getElementById('detail-server-address');
  const statusBadge = document.getElementById('detail-server-status');

  if (nameEl) nameEl.textContent = s.name;
  if (addrEl) addrEl.textContent = s.public_connection;

  const swName = s.software_name || s.software || 'Minecraft';
  const buildInfo = s.build && s.build !== '#latest' ? ` (${s.build})` : '';
  const javaInfo = s.java_version ? ` • Java ${s.java_version}` : '';
  if (swEl) swEl.textContent = `${swName} ${s.version}${buildInfo}${javaInfo}`;

  updatePowerButtonsAndStatusBadge(s.status, s.status_message);
}

function updatePowerButtonsAndStatusBadge(status, statusMessage = '') {
  const statusBadge = document.getElementById('detail-server-status');
  if (statusBadge) {
    const isOnline = status === 'running';
    const isStarting = status === 'starting';
    const isStopping = status === 'stopping';
    const isCrashed = status === 'crashed';

    let statusClass = 'offline';
    if (isOnline) statusClass = 'online';
    else if (isStarting) statusClass = 'starting';
    else if (isStopping) statusClass = 'warning';
    else if (isCrashed) statusClass = 'crashed';

    statusBadge.className = `kh-status-badge ${statusClass}`;
    statusBadge.innerHTML = `<span class="kh-status-dot"></span> <span>${(status || 'OFFLINE').toUpperCase()}</span>`;
    if (statusMessage) statusBadge.title = statusMessage;
  }

  const btnStart = document.getElementById('btn-server-start');
  const btnStop = document.getElementById('btn-server-stop');
  const btnRestart = document.getElementById('btn-server-restart');
  const btnKill = document.getElementById('btn-server-kill');

  if (btnStart) {
    btnStart.disabled = (status === 'running' || status === 'starting' || status === 'stopping');
    btnStart.className = `btn-primary tw-py-2 tw-px-4 tw-text-xs ${btnStart.disabled ? 'tw-opacity-50 tw-cursor-not-allowed' : ''}`;
  }
  if (btnStop) {
    btnStop.disabled = (status === 'offline' || status === 'stopping');
    btnStop.className = `btn-secondary tw-py-2 tw-px-4 tw-text-xs ${btnStop.disabled ? 'tw-opacity-50 tw-cursor-not-allowed' : ''}`;
  }
  if (btnRestart) {
    btnRestart.disabled = (status === 'starting' || status === 'stopping');
    btnRestart.className = `btn-secondary tw-py-2 tw-px-4 tw-text-xs ${btnRestart.disabled ? 'tw-opacity-50 tw-cursor-not-allowed' : ''}`;
  }
}

function setupPowerControlButtons() {
  const btnStart = document.getElementById('btn-server-start');
  const btnStop = document.getElementById('btn-server-stop');
  const btnRestart = document.getElementById('btn-server-restart');
  const btnKill = document.getElementById('btn-server-kill');

  if (btnStart) {
    btnStart.onclick = async () => {
      btnStart.disabled = true;
      try {
        updatePowerButtonsAndStatusBadge('starting', 'Starting...');
        await ServerAPI.startServer(activeServerId);
        showToast('Server process launching...', 'info');
      } catch (e) {
        showToast(e.message, 'error');
        pollServerTelemetry();
      }
    };
  }

  if (btnStop) {
    btnStop.onclick = async () => {
      btnStop.disabled = true;
      try {
        updatePowerButtonsAndStatusBadge('stopping', 'Stopping...');
        await ServerAPI.stopServer(activeServerId);
        showToast('Server shutdown command issued', 'info');
      } catch (e) {
        showToast(e.message, 'error');
        pollServerTelemetry();
      }
    };
  }

  if (btnRestart) {
    btnRestart.onclick = async () => {
      btnRestart.disabled = true;
      try {
        updatePowerButtonsAndStatusBadge('stopping', 'Restarting...');
        await ServerAPI.restartServer(activeServerId);
        showToast('Server restart initiated', 'info');
      } catch (e) {
        showToast(e.message, 'error');
        pollServerTelemetry();
      }
    };
  }

  if (btnKill) {
    btnKill.onclick = async () => {
      try {
        await ServerAPI.killServer(activeServerId);
        showToast('Server process forcefully terminated (SIGKILL)', 'warning');
      } catch (e) {
        showToast(e.message, 'error');
      }
    };
  }
}

function initUnifiedServerStream(serverId) {
  if (unifiedEventSource) {
    unifiedEventSource.close();
    unifiedEventSource = null;
  }

  const sseUrl = `/api/servers/${serverId}/events`;
  unifiedEventSource = new EventSource(sseUrl);

  const connIndicator = document.getElementById('console-connection-status');
  if (connIndicator) {
    connIndicator.textContent = 'Connecting...';
    connIndicator.className = 'tw-text-[11px] tw-font-mono tw-text-yellow-400';
  }

  unifiedEventSource.onopen = () => {
    sseReconnectAttempts = 0;
    if (connIndicator) {
      connIndicator.textContent = 'Connected';
      connIndicator.className = 'tw-text-[11px] tw-font-mono tw-text-emerald-400';
    }
  };

  unifiedEventSource.onmessage = (event) => {
    if (!event.data || event.data === ': ping') return;

    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        if (window.ConsoleTabController && typeof window.ConsoleTabController.handleLogLine === 'function') {
          window.ConsoleTabController.handleLogLine(data.message);
        }
      } else if (data.type === 'status') {
        if (activeServerData) {
          activeServerData.status = data.status;
          activeServerData.status_message = data.statusMessage;
        }
        updatePowerButtonsAndStatusBadge(data.status, data.statusMessage);
      }
    } catch (err) {}
  };

  unifiedEventSource.onerror = () => {
    if (connIndicator) {
      connIndicator.textContent = 'Reconnecting...';
      connIndicator.className = 'tw-text-[11px] tw-font-mono tw-text-neutral-500';
    }
  };
}

async function pollServerTelemetry() {
  if (!activeServerId) return;
  try {
    const data = await ServerAPI.getServerState(activeServerId);
    if (data.success && data.state) {
      const s = data.state;
      updatePowerButtonsAndStatusBadge(s.status, s.statusMessage);

      if (window.OverviewTabController && typeof window.OverviewTabController.updateMetrics === 'function') {
        window.OverviewTabController.updateMetrics(s);
      }
    }
  } catch (err) {}
}

function switchServerWorkspaceTab(tab) {
  currentActiveTab = tab;

  // Update navigation buttons
  document.querySelectorAll('.server-tab-btn').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Hide all tab panes
  document.querySelectorAll('.server-tab-content').forEach(c => c.classList.add('tw-hidden'));

  // Show target tab pane
  const targetPane = document.getElementById(`server-tab-${tab}`);
  if (targetPane) targetPane.classList.remove('tw-hidden');

  // Mount/load active tab controller
  if (tab === 'overview' && window.OverviewTabController) {
    window.OverviewTabController.mount(activeServerId, activeServerData);
  } else if (tab === 'console' && window.ConsoleTabController) {
    window.ConsoleTabController.mount(activeServerId);
  } else if (tab === 'files' && window.FilesTabController) {
    window.FilesTabController.mount(activeServerId);
  } else if (tab === 'startup' && window.StartupTabController) {
    window.StartupTabController.mount(activeServerId);
  } else if (tab === 'players' && window.PlayersTabController) {
    window.PlayersTabController.mount(activeServerId);
  } else if (tab === 'backups' && window.BackupsTabController) {
    window.BackupsTabController.mount(activeServerId);
  } else if (tab === 'schedules' && window.SchedulesTabController) {
    window.SchedulesTabController.mount(activeServerId);
  } else if (tab === 'activity' && window.ActivityTabController) {
    window.ActivityTabController.mount(activeServerId);
  } else if (tab === 'settings' && window.SettingsTabController) {
    window.SettingsTabController.mount(activeServerId, activeServerData);
  }
}

window.loadServerWorkspace = loadServerWorkspace;
window.switchServerWorkspaceTab = switchServerWorkspaceTab;
window.teardownServerWorkspace = teardownServerWorkspace;
