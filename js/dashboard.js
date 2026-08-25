// KineticHost Real Control Panel Frontend Engine

let currentUser = null;
let currentServer = null;
let currentView = 'dashboard';
let currentServerTab = 'overview';
let sseSource = null;
let commandHistory = [];
let historyIndex = -1;
let statsInterval = null;

// Initialize Dashboard
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
    handleHashNavigation();
    window.addEventListener('hashchange', handleHashNavigation);

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

// Setup responsive sidebar and user identity
function initSidebar() {
  document.getElementById('sidebar-user-name').textContent = currentUser.name;
  document.getElementById('sidebar-user-avatar').textContent = currentUser.name.charAt(0).toUpperCase();
  document.getElementById('sidebar-user-role').textContent = `Role: ${currentUser.role}`;

  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('tw-hidden'));
  }
}

// Router for hash-based navigation
function handleHashNavigation() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  const parts = hash.split('/');
  const mainRoute = parts[0];

  // Highlight active sidebar item
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.dataset.route === mainRoute) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Switch views
  document.querySelectorAll('.panel-view').forEach(v => v.classList.add('tw-hidden'));

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

// --------------------------------------------------------------------------
// 1. User Servers List View
// --------------------------------------------------------------------------
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
      emptyState.classList.remove('tw-hidden');
      return;
    }

    container.classList.remove('tw-hidden');
    container.innerHTML = data.servers.map(s => `
      <div class="kh-card tw-flex tw-flex-col tw-justify-between hover:tw-border-white/20 tw-transition-colors">
        <div>
          <div class="tw-flex tw-items-center tw-justify-between tw-mb-4">
            <div class="tw-flex tw-items-center tw-gap-3">
              <div class="tw-h-10 tw-w-10 tw-rounded-lg tw-bg-white/[0.06] tw-border tw-border-white/10 tw-flex tw-items-center tw-justify-center tw-shrink-0">
                <i class="bi bi-box-seam tw-text-white tw-text-lg"></i>
              </div>
              <div>
                <h3 class="tw-text-base tw-font-bold tw-text-white">${escapeHtml(s.name)}</h3>
                <span class="tw-text-xs tw-font-mono tw-text-neutral-400">
                  ${escapeHtml(s.software)} ${escapeHtml(s.version)} • ${s.ram_mb}MB RAM
                </span>
              </div>
            </div>
            <span class="kh-status-badge ${s.status === 'running' ? 'online' : (s.status === 'starting' ? 'starting' : (s.status === 'crashed' ? 'crashed' : 'offline'))}">
              <span class="kh-status-dot"></span>
              ${s.status.toUpperCase()}
            </span>
          </div>

          <div class="tw-py-2.5 tw-px-3.5 tw-rounded-xl tw-bg-black/50 tw-border tw-border-white/5 tw-font-mono tw-text-xs tw-text-neutral-300 tw-flex tw-items-center tw-justify-between tw-mb-4">
            <span class="tw-truncate">${s.public_connection}</span>
            <button class="hover:tw-text-white tw-transition-colors tw-ml-2" title="Copy Address" onclick="copyText('${s.public_connection}')">
              <i class="bi bi-copy"></i>
            </button>
          </div>
        </div>

        <div class="tw-flex tw-items-center tw-justify-between tw-pt-4 tw-border-t tw-border-white/[0.08]">
          <div class="tw-text-xs tw-text-neutral-400 tw-font-mono">
            <span>Port: ${s.port}</span>
          </div>
          <a href="#server/${s.id}" class="btn-primary tw-py-1.5 tw-px-4 tw-text-xs">
            <span>Manage</span>
            <i class="bi bi-arrow-right"></i>
          </a>
        </div>
      </div>
    `).join('');
  } catch (err) {
    loading.classList.add('tw-hidden');
    console.error('Failed to load servers:', err);
  }
}

// --------------------------------------------------------------------------
// 2. Server Detail View (Overview, Console, Settings)
// --------------------------------------------------------------------------
async function loadServerDetail(serverId) {
  const view = document.getElementById('view-server-detail');
  view.classList.remove('tw-hidden');

  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }

  try {
    const res = await fetch(`/api/servers/${serverId}`);
    const data = await res.json();

    if (!data.success || !data.server) {
      alert(data.error || 'Server not found');
      window.location.hash = 'dashboard';
      return;
    }

    currentServer = data.server;
    renderServerHeader(currentServer);
    switchServerTab('overview');

    // Attach power actions
    setupServerPowerButtons(serverId);

    // Setup live stats poll every 3 seconds
    statsInterval = setInterval(() => refreshServerStats(serverId), 3000);
  } catch (err) {
    console.error('Failed to load server details:', err);
    window.location.hash = 'dashboard';
  }
}

