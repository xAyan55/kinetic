const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractExpectedChecksum, extractZipSafely, configureServer, getInstaller } = require('../../server/installer');

async function runTests() {
  console.log('=== Dynamic Installer & Security Unit Tests ===');

  // Test 1: Checksum extraction from Paper URL
  console.log('1. Testing checksum extraction from Paper fill-data URL...');
  const paperUrl = 'https://fill-data.papermc.io/v1/objects/cabed3ae77cf55deba7c7d8722bc9cfd5e991201c211665f9265616d9fe5c77b/paper-1.20.4-499.jar';
  const paperChk = extractExpectedChecksum(paperUrl);
  assert.strictEqual(!!paperChk, true, 'Paper checksum should be extracted');
  assert.strictEqual(paperChk.algorithm, 'sha256', 'Paper algorithm should be sha256');
  assert.strictEqual(paperChk.hash, 'cabed3ae77cf55deba7c7d8722bc9cfd5e991201c211665f9265616d9fe5c77b');
  console.log('  ✓ SHA-256 extracted from Paper URL');

  // Test 2: Checksum extraction from Mojang URL
  console.log('2. Testing checksum extraction from Mojang piston-data URL...');
  const mojangUrl = 'https://piston-data.mojang.com/v1/objects/823e2250d24b3ddac457a60c92a6a941943fcd6a/server.jar';
  const mojangChk = extractExpectedChecksum(mojangUrl);
  assert.strictEqual(!!mojangChk, true, 'Mojang checksum should be extracted');
  assert.strictEqual(mojangChk.algorithm, 'sha1', 'Mojang algorithm should be sha1');
  assert.strictEqual(mojangChk.hash, '823e2250d24b3ddac457a60c92a6a941943fcd6a');
  console.log('  ✓ SHA-1 extracted from Mojang URL');

  // Test 3: Server configuration generation
  console.log('3. Testing server.properties and eula.txt generation...');
  const testDir = path.join(__dirname, '..', '..', 'data', 'scratch_test_config');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  try {
    configureServer(testDir, {
      port: 25577,
      name: 'Test Server Unit',
      eulaAcceptedAt: '2026-08-26T12:00:00Z'
    });

    const eulaContent = fs.readFileSync(path.join(testDir, 'eula.txt'), 'utf8');
    assert.strictEqual(eulaContent.includes('eula=true'), true, 'eula.txt must contain eula=true');
    assert.strictEqual(eulaContent.includes('2026-08-26T12:00:00Z'), true, 'eula.txt must include timestamp');

    const propsContent = fs.readFileSync(path.join(testDir, 'server.properties'), 'utf8');
    assert.strictEqual(propsContent.includes('server-port=25577'), true, 'server.properties must contain port');
    assert.strictEqual(propsContent.includes('motd='), true, 'server.properties must contain motd');
    console.log('  ✓ server.properties & eula.txt generated properly');
  } finally {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  }

  // Test 4: Backward compatibility with getInstaller
  console.log('4. Testing legacy getInstaller backward compatibility...');
  const paperInst = getInstaller('paper');
  assert.strictEqual(paperInst.getSoftwareName(), 'paper', 'paper installer name matches');
  const vanillaInst = getInstaller('vanilla');
  assert.strictEqual(vanillaInst.getSoftwareName(), 'vanilla', 'vanilla installer name matches');
  console.log('  ✓ Legacy Paper & Vanilla installer compatibility verified');

  console.log('\nAll Dynamic Installer & Security unit tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('Dynamic Installer test failure:', err);
  process.exit(1);
});
