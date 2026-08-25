// KineticHost Interactive Scripts & Panel Simulator

const RESPONSIVE_WIDTH = 1024

let isHeaderCollapsed = window.innerWidth < RESPONSIVE_WIDTH
const collapseBtn = document.getElementById("collapse-btn")
const collapseHeaderItems = document.getElementById("collapsed-header-items")

function onHeaderClickOutside(e) {
    if (collapseHeaderItems && !collapseHeaderItems.contains(e.target) && collapseBtn && !collapseBtn.contains(e.target)) {
        toggleHeader()
    }
}

function toggleHeader() {
    if (!collapseHeaderItems || !collapseBtn) return;

    if (isHeaderCollapsed) {
        collapseHeaderItems.classList.add("opacity-100")
        collapseHeaderItems.style.width = "75vw"
        collapseBtn.classList.remove("bi-list")
        collapseBtn.classList.add("bi-x", "max-lg:tw-fixed")
        isHeaderCollapsed = false

        setTimeout(() => window.addEventListener("click", onHeaderClickOutside), 10)
    } else {
        collapseHeaderItems.classList.remove("opacity-100")
        collapseHeaderItems.style.width = "0vw"
        collapseBtn.classList.remove("bi-x", "max-lg:tw-fixed")
        collapseBtn.classList.add("bi-list")
        isHeaderCollapsed = true
        window.removeEventListener("click", onHeaderClickOutside)
    }
}

function responsive() {
    if (!collapseHeaderItems) return;
    if (window.innerWidth >= RESPONSIVE_WIDTH) {
        collapseHeaderItems.style.width = ""
        isHeaderCollapsed = true;
    }
}

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
}

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

// Panel Power Action Simulator - Restrained Monochrome/Neutral Status Indicators
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

document.addEventListener("DOMContentLoaded", () => {
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

window.addEventListener("resize", responsive)
