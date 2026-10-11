/* Patience (Klondike) – Nederlandse versie zonder reclame */
(() => {
'use strict';

const VERSION = '1.14.1';
const playTracking = window.PatienceTracking;
const LS_GAME = 'patience.game.v1';
const LS_SET = 'patience.settings.v1';
const LS_STATS = 'patience.stats.v1';

/* ================= Storage helpers ================= */
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

/* ================= Settings ================= */
const DEFAULTS = {
  draw: 3, vegas: false, vegasCumulative: true,
  deck: 'klassiek', letters: 'en', size: 'groot', hand: 'rechts',
  sound: true, showTime: true, unveil: false, colHeight: 'dynamisch',
  shadows: true, back: 'blauw', felt: 'groen', speed: 'normaal',
  autoFinish: true, tapMove: true,
  bar: { newg: true, restart: false, hint: true, undo: true, stats: false }
};
const S = Object.assign({}, DEFAULTS, load(LS_SET, {}));
S.bar = Object.assign({}, DEFAULTS.bar, S.bar || {});
function saveSettings() { store(LS_SET, S); }

/* ================= Stats ================= */
function emptyStat() { return { played: 0, won: 0, streak: 0, bestStreak: 0, bestScore: null, bestTime: null, bestMoves: null, totalWinTime: 0 }; }
const ST = Object.assign({ d1: emptyStat(), d3: emptyStat(), vegasTotal: 0 }, load(LS_STATS, {}));
function saveStats() { store(LS_STATS, ST); }

/* ================= Cards ================= */
const rankOf = id => id % 13 + 1;
const suitOf = id => Math.floor(id / 13);  // 0 schoppen, 1 harten, 2 ruiten, 3 klaveren
const isRed = id => { const s = suitOf(id); return s === 1 || s === 2; };
const SUIT_NAMES = ['schoppen', 'harten', 'ruiten', 'klaveren'];
const LETTERS = {
  en: { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' },
  nl: { 1: 'A', 11: 'B', 12: 'V', 13: 'H' },
  fr: { 1: 'A', 11: 'V', 12: 'D', 13: 'R' }
};
const rankText = r => (LETTERS[S.letters] || LETTERS.en)[r] || String(r);

/* ================= Random (seeded) ================= */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ================= Game state ================= */
let G = null;        // current game
let H = [];          // undo history (JSON strings)
let busy = false;    // auto-finish running
let hintIdx = 0;
let stuckShown = false;

function newGameState(seed, draw, vegas) {
  const rnd = mulberry32(seed);
  const deck = [...Array(52).keys()];
  for (let i = 51; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const up = new Array(52).fill(0);
  const tab = [[], [], [], [], [], [], []];
  let k = 0;
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) {
      const c = deck[k++]; tab[col].push(c);
      if (col === row) up[c] = 1;
    }
  }
  const stock = deck.slice(k);
  return {
    seed, draw, vegas,
    stock, waste: [], found: [[], [], [], []], tab, up,
    fan: 0, score: vegas ? -52 : 0, moves: 0, time: 0, passes: 1,
    started: false, counted: false, won: false, vegasBase: 0
  };
}

function snapshot() { const { ...o } = G; return JSON.stringify(o); }
function saveGame() { store(LS_GAME, { G, H: H.slice(-250), v: VERSION }); }

/* ================= Rules ================= */
function top(arr) { return arr.length ? arr[arr.length - 1] : -1; }

function foundTarget(id) {
  const r = rankOf(id), s = suitOf(id);
  for (let f = 0; f < 4; f++) {
    const t = top(G.found[f]);
    if (t >= 0 && suitOf(t) === s && rankOf(t) === r - 1) return f;
  }
  if (r === 1) for (let f = 0; f < 4; f++) if (!G.found[f].length) return f;
  return -1;
}
function canFound(id, f) {
  const t = top(G.found[f]);
  if (t < 0) return rankOf(id) === 1;
  return suitOf(t) === suitOf(id) && rankOf(id) === rankOf(t) + 1;
}
function canTab(id, t) {
  const p = G.tab[t];
  if (!p.length) return rankOf(id) === 13;
  const c = top(p);
  return G.up[c] && isRed(c) !== isRed(id) && rankOf(c) === rankOf(id) + 1;
}
function locate(id) {
  for (let t = 0; t < 7; t++) { const i = G.tab[t].indexOf(id); if (i >= 0) return { type: 'tab', i: t, idx: i }; }
  let i = G.waste.indexOf(id); if (i >= 0) return { type: 'waste', i: 0, idx: i };
  for (let f = 0; f < 4; f++) { i = G.found[f].indexOf(id); if (i >= 0) return { type: 'found', i: f, idx: i }; }
  i = G.stock.indexOf(id); return { type: 'stock', i: 0, idx: i };
}
function pileOf(loc) {
  if (loc.type === 'tab') return G.tab[loc.i];
  if (loc.type === 'found') return G.found[loc.i];
  if (loc.type === 'waste') return G.waste;
  return G.stock;
}
/* which cards would be picked up when grabbing card id (null if not movable) */
function grabSet(id) {
  const loc = locate(id);
  const p = pileOf(loc);
  if (loc.type === 'stock') return null;
  if (loc.type === 'tab') { if (!G.up[id]) return null; return { loc, ids: p.slice(loc.idx) }; }
  if (loc.idx !== p.length - 1) return null;
  return { loc, ids: [id] };
}
function maxPasses() { return G.vegas ? (G.draw === 1 ? 1 : 3) : Infinity; }
function canRecycle() { return G.waste.length > 0 && G.passes < maxPasses(); }

/* ================= Actions ================= */
function trackingDetails() {
  if (!G) return {};
  if (!G.playId) G.playId = playTracking?.newRound();
  return { round: G.playId, build: VERSION, mode: (G.vegas ? 'vegas' : 'draw') + G.draw,
    progress: G.found.reduce((n, p) => n + p.length, 0), total: 52, score: G.score, gameSeconds: G.time,
    tapMove: !!S.tapMove, autoFinish: !!S.autoFinish };
}
function endTracking(reason) { playTracking?.state(trackingDetails()); playTracking?.stop(reason); }
function trackAction(name) { startClock(); playTracking?.action(name, trackingDetails()); saveGame(); }
function startClock() {
  const started = G.trackingStarted == null ? G.counted : G.trackingStarted;
  if (playTracking?.touch(!started, trackingDetails())) G.trackingStarted = true;
  if (!G.started) { G.started = true; }
  if (!G.counted) {
    G.counted = true;
    const st = ST['d' + G.draw]; st.played++;
    if (G.vegas && S.vegasCumulative) { G.vegasBase = ST.vegasTotal; ST.vegasTotal -= 52; }
    saveStats();
  }
}
function pushHistory() { H.push(snapshot()); if (H.length > 400) H.shift(); }
function addScore(n) {
  if (G.vegas) { G.score += n; if (S.vegasCumulative) { ST.vegasTotal += n; saveStats(); } }
  else G.score = Math.max(0, G.score + n);
}

let lifted = new Set();
function liftCards(ids) {
  ids.forEach(i => lifted.add(i));
  clearTimeout(liftCards.t);
  liftCards.t = setTimeout(() => { lifted.clear(); render(); }, speedMs() + 80);
}

function moveCards(ids, from, toType, toIdx) {
  pushHistory();
  startClock();
  const src = pileOf(from);
  src.splice(src.length - ids.length, ids.length);
  const dst = toType === 'tab' ? G.tab[toIdx] : G.found[toIdx];
  dst.push(...ids);
  ids.forEach(i => G.up[i] = 1);
  // scoring
  if (G.vegas) {
    if (toType === 'found' && from.type !== 'found') addScore(5);
    if (from.type === 'found' && toType !== 'found') addScore(-5);
  } else {
    if (from.type === 'waste' && toType === 'tab') addScore(5);
    if (from.type === 'waste' && toType === 'found') addScore(10);
    if (from.type === 'tab' && toType === 'found') addScore(10);
    if (from.type === 'found' && toType === 'tab') addScore(-15);
  }
  if (from.type === 'waste') G.fan = Math.max(G.waste.length ? 1 : 0, G.fan - 1);
  // flip newly exposed tableau card
  if (from.type === 'tab') {
    const p = G.tab[from.i];
    if (p.length && !G.up[top(p)]) { G.up[top(p)] = 1; if (!G.vegas) addScore(5); setTimeout(() => sfx('flip'), speedMs() * .6); }
  }
  G.moves++;
  playTracking?.action('move', trackingDetails());
  hintIdx = 0; stuckShown = false;
  liftCards(ids);
  sfx(toType === 'found' ? 'found' : 'place');
  afterChange();
}

function drawStock() {
  if (busy || G.won) return;
  const action = G.stock.length ? 'draw' : 'recycle';
  if (G.stock.length) {
    pushHistory(); startClock();
    const n = Math.min(G.draw, G.stock.length);
    const ids = [];
    for (let k = 0; k < n; k++) { const c = G.stock.pop(); G.up[c] = 1; G.waste.push(c); ids.push(c); }
    G.fan = n;
    G.moves++;
    liftCards(ids);
    sfx('draw');
  } else if (G.waste.length) {
    if (!canRecycle()) { trackAction('blocked'); toast(G.vegas ? 'Je mag in Vegas niet meer opnieuw door de stapel' : 'Geen kaarten meer'); sfx('bad'); return; }
    pushHistory(); startClock();
    while (G.waste.length) { const c = G.waste.pop(); G.up[c] = 0; G.stock.push(c); }
    G.passes++; G.fan = 0; G.moves++;
    if (!G.vegas) addScore(G.draw === 1 ? -100 : -20);
    sfx('shuffle');
  } else return;
  playTracking?.action(action, trackingDetails());
  hintIdx = 0; stuckShown = false;
  afterChange();
}

function undo() {
  if (busy || !H.length || G.won) return;
  startClock();
  const prev = JSON.parse(H.pop());
  const keep = { time: G.time, counted: G.counted, started: G.started, playId: G.playId, trackingStarted: G.trackingStarted };
  if (G.vegas && S.vegasCumulative) { ST.vegasTotal += prev.score - G.score; saveStats(); }
  G = Object.assign(prev, keep);
  playTracking?.action('undo', trackingDetails());
  hintIdx = 0; stuckShown = false;
  sfx('place');
  saveGame(); render(); updateHud(); updateBar();
}

/* best automatic destination for a tapped card */
function autoMove(id) {
  if (busy || G.won) return;
  const g = grabSet(id);
  if (!g) { trackAction('blocked'); shake([id]); return; }
  const { loc, ids } = g;
  const lead = ids[0];
  if (ids.length === 1 && loc.type !== 'found') {
    const f = foundTarget(lead);
    if (f >= 0) { moveCards(ids, loc, 'found', f); return; }
  }
  // tableau targets: non-empty first, then empty (only meaningful for kings not already at the bottom)
  const order = [];
  for (let k = 1; k <= 7; k++) {
    const t = loc.type === 'tab' ? (loc.i + k) % 7 : k - 1;
    if (loc.type === 'tab' && t === loc.i) continue;
    order.push(t);
  }
  for (const t of order) if (G.tab[t].length && canTab(lead, t)) { moveCards(ids, loc, 'tab', t); return; }
  const kingAtBottom = loc.type === 'tab' && loc.idx === 0;
  if (!kingAtBottom) for (const t of order) if (!G.tab[t].length && canTab(lead, t)) { moveCards(ids, loc, 'tab', t); return; }
  trackAction('blocked');
  shake(ids); sfx('bad');
}

/* ================= Move finder (hints / stuck detection) ================= */
function usefulMoves() {
  const res = [];
  const push = (ids, from, toType, toIdx, prio) => res.push({ ids, from, toType, toIdx, prio });
  // to foundation
  for (let t = 0; t < 7; t++) {
    const c = top(G.tab[t]);
    if (c >= 0) { const f = foundTarget(c); if (f >= 0) push([c], { type: 'tab', i: t, idx: G.tab[t].length - 1 }, 'found', f, 0); }
  }
  const w = top(G.waste);
  if (w >= 0) { const f = foundTarget(w); if (f >= 0) push([w], { type: 'waste', i: 0, idx: G.waste.length - 1 }, 'found', f, 1); }
  // tableau to tableau
  for (let s = 0; s < 7; s++) {
    const p = G.tab[s];
    const first = p.findIndex(c => G.up[c]);
    if (first < 0) continue;
    for (let i = first; i < p.length; i++) {
      const lead = p[i];
      const below = i > 0 ? p[i - 1] : -1;
      let prio = -1;
      if (i === first && below >= 0) prio = 2;               // uncovers a face-down card
      else if (i === 0) prio = 3;                             // empties a column
      else if (below >= 0 && foundTarget(below) >= 0) prio = 4; // frees a card for the foundation
      if (prio < 0) continue;
      for (let t = 0; t < 7; t++) {
        if (t === s || !canTab(lead, t)) continue;
        if (i === 0 && !G.tab[t].length) continue;            // king hopping between empty columns
        push(p.slice(i), { type: 'tab', i: s, idx: i }, 'tab', t, prio);
      }
    }
  }
  // waste to tableau
  if (w >= 0) {
    let done = false;
    for (let t = 0; t < 7 && !done; t++) if (G.tab[t].length && canTab(w, t)) { push([w], { type: 'waste', i: 0, idx: G.waste.length - 1 }, 'tab', t, 3); done = true; }
    if (!done) for (let t = 0; t < 7; t++) if (!G.tab[t].length && canTab(w, t)) { push([w], { type: 'waste', i: 0, idx: G.waste.length - 1 }, 'tab', t, 3); break; }
  }
  // foundation back to tableau if it frees a stuck waste card (rarely needed) – skip for hints
  res.sort((a, b) => a.prio - b.prio);
  return res;
}

/* ================= Exact dead-end check =================
   Explores every position that can be reached with legal moves: tableau moves, waste to tableau,
   foundation back to tableau, drawing and turning over the stock. Progress means a card can go to
   the foundation or a face-down card gets turned over. If no reachable position allows progress,
   the game can never be won and we say so. If the search is too large to finish, we never claim
   "stuck" (unknown = not stuck). */
function analyse(limit = 80000, opts = {}) {
  const draw = G.draw, maxP = maxPasses(), vegas = G.vegas;
  const fc0 = [0, 0, 0, 0];
  G.found.forEach(p => p.forEach(c => fc0[suitOf(c)]++));
  const down = G.tab.map(p => p.filter(c => !G.up[c]).length);
  const root = { tab: G.tab.map(p => p.filter(c => G.up[c])), stock: G.stock.slice(), waste: G.waste.slice(), fc: fc0, passes: G.passes, first: null };
  const key = st => st.tab.map(p => p.join(',')).join('|') + '/' + st.stock.join(',') + '/' + st.waste.join(',') + '/' + st.fc.join(',') + '/' + (vegas ? st.passes : 0);
  if (opts.keyOnly) return key(root);
  const fits = (st, c, t) => {
    const p = st.tab[t];
    if (!p.length) return down[t] === 0 && rankOf(c) === 13;
    const tc = p[p.length - 1];
    return isRed(tc) !== isRed(c) && rankOf(tc) === rankOf(c) + 1;
  };
  const goesUp = (st, c) => rankOf(c) === st.fc[suitOf(c)] + 1;
  const clone = st => ({ tab: st.tab.map(p => p.slice()), stock: st.stock.slice(), waste: st.waste.slice(), fc: st.fc.slice(), passes: st.passes, first: st.first });
  const seen = new Set([key(root)]);
  const queue = [root];
  const fcRoot = fc0[0] + fc0[1] + fc0[2] + fc0[3];
  const fcSum = st => st.fc[0] + st.fc[1] + st.fc[2] + st.fc[3];
  let qi = 0, rootFirst = null;
  while (qi < queue.length) {
    if (seen.size > limit) return { stuck: false, unknown: true, first: rootFirst };
    const st = queue[qi++];
    const tag = mv => st.first || mv;
    // progress moves: a card up (only counts if it means MORE cards up than now), or a closed card turned
    const upCounts = fcSum(st) + 1 > fcRoot;
    // at the start: a card up that just recreates a position from a moment ago is no progress (no circles)
    const backHere = (c, from) => {
      if (st !== root || !opts.avoid) return false;
      const ns = clone(st); if (from < 0) ns.waste.pop(); else ns.tab[from].pop(); ns.fc[suitOf(c)]++;
      return opts.avoid.has(key(ns));
    };
    for (let t = 0; t < 7; t++) {
      const p = st.tab[t];
      if (upCounts && p.length && goesUp(st, p[p.length - 1]) && !backHere(p[p.length - 1], t)) return { stuck: false, first: tag({ type: 'move', ids: [p[p.length - 1]], toType: 'found' }) };
    }
    const w = st.waste.length ? st.waste[st.waste.length - 1] : -1;
    if (upCounts && w >= 0 && goesUp(st, w) && !backHere(w, -1)) return { stuck: false, first: tag({ type: 'move', ids: [w], toType: 'found' }) };
    for (let s = 0; s < 7; s++) {
      const p = st.tab[s];
      if (p.length && down[s] > 0) {
        for (let t = 0; t < 7; t++) if (t !== s && fits(st, p[0], t)) return { stuck: false, first: tag({ type: 'move', ids: p.slice(), toType: 'tab', toIdx: t }) };
      }
    }
    const push = (ns, mv) => {
      if (st === root && opts.avoid && opts.avoid.has(key(ns))) return; // never send him back to where he just was
      if (!ns.first) ns.first = mv;
      if (!rootFirst) rootFirst = mv;
      const k = key(ns);
      if (!seen.has(k)) { seen.add(k); queue.push(ns); }
    };
    // tableau to tableau (sequences); whole-column moves only when they don't just hop between empty columns
    for (let s = 0; s < 7; s++) {
      const p = st.tab[s];
      for (let i = 0; i < p.length; i++) {
        if (i === 0 && down[s] > 0) continue; // handled above as progress
        for (let t = 0; t < 7; t++) {
          if (t === s || !fits(st, p[i], t)) continue;
          if (i === 0 && !st.tab[t].length) continue;
          const ns = clone(st);
          ns.tab[t].push(...ns.tab[s].splice(i));
          push(ns, { type: 'move', ids: p.slice(i), toType: 'tab', toIdx: t });
        }
      }
    }
    // waste to tableau
    if (w >= 0) for (let t = 0; t < 7; t++) if (fits(st, w, t)) {
      const ns = clone(st); ns.tab[t].push(ns.waste.pop());
      push(ns, { type: 'move', ids: [w], toType: 'tab', toIdx: t });
    }
    if (!upCounts) {
      for (let t = 0; t < 7; t++) { const p = st.tab[t]; const c = p[p.length - 1];
        if (p.length && goesUp(st, c)) { const ns = clone(st); ns.tab[t].pop(); ns.fc[suitOf(c)]++; push(ns, { type: 'move', ids: [c], toType: 'found' }); } }
      if (w >= 0 && goesUp(st, w)) { const ns = clone(st); ns.waste.pop(); ns.fc[suitOf(w)]++; push(ns, { type: 'move', ids: [w], toType: 'found' }); }
    }
    // foundation back to tableau
    for (let k = 0; k < 4; k++) if (st.fc[k] > 0) {
      const c = k * 13 + st.fc[k] - 1;
      for (let t = 0; t < 7; t++) if (fits(st, c, t)) {
        const ns = clone(st); ns.fc[k]--; ns.tab[t].push(c);
        push(ns, { type: 'move', ids: [c], toType: 'tab', toIdx: t });
      }
    }
    // stock
    if (st.stock.length) {
      const ns = clone(st);
      const n = Math.min(draw, ns.stock.length);
      for (let k = 0; k < n; k++) ns.waste.push(ns.stock.pop());
      push(ns, { type: 'draw' });
    } else if (st.waste.length && st.passes < maxP) {
      const ns = clone(st);
      while (ns.waste.length) ns.stock.push(ns.waste.pop());
      ns.passes++;
      push(ns, { type: 'draw' });
    }
  }
  return { stuck: true, first: null };
}

const clockMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
/* ================= Solver (smart hint) =================
   The game knows every card, including the face-down ones and the order of the stock.
   We search (depth-first, with sensible move ordering and pruning) for a sequence of moves that
   wins the game, within a small time budget. The hint shows the first move of that winning line.
   Each found move is a list of real actions so it can be replayed exactly. */
function solve(budgetMs = 900, mode = 'dfs') {
  const draw = G.draw, maxP = maxPasses(), vegas = G.vegas;
  const fc0 = [0, 0, 0, 0];
  G.found.forEach(p => p.forEach(c => fc0[suitOf(c)]++));
  const root = {
    tab: G.tab.map(p => p.slice()),
    down: G.tab.map(p => p.filter(c => !G.up[c]).length),
    stock: G.stock.slice(), waste: G.waste.slice(), fc: fc0, passes: G.passes
  };
  const key = st => st.tab.map((p, i) => st.down[i] + ':' + p.join(',')).join('|') + '/' + st.stock.join(',') + '/' + st.waste.join(',') + '/' + st.fc.join(',') + (vegas ? '/' + st.passes : '');
  if (mode === 'key') return key(root);
  const clone = st => ({ tab: st.tab.map(p => p.slice()), down: st.down.slice(), stock: st.stock.slice(), waste: st.waste.slice(), fc: st.fc.slice(), passes: st.passes });
  const fits = (st, c, t) => {
    const p = st.tab[t];
    if (!p.length) return rankOf(c) === 13;
    const tc = p[p.length - 1];
    return isRed(tc) !== isRed(c) && rankOf(tc) === rankOf(c) + 1;
  };
  const goesUp = (st, c) => rankOf(c) === st.fc[suitOf(c)] + 1;
  const safeUp = (st, c) => {
    if (!goesUp(st, c)) return false;
    const r = rankOf(c); if (r <= 2) return true;
    const opp = isRed(c) ? [0, 3] : [1, 2];
    return st.fc[opp[0]] >= r - 1 && st.fc[opp[1]] >= r - 1;
  };
  const flipTop = (st, s) => { if (st.tab[s].length && st.down[s] >= st.tab[s].length) st.down[s] = st.tab[s].length - 1; };
  // apply a move; returns [newState, actions]; then plays safe foundation moves automatically
  const apply = (st, mv) => {
    const ns = clone(st); const acts = [];
    for (const d of (mv.pre || [])) { doMove(ns, d); acts.push(d); }
    doMove(ns, mv); acts.push(mv);
    let again = true;
    while (again) {
      again = false;
      for (let s = 0; s < 7; s++) {
        const p = ns.tab[s]; const c = p[p.length - 1];
        if (c !== undefined && safeUp(ns, c)) { const m = { t: 'tf', s, ids: [c] }; doMove(ns, m); acts.push(m); again = true; }
      }
      const w = ns.waste[ns.waste.length - 1];
      if (w !== undefined && safeUp(ns, w)) { const m = { t: 'wf', ids: [w] }; doMove(ns, m); acts.push(m); again = true; }
    }
    return [ns, acts];
  };
  const doMove = (st, m) => {
    switch (m.t) {
      case 'tf': st.tab[m.s].pop(); st.fc[suitOf(m.ids[0])]++; flipTop(st, m.s); break;
      case 'wf': st.waste.pop(); st.fc[suitOf(m.ids[0])]++; break;
      case 'tt': st.tab[m.d].push(...st.tab[m.s].splice(m.i)); flipTop(st, m.s); break;
      case 'wt': st.tab[m.d].push(st.waste.pop()); break;
      case 'ft': st.fc[suitOf(m.ids[0])]--; st.tab[m.d].push(m.ids[0]); break;
      case 'draw': {
        if (st.stock.length) { const n = Math.min(draw, st.stock.length); for (let k = 0; k < n; k++) st.waste.push(st.stock.pop()); }
        else { while (st.waste.length) st.stock.push(st.waste.pop()); st.passes++; }
      }
    }
  };
  const won = st => st.fc[0] + st.fc[1] + st.fc[2] + st.fc[3] === 52;
  // the position before each action of a found line, so the hint can keep following the same plan
  const keysFor = path => { const ks = []; const st = clone(root); for (const a of path) { ks.push(key(st)); doMove(st, a); } return ks; };
  // every card that can be brought to the top of the waste by drawing (with the number of draws needed)
  const reachable = st => {
    const out = []; const seenTop = new Set();
    let stock = st.stock.slice(), waste = st.waste.slice(), passes = st.passes, k = 0, recycles = 0;
    const total = stock.length + waste.length;
    if (!total) return out;
    if (waste.length) { out.push({ c: waste[waste.length - 1], k: 0 }); seenTop.add(waste[waste.length - 1]); }
    for (let step = 0; step < total * 2 + 4; step++) {
      if (stock.length) {
        const n = Math.min(draw, stock.length);
        for (let i = 0; i < n; i++) waste.push(stock.pop());
      } else {
        if (passes >= maxP || recycles >= 2) break;
        while (waste.length) stock.push(waste.pop());
        passes++; recycles++;
      }
      k++;
      const t = waste[waste.length - 1];
      if (t !== undefined && !seenTop.has(t)) { seenTop.add(t); out.push({ c: t, k }); }
    }
    return out;
  };
  const moves = st => {
    const A = [], B = [], C = [], E = [], F = [];
    for (let s = 0; s < 7; s++) {
      const p = st.tab[s]; if (!p.length) continue;
      const c = p[p.length - 1];
      if (goesUp(st, c)) A.push({ t: 'tf', s, ids: [c] });
    }
    // stock/waste cards (drawing first if needed)
    for (const { c, k } of reachable(st)) {
      const pre = Array.from({ length: k }, () => ({ t: 'draw', ids: [] }));
      if (goesUp(st, c)) A.push({ t: 'wf', ids: [c], pre });
      for (let d = 0; d < 7; d++) if (fits(st, c, d)) C.push({ t: 'wt', d, ids: [c], pre, k });
    }
    const revealMoves = [];
    for (let s = 0; s < 7; s++) {
      const p = st.tab[s]; const first = st.down[s];
      for (let i = first; i < p.length; i++) {
        const lead = p[i];
        let kind;
        if (i === first && first > 0) kind = 'reveal';
        else if (i === 0) kind = 'empty';
        else if (goesUp(st, p[i - 1])) kind = 'free';
        else continue;                                   // pointless shuffle
        for (let d = 0; d < 7; d++) {
          if (d === s || !fits(st, lead, d)) continue;
          if (i === 0 && !st.tab[d].length) continue;    // king hopping between empty columns
          const m = { t: 'tt', s, i, d, ids: p.slice(i), down: first };
          (kind === 'reveal' ? revealMoves : kind === 'free' ? E : F).push(m);
        }
      }
    }
    revealMoves.sort((a, b) => b.down - a.down);         // uncover the biggest hidden pile first
    B.push(...revealMoves);
    C.sort((a, b) => a.k - b.k);
    // foundation card back down, only if something can then be placed on it
    const w = st.waste[st.waste.length - 1];
    for (let k = 0; k < 4; k++) if (st.fc[k] > 1) {
      const c = k * 13 + st.fc[k] - 1;
      const helps = cand => cand !== undefined && isRed(cand) !== isRed(c) && rankOf(cand) === rankOf(c) - 1;
      let useful = helps(w);
      for (let s = 0; s < 7 && !useful; s++) for (let i = st.down[s]; i < st.tab[s].length; i++) if (helps(st.tab[s][i])) { useful = true; break; }
      if (useful) for (let d = 0; d < 7; d++) if (st.tab[d].length && fits(st, c, d)) F.push({ t: 'ft', d, ids: [c] });
    }
    return A.concat(B, C, E, F);
  };
  const t0 = clockMs();
  if (mode === 'best') {
    // best-first: always expand the most promising position (cards up, cards uncovered)
    const score = st => 12 * (st.fc[0] + st.fc[1] + st.fc[2] + st.fc[3]) - 9 * st.down.reduce((x, y) => x + y, 0) - 0.5 * (st.stock.length + st.waste.length) + 2 * st.tab.filter(p => !p.length).length;
    const heap = []; const push = n => { heap.push(n); let i = heap.length - 1; while (i > 0) { const pI = (i - 1) >> 1; if (heap[pI].f >= heap[i].f) break; [heap[pI], heap[i]] = [heap[i], heap[pI]]; i = pI; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].f > heap[m].f) m = l; if (r < heap.length && heap[r].f > heap[m].f) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const seenB = new Set([key(root)]);
    push({ st: root, acts: null, parent: null, f: score(root), g: 0 });
    let n = 0;
    while (heap.length) {
      if (((++n & 127) === 0 && clockMs() - t0 > budgetMs) || n > budgetMs * 400) return { path: null, timedOut: true, nodes: n, ms: Math.round(clockMs() - t0) };
      const node = pop();
      if (won(node.st)) { const path = []; for (let x = node; x && x.acts; x = x.parent) path.unshift(...x.acts); return { path, keys: keysFor(path), timedOut: false, nodes: n, ms: Math.round(clockMs() - t0) }; }
      for (const m of moves(node.st)) {
        const [ns, acts] = apply(node.st, m);
        const k = key(ns); if (seenB.has(k)) continue; seenB.add(k);
        push({ st: ns, acts, parent: node, f: score(ns) - 0.02 * (node.g + 1), g: node.g + 1 });
      }
    }
    return { path: null, timedOut: false, nodes: n, ms: Math.round(clockMs() - t0) };
  }
  const seen = new Set();
  let nodes = 0, timedOut = false;
  const dfs = (st, depth) => {
    if (won(st)) return [];
    if (((++nodes & 255) === 0 && clockMs() - t0 > budgetMs) || nodes > budgetMs * 400) { timedOut = true; return null; }
    if (depth > 500) return null;
    const k = key(st); if (seen.has(k)) return null; seen.add(k);
    for (const m of moves(st)) {
      const [ns, acts] = apply(st, m);
      const r = dfs(ns, depth + 1);
      if (r) return acts.concat(r);
      if (timedOut) return null;
    }
    return null;
  };
  const path = dfs(root, 0);
  return { path, keys: path ? keysFor(path) : null, timedOut, nodes, ms: Math.round(clockMs() - t0) };
}

/* turn a solver action into the on-screen hint */
function showSolverMove(m) {
  if (m.t === 'draw') {
    flash([G.stock.length ? cardEl[top(G.stock)] : slotEl.stock]);
    toast(G.stock.length ? 'Tik op de stapel om een kaart te pakken' : 'Tik op de lege plek om de stapel om te draaien');
    sfx('hint');
    return;
  }
  if (m.t === 'tf' || m.t === 'wf') return showHintMove(m.ids, 'found', foundTarget(m.ids[0]));
  return showHintMove(m.ids, 'tab', m.d);
}

let hintBusy = false;
function hint() {
  if (busy || G.won || hintBusy) return;
  trackAction('hint');
  hintBusy = true;
  toast('Even nadenken…');
  setTimeout(() => { try { smartHint(); } finally { hintBusy = false; } }, 40);
}
let plan = null;   // the winning line we are currently hinting: { seed, path, keys }
/* next move of a winning line from the current position.
   { act } = next move of a winning line, { lost:true } = searched everything, no win from here,
   { unknown:true } = search ran out of time */
function planNextAction() {
  // keep following the plan we already showed, so hints never go in circles
  const here = solve(0, 'key');
  if (plan && plan.seed === G.seed) {
    const i = plan.keys.indexOf(here);
    if (i >= 0) return { act: plan.path[i] };
  }
  let sol = solve(500, 'dfs');
  if (!sol.path && sol.timedOut) sol = solve(900, 'best');
  if (sol.path && sol.path.length) { plan = { seed: G.seed, path: sol.path, keys: sol.keys }; return { act: sol.path[0] }; }
  return sol.timedOut ? { unknown: true } : { lost: true };
}
/* positions he was in during the last few moves (to never hint a move straight back) */
function recentPositions(n = 12) {
  const keep = G, out = new Set();
  try {
    out.add(analyse(0, { keyOnly: true }));
    for (let j = H.length - 1; j >= 0 && j >= H.length - n; j--) { G = JSON.parse(H[j]); out.add(analyse(0, { keyOnly: true })); }
  } catch (e) { /* ignore */ } finally { G = keep; }
  return out;
}
function smartHint() {
  // 1) the next move of a winning line (knows all cards, so it never leads into a dead end)
  const r = planNextAction();
  if (r.act) { hideToast(); showSolverMove(r.act); return; }
  if (r.lost) {
    // 2) no winning line from here: find the last position (going back) from which it can still be won
    const back = findWinnableBack();
    hideToast();
    sfx('hint');
    const n = back ? back.steps : 0;
    const btns = [];
    if (back) btns.push({ label: `${n} ${n === 1 ? 'zet' : 'zetten'} terug`, primary: true, action: () => {
      closeDialog();
      for (let k = 0; k < n; k++) undo();
      plan = { seed: G.seed, path: back.sol.path, keys: back.sol.keys };
      setTimeout(() => showSolverMove(back.sol.path[0]), speedMs() + 150);
    } });
    btns.push({ label: 'Dit spel opnieuw', primary: !back, action: () => { closeDialog(); newGame(false, true); } });
    btns.push({ label: 'Nieuw spel', action: () => { closeDialog(); newGame(false); } });
    btns.push({ label: 'Sluiten', action: closeDialog });
    dialog('Zo lukt het niet meer', `<p>Ik zie vanaf hier geen manier meer om dit spel te winnen.</p>` + (back
      ? `<p>Als je <b>${n} ${n === 1 ? 'zet' : 'zetten'}</b> terug gaat, kan het nog wel. De hint helpt je daarna verder.</p>`
      : `<p>Je kunt dit spel opnieuw beginnen (dezelfde kaarten) of een nieuw spel kiezen.</p>`), btns);
    return;
  }
  // 3) search ran out of time: shortest way to real progress, but never straight back to a recent position
  hideToast();
  const a = analyse(80000, { avoid: recentPositions() });
  if (a.stuck) { if (analyse().stuck) { noMoves(); return; } toast('Ik zie geen nieuwe goede zet. Probeer Terug, of tik op de stapel.'); return; }
  const m = a.first;
  if (m && m.type === 'move') { showHintMove(m.ids, m.toType, m.toType === 'found' ? foundTarget(m.ids[0]) : m.toIdx); return; }
  if (m && m.type === 'draw') { showSolverMove({ t: 'draw' }); return; }
  const moves = usefulMoves();
  if (moves.length) { const u = moves[0]; showHintMove(u.ids, u.toType, u.toIdx); return; }
  showSolverMove({ t: 'draw' });
}

/* look back through the undo history for the most recent position that can still be won.
   If a position can be won, every earlier one can too, so a binary search finds it quickly. */
function findWinnableBack(maxMs = 7000) {
  const keep = G, t0 = clockMs(), n = H.length;
  const memo = new Map();
  const proven = j => {
    if (memo.has(j)) return memo.get(j);
    G = JSON.parse(H[j]);
    let sol = solve(300, 'dfs');
    if (!sol.path && sol.timedOut) sol = solve(350, 'best');
    const r = sol.path && sol.path.length ? sol : null;
    memo.set(j, r);
    return r;
  };
  try {
    if (!n) return null;
    if (!proven(0)) return null;
    let lo = 0, hi = n - 1;            // lo is proven winnable
    while (lo < hi && clockMs() - t0 < maxMs) {
      const mid = Math.ceil((lo + hi) / 2);
      if (proven(mid)) lo = mid; else hi = mid - 1;
    }
    return { steps: n - lo, sol: memo.get(lo) };
  } finally { G = keep; }
}

function showHintMove(ids, toType, toIdx) {
  const dest = toType === 'found'
    ? (G.found[toIdx].length ? cardEl[top(G.found[toIdx])] : slotEl['f' + toIdx])
    : (G.tab[toIdx].length ? cardEl[top(G.tab[toIdx])] : slotEl['t' + toIdx]);
  flash(ids.map(i => cardEl[i]).concat([dest]));
  sfx('hint');
}

function flash(els) {
  els.forEach(el => { if (!el) return; el.classList.remove('hint'); void el.offsetWidth; el.classList.add('hint'); });
  setTimeout(() => els.forEach(el => el && el.classList.remove('hint')), 1500);
}
function shake(ids) {
  ids.forEach(i => { const el = cardEl[i]; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 400); });
}

function noMoves() {
  stuckShown = true;
  G.deadEnd = true; saveGame();
  endTracking('stuck');
  sfx('bad');
  dialog('Geen zetten meer', `<p>Helaas, dit spel kan niet meer worden uitgespeeld.</p>
    <p>Er kan geen kaart meer naar de stapels boven en er kan geen dichte kaart meer worden omgedraaid, ook niet met de kaarten uit de stapel.</p>`, [
    { label: 'Nieuw spel', primary: true, action: () => { closeDialog(); newGame(false); } },
    { label: 'Zet terug', action: () => { closeDialog(); undo(); }, disabled: !H.length },
    { label: 'Dit spel opnieuw', action: () => { closeDialog(); newGame(false, true); } },
    { label: 'Sluiten', action: closeDialog }
  ]);
}

/* ================= After every change ================= */
function afterChange() {
  if (G.found.every(f => f.length === 13)) { win(); return; }
  saveGame(); render(); updateHud(); updateBar();
  if (S.autoFinish && !busy && !G.stock.length && !G.waste.length && G.tab.every(p => p.every(c => G.up[c]))) {
    setTimeout(autoFinish, speedMs() + 120);
    return;
  }
  // tell the player automatically when the game really cannot be won any more
  if (!stuckShown && !G.deadEnd) {
    const at = G.moves, seed = G.seed;
    setTimeout(() => {
      if (!G || G.won || busy || stuckShown || G.deadEnd || G.moves !== at || G.seed !== seed || !$('modal').hidden) return;
      if (usefulMoves().length) return;
      if (analyse().stuck) noMoves();
    }, speedMs() + 450);
  }
}

function autoFinish() {
  if (G.won) return;
  busy = true;
  const step = () => {
    if (G.found.every(f => f.length === 13)) { busy = false; win(); return; }
    // pick lowest card on tableau that can go up
    let best = null;
    for (let t = 0; t < 7; t++) {
      const c = top(G.tab[t]);
      if (c >= 0 && foundTarget(c) >= 0 && (!best || rankOf(c) < rankOf(best.c))) best = { c, t };
    }
    if (!best) { busy = false; afterChange(); return; }
    const f = foundTarget(best.c);
    pushHistory();
    G.tab[best.t].pop(); G.found[f].push(best.c);
    if (G.vegas) addScore(5); else addScore(10);
    G.moves++;
    playTracking?.action('auto_finish', trackingDetails());
    liftCards([best.c]);
    sfx('found');
    render(); updateHud();
    setTimeout(step, Math.max(70, speedMs() * .55));
  };
  step();
}

/* ================= Win ================= */
function win() {
  if (G.won) return;
  G.won = true; busy = false;
  let bonus = 0;
  if (!G.vegas && G.time >= 30) bonus = Math.round(700000 / G.time);
  if (!G.vegas) G.score += bonus;
  playTracking?.state(trackingDetails()); playTracking?.win();
  const st = ST['d' + G.draw];
  st.won++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak);
  if (!G.vegas) st.bestScore = st.bestScore == null ? G.score : Math.max(st.bestScore, G.score);
  st.bestTime = st.bestTime == null ? G.time : Math.min(st.bestTime, G.time);
  st.bestMoves = st.bestMoves == null ? G.moves : Math.min(st.bestMoves, G.moves);
  st.totalWinTime += G.time;
  saveStats(); H = []; saveGame();
  render(); updateHud(); updateBar();
  sfx('win');
  setTimeout(() => winAnimation(), speedMs() + 200);
  setTimeout(() => {
    const scoreLine = G.vegas ? `<p>Vegas: <b>${money(G.score)}</b>${S.vegasCumulative ? ` &nbsp;·&nbsp; Totaal: <b>${money(ST.vegasTotal)}</b>` : ''}</p>`
      : `<p>Score: <b>${G.score}</b>${bonus ? ` <span style="color:#6b7280">(incl. tijdbonus ${bonus})</span>` : ''}</p>`;
    dialog('Gefeliciteerd!', `<p class="win-big">🏆</p><p style="text-align:center;font-size:20px"><b>Je hebt gewonnen!</b></p>
      <div style="text-align:center">${scoreLine}<p>Tijd: <b>${fmtTime(G.time)}</b> &nbsp;·&nbsp; Zetten: <b>${G.moves}</b></p>
      <p>Gewonnen: <b>${st.won}</b> van ${st.played} &nbsp;·&nbsp; Reeks: <b>${st.streak}</b></p></div>`,
      [{ label: 'Nieuw spel', primary: true, action: () => { stopWinAnimation(); closeDialog(); newGame(false); } }]);
  }, 2600);
}

