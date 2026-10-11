const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'tracking.js'), 'utf8');
function app(saved = new Map()) {
  let now = Date.parse('2026-10-11T10:00:00Z');
  const events = {}, requests = [], database = new Map(), intervals = [];
  let failed = false, waiting = null;
  const context = {
    Date: class extends Date { static now() { return now; } }, Intl,
    crypto: webcrypto, AbortController, URL, location: { href: 'https://example.test/patience/' },
    navigator: { onLine: true }, document: { hidden: false, addEventListener(k, fn) { events[k] = fn; } },
    localStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) },
    setInterval: fn => intervals.push(fn), setTimeout, clearTimeout,
    addEventListener(k, fn) { events[k] = fn; },
    async fetch(url, options) {
      requests.push({ url, data: JSON.parse(options.body) });
      if (waiting) await waiting;
      if (failed) throw new TypeError('offline');
      database.set(url, JSON.parse(options.body));
      return { ok: true };
    },
    PATIENCE_TRACKING: { databaseUrl: 'https://example.firebasedatabase.app' }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {
    tracking: context.PatienceTracking, requests, database, saved, context, events, intervals,
    advance(ms = 1000, playing = true) { now += ms; context.PatienceTracking.tick(playing); },
    setTime(ms) { now = ms; }, fail(value) { failed = value; }, wait(promise) { waiting = promise; },
    async settle() { await new Promise(resolve => setImmediate(resolve)); }
  };
}
test('play is tracked automatically on the first move, while merely opening is not', async () => {
  const a = app(); a.advance(); await a.settle();
  assert.equal(a.requests.length, 0);
  a.tracking.touch(true);
  for (let i = 0; i < 45; i++) a.advance();
  a.tracking.stop(); await a.settle(); await a.tracking.flush();
  const records = [...a.database.values()];
  assert.equal(records.length, 1); assert.equal(records[0].seconds, 45);
  assert.equal(records[0].games, 1); assert.equal(records[0].active, false);
  for (let i = 0; i < 20; i++) a.advance();
  assert.equal([...a.database.values()][0].seconds, 45);
});
test('offline summaries retry the same record, without double-counting', async () => {
  const a = app(); a.fail(true); a.tracking.touch(true);
  for (let i = 0; i < 10; i++) a.advance();
  a.tracking.win(); await a.settle();
  assert.equal(a.database.size, 0);
  a.fail(false); await a.tracking.flush(); await a.tracking.flush();
  assert.equal(a.database.size, 1);
  const record = [...a.database.values()][0];
  assert.equal(record.seconds, 10); assert.equal(record.wins, 1); assert.equal(record.active, false);
  assert.equal(Object.keys(JSON.parse(a.saved.get('patience.sessions.v1'))).length, 0);
});
test('idle time is capped and resumed play gets a new session', async () => {
  const a = app(); a.tracking.touch(true);
  for (let i = 0; i < 180; i++) a.advance();
  await a.settle(); await a.tracking.flush();
  assert.equal([...a.database.values()][0].seconds, 120);
  assert.equal([...a.database.values()][0].active, false);
  a.tracking.touch(); a.advance(); a.tracking.stop(); await a.settle(); await a.tracking.flush();
  assert.equal(a.database.size, 2);
  assert.equal([...a.database.values()].reduce((n, r) => n + r.games, 0), 1);
});
test('suspended timers and background tabs do not count hours as play', async () => {
  const a = app(); a.tracking.touch(true); a.advance();
  a.advance(3600000); await a.settle(); await a.tracking.flush();
  assert.equal([...a.database.values()][0].seconds, 1);
  a.context.document.hidden = true; a.tracking.touch(true);
  assert.equal(a.database.size, 1);
});
test('crash recovery sends a final inactive snapshot', async () => {
  const a = app(); a.fail(true); a.tracking.touch(true); a.advance();
  await a.settle();
  const b = app(a.saved); await b.settle(); await b.tracking.flush();
  assert.equal([...b.database.values()][0].active, false);
});
test('a snapshot saved during an upload is retained for the next flush', async () => {
  const a = app(); let release; a.wait(new Promise(r => { release = r; }));
  a.tracking.touch(true); a.advance(); a.tracking.stop();
  release(); await a.settle(); a.wait(null); await a.tracking.flush();
  assert.equal([...a.database.values()][0].seconds, 1);
  assert.equal([...a.database.values()][0].active, false);
});
test('a previous disabled switch upgrades to automatic tracking with the same device ID', async () => {
  const id = 'a'.repeat(32);
  const saved = new Map([['patience.sharing.v1', JSON.stringify({key: id, enabled: false})]]);
  const a = app(saved);
  a.tracking.touch(true); a.advance(); a.tracking.stop(); await a.settle(); await a.tracking.flush();
  assert.equal(a.database.size, 1);
  assert.equal(a.tracking.deviceId, id);
  assert.ok([...a.database.keys()][0].includes('/sessions/' + id + '/'));
  const b = app(saved); assert.equal(b.tracking.deviceId, id);
});
test('different installations have separate device IDs', () => {
  assert.notEqual(app().tracking.deviceId, app().tracking.deviceId);
});
test('sessions split at Amsterdam midnight', async () => {
  const a = app(); a.setTime(Date.parse('2026-10-11T21:59:58Z'));
  a.tracking.touch(true); a.advance(); a.advance(); a.advance();
  a.tracking.stop(); await a.settle(); await a.tracking.flush();
  assert.equal(a.database.size, 2);
  assert.equal([...a.database.values()].reduce((n, r) => n + r.seconds, 0), 3);
});
