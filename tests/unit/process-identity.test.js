const test = require('node:test');
const assert = require('node:assert');
const { processManager } = require('../../server/process-manager');

test('Process Identity — rejects invalid PIDs and non-existent processes', (t) => {
  const dummyServer = {
    id: 999,
    server_jar: 'server.jar',
    directory: '/tmp/nonexistent'
  };

  // Dead PID should be false
  assert.strictEqual(processManager.verifyProcessIdentity(dummyServer, null), false);
  assert.strictEqual(processManager.verifyProcessIdentity(dummyServer, 99999999), false);
});
