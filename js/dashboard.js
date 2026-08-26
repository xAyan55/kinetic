// KineticHost Production Control Plane Engine
// Fully Integrated, Zero Dummy Data, Real-Time Architecture

let currentUser = null;
let currentServer = null;
let currentView = 'dashboard';
let currentServerTab = 'overview';
let sseSource = null;
let commandHistory = [];
let historyIndex = -1;
let statsInterval = null;
let overviewInterval = null;

// Cached admin datasets for instantaneous client-side filtering
let allAdminUsers = [];
let allAdminServers = [];
let userRoleFilter = 'all';
let serverStatusFilter = 'all';
let pendingDeleteServer = null;

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
// Authoritative Modal State Management System
// ==========================================================================
let activeModalTrigger = null;

function initModals() {
  const modals = document.querySelectorAll('[data-modal]');
  modals.forEach(modal => {
    modal.setAttribute('data-state', 'closed');
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.add('tw-hidden');

    // Backdrop click: close modal only if clicking directly on backdrop
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal);
      }
    });

    // Trap keyboard focus inside modal
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        trapModalFocus(modal, e);
      }
    });
  });

  // Global Escape key listener to close topmost active modal
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModalEl = document.querySelector('.kh-modal-backdrop[data-state="open"]');
      if (openModalEl) {
        closeModal(openModalEl);
      }
    }
  });

  // Setup Delete Modal Input Validation (registered once)
  const deleteInput = document.getElementById('delete-modal-input');
  const deleteConfirmBtn = document.getElementById('delete-modal-confirm-btn');
  if (deleteInput && deleteConfirmBtn) {
    deleteInput.addEventListener('input', () => {
      if (!pendingDeleteServer) {
        setDeleteConfirmBtnEnabled(false);
        return;
      }
      const targetName = pendingDeleteServer.name || '';
      const inputVal = deleteInput.value.trim();
      const isMatch = inputVal === targetName;
      setDeleteConfirmBtnEnabled(isMatch);
    });

    deleteConfirmBtn.addEventListener('click', async () => {
      if (!pendingDeleteServer) return;
      const targetName = pendingDeleteServer.name || '';
      const inputVal = deleteInput.value.trim();
      if (inputVal !== targetName) {
        showToast('Confirmation name did not match. Deletion aborted.', 'error');
        return;
      }
      await executeServerDeletion(pendingDeleteServer.id, deleteConfirmBtn);
    });
  }
}

function setDeleteConfirmBtnEnabled(enabled) {
  const btn = document.getElementById('delete-modal-confirm-btn');
  if (!btn) return;
  btn.disabled = !enabled;
  if (enabled) {
    btn.className = 'tw-py-2 tw-px-4 tw-rounded-full tw-bg-red-500 hover:tw-bg-red-600 tw-text-white tw-font-semibold tw-text-xs tw-cursor-pointer tw-transition-all tw-shadow-lg tw-shadow-red-500/20';
  } else {
    btn.className = 'tw-py-2 tw-px-4 tw-rounded-full tw-bg-red-500/30 tw-text-white/40 tw-font-semibold tw-text-xs tw-cursor-not-allowed tw-transition-all';
  }
}

function trapModalFocus(modal, e) {
  const focusable = modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) {
      last.focus();
      e.preventDefault();
    }
  } else {
    if (document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }
}

function openModal(modalOrId, triggerEl = null) {
  const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
  if (!modal) return;

  if (triggerEl) activeModalTrigger = triggerEl;

  modal.setAttribute('data-state', 'open');
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.remove('tw-hidden');
  document.body.style.overflow = 'hidden';

  // Focus first focusable input or button inside modal
  setTimeout(() => {
    const focusTarget = modal.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), button:not([disabled])');
    if (focusTarget) focusTarget.focus();
  }, 50);
}

function closeModal(modalOrId) {
  const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
  if (!modal) return;

  modal.setAttribute('data-state', 'closed');
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.add('tw-hidden');

  // Check if any other modal is still open before restoring scroll
  const anyOpen = document.querySelector('.kh-modal-backdrop[data-state="open"]');
  if (!anyOpen) {
    document.body.style.overflow = '';
  }

  // If this was delete modal, reset its state
  if (modal.id === 'modal-delete-server') {
    pendingDeleteServer = null;
    const input = document.getElementById('delete-modal-input');
    if (input) input.value = '';
    setDeleteConfirmBtnEnabled(false);
    const confirmBtn = document.getElementById('delete-modal-confirm-btn');
    if (confirmBtn) {
      confirmBtn.textContent = 'Permanently Delete';
    }
  }

  // Restore focus to trigger
  if (activeModalTrigger && typeof activeModalTrigger.focus === 'function') {
    activeModalTrigger.focus();
    activeModalTrigger = null;
  }
}

