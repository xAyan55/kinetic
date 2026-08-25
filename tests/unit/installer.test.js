const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { getInstaller, PaperInstaller, VanillaInstaller } = require('../../server/installer');

test('Installer — resolves Paper and Vanilla versions and generates valid config', async (t) => {
  const paper = getInstaller('paper');
  assert.ok(paper instanceof PaperInstaller);
  const paperVersions = await paper.getSupportedVersions();
  assert.ok(paperVersions.includes('1.20.4'));

  const vanilla = getInstaller('vanilla');
  assert.ok(vanilla instanceof VanillaInstaller);
  const vanillaVersions = await vanilla.getSupportedVersions();
  assert.ok(vanillaVersions.includes('1.20.4'));

  // Test configuration generation
  const tmpDir = path.join(__dirname, 'tmp_test_config');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  paper.configure(tmpDir, { port: 25565, name: 'Test Server', eulaAcceptedAt: new Date().toISOString() });

  assert.ok(fs.existsSync(path.join(tmpDir, 'eula.txt')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'server.properties')));

  const eula = fs.readFileSync(path.join(tmpDir, 'eula.txt'), 'utf8');
  assert.ok(eula.includes('eula=true'));
  assert.ok(eula.includes('EULA accepted by user on'));

  const props = fs.readFileSync(path.join(tmpDir, 'server.properties'), 'utf8');
  assert.ok(props.includes('server-port=25565'));

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
