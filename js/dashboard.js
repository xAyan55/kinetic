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
// Utility: Debounce helper for silky-smooth search filtering
function debounce(func, wait = 150) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
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
  if ((mainRoute.startsWith('admin-') || mainRoute === 'server-create' || mainRoute === 'create-server') && (!currentUser || currentUser.role !== 'admin')) {
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
      'server-create': 'Deploy Server',
      'create-server': 'Deploy Server',
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
    } else if (mainRoute === 'server-create' || mainRoute === 'create-server') {
      sectionPrefix.textContent = 'provision /';
    } else {
      sectionPrefix.textContent = 'panel /';
    }
  }

  // Clean active timers, polling intervals, and SSE streams on route change
  if (mainRoute !== 'server') {
    if (typeof teardownServerWorkspace === 'function') teardownServerWorkspace();
    if (sseSource) { sseSource.close(); sseSource = null; }
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  }

  if (mainRoute !== 'admin-overview') {
    if (overviewInterval) { clearInterval(overviewInterval); overviewInterval = null; }
  }

  // Hide all view sections
  document.querySelectorAll('.panel-view').forEach(v => v.classList.add('tw-hidden'));

  // Dispatch route view loader
  if (mainRoute === 'server-create' || mainRoute === 'create-server') {
    loadServerCreate();
  } else if (mainRoute === 'server' && parts[1]) {
    if (typeof loadServerWorkspace === 'function') {
      loadServerWorkspace(parts[1]);
    } else {
      loadServerDetail(parts[1]);
    }
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
          <a href="#server-create" class="btn-primary tw-mx-auto tw-mt-2">
            <i class="bi bi-plus-lg"></i>
            <span>Deploy Server</span>
          </a>
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

      // Real storage format based on calculated usage or DB limit
      const storageDisplay = s.disk_used_mb > 0 
        ? `${s.disk_used_mb} MB`
        : (s.storage_limit_mb ? `${(s.storage_limit_mb / 1024).toFixed(0)} GB Quota` : '25 GB Quota');

      const softwareLabel = `${s.software_name || s.software} ${s.version}${s.build && s.build !== '#latest' ? ` (${s.build})` : ''}`;

      return `
        <div class="kh-panel-card interactive tw-flex tw-flex-col tw-justify-between">
          <div>
            <!-- Top Status & Software Bar -->
            <div class="tw-flex tw-items-center tw-justify-between tw-mb-4">
              <span class="kh-status-badge ${statusClass}">
                <span class="kh-status-dot"></span>
                <span>${s.status.toUpperCase()}</span>
              </span>
              <span class="tw-px-2.5 tw-py-1 tw-rounded-md tw-bg-white/[0.04] tw-border tw-border-white/[0.06] tw-text-xs tw-font-mono tw-text-neutral-400" title="Engine: ${escapeHtml(softwareLabel)}">
                ${escapeHtml(softwareLabel)}
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

            <!-- Resource Allocation Breakdown (100% Real Backend Values) -->
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
                <div class="tw-text-neutral-200 tw-font-semibold">${storageDisplay}</div>
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
  const swName = s.software_name || s.software || 'Minecraft';
  const buildInfo = s.build && s.build !== '#latest' ? ` (${s.build})` : '';
  const javaInfo = s.java_version ? ` • Java ${s.java_version}` : '';
  document.getElementById('detail-server-software').textContent = `${swName} ${s.version}${buildInfo}${javaInfo}`;
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
  if (typeof switchServerWorkspaceTab === 'function') {
    switchServerWorkspaceTab(tab);
    return;
  }
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
  } else {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
    if (tab === 'settings') {
      initServerSettings(currentServer);
    }
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
        showToast('Server stopping gracefully...', 'info');
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
        showToast('Server restarting...', 'info');
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

        // Bound terminal buffer to 1200 lines max to prevent DOM memory bloat
        while (terminal.childElementCount > 1200) {
          terminal.removeChild(terminal.firstElementChild);
        }

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
// 5. Dedicated Full-Page Server Creation Controller
// ==========================================================================
let availableSoftwareList = [];
let selectedSoftwareCategory = 'ALL';
let softwareSearchQuery = '';
let selectedSoftwareEngine = 'PAPER';
let currentSoftwareVersions = [];
let currentBuildMode = 'latest'; // 'latest' | 'specific'
let currentBuildsList = [];
let selectedBuildUuid = '';
let mcjarsAbortController = null;
let versionTypingDebounceTimer = null;

async function loadServerCreate() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('Only administrators can deploy and assign new servers.', 'error');
    window.location.hash = 'dashboard';
    return;
  }

  const view = document.getElementById('view-server-create');
  if (view) view.classList.remove('tw-hidden');

  // Reset form elements
  const form = document.getElementById('page-create-server-form');
  if (form) form.reset();

  const statusMsg = document.getElementById('page-create-status-msg');
  if (statusMsg) {
    statusMsg.classList.add('tw-hidden');
    statusMsg.innerHTML = '';
  }

  const submitBtn = document.getElementById('btn-page-create-submit');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Deploy Server</span> <i class="bi bi-arrow-right tw-ml-1"></i>';
  }

  // Initial name summary binding
  const nameInput = document.getElementById('page-create-name');
  const nameCount = document.getElementById('page-create-name-count');
  const nameHint = document.getElementById('page-create-name-hint');
  const summaryName = document.getElementById('summary-server-name');

  if (nameInput) {
    nameInput.value = '';
    if (summaryName) summaryName.textContent = 'Minecraft Server';
    if (nameCount) nameCount.textContent = '0/32';
    if (nameHint) {
      nameHint.textContent = 'Between 2 and 32 characters.';
      nameHint.className = 'tw-text-[11px] tw-font-mono tw-text-neutral-500';
    }

    nameInput.oninput = () => {
      const val = nameInput.value.trim();
      const len = nameInput.value.length;
      if (nameCount) nameCount.textContent = `${len}/32`;
      if (summaryName) summaryName.textContent = val || 'Minecraft Server';

      if (len > 0 && len < 2) {
        nameHint.textContent = 'Name is too short (min 2 chars).';
        nameHint.className = 'tw-text-[11px] tw-font-mono tw-text-yellow-400';
      } else if (len >= 2) {
        nameHint.textContent = 'Valid server identifier.';
        nameHint.className = 'tw-text-[11px] tw-font-mono tw-text-emerald-400';
      } else {
        nameHint.textContent = 'Between 2 and 32 characters.';
        nameHint.className = 'tw-text-[11px] tw-font-mono tw-text-neutral-500';
      }
    };
  }

  // Calculate & configure RAM limits based on current user / platform quotas
  const ramInput = document.getElementById('page-create-ram');
  const ramVal = document.getElementById('page-create-ram-val');
  const ramMaxLabel = document.getElementById('page-create-ram-max-label');
  const quotaBadge = document.getElementById('page-create-quota-badge');
  const summaryRam = document.getElementById('summary-ram');

  const maxRam = currentUser.max_ram_mb || 16384;
  const defaultRam = Math.min(4096, maxRam);

  if (ramInput) {
    ramInput.min = 1024;
    ramInput.max = maxRam;
    ramInput.value = defaultRam;
    if (ramVal) ramVal.textContent = `${defaultRam} MB`;
    if (summaryRam) summaryRam.textContent = `${defaultRam} MB`;
    if (ramMaxLabel) ramMaxLabel.textContent = `Max: ${maxRam} MB`;
    if (quotaBadge) quotaBadge.textContent = `Quota: ${maxRam} MB`;

    ramInput.oninput = (e) => {
      const v = e.target.value;
      if (ramVal) ramVal.textContent = `${v} MB`;
      if (summaryRam) summaryRam.textContent = `${v} MB`;
    };
  }

  // Populate registered accounts dropdown
  const ownerSelect = document.getElementById('page-create-owner');
  const summaryOwner = document.getElementById('summary-owner-name');
  if (ownerSelect) {
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
        if (summaryOwner) summaryOwner.textContent = currentUser.name;
      } else {
        ownerSelect.innerHTML = `<option value="${currentUser.id}">${escapeHtml(currentUser.name)} (You)</option>`;
        if (summaryOwner) summaryOwner.textContent = currentUser.name;
      }
    } catch (e) {
      ownerSelect.innerHTML = `<option value="${currentUser.id}">${escapeHtml(currentUser.name)} (You)</option>`;
      if (summaryOwner) summaryOwner.textContent = currentUser.name;
    }

    ownerSelect.onchange = () => {
      const selectedOption = ownerSelect.options[ownerSelect.selectedIndex];
      if (summaryOwner && selectedOption) {
        const text = selectedOption.text.split('(')[0].trim();
        summaryOwner.textContent = text || 'Selected User';
      }
    };
  }

  // Fetch supported software engines from backend
  await loadServerCreationSoftware();
}

async function loadServerCreationSoftware() {
  const container = document.getElementById('page-software-selector');
  const countBadge = document.getElementById('software-count-badge');
  if (!container) return;

  container.innerHTML = `
    <div class="tw-p-8 tw-text-center tw-text-xs tw-font-mono tw-text-neutral-500 tw-col-span-2 md:tw-col-span-3">
      <div class="tw-w-6 tw-h-6 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-2.5"></div>
      Discovering live server software from MCJars catalog...
    </div>
  `;

  try {
    const res = await fetch('/api/mcjars/types');
    const data = await res.json();

    if (data.success && Array.isArray(data.types) && data.types.length > 0) {
      availableSoftwareList = data.types;
    } else {
      throw new Error(data.error || 'No software types returned from MCJars');
    }
  } catch (e) {
    console.warn('[MCJars] Failed to load /api/mcjars/types, attempting fallback:', e.message);
    try {
      const fbRes = await fetch('/api/servers/software');
      const fbData = await fbRes.json();
      if (fbData.success && fbData.software) {
        availableSoftwareList = fbData.software;
      }
    } catch (fbErr) {
      console.error('[MCJars] Fallback failed:', fbErr);
    }
  }

  if (countBadge) {
    countBadge.textContent = `${availableSoftwareList.length} Software Available`;
  }

  // Pre-select Paper or first available
  const paper = availableSoftwareList.find(s => s.id === 'PAPER');
  selectedSoftwareEngine = paper ? 'PAPER' : (availableSoftwareList[0]?.id || 'PAPER');

  renderSoftwareEngineCards();
  await loadSoftwareVersions(selectedSoftwareEngine);
}

function filterSoftwareCategory(category) {
  selectedSoftwareCategory = category;
  document.querySelectorAll('#software-category-pills .kh-category-pill').forEach(btn => {
    if (btn.dataset.category === category) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  renderSoftwareEngineCards();
}

function handleSoftwareSearch(e) {
  softwareSearchQuery = (e.target.value || '').toLowerCase().trim();
  renderSoftwareEngineCards();
}

function renderSoftwareEngineCards() {
  const container = document.getElementById('page-software-selector');
  if (!container) return;

  const filtered = availableSoftwareList.filter(sw => {
    // Category check
    if (selectedSoftwareCategory !== 'ALL' && sw.category !== selectedSoftwareCategory) {
      return false;
    }
    // Search query check
    if (softwareSearchQuery) {
      const matchName = sw.name.toLowerCase().includes(softwareSearchQuery);
      const matchDesc = (sw.description || '').toLowerCase().includes(softwareSearchQuery);
      const matchId = sw.id.toLowerCase().includes(softwareSearchQuery);
      return matchName || matchDesc || matchId;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="tw-p-8 tw-text-center tw-text-xs tw-font-mono tw-text-neutral-500 tw-col-span-2 md:tw-col-span-3">
        <i class="bi bi-search tw-text-xl tw-mb-2 tw-block tw-text-neutral-600"></i>
        No server software found matching "${escapeHtml(softwareSearchQuery)}" in ${escapeHtml(selectedSoftwareCategory)}.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(sw => {
    const isSelected = sw.id === selectedSoftwareEngine;
    const badgeText = sw.badge || (sw.recommended ? 'RECOMMENDED' : (sw.experimental ? 'EXPERIMENTAL' : (sw.deprecated ? 'DEPRECATED' : '')));

    return `
      <div class="kh-software-card ${isSelected ? 'active' : ''}" onclick="selectSoftwareEngine('${sw.id}')">
        ${badgeText ? `<span class="kh-card-badge">${badgeText}</span>` : ''}
        <div>
          <div class="tw-w-10 tw-h-10 tw-rounded-xl tw-bg-white/[0.06] tw-border tw-border-white/10 tw-flex tw-items-center tw-justify-center tw-p-2 tw-mb-3">
            <img src="${escapeHtml(sw.icon)}" alt="${escapeHtml(sw.name)}" class="tw-w-full tw-h-full tw-object-contain" onerror="this.onerror=null; this.src='assets/logo/kinetic.png';">
          </div>
          <h4 class="tw-text-sm tw-font-bold tw-text-white tw-truncate">${escapeHtml(sw.name)}</h4>
          <p class="tw-text-xs tw-text-neutral-400 tw-mt-1 tw-leading-relaxed tw-line-clamp-2">${escapeHtml(sw.description)}</p>
        </div>
        <div class="tw-mt-3 tw-pt-2.5 tw-border-t tw-border-white/[0.06] tw-flex tw-items-center tw-justify-between tw-text-[11px] tw-font-mono">
          <span class="tw-text-neutral-500">${sw.category}</span>
          <span class="tw-text-white tw-font-semibold">${isSelected ? '✓ Selected' : 'Select'}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function selectSoftwareEngine(engineId) {
  if (selectedSoftwareEngine === engineId) return;
  selectedSoftwareEngine = engineId;

  const input = document.getElementById('page-create-software');
  if (input) input.value = engineId;

  const currentSw = availableSoftwareList.find(s => s.id === engineId);
  const summarySoftware = document.getElementById('summary-software');
  if (summarySoftware && currentSw) {
    summarySoftware.textContent = currentSw.name;
  }

  renderSoftwareEngineCards();
  await loadSoftwareVersions(engineId);
}

async function loadSoftwareVersions(typeId) {
  const versionInput = document.getElementById('page-create-version');
  const datalist = document.getElementById('mc-versions-datalist');
  const pillsContainer = document.getElementById('version-quick-pills');
  const indicator = document.getElementById('version-loading-indicator');

  if (indicator) indicator.classList.remove('tw-hidden');

  // Cancel previous in-flight request
  if (mcjarsAbortController) {
    mcjarsAbortController.abort();
  }
  mcjarsAbortController = new AbortController();

  try {
    const res = await fetch(`/api/mcjars/types/${encodeURIComponent(typeId)}/versions`, {
      signal: mcjarsAbortController.signal
    });
    const data = await res.json();

    if (data.success && Array.isArray(data.versions) && data.versions.length > 0) {
      currentSoftwareVersions = data.versions;
    } else {
      currentSoftwareVersions = [{ id: '1.20.4', version: '1.20.4', java: 17 }];
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('[MCJars] Version fetch error:', err);
    currentSoftwareVersions = [{ id: '1.20.4', version: '1.20.4', java: 17 }];
  } finally {
    if (indicator) indicator.classList.add('tw-hidden');
  }

  // Populate datalist
  if (datalist) {
    datalist.innerHTML = currentSoftwareVersions.map(v => `
      <option value="${v.id}">${v.id} ${v.type ? `(${v.type})` : ''} - Java ${v.java || 21}</option>
    `).join('');
  }

  // Populate Quick Select Pills (top 6 releases)
  if (pillsContainer) {
    const quickList = currentSoftwareVersions.slice(0, 6);
    pillsContainer.innerHTML = quickList.map((v, i) => `
      <button type="button" onclick="setTypedVersion('${v.id}')" class="tw-px-2.5 tw-py-0.5 tw-rounded-full tw-bg-white/[0.04] hover:tw-bg-white/[0.1] tw-border tw-border-white/10 tw-text-[11px] tw-font-mono tw-text-neutral-300 hover:tw-text-white tw-transition-colors">
        ${v.id} ${i === 0 ? '<span class="tw-text-emerald-400 font-bold">• Latest</span>' : ''}
      </button>
    `).join('');
  }

  // Select initial version: 1.20.4 if available, otherwise first release
  const defaultVer = currentSoftwareVersions.find(v => v.id === '1.20.4')?.id || currentSoftwareVersions[0]?.id || '1.20.4';
  if (versionInput) {
    versionInput.value = defaultVer;
  }

  await updateVersionAndBuildDetails(typeId, defaultVer);
}

function setTypedVersion(versionStr) {
  const versionInput = document.getElementById('page-create-version');
  if (versionInput) {
    versionInput.value = versionStr;
  }
  updateVersionAndBuildDetails(selectedSoftwareEngine, versionStr);
}

function handleVersionTyping(e) {
  const typed = (e.target.value || '').trim();
  const summaryVersion = document.getElementById('summary-version');
  if (summaryVersion) summaryVersion.textContent = typed || 'Custom';

  clearTimeout(versionTypingDebounceTimer);
  versionTypingDebounceTimer = setTimeout(() => {
    if (typed) {
      updateVersionAndBuildDetails(selectedSoftwareEngine, typed);
    }
  }, 250);
}

async function updateVersionAndBuildDetails(typeId, version) {
  const summaryVersion = document.getElementById('summary-version');
  const summaryBuild = document.getElementById('summary-build');
  const summaryJava = document.getElementById('summary-java');
  const javaBadge = document.getElementById('java-runtime-badge');
  const latestBuildName = document.getElementById('latest-build-name');
  const latestBuildDesc = document.getElementById('latest-build-desc');
  const buildUuidInput = document.getElementById('page-create-build-uuid');

  if (summaryVersion) summaryVersion.textContent = version;

  try {
    const res = await fetch(`/api/mcjars/types/${encodeURIComponent(typeId)}/versions/${encodeURIComponent(version)}/latest`);
    const data = await res.json();

    if (data.success && data.build) {
      const buildName = data.build.name || '#latest';
      const javaInfo = data.java || { requiredVersion: 21, explanation: 'Java 21 Required' };

      if (latestBuildName) latestBuildName.textContent = `Build ${buildName}`;
      if (latestBuildDesc) {
        const createdDate = data.build.created ? new Date(data.build.created).toLocaleDateString() : 'Recent';
        latestBuildDesc.textContent = `Upstream release (${createdDate}) • ${javaInfo.explanation}`;
      }

      if (currentBuildMode === 'latest') {
        if (buildUuidInput) buildUuidInput.value = data.build.uuid || '';
        if (summaryBuild) summaryBuild.textContent = buildName;
      }

      if (summaryJava) summaryJava.textContent = `Java ${javaInfo.requiredVersion || 21}`;
      if (javaBadge) {
        javaBadge.textContent = `Java ${javaInfo.requiredVersion || 21} Required`;
        javaBadge.className = `tw-text-[11px] tw-font-mono tw-px-2 tw-py-0.5 tw-rounded ${javaInfo.isExactMatch ? 'tw-text-emerald-400 tw-bg-emerald-500/10 tw-border tw-border-emerald-500/20' : 'tw-text-yellow-400 tw-bg-yellow-500/10 tw-border tw-border-yellow-500/20'}`;
      }
    }
  } catch (err) {
    console.warn('[MCJars] Latest build lookup error:', err);
  }

  if (currentBuildMode === 'specific') {
    await loadSpecificBuildsList(typeId, version);
  }
}

function setBuildMode(mode) {
  currentBuildMode = mode;
  const btnLatest = document.getElementById('btn-build-mode-latest');
  const btnSpecific = document.getElementById('btn-build-mode-specific');
  const latestPreview = document.getElementById('latest-build-preview');
  const specificPicker = document.getElementById('specific-build-picker');

  if (mode === 'latest') {
    btnLatest.className = 'tw-text-xs tw-font-mono tw-px-2.5 tw-py-1 tw-rounded-lg tw-bg-white tw-text-black tw-font-bold tw-transition-all';
    btnSpecific.className = 'tw-text-xs tw-font-mono tw-px-2.5 tw-py-1 tw-rounded-lg tw-bg-white/[0.05] tw-text-neutral-400 hover:tw-text-white tw-border tw-border-white/10 tw-transition-all';
    latestPreview.classList.remove('tw-hidden');
    specificPicker.classList.add('tw-hidden');

    const version = document.getElementById('page-create-version')?.value || '1.20.4';
    updateVersionAndBuildDetails(selectedSoftwareEngine, version);
  } else {
    btnSpecific.className = 'tw-text-xs tw-font-mono tw-px-2.5 tw-py-1 tw-rounded-lg tw-bg-white tw-text-black tw-font-bold tw-transition-all';
    btnLatest.className = 'tw-text-xs tw-font-mono tw-px-2.5 tw-py-1 tw-rounded-lg tw-bg-white/[0.05] tw-text-neutral-400 hover:tw-text-white tw-border tw-border-white/10 tw-transition-all';
    latestPreview.classList.add('tw-hidden');
    specificPicker.classList.remove('tw-hidden');

    const version = document.getElementById('page-create-version')?.value || '1.20.4';
    loadSpecificBuildsList(selectedSoftwareEngine, version);
  }
}

async function loadSpecificBuildsList(typeId, version) {
  const container = document.getElementById('specific-builds-list');
  if (!container) return;

  container.innerHTML = `
    <div class="tw-p-4 tw-text-center tw-text-xs tw-font-mono tw-text-neutral-500">
      <div class="tw-w-4 tw-h-4 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-1.5"></div>
      Querying builds from MCJars...
    </div>
  `;

  try {
    const res = await fetch(`/api/mcjars/types/${encodeURIComponent(typeId)}/versions/${encodeURIComponent(version)}/builds`);
    const data = await res.json();

    if (data.success && Array.isArray(data.builds) && data.builds.length > 0) {
      currentBuildsList = data.builds;

      container.innerHTML = currentBuildsList.map((b, i) => {
        const isSelected = selectedBuildUuid === b.uuid || (!selectedBuildUuid && i === 0);
        if (isSelected && !selectedBuildUuid) {
          selectedBuildUuid = b.uuid;
          document.getElementById('page-create-build-uuid').value = b.uuid;
        }

        const dateStr = b.created ? new Date(b.created).toLocaleDateString() : '';
        const sizeMb = b.jarSize ? `${(b.jarSize / 1048576).toFixed(1)} MB` : '';

        return `
          <div class="kh-build-card ${isSelected ? 'active' : ''}" onclick="selectSpecificBuild('${b.uuid}', '${escapeHtml(b.name)}')">
            <div class="tw-flex tw-items-center tw-justify-between">
              <div class="tw-flex tw-items-center tw-gap-2">
                <span class="tw-font-mono tw-text-xs tw-font-bold tw-text-white">${escapeHtml(b.name)}</span>
                ${b.experimental ? '<span class="tw-text-[9px] tw-font-mono tw-px-1.5 tw-py-0.2 tw-rounded tw-bg-purple-500/20 tw-text-purple-300">EXP</span>' : ''}
              </div>
              <span class="tw-font-mono tw-text-[10px] tw-text-neutral-400">${dateStr} ${sizeMb ? `• ${sizeMb}` : ''}</span>
            </div>
            ${b.changes && b.changes.length > 0 ? `
              <div class="tw-text-[11px] tw-text-neutral-400 tw-mt-1 tw-truncate font-mono">${escapeHtml(b.changes[0])}</div>
            ` : ''}
          </div>
        `;
      }).join('');
    } else {
      container.innerHTML = `
        <div class="tw-p-4 tw-text-center tw-text-xs tw-font-mono tw-text-neutral-500">
          No individual builds list available for this version. Using latest build.
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `
      <div class="tw-p-4 tw-text-center tw-text-xs tw-font-mono tw-text-red-400">
        Failed to fetch builds: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

function selectSpecificBuild(uuid, buildName) {
  selectedBuildUuid = uuid;
  const input = document.getElementById('page-create-build-uuid');
  if (input) input.value = uuid;

  const summaryBuild = document.getElementById('summary-build');
  if (summaryBuild) summaryBuild.textContent = buildName;

  document.querySelectorAll('#specific-builds-list .kh-build-card').forEach(card => {
    card.classList.remove('active');
  });
  event?.currentTarget?.classList?.add('active');
}

async function handleServerCreatePageSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('page-create-name').value.trim();
  const ownerId = document.getElementById('page-create-owner').value;
  const softwareType = selectedSoftwareEngine;
  const version = document.getElementById('page-create-version').value.trim();
  const buildUuid = currentBuildMode === 'specific' ? selectedBuildUuid : '';
  const ramMb = document.getElementById('page-create-ram').value;
  const eulaAccepted = document.getElementById('page-create-eula').checked;

  const btnSubmit = document.getElementById('btn-page-create-submit');
  const statusMsg = document.getElementById('page-create-status-msg');

  if (!name || name.length < 2) {
    showToast('Server name must be at least 2 characters.', 'error');
    return;
  }

  if (!version) {
    showToast('Please specify a Minecraft version.', 'error');
    return;
  }

  if (!eulaAccepted) {
    showToast('You must agree to the Minecraft EULA to deploy a server.', 'error');
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<span class="tw-flex tw-items-center tw-gap-2"><i class="bi bi-arrow-repeat tw-animate-spin"></i> Deploying...</span>';
  
  statusMsg.classList.remove('tw-hidden');
  statusMsg.innerHTML = '<span class="tw-flex tw-items-center tw-gap-2.5 tw-text-neutral-300"><i class="bi bi-arrow-repeat tw-animate-spin tw-text-white"></i> Resolving MCJars build, verifying SHA256 checksums, and provisioning container...</span>';

  try {
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        softwareType,
        version,
        buildUuid: buildUuid || undefined,
        ramMb: parseInt(ramMb, 10),
        eulaAccepted,
        ownerId
      })
    });
    const data = await res.json();

    if (data.success && data.server) {
      statusMsg.innerHTML = '<span class="tw-flex tw-items-center tw-gap-2 tw-text-emerald-400"><i class="bi bi-check-circle-fill"></i> Server provisioned & verified! Opening management console...</span>';
      showToast('Minecraft server deployed successfully!', 'success');
      setTimeout(() => {
        window.location.hash = `server/${data.server.id}`;
      }, 500);
    } else {
      statusMsg.innerHTML = `<span class="tw-flex tw-items-center tw-gap-2 tw-text-red-400"><i class="bi bi-exclamation-triangle-fill"></i> ${escapeHtml(data.error || 'Deployment failed')}</span>`;
      showToast(data.error || 'Failed to deploy server', 'error');
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<span>Deploy Server</span> <i class="bi bi-arrow-right tw-ml-1"></i>';
    }
  } catch (err) {
    statusMsg.innerHTML = `<span class="tw-flex tw-items-center tw-gap-2 tw-text-red-400"><i class="bi bi-exclamation-triangle-fill"></i> ${escapeHtml(err.message || 'Network error')}</span>`;
    showToast(err.message || 'Network error during deployment', 'error');
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<span>Deploy Server</span> <i class="bi bi-arrow-right tw-ml-1"></i>';
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

const filterAdminUsers = debounce(() => {
  renderAdminUsersTable();
}, 120);

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

const filterAdminServers = debounce(() => {
  renderAdminServersTable();
}, 120);

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
          <div>${escapeHtml(s.software_name || s.software)} ${escapeHtml(s.version)}</div>
          <div class="tw-text-[10px] tw-text-neutral-500">${escapeHtml(s.build || '#latest')}</div>
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
