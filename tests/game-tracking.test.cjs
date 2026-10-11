const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

// Run the actual game and tracker together; the DOM only supplies rendering surfaces.
function app() {
  let now = Date.parse('2026-10-11T10:00:00Z');
  const nodes = new Map(), intervals = [], saved = new Map(), records = new Map();
  function node() {
    return {
      children: [], dataset: {}, hidden: true, textContent: '', className: '', listeners: {},
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, clientWidth: 1024, clientHeight: 700, getBoundingClientRect() { return { left: 0, top: 0, width: 1024, height: 700 }; }, getContext() { return { setTransform() {}, clearRect() {} }; },
      addEventListener(k, fn) { this.listeners[k] = fn; }, setAttribute() {}, scrollIntoView() {},
      appendChild(n) { this.children.push(n); }, querySelector() { return node(); }, querySelectorAll() { return []; },
      get firstChild() { return this.children[0]; }, get firstElementChild() { return this.children[0]; },
      get lastChild() { return this.children.at(-1); },
      set innerHTML(value) {
        this.html = value;
        if (value.startsWith('<span class="v">')) {
          const notes = node(); notes.children = Array.from({ length: 9 }, node);
          this.children = [node(), notes];
        }
      }, get innerHTML() { return this.html || ''; }
    };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  get('modal').children.push(node());
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } }, Intl, crypto: webcrypto, AbortController,
    navigator: { onLine: true, standalone: true }, location: { protocol: 'https:' }, innerWidth: 1024, innerHeight: 768, Image: class {}, cancelAnimationFrame() {},
    localStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) },
    document: { hidden: false, body: node(), documentElement: node(), getElementById: get, createElement: node,
      querySelector: get, querySelectorAll: () => [], addEventListener() {} },
    setInterval(fn, ms) { intervals.push({ fn, ms }); }, setTimeout() { return 1; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); }, getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0' }),
    addEventListener() {}, PATIENCE_TRACKING: { databaseUrl: 'https://example.firebasedatabase.app' },
    async fetch(url, options) { if (url.includes('/sessions/')) records.set(url, JSON.parse(options.body)); return { ok: true }; }
  });
  context.window = context; context.self = context;
  for (const file of ['tracking.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return {
    game: context.__patience, nodes, records,
    advance(seconds) { for (let i = 0; i < seconds; i++) { now += 1000; intervals.filter(x => x.ms === 1000).forEach(x => x.fn()); } },
    async flush() { await new Promise(r => setImmediate(r)); await context.PatienceTracking.flush(); }
  };
}

test('Patience draw, undo and hint reach progress summaries; restart preserves the ending', async () => {
  const a = app(); a.game.drawStock(); const round = a.game.G.playId;
  a.advance(3); a.game.undo(); a.game.hint();
  a.game.newGame(true, true); await a.flush();
  assert.equal([...a.records.values()][0].detail.reason, 'menu');
  // Use the existing game action for the confirmed restart.
  a.nodes.get('modal').hidden = true; a.game.newGame(false, true); a.game.drawStock();
  a.nodes.get('bar').children.at(-1).listeners.click(); await a.flush();
  const records = [...a.records.values()];
  assert.equal(records[0].detail.reason, 'restart');
  assert.equal(records[0].detail.actions.draw, 1); assert.equal(records[0].detail.actions.undo, 1); assert.equal(records[0].detail.actions.hint, 1);
  assert.equal(records[0].detail.round, round); assert.notEqual(records[1].detail.round, round);
});

test('Patience failed card taps are counted as unsuccessful actions, not inferred frustration', async () => {
  const a = app(); const buried = a.game.G.tab[6][0]; a.game.autoMove(buried);
  a.nodes.get('bar').children.at(-1).listeners.click(); await a.flush();
  const r = [...a.records.values()][0];
  assert.equal(r.detail.actions.blocked, 1); assert.equal(r.detail.lastAction, 'blocked');
  assert.equal(r.detail.reason, 'menu'); assert.equal(r.detail.progress, 0);
});

test('Patience win snapshots full foundation progress and terminates before its result dialog', async () => {
  const a = app(); a.game.drawStock();
  a.game.G.found = Array.from({ length: 4 }, (_, suit) => Array.from({ length: 13 }, (_, rank) => suit * 13 + rank));
  a.game.afterChange(); await a.flush();
  const r = [...a.records.values()][0];
  assert.equal(r.wins, 1); assert.equal(r.detail.reason, 'won'); assert.equal(r.detail.progress, 52);
});
