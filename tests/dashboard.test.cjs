const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'dash', 'dashboard.js'), 'utf8');
function dashboard(hash = '#' + 'a'.repeat(32), saved = new Map()) {
  let now = Date.parse('2026-10-11T22:30:00Z');
  const nodes = new Map(), intervals = [], streams = [], listeners = {};
  const node = () => ({ textContent: '', value: '', children: [], style: {}, classList: { toggle() {} }, appendChild(c) { this.children.push(c); }, append(...c) { this.children.push(...c); }, replaceChildren() { this.children = []; } });
  const context = {
    Date: class extends Date { static now() { return now; } }, Intl, URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: { hash }, history: { replaceState(a, b, hash) { context.location.hash = hash; } },
    localStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) },
    async fetch(url, options) { return { ok: true }; },
    PATIENCE_TRACKING: { databaseUrl: 'https://example.firebasedatabase.app' },
    document: { hidden: false, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node, addEventListener(k, fn) { listeners[k] = fn; } },
    addEventListener(k, fn) { listeners[k] = fn; }, setInterval(fn) { intervals.push(fn); },
    EventSource: class {
      constructor(url) { this.url = url; this.listeners = {}; streams.push(this); }
      addEventListener(k, fn) { this.listeners[k] = fn; }
      close() { this.closed = true; }
      emit(kind, data) { this.listeners[kind]({ data: JSON.stringify(data) }); }
    }
  };
  context.window = context; vm.runInNewContext(source, context);
  return { nodes, streams, context, listeners, get now() { return now; }, advance(ms) { now += ms; intervals.forEach(fn => fn()); } };
}
test('Amsterdam day totals, week totals and live status use session summaries', () => {
  const a = dashboard();
  a.streams[0].emit('put', { path: '/', data: {
    today: { start: a.now - 1800000, last: a.now, seconds: 1800, games: 1, wins: 0, active: true },
    yesterday: { start: a.now - 5400000, last: a.now - 4800000, seconds: 600, games: 2, wins: 1, active: false }
  } });
  assert.equal(a.nodes.get('todayTime').textContent, '30 min');
  assert.equal(a.nodes.get('weekTime').textContent, '40 min');
  assert.equal(a.nodes.get('todayGames').textContent, '1 spel');
  assert.equal(a.nodes.get('status').textContent, 'Nu aan het spelen');
  a.advance(80000);
  assert.equal(a.nodes.get('status').textContent, 'Nu niet actief');
});
test('stream updates replace existing sessions and support patches and removals', () => {
  const a = dashboard(), s = a.streams[0];
  const record = { start: a.now - 60000, last: a.now, seconds: 60, games: 1, wins: 0, active: true };
  s.emit('put', { path: '/', data: { one: record } });
  s.emit('put', { path: '/one', data: { ...record, seconds: 120 } });
  assert.equal(a.nodes.get('todayTime').textContent, '2 min');
  assert.equal(a.nodes.get('sessions').children.length, 1);
  s.emit('patch', { path: '/one', data: { active: false } });
  assert.equal(a.nodes.get('status').textContent, 'Nu niet actief');
  s.emit('put', { path: '/one', data: null });
  assert.equal(a.nodes.get('sessions').children.length, 0);
  assert.equal(a.nodes.get('todayTime').textContent, '0 sec');
});
test('disconnects suppress live status and hidden tabs close their connection', () => {
  const a = dashboard(), s = a.streams[0];
  s.emit('put', { path: '/', data: { one: { start: a.now, last: a.now, seconds: 0, games: 1, wins: 0, active: true } } });
  s.onerror(); assert.equal(a.nodes.get('status').textContent, 'Geen verbinding');
  a.context.document.hidden = true; a.listeners.visibilitychange(); assert.equal(s.closed, true);
  assert.equal(a.streams[1].closed, true);
  a.context.document.hidden = false; a.listeners.visibilitychange(); assert.equal(a.streams.length, 4);
});