/* ================= New game ================= */
function newGame(confirmFirst, sameSeed) {
  if (busy) return;
  const inProgress = G && G.counted && !G.won;
  if (confirmFirst && inProgress) {
    dialog(sameSeed ? 'Spel opnieuw beginnen?' : 'Nieuw spel?', sameSeed
      ? '<p>Wil je dit spel opnieuw vanaf het begin spelen?</p><p class="note">Het huidige spel telt als verloren in de statistieken.</p>'
      : '<p>Wil je stoppen met dit spel en een nieuw spel beginnen?</p><p class="note">Het huidige spel telt als verloren in de statistieken.</p>', [
      { label: 'Nee', action: closeDialog },
      { label: 'Ja', primary: true, action: () => { closeDialog(); newGame(false, sameSeed); } }
    ]);
    return;
  }
  if (inProgress) { ST['d' + G.draw].streak = 0; saveStats(); }
  endTracking(sameSeed ? 'restart' : 'new_game');
  stopWinAnimation();
  const deal = seed => {
    G = newGameState(seed, S.draw, S.vegas);
    G.playId = playTracking?.newRound();
    H = []; hintIdx = 0; stuckShown = false;
    saveGame();
    dealAnimation();
    updateHud(); updateBar();
  };
  if (sameSeed && G) { deal(G.seed); return; }
  // only deal games that can be won: shuffle until the solver finds a winning line
  if (!G) { deal(findWinnableSeed(S.draw, S.vegas)); return; }   // very first game: deal right away
  busy = true;
  toast('Kaarten schudden…');
  setTimeout(() => {
    let seed;
    try { seed = findWinnableSeed(S.draw, S.vegas); } finally { busy = false; }
    hideToast();
    deal(seed);
  }, 30);
}

