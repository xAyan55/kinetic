const test = require('node:test');
const assert = require('node:assert');
const { allocatePort, isPortAvailable } = require('../../server/port-allocator');
const { db } = require('../../server/db');

test('Port Allocator — verifies port availability and allocation within range', async (t) => {
  // Test local port availability check on an unassigned port
  const available = await isPortAvailable(25599);
  assert.strictEqual(typeof available, 'boolean');

  // Test port allocation
  const port = await allocatePort(1);
  assert.ok(port >= 25565 && port <= 25620, `Allocated port ${port} should be within node range`);
});
