const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'dash', 'dashboard.js'), 'utf8');

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32), D = 'd'.repeat(32);
function dashboard(hash = '', saved = new Map(), search = '') {
  let now = Date.parse('2026-10-18T10:30:00Z');
  const nodes = new Map(), intervals = [], streams = [], listeners = {}, fetches = [];
  const node = () => ({
    listeners: {}, children: [], textContent: '', value: '', hidden: false, className: '', dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener(k, fn) { this.listeners[k] = fn; },
    appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
  });
  const context = {
    Date: class extends Date { static now() { return now; } }, Intl, URLSearchParams, AbortController, setTimeout() { return 0; }, clearTimeout() {},
    location: { hash, search, pathname: '/Patience-app-opa/dash/' },
    history: { replaceState(a, b, value) { const u = new URL(value, 'https://x.test' + context.location.pathname); context.location.hash = u.hash; context.location.search = u.search; } },
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) },
    async fetch(url, options) { fetches.push({ url, options }); return { ok: true }; },
    PATIENCE_TRACKING: { databaseUrl: 'https://example.firebasedatabase.app' },
    document: { hidden: false, title: '', getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node, addEventListener(k, fn) { listeners[k] = fn; } },
    addEventListener(k, fn) { listeners[k] = fn; }, setInterval(fn) { intervals.push(fn); },
    EventSource: class {
      constructor(url) { this.url = url; this.listeners = {}; streams.push(this); }
      addEventListener(k, fn) { this.listeners[k] = fn; }
      close() { this.closed = true; }
      emit(kind, data) { this.listeners[kind]({ data: JSON.stringify(data) }); }
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const text = id => nodes.get(id)?.textContent;
  const stream = part => streams.filter(s => !s.closed && s.url.includes(part)).pop();
  return { nodes, streams, context, listeners, fetches, text, stream, api: context.OpaDashboard,
    get now() { return now; }, advance(ms) { now += ms; intervals.forEach(fn => fn()); } };
}
const plain = v => JSON.parse(JSON.stringify(v));
const rec = (now, o = {}) => ({ start: now - 600000, last: now, seconds: 600, games: 1, wins: 0, active: false, ...o });
const sudoku = (now, o = {}) => rec(now, { app: 'sudoku', level: 'easy', daily: false, hints: 0, mistakes: 0, ...o });
const detail = (r, o = {}) => ({ v: 2, round: 'e'.repeat(32), reason: 'menu', progress: 10, initial: 0, total: 40, lastAction: 'input', actionAt: r.last, lastProgressAt: r.last, maxGap: 30, ended: r.last, actions: { input: 10 }, ...o });

test('records are checked: bad numbers, unknown apps and broken Sudoku data never count', () => {
  const { api } = dashboard(), now = Date.parse('2026-10-18T10:00:00Z');
  const good = rec(now), s = sudoku(now);
  const list = api.sanitize({
    good, s,
    frac: { ...good, seconds: 1.5 }, future: { ...good, last: good.start - 1 }, app: { ...good, app: 'chess' },
    lvl: { ...s, level: 'impossible' }, hints: { ...s, hints: -1 }, junk: 'x',
    badDetail: { ...good, detail: { v: 2, round: 'nope' } },
  }, A, 'iPhone');
  assert.deepEqual(plain(list.map(r => r.id).sort()), ['good', 's']);
});

test('the Sudoku level comes from the mode field and rejects nonsense', () => {
  const { api } = dashboard();
  assert.deepEqual(plain(api.parseLevel('L37|38')), { played: 37, reached: 38, daily: false });
  assert.deepEqual(plain(api.parseLevel('D|12')), { played: null, reached: 12, daily: true });
  for (const bad of ['L40|38', 'L0|3', 'X|3', 'L1|', '<img>|3', 3, null]) assert.equal(api.parseLevel(bad), null);
});

test('devices with the same name are one player; the usual spelling is shown', () => {
  const { api } = dashboard();
  const g = api.people({ [A]: { device: 'iPhone', name: 'Opa' }, [B]: { device: 'iPhone', name: 'OPa' }, [C]: { device: 'iPhone', name: ' opa ' }, [D]: { device: 'Computer' } });
  const opa = [...g.values()].find(x => x.name);
  assert.equal(opa.name, 'Opa'); assert.deepEqual(plain(opa.keys), [A, B, C].sort());
  assert.equal([...g.values()].filter(x => !x.name).length, 1);
});

test('without a link the dashboard picks Opa and listens to every device of Opa', () => {
  const a = dashboard();
  assert.ok(a.streams[0].url.endsWith('/players.json'));
  a.streams[0].emit('put', { path: '/', data: { [A]: { device: 'iPhone', name: 'Opa' }, [B]: { device: 'iPhone', name: 'OPa' }, [D]: { device: 'Computer', name: 'Test' } } });
  assert.equal(a.text('who-name'), 'Opa');
  assert.ok(a.stream('/sessions/' + A) && a.stream('/sessions/' + B));
  assert.ok(!a.stream('/sessions/' + D));
  assert.equal(a.context.location.hash, '#' + A);
});

