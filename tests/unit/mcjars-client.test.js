const assert = require('assert');
const { mcjars, compareMinecraftVersions, categorizeServerType } = require('../../server/mcjars-client');

async function runTests() {
  console.log('=== MCJars Client Unit Tests ===');

  // Test 1: Version comparator
  console.log('1. Testing compareMinecraftVersions...');
  assert.strictEqual(compareMinecraftVersions('1.20.4', '1.20.2') < 0, true, '1.20.4 should be newer than 1.20.2');
  assert.strictEqual(compareMinecraftVersions('1.16.5', '1.20.4') > 0, true, '1.16.5 should be older than 1.20.4');
  assert.strictEqual(compareMinecraftVersions('26.2', '1.21.1') < 0, true, '26.2 should be newer than 1.21.1');
  assert.strictEqual(compareMinecraftVersions('latest', '1.20.4') < 0, true, 'latest should be first');
  console.log('  ✓ Version comparator passed');

  // Test 2: Software categorization
  console.log('2. Testing categorizeServerType...');
  assert.strictEqual(categorizeServerType('VANILLA', {}), 'Official / Vanilla');
  assert.strictEqual(categorizeServerType('PAPER', {}), 'Performance');
  assert.strictEqual(categorizeServerType('FABRIC', {}), 'Modded');
  assert.strictEqual(categorizeServerType('FORGE', {}), 'Modded');
  assert.strictEqual(categorizeServerType('VELOCITY', {}), 'Proxy');
  assert.strictEqual(categorizeServerType('LOOHP_LIMBO', {}), 'Limbo / Special');
  console.log('  ✓ Software categorization passed');

  // Test 3: getTypes() catalog
  console.log('3. Testing getTypes()...');
  const types = await mcjars.getTypes();
  assert.strictEqual(Array.isArray(types), true, 'types should be an array');
  assert.strictEqual(types.length > 10, true, 'types should contain at least 10 entries');
  const paper = types.find(t => t.id === 'PAPER');
  assert.strictEqual(!!paper, true, 'Paper should exist in types');
  assert.strictEqual(paper.name, 'Paper', 'Paper name should match');
  assert.strictEqual(typeof paper.icon, 'string', 'Paper should have icon string');
  assert.strictEqual(paper.icon.startsWith('http'), true, 'Paper icon should be valid URL');
  console.log(`  ✓ getTypes() returned ${types.length} software entries with icons and categories`);

  // Test 4: getVersions('PAPER')
  console.log('4. Testing getVersions(PAPER)...');
  const versions = await mcjars.getVersions('PAPER');
  assert.strictEqual(Array.isArray(versions), true, 'versions should be an array');
  assert.strictEqual(versions.length > 20, true, 'Paper should have over 20 versions');
  const v1204 = versions.find(v => v.id === '1.20.4');
  assert.strictEqual(!!v1204, true, '1.20.4 should exist in Paper versions');
  assert.strictEqual(v1204.supported, true, '1.20.4 supported flag check');
  console.log(`  ✓ getVersions() returned ${versions.length} versions for Paper`);

  // Test 5: getLatestBuild('PAPER', '1.20.4')
  console.log('5. Testing getLatestBuild(PAPER, 1.20.4)...');
  const latestBuild = await mcjars.getLatestBuild('PAPER', '1.20.4');
  assert.strictEqual(!!latestBuild, true, 'latest build object returned');
  assert.strictEqual(typeof latestBuild.uuid, 'string', 'build should have uuid');
  assert.strictEqual(typeof latestBuild.jarUrl, 'string', 'build should have jarUrl');
  assert.strictEqual(latestBuild.jarUrl.includes('paper-1.20.4'), true, 'jarUrl should contain paper-1.20.4');
  console.log(`  ✓ getLatestBuild() resolved build ${latestBuild.name} (UUID: ${latestBuild.uuid})`);

  // Test 6: getBuildDetails
  console.log('6. Testing getBuildDetails(uuid)...');
  const details = await mcjars.getBuildDetails(latestBuild.uuid);
  assert.strictEqual(!!details, true, 'build details returned');
  assert.strictEqual(details.uuid, latestBuild.uuid, 'uuid matches');
  assert.strictEqual(typeof details.jarSize, 'number', 'jarSize is a number');
  console.log(`  ✓ getBuildDetails() resolved full artifact details (Size: ${details.jarSize} bytes)`);

  console.log('\nAll MCJars Client unit tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('MCJars Client test failure:', err);
  process.exit(1);
});
