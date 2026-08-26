/**
 * Console Tab Controller
 * High-performance bounded log renderer with command history and shortcuts.
 */
const ConsoleTabController = {
  serverId: null,
  autoScroll: true,
  commandHistory: [],
  historyIndex: -1,
  maxDomLines: 300,

  mount(serverId) {
    this.serverId = serverId;
    this.setupListeners();
    this.scrollToBottom();
  },

  setupListeners() {
    const input = document.getElementById('console-input');
    const btnSend = document.getElementById('btn-send-command');
    const btnClear = document.getElementById('btn-clear-console');
    const autoScrollToggle = document.getElementById('chk-autoscroll');
    const output = document.getElementById('console-output');

    if (input) {
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submitCommand();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.commandHistory.length === 0) return;
          if (this.historyIndex < this.commandHistory.length - 1) {
            this.historyIndex++;
            input.value = this.commandHistory[this.commandHistory.length - 1 - this.historyIndex];
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (this.historyIndex > 0) {
            this.historyIndex--;
            input.value = this.commandHistory[this.commandHistory.length - 1 - this.historyIndex];
          } else if (this.historyIndex === 0) {
            this.historyIndex = -1;
            input.value = '';
          }
        } else if (e.ctrlKey && e.key === 'l') {
          e.preventDefault();
          this.clearConsole();
        }
      };
    }

    if (btnSend) {
      btnSend.onclick = () => this.submitCommand();
    }

    if (btnClear) {
      btnClear.onclick = () => this.clearConsole();
    }

    if (autoScrollToggle) {
      autoScrollToggle.onchange = (e) => {
        this.autoScroll = e.target.checked;
        if (this.autoScroll) this.scrollToBottom();
      };
    }

    if (output) {
      output.onscroll = () => {
        const isNearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
        if (autoScrollToggle) {
          autoScrollToggle.checked = isNearBottom;
          this.autoScroll = isNearBottom;
        }
      };
    }
  },

  handleLogLine(formattedLine) {
    const output = document.getElementById('console-output');
    if (!output) return;

    const lineEl = document.createElement('div');
    lineEl.className = 'kh-log-line';

    if (formattedLine.includes('[ERROR]') || formattedLine.includes('Exception') || formattedLine.includes('Error')) {
      lineEl.classList.add('error');
    } else if (formattedLine.includes('[WARN]') || formattedLine.includes('Warning')) {
      lineEl.classList.add('warn');
    } else if (formattedLine.startsWith('>')) {
      lineEl.classList.add('cmd');
    }

    lineEl.textContent = formattedLine;
    output.appendChild(lineEl);

    // Bounded DOM Ring Buffer: Prune older nodes
    while (output.children.length > this.maxDomLines) {
      output.removeChild(output.firstChild);
    }

    if (this.autoScroll) {
      this.scrollToBottom();
    }
  },

  scrollToBottom() {
    const output = document.getElementById('console-output');
    if (output) {
      output.scrollTop = output.scrollHeight;
    }
  },

  clearConsole() {
    const output = document.getElementById('console-output');
    if (output) {
      output.innerHTML = '';
      this.handleLogLine('[KineticHost] Console display cleared (Ctrl+L).');
    }
  },

  async submitCommand() {
    const input = document.getElementById('console-input');
    if (!input || !this.serverId) return;

    const command = input.value.trim();
    if (!command) return;

    // Record in history
    this.commandHistory.push(command);
    if (this.commandHistory.length > 50) this.commandHistory.shift();
    this.historyIndex = -1;
    input.value = '';

    try {
      await ServerAPI.sendCommand(this.serverId, command);
    } catch (err) {
      this.handleLogLine(`[KineticHost Error] ${err.message}`);
    }
  },

  teardown() {
    this.serverId = null;
    this.historyIndex = -1;
  }
};

window.ConsoleTabController = ConsoleTabController;
