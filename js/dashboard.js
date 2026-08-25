// KineticHost Real Control Panel Frontend Engine — UI/UX Overhaul Edition

let currentUser = null;
let currentServer = null;
let currentView = 'dashboard';
let currentServerTab = 'overview';
let sseSource = null;
let commandHistory = [];
let historyIndex = -1;
let statsInterval = null;

// ==========================================================================
// Toast Notification Engine
// ==========================================================================
function showToast(message, type = 'info') {
  let container = document.getElementById('kh-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'kh-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `kh-toast ${type}`;

  const iconClass = type === 'success' ? 'bi-check-circle-fill' : (type === 'error' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill');

  toast.innerHTML = `
    <div class="kh-toast-icon">
      <i class="bi ${iconClass}"></i>
    </div>
    <div class="tw-flex-1 tw-font-medium">${escapeHtml(message)}</div>
    <button class="tw-text-neutral-500 hover:tw-text-white tw-transition-colors tw-text-xs" onclick="this.parentElement.remove()">
      <i class="bi bi-x-lg"></i>
    </button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// ==========================================================================
// Dashboard Initialization & Authentication
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const authRes = await fetch('/api/auth/me');
    const authData = await authRes.json();

    if (!authData.authenticated || !authData.user) {
      window.location.href = '/auth/login';
      return;
    }

    currentUser = authData.user;
    initSidebar();
    initMobileDrawer();
    handleHashNavigation();
    window.addEventListener('hashchange', handleHashNavigation);

    // Escape key closes modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeCreateServerModal();
      }
    });

    // Global logout buttons
    document.querySelectorAll('.btn-logout').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/auth/login';
      });
    });
  } catch (err) {
    console.error('Failed to initialize dashboard:', err);
    window.location.href = '/auth/login';
  }
});

// Setup sidebar & user profile identity
function initSidebar() {
  const nameEls = document.querySelectorAll('.sidebar-user-name');
  const avatarEls = document.querySelectorAll('.sidebar-user-avatar-img');
  const roleEls = document.querySelectorAll('.sidebar-user-role');

  const avatarSrc = currentUser.avatar_url || 'assets/images/control-panel/avatar-1.png';

  nameEls.forEach(el => el.textContent = currentUser.name);
  avatarEls.forEach(el => el.src = avatarSrc);
  roleEls.forEach(el => el.textContent = currentUser.role.toUpperCase());

  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('tw-hidden'));
    document.querySelectorAll('.admin-only-btn').forEach(el => el.style.display = '');
  } else {
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.add('tw-hidden'));
    document.querySelectorAll('.admin-only-btn').forEach(el => el.style.display = 'none');
  }
}

// Setup mobile sidebar drawer
function initMobileDrawer() {
  const btnToggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('panel-sidebar');
  const backdrop = document.getElementById('drawer-backdrop');

  if (btnToggle && sidebar && backdrop) {
    const toggle = (open) => {
      if (open) {
        sidebar.classList.add('open');
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
      } else {
        sidebar.classList.remove('open');
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
      }
    };

    btnToggle.addEventListener('click', () => toggle(true));
    backdrop.addEventListener('click', () => toggle(false));

    document.querySelectorAll('.kh-sidebar-link').forEach(link => {
      link.addEventListener('click', () => toggle(false));
    });
  }
}

// ==========================================================================
// Hash Router
// ==========================================================================
function handleHashNavigation() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  const parts = hash.split('/');
  const mainRoute = parts[0];

  // Update active sidebar item
  document.querySelectorAll('.kh-sidebar-link').forEach(link => {
    if (link.dataset.route === mainRoute) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update breadcrumb
  const breadcrumb = document.getElementById('topbar-breadcrumb');
  if (breadcrumb) {
    const routeTitles = {
      'dashboard': 'Minecraft Servers',
      'server': 'Server Console',
      'admin-overview': 'Platform Overview',
      'admin-users': 'User Directory',
      'admin-nodes': 'Infrastructure Nodes',
      'admin-servers': 'All Instances',
      'admin-settings': 'Platform Settings',
      'profile': 'Account Profile'
    };
    breadcrumb.textContent = routeTitles[mainRoute] || 'Dashboard';
  }

  // Hide all views
  document.querySelectorAll('.panel-view').forEach(v => v.classList.add('tw-hidden'));

  // Clean active SSE & stats intervals on view transition
  if (mainRoute !== 'server') {
    if (sseSource) { sseSource.close(); sseSource = null; }
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  }

  if (mainRoute === 'server' && parts[1]) {
    loadServerDetail(parts[1]);
  } else if (mainRoute === 'admin-overview') {
    loadAdminOverview();
  } else if (mainRoute === 'admin-users') {
    loadAdminUsers();
  } else if (mainRoute === 'admin-nodes') {
    loadAdminNodes();
  } else if (mainRoute === 'admin-servers') {
    loadAdminServers();
  } else if (mainRoute === 'admin-settings') {
    loadAdminSettings();
  } else if (mainRoute === 'profile') {
    loadProfile();
  } else {
    loadUserServers();
  }
}

// ==========================================================================
// 1. User Servers List View
// ==========================================================================
async function loadUserServers() {
  const view = document.getElementById('view-servers');
  view.classList.remove('tw-hidden');

  const container = document.getElementById('servers-grid');
  const emptyState = document.getElementById('servers-empty-state');
  const loading = document.getElementById('servers-loading');

  loading.classList.remove('tw-hidden');
  container.classList.add('tw-hidden');
  emptyState.classList.add('tw-hidden');

  try {
    const res = await fetch('/api/servers');
    const data = await res.json();
    loading.classList.add('tw-hidden');

    if (!data.success || !data.servers || data.servers.length === 0) {
      if (currentUser.role === 'admin') {
        emptyState.innerHTML = `
          <div class="tw-w-12 tw-h-12 tw-rounded-full tw-bg-white/[0.05] tw-border tw-border-white/10 tw-flex tw-items-center tw-justify-center tw-mx-auto tw-text-neutral-400 tw-text-xl">
            <i class="bi bi-server"></i>
          </div>
          <div>
            <h3 class="tw-text-lg tw-font-bold tw-text-white">No servers created yet</h3>
            <p class="tw-text-sm tw-text-neutral-400 tw-max-w-sm tw-mx-auto tw-mt-1">
              Deploy your first Minecraft instance and allocate it to any user on the platform.
            </p>
          </div>
          <button onclick="openCreateServerModal()" class="btn-primary tw-mx-auto tw-mt-2">
            <i class="bi bi-plus-lg"></i>
            <span>Create &amp; Assign Server</span>
          </button>
        `;
      } else {
        emptyState.innerHTML = `
          <div class="tw-w-12 tw-h-12 tw-rounded-full tw-bg-white/[0.05] tw-border tw-border-white/10 tw-flex tw-items-center tw-justify-center tw-mx-auto tw-text-neutral-500 tw-text-xl">
            <i class="bi bi-shield-slash"></i>
          </div>
          <div>
            <h3 class="tw-text-lg tw-font-bold tw-text-white">No servers assigned yet</h3>
            <p class="tw-text-sm tw-text-neutral-400 tw-max-w-md tw-mx-auto tw-mt-1">
              You do not currently have any active Minecraft servers. Servers are provisioned and allocated directly by platform administrators.
            </p>
          </div>
          <div class="tw-pt-2">
            <a href="https://discord.gg/kinetichost" target="_blank" class="tw-inline-flex tw-items-center tw-gap-2 tw-px-4 tw-py-2 tw-rounded-xl tw-bg-white/[0.04] hover:tw-bg-white/[0.08] tw-border tw-border-white/10 tw-text-xs tw-font-mono tw-text-neutral-300 hover:tw-text-white tw-transition-colors">
              <i class="bi bi-discord"></i>
              <span>Join Discord for Support</span>
            </a>
          </div>
        `;
      }
      emptyState.classList.remove('tw-hidden');
      return;
    }

    container.classList.remove('tw-hidden');
    container.innerHTML = data.servers.map(s => {
      const isOnline = s.status === 'running';
      const isStarting = s.status === 'starting';
      const isCrashed = s.status === 'crashed';
      const statusClass = isOnline ? 'online' : (isStarting ? 'starting' : (isCrashed ? 'crashed' : 'offline'));

      return `
        <div class="kh-panel-card interactive tw-flex tw-flex-col tw-justify-between">
          <div>
            <!-- Top Status & Software Bar -->
            <div class="tw-flex tw-items-center tw-justify-between tw-mb-4">
              <span class="kh-status-badge ${statusClass}">
                <span class="kh-status-dot"></span>
                <span>${s.status.toUpperCase()}</span>
              </span>
              <span class="tw-px-2.5 tw-py-1 tw-rounded-md tw-bg-white/[0.04] tw-border tw-border-white/[0.06] tw-text-xs tw-font-mono tw-text-neutral-400">
                ${escapeHtml(s.software)} ${escapeHtml(s.version)}
              </span>
            </div>

            <!-- Server Title & Port -->
            <div class="tw-mb-4">
              <h3 class="tw-text-base tw-font-bold tw-text-white tw-tracking-tight tw-mb-1">${escapeHtml(s.name)}</h3>
              <div class="tw-flex tw-items-center tw-gap-2">
                <span class="tw-text-xs tw-font-mono tw-text-neutral-400 tw-truncate">${s.public_connection}</span>
                <button class="tw-text-neutral-500 hover:tw-text-white tw-transition-colors tw-text-xs" title="Copy Address" onclick="copyText('${s.public_connection}')">
                  <i class="bi bi-copy"></i>
                </button>
              </div>
            </div>

            <!-- Resource Allocation Breakdown -->
            <div class="tw-grid tw-grid-cols-3 tw-gap-2 tw-py-3 tw-px-3 tw-rounded-lg tw-bg-white/[0.02] tw-border tw-border-white/[0.04] tw-font-mono tw-text-[11px] tw-mb-4">
              <div>
                <div class="tw-text-neutral-500 tw-text-[10px]">MEMORY</div>
                <div class="tw-text-neutral-200 tw-font-semibold">${s.used_memory_mb || 0} / ${s.ram_mb}M</div>
              </div>
              <div>
                <div class="tw-text-neutral-500 tw-text-[10px]">CPU</div>
                <div class="tw-text-neutral-200 tw-font-semibold">${s.used_cpu_percent || 0}%</div>
              </div>
              <div>
                <div class="tw-text-neutral-500 tw-text-[10px]">STORAGE</div>
                <div class="tw-text-neutral-200 tw-font-semibold">25.6 GB</div>
              </div>
            </div>
          </div>

          <!-- Bottom Action Controls -->
          <div class="tw-flex tw-items-center tw-justify-between tw-pt-3 tw-border-t tw-border-white/[0.06]">
            <div class="tw-flex tw-items-center tw-gap-1.5">
              ${isOnline ? `
                <a href="#server/${s.id}" class="tw-px-2.5 tw-py-1 tw-rounded-md tw-bg-white/[0.04] hover:tw-bg-white/[0.08] tw-border tw-border-white/[0.08] tw-text-xs tw-font-mono tw-text-neutral-300 hover:tw-text-white tw-transition-colors">
                  <i class="bi bi-terminal tw-mr-1"></i> Console
                </a>
              ` : `
                <button onclick="quickStartServer(${s.id})" class="tw-px-2.5 tw-py-1 tw-rounded-md tw-bg-emerald-500/10 hover:tw-bg-emerald-500/20 tw-border tw-border-emerald-500/25 tw-text-xs tw-font-mono tw-text-emerald-400 tw-transition-colors">
                  <i class="bi bi-play-fill tw-mr-0.5"></i> Start
                </button>
              `}
            </div>

            <a href="#server/${s.id}" class="tw-inline-flex tw-items-center tw-gap-1 tw-text-xs tw-font-semibold tw-text-white hover:tw-underline">
              <span>Manage</span>
              <i class="bi bi-arrow-right tw-text-neutral-400"></i>
            </a>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    loading.classList.add('tw-hidden');
    showToast('Failed to load server instances', 'error');
  }
}

async function quickStartServer(serverId) {
  try {
    const res = await fetch(`/api/servers/${serverId}/start`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Server process starting...', 'success');
      setTimeout(loadUserServers, 1000);
    } else {
      showToast(data.error || 'Failed to start server', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ==========================================================================
// 2. Server Detail View (Overview, Console, Settings)
// ==========================================================================
async function loadServerDetail(serverId) {
  const view = document.getElementById('view-server-detail');
  view.classList.remove('tw-hidden');

  if (sseSource) { sseSource.close(); sseSource = null; }
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }

  try {
    const res = await fetch(`/api/servers/${serverId}`);
    const data = await res.json();

    if (!data.success || !data.server) {
      showToast(data.error || 'Server not found', 'error');
      window.location.hash = 'dashboard';
      return;
    }

    currentServer = data.server;
    renderServerHeader(currentServer);
    switchServerTab('overview');
    setupServerPowerButtons(serverId);

    // Live refresh every 3 seconds
    statsInterval = setInterval(() => refreshServerStats(serverId), 3000);
  } catch (err) {
    showToast('Failed to load server details', 'error');
    window.location.hash = 'dashboard';
  }
}

function renderServerHeader(s) {
  document.getElementById('detail-server-name').textContent = s.name;
  document.getElementById('detail-server-software').textContent = `${s.software} ${s.version}`;
  document.getElementById('detail-server-address').textContent = s.public_connection;

  const isOnline = s.status === 'running';
  const isStarting = s.status === 'starting';
  const isCrashed = s.status === 'crashed';
  const statusClass = isOnline ? 'online' : (isStarting ? 'starting' : (isCrashed ? 'crashed' : 'offline'));

  const statusBadge = document.getElementById('detail-server-status');
  statusBadge.className = `kh-status-badge ${statusClass}`;
  statusBadge.innerHTML = `<span class="kh-status-dot"></span> <span>${s.status.toUpperCase()}</span>`;
}

function switchServerTab(tab) {
  currentServerTab = tab;
  document.querySelectorAll('.server-tab-btn').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.server-tab-content').forEach(c => c.classList.add('tw-hidden'));
  const activeContent = document.getElementById(`server-tab-${tab}`);
  if (activeContent) activeContent.classList.remove('tw-hidden');

  if (tab === 'console') {
    initConsoleStream(currentServer.id);
  } else if (tab === 'settings') {
    initServerSettings(currentServer);
  }
}

function setupServerPowerButtons(serverId) {
  const btnStart = document.getElementById('btn-server-start');
  const btnStop = document.getElementById('btn-server-stop');
  const btnRestart = document.getElementById('btn-server-restart');
  const btnKill = document.getElementById('btn-server-kill');

  btnStart.onclick = async () => {
    btnStart.disabled = true;
    try {
      const res = await fetch(`/api/servers/${serverId}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Server process launched successfully', 'success');
      } else {
        showToast(data.error, 'error');
      }
    } catch (e) { showToast(e.message, 'error'); }
    btnStart.disabled = false;
    refreshServerStats(serverId);
  };

  btnStop.onclick = async () => {
    btnStop.disabled = true;
    try {
      const res = await fetch(`/api/servers/${serverId}/stop`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Graceful stop signal sent', 'info');
      } else {
        showToast(data.error, 'error');
      }
    } catch (e) { showToast(e.message, 'error'); }
    btnStop.disabled = false;
    refreshServerStats(serverId);
  };

  btnRestart.onclick = async () => {
    btnRestart.disabled = true;
    try {
      const res = await fetch(`/api/servers/${serverId}/restart`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Server restart sequence initiated', 'info');
      } else {
        showToast(data.error, 'error');
      }
    } catch (e) { showToast(e.message, 'error'); }
    btnRestart.disabled = false;
    refreshServerStats(serverId);
  };

  btnKill.onclick = async () => {
    if (!confirm('Force kill immediately terminates the Java PID without saving chunks. Proceed?')) return;
    try {
      const res = await fetch(`/api/servers/${serverId}/kill`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Server process terminated', 'info');
      } else {
        showToast(data.error, 'error');
      }
    } catch (e) { showToast(e.message, 'error'); }
    refreshServerStats(serverId);
  };
}

async function refreshServerStats(serverId) {
  if (window.location.hash.indexOf('#server/') === -1) return;
  try {
    const res = await fetch(`/api/servers/${serverId}`);
    const data = await res.json();
    if (data.success && data.server) {
      currentServer = data.server;
      renderServerHeader(currentServer);

      const m = currentServer.metrics;
      document.getElementById('stat-ram-used').textContent = `${m.memory_used_mb} MB / ${m.memory_limit_mb} MB`;
      const ramPercent = Math.min(100, Math.round((m.memory_used_mb / m.memory_limit_mb) * 100));
      document.getElementById('stat-ram-bar').style.width = `${ramPercent}%`;

      document.getElementById('stat-cpu-used').textContent = `${m.cpu_percent}%`;
      document.getElementById('stat-cpu-bar').style.width = `${Math.min(100, m.cpu_percent)}%`;

      document.getElementById('stat-disk-used').textContent = `${m.disk_used_mb} MB / ${m.disk_limit_mb} MB`;
      const diskPercent = Math.min(100, Math.round((m.disk_used_mb / m.disk_limit_mb) * 100));
      document.getElementById('stat-disk-bar').style.width = `${diskPercent}%`;
    }
  } catch (err) {}
}

// ==========================================================================
// 3. Live SSE Console Streaming
// ==========================================================================
function initConsoleStream(serverId) {
  const terminal = document.getElementById('console-terminal');
  const input = document.getElementById('console-input');
  const btnSend = document.getElementById('console-send-btn');
  const btnClear = document.getElementById('console-clear-btn');
  const autoScrollCheckbox = document.getElementById('console-autoscroll');

  terminal.innerHTML = '<div class="tw-text-neutral-500">[KineticHost] Establishing live server console stream...</div>';

  if (sseSource) {
    sseSource.close();
  }

  sseSource = new EventSource(`/api/servers/${serverId}/console/stream`);

  sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        const lineEl = document.createElement('div');
        lineEl.className = 'console-line';
        lineEl.textContent = data.message;
        terminal.appendChild(lineEl);

        if (autoScrollCheckbox && autoScrollCheckbox.checked) {
          terminal.scrollTop = terminal.scrollHeight;
        }
      }
    } catch (e) {}
  };

  sseSource.onerror = () => {
    const errorEl = document.createElement('div');
    errorEl.className = 'tw-text-neutral-500 tw-italic';
    errorEl.textContent = '[KineticHost] Console stream reconnecting...';
    terminal.appendChild(errorEl);
  };

  if (btnClear) {
    btnClear.onclick = () => {
      terminal.innerHTML = '<div class="tw-text-neutral-500">[KineticHost] Console cleared.</div>';
    };
  }

  const sendCmd = async () => {
    const command = input.value.trim();
    if (!command) return;

    commandHistory.push(command);
    historyIndex = commandHistory.length;
    input.value = '';

    try {
      await fetch(`/api/servers/${serverId}/console`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
    } catch (err) {
      showToast('Failed to send command', 'error');
    }
  };

  btnSend.onclick = sendCmd;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      sendCmd();
    } else if (e.key === 'ArrowUp') {
      if (historyIndex > 0) {
        historyIndex--;
        input.value = commandHistory[historyIndex] || '';
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIndex < commandHistory.length - 1) {
        historyIndex++;
        input.value = commandHistory[historyIndex] || '';
      } else {
        historyIndex = commandHistory.length;
        input.value = '';
      }
    }
  };
}

// ==========================================================================
// 4. Server Settings & Deletion
// ==========================================================================
function initServerSettings(s) {
  document.getElementById('settings-server-name').value = s.name;
  document.getElementById('settings-server-ram').value = s.ram_mb;
  document.getElementById('settings-server-ram-val').textContent = `${s.ram_mb} MB`;
  document.getElementById('settings-server-autostart').checked = s.auto_start === 1;

  document.getElementById('settings-server-ram').oninput = (e) => {
    document.getElementById('settings-server-ram-val').textContent = `${e.target.value} MB`;
  };

  document.getElementById('btn-save-server-settings').onclick = async () => {
    const name = document.getElementById('settings-server-name').value;
    const ramMb = document.getElementById('settings-server-ram').value;
    const autoStart = document.getElementById('settings-server-autostart').checked;

    try {
      const res = await fetch(`/api/servers/${s.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ramMb, autoStart })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        loadServerDetail(s.id);
      } else {
        showToast(data.error, 'error');
      }
    } catch (err) { showToast(err.message, 'error'); }
  };

  document.getElementById('btn-delete-server').onclick = async () => {
    const confirmation = prompt(`To permanently delete this server, please type its exact name "${s.name}":`);
    if (confirmation !== s.name) {
      showToast('Server name confirmation did not match. Deletion cancelled.', 'info');
      return;
    }

    try {
      const res = await fetch(`/api/servers/${s.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        window.location.hash = 'dashboard';
      } else {
        showToast(data.error, 'error');
      }
    } catch (err) { showToast(err.message, 'error'); }
  };
}

// ==========================================================================
// 5. Create Server Modal Workflow
// ==========================================================================
async function openCreateServerModal() {
  if (currentUser.role !== 'admin') {
    showToast('Only administrators can create and assign servers.', 'error');
    return;
  }

  document.getElementById('modal-create-server').classList.remove('tw-hidden');
  document.getElementById('create-server-form').reset();
  document.getElementById('create-server-ram-val').textContent = '4096 MB';
  document.getElementById('create-server-status-msg').classList.add('tw-hidden');
  document.getElementById('btn-create-server-submit').disabled = false;

  // Populate users dropdown
  const ownerSelect = document.getElementById('create-server-owner');
  ownerSelect.innerHTML = '<option value="">Loading registered users...</option>';
  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (data.success && data.users) {
      ownerSelect.innerHTML = data.users.map(u => `
        <option value="${u.id}" ${u.id === currentUser.id ? 'selected' : ''}>
          ${escapeHtml(u.name)} (${escapeHtml(u.email)}) [${u.role.toUpperCase()}]
        </option>
      `).join('');
    } else {
      ownerSelect.innerHTML = `<option value="${currentUser.id}">${escapeHtml(currentUser.name)} (You)</option>`;
    }
  } catch (e) {
    ownerSelect.innerHTML = `<option value="${currentUser.id}">${escapeHtml(currentUser.name)} (You)</option>`;
  }
}

function closeCreateServerModal() {
  document.getElementById('modal-create-server').classList.add('tw-hidden');
}

async function handleCreateServerSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('create-server-name').value;
  const ownerId = document.getElementById('create-server-owner').value;
  const software = document.getElementById('create-server-software').value;
  const version = document.getElementById('create-server-version').value;
  const ramMb = document.getElementById('create-server-ram').value;
  const eulaAccepted = document.getElementById('create-server-eula').checked;

  const btnSubmit = document.getElementById('btn-create-server-submit');
  const statusMsg = document.getElementById('create-server-status-msg');

  btnSubmit.disabled = true;
  statusMsg.classList.remove('tw-hidden');
  statusMsg.innerHTML = '<span class="tw-flex tw-items-center tw-gap-2"><i class="bi bi-arrow-repeat tw-animate-spin"></i> Allocating port, isolated directory, and downloading server binary...</span>';

  try {
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, software, version, ramMb, eulaAccepted, ownerId })
    });
    const data = await res.json();

    if (data.success && data.server) {
      statusMsg.innerHTML = '<span class="tw-text-emerald-400">✓ Instance deployed and assigned successfully! Redirecting...</span>';
      showToast('Server created and assigned successfully!', 'success');
      setTimeout(() => {
        closeCreateServerModal();
        window.location.hash = `server/${data.server.id}`;
      }, 600);
    } else {
      statusMsg.innerHTML = `<span class="tw-text-red-400">✗ ${data.error}</span>`;
      showToast(data.error || 'Failed to create server', 'error');
      btnSubmit.disabled = false;
    }
  } catch (err) {
    statusMsg.innerHTML = `<span class="tw-text-red-400">✗ ${err.message}</span>`;
    showToast(err.message, 'error');
    btnSubmit.disabled = false;
  }
}

// ==========================================================================
// 6. Admin Panel Views
// ==========================================================================
async function loadAdminOverview() {
  const view = document.getElementById('view-admin-overview');
  view.classList.remove('tw-hidden');

  try {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();
    if (!data.success) return;

    document.getElementById('admin-stat-users').textContent = data.stats.total_users;
    document.getElementById('admin-stat-servers').textContent = data.stats.total_servers;
    document.getElementById('admin-stat-running').textContent = data.stats.running_servers;
    document.getElementById('admin-stat-nodes').textContent = data.stats.total_nodes;

    const n = data.node;
    document.getElementById('node-hostname').textContent = n.hostname;
    document.getElementById('node-os').textContent = `${n.platform} (${n.osRelease})`;
    document.getElementById('node-cpu-model').textContent = `${n.cpu.model} (${n.cpu.cores} Cores)`;
    document.getElementById('node-ram-usage').textContent = `${n.memory.usedMb} MB / ${n.memory.totalMb} MB (${n.memory.percentUsed}%)`;
    document.getElementById('node-disk-usage').textContent = `${n.disk.usedMb} MB / ${n.disk.totalMb} MB (${n.disk.percentUsed}%)`;

    const logsContainer = document.getElementById('admin-activity-logs');
    if (data.recent_activity.length === 0) {
      logsContainer.innerHTML = '<tr><td colspan="4" class="tw-p-4 tw-text-neutral-500 tw-text-center">No platform activity recorded yet.</td></tr>';
    } else {
      logsContainer.innerHTML = data.recent_activity.map(l => `
        <tr class="tw-border-b tw-border-white/[0.04] tw-text-xs">
          <td class="tw-py-3 tw-px-4 tw-font-mono tw-text-neutral-400">${l.created_at}</td>
          <td class="tw-py-3 tw-px-4 tw-text-white tw-font-medium">${escapeHtml(l.user_name || 'System')}</td>
          <td class="tw-py-3 tw-px-4"><span class="tw-px-2 tw-py-0.5 tw-rounded tw-bg-white/5 tw-border tw-border-white/10 tw-text-[10px] tw-font-mono">${l.action}</span></td>
          <td class="tw-py-3 tw-px-4 tw-text-neutral-300">${escapeHtml(l.details || '')}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('Failed to load admin metrics', 'error');
  }
}

async function loadAdminUsers() {
  const view = document.getElementById('view-admin-users');
  view.classList.remove('tw-hidden');

  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('admin-users-table');
    tbody.innerHTML = data.users.map(u => `
      <tr class="tw-border-b tw-border-white/[0.04] hover:tw-bg-white/[0.01] tw-text-sm">
        <td class="tw-py-4 tw-px-6 tw-font-mono tw-text-neutral-400">#${u.id}</td>
        <td class="tw-py-4 tw-px-6">
          <div class="tw-flex tw-items-center tw-gap-2.5">
            <div class="tw-w-7 tw-h-7 tw-rounded-full tw-bg-neutral-800 tw-border tw-border-white/10 tw-flex tw-items-center tw-justify-center tw-text-xs tw-font-bold tw-text-white">
              ${u.name.charAt(0).toUpperCase()}
            </div>
            <span class="tw-font-semibold tw-text-white">${escapeHtml(u.name)}</span>
          </div>
        </td>
        <td class="tw-py-4 tw-px-6 tw-text-neutral-300">${escapeHtml(u.email)}</td>
        <td class="tw-py-4 tw-px-6">
          <span class="tw-px-2.5 tw-py-1 tw-rounded-full tw-text-xs tw-font-mono ${u.role === 'admin' ? 'tw-bg-white/10 tw-text-white tw-border tw-border-white/20' : 'tw-bg-neutral-800 tw-text-neutral-300'}">
            ${u.role}
          </span>
        </td>
        <td class="tw-py-4 tw-px-6 tw-font-mono tw-text-xs">${u.servers_count} instances (${u.allocated_ram_mb} MB)</td>
        <td class="tw-py-4 tw-px-6 tw-font-mono tw-text-xs tw-text-neutral-400">${u.created_at}</td>
      </tr>
    `).join('');
  } catch (err) {}
}

async function loadAdminNodes() {
  const view = document.getElementById('view-admin-nodes');
  view.classList.remove('tw-hidden');

  try {
    const res = await fetch('/api/admin/nodes');
    const data = await res.json();
    if (!data.success) return;

    const grid = document.getElementById('admin-nodes-grid');
    grid.innerHTML = data.nodes.map(n => `
      <div class="kh-panel-card">
        <div class="tw-flex tw-items-center tw-justify-between tw-mb-4">
          <div class="tw-flex tw-items-center tw-gap-3">
            <div class="tw-h-10 tw-w-10 tw-rounded-lg tw-bg-white/[0.06] tw-border tw-border-white/10 tw-flex tw-items-center tw-justify-center">
              <i class="bi bi-hdd-network tw-text-white tw-text-lg"></i>
            </div>
            <div>
              <h3 class="tw-text-base tw-font-bold tw-text-white">${escapeHtml(n.name)}</h3>
              <span class="tw-text-xs tw-font-mono tw-text-neutral-400">${n.hostname} (${n.public_address})</span>
            </div>
          </div>
          <span class="kh-status-badge online"><span class="kh-status-dot"></span> ONLINE</span>
        </div>

        <div class="tw-grid tw-grid-cols-2 tw-gap-4 tw-my-4 tw-font-mono tw-text-xs">
          <div class="tw-p-3 tw-rounded-lg tw-bg-black/40 tw-border tw-border-white/5">
            <div class="tw-text-neutral-400 tw-mb-1">RAM ALLOCATION</div>
            <div class="tw-text-white tw-font-bold">${n.metrics.memory.usedMb} / ${n.total_ram_mb} MB</div>
          </div>
          <div class="tw-p-3 tw-rounded-lg tw-bg-black/40 tw-border tw-border-white/5">
            <div class="tw-text-neutral-400 tw-mb-1">STORAGE</div>
            <div class="tw-text-white tw-font-bold">${n.metrics.disk.usedMb} / ${n.total_storage_mb} MB</div>
          </div>
        </div>

        <div class="tw-pt-3 tw-border-t tw-border-white/5 tw-flex tw-items-center tw-justify-between tw-text-xs tw-text-neutral-400 font-mono">
          <span>Port Range: ${n.port_range_start} - ${n.port_range_end}</span>
          <span>Instances: ${n.running_count} running / ${n.server_count} total</span>
        </div>
      </div>
    `).join('');
  } catch (err) {}
}

async function loadAdminServers() {
  const view = document.getElementById('view-admin-servers');
  view.classList.remove('tw-hidden');

  try {
    const res = await fetch('/api/admin/servers');
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('admin-servers-table');
    tbody.innerHTML = data.servers.map(s => `
      <tr class="tw-border-b tw-border-white/[0.04] hover:tw-bg-white/[0.01] tw-text-sm">
        <td class="tw-py-4 tw-px-6 tw-font-mono tw-text-neutral-400">#${s.id}</td>
        <td class="tw-py-4 tw-px-6 tw-font-semibold tw-text-white">${escapeHtml(s.name)}</td>
        <td class="tw-py-4 tw-px-6 tw-text-neutral-300">${escapeHtml(s.owner_name)} (${escapeHtml(s.owner_email)})</td>
        <td class="tw-py-4 tw-px-6 tw-font-mono tw-text-xs">${s.software} ${s.version}</td>
        <td class="tw-py-4 tw-px-6 tw-font-mono tw-text-xs">:${s.port}</td>
        <td class="tw-py-4 tw-px-6">
          <span class="kh-status-badge ${s.status === 'running' ? 'online' : 'offline'}">
            <span class="kh-status-dot"></span> ${s.status.toUpperCase()}
          </span>
        </td>
        <td class="tw-py-4 tw-px-6">
          <a href="#server/${s.id}" class="tw-text-xs tw-text-white hover:tw-underline">Manage →</a>
        </td>
      </tr>
    `).join('');
  } catch (err) {}
}

async function loadAdminSettings() {
  const view = document.getElementById('view-admin-settings');
  view.classList.remove('tw-hidden');

  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      const s = data.settings;
      document.getElementById('setting-panel-name').value = s.panel_name || '';
      document.getElementById('setting-default-ram').value = s.default_ram_mb || 4096;
      document.getElementById('setting-max-servers').value = s.max_servers_per_user || 3;
      document.getElementById('setting-public-host').value = s.public_hostname || '';

      document.getElementById('btn-save-admin-settings').onclick = async () => {
        const payload = {
          panel_name: document.getElementById('setting-panel-name').value,
          default_ram_mb: document.getElementById('setting-default-ram').value,
          max_servers_per_user: document.getElementById('setting-max-servers').value,
          public_hostname: document.getElementById('setting-public-host').value
        };

        const patchRes = await fetch('/api/admin/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const patchData = await patchRes.json();
        if (patchData.success) showToast(patchData.message, 'success');
        else showToast(patchData.error, 'error');
      };
    }
  } catch (err) {}
}

// ==========================================================================
// 7. Profile View Overhaul
// ==========================================================================
async function loadProfile() {
  const view = document.getElementById('view-profile');
  view.classList.remove('tw-hidden');

  try {
    const res = await fetch('/api/account/profile');
    const data = await res.json();
    if (!data.success) return;

    const u = data.user;
    document.getElementById('profile-name').value = u.name;
    document.getElementById('profile-email').value = u.email;

    document.getElementById('profile-card-name').textContent = u.name;
    document.getElementById('profile-card-email').textContent = u.email;
    document.getElementById('profile-card-role').textContent = u.role.toUpperCase();

    const avatarUrl = u.avatar_url || 'assets/images/control-panel/avatar-1.png';
    const heroAvatar = document.getElementById('profile-card-avatar-img');
    if (heroAvatar) heroAvatar.src = avatarUrl;

    if (avatarUrl.includes('avatar-2')) {
      const opt2 = document.getElementById('avatar-opt-2');
      if (opt2) opt2.checked = true;
    } else {
      const opt1 = document.getElementById('avatar-opt-1');
      if (opt1) opt1.checked = true;
    }

    document.getElementById('profile-quota-servers').textContent = `${u.servers_count} / ${u.max_servers}`;
    const serverPercent = Math.min(100, Math.round((u.servers_count / (u.max_servers || 1)) * 100));
    document.getElementById('profile-quota-servers-bar').style.width = `${serverPercent}%`;

    document.getElementById('profile-quota-ram').textContent = `${u.used_ram_mb} MB / ${u.max_ram_mb} MB`;
    const ramPercent = Math.min(100, Math.round((u.used_ram_mb / (u.max_ram_mb || 1)) * 100));
    document.getElementById('profile-quota-ram-bar').style.width = `${ramPercent}%`;

    document.getElementById('profile-joined-date').textContent = u.created_at;

    document.getElementById('btn-save-profile').onclick = async () => {
      const name = document.getElementById('profile-name').value;
      const currentPassword = document.getElementById('profile-curr-pass').value;
      const newPassword = document.getElementById('profile-new-pass').value;

      const selectedAvatarRadio = document.querySelector('input[name="profile_avatar_opt"]:checked');
      const avatarUrl = selectedAvatarRadio ? selectedAvatarRadio.value : undefined;

      try {
        const pRes = await fetch('/api/account/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, avatarUrl, currentPassword, newPassword })
        });
        const pData = await pRes.json();
        if (pData.success) {
          showToast(pData.message, 'success');
          document.getElementById('profile-curr-pass').value = '';
          document.getElementById('profile-new-pass').value = '';
          currentUser.name = pData.user.name;
          currentUser.avatar_url = pData.user.avatar_url;
          initSidebar();
          loadProfile();
        } else {
          showToast(pData.error, 'error');
        }
      } catch (err) { showToast(err.message, 'error'); }
    };
  } catch (err) {}
}

// ==========================================================================
// Helpers
// ==========================================================================
function copyText(text) {
  navigator.clipboard.writeText(text);
  showToast(`Copied "${text}" to clipboard`, 'info');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
