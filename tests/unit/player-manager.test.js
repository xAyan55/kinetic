const assert = require('assert');
const fs = require('fs');
const path = require('path');
const playerManager = require('../../server/player-manager');

const testDir = path.join(__dirname, '..', 'fixtures', 'test_server_players');

if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(path.join(testDir, 'server.properties'), 'white-list=false\n');

const mockServer = {
  id: 9999,
  directory: testDir,
  status: 'offline'
};

console.log('--- Running Player Manager Unit Tests ---');

// Test 1: Username validation
assert.strictEqual(playerManager.validatePlayerName('Notch'), 'Notch');
assert.strictEqual(playerManager.validatePlayerName('Player_123'), 'Player_123');

try {
  playerManager.validatePlayerName('invalid-name!');
  assert.fail('Should have rejected invalid username');
} catch (e) {
  assert.strictEqual(e.code, 'INVALID_USERNAME');
  console.log('✓ Test 1 Passed: Username validation');
}

// Test 2: Add and list whitelist
playerManager.addWhitelist(mockServer, 'PlayerOne');
playerManager.addWhitelist(mockServer, 'PlayerTwo');
let state = playerManager.getPlayersState(mockServer);
assert.strictEqual(state.whitelist.length, 2);
assert.ok(state.whitelist.some(p => p.name === 'PlayerOne'));
console.log('✓ Test 2 Passed: Whitelist addition');

// Test 3: Remove whitelist
playerManager.removeWhitelist(mockServer, 'PlayerOne');
state = playerManager.getPlayersState(mockServer);
assert.strictEqual(state.whitelist.length, 1);
assert.strictEqual(state.whitelist[0].name, 'PlayerTwo');
console.log('✓ Test 3 Passed: Whitelist removal');

// Test 4: Toggle whitelist
playerManager.setWhitelistState(mockServer, true);
state = playerManager.getPlayersState(mockServer);
assert.strictEqual(state.whitelistEnabled, true);
console.log('✓ Test 4 Passed: Whitelist toggle in server.properties');

// Test 5: Add OP and Ban Player
playerManager.addOp(mockServer, 'AdminPlayer');
playerManager.banPlayer(mockServer, 'Griefer99', 'Hacking');
state = playerManager.getPlayersState(mockServer);
assert.ok(state.ops.some(o => o.name === 'AdminPlayer'));
assert.ok(state.bannedPlayers.some(b => b.name === 'Griefer99' && b.reason === 'Hacking'));
console.log('✓ Test 5 Passed: Operator and Ban management');

fs.rmSync(testDir, { recursive: true, force: true });
console.log('=== All Player Manager Tests Succeeded ===\n');
