// KineticHost Interactive Scripts, Header Navigation & Panel Simulator

// Header Scroll & Dynamic Backdrop Blur
function initHeaderScroll() {
  const header = document.getElementById('main-header');
  if (!header) return;

  const onScroll = () => {
    if (window.scrollY > 10) {
      header.classList.add('kh-header-scrolled');
    } else {
      header.classList.remove('kh-header-scrolled');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// Mobile Navigation Toggle
let isMobileNavOpen = false;

function toggleMobileNav(forceState) {
  const drawer = document.getElementById('mobile-menu-drawer');
  const btn = document.getElementById('mobile-menu-btn');
  const path = document.getElementById('menu-toggle-path');
  const svg = document.getElementById('menu-toggle-svg');

  if (!drawer) return;

  if (typeof forceState === 'boolean') {
    isMobileNavOpen = forceState;
  } else {
    isMobileNavOpen = !isMobileNavOpen;
  }

  if (isMobileNavOpen) {
    drawer.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (svg) svg.classList.add('-tw-rotate-45');
    if (path) {
      path.style.strokeDasharray = '20 300';
      path.style.strokeDashoffset = '-32.42px';
    }
    document.body.style.overflow = 'hidden';
  } else {
    drawer.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (svg) svg.classList.remove('-tw-rotate-45');
    if (path) {
      path.style.strokeDasharray = '12 63';
      path.style.strokeDashoffset = '0px';
    }
    document.body.style.overflow = '';
  }
}

// Handle window resize for mobile drawer
window.addEventListener('resize', () => {
  if (window.innerWidth >= 768 && isMobileNavOpen) {
    toggleMobileNav(false);
  }
});

// FAQ Accordion Toggle Functionality
function initFaqAccordion() {
  const faqBtns = document.querySelectorAll('.kh-faq-btn');
  faqBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const faqItem = btn.closest('.kh-faq-item');
      const isActive = faqItem.classList.contains('active');

      // Close other items for clean single-open behavior
      document.querySelectorAll('.kh-faq-item').forEach(item => {
        item.classList.remove('active');
      });

      if (!isActive) {
        faqItem.classList.add('active');
      }
    });
  });
}

// Control Panel Interactive Tab Switcher
const PANEL_IMAGES = {
  console: './assets/images/panels/console.jpg',
  files: './assets/images/panels/file-manager.jpg',
  mods: './assets/images/panels/mod-installer.jpg',
  users: './assets/images/panels/sub-user.jpg'
};

function switchPanelTab(tabName) {
  const panelImg = document.getElementById('panel-display-img');
  const tabBtns = document.querySelectorAll('.kh-panel-tab');

  if (panelImg && PANEL_IMAGES[tabName]) {
    panelImg.style.opacity = '0.4';
    setTimeout(() => {
      panelImg.src = PANEL_IMAGES[tabName];
      panelImg.style.opacity = '0.95';
    }, 150);
  }

  tabBtns.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('tw-bg-white/10', 'tw-text-white', 'tw-border-white/20');
      btn.classList.remove('tw-text-neutral-400', 'tw-border-transparent');
    } else {
      btn.classList.remove('tw-bg-white/10', 'tw-text-white', 'tw-border-white/20');
      btn.classList.add('tw-text-neutral-400', 'tw-border-transparent');
    }
  });
}

// Panel Power Action Simulator
function simulateServerAction(action) {
  const statusText = document.getElementById('server-status-badge');
  const dotText = document.getElementById('server-status-dot');

  if (!statusText || !dotText) return;

  if (action === 'start') {
    statusText.innerText = 'ONLINE (PORT 25565)';
    statusText.className = 'tw-text-xs tw-font-mono tw-text-neutral-200 tw-font-semibold';
    dotText.style.backgroundColor = '#E5E5E5';
    dotText.style.boxShadow = '0 0 6px rgba(255, 255, 255, 0.4)';
  } else if (action === 'restart') {
    statusText.innerText = 'RESTARTING...';
    statusText.className = 'tw-text-xs tw-font-mono tw-text-neutral-400 tw-font-semibold';
    dotText.style.backgroundColor = '#A1A1A1';
    dotText.style.boxShadow = 'none';
    setTimeout(() => {
      simulateServerAction('start');
    }, 1800);
  } else if (action === 'stop') {
    statusText.innerText = 'OFFLINE';
    statusText.className = 'tw-text-xs tw-font-mono tw-text-neutral-500 tw-font-semibold';
    dotText.style.backgroundColor = '#555555';
    dotText.style.boxShadow = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initHeaderScroll();
  initFaqAccordion();

  // Attach click listeners to panel tabs
  const tabBtns = document.querySelectorAll('.kh-panel-tab');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchPanelTab(btn.dataset.tab);
    });
  });

  // Initialize BlurText scroll animations
  if (typeof initBlurText === 'function') {
    initBlurText();
  }
});
