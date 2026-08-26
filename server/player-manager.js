const fs = require('fs');
const path = require('path');
const { processManager } = require('./process-manager');
const { db } = require('./db');

const MINECRAFT_USERNAME_REGEX = /^[a-zA-Z0-9_]{2,16}$/;

/**
 * Validates a Minecraft player name
 */
function validatePlayerName(name) {
  if (!name || typeof name !== 'string' || !MINECRAFT_USERNAME_REGEX.test(name.trim())) {
    const err = new Error('Invalid Minecraft username. Usernames must be 2-16 characters and contain only letters, numbers, and underscores.');
    err.code = 'INVALID_USERNAME';
    err.statusCode = 400;
    throw err;
  }
  return name.trim();
}

/**
 * Reads a JSON data file safely from server directory
 */
function readServerJson(serverDir, filename) {
  const filePath = path.join(serverDir, filename);
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[PlayerManager] Warning reading ${filename}:`, err.message);
    return [];
  }
}

/**
 * Writes a JSON data file safely to server directory
 */
function writeServerJson(serverDir, filename, data) {
  const filePath = path.join(serverDir, filename);
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * Gets whitelist status from server.properties
 */
function isWhitelistEnabled(serverDir) {
  const propsPath = path.join(serverDir, 'server.properties');
  if (!fs.existsSync(propsPath)) return false;

  try {
    const content = fs.readFileSync(propsPath, 'utf8');
    const match = content.match(/^white-list\s*=\s*(true|false)/mi);
    return match ? match[1].toLowerCase() === 'true' : false;
  } catch (e) {
    return false;
  }
}

/**
 * Updates server.properties key
 */
function updateServerProperty(serverDir, key, value) {
  const propsPath = path.join(serverDir, 'server.properties');
  if (!fs.existsSync(propsPath)) return;

  try {
    let content = fs.readFileSync(propsPath, 'utf8');
    const regex = new RegExp(`^${key}\\s*=.*$`, 'mi');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
    fs.writeFileSync(propsPath, content, 'utf8');
  } catch (e) {
    console.warn(`[PlayerManager] Warning updating server.properties ${key}:`, e.message);
  }
}

/**
 * Gets all player lists and states for a server
 */
function getPlayersState(server) {
  const serverDir = server.directory;
  if (!fs.existsSync(serverDir)) {
    return {
      whitelistEnabled: false,
      whitelist: [],
      ops: [],
      bannedPlayers: [],
      bannedIps: [],
      onlineCount: 0
    };
  }

  const whitelist = readServerJson(serverDir, 'whitelist.json');
  const ops = readServerJson(serverDir, 'ops.json');
  const bannedPlayers = readServerJson(serverDir, 'banned-players.json');
  const bannedIps = readServerJson(serverDir, 'banned-ips.json');
  const whitelistEnabled = isWhitelistEnabled(serverDir);

  return {
    whitelistEnabled,
    whitelist: whitelist.map(w => ({ name: w.name, uuid: w.uuid })),
    ops: ops.map(o => ({ name: o.name, uuid: o.uuid, level: o.level || 4, bypassesPlayerLimit: !!o.bypassesPlayerLimit })),
    bannedPlayers: bannedPlayers.map(b => ({ name: b.name, uuid: b.uuid, created: b.created, reason: b.reason })),
    bannedIps: bannedIps.map(b => ({ ip: b.ip, created: b.created, reason: b.reason })),
    onlineCount: server.status === 'running' ? 0 : 0
  };
}

/**
 * Adds player to whitelist
 */
function addWhitelist(server, playerName) {
  const validName = validatePlayerName(playerName);
  const serverDir = server.directory;

  if (server.status === 'running') {
    processManager.sendCommand(server.id, `whitelist add ${validName}`);
  }

  // Update whitelist.json on disk
  const list = readServerJson(serverDir, 'whitelist.json');
  if (!list.some(p => p.name && p.name.toLowerCase() === validName.toLowerCase())) {
    list.push({ name: validName, uuid: '' });
    writeServerJson(serverDir, 'whitelist.json', list);
  }

  db.prepare(`
    INSERT INTO activity_logs (server_id, action, details, created_at)
    VALUES (?, 'player_whitelist_add', ?, datetime('now'))
  `).run(server.id, `Added player "${validName}" to whitelist`);

  return { success: true, name: validName };
}

/**
 * Removes player from whitelist
 */
function removeWhitelist(server, playerName) {
  const validName = validatePlayerName(playerName);
  const serverDir = server.directory;

  if (server.status === 'running') {
    processManager.sendCommand(server.id, `whitelist remove ${validName}`);
  }

  const list = readServerJson(serverDir, 'whitelist.json');
  const filtered = list.filter(p => !p.name || p.name.toLowerCase() !== validName.toLowerCase());
  writeServerJson(serverDir, 'whitelist.json', filtered);

  db.prepare(`
    INSERT INTO activity_logs (server_id, action, details, created_at)
    VALUES (?, 'player_whitelist_remove', ?, datetime('now'))
  `).run(server.id, `Removed player "${validName}" from whitelist`);

  return { success: true, name: validName };
}

/**
 * Toggles whitelist state
 */
function setWhitelistState(server, enabled) {
  const serverDir = server.directory;

  if (server.status === 'running') {
    processManager.sendCommand(server.id, enabled ? 'whitelist on' : 'whitelist off');
  }

  updateServerProperty(serverDir, 'white-list', enabled ? 'true' : 'false');

  db.prepare(`
    INSERT INTO activity_logs (server_id, action, details, created_at)
    VALUES (?, 'whitelist_toggle', ?, datetime('now'))
  `).run(server.id, `Set whitelist to ${enabled ? 'ENABLED' : 'DISABLED'}`);

  return { success: true, enabled };
}

/**
 * Adds an operator (OP)
 */
function addOp(server, playerName) {
  const validName = validatePlayerName(playerName);
  const serverDir = server.directory;

  if (server.status === 'running') {
    processManager.sendCommand(server.id, `op ${validName}`);
  }

  const ops = readServerJson(serverDir, 'ops.json');
  if (!ops.some(o => o.name && o.name.toLowerCase() === validName.toLowerCase())) {
    ops.push({ name: validName, uuid: '', level: 4, bypassesPlayerLimit: false });
    writeServerJson(serverDir, 'ops.json', ops);
  }

  db.prepare(`
    INSERT INTO activity_logs (server_id, action, details, created_at)
    VALUES (?, 'player_op_add', ?, datetime('now'))
  `).run(server.id, `Granted operator permissions to "${validName}"`);

  return { success: true, name: validName };
}

/**
 * Removes operator (De-OP)
 */
function removeOp(server, playerName) {
  const validName = validatePlayerName(playerName);
  const serverDir = server.directory;

  if (server.status === 'running') {
    processManager.sendCommand(server.id, `deop ${validName}`);
  }

  const ops = readServerJson(serverDir, 'ops.json');
  const filtered = ops.filter(o => !o.name || o.name.toLowerCase() !== validName.toLowerCase());
  writeServerJson(serverDir, 'ops.json', filtered);

  db.prepare(`
    INSERT INTO activity_logs (server_id, action, details, created_at)
    VALUES (?, 'player_op_remove', ?, datetime('now'))
  `).run(server.id, `Removed operator permissions from "${validName}"`);

  return { success: true, name: validName };
}

/**
 * Kicks a player from running server
 */
function kickPlayer(server, playerName, reason = 'Kicked by administrator') {
  const validName = validatePlayerName(playerName);

  if (server.status !== 'running') {
    const err = new Error('Cannot kick players when the server is offline.');
    err.code = 'SERVER_OFFLINE';
    err.statusCode = 400;
    throw err;
  }

  const cleanReason = (reason || '').replace(/[\r\n]/g, '').slice(0, 100);
  processManager.sendCommand(server.id, `kick ${validName} ${cleanReason}`);

  db.prepare(`
    INSERT INTO activity_logs (server_id, action, details, created_at)
    VALUES (?, 'player_kicked', ?, datetime('now'))
  `).run(server.id, `Kicked player "${validName}": ${cleanReason}`);

  return { success: true, name: validName };
}

/**
 * Bans a player
 */
function banPlayer(server, playerName, reason = 'Banned by administrator') {
  const validName = validatePlayerName(playerName);
  const serverDir = server.directory;
  const cleanReason = (reason || '').replace(/[\r\n]/g, '').slice(0, 100);

  if (server.status === 'running') {
    processManager.sendCommand(server.id, `ban ${validName} ${cleanReason}`);
  }

  const list = readServerJson(serverDir, 'banned-players.json');
  if (!list.some(p => p.name && p.name.toLowerCase() === validName.toLowerCase())) {
    list.push({
      name: validName,
      uuid: '',
      created: new Date().toISOString(),
      source: 'KineticHost Panel',
      expires: 'forever',
      reason: cleanReason
    });
    writeServerJson(serverDir, 'banned-players.json', list);
  }

  db.prepare(`
    INSERT INTO activity_logs (server_id, action, details, created_at)
    VALUES (?, 'player_banned', ?, datetime('now'))
  `).run(server.id, `Banned player "${validName}": ${cleanReason}`);

  return { success: true, name: validName };
}

module.exports = {
  validatePlayerName,
  getPlayersState,
  addWhitelist,
  removeWhitelist,
  setWhitelistState,
  addOp,
  removeOp,
  kickPlayer,
  banPlayer
};