function findWinnableSeed(draw, vegas, maxMs = 6000) {
  const keep = G, t0 = clockMs();
  let seed = (Math.random() * 2 ** 31) | 0;
  try {
    for (let tries = 0; tries < 60; tries++) {
      seed = (Math.random() * 2 ** 31) | 0;
      G = newGameState(seed, draw, vegas);
      let sol = solve(300, 'dfs');
      if (!sol.path && sol.timedOut) sol = solve(300, 'best');
      if (sol.path) return seed;
      if (clockMs() - t0 > maxMs) break;   // very unlikely: give a normal deal rather than wait
    }
    return seed;
  } finally { G = keep; }
}

/* ================= Layout & rendering ================= */
const board = document.getElementById('board');
board.addEventListener('pointerdown', () => {
  if (G && G.started && !G.won && $('modal').hidden && $('landing').hidden) playTracking?.touch(false, trackingDetails());
});
const cardEl = [];
const slotEl = {};
let L = {}; // layout metrics

function speedMs() { return { langzaam: 380, normaal: 220, snel: 120, uit: 0 }[S.speed] ?? 220; }

/* ---------- Card faces: traditional deck, drawn as self-contained SVG ---------- */
const SUITP = [
  'M50 3C41 20 6 37 6 60c0 14 11 23 23 23 8 0 14-4 18-9-1 9-6 16-14 21h34c-8-5-13-12-14-21 4 5 10 9 18 9 12 0 23-9 23-23C94 37 59 20 50 3z',
  'M50 92C21 68 4 51 4 31 4 16 15 6 29 6c10 0 17 6 21 14 4-8 11-14 21-14 14 0 25 10 25 25 0 20-17 37-46 61z',
  'M50 3 87 50 50 97 13 50z',
  'M50 6a21 21 0 1 1 0 42 21 21 0 1 1 0-42zM27 37a21 21 0 1 1 0 42 21 21 0 1 1 0-42zM73 37a21 21 0 1 1 0 42 21 21 0 1 1 0-42zM42 40h16v18H42zM47 56c-1 17-6 29-14 39h34c-8-10-13-22-14-39z'
];
const RED = '#c8102e', BLK = '#161616', GOLD = '#e9b824', BLUE = '#1f4f9e', SKIN = '#f7dcb8', INK = '#1a1a1a';
function idxMetrics() {
  return S.size === 'groot'
    ? { f: 32, cx: 15, base: 28, tl: 27, ss: 17, sy: 31, w: 30 }
    : { f: 24, cx: 12, base: 22, tl: 21, ss: 13, sy: 25, w: 23 };
}
function pipAt(s, cx, cy, size, flip, fill) {
  const k = size / 100;
  return `<path fill="${fill}" d="${SUITP[s]}" transform="translate(${cx} ${cy})${flip ? ' rotate(180)' : ''} translate(${-size / 2} ${-size / 2}) scale(${k})"/>`;
}
/* top half of a court figure in the classic French tradition (local box 60 x 62; drawn twice, second copy turned 180°).
   Names and attributes follow the centuries-old French pattern; the drawings themselves are our own. */
