/**
 * File Manager Tab Controller
 * Interactive directory browser, breadcrumb navigation, text file editor, and upload/download.
 */
const FilesTabController = {
  serverId: null,
  currentPath: '',
  activeEditingFile: null,

  mount(serverId) {
    this.serverId = serverId;
    this.currentPath = '';
    this.loadDirectory('');
  },

  async loadDirectory(subPath = '') {
    this.currentPath = subPath;
    const tbody = document.getElementById('files-table-body');
    const breadcrumbContainer = document.getElementById('files-breadcrumbs');

    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="tw-py-12 tw-text-center">
            <div class="tw-w-5 tw-h-5 tw-border-2 tw-border-white/20 tw-border-t-white tw-rounded-full tw-animate-spin tw-mx-auto tw-mb-2"></div>
            <span class="tw-text-xs tw-font-mono tw-text-neutral-500">Reading server filesystem...</span>
          </td>
        </tr>
      `;
    }

    try {
      const data = await ServerAPI.listFiles(this.serverId, subPath);
      this.renderBreadcrumbs(data.breadcrumbs || []);
      this.renderFileList(data.entries || []);
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="tw-py-8 tw-text-center tw-text-red-400 tw-text-xs tw-font-mono">
              Failed to load directory: ${escapeHtml(err.message)}
            </td>
          </tr>
        `;
      }
    }
  },

  renderBreadcrumbs(crumbs) {
    const container = document.getElementById('files-breadcrumbs');
    if (!container) return;

    container.innerHTML = crumbs.map((c, i) => {
      const isLast = i === crumbs.length - 1;
      return `
        <button type="button" onclick="FilesTabController.loadDirectory('${escapeHtml(c.path)}')" class="tw-font-mono tw-text-xs ${isLast ? 'tw-text-white tw-font-bold' : 'tw-text-neutral-400 hover:tw-text-white'} tw-transition-colors">
          ${escapeHtml(c.name)}
        </button>
        ${!isLast ? '<span class="tw-text-neutral-600 tw-text-xs">/</span>' : ''}
      `;
    }).join('');
  },

  renderFileList(entries) {
    const tbody = document.getElementById('files-table-body');
    if (!tbody) return;

    if (entries.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="tw-py-12 tw-text-center tw-text-neutral-500 tw-font-mono tw-text-xs">
            This directory is empty.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = entries.map(item => {
      const iconClass = item.isDirectory ? 'bi-folder-fill tw-text-yellow-400' : 'bi-file-earmark-text tw-text-neutral-400';
      const formattedSize = item.isDirectory ? '-' : this.formatBytes(item.sizeBytes);
      const formattedDate = new Date(item.modifiedAt).toLocaleDateString();

      return `
        <tr class="kh-file-row">
          <td class="tw-w-8">
            <i class="bi ${iconClass} tw-text-base"></i>
          </td>
          <td>
            ${item.isDirectory ? `
              <a href="javascript:void(0)" onclick="FilesTabController.loadDirectory('${escapeHtml(item.path)}')" class="tw-font-mono tw-text-xs tw-font-semibold tw-text-white hover:tw-underline">
                ${escapeHtml(item.name)}
              </a>
            ` : `
              <span class="tw-font-mono tw-text-xs tw-text-neutral-200">
                ${escapeHtml(item.name)}
              </span>
            `}
          </td>
          <td class="tw-font-mono tw-text-xs tw-text-neutral-400">${formattedSize}</td>
          <td class="tw-font-mono tw-text-xs tw-text-neutral-500">${formattedDate}</td>
          <td class="tw-text-right">
            <div class="tw-flex tw-items-center tw-justify-end tw-gap-1.5">
              ${item.isEditable ? `
                <button type="button" onclick="FilesTabController.openEditor('${escapeHtml(item.path)}')" class="tw-px-2 tw-py-1 tw-rounded tw-bg-white/[0.04] hover:tw-bg-white/[0.1] tw-border tw-border-white/10 tw-text-xs tw-font-mono tw-text-neutral-300 hover:tw-text-white tw-transition-colors" title="Edit File">
                  <i class="bi bi-pencil-fill"></i>
                </button>
              ` : ''}
              ${!item.isDirectory ? `
                <a href="/api/servers/${this.serverId}/files/download?path=${encodeURIComponent(item.path)}" target="_blank" class="tw-px-2 tw-py-1 tw-rounded tw-bg-white/[0.04] hover:tw-bg-white/[0.1] tw-border tw-border-white/10 tw-text-xs tw-font-mono tw-text-neutral-300 hover:tw-text-white tw-transition-colors" title="Download">
                  <i class="bi bi-download"></i>
                </a>
              ` : ''}
              <button type="button" onclick="FilesTabController.promptRename('${escapeHtml(item.path)}', '${escapeHtml(item.name)}')" class="tw-px-2 tw-py-1 tw-rounded tw-bg-white/[0.04] hover:tw-bg-white/[0.1] tw-border tw-border-white/10 tw-text-xs tw-font-mono tw-text-neutral-400 hover:tw-text-white tw-transition-colors" title="Rename">
                <i class="bi bi-input-cursor-text"></i>
              </button>
              <button type="button" onclick="FilesTabController.confirmDelete('${escapeHtml(item.path)}')" class="tw-px-2 tw-py-1 tw-rounded tw-bg-red-500/10 hover:tw-bg-red-500/20 tw-border tw-border-red-500/25 tw-text-xs tw-font-mono tw-text-red-400 tw-transition-colors" title="Delete">
                <i class="bi bi-trash-fill"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async openEditor(filePath) {
    this.activeEditingFile = filePath;
    const modal = document.getElementById('modal-file-editor');
    const titleEl = document.getElementById('editor-file-title');
    const textarea = document.getElementById('editor-textarea');
    const saveBtn = document.getElementById('btn-save-file');

    if (titleEl) titleEl.textContent = filePath;
    if (textarea) textarea.value = 'Loading file contents...';

    openModal('modal-file-editor');

    try {
      const data = await ServerAPI.readFile(this.serverId, filePath);
      if (textarea) textarea.value = data.file.content || '';
    } catch (err) {
      showToast(err.message, 'error');
      closeModal('modal-file-editor');
    }
  },

  async saveActiveFile() {
    if (!this.activeEditingFile || !this.serverId) return;
    const textarea = document.getElementById('editor-textarea');
    const saveBtn = document.getElementById('btn-save-file');

    if (saveBtn) saveBtn.disabled = true;

    try {
      const content = textarea ? textarea.value : '';
      await ServerAPI.saveFile(this.serverId, this.activeEditingFile, content);
      showToast('File saved successfully.', 'success');
      closeModal('modal-file-editor');
      this.loadDirectory(this.currentPath);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  },

  promptNewFile() {
    const name = prompt('Enter new file name (e.g. motd.txt or config.yml):');
    if (!name || !name.trim()) return;

    const fullPath = this.currentPath ? `${this.currentPath}/${name.trim()}` : name.trim();
    ServerAPI.createFile(this.serverId, fullPath)
      .then(() => {
        showToast('File created.', 'success');
        this.loadDirectory(this.currentPath);
        this.openEditor(fullPath);
      })
      .catch(err => showToast(err.message, 'error'));
  },

  promptNewFolder() {
    const name = prompt('Enter new folder name:');
    if (!name || !name.trim()) return;

    const fullPath = this.currentPath ? `${this.currentPath}/${name.trim()}` : name.trim();
    ServerAPI.createFolder(this.serverId, fullPath)
      .then(() => {
        showToast('Folder created.', 'success');
        this.loadDirectory(this.currentPath);
      })
      .catch(err => showToast(err.message, 'error'));
  },

  promptRename(oldPath, currentName) {
    const newName = prompt('Enter new name:', currentName);
    if (!newName || newName.trim() === currentName) return;

    const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${newName.trim()}` : newName.trim();

    ServerAPI.renameFile(this.serverId, oldPath, newPath)
      .then(() => {
        showToast('Item renamed.', 'success');
        this.loadDirectory(this.currentPath);
      })
      .catch(err => showToast(err.message, 'error'));
  },

  confirmDelete(path) {
    if (!confirm(`Are you sure you want to permanently delete "${path}"? This cannot be undone.`)) return;

    ServerAPI.deleteFile(this.serverId, path)
      .then(() => {
        showToast('Deleted successfully.', 'success');
        this.loadDirectory(this.currentPath);
      })
      .catch(err => showToast(err.message, 'error'));
  },

  handleUploadInput(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    showToast(`Uploading "${file.name}"...`, 'info');

    ServerAPI.uploadFile(this.serverId, this.currentPath, file)
      .then(() => {
        showToast(`"${file.name}" uploaded successfully.`, 'success');
        this.loadDirectory(this.currentPath);
      })
      .catch(err => showToast(err.message, 'error'))
      .finally(() => { e.target.value = ''; });
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  },

  teardown() {
    this.serverId = null;
    this.activeEditingFile = null;
  }
};

window.FilesTabController = FilesTabController;
