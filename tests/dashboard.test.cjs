const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'dash', 'dashboard.js'), 'utf8');
function dashboard() {
  let now = Date.parse('2026-10-11T22:30:00Z');
  const nodes = new Map(), intervals = [], streams = [], listeners = {};
  const node = () => ({ textContent: '', children: [], style: {}, classList: { toggle() {} }, appendChild(c) { this.children.push(c); }, append(...c) { this.children.push(...c); }, replaceChildren() { this.children = []; } });
  const context = {
    Date: class extends Date { static now() { return now; } }, Intl, URLSearchParams,
    location: { hash: '#' + 'a'.repeat(32), reload() {} },
    PATIENCE_TRACKING: { databaseUrl: 'https://example.firebasedatabase.app' },
    document: { hidden: false, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node, addEventListener(k, fn) { listeners[k] = fn; } },
    addEventListener() {}, setInterval(fn) { intervals.push(fn); },
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
  a.context.document.hidden = false; a.listeners.visibilitychange(); assert.equal(a.streams.length, 2);
});