function renderServerHeader(s) {
  document.getElementById('detail-server-name').textContent = s.name;
  document.getElementById('detail-server-software').textContent = `${s.software} ${s.version}`;
  document.getElementById('detail-server-address').textContent = s.public_connection;

  const statusBadge = document.getElementById('detail-server-status');
  statusBadge.className = `kh-status-badge ${s.status === 'running' ? 'online' : (s.status === 'starting' ? 'starting' : (s.status === 'crashed' ? 'crashed' : 'offline'))}`;
  statusBadge.innerHTML = `<span class="kh-status-dot"></span> <span>${s.status.toUpperCase()}</span>`;
}

function switchServerTab(tab) {
  currentServerTab = tab;
  document.querySelectorAll('.server-tab-btn').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('tw-bg-white/10', 'tw-text-white', 'tw-border-white/20');
      btn.classList.remove('tw-text-neutral-400', 'tw-border-transparent');
    } else {
      btn.classList.remove('tw-bg-white/10', 'tw-text-white', 'tw-border-white/20');
      btn.classList.add('tw-text-neutral-400', 'tw-border-transparent');
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
      if (!data.success) alert(data.error);
    } catch (e) { alert(e.message); }
    btnStart.disabled = false;
    refreshServerStats(serverId);
  };

  btnStop.onclick = async () => {
    btnStop.disabled = true;
    try {
      const res = await fetch(`/api/servers/${serverId}/stop`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) alert(data.error);
    } catch (e) { alert(e.message); }
    btnStop.disabled = false;
    refreshServerStats(serverId);
  };

  btnRestart.onclick = async () => {
    btnRestart.disabled = true;
    try {
      const res = await fetch(`/api/servers/${serverId}/restart`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) alert(data.error);
    } catch (e) { alert(e.message); }
    btnRestart.disabled = false;
    refreshServerStats(serverId);
  };

  btnKill.onclick = async () => {
    if (!confirm('Are you sure you want to force kill this server process immediately?')) return;
    try {
      const res = await fetch(`/api/servers/${serverId}/kill`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) alert(data.error);
    } catch (e) { alert(e.message); }
    refreshServerStats(serverId);
  };
}