const GREEN = '#2e7d4f', WHITE = '#fbfaf4';
const COURT = {
  13: [ { name: 'DAVID', item: 'harp', side: 'L', A: BLUE, B: RED, C: GREEN },
        { name: 'CHARLES', item: 'sword', side: 'R', A: RED, B: BLUE, C: GREEN },
        { name: 'CÉSAR', item: 'scepter', side: 'R', A: GREEN, B: RED, C: BLUE },
        { name: 'ALEXANDRE', item: 'orb', side: 'L', A: RED, B: GREEN, C: BLUE } ],
  12: [ { name: 'PALLAS', item: 'shield', side: 'L', A: GREEN, B: RED, C: BLUE },
        { name: 'JUDITH', item: 'rose', side: 'R', A: BLUE, B: RED, C: GREEN },
        { name: 'RACHEL', item: 'rose', side: 'L', A: RED, B: GREEN, C: BLUE },
        { name: 'ARGINE', item: 'fan', side: 'R', A: BLUE, B: GREEN, C: RED } ],
  11: [ { name: 'OGIER', item: 'halberd', side: 'L', A: RED, B: BLUE, C: GREEN },
        { name: 'LA HIRE', item: 'axe', side: 'R', A: GREEN, B: RED, C: BLUE },
        { name: 'HECTOR', item: 'halberd', side: 'R', A: BLUE, B: RED, C: GREEN },
        { name: 'LANCELOT', item: 'pennant', side: 'L', A: RED, B: GREEN, C: BLUE } ]
};
function courtItem(item, o) {
  // drawn for the left hand (hand at 13,46); mirrored for the right side
  switch (item) {
    case 'harp': return `<path d="M5.5 60V31q7-6 13 2v27z" fill="none" stroke="${GOLD}" stroke-width="2.4" ${o}/>
      <path d="M8.5 33v26M11.5 32v27M14.5 33v26" stroke="#8a6d2b" stroke-width=".5"/>`;
    case 'sword': return `<path d="M12 44 5.5 2.5 8.5 2 15 43.5z" fill="#dcdcdc" ${o}/><path d="M7 41.5l12-3 .6 2.4-12 3z" fill="${GOLD}" ${o}/>`;
    case 'scepter': return `<path d="M12 60V18h2.2v42z" fill="${GOLD}" ${o}/><path d="M13.1 8l3.4 5-3.4 5-3.4-5z" fill="${GOLD}" ${o}/>
      <circle cx="13.1" cy="7" r="1.6" fill="${RED}" ${o}/>`;
    case 'orb': return `<circle cx="13" cy="38" r="5.5" fill="${GOLD}" ${o}/><path d="M7.5 38h11" stroke="${INK}" stroke-width=".7"/>
      <path d="M13 32.5v-5M10.8 29.5h4.4" stroke="${INK}" stroke-width="1.1"/>`;
    case 'shield': return `<path d="M3.5 36h15v9q0 9-7.5 13-7.5-4-7.5-13z" fill="${GOLD}" ${o}/><path d="M6 38.5h10v6.5q0 6-5 9-5-3-5-9z" fill="${BLUE}"/>
      <path d="M11 41l2 3-2 3-2-3z" fill="${GOLD}"/>`;
    case 'rose': return `<path d="M13 60V34" stroke="${GREEN}" stroke-width="1.3"/><path d="M13 46q-7-1-8-6 6 0 8 4z" fill="${GREEN}"/>
      <circle cx="10.6" cy="31.5" r="2.6" fill="${RED}" ${o}/><circle cx="15.4" cy="31.5" r="2.6" fill="${RED}" ${o}/>
      <circle cx="13" cy="29" r="2.6" fill="${RED}" ${o}/><circle cx="13" cy="31" r="1.3" fill="${GOLD}"/>`;
    case 'fan': return `<path d="M13 46 2 33q11-9 22 0z" fill="${WHITE}" ${o}/><path d="M13 46 5.5 30.5M13 46 10 28.5M13 46l3-17.5M13 46l7.5-15.5" stroke="${RED}" stroke-width=".7"/>`;
    case 'halberd': return `<path d="M9.5 62V5h2v57z" fill="#8a5a2b" ${o}/><path d="M11.5 9q8 1 9 8-5-3-9-1z" fill="#d9d9d9" ${o}/>
      <path d="M9.5 9q-5 2-5 7 3-3 5-3z" fill="#d9d9d9" ${o}/><path d="M10.5 0l1.6 5h-3.2z" fill="#d9d9d9" ${o}/>`;
    case 'axe': return `<path d="M9.5 60V14h2v46z" fill="#8a5a2b" ${o}/><path d="M11.5 15q10-2 11 7 0 5-3 7-1-6-8-6z" fill="#d9d9d9" ${o}/>`;
    case 'pennant': return `<path d="M9.8 62V3h1.8v59z" fill="#8a5a2b" ${o}/><path d="M11.6 4l12 4-12 4z" fill="${GOLD}" ${o}/><path d="M11.6 6.5l7 1.5-7 1.5z" fill="${RED}"/>`;
  }
  return '';
}
function courtHalf(r, s) {
  const d = COURT[r][s], col = (s === 1 || s === 2) ? RED : BLK;
  const o = `stroke="${INK}" stroke-width=".7" stroke-linejoin="round"`;
  const L = d.side === 'L';
  const mirror = L ? '' : ' transform="translate(60 0) scale(-1 1)"';
  // name along the free edge
  const nx = L ? 57.5 : 2.5;
  const name = `<text x="${nx}" y="60" transform="rotate(-90 ${nx} 60)" font-family="Georgia,'Times New Roman',serif" font-size="4.6" font-weight="700" letter-spacing=".4" fill="${col}">${d.name}</text>`;
  // robe
  const robe = `<path d="M7 62 9 42Q13 33 22 31l8 9 8-9q9 2 13 11l2 20z" fill="${d.A}" ${o}/>
    <path d="M22 31l8 9 8-9 1 31H21z" fill="${d.B}" ${o}/>
    <path d="M28.2 40h3.6v22h-3.6z" fill="${GOLD}" ${o}/>
    <circle cx="30" cy="45" r=".8" fill="${INK}"/><circle cx="30" cy="51" r=".8" fill="${INK}"/><circle cx="30" cy="57" r=".8" fill="${INK}"/>
    <path d="M10 52l2.5-2.5L15 52l-2.5 2.5zM45 52l2.5-2.5L50 52l-2.5 2.5zM14 59l2-2 2 2-2 2zM42 59l2-2 2 2-2 2z" fill="${GOLD}"/>
    <path d="M8.5 44q4 3 7.5 2M51.5 44q-4 3-7.5 2" fill="none" stroke="${GOLD}" stroke-width="1.2"/>`;
  let collar;
  if (r === 13) collar = `<path d="M16.5 33.5Q30 46 43.5 33.5L41 30Q30 40 19 30z" fill="${WHITE}" ${o}/>
      <path d="M22 35.5l.8 1.8-.8 0zM27 38l.8 1.8h-.8zM33 38l.8 1.8h-.8zM38 35.5l.8 1.8h-.8z" fill="${INK}" stroke="${INK}" stroke-width=".9"/>`;
  else if (r === 12) collar = `<path d="M19.5 31.5Q30 41 40.5 31.5" fill="none" stroke="${GOLD}" stroke-width="1.6"/>
      <circle cx="24" cy="35.4" r="1" fill="${WHITE}" ${o}/><circle cx="30" cy="37.4" r="1.2" fill="${d.C}" ${o}/><circle cx="36" cy="35.4" r="1" fill="${WHITE}" ${o}/>`;
  else collar = `<path d="M18 32.5Q30 42 42 32.5L40.5 30Q30 37.5 19.5 30z" fill="${d.C}" ${o}/>`;
  // head
  const face = `<ellipse cx="30" cy="21.5" rx="7.3" ry="8.4" fill="${SKIN}" ${o}/>
    <path d="M26 18.6h2.6M31.4 18.6H34" stroke="#7a5230" stroke-width=".6"/>
    <circle cx="27.4" cy="20.3" r=".85" fill="${INK}"/><circle cx="32.6" cy="20.3" r=".85" fill="${INK}"/>
    <path d="M30 21v3.6l-1 .3" fill="none" stroke="#b58a62" stroke-width=".6"/>
    <path d="M28.3 26.7q1.7.9 3.4 0" fill="none" stroke="${RED}" stroke-width=".8"/>`;
  let head;
  if (r === 13) head = `<path d="M21.5 15q-1.5 8 1 12l1.5-4zM38.5 15q1.5 8-1 12l-1.5-4z" fill="${GOLD}" ${o}/>
      ${face}
      <path d="M22.6 23.5Q23 36.5 30 38.5q7-2 7.4-15-2.8 5.6-7.4 5.6t-7.4-5.6z" fill="${GOLD}" ${o}/>
      <path d="M26.3 26.6q3.7-2.2 7.4 0" fill="none" stroke="#8a6d2b" stroke-width=".9"/>
      <path d="M20.5 14.5V6l3.5 3.6L27 2.8l3 5.2 3-5.2 3 6.8 3.5-3.6v8.5z" fill="${GOLD}" ${o}/>
      <path d="M20.5 11.6h19v3h-19z" fill="${GOLD}" ${o}/><circle cx="30" cy="13.1" r="1.1" fill="${RED}"/>
      <circle cx="25" cy="13.1" r=".8" fill="${BLUE}"/><circle cx="35" cy="13.1" r=".8" fill="${BLUE}"/>
      <circle cx="20.5" cy="5.6" r=".9" fill="${GOLD}" ${o}/><circle cx="27" cy="2.4" r=".9" fill="${GOLD}" ${o}/><circle cx="33" cy="2.4" r=".9" fill="${GOLD}" ${o}/><circle cx="39.5" cy="5.6" r=".9" fill="${GOLD}" ${o}/>`;
  else if (r === 12) head = `<path d="M21 13Q15 30 18 41l6-6q-3-11 0-21zM39 13q6 17 3 28l-6-6q3-11 0-21z" fill="${d.C}" ${o}/>
      <path d="M22 15q-3 9 0 15l2-4zM38 15q3 9 0 15l-2-4z" fill="${GOLD}" ${o}/>
      ${face}
      <path d="M22 14.6l1-6.4 3.4 3.4L30 5.5l3.6 6.1 3.4-3.4 1 6.4z" fill="${GOLD}" ${o}/>
      <circle cx="23" cy="7.6" r="1" fill="${WHITE}" ${o}/><circle cx="30" cy="4.8" r="1.1" fill="${WHITE}" ${o}/><circle cx="37" cy="7.6" r="1" fill="${WHITE}" ${o}/>
      <path d="M22.3 12.8h15.4" stroke="${RED}" stroke-width="1"/>`;
  else head = `<path d="M22.3 16q-2.4 6 .2 10.5l1.6-3.5zM37.7 16q2.4 6-.2 10.5l-1.6-3.5z" fill="${GOLD}" ${o}/>
      ${face}
      <path d="M26.6 26q3.4-1.6 6.8 0" fill="none" stroke="#8a6d2b" stroke-width=".9"/>
      <path d="M20.5 14.2q1.5-10 10.5-10 8.5 0 10 10z" fill="${d.B}" ${o}/>
      <path d="M18.5 13.6h23v3h-23z" fill="${GOLD}" ${o}/>
      <path d="M37 9q8-9 16-6.5-7 1.5-11.5 8.5z" fill="${WHITE}" ${o}/><path d="M38.5 8.5q6-6 12-5.2" fill="none" stroke="${d.C}" stroke-width=".6"/>`;
  const hand = `<circle cx="13" cy="46" r="2.9" fill="${SKIN}" ${o}/>`;
  const restHand = `<circle cx="45" cy="52" r="2.7" fill="${SKIN}" ${o}/>`;
  const itemBehind = d.item === 'sword' || d.item === 'halberd' || d.item === 'pennant' || d.item === 'axe' || d.item === 'scepter';
  const item = `<g${mirror}>${courtItem(d.item, o)}</g>`;
  const hands = `<g${mirror}>${hand}${restHand}</g>`;
  return (itemBehind ? item : '') + robe + collar + head + (itemBehind ? '' : item) + hands + name
    + pipAt(s, L ? 52 : 8, 6.5, 8.5, false, col);
}
function faceSvg(id, standalone) {
  const r = rankOf(id), s = suitOf(id), red = isRed(id), col = red ? RED : BLK;
  const M = idxMetrics(), t = rankText(r);
  const tl = t.length > 1 ? ` textLength="${M.tl}" lengthAdjust="spacingAndGlyphs"` : '';
  const index = `<text x="${M.cx}" y="${M.base}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${M.f}" fill="${col}"${tl}>${t}</text>`
    + pipAt(s, M.cx, M.sy + M.ss / 2, M.ss, false, col);
  let body = '';
  const x0 = M.w + 1, x1 = 99 - M.w;           // usable middle area
  if (r === 1) {
    body = pipAt(s, 50, 70, s === 0 ? 50 : 42, false, col);
    if (s === 0) body += `<circle cx="50" cy="70" r="31" fill="none" stroke="${col}" stroke-width="1"/>`;
  } else if (r <= 10) {
    const ps = S.size === 'groot' ? 14 : 16;
    const L = x0 + ps / 2 + 1, Rr = x1 - ps / 2 - 1, C = 50, T = 24, B = 116, MID = 70;
    const q = (B - T) / 3;
    const P = {
      2: [[C, T], [C, B]], 3: [[C, T], [C, MID], [C, B]],
      4: [[L, T], [Rr, T], [L, B], [Rr, B]],
      5: [[L, T], [Rr, T], [C, MID], [L, B], [Rr, B]],
      6: [[L, T], [Rr, T], [L, MID], [Rr, MID], [L, B], [Rr, B]],
      7: [[L, T], [Rr, T], [C, (T + MID) / 2], [L, MID], [Rr, MID], [L, B], [Rr, B]],
      8: [[L, T], [Rr, T], [C, (T + MID) / 2], [L, MID], [Rr, MID], [C, (MID + B) / 2], [L, B], [Rr, B]],
      9: [[L, T], [Rr, T], [L, T + q], [Rr, T + q], [C, MID], [L, T + 2 * q], [Rr, T + 2 * q], [L, B], [Rr, B]],
      10: [[L, T], [Rr, T], [C, T + q / 2], [L, T + q], [Rr, T + q], [L, T + 2 * q], [Rr, T + 2 * q], [C, B - q / 2], [L, B], [Rr, B]]
    }[r];
    body = P.map(([x, y]) => pipAt(s, x, y, ps, y > MID + 0.1, col)).join('');
  } else {
    const cx0 = M.cx * 2 - 3, cx1 = 100 - cx0;
    const fy0 = 6, fy1 = 134, mid = 70, fw = cx1 - cx0;
    const sx = fw / 60, sy = (mid - fy0) / 62;
    const half = `<g transform="translate(${cx0} ${fy0}) scale(${sx} ${sy})">${courtHalf(r, s)}</g>`;
    body = `<rect x="${cx0}" y="${fy0}" width="${fw}" height="${fy1 - fy0}" fill="#fffdf6" stroke="${col}" stroke-width="1"/>
      <clipPath id="cp${id}${standalone ? 'x' : ''}"><rect x="${cx0}" y="${fy0}" width="${fw}" height="${mid - fy0}"/></clipPath>
      <g clip-path="url(#cp${id}${standalone ? 'x' : ''})">${half}</g>
      <g transform="rotate(180 50 70)"><g clip-path="url(#cp${id}${standalone ? 'x' : ''})">${half}</g></g>
      <path d="M${cx0} ${mid}H${cx1}" stroke="${col}" stroke-width=".8"/>`;
  }
  const ns = standalone ? ' xmlns="http://www.w3.org/2000/svg" width="200" height="280"' : '';
  const bg = standalone ? `<rect x=".5" y=".5" width="99" height="139" rx="7" fill="#fdfdfb" stroke="#999"/>` : '';
  return `<svg${ns} viewBox="0 0 100 140" preserveAspectRatio="none">${bg}${index}<g transform="rotate(180 50 70)">${index}</g>${body}</svg>`;
}
/* image deck: "Vector Playing Cards" by Byron Knoll (CC0 / public domain) */
const CARD_FILE = id => {
  const r = rankOf(id), n = { 1: 'ace', 11: 'jack', 12: 'queen', 13: 'king' }[r] || String(r);
  return `cards/${S.size === 'groot' ? 'groot/' : ''}${n}_of_${['spades', 'hearts', 'diamonds', 'clubs'][suitOf(id)]}.png`;
};
const imgDeck = () => S.deck !== 'getekend';
const cardRatio = () => imgDeck() ? 1.452 : 1.4;
const faceHtml = id => imgDeck()
  ? `<img src="${CARD_FILE(id)}" alt="" draggable="false">`
  : faceSvg(id, false);