test('root dashboard discovers players and prefers Opa without a code', () => {
  const a = dashboard(''), id = 'b'.repeat(32);
  assert.ok(a.streams[0].url.endsWith('/players.json'));
  a.streams[0].emit('put', { path: '/', data: { ['a'.repeat(32)]: { device: 'Computer' }, [id]: { device: 'iPad', name: 'Opa' } } });
  assert.equal(a.nodes.get('who').children.length, 2);
  assert.equal(a.nodes.get('who').value, id);
  assert.equal(a.context.location.hash, '#' + id);
  assert.ok(a.streams[1].url.includes('/sessions/' + id));
});

test('switching players clears totals and ignores late events from old streams', () => {
  const a = dashboard(), old = a.streams[0], id = 'b'.repeat(32);
  const record = { start: a.now - 60000, last: a.now, seconds: 60, games: 1, wins: 0, active: true };
  old.emit('put', { path: '/', data: { one: record } });
  a.streams[1].emit('put', { path: '/', data: { ['a'.repeat(32)]: { name: 'Opa' }, [id]: { device: 'Computer' } } });
  a.nodes.get('who').value = id; a.nodes.get('who').onchange();
  assert.equal(old.closed, true);
  assert.equal(a.nodes.get('todayTime').textContent, '0 sec');
  old.emit('put', { path: '/', data: { one: record } }); old.onerror();
  assert.equal(a.nodes.get('sessions').children.length, 0);
  a.streams[2].emit('put', { path: '/', data: {} });
  assert.equal(a.nodes.get('status').textContent, 'Nu niet actief');
  a.streams[1].emit('patch', { path: '/' + id, data: { name: '<script>hello</script>' } });
  assert.equal(a.nodes.get('who').value, id);
  assert.ok(a.nodes.get('who').children.some(n => n.textContent.includes('<script>')));
});

test('bookmarks and remembered selections survive an empty registry', () => {
  const id = 'b'.repeat(32), saved = new Map([['patience.dashboard.player', id]]);
  const a = dashboard('', saved);
  a.streams[1].emit('put', { path: '/', data: null });
  assert.equal(a.nodes.get('who').value, id);
  const b = dashboard('#' + 'c'.repeat(32), saved);
  assert.equal(b.nodes.get('who').value, 'c'.repeat(32));
});

test('empty registry and denied access explain the actual state', () => {
  const a = dashboard(''); a.streams[0].emit('put', { path: '/', data: null });
  assert.equal(a.nodes.get('empty').hidden, false); assert.equal(a.nodes.get('who').disabled, true);
  a.streams[0].emit('cancel', {});
  assert.match(a.nodes.get('notice').textContent, /Firebase-regels/);
});

test('fractional and out-of-range records cannot distort totals', () => {
  const a = dashboard(), record = { start: a.now - 60000, last: a.now, seconds: 60, games: 1, wins: 0, active: true };
  a.streams[0].emit('put', { path: '/', data: { valid: record, invalid: { ...record, games: 0.5 }, huge: { ...record, seconds: 90001 } } });
  assert.equal(a.nodes.get('todayGames').textContent, '1 spel');
  assert.equal(a.nodes.get('sessions').children.length, 1);
});

test('renaming updates Firebase and preserves the selected player', async () => {
  const a = dashboard(), id = 'a'.repeat(32); let request;
  a.context.fetch = async (url, options) => { request = { url, data: JSON.parse(options.body) }; return { ok: true }; };
  a.nodes.get('playerName').value = 'Opa';
  await a.nodes.get('nameForm').onsubmit({ preventDefault() {} });
  assert.ok(request.url.includes('/players/' + id));
  assert.equal(request.data.name, 'Opa');
  assert.equal(a.nodes.get('who').value, id);
  assert.equal(a.nodes.get('nameStatus').textContent, 'Naam opgeslagen.');
});
