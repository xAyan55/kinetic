const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { getInstaller } = require('../../server/installer');

test('Dashboard HTML contains dedicated full-page server creation view (#view-server-create)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../dashboard.html'), 'utf8');

  // Verify dedicated section
  assert.match(html, /id="view-server-create"/, 'Must contain #view-server-create view');
  assert.match(html, /id="page-create-server-form"/, 'Must contain #page-create-server-form');
  assert.match(html, /id="page-create-name"/, 'Must contain server name input');
  assert.match(html, /id="page-create-owner"/, 'Must contain user assignment select');
  assert.match(html, /id="page-software-selector"/, 'Must contain software cards container');
  assert.match(html, /id="page-create-version"/, 'Must contain version select');
  assert.match(html, /id="page-create-ram"/, 'Must contain RAM range slider');
  assert.match(html, /id="page-create-eula"/, 'Must contain EULA checkbox');

  // Verify live sticky deployment summary card
  assert.match(html, /class="[^"]*kh-summary-card[^"]*"/, 'Must contain .kh-summary-card');
  assert.match(html, /id="summary-server-name"/, 'Must contain #summary-server-name');
  assert.match(html, /id="summary-owner-name"/, 'Must contain #summary-owner-name');
  assert.match(html, /id="summary-software"/, 'Must contain #summary-software');
  assert.match(html, /id="summary-version"/, 'Must contain #summary-version');
  assert.match(html, /id="summary-ram"/, 'Must contain #summary-ram');

  // Verify CTA links direct to #server-create instead of legacy modal
  assert.match(html, /href="#server-create"/, 'CTAs must link to #server-create');
  assert.doesNotMatch(html, /onclick="openCreateServerModal\(\)"/, 'No CTAs should call openCreateServerModal');
});

test('Dashboard JS handles #server-create routing and dedicated provisioning lifecycle', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../js/dashboard.js'), 'utf8');

  // Router handles server-create
  assert.match(js, /'server-create': 'Deploy Server'/, 'Router must define server-create title');
  assert.match(js, /loadServerCreate\(\)/, 'Router must invoke loadServerCreate');
  assert.match(js, /function loadServerCreate\(\)/, 'loadServerCreate must be implemented');
  assert.match(js, /function loadServerCreationSoftware\(\)/, 'loadServerCreationSoftware must be implemented');
  assert.match(js, /function renderSoftwareEngineCards\(\)/, 'renderSoftwareEngineCards must be implemented');
  assert.match(js, /function handleServerCreatePageSubmit\(/, 'handleServerCreatePageSubmit must be implemented');

  // Verify legacy modal functions are removed
  assert.doesNotMatch(js, /function openCreateServerModal\(/, 'openCreateServerModal must be removed');
  assert.doesNotMatch(js, /function closeCreateServerModal\(/, 'closeCreateServerModal must be removed');
  assert.doesNotMatch(js, /function handleCreateServerSubmit\(/, 'handleCreateServerSubmit must be removed');

  // Verify zero fake data policy: no hardcoded '25.6 GB' in server cards
  assert.doesNotMatch(js, />25\.6 GB</, 'Server card template must not contain hardcoded 25.6 GB');
});

test('Installer layer dynamically provides Paper and Vanilla versions', async () => {
  const paper = getInstaller('paper');
  const vanilla = getInstaller('vanilla');

  const paperVersions = await paper.getSupportedVersions();
  const vanillaVersions = await vanilla.getSupportedVersions();

  assert.ok(Array.isArray(paperVersions) && paperVersions.length >= 3, 'Paper versions must have at least 3 releases');
  assert.ok(Array.isArray(vanillaVersions) && vanillaVersions.length >= 3, 'Vanilla versions must have at least 3 releases');
  assert.ok(paperVersions.includes('1.20.4'), 'Paper must support 1.20.4');
  assert.ok(vanillaVersions.includes('1.20.4'), 'Vanilla must support 1.20.4');
});