const preloaded = [];
function preloadCards() { if (!imgDeck()) return; preloaded.length = 0; for (let id = 0; id < 52; id++) { const im = new Image(); im.src = CARD_FILE(id); preloaded.push(im); } }

function buildCards() {
  board.innerHTML = '';
  const mk = (key, cls, html) => { const d = document.createElement('div'); d.className = 'slot ' + cls; d.innerHTML = html || ''; board.appendChild(d); slotEl[key] = d; return d; };
  mk('stock', 'stock', '<svg viewBox="0 0 100 100"><path d="M78 50a28 28 0 1 1-8-20"/><path d="M72 14v18H54"/></svg>');
  mk('waste', 'waste');
  for (let f = 0; f < 4; f++) mk('f' + f, 'found', 'A');
  for (let t = 0; t < 7; t++) mk('t' + t, 'tabslot');
  for (let id = 0; id < 52; id++) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = id;
    el.innerHTML = `<div class="flip"><div class="back"></div><div class="face${isRed(id) ? ' red' : ''}">${faceHtml(id)}</div></div>`;
    board.appendChild(el);
    cardEl[id] = el;
  }
}
function refreshFaces() { for (let id = 0; id < 52; id++) cardEl[id].querySelector('.face').innerHTML = faceHtml(id); }

