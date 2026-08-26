const assert = require('assert');
const { resolveJavaRuntime, javaManager } = require('../../server/java-runtime');

async function runTests() {
  console.log('=== Java Runtime Engine Unit Tests ===');

  // Test 1: MC 1.20.5+ requires Java 21
  console.log('1. Testing MC 1.20.5+ requirement...');
  const res1205 = resolveJavaRuntime({ softwareType: 'PAPER', version: '1.20.5' });
  assert.strictEqual(res1205.requiredVersion, 21, '1.20.5 should require Java 21');
  console.log('  ✓ 1.20.5 requires Java 21');

  // Test 2: MC 1.20.4 requires Java 17
  console.log('2. Testing MC 1.20.4 requirement...');
  const res1204 = resolveJavaRuntime({ softwareType: 'PAPER', version: '1.20.4' });
  assert.strictEqual(res1204.requiredVersion, 17, '1.20.4 should require Java 17');
  console.log('  ✓ 1.20.4 requires Java 17');

  // Test 3: MC 1.16.5 requires Java 8
  console.log('3. Testing MC 1.16.5 requirement...');
  const res1165 = resolveJavaRuntime({ softwareType: 'VANILLA', version: '1.16.5' });
  assert.strictEqual(res1165.requiredVersion, 8, '1.16.5 should require Java 8');
  console.log('  ✓ 1.16.5 requires Java 8');

  // Test 4: Explicit javaRequirement metadata takes precedence
  console.log('4. Testing explicit javaRequirement metadata override...');
  const resMeta = resolveJavaRuntime({ softwareType: 'PAPER', version: '26.2', javaRequirement: 25 });
  assert.strictEqual(resMeta.requiredVersion, 25, 'Explicit java 25 requirement should be honored');
  console.log('  ✓ Metadata override (Java 25) honored');

  // Test 5: Proxy software requirements
  console.log('5. Testing Velocity proxy requirement...');
  const resVel = resolveJavaRuntime({ softwareType: 'VELOCITY', version: 'latest' });
  assert.strictEqual(resVel.requiredVersion, 17, 'Velocity should require Java 17');
  console.log('  ✓ Velocity requires Java 17');

  // Test 6: Host binary detection
  console.log('6. Testing host runtimes detection...');
  const runtimes = javaManager.detectHostRuntimes();
  assert.strictEqual(Array.isArray(runtimes), true, 'detectHostRuntimes should return array');
  assert.strictEqual(runtimes.length > 0, true, 'At least 1 host runtime should be detected');
  console.log(`  ✓ Detected ${runtimes.length} host Java runtime(s)`);

  console.log('\nAll Java Runtime unit tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('Java Runtime test failure:', err);
  process.exit(1);
});
