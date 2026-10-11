const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('updating this app preserves the other game and unrelated offline caches', async () => {
  const events = {}, deleted = []; let pending;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), {
    self: { addEventListener(k, fn) { events[k] = fn; }, clients: { claim() {} } },
    caches: { async keys() { return ['patience-v0', 'sudoku-v0', 'unrelated']; }, async delete(k) { deleted.push(k); } }
  });
  events.activate({ waitUntil(promise) { pending = promise; } }); await pending;
  assert.deepEqual(deleted, ['patience-v0']);
});