function computeLayout() {
  const W = board.clientWidth, Hh = board.clientHeight;
  const large = S.size === 'groot';
  const right = S.hand !== 'links';
  const side = document.body.classList.contains('landscape');
  let gap, cw;
  if (!side) {
    gap = Math.max(3, Math.round(W * (large ? 0.009 : 0.016)));
    cw = (W - gap * 8) / 7;
    const maxByH = (Hh - gap * 3) / (cardRatio() * (large ? 3.3 : 3.7));
    cw = Math.floor(Math.min(cw, maxByH, 150));
  } else {
    // landscape: foundations in one side column, stock + waste in the other, tableau in the middle
    gap = Math.max(3, Math.round(Hh * (large ? 0.014 : 0.022)));
    cw = (W - gap * 13) / 9;
    const maxByH = (Hh - gap * 5) / 4 / cardRatio();
    cw = Math.floor(Math.min(cw, maxByH * (large ? 1.12 : 1), 150));
  }
  const ch = Math.round(cw * cardRatio());
  const fi = Math.round(cw * (large ? 0.42 : 0.33));   // index font size
  const fs = Math.round(cw * (large ? 0.34 : 0.27));   // small suit size
  const topY = Math.max(gap, 6);
  L = {
    W, H: Hh, cw, ch, gap, fi, fs, side,
    upOff: imgDeck() ? Math.round(ch * (large ? 0.32 : 0.26)) : Math.round(cw * (idxMetrics().sy + idxMetrics().ss + 4) / 100),
    downOff: Math.max(4, Math.round(ch * 0.1)),
    bottom: Hh - Math.max(6, gap),
    topY
  };
  if (!side) {
    const totalW = cw * 7 + gap * 6;
    const left0 = Math.round((W - totalW) / 2);
    const colX = i => left0 + i * (cw + gap);
    L.tabX = colX;
    L.tabY = topY + ch + Math.max(gap * 2, Math.round(ch * 0.16));
    L.stockXY = { x: colX(right ? 6 : 0), y: topY };
    L.wasteXY = { x: colX(right ? 4 : 1), y: topY };
    L.fan = { dx: Math.round(Math.min((cw + gap * 2) / 2 - 2, Math.max(cw * 0.36, fi * 1.25))), dy: 0 };
    L.foundXY = f => ({ x: colX(right ? f : 3 + f), y: topY });
  } else {
    const totalW = cw * 9 + gap * 10;
    const left0 = Math.round((W - totalW) / 2);
    const sideL = left0, sideR = left0 + totalW - cw;
    const tab0 = left0 + cw + gap * 2;
    L.tabX = t => tab0 + t * (cw + gap);
    L.tabY = topY;
    // overlap foundations a little if the screen is very low
    const fStep = Math.min(ch + gap, (Hh - topY - ch - gap) / 3);
    L.foundXY = f => ({ x: right ? sideL : sideR, y: Math.round(topY + f * fStep) });
    L.stockXY = { x: right ? sideR : sideL, y: topY };
    L.wasteXY = { x: right ? sideR : sideL, y: topY + ch + gap * 2 };
    L.fan = { dx: 0, dy: Math.round(Math.min(fi * 1.25, (Hh - topY - 2 * ch - gap * 3) / 2)) };
  }
  const st = document.documentElement.style;
  st.setProperty('--cw', cw + 'px'); st.setProperty('--ch', ch + 'px');
  st.setProperty('--cr', Math.max(3, Math.round(cw * (imgDeck() ? 0.05 : 0.08))) + 'px');
  document.body.classList.toggle('imgdeck', imgDeck());
  st.setProperty('--fi', fi + 'px'); st.setProperty('--fs', fs + 'px');
}

function tabOffsets() {
  // returns per column [downOff, upOff]
  const avail = L.bottom - L.tabY - L.ch;
  const res = [];
  let minF = 1;
  for (let t = 0; t < 7; t++) {
    const p = G.tab[t];
    let nd = 0, nu = 0;
    p.forEach((c, i) => { if (i === p.length - 1) return; if (G.up[c]) nu++; else nd++; });
    const need = nd * L.downOff + nu * L.upOff;
    const f = need > avail && need > 0 ? avail / need : 1;
    res.push(f); minF = Math.min(minF, f);
  }
  return res.map(f => {
    const ff = S.colHeight === 'vast' ? minF : f;
    return [L.downOff * Math.min(1, ff * 1.0), L.upOff * ff];
  });
}

const pos = new Array(52);
function render(noAnim) {
  if (!G) return;
  const { cw, ch, topY, tabY } = L;
  const place = (el, x, y) => { el.style.transform = `translate(${x}px, ${y}px)`; };
  // slots
  place(slotEl.stock, L.stockXY.x, L.stockXY.y);
  slotEl.stock.classList.toggle('done', !G.stock.length && !canRecycle());
  slotEl.stock.style.visibility = G.stock.length ? 'hidden' : 'visible';
  place(slotEl.waste, L.wasteXY.x, L.wasteXY.y);
  slotEl.waste.style.visibility = 'hidden';
  for (let f = 0; f < 4; f++) place(slotEl['f' + f], L.foundXY(f).x, L.foundXY(f).y);
  for (let t = 0; t < 7; t++) place(slotEl['t' + t], L.tabX(t), tabY);

  const set = (id, x, y, z, up) => {
    pos[id] = { x, y };
    const el = cardEl[id];
    if (noAnim) el.classList.add('nofx');
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.zIndex = z + (lifted.has(id) ? 300 : 0);
    const peek = !up && S.unveil && locType[id] === 'tab';
    el.classList.toggle('up', !!up || peek);
    el.classList.toggle('peek', peek);
  };
  const locType = {};
  G.tab.forEach(p => p.forEach(c => locType[c] = 'tab'));

  // stock
  G.stock.forEach((c, i) => set(c, L.stockXY.x - Math.floor(i / 8), L.stockXY.y - Math.floor(i / 8), 10 + i, 0));
  // waste
  const fan = G.draw === 3 ? Math.min(G.fan || 1, 3, G.waste.length) : 1;
  const wx = L.wasteXY.x, wy = L.wasteXY.y;
  G.waste.forEach((c, i) => {
    const k = i - (G.waste.length - fan);
    const kk = k > 0 ? k : 0;
    set(c, wx + kk * L.fan.dx, wy + kk * L.fan.dy, 70 + i, 1);
  });
  // foundations
  G.found.forEach((p, f) => p.forEach((c, i) => set(c, L.foundXY(f).x, L.foundXY(f).y, 140 + f * 14 + i, 1)));
  // tableau
  const offs = tabOffsets();
  G.tab.forEach((p, t) => {
    let y = tabY;
    p.forEach((c, i) => {
      set(c, L.tabX(t), y, 200 + i, G.up[c]);
      y += G.up[c] ? offs[t][1] : offs[t][0];
    });
  });
  if (noAnim) { void board.offsetWidth; cardEl.forEach(el => el.classList.remove('nofx')); }
}

function dealAnimation() {
  computeLayout();
  // put every card on the stock first, face down
  const sx = L.stockXY.x, sy = L.stockXY.y;
  cardEl.forEach((el, id) => {
    el.classList.add('nofx'); el.classList.remove('up', 'peek');
    el.style.transitionDelay = '0ms';
    el.style.transform = `translate(${sx}px, ${sy}px)`;
  });
  void board.offsetWidth;
  cardEl.forEach(el => el.classList.remove('nofx'));
  const sp = speedMs();
  if (sp) {
    // deal order: row by row like a real deal
    let k = 0;
    for (let row = 0; row < 7; row++) for (let col = row; col < 7; col++) {
      const id = G.tab[col][row]; const d = (k++) * Math.min(35, sp / 6) + 'ms';
      cardEl[id].style.transitionDelay = d; cardEl[id].querySelector('.flip').style.transitionDelay = d;
    }
    sfx('shuffle');
  }
  requestAnimationFrame(() => {
    render();
    setTimeout(() => cardEl.forEach(el => { el.style.transitionDelay = ''; el.querySelector('.flip').style.transitionDelay = ''; }), 28 * 40 + sp + 50);
  });
}

