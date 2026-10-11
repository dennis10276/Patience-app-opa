const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'tracking.js'), 'utf8');
function app(saved = new Map(), storage = {}) {
  let now = Date.parse('2026-10-11T10:00:00Z');
  const events = {}, requests = [], database = new Map(), profiles = new Map(), intervals = [];
  let failed = false, waiting = null;
  const context = {
    Date: class extends Date { static now() { return now; } }, Intl,
    crypto: webcrypto, AbortController, URL, location: { href: 'https://example.test/patience/' },
    navigator: { onLine: true }, document: { hidden: false, addEventListener(k, fn) { events[k] = fn; } },
    localStorage: { getItem: k => { if (storage.readFails) throw new Error('blocked'); return saved.get(k); }, setItem: (k, v) => { if (storage.writeFails) throw new Error('quota'); saved.set(k, v); } },
    setInterval: fn => intervals.push(fn), setTimeout, clearTimeout,
    addEventListener(k, fn) { events[k] = fn; },
    async fetch(url, options) {
      requests.push({ url, data: JSON.parse(options.body) });
      if (waiting) await waiting;
      if (failed) throw new TypeError('offline');
      if (url.includes('/players/')) profiles.set(url, { ...profiles.get(url), ...JSON.parse(options.body) });
      else database.set(url, JSON.parse(options.body));
      return { ok: true };
    },
    PATIENCE_TRACKING: { databaseUrl: 'https://example.firebasedatabase.app' }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {
    tracking: context.PatienceTracking, requests, database, profiles, saved, context, events, intervals,
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

test('failed identity persistence skips tracking and recovers when storage works', async () => {
  const storage = { writeFails: true }, a = app(new Map(), storage);
  a.tracking.touch(true); a.advance(); a.tracking.stop(); await a.settle();
  assert.equal(a.requests.length, 0);
  storage.writeFails = false;
  a.tracking.touch(true); a.advance(); a.tracking.stop(); await a.settle(); await a.tracking.flush();
  assert.equal(a.database.size, 1);
  assert.equal([...a.database.values()][0].seconds, 1);
  assert.equal(app(a.saved).tracking.deviceId, a.tracking.deviceId);
});

test('blocked reads never upload an unstable identity', async () => {
  const a = app(new Map(), { readFails: true });
  a.tracking.touch(true); a.advance(); await a.tracking.flush();
  assert.equal(a.requests.length, 0);
});

test('quota errors still allow tracking with an already persisted identity', async () => {
  const id = 'a'.repeat(32), a = app(new Map([['patience.sharing.v1', JSON.stringify({ key: id })]]), { writeFails: true });
  a.tracking.touch(true); a.advance(); a.tracking.stop(); await a.settle(); await a.tracking.flush();
  assert.equal(a.database.size, 1);
  assert.ok([...a.database.keys()][0].includes('/sessions/' + id + '/'));
});

test('players register automatically once per visit without overwriting their name', async () => {
  const a = app(); a.tracking.touch(true); await a.settle(); a.advance(); a.tracking.stop(); await a.settle(); await a.tracking.flush();
  a.tracking.touch(); a.tracking.stop(); await a.settle(); await a.tracking.flush();
  const registrations = a.requests.filter(r => r.url.includes('/players/'));
  assert.equal(registrations.length, 1);
  assert.deepEqual(Object.keys(registrations[0].data), ['device']);
  assert.equal(a.profiles.size, 1);
});
test('sessions split at Amsterdam midnight', async () => {
  const a = app(); a.setTime(Date.parse('2026-10-11T21:59:58Z'));
  a.tracking.touch(true); a.advance(); a.advance(); a.advance();
  a.tracking.stop(); await a.settle(); await a.tracking.flush();
  assert.equal(a.database.size, 2);
  assert.equal([...a.database.values()].reduce((n, r) => n + r.seconds, 0), 3);
});


test('observed endings retain progress, last action and the same attempt across pauses', async () => {
  const a = app(), round = 'c'.repeat(32);
  a.tracking.touch(true, { round, progress: 4, total: 52, score: 20, build: 'test' });
  a.tracking.action('hint'); a.advance();
  a.tracking.state({ progress: 5, score: 30 }); a.tracking.action('move');
  a.tracking.stop('pause'); await a.settle(); await a.tracking.flush();
  a.tracking.touch(false, { round, progress: 5, total: 52 }); a.tracking.action('undo'); a.tracking.stop('hidden');
  await a.settle(); await a.tracking.flush();
  const records = [...a.database.values()];
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(r => r.detail.reason), ['pause', 'hidden']);
  assert.ok(records.every(r => r.detail.round === round));
  assert.equal(records[0].detail.initial, 4); assert.equal(records[0].detail.progress, 5);
  assert.equal(records[0].detail.lastAction, 'move'); assert.equal(records[0].detail.actions.hint, 1);
  assert.equal(records[1].detail.actions.hint, undefined);
  assert.equal(records[1].detail.actions.undo, 1);
});

test('choosing restart after a menu refines its existing ending, but never overwrites a win', async () => {
  const a = app(); a.tracking.touch(true); a.tracking.action('draw'); a.tracking.stop('menu');
  await a.settle(); await a.tracking.flush();
  a.tracking.stop('restart'); await a.settle(); await a.tracking.flush();
  assert.equal(a.database.size, 1); assert.equal([...a.database.values()][0].detail.reason, 'restart');
  a.tracking.touch(true); a.tracking.win(); await a.settle(); await a.tracking.flush();
  a.tracking.stop('new_game'); await a.settle(); await a.tracking.flush();
  assert.equal([...a.database.values()][1].detail.reason, 'won');
});

test('idle, suspended timers and recovered uploads have distinct non-personal endings', async () => {
  const a = app(); a.tracking.touch(true); a.tracking.action('hint');
  for (let i = 0; i < 121; i++) a.advance();
  await a.settle(); await a.tracking.flush();
  assert.equal([...a.database.values()][0].detail.reason, 'idle');
  assert.equal([...a.database.values()][0].detail.maxGap, 120);
  a.tracking.touch(); a.advance(10000); await a.settle(); await a.tracking.flush();
  assert.equal([...a.database.values()][1].detail.reason, 'suspended');
  const offline = app(); offline.fail(true); offline.tracking.touch(true); offline.tracking.action('move');
  await offline.settle(); const restored = app(offline.saved); await restored.settle(); await restored.tracking.flush();
  assert.equal([...restored.database.values()][0].detail.reason, 'recovered');
  assert.equal([...restored.database.values()][0].detail.actions.move, 1);
});