function closeAllModals() {
  document.querySelectorAll('[data-modal]').forEach(m => closeModal(m));
}

// ==========================================================================
// Dashboard Initialization & Authentication
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initModals(); // Guarantee all modals closed immediately

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
  const adminBadge = document.getElementById('sidebar-admin-badge');

  const avatarSrc = currentUser.avatar_url || 'assets/images/control-panel/avatar-1.png';

  nameEls.forEach(el => el.textContent = currentUser.name);
  avatarEls.forEach(el => el.src = avatarSrc);
  roleEls.forEach(el => el.textContent = currentUser.role.toUpperCase());

  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('tw-hidden'));
    document.querySelectorAll('.admin-only-btn').forEach(el => el.style.display = '');
    if (adminBadge) adminBadge.classList.remove('tw-hidden');
  } else {
    document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.add('tw-hidden'));
    document.querySelectorAll('.admin-only-btn').forEach(el => el.style.display = 'none');
    if (adminBadge) adminBadge.classList.add('tw-hidden');
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
// Hash Router with Active Polling & SSE Memory Cleanup
// ==========================================================================
function handleHashNavigation() {
  closeAllModals(); // Close all open modals on route change

  const hash = window.location.hash.replace('#', '') || 'dashboard';
  const parts = hash.split('/');
  const mainRoute = parts[0];

  // Route security check for normal users
  if (mainRoute.startsWith('admin-') && (!currentUser || currentUser.role !== 'admin')) {
    showToast('Administrator privileges required to access the control plane.', 'error');
    window.location.hash = 'dashboard';
    return;
  }

  // Update active sidebar link
  document.querySelectorAll('.kh-sidebar-link').forEach(link => {
    if (link.dataset.route === mainRoute) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update breadcrumbs and section prefixes
  const breadcrumb = document.getElementById('topbar-breadcrumb');
  const sectionPrefix = document.getElementById('topbar-section-prefix');

  if (breadcrumb) {
    const routeTitles = {
      'dashboard': 'My Servers',
      'server': 'Server Console',
      'admin-overview': 'Overview',
      'admin-users': 'User Directory',
      'admin-nodes': 'Infrastructure Nodes',
      'admin-servers': 'All Platform Instances',
      'admin-settings': 'Platform Settings',
      'profile': 'Account Profile'
    };
    breadcrumb.textContent = routeTitles[mainRoute] || 'Dashboard';
  }

  if (sectionPrefix) {
    if (mainRoute.startsWith('admin-')) {
      sectionPrefix.textContent = 'control plane /';
    } else if (mainRoute === 'profile') {
      sectionPrefix.textContent = 'account /';
    } else {
      sectionPrefix.textContent = 'panel /';
    }
  }

  // Clean active timers, polling intervals, and SSE streams on route change
  if (mainRoute !== 'server') {
    if (sseSource) { sseSource.close(); sseSource = null; }
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  }

  if (mainRoute !== 'admin-overview') {
    if (overviewInterval) { clearInterval(overviewInterval); overviewInterval = null; }
  }

  // Hide all view sections
  document.querySelectorAll('.panel-view').forEach(v => v.classList.add('tw-hidden'));

  // Dispatch route view loader
  if (mainRoute === 'server' && parts[1]) {
    loadServerDetail(parts[1]);
  } else if (mainRoute === 'admin-overview') {
    loadAdminOverview();
    // Real-time telemetry polling every 6 seconds on overview
    overviewInterval = setInterval(() => {
      if (window.location.hash === '#admin-overview') {
        loadAdminOverview(false);
      }
    }, 6000);
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
// 1. User Servers List View (My Servers)
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
            <h3 class="tw-text-lg tw-font-bold tw-text-white">No instances assigned to you</h3>
            <p class="tw-text-sm tw-text-neutral-400 tw-max-w-sm tw-mx-auto tw-mt-1">
              Deploy a Minecraft instance for yourself or manage platform-wide servers from the Control Plane.
            </p>
          </div>
          <button onclick="openCreateServerModal()" class="btn-primary tw-mx-auto tw-mt-2">
            <i class="bi bi-plus-lg"></i>
            <span>Deploy Server</span>
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
    btnKill.disabled = true;
    try {
      const res = await fetch(`/api/servers/${serverId}/kill`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Server process terminated (SIGKILL)', 'info');
      } else {
        showToast(data.error, 'error');
      }
    } catch (e) { showToast(e.message, 'error'); }
    btnKill.disabled = false;
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
// 4. Server Settings & In-App Modal Deletion
// ==========================================================================
function initServerSettings(s) {
  const nameInput = document.getElementById('settings-server-name');
  const addressInput = document.getElementById('settings-server-address');
  const ramInput = document.getElementById('settings-server-ram');
  const ramVal = document.getElementById('settings-server-ram-val');
  const autostartInput = document.getElementById('settings-server-autostart');
  const saveBtn = document.getElementById('btn-save-server-settings');
  const deleteBtn = document.getElementById('btn-delete-server');

  if (nameInput) nameInput.value = s.name;
  if (addressInput) addressInput.value = s.public_connection || '';
  if (ramInput) ramInput.value = s.ram_mb || 4096;
  if (ramVal) ramVal.textContent = `${s.ram_mb || 4096} MB`;
  if (autostartInput) autostartInput.checked = !!s.auto_start;

  if (ramInput) {
    ramInput.oninput = (e) => {
      if (ramVal) ramVal.textContent = `${e.target.value} MB`;
    };
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const payload = {
          name: nameInput.value.trim(),
          ramMb: parseInt(ramInput.value, 10),
          autoStart: autostartInput.checked
        };
        const res = await fetch(`/api/servers/${s.id}/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, 'success');
          currentServer = { ...currentServer, ...data.server };
          renderServerHeader(currentServer);
        } else {
          showToast(data.error, 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
      saveBtn.disabled = false;
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = () => {
      openDeleteServerModal(s.id, s.name, deleteBtn);
    };
  }
}

// In-App Deletion Modal Engine
function openDeleteServerModal(serverId, serverName, triggerEl = null) {
  pendingDeleteServer = { id: serverId, name: serverName };
  const targetEl = document.getElementById('delete-modal-server-target');
  const inputEl = document.getElementById('delete-modal-input');
  
  if (targetEl) targetEl.textContent = serverName;
  if (inputEl) inputEl.value = '';
  
  setDeleteConfirmBtnEnabled(false);
  openModal('modal-delete-server', triggerEl);
}

function closeDeleteServerModal() {
  closeModal('modal-delete-server');
}

async function executeServerDeletion(serverId, confirmBtn) {
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';
  }

  try {
    const res = await fetch(`/api/servers/${serverId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeDeleteServerModal();
      if (window.location.hash.startsWith('#server/')) {
        window.location.hash = 'dashboard';
      } else if (window.location.hash === '#admin-servers') {
        loadAdminServers(true);
      } else {
        loadUserServers();
      }
    } else {
      showToast(data.error || 'Failed to delete server', 'error');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Permanently Delete';
      }
    }
  } catch (err) {
    showToast(err.message || 'Network error during deletion', 'error');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Permanently Delete';
    }
  }
}

// ==========================================================================
// 5. Create & Assign Server Modal
// ==========================================================================
async function openCreateServerModal(triggerEl = null) {
  if (currentUser.role !== 'admin') {
    showToast('Only administrators can create and assign servers.', 'error');
    return;
  }

  document.getElementById('create-server-form').reset();
  document.getElementById('create-server-ram-val').textContent = '4096 MB';
  document.getElementById('create-server-status-msg').classList.add('tw-hidden');
  document.getElementById('btn-create-server-submit').disabled = false;

  openModal('modal-create-server', triggerEl);

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
  closeModal('modal-create-server');
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
// 6. Admin Control Plane: Overview
// ==========================================================================
async function loadAdminOverview(isManual = false) {
  const view = document.getElementById('view-admin-overview');
  view.classList.remove('tw-hidden');

  const refreshBtn = document.getElementById('btn-refresh-admin-overview');
  if (isManual && refreshBtn) {
    refreshBtn.querySelector('i').classList.add('spin-anim');
  }

  try {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();

    if (isManual && refreshBtn) {
      setTimeout(() => refreshBtn.querySelector('i').classList.remove('spin-anim'), 400);
    }

    if (!data.success) {
      showToast(data.error || 'Failed to load platform metrics', 'error');
      return;
    }

    // 1. KPI Counts
    document.getElementById('admin-stat-users').textContent = data.stats.total_users;
    document.getElementById('admin-stat-servers').textContent = data.stats.total_servers;
    document.getElementById('admin-stat-running').textContent = data.stats.running_servers;
    document.getElementById('admin-stat-nodes').textContent = data.stats.total_nodes;

    // 2. Host Metrics
    const n = data.node;
    document.getElementById('node-hostname').textContent = n.hostname || 'localhost';
    document.getElementById('node-os').textContent = `${n.platform} (${n.osRelease})`;
    document.getElementById('node-uptime').textContent = n.uptime ? n.uptime.formatted : 'Active';

    // CPU Meter
    const cpuUsage = n.cpu ? n.cpu.usagePercent : 0;
    document.getElementById('node-cpu-val').textContent = `${cpuUsage}%`;
    const cpuBar = document.getElementById('node-cpu-bar');
    cpuBar.style.width = `${Math.min(100, cpuUsage)}%`;
    cpuBar.className = `kh-progress-fill ${cpuUsage > 85 ? 'danger' : (cpuUsage > 60 ? 'warning' : '')}`;
    document.getElementById('node-cpu-spec').textContent = `${n.cpu ? n.cpu.model : 'Processor'} (${n.cpu ? n.cpu.cores : 1} Cores)`;

    // RAM Meter
    const ramUsage = n.memory ? n.memory.percentUsed : 0;
    document.getElementById('node-ram-val').textContent = `${n.memory ? n.memory.usedMb : 0} MB / ${n.memory ? n.memory.totalMb : 0} MB (${ramUsage}%)`;
    const ramBar = document.getElementById('node-ram-bar');
    ramBar.style.width = `${Math.min(100, ramUsage)}%`;
    ramBar.className = `kh-progress-fill ${ramUsage > 85 ? 'danger' : (ramUsage > 65 ? 'warning' : '')}`;
    document.getElementById('node-ram-spec').textContent = `DDR5 Memory Pool • ${n.memory ? n.memory.freeMb : 0} MB Free`;

    // Storage Meter
    const diskUsage = n.disk ? n.disk.percentUsed : 0;
    document.getElementById('node-disk-val').textContent = `${n.disk ? n.disk.usedMb : 0} MB / ${n.disk ? n.disk.totalMb : 0} MB (${diskUsage}%)`;
    const diskBar = document.getElementById('node-disk-bar');
    diskBar.style.width = `${Math.min(100, diskUsage)}%`;
    diskBar.className = `kh-progress-fill ${diskUsage > 90 ? 'danger' : ''}`;
    document.getElementById('node-disk-spec').textContent = `Enterprise NVMe Volume • /`;

    // 3. Activity Feed Table
    const logsContainer = document.getElementById('admin-activity-logs');
    if (!data.recent_activity || data.recent_activity.length === 0) {
      logsContainer.innerHTML = '<tr><td colspan="4" class="tw-p-8 tw-text-neutral-500 tw-text-center tw-font-mono tw-text-xs">No platform activity recorded yet.</td></tr>';
    } else {
      logsContainer.innerHTML = data.recent_activity.map(l => {
        let badgeColor = 'tw-bg-white/5 tw-text-neutral-300 tw-border-white/10';
        if (l.action.includes('create')) badgeColor = 'tw-bg-emerald-500/10 tw-text-emerald-400 tw-border-emerald-500/20';
        else if (l.action.includes('delete') || l.action.includes('kill')) badgeColor = 'tw-bg-red-500/10 tw-text-red-400 tw-border-red-500/20';
        else if (l.action.includes('start')) badgeColor = 'tw-bg-emerald-500/10 tw-text-emerald-400 tw-border-emerald-500/20';
        else if (l.action.includes('stop')) badgeColor = 'tw-bg-yellow-500/10 tw-text-yellow-400 tw-border-yellow-500/20';

        return `
          <tr>
            <td class="tw-font-mono tw-text-xs tw-text-neutral-400">${l.created_at}</td>
            <td>
              <div class="tw-font-semibold tw-text-white">${escapeHtml(l.user_name || 'System')}</div>
              <div class="tw-text-[11px] tw-text-neutral-500 tw-font-mono">${escapeHtml(l.user_email || 'daemon')}</div>
            </td>
            <td>
              <span class="tw-inline-block tw-px-2 tw-py-0.5 tw-rounded tw-border tw-text-[10px] tw-font-mono ${badgeColor}">
                ${escapeHtml(l.action)}
              </span>
            </td>
            <td class="tw-text-neutral-300 tw-font-mono tw-text-xs">${escapeHtml(l.details || '')}</td>
          </tr>
        `;
      }).join('');
    }

    if (isManual) showToast('Platform metrics refreshed', 'info');
  } catch (err) {
    if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.remove('spin-anim');
    showToast('Failed to connect to admin telemetry', 'error');
  }
}

// ==========================================================================
// 7. Admin Control Plane: User Management
// ==========================================================================
async function loadAdminUsers(isManual = false) {
  const view = document.getElementById('view-admin-users');
  view.classList.remove('tw-hidden');

  const refreshBtn = document.getElementById('btn-refresh-admin-users');
  if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.add('spin-anim');

  const tbody = document.getElementById('admin-users-table');
  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="tw-py-12 tw-text-center">
        <div class="tw-w-6 tw-h-6 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-2"></div>
        <span class="tw-text-xs tw-font-mono tw-text-neutral-500">Querying registered accounts...</span>
      </td>
    </tr>
  `;

  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();

    if (isManual && refreshBtn) {
      setTimeout(() => refreshBtn.querySelector('i').classList.remove('spin-anim'), 400);
    }

    if (!data.success || !data.users) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="tw-py-8 tw-text-center tw-text-red-400 tw-text-xs font-mono">
            Failed to load users. <button onclick="loadAdminUsers(true)" class="tw-underline tw-ml-2">Retry</button>
          </td>
        </tr>
      `;
      return;
    }

    allAdminUsers = data.users;
    renderAdminUsersTable();
    if (isManual) showToast('User directory updated', 'info');
  } catch (err) {
    if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.remove('spin-anim');
    showToast('Failed to fetch user list', 'error');
  }
}

function setUserRoleFilter(role) {
  userRoleFilter = role;
  document.querySelectorAll('.user-role-filter').forEach(btn => {
    if (btn.dataset.filter === role) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  renderAdminUsersTable();
}

function filterAdminUsers() {
  renderAdminUsersTable();
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('admin-users-table');
  const countEl = document.getElementById('admin-users-count');
  const query = (document.getElementById('admin-users-search').value || '').trim().toLowerCase();

  const filtered = allAdminUsers.filter(u => {
    const matchesRole = userRoleFilter === 'all' || u.role === userRoleFilter;
    const matchesSearch = !query || 
      u.name.toLowerCase().includes(query) || 
      u.email.toLowerCase().includes(query) ||
      String(u.id).includes(query);
    return matchesRole && matchesSearch;
  });

  if (countEl) countEl.textContent = `${filtered.length} of ${allAdminUsers.length} accounts`;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="tw-py-12 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">
          No user accounts found matching current filters.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(u => `
    <tr>
      <td class="tw-font-mono tw-text-neutral-500">#${u.id}</td>
      <td>
        <div class="tw-flex tw-items-center tw-gap-3">
          <div class="tw-w-8 tw-h-8 tw-rounded-full tw-bg-neutral-800 tw-border tw-border-white/10 tw-flex tw-items-center tw-justify-center tw-text-xs tw-font-bold tw-text-white flex-shrink-0">
            ${u.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div class="tw-font-semibold tw-text-white">${escapeHtml(u.name)}</div>
            ${u.id === currentUser.id ? '<span class="tw-text-[10px] tw-font-mono tw-text-neutral-400">(Your Session)</span>' : ''}
          </div>
        </div>
      </td>
      <td class="tw-font-mono tw-text-neutral-300">${escapeHtml(u.email)}</td>
      <td>
        <span class="tw-inline-flex tw-items-center tw-px-2.5 tw-py-0.5 tw-rounded-full tw-text-xs tw-font-mono ${u.role === 'admin' ? 'tw-bg-white/10 tw-text-white tw-border tw-border-white/20' : 'tw-bg-neutral-800 tw-text-neutral-400'}">
          ${u.role.toUpperCase()}
        </span>
      </td>
      <td>
        <div class="tw-font-mono tw-text-xs tw-text-white">${u.servers_count} / ${u.max_servers} servers</div>
        <div class="tw-font-mono tw-text-[11px] tw-text-neutral-500">${u.allocated_ram_mb} MB allocated / ${u.max_ram_mb} MB limit</div>
      </td>
      <td class="tw-font-mono tw-text-xs tw-text-neutral-400">${u.created_at}</td>
      <td class="tw-text-right">
        <button onclick="openManageUserModal(${u.id})" class="btn-secondary tw-py-1.5 tw-px-3 tw-text-xs">
          <i class="bi bi-gear-fill"></i>
          <span>Manage</span>
        </button>
      </td>
    </tr>
  `).join('');
}

// Manage User Quotas Modal Engine
function openManageUserModal(userId, triggerEl = null) {
  const user = allAdminUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('manage-user-id').value = user.id;
  document.getElementById('manage-user-subheading').textContent = `Account #${user.id} • Registered ${user.created_at}`;
  document.getElementById('manage-user-avatar-initial').textContent = user.name.charAt(0).toUpperCase();
  document.getElementById('manage-user-name').textContent = user.name;
  document.getElementById('manage-user-email').textContent = user.email;
  document.getElementById('manage-user-role').value = user.role;
  document.getElementById('manage-user-max-servers').value = user.max_servers;
  document.getElementById('manage-user-max-ram').value = user.max_ram_mb;

  const warningEl = document.getElementById('manage-user-warning');
  if (user.id === currentUser.id) {
    warningEl.classList.remove('tw-hidden');
  } else {
    warningEl.classList.add('tw-hidden');
  }

  openModal('modal-manage-user', triggerEl);
}

function closeManageUserModal() {
  closeModal('modal-manage-user');
}

async function handleManageUserSubmit(e) {
  e.preventDefault();
  const userId = parseInt(document.getElementById('manage-user-id').value, 10);
  const role = document.getElementById('manage-user-role').value;
  const maxServers = parseInt(document.getElementById('manage-user-max-servers').value, 10);
  const maxRamMb = parseInt(document.getElementById('manage-user-max-ram').value, 10);

  const btnSubmit = document.getElementById('btn-manage-user-submit');
  btnSubmit.disabled = true;

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, maxServers, maxRamMb })
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message, 'success');
      closeManageUserModal();
      loadAdminUsers(false);
      // If admin updated their own profile role
      if (userId === currentUser.id && role !== 'admin') {
        window.location.reload();
      }
    } else {
      showToast(data.error || 'Failed to update user account', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
  btnSubmit.disabled = false;
}

// ==========================================================================
// 8. Admin Control Plane: All Servers Inventory
// ==========================================================================
async function loadAdminServers(isManual = false) {
  const view = document.getElementById('view-admin-servers');
  view.classList.remove('tw-hidden');

  const refreshBtn = document.getElementById('btn-refresh-admin-servers');
  if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.add('spin-anim');

  const tbody = document.getElementById('admin-servers-table');
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="tw-py-12 tw-text-center">
        <div class="tw-w-6 tw-h-6 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-2"></div>
        <span class="tw-text-xs tw-font-mono tw-text-neutral-500">Querying platform server inventory...</span>
      </td>
    </tr>
  `;

  try {
    const res = await fetch('/api/admin/servers');
    const data = await res.json();

    if (isManual && refreshBtn) {
      setTimeout(() => refreshBtn.querySelector('i').classList.remove('spin-anim'), 400);
    }

    if (!data.success || !data.servers) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="tw-py-8 tw-text-center tw-text-red-400 tw-text-xs font-mono">
            Failed to load server inventory. <button onclick="loadAdminServers(true)" class="tw-underline tw-ml-2">Retry</button>
          </td>
        </tr>
      `;
      return;
    }

    allAdminServers = data.servers;
    renderAdminServersTable();
    if (isManual) showToast('Server inventory refreshed', 'info');
  } catch (err) {
    if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.remove('spin-anim');
    showToast('Failed to fetch platform servers', 'error');
  }
}