/* ================= Pointer handling (tap + drag) ================= */
let drag = null;
board.addEventListener('pointerdown', e => {
  unlockAudio();
  if (busy || !G || G.won) return;
  if (drag) return;
  const cardNode = e.target.closest('.card');
  const slotNode = e.target.closest('.slot');
  if (cardNode) {
    const id = +cardNode.dataset.id;
    const loc = locate(id);
    if (loc.type === 'stock') { drawStock(); return; }
    const realId = loc.type === 'waste' ? top(G.waste) : id;
    const g = grabSet(realId);
    drag = { id: realId, g, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId };
    try { board.setPointerCapture(e.pointerId); } catch (_) {}
  } else if (slotNode === slotEl.stock) {
    drawStock();
  }
});
board.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 8 || !drag.g) return;
    drag.moved = true;
    drag.g.ids.forEach((id, k) => { const el = cardEl[id]; el.classList.add('drag'); el.style.zIndex = 1000 + k; });
  }
  drag.dx = dx; drag.dy = dy;
  drag.g.ids.forEach(id => { cardEl[id].style.transform = `translate(${pos[id].x + dx}px, ${pos[id].y + dy}px)`; });
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.pid)) return;
  const d = drag; drag = null;
  if (!d.moved) { if (S.tapMove) autoMove(d.id); return; }
  d.g.ids.forEach(id => cardEl[id].classList.remove('drag'));
  const lead = d.g.ids[0];
  const lx = pos[lead].x + d.dx, ly = pos[lead].y + d.dy;
  const target = dropTarget(lead, d.g, lx, ly, e ? e.clientX : 0, e ? e.clientY : 0);
  if (target) moveCards(d.g.ids, d.g.loc, target.type, target.i);
  else { trackAction('blocked'); render(); }
}
board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', e => { if (drag) { const d = drag; drag = null; d.g && d.g.ids.forEach(id => cardEl[id].classList.remove('drag')); render(); } });

function dropTarget(lead, g, lx, ly, px, py) {
  const { cw, ch } = L;
  const br = board.getBoundingClientRect();
  const pxl = px - br.left, pyl = py - br.top;
  const overlap = (x, y, w, h) => Math.max(0, Math.min(lx + cw, x + w) - Math.max(lx, x)) * Math.max(0, Math.min(ly + ch, y + h) - Math.max(ly, y));
  const contains = (x, y, w, h) => pxl >= x && pxl <= x + w && pyl >= y && pyl <= y + h;
  const cands = [];
  for (let t = 0; t < 7; t++) {
    if (g.loc.type === 'tab' && g.loc.i === t) continue;
    if (!canTab(lead, t)) continue;
    const p = G.tab[t];
    const x = L.tabX(t), y = L.tabY;
    const yEnd = p.length ? pos[top(p)].y + ch : y + ch;
    cands.push({ type: 'tab', i: t, a: overlap(x, y, cw, yEnd - y), hit: contains(x, y, cw, yEnd - y + ch * 0.5) });
  }
  if (g.ids.length === 1) for (let f = 0; f < 4; f++) {
    if (g.loc.type === 'found' && g.loc.i === f) continue;
    if (!canFound(lead, f)) continue;
    const { x, y } = L.foundXY(f);
    cands.push({ type: 'found', i: f, a: overlap(x, y, cw, ch), hit: contains(x, y, cw, ch) });
  }
  const hit = cands.find(c => c.hit);
  if (hit) return hit;
  cands.sort((a, b) => b.a - a.a);
  return cands.length && cands[0].a > 0 ? cands[0] : null;
}

/* ================= HUD & bar ================= */
const $ = id => document.getElementById(id);
const fmtTime = s => { const m = Math.floor(s / 60), x = s % 60; return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const money = n => (n < 0 ? '−€ ' : '€ ') + Math.abs(n);
function updateHud() {
  if (!G) return;
  $('scoreLabel').textContent = G.vegas ? 'Vegas' : 'Score';
  $('score').textContent = G.vegas ? money(S.vegasCumulative ? ST.vegasTotal + (G.counted ? 0 : -52) : G.score) : G.score;
  $('moves').textContent = G.moves;
  $('time').textContent = fmtTime(G.time);
}

const ICONS = {
  newg: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="12" height="16" rx="2"/><path d="M8 21h10a2 2 0 0 0 2-2V7"/><path d="M10 8v6M7 11h6"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  hint: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  stats: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/></svg>'
};
const BAR_ITEMS = [
  ['newg', 'Nieuw', () => newGame(true)],
  ['restart', 'Opnieuw', () => newGame(true, true)],
  ['hint', 'Hint', () => hint()],
  ['undo', 'Terug', () => undo()],
  ['stats', 'Statistiek', () => showStats()],
];
function buildBar() {
  const bar = $('bar'); bar.innerHTML = '';
  BAR_ITEMS.forEach(([key, label, fn]) => {
    if (!S.bar[key]) return;
    const b = document.createElement('button');
    b.id = 'btn-' + key; b.innerHTML = ICONS[key] + `<span>${label}</span>`;
    b.addEventListener('click', () => { unlockAudio(); fn(); });
    bar.appendChild(b);
  });
  const m = document.createElement('button');
  m.innerHTML = ICONS.menu + '<span>Menu</span>';
  m.addEventListener('click', () => { unlockAudio(); showMenu(); });
  bar.appendChild(m);
  updateBar();
}
function updateBar() {
  const u = $('btn-undo'); if (u) u.disabled = !H.length || (G && G.won);
}

/* ================= Timer ================= */
setInterval(() => {
  if (G) playTracking?.state(trackingDetails());
  playTracking?.tick(!!(G && G.started && !G.won && $('landing').hidden && ($('modal').hidden || !dialogPausesClock)));
  if (!G || !G.started || G.won || document.hidden || !$('modal').hidden && dialogPausesClock) return;
  G.time++;
  if (!G.vegas && G.time % 10 === 0) G.score = Math.max(0, G.score - 2);
  updateHud();
  if (G.time % 5 === 0) saveGame();
}, 1000);
let dialogPausesClock = true;

/* ================= Toast ================= */
function hideToast() { clearTimeout(toast.t); $('toast').classList.remove('show'); }
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ================= Dialogs ================= */
function dialog(title, html, buttons) {
  if (dialogPausesClock) endTracking('menu');
  const m = $('modal'), sh = m.querySelector('.sheet');
  sh.innerHTML = `${title ? `<h2>${title}</h2>` : ''}<div class="body">${html}</div>${buttons && buttons.length ? '<div class="btns"></div>' : ''}`;
  if (buttons) {
    const bx = sh.querySelector('.btns');
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.textContent = b.label; if (b.primary) el.className = 'primary'; if (b.danger) el.className = 'danger';
      if (b.disabled) el.disabled = true;
      el.addEventListener('click', b.action);
      bx.appendChild(el);
    });
  }
  m.hidden = false;
  return sh;
}
function closeDialog() { $('modal').hidden = true; }
$('modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal' && !G.won) closeDialog(); });

function showMenu() {
  const items = [
    ['newg', 'Nieuw spel', () => { closeDialog(); newGame(true); }],
    ['restart', 'Dit spel opnieuw', () => { closeDialog(); newGame(true, true); }],
    ['hint', 'Hint', () => { closeDialog(); hint(); }],
    ['undo', 'Zet terugnemen', () => { closeDialog(); undo(); }],
    ['stats', 'Statistieken', () => showStats()],
    ['settings', 'Instellingen', () => showSettings()],
    ['help', 'Uitleg', () => showHelp()],
    ['home', 'Op beginscherm zetten', () => showLanding(true)],
  ];
  const sh = dialog('Menu', '<div class="menu-list"></div>', [{ label: 'Sluiten', action: closeDialog }]);
  const list = sh.querySelector('.menu-list');
  items.forEach(([ic, label, fn]) => {
    const b = document.createElement('button'); b.innerHTML = ICONS[ic] + label;
    if (ic === 'undo' && (!H.length || G.won)) b.disabled = true;
    b.addEventListener('click', fn); list.appendChild(b);
  });
}

function seg(key, options, onChange) {
  return `<div class="seg" data-key="${key}">${options.map(([v, l]) => `<button data-v="${v}" class="${String(S[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function showSettings() {
  const row = (label, control) => `<div class="set-row"><span>${label}</span>${control}</div>`;
  const onoff = key => seg(key, [['true', 'Aan'], ['false', 'Uit']]);
  const barRow = (k, l) => `<div class="set-row"><span>${l}</span><div class="seg" data-bar="${k}"><button data-v="true" class="${S.bar[k] ? 'on' : ''}">Aan</button><button data-v="false" class="${!S.bar[k] ? 'on' : ''}">Uit</button></div></div>`;
  const html = `
  <div class="set-group"><h3>Spel</h3>
    ${row('Kaarten trekken', seg('draw', [[1, '1 kaart'], [3, '3 kaarten']]))}
    ${row('Telling', seg('vegas', [['false', 'Standaard'], ['true', 'Vegas']]))}
    ${row('Vegas optellen', onoff('vegasCumulative'))}
    <p class="note" id="nextNote">Wijzigingen bij “kaarten trekken” en “telling” gelden vanaf het volgende spel.</p>
    ${row('Automatisch afmaken', onoff('autoFinish'))}
    ${row('Tik om te verplaatsen', onoff('tapMove'))}
    ${row('Dichte kaarten tonen', onoff('unveil'))}
  </div>
  <div class="set-group"><h3>Weergave</h3>
    ${row('Kaartgrootte', seg('size', [['normaal', 'Normaal'], ['groot', 'Groot']]))}
    ${row('Kaarten', seg('deck', [['klassiek', 'Klassiek'], ['getekend', 'Frans getekend']]))}
    ${row('Kaartletters', seg('letters', [['en', 'K Q J'], ['nl', 'H V B'], ['fr', 'R D V']]))}
    <p class="note">Bij “Groot” hebben de klassieke kaarten extra grote hoekcijfers. De kaartletters gelden voor de Frans getekende kaarten.</p>
    ${row('Hand', seg('hand', [['rechts', 'Rechtshandig'], ['links', 'Linkshandig']]))}
    ${row('Kolomhoogte', seg('colHeight', [['dynamisch', 'Dynamisch'], ['vast', 'Vast']]))}
    ${row('Tijd tonen', onoff('showTime'))}
    ${row('Schaduwen', onoff('shadows'))}
    ${row('Achterkant', seg('back', [['blauw', 'Blauw'], ['rood', 'Rood'], ['groen', 'Groen'], ['zwart', 'Zwart']]))}
    ${row('Achtergrond', seg('felt', [['groen', 'Groen'], ['blauw', 'Blauw'], ['rood', 'Rood'], ['paars', 'Paars'], ['grijs', 'Grijs']]))}
    ${row('Snelheid', seg('speed', [['langzaam', 'Langzaam'], ['normaal', 'Normaal'], ['snel', 'Snel'], ['uit', 'Geen']]))}
  </div>
  <div class="set-group"><h3>Geluid</h3>${row('Geluid', onoff('sound'))}</div>
  <div class="set-group"><h3>Knoppen in de menubalk</h3>
    ${barRow('newg', 'Nieuw spel')}${barRow('restart', 'Dit spel opnieuw')}${barRow('hint', 'Hint')}${barRow('undo', 'Terug')}${barRow('stats', 'Statistieken')}
  </div>
  <p class="note" style="text-align:center">Patience ${VERSION} · zonder reclame<br>Klassieke kaarten: Byron Knoll (publiek domein)</p>`;
  const sh = dialog('Instellingen', html, [{ label: 'Klaar', primary: true, action: closeSettings }]);
  sh.querySelectorAll('.seg').forEach(sg => sg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    let v = b.dataset.v;
    if (v === 'true') v = true; else if (v === 'false') v = false; else if (/^\d+$/.test(v)) v = +v;
    if (sg.dataset.bar) { S.bar[sg.dataset.bar] = v; saveSettings(); buildBar(); return; }
    S[sg.dataset.key] = v; saveSettings();
    applySettings(sg.dataset.key);
  }));
}
function closeSettings() {
  closeDialog();
  if (G && (G.draw !== S.draw || G.vegas !== S.vegas)) {
    if (!G.counted) newGame(false, true);   // nothing played yet: apply right away to same deal
    else dialog('Nieuw spel?', `<p>De nieuwe instelling (${S.draw === 1 ? '1 kaart' : '3 kaarten'}, ${S.vegas ? 'Vegas' : 'Standaard'}) geldt vanaf het volgende spel.</p><p>Wil je nu een nieuw spel beginnen?</p>`, [
      { label: 'Later', action: closeDialog },
      { label: 'Nieuw spel', primary: true, action: () => { closeDialog(); newGame(false); } }
    ]);
  }
}
function applySettings(changed) {
  const b = document.body;
  b.classList.toggle('shadows', !!S.shadows);
  b.classList.toggle('notime', !S.showTime);
  b.classList.toggle('links', S.hand === 'links');
  ['groen', 'blauw', 'rood', 'grijs', 'paars'].forEach(f => b.classList.toggle('felt-' + f, S.felt === f));
  ['blauw', 'rood', 'groen', 'zwart'].forEach(f => b.classList.toggle('back-' + f, S.back === f));
  document.documentElement.style.setProperty('--spd', speedMs() + 'ms');
  const tc = { groen: '#0b6b3a', blauw: '#155a8a', rood: '#8a1f2a', grijs: '#44484d', paars: '#4e2a74' }[S.felt];
  document.querySelector('meta[name=theme-color]').setAttribute('content', tc);
  if (changed === 'letters' || changed === 'size' || changed === 'deck') { preloadCards(); refreshFaces(); const f = $('ldFan'); if (f) f.innerHTML = ''; }
  if (changed === 'vegasCumulative') updateHud();
  if (G) { relayout(); }
}

