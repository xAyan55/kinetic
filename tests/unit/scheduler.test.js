const assert = require('assert');
const { Scheduler } = require('../../server/scheduler');

console.log('--- Running Scheduler Unit Tests ---');
const s = new Scheduler();

// Test 1: Cron expression matching
const fixedDate = new Date(2026, 7, 26, 4, 0, 0); // 4:00 AM on Aug 26, 2026
assert.strictEqual(s.matchesCron('0 4 * * *', fixedDate), true);
assert.strictEqual(s.matchesCron('0 5 * * *', fixedDate), false);
assert.strictEqual(s.matchesCron('*/15 * * * *', fixedDate), true);
assert.strictEqual(s.matchesCron('every_24h', fixedDate), true);
console.log('✓ Test 1 Passed: Cron pattern matching');

// Test 2: Next run computation
const nextRun = s.computeNextRun('0 4 * * *');
assert.ok(nextRun && typeof nextRun === 'string');
assert.ok(new Date(nextRun).getTime() > Date.now());
console.log('✓ Test 2 Passed: Next run calculation');

console.log('=== All Scheduler Tests Succeeded ===\n');