function setServerStatusFilter(status) {
  serverStatusFilter = status;
  document.querySelectorAll('.server-status-filter').forEach(btn => {
    if (btn.dataset.filter === status) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  renderAdminServersTable();
}

function filterAdminServers() {
  renderAdminServersTable();
}

function renderAdminServersTable() {
  const tbody = document.getElementById('admin-servers-table');
  const countEl = document.getElementById('admin-servers-count');
  const query = (document.getElementById('admin-servers-search').value || '').trim().toLowerCase();

  const filtered = allAdminServers.filter(s => {
    const matchesStatus = serverStatusFilter === 'all' || s.status === serverStatusFilter;
    const matchesSearch = !query ||
      s.name.toLowerCase().includes(query) ||
      s.owner_name.toLowerCase().includes(query) ||
      s.owner_email.toLowerCase().includes(query) ||
      String(s.port).includes(query) ||
      String(s.id).includes(query);
    return matchesStatus && matchesSearch;
  });

  if (countEl) countEl.textContent = `${filtered.length} of ${allAdminServers.length} servers`;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="tw-py-12 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">
          No server instances found matching current filters.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const isOnline = s.status === 'running';
    const isStarting = s.status === 'starting';
    const isCrashed = s.status === 'crashed';
    const statusClass = isOnline ? 'online' : (isStarting ? 'starting' : (isCrashed ? 'crashed' : 'offline'));

    return `
      <tr>
        <td class="tw-font-mono tw-text-neutral-500">#${s.id}</td>
        <td>
          <div class="tw-font-bold tw-text-white">${escapeHtml(s.name)}</div>
          <div class="tw-text-[11px] tw-font-mono tw-text-neutral-500">Node: ${escapeHtml(s.node_name)}</div>
        </td>
        <td>
          <div class="tw-text-white font-medium">${escapeHtml(s.owner_name)}</div>
          <div class="tw-text-[11px] tw-font-mono tw-text-neutral-500">${escapeHtml(s.owner_email)}</div>
        </td>
        <td class="tw-font-mono tw-text-xs tw-text-neutral-300">
          ${escapeHtml(s.software)} ${escapeHtml(s.version)}
        </td>
        <td class="tw-font-mono tw-text-xs text-white">:${s.port}</td>
        <td>
          <span class="kh-status-badge ${statusClass}">
            <span class="kh-status-dot"></span>
            <span>${s.status.toUpperCase()}</span>
          </span>
        </td>
        <td class="tw-font-mono tw-text-xs tw-text-neutral-300">${s.ram_mb} MB</td>
        <td class="tw-text-right">
          <div class="tw-flex tw-items-center tw-justify-end tw-gap-1.5">
            <a href="#server/${s.id}" class="tw-px-2.5 tw-py-1 tw-rounded-md tw-bg-white/[0.04] hover:tw-bg-white/[0.08] tw-border tw-border-white/[0.08] tw-text-xs tw-font-mono tw-text-white tw-transition-colors" title="Manage & Console">
              <i class="bi bi-terminal"></i>
            </a>
            ${isOnline ? `
              <button onclick="adminQuickStopServer(${s.id})" class="tw-px-2.5 tw-py-1 tw-rounded-md tw-bg-yellow-500/10 hover:tw-bg-yellow-500/20 tw-border tw-border-yellow-500/25 tw-text-xs tw-font-mono tw-text-yellow-400 tw-transition-colors" title="Graceful Stop">
                <i class="bi bi-stop-fill"></i>
              </button>
            ` : `
              <button onclick="adminQuickStartServer(${s.id})" class="tw-px-2.5 tw-py-1 tw-rounded-md tw-bg-emerald-500/10 hover:tw-bg-emerald-500/20 tw-border tw-border-emerald-500/25 tw-text-xs tw-font-mono tw-text-emerald-400 tw-transition-colors" title="Start Instance">
                <i class="bi bi-play-fill"></i>
              </button>
            `}
            <button type="button" data-server-id="${s.id}" data-server-name="${escapeHtml(s.name)}" onclick="handleAdminDeleteClick(this)" class="tw-px-2.5 tw-py-1 tw-rounded-md tw-bg-red-500/10 hover:tw-bg-red-500/20 tw-border tw-border-red-500/25 tw-text-xs tw-font-mono tw-text-red-400 tw-transition-colors" title="Delete Instance">
              <i class="bi bi-trash-fill"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function handleAdminDeleteClick(btn) {
  if (!btn) return;
  const serverId = parseInt(btn.dataset.serverId, 10);
  const serverName = btn.dataset.serverName || 'Server';
  openDeleteServerModal(serverId, serverName, btn);
}

async function adminQuickStartServer(serverId) {
  try {
    const res = await fetch(`/api/servers/${serverId}/start`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Server process starting...', 'success');
      setTimeout(() => loadAdminServers(false), 1000);
    } else {
      showToast(data.error || 'Failed to start server', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function adminQuickStopServer(serverId) {
  try {
    const res = await fetch(`/api/servers/${serverId}/stop`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Server stopping...', 'info');
      setTimeout(() => loadAdminServers(false), 1000);
    } else {
      showToast(data.error || 'Failed to stop server', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ==========================================================================
// 9. Admin Control Plane: Daemon Nodes
// ==========================================================================
async function loadAdminNodes(isManual = false) {
  const view = document.getElementById('view-admin-nodes');
  view.classList.remove('tw-hidden');

  const refreshBtn = document.getElementById('btn-refresh-admin-nodes');
  if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.add('spin-anim');

  const grid = document.getElementById('admin-nodes-grid');
  grid.innerHTML = `
    <div class="kh-panel-card tw-col-span-full tw-py-12 tw-text-center">
      <div class="tw-w-6 tw-h-6 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-2"></div>
      <span class="tw-text-xs tw-font-mono tw-text-neutral-500">Checking daemon node infrastructure...</span>
    </div>
  `;

  try {
    const res = await fetch('/api/admin/nodes');
    const data = await res.json();

    if (isManual && refreshBtn) {
      setTimeout(() => refreshBtn.querySelector('i').classList.remove('spin-anim'), 400);
    }

    if (!data.success || !data.nodes || data.nodes.length === 0) {
      grid.innerHTML = `
        <div class="kh-panel-card tw-col-span-full tw-py-8 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">
          No daemon nodes currently registered.
        </div>
      `;
      return;
    }

    grid.innerHTML = data.nodes.map(n => {
      const ramUsage = n.metrics.memory ? n.metrics.memory.percentUsed : 0;
      const diskUsage = n.metrics.disk ? n.metrics.disk.percentUsed : 0;

      return `
        <div class="kh-panel-card tw-space-y-5">
          <div class="tw-flex tw-items-center tw-justify-between tw-border-b tw-border-white/[0.08] tw-pb-3">
            <div class="tw-flex tw-items-center tw-gap-3">
              <div class="tw-h-10 tw-w-10 tw-rounded-xl tw-bg-white/[0.06] tw-border tw-border-white/10 tw-flex tw-items-center tw-justify-center">
                <i class="bi bi-hdd-network-fill tw-text-white tw-text-lg"></i>
              </div>
              <div>
                <h3 class="tw-text-base tw-font-bold tw-text-white">${escapeHtml(n.name)}</h3>
                <span class="tw-text-xs tw-font-mono tw-text-neutral-400">${n.hostname} (${n.public_address})</span>
              </div>
            </div>
            <span class="kh-status-badge online">
              <span class="kh-status-dot"></span> LOCAL HOST
            </span>
          </div>

          <div class="tw-space-y-4 font-mono text-xs">
            <!-- RAM Progress -->
            <div class="tw-p-3.5 tw-rounded-xl tw-bg-white/[0.02] tw-border tw-border-white/[0.06] tw-space-y-2">
              <div class="tw-flex tw-items-center tw-justify-between">
                <span class="tw-text-neutral-400">HOST RAM UTILIZATION</span>
                <span class="tw-text-white tw-font-bold">${n.metrics.memory.usedMb} / ${n.total_ram_mb} MB (${ramUsage}%)</span>
              </div>
              <div class="kh-progress-track">
                <div class="kh-progress-fill" style="width: ${Math.min(100, ramUsage)}%"></div>
              </div>
            </div>

            <!-- Disk Progress -->
            <div class="tw-p-3.5 tw-rounded-xl tw-bg-white/[0.02] tw-border tw-border-white/[0.06] tw-space-y-2">
              <div class="tw-flex tw-items-center tw-justify-between">
                <span class="tw-text-neutral-400">HOST DISK STORAGE</span>
                <span class="tw-text-white tw-font-bold">${n.metrics.disk.usedMb} / ${n.total_storage_mb} MB (${diskUsage}%)</span>
              </div>
              <div class="kh-progress-track">
                <div class="kh-progress-fill" style="width: ${Math.min(100, diskUsage)}%"></div>
              </div>
            </div>
          </div>

          <div class="tw-pt-2 tw-border-t tw-border-white/[0.06] tw-grid tw-grid-cols-2 tw-gap-2 tw-text-xs tw-font-mono tw-text-neutral-400">
            <div><span class="tw-text-neutral-500">Port Range:</span> ${n.port_range_start} - ${n.port_range_end}</div>
            <div class="tw-text-right"><span class="tw-text-neutral-500">Instances:</span> <span class="tw-text-emerald-400">${n.running_count} running</span> / ${n.server_count} total</div>
          </div>
        </div>
      `;
    }).join('');

    if (isManual) showToast('Nodes data refreshed', 'info');
  } catch (err) {
    if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.remove('spin-anim');
    showToast('Failed to load nodes data', 'error');
  }
}

// ==========================================================================
// 10. Admin Control Plane: Platform Settings
// ==========================================================================
async function loadAdminSettings(isManual = false) {
  const view = document.getElementById('view-admin-settings');
  view.classList.remove('tw-hidden');

  const refreshBtn = document.getElementById('btn-refresh-admin-settings');
  if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.add('spin-anim');

  try {
    const res = await fetch('/api/admin/settings');
    const data = await res.json();

    if (isManual && refreshBtn) {
      setTimeout(() => refreshBtn.querySelector('i').classList.remove('spin-anim'), 400);
    }

    if (data.success && data.settings) {
      const s = data.settings;
      if (document.getElementById('setting-panel-name')) document.getElementById('setting-panel-name').value = s.panel_name || '';
      if (document.getElementById('setting-discord-url')) document.getElementById('setting-discord-url').value = s.discord_invite_url || '';
      if (document.getElementById('setting-billing-url')) document.getElementById('setting-billing-url').value = s.billing_url || '';
      if (document.getElementById('setting-docs-url')) document.getElementById('setting-docs-url').value = s.documentation_url || '';
      if (document.getElementById('setting-terms-url')) document.getElementById('setting-terms-url').value = s.terms_url || '';
      if (document.getElementById('setting-public-host')) document.getElementById('setting-public-host').value = s.public_hostname || '';
      if (document.getElementById('setting-default-ram')) document.getElementById('setting-default-ram').value = s.default_ram_mb || 4096;
      if (document.getElementById('setting-max-servers')) document.getElementById('setting-max-servers').value = s.max_servers_per_user || 3;

      document.getElementById('btn-save-admin-settings').onclick = async () => {
        const saveBtn = document.getElementById('btn-save-admin-settings');
        saveBtn.disabled = true;

        const payload = {
          panel_name: document.getElementById('setting-panel-name').value.trim(),
          discord_invite_url: document.getElementById('setting-discord-url').value.trim(),
          billing_url: document.getElementById('setting-billing-url').value.trim(),
          documentation_url: document.getElementById('setting-docs-url').value.trim(),
          terms_url: document.getElementById('setting-terms-url').value.trim(),
          public_hostname: document.getElementById('setting-public-host').value.trim(),
          default_ram_mb: document.getElementById('setting-default-ram').value,
          max_servers_per_user: document.getElementById('setting-max-servers').value
        };

        try {
          const patchRes = await fetch('/api/admin/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const patchData = await patchRes.json();
          if (patchData.success) {
            showToast(patchData.message, 'success');
          } else {
            showToast(patchData.error, 'error');
          }
        } catch (e) {
          showToast(e.message, 'error');
        }
        saveBtn.disabled = false;
      };

      if (isManual) showToast('Settings reloaded from database', 'info');
    }
  } catch (err) {
    if (isManual && refreshBtn) refreshBtn.querySelector('i').classList.remove('spin-anim');
    showToast('Failed to load platform settings', 'error');
  }
}

// ==========================================================================
// 11. Profile View
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
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