function showStats() {
  const s1 = ST.d1, s3 = ST.d3;
  const pct = s => s.played ? Math.round(100 * s.won / s.played) + '%' : '–';
  const v = x => x == null ? '–' : x;
  const avg = s => s.won ? fmtTime(Math.round(s.totalWinTime / s.won)) : '–';
  const html = `<table class="stats">
    <thead><tr><th></th><th>1 kaart</th><th>3 kaarten</th></tr></thead>
    <tbody>
      <tr><td>Gespeeld</td><td>${s1.played}</td><td>${s3.played}</td></tr>
      <tr><td>Gewonnen</td><td>${s1.won}</td><td>${s3.won}</td></tr>
      <tr><td>Percentage</td><td>${pct(s1)}</td><td>${pct(s3)}</td></tr>
      <tr><td>Huidige reeks</td><td>${s1.streak}</td><td>${s3.streak}</td></tr>
      <tr><td>Langste reeks</td><td>${s1.bestStreak}</td><td>${s3.bestStreak}</td></tr>
      <tr><td>Beste score</td><td>${v(s1.bestScore)}</td><td>${v(s3.bestScore)}</td></tr>
      <tr><td>Snelste tijd</td><td>${s1.bestTime == null ? '–' : fmtTime(s1.bestTime)}</td><td>${s3.bestTime == null ? '–' : fmtTime(s3.bestTime)}</td></tr>
      <tr><td>Gemiddelde tijd</td><td>${avg(s1)}</td><td>${avg(s3)}</td></tr>
      <tr><td>Minste zetten</td><td>${v(s1.bestMoves)}</td><td>${v(s3.bestMoves)}</td></tr>
    </tbody></table>
    <p style="margin-top:14px">Vegas totaal: <b>${money(ST.vegasTotal)}</b></p>`;
  dialog('Statistieken', html, [
    { label: 'Wissen', action: () => dialog('Statistieken wissen?', '<p>Weet je zeker dat je alle statistieken wilt wissen?</p>', [
      { label: 'Nee', action: showStats },
      { label: 'Wissen', danger: true, action: () => { ST.d1 = emptyStat(); ST.d3 = emptyStat(); ST.vegasTotal = 0; saveStats(); updateHud(); showStats(); } }
    ]) },
    { label: 'Sluiten', primary: true, action: closeDialog }
  ]);
}

function showHelp() {
  dialog('Uitleg', `
  <p><b>Doel:</b> leg alle kaarten op de vier stapels rechtsboven (of linksboven), per kleur van Aas tot Heer/Koning.</p>
  <p><b>De zeven rijen:</b> leg kaarten aflopend en om en om rood en zwart. Bijvoorbeeld een rode 9 op een zwarte 10. Je mag ook een hele reeks tegelijk verplaatsen.</p>
  <p><b>Lege rij:</b> daar mag alleen een Heer (Koning) of een reeks die met een Heer begint.</p>
  <p><b>De stapel:</b> tik op de dichte stapel om ${S.draw === 1 ? 'een kaart' : 'drie kaarten'} om te draaien. Kiezen tussen 1 of 3 kaarten doe je onder <b>Menu → Instellingen</b>. Is de stapel op, tik dan op de lege plek om opnieuw te beginnen.</p>
  <p><b>Verplaatsen:</b> tik op een kaart en hij gaat vanzelf naar de beste plek. Je kunt een kaart ook met je vinger slepen.</p>
  <p><b>Hint:</b> laat een mogelijke zet zien. Tik nog eens voor de volgende.</p>
  <p><b>Terug:</b> neemt de laatste zet terug, zo vaak als je wilt.</p>
  <p><b>Standaard telling:</b> +10 voor een kaart naar de stapels boven, +5 voor een kaart uit de stapel naar de rijen, +5 voor het omdraaien van een kaart, −15 voor een kaart terug van boven. Elke 10 seconden −2. Bij winst krijg je een tijdbonus.</p>
  <p><b>Vegas:</b> je begint met −€ 52 en krijgt € 5 voor elke kaart op de stapels boven. ${'Bij 1 kaart mag je maar één keer door de stapel, bij 3 kaarten drie keer.'}</p>
  <p>Het spel wordt vanzelf bewaard. Je kunt altijd verder waar je gebleven was.</p>`,
  [{ label: 'Sluiten', primary: true, action: closeDialog }]);
}

/* ================= Sound ================= */
let AC = null;
function unlockAudio() {
  if (!S.sound) return;
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
  } catch (e) {}
}
function noiseBurst(dur, freq, vol, when = 0, q = 1.2) {
  const t0 = AC.currentTime + when;
  const len = Math.floor(AC.sampleRate * dur);
  const buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = AC.createBufferSource(); src.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = AC.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(AC.destination); src.start(t0);
}
function tone(freq, dur, vol, when = 0, type = 'sine') {
  const t0 = AC.currentTime + when;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(AC.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}
function sfx(name) {
  if (!S.sound || !AC) return;
  try {
    switch (name) {
      case 'place': noiseBurst(0.07, 1500, 0.9); break;
      case 'flip': noiseBurst(0.05, 3000, 0.6); break;
      case 'draw': noiseBurst(0.06, 2200, 0.7); break;
      case 'found': noiseBurst(0.06, 1700, 0.8); tone(880, 0.18, 0.06, 0.02); break;
      case 'shuffle': for (let i = 0; i < 6; i++) noiseBurst(0.05, 1800 + i * 150, 0.5, i * 0.045); break;
      case 'hint': tone(660, 0.15, 0.08); tone(990, 0.2, 0.06, 0.1); break;
      case 'bad': tone(200, 0.18, 0.09, 0, 'triangle'); break;
      case 'win': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.35, 0.09, i * 0.13, 'triangle')); break;
    }
  } catch (e) {}
}

/* ================= Win animation (bouncing cards) ================= */
const canvas = $('winCanvas');
let winRAF = 0, winTimer = 0;
function cardImage(id) {
  const img = new Image();
  img.src = imgDeck() ? CARD_FILE(id) : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(faceSvg(id, true));
  return img;
}
function winAnimation() {
  if (speedMs() === 0) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const br = board.getBoundingClientRect();
  const { cw, ch } = L;
  // launch order: kings first from each foundation, round robin
  const queue = [];
  for (let r = 12; r >= 0; r--) for (let f = 0; f < 4; f++) { const id = G.found[f][r]; if (id != null) queue.push({ id, f }); }
  let active = null, qi = 0;
  const launch = () => {
    if (qi >= queue.length) return null;
    const { id, f } = queue[qi++];
    cardEl[id].style.visibility = 'hidden';
    return { img: cardImage(id), x: br.left + L.foundXY(f).x, y: br.top + L.foundXY(f).y, vx: (Math.random() < .5 ? -1 : 1) * (2 + Math.random() * 4), vy: -Math.random() * 6 - 1 };
  };
  active = launch();
  const stepFn = () => {
    if (!active) { winRAF = 0; return; }
    active.vy += 0.45; active.x += active.vx; active.y += active.vy;
    if (active.y + ch > innerHeight) { active.y = innerHeight - ch; active.vy = -active.vy * 0.78; if (Math.abs(active.vy) < 2) active.vy = -6 - Math.random() * 4; }
    if (active.img.complete && active.img.naturalWidth) ctx.drawImage(active.img, active.x, active.y, cw, ch);
    if (active.x < -cw || active.x > innerWidth) active = launch();
    winRAF = requestAnimationFrame(stepFn);
  };
  winRAF = requestAnimationFrame(stepFn);
  canvas.onpointerdown = () => stopWinAnimation(true);
}
function stopWinAnimation(keepDialog) {
  cancelAnimationFrame(winRAF); winRAF = 0;
  canvas.style.display = 'none';
  const ctx = canvas.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  cardEl.forEach(el => el.style.visibility = '');
}

/* ================= Resize / orientation ================= */
function relayout() {
  const land = innerWidth > innerHeight * 1.15 && innerHeight < 700;
  document.body.classList.toggle('landscape', land);
  computeLayout();
  render(true);
}
let rzT = 0;
addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(relayout, 60); });
addEventListener('orientationchange', () => setTimeout(relayout, 250));
document.addEventListener('visibilitychange', () => { if (document.hidden && G) saveGame(); });
addEventListener('pagehide', () => { if (G) saveGame(); });
// stop iOS pinch / double-tap zoom
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

/* ================= Landing page ================= */
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
let gameShown = false;
function buildFan() {
  const fan = $('ldFan'); if (!fan || fan.childElementCount) return;
  // ace of spades, king of hearts, queen of clubs, jack of diamonds
  [[0, -21, -64], [25, -7, -22], [50, 7, 22], [36, 21, 64]].forEach(([id, rot, dx], k) => {
    const d = document.createElement('div'); d.className = 'fc';
    d.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;
    d.style.animationDelay = (k * 90) + 'ms';
    d.innerHTML = faceHtml(id).replace(/cp(\d+)/g, 'lp$1');
    fan.appendChild(d);
  });
}
function showLanding(scrollToInstall) {
  endTracking('menu');
  closeDialog();
  buildFan();
  const ld = $('landing');
  const hasGame = !!(G && G.counted && !G.won) || !!(load(LS_GAME, null) || {}).G;
  $('ldPlay').textContent = gameShown ? 'Terug naar het spel' : (hasGame ? 'Verder spelen' : 'Spelen');
  $('ldPlay2').textContent = $('ldPlay').textContent;
  $('ldResume').hidden = gameShown || !hasGame;
  ld.hidden = false;
  ld.scrollTop = 0;
  if (scrollToInstall) requestAnimationFrame(() => $('ldInstall').scrollIntoView({ block: 'start' }));
}
function hideLanding() {
  unlockAudio();
  $('landing').hidden = true;
  if (!gameShown) startGame();
}
$('ldPlay').addEventListener('click', hideLanding);
$('ldPlay2').addEventListener('click', hideLanding);

/* ================= Boot ================= */
function startGame() {
  gameShown = true;
  const saved = load(LS_GAME, null);
  if (saved && saved.G && Array.isArray(saved.G.tab) && !saved.G.won) {
    G = saved.G; H = saved.H || [];
    relayout(); updateHud(); updateBar();
  } else {
    relayout();
    G = null; newGame(false);
  }
}
function boot() {
  preloadCards();
  buildCards();
  buildBar();
  applySettings();
  relayout();
  if (isStandalone()) startGame();
  else showLanding(false);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
// testing hook
window.__patience = { planNextAction, recentPositions, solve, findWinnableBack, smartHint, get plan() { return plan; }, findWinnableSeed, get busy() { return busy; }, moveCards: (...a) => moveCards(...a), foundTarget, analyse, get H() { return H; }, get G() { return G; }, set G(v) { G = v; }, render: () => { render(); updateHud(); }, afterChange: () => afterChange(), usefulMoves, autoMove, drawStock, undo, newGame, hint, S, ST, locate, layout: () => L };
boot();
})();