async function refreshServerStats(serverId) {
  if (currentView !== 'dashboard' && window.location.hash.indexOf('#server/') === -1) return;
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

// --------------------------------------------------------------------------
// 3. Live SSE Console Streaming
// --------------------------------------------------------------------------
function initConsoleStream(serverId) {
  const terminal = document.getElementById('console-terminal');
  const input = document.getElementById('console-input');
  const btnSend = document.getElementById('console-send-btn');
  const autoScrollCheckbox = document.getElementById('console-autoscroll');

  terminal.innerHTML = '<div class="tw-text-neutral-500">[KineticHost] Connecting to live server console stream...</div>';

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
    errorEl.textContent = '[KineticHost] Reconnecting to console...';
    terminal.appendChild(errorEl);
  };

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
      console.error('Failed to send command:', err);
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

// --------------------------------------------------------------------------
// 4. Server Settings & Deletion
// --------------------------------------------------------------------------
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
        alert(data.message);
        loadServerDetail(s.id);
      } else {
        alert(data.error);
      }
    } catch (err) { alert(err.message); }
  };

  document.getElementById('btn-delete-server').onclick = async () => {
    const confirmation = prompt(`To permanently delete this server, please type its exact name "${s.name}":`);
    if (confirmation !== s.name) {
      alert('Server name confirmation did not match. Deletion cancelled.');
      return;
    }

    try {
      const res = await fetch(`/api/servers/${s.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        window.location.hash = 'dashboard';
      } else {
        alert(data.error);
      }
    } catch (err) { alert(err.message); }
  };
}

// --------------------------------------------------------------------------
// 5. Create Server Modal Workflow
// --------------------------------------------------------------------------
function openCreateServerModal() {
  document.getElementById('modal-create-server').classList.remove('tw-hidden');
  document.getElementById('create-server-form').reset();
  document.getElementById('create-server-ram-val').textContent = '4096 MB';
  document.getElementById('create-server-status-msg').classList.add('tw-hidden');
}

function closeCreateServerModal() {
  document.getElementById('modal-create-server').classList.add('tw-hidden');
}

async function handleCreateServerSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('create-server-name').value;
  const software = document.getElementById('create-server-software').value;
  const version = document.getElementById('create-server-version').value;
  const ramMb = document.getElementById('create-server-ram').value;
  const eulaAccepted = document.getElementById('create-server-eula').checked;

  const btnSubmit = document.getElementById('btn-create-server-submit');
  const statusMsg = document.getElementById('create-server-status-msg');

  btnSubmit.disabled = true;
  statusMsg.classList.remove('tw-hidden');
  statusMsg.innerHTML = '<i class="bi bi-arrow-repeat tw-animate-spin"></i> Reserving resources and downloading server JAR...';

  try {
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, software, version, ramMb, eulaAccepted })
    });
    const data = await res.json();

    if (data.success && data.server) {
      statusMsg.innerHTML = '<span class="tw-text-emerald-400">✓ Server deployed successfully!</span>';
      setTimeout(() => {
        closeCreateServerModal();
        window.location.hash = `server/${data.server.id}`;
      }, 800);
    } else {
      statusMsg.innerHTML = `<span class="tw-text-red-400">✗ ${data.error}</span>`;
      btnSubmit.disabled = false;
    }
  } catch (err) {
    statusMsg.innerHTML = `<span class="tw-text-red-400">✗ ${err.message}</span>`;
    btnSubmit.disabled = false;
  }
}

// --------------------------------------------------------------------------
// 6. Admin Panel Views
// --------------------------------------------------------------------------
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
      logsContainer.innerHTML = '<tr><td colspan="4" class="tw-p-4 tw-text-neutral-500 tw-text-center">No recent activity records.</td></tr>';
    } else {
      logsContainer.innerHTML = data.recent_activity.map(l => `
        <tr class="tw-border-b tw-border-white/[0.04] tw-text-xs">
          <td class="tw-py-3 tw-px-4 tw-font-mono tw-text-neutral-400">${l.created_at}</td>
          <td class="tw-py-3 tw-px-4 tw-text-white tw-font-medium">${l.user_name || 'System'}</td>
          <td class="tw-py-3 tw-px-4"><span class="kh-badge tw-text-[10px]">${l.action}</span></td>
          <td class="tw-py-3 tw-px-4 tw-text-neutral-300">${l.details || ''}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load admin overview:', err);
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
        <td class="tw-py-4 tw-px-6 tw-font-semibold tw-text-white">${escapeHtml(u.name)}</td>
        <td class="tw-py-4 tw-px-6 tw-text-neutral-300">${escapeHtml(u.email)}</td>
        <td class="tw-py-4 tw-px-6">
          <span class="tw-px-2 tw-py-0.5 tw-rounded tw-text-xs tw-font-mono ${u.role === 'admin' ? 'tw-bg-white/10 tw-text-white tw-border tw-border-white/20' : 'tw-bg-neutral-800 tw-text-neutral-300'}">
            ${u.role}
          </span>
        </td>
        <td class="tw-py-4 tw-px-6 tw-font-mono tw-text-xs">${u.servers_count} servers (${u.allocated_ram_mb} MB)</td>
        <td class="tw-py-4 tw-px-6 tw-font-mono tw-text-xs tw-text-neutral-400">${u.created_at}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load admin users:', err);
  }
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
      <div class="kh-card">
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

        <div class="tw-pt-3 tw-border-t tw-border-white/5 tw-flex tw-items-center tw-justify-between tw-text-xs tw-text-neutral-400">
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
        if (patchData.success) alert(patchData.message);
        else alert(patchData.error);
      };
    }
  } catch (err) {}
}

// --------------------------------------------------------------------------
// 7. Profile View
// --------------------------------------------------------------------------
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
    document.getElementById('profile-role').textContent = u.role.toUpperCase();
    document.getElementById('profile-created').textContent = u.created_at;

    document.getElementById('profile-quota-servers').textContent = `${u.servers_count} / ${u.max_servers}`;
    document.getElementById('profile-quota-ram').textContent = `${u.used_ram_mb} MB / ${u.max_ram_mb} MB`;

    document.getElementById('btn-save-profile').onclick = async () => {
      const name = document.getElementById('profile-name').value;
      const currentPassword = document.getElementById('profile-curr-pass').value;
      const newPassword = document.getElementById('profile-new-pass').value;

      try {
        const pRes = await fetch('/api/account/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, currentPassword, newPassword })
        });
        const pData = await pRes.json();
        if (pData.success) {
          alert(pData.message);
          document.getElementById('profile-curr-pass').value = '';
          document.getElementById('profile-new-pass').value = '';
          initSidebar();
        } else {
          alert(pData.error);
        }
      } catch (err) { alert(err.message); }
    };
  } catch (err) {}
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function copyText(text) {
  navigator.clipboard.writeText(text);
  alert(`Copied "${text}" to clipboard.`);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