test('time from both apps on one phone adds up, and the level and live status show', () => {
  const a = dashboard('#' + B);
  a.streams.find(s => s.url.endsWith('/players.json')).emit('put', { path: '/', data: { [A]: { device: 'iPhone', name: 'Opa' }, [B]: { device: 'iPhone', name: 'OPa' } } });
  const now = a.now;
  const live = sudoku(now, { active: true, wins: 1, start: now - 1200000, seconds: 1200 });
  live.detail = detail(live, { reason: 'playing', ended: undefined, mode: 'L37|38', build: 'sudoku-15' });
  delete live.detail.ended;
  a.stream('/sessions/' + A).emit('put', { path: '/', data: { p: rec(now - 3600000, { seconds: 900 }) } });
  a.stream('/sessions/' + B).emit('put', { path: '/', data: { s: live } });
  assert.equal(a.text('figToday'), '35 min');
  assert.equal(a.text('figLevel'), 38);
  assert.match(a.text('statusText'), /Speelt nu Sudoku · level 37/);
  a.advance(80000);
  assert.match(a.text('statusText'), /^Laatst gespeeld vandaag/);
});

test('Sudoku levels from before the new level list (build 14 and older) are ignored', () => {
  const a = dashboard('#' + A);
  a.streams.find(s => s.url.endsWith('/players.json')).emit('put', { path: '/', data: { [A]: { device: 'iPhone', name: 'Opa' } } });
  const now = a.now;
  const old = sudoku(now - 7200000, { wins: 1 }); old.detail = detail(old, { mode: 'L40|41', build: 'sudoku-14' });
  const fresh = sudoku(now - 3600000, { wins: 1 }); fresh.detail = detail(fresh, { mode: 'L2|3', build: 'sudoku-15' });
  a.stream('/sessions/' + A).emit('put', { path: '/', data: { o: old, f: fresh } });
  assert.equal(a.text('figLevel'), 3);
});

test('the game filter keeps the apps apart', () => {
  const a = dashboard('#' + A);
  const now = a.now;
  a.stream('/sessions/' + A).emit('put', { path: '/', data: { p: rec(now, { seconds: 300 }), s: sudoku(now, { seconds: 600 }) } });
  assert.equal(a.text('figToday'), '15 min');
  const seg = a.nodes.get('gameSeg');
  seg.listeners.click({ target: { dataset: { v: 'sudoku' } } });
  assert.equal(a.text('figToday'), '10 min');
  assert.match(a.context.location.search, /game=sudoku/);
});

test('live updates, patches and removals; disconnects and hidden tabs', () => {
  const a = dashboard('#' + A), s = a.stream('/sessions/' + A), now = a.now;
  s.emit('put', { path: '/', data: { one: rec(now, { active: true, seconds: 60, start: now - 60000 }) } });
  assert.match(a.text('statusText'), /Speelt nu Patience/);
  s.emit('patch', { path: '/one', data: { seconds: 120 } });
  assert.equal(a.text('figToday'), '2 min');
  s.emit('put', { path: '/one', data: null });
  assert.equal(a.text('figToday'), '0 min');
  s.onerror();
  assert.equal(a.text('statusText'), 'Geen verbinding met de database');
  a.context.document.hidden = true; a.listeners.visibilitychange();
  assert.ok(a.streams.every(x => x.closed));
  a.context.document.hidden = false; a.listeners.visibilitychange();
  assert.ok(a.stream('/sessions/' + A));
});

test('renaming a device saves the name and joins it to the player with that name', async () => {
  const a = dashboard('#' + B);
  a.streams.find(s => s.url.endsWith('/players.json')).emit('put', { path: '/', data: { [A]: { device: 'iPhone', name: 'Opa' }, [B]: { device: 'iPhone' } } });
  const form = a.nodes.get('devices').children[0];
  const input = form.children.find(c => c.maxLength === 40);
  input.value = 'Opa';
  await form.onsubmit({ preventDefault() {} });
  assert.equal(a.fetches[0].url, `https://example.firebasedatabase.app/players/${B}.json`);
  assert.deepEqual(JSON.parse(a.fetches[0].options.body), { name: 'Opa' });
  assert.ok(a.stream('/sessions/' + A) && a.stream('/sessions/' + B));
});

test('names from the database are shown as plain text, never as markup', () => {
  const a = dashboard();
  a.streams[0].emit('put', { path: '/', data: { [A]: { device: 'iPhone', name: '<img src=x onerror=alert(1)>' } } });
  assert.equal(a.text('who-name'), '<img src=x onerror=alert(1)>');
  assert.equal(a.nodes.get('who').children[0].textContent.startsWith('<img'), true);
  assert.ok(!a.nodes.get('devices').children.some(c => (c._html || '').includes('<img')));
});

test('a bookmarked device keeps working before the player list arrives', () => {
  const a = dashboard('#' + C);
  assert.ok(a.stream('/sessions/' + C));
  assert.equal(a.context.location.hash, '#' + C);
});

test('signals point out struggles without guessing reasons', () => {
  const { api } = dashboard();
  const now = Date.parse('2026-10-18T10:00:00Z');
  const r = sudoku(now, { mistakes: 3 }); r.detail = detail(r, { stops: { lost: 2 } });
  const all = api.sanitize({ r }, A, 'iPhone');
  const s = api.summarize(all, 'all', 30, now);
  const out = api.signals(s, all, now).map(x => x.text).join(' | ');
  assert.match(out, /2 keer 3 fouten/);
  assert.match(out, /Gespeeld op 1 dag/);
});
