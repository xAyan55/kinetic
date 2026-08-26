const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Dashboard HTML has proper modal state and accessibility attributes', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../dashboard.html'), 'utf8');

  // Check remaining active modals
  const modalIds = ['modal-manage-user', 'modal-delete-server'];
  for (const id of modalIds) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-modal`), `${id} must have data-modal attribute`);
    assert.match(html, new RegExp(`id="${id}"[^>]*data-state="closed"`), `${id} must have initial data-state="closed"`);
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-hidden="true"`), `${id} must have initial aria-hidden="true"`);
    assert.match(html, new RegExp(`id="${id}"[^>]*role="dialog"`), `${id} must have role="dialog"`);
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-modal="true"`), `${id} must have aria-modal="true"`);
  }

  // Verify modal-create-server was removed in favor of dedicated view
  assert.doesNotMatch(html, /id="modal-create-server"/, 'modal-create-server must be removed in favor of #view-server-create');

  // Delete modal confirm button must be disabled initially
  assert.match(html, /id="delete-modal-confirm-btn"[^>]*disabled/, 'Delete confirm button must have disabled attribute initially');
});

test('CSS has authoritative data-state modal display rules', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../css/index.css'), 'utf8');
  assert.match(css, /\.kh-modal-backdrop\[data-state="open"\]/, 'CSS must style data-state="open"');
  assert.match(css, /\.kh-modal-backdrop\[data-state="closed"\]/, 'CSS must style data-state="closed" with display: none');
  assert.match(css, /\.kh-modal-backdrop\[aria-hidden="true"\]/, 'CSS must style aria-hidden="true" with display: none');
});

test('Dashboard JavaScript defines authoritative modal lifecycle engine', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../js/dashboard.js'), 'utf8');
  assert.match(js, /function initModals\(\)/, 'initModals must be defined');
  assert.match(js, /function openModal\(/, 'openModal must be defined');
  assert.match(js, /function closeModal\(/, 'closeModal must be defined');
  assert.match(js, /function closeAllModals\(\)/, 'closeAllModals must be defined');
  assert.match(js, /function trapModalFocus\(/, 'trapModalFocus must be defined');
  assert.match(js, /initModals\(\);/, 'initModals must be invoked on DOMContentLoaded');
  assert.match(js, /closeAllModals\(\);/, 'closeAllModals must be invoked on hash navigation');
});
