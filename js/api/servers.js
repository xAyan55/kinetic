/**
 * KineticHost Centralized Server API Client
 * Clean, robust, centralized error handling for all server operations.
 */
const ServerAPI = {
  async req(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const data = await res.json().catch(() => ({ success: false, error: { message: 'Failed to parse response' } }));
    if (!res.ok || data.success === false) {
      const err = new Error(data.error?.message || data.error || `HTTP ${res.status}`);
      err.code = data.error?.code || 'UNKNOWN_ERROR';
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // 1. Details & Telemetry
  getServer(id) {
    return this.req(`/api/servers/${id}`);
  },
  getServerState(id) {
    return this.req(`/api/servers/${id}/state`);
  },

  // 2. Power Controls
  startServer(id) {
    return this.req(`/api/servers/${id}/start`, { method: 'POST' });
  },
  stopServer(id) {
    return this.req(`/api/servers/${id}/stop`, { method: 'POST' });
  },
  restartServer(id) {
    return this.req(`/api/servers/${id}/restart`, { method: 'POST' });
  },
  killServer(id) {
    return this.req(`/api/servers/${id}/kill`, { method: 'POST' });
  },

  // 3. Console
  sendCommand(id, command) {
    return this.req(`/api/servers/${id}/console`, {
      method: 'POST',
      body: JSON.stringify({ command })
    });
  },

  // 4. File Manager
  listFiles(id, path = '') {
    return this.req(`/api/servers/${id}/files?path=${encodeURIComponent(path)}`);
  },
  readFile(id, path) {
    return this.req(`/api/servers/${id}/files/content?path=${encodeURIComponent(path)}`);
  },
  saveFile(id, path, content) {
    return this.req(`/api/servers/${id}/files/content`, {
      method: 'POST',
      body: JSON.stringify({ path, content })
    });
  },
  createFile(id, path) {
    return this.req(`/api/servers/${id}/files/new-file`, {
      method: 'POST',
      body: JSON.stringify({ path })
    });
  },
  createFolder(id, path) {
    return this.req(`/api/servers/${id}/files/new-folder`, {
      method: 'POST',
      body: JSON.stringify({ path })
    });
  },
  renameFile(id, oldPath, newPath) {
    return this.req(`/api/servers/${id}/files/rename`, {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath })
    });
  },
  deleteFile(id, path) {
    return this.req(`/api/servers/${id}/files`, {
      method: 'DELETE',
      body: JSON.stringify({ path })
    });
  },
  async uploadFile(id, directory, file) {
    const url = `/api/servers/${id}/files/upload?directory=${encodeURIComponent(directory)}&filename=${encodeURIComponent(file.name)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name)
      },
      body: file
    });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || data.success === false) {
      throw new Error(data.error?.message || data.error || 'Upload failed');
    }
    return data;
  },

  // 5. Backups
  listBackups(id) {
    return this.req(`/api/servers/${id}/backups`);
  },
  createBackup(id, name) {
    return this.req(`/api/servers/${id}/backups`, {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  },
  restoreBackup(id, backupId) {
    return this.req(`/api/servers/${id}/backups/${backupId}/restore`, {
      method: 'POST'
    });
  },
  deleteBackup(id, backupId) {
    return this.req(`/api/servers/${id}/backups/${backupId}`, {
      method: 'DELETE'
    });
  },

  // 6. Schedules
  listSchedules(id) {
    return this.req(`/api/servers/${id}/schedules`);
  },
  createSchedule(id, data) {
    return this.req(`/api/servers/${id}/schedules`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  updateSchedule(id, scheduleId, data) {
    return this.req(`/api/servers/${id}/schedules/${scheduleId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },
  deleteSchedule(id, scheduleId) {
    return this.req(`/api/servers/${id}/schedules/${scheduleId}`, {
      method: 'DELETE'
    });
  },
  runScheduleNow(id, scheduleId) {
    return this.req(`/api/servers/${id}/schedules/${scheduleId}/run-now`, {
      method: 'POST'
    });
  },

  // 7. Players
  listPlayers(id) {
    return this.req(`/api/servers/${id}/players`);
  },
  addWhitelist(id, name) {
    return this.req(`/api/servers/${id}/players/whitelist`, {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  },
  removeWhitelist(id, name) {
    return this.req(`/api/servers/${id}/players/whitelist`, {
      method: 'DELETE',
      body: JSON.stringify({ name })
    });
  },
  toggleWhitelist(id, enabled) {
    return this.req(`/api/servers/${id}/players/whitelist/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled })
    });
  },
  addOp(id, name) {
    return this.req(`/api/servers/${id}/players/op`, {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  },
  removeOp(id, name) {
    return this.req(`/api/servers/${id}/players/op`, {
      method: 'DELETE',
      body: JSON.stringify({ name })
    });
  },
  kickPlayer(id, name, reason) {
    return this.req(`/api/servers/${id}/players/kick`, {
      method: 'POST',
      body: JSON.stringify({ name, reason })
    });
  },
  banPlayer(id, name, reason) {
    return this.req(`/api/servers/${id}/players/ban`, {
      method: 'POST',
      body: JSON.stringify({ name, reason })
    });
  },

  // 8. Startup
  getStartup(id) {
    return this.req(`/api/servers/${id}/startup`);
  },
  updateStartup(id, data) {
    return this.req(`/api/servers/${id}/startup`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },

  // 9. Settings & Reinstall & Activity
  updateSettings(id, data) {
    return this.req(`/api/servers/${id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  },
  reinstallServer(id, data) {
    return this.req(`/api/servers/${id}/reinstall`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  getActivity(id) {
    return this.req(`/api/servers/${id}/activity`);
  },
  deleteServer(id, confirmName) {
    return this.req(`/api/servers/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmName })
    });
  }
};

window.ServerAPI = ServerAPI;
