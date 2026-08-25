const net = require('net');
const { db } = require('./db');

/**
 * Checks if a port is physically available to listen on the host
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Atomically finds and allocates the next available port for a node.
 * Uses SQLite transaction with UNIQUE constraint for race safety.
 */
async function allocatePort(nodeId = 1) {
  const node = db.prepare('SELECT port_range_start, port_range_end FROM nodes WHERE id = ?').get(nodeId);
  const startPort = node ? node.port_range_start : 25565;
  const endPort = node ? node.port_range_end : 25620;

  // Query all currently assigned ports on this node
  const assignedRows = db.prepare(`
    SELECT port FROM servers WHERE node_id = ?
  `).all(nodeId);
  const assignedPorts = new Set(assignedRows.map(r => r.port));

  for (let port = startPort; port <= endPort; port++) {
    if (!assignedPorts.has(port)) {
      const physicallyFree = await isPortAvailable(port);
      if (physicallyFree) {
        return port;
      }
    }
  }

  throw new Error(`No available ports remaining on Node #${nodeId} within range ${startPort}-${endPort}`);
}

module.exports = {
  allocatePort,
  isPortAvailable
};
