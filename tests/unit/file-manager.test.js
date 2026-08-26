const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fileManager = require('../../server/file-manager');

const testDir = path.join(__dirname, '..', 'fixtures', 'test_server_files');

// Setup temporary test sandbox
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(path.join(testDir, 'server.properties'), 'motd=KineticHost Unit Test\nwhite-list=false\n');
fs.writeFileSync(path.join(testDir, 'eula.txt'), 'eula=true\n');
fs.mkdirSync(path.join(testDir, 'plugins'), { recursive: true });
fs.writeFileSync(path.join(testDir, 'plugins', 'config.yml'), 'enabled: true\n');

console.log('--- Running File Manager Security & Integrity Tests ---');

// Test 1: Directory Listing
const list = fileManager.listFiles(testDir, '');
assert.strictEqual(list.currentPath, '');
assert.ok(list.entries.some(e => e.name === 'server.properties' && !e.isDirectory && e.isEditable));
assert.ok(list.entries.some(e => e.name === 'plugins' && e.isDirectory));
console.log('✓ Test 1 Passed: Directory listing and editable detection');

// Test 2: Path Traversal Attack Rejection (../)
try {
  fileManager.listFiles(testDir, '../../');
  assert.fail('Should have thrown PATH_FORBIDDEN error');
} catch (err) {
  assert.strictEqual(err.code, 'PATH_FORBIDDEN');
  console.log('✓ Test 2 Passed: Path traversal (../../) strictly blocked');
}

// Test 3: Read File Content
const contentResult = fileManager.getFileContent(testDir, 'server.properties');
assert.ok(contentResult.content.includes('KineticHost Unit Test'));
assert.strictEqual(contentResult.extension, '.properties');
console.log('✓ Test 3 Passed: Safe text file read');

// Test 4: Save File Content
fileManager.saveFileContent(testDir, 'server.properties', 'motd=KineticHost Modified MOTD\nwhite-list=true\n');
const modified = fileManager.getFileContent(testDir, 'server.properties');
assert.ok(modified.content.includes('KineticHost Modified MOTD'));
console.log('✓ Test 4 Passed: Atomic file save');

// Test 5: Create File & Directory
fileManager.createDirectory(testDir, 'worlds');
fileManager.createFile(testDir, 'worlds/world_info.txt');
assert.ok(fs.existsSync(path.join(testDir, 'worlds', 'world_info.txt')));
console.log('✓ Test 5 Passed: Directory and file creation');

// Test 6: Rename
fileManager.renamePath(testDir, 'worlds/world_info.txt', 'worlds/info.txt');
assert.ok(fs.existsSync(path.join(testDir, 'worlds', 'info.txt')));
assert.ok(!fs.existsSync(path.join(testDir, 'worlds', 'world_info.txt')));
console.log('✓ Test 6 Passed: Safe path renaming');

// Test 7: Delete
fileManager.deletePath(testDir, 'worlds/info.txt');
assert.ok(!fs.existsSync(path.join(testDir, 'worlds', 'info.txt')));
console.log('✓ Test 7 Passed: File deletion');

// Test 8: Root Deletion Rejection
try {
  fileManager.deletePath(testDir, '');
  assert.fail('Should have rejected root deletion');
} catch (err) {
  assert.strictEqual(err.code, 'ROOT_DELETION_FORBIDDEN');
  console.log('✓ Test 8 Passed: Server root deletion strictly forbidden');
}

// Clean sandbox
fs.rmSync(testDir, { recursive: true, force: true });
console.log('=== All File Manager Tests Succeeded ===\n');
