/* Patience (Klondike) – Nederlandse versie zonder reclame */
(() => {
'use strict';

const VERSION = '1.1.0';
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
  letters: 'en', size: 'groot', hand: 'rechts',
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
function startClock() {
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
  hintIdx = 0; stuckShown = false;
  liftCards(ids);
  sfx(toType === 'found' ? 'found' : 'place');
  afterChange();
}

function drawStock() {
  if (busy || G.won) return;
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
    if (!canRecycle()) { toast(G.vegas ? 'Je mag in Vegas niet meer opnieuw door de stapel' : 'Geen kaarten meer'); sfx('bad'); return; }
    pushHistory(); startClock();
    while (G.waste.length) { const c = G.waste.pop(); G.up[c] = 0; G.stock.push(c); }
    G.passes++; G.fan = 0; G.moves++;
    if (!G.vegas) addScore(G.draw === 1 ? -100 : -20);
    sfx('shuffle');
  } else return;
  hintIdx = 0; stuckShown = false;
  afterChange();
}

function undo() {
  if (busy || !H.length || G.won) return;
  const prev = JSON.parse(H.pop());
  const keep = { time: G.time, counted: G.counted, started: G.started };
  if (G.vegas && S.vegasCumulative) { ST.vegasTotal += prev.score - G.score; saveStats(); }
  G = Object.assign(prev, keep);
  hintIdx = 0; stuckShown = false;
  sfx('place');
  saveGame(); render(); updateHud(); updateBar();
}

/* best automatic destination for a tapped card */
function autoMove(id) {
  if (busy || G.won) return;
  const g = grabSet(id);
  if (!g) { shake([id]); return; }
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

/* can any card from stock/waste ever be played (without other changes)? */
function stockPlayable() {
  const playable = c => foundTarget(c) >= 0 || [0, 1, 2, 3, 4, 5, 6].some(t => canTab(c, t));
  let stock = G.stock.slice(), waste = G.waste.slice(), passes = G.passes, cycles = 0;
  if (waste.length && playable(top(waste))) return true;
  while (cycles < 3) {
    if (stock.length) {
      const n = Math.min(G.draw, stock.length);
      for (let k = 0; k < n; k++) waste.push(stock.pop());
      if (playable(top(waste))) return true;
    } else {
      if (!waste.length || passes >= maxPasses()) return false;
      while (waste.length) stock.push(waste.pop());
      passes++; cycles++;
    }
  }
  return false;
}

function hint() {
  if (busy || G.won) return;
  const moves = usefulMoves();
  if (moves.length) {
    const m = moves[hintIdx % moves.length]; hintIdx++;
    const dest = m.toType === 'found'
      ? (G.found[m.toIdx].length ? cardEl[top(G.found[m.toIdx])] : slotEl['f' + m.toIdx])
      : (G.tab[m.toIdx].length ? cardEl[top(G.tab[m.toIdx])] : slotEl['t' + m.toIdx]);
    flash(m.ids.map(i => cardEl[i]).concat([dest]));
    sfx('hint');
    return;
  }
  if ((G.stock.length || canRecycle()) && stockPlayable()) {
    flash([G.stock.length ? cardEl[top(G.stock)] : slotEl.stock]);
    toast(G.stock.length ? 'Tik op de stapel om een kaart te pakken' : 'Tik op de lege plek om de stapel om te draaien');
    sfx('hint');
    return;
  }
  noMoves();
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
  sfx('bad');
  dialog('Geen zetten meer', '<p>Er zijn geen zetten meer mogelijk.</p><p>Je kunt een zet terugnemen of een nieuw spel beginnen.</p>', [
    { label: 'Terug', action: () => { closeDialog(); undo(); }, disabled: !H.length },
    { label: 'Nieuw spel', primary: true, action: () => { closeDialog(); newGame(false); } },
    { label: 'Verder kijken', action: closeDialog }
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
  // detect being stuck: nothing useful on the table and nothing playable in the stock
  if (!stuckShown && !usefulMoves().length && !stockPlayable() && !anyTableauMove()) {
    stuckShown = true;
    setTimeout(() => { if (!G.won && !busy) noMoves(); }, speedMs() + 500);
  }
}

/* any legal tableau move at all (used so we never claim "stuck" too early) */
function anyTableauMove() {
  for (let s = 0; s < 7; s++) {
    const p = G.tab[s];
    for (let i = 0; i < p.length; i++) {
      if (!G.up[p[i]]) continue;
      for (let t = 0; t < 7; t++) {
        if (t === s || !canTab(p[i], t)) continue;
        if (i === 0 && !G.tab[t].length) continue;
        return true;
      }
    }
  }
  // a foundation card that could come back down
  for (let f = 0; f < 4; f++) { const c = top(G.found[f]); if (c >= 0) for (let t = 0; t < 7; t++) if (G.tab[t].length && canTab(c, t)) return true; }
  return false;
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
  stopWinAnimation();
  const seed = sameSeed && G ? G.seed : (Math.random() * 2 ** 31) | 0;
  G = newGameState(seed, S.draw, S.vegas);
  H = []; hintIdx = 0; stuckShown = false;
  saveGame();
  dealAnimation();
  updateHud(); updateBar();
}

/* ================= Layout & rendering ================= */
const board = document.getElementById('board');
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
/* top half of a court figure, local box 60 x 62; drawn twice (second copy turned 180°) */
function courtHalf(r, s) {
  const red = s === 1 || s === 2;
  const main = red ? RED : BLUE, trim = red ? BLUE : RED, col = red ? RED : BLK;
  const o = `stroke="${INK}" stroke-width=".8" stroke-linejoin="round"`;
  const face = `<ellipse cx="30" cy="21" rx="7.5" ry="8.5" fill="${SKIN}" ${o}/>
    <circle cx="27.3" cy="20" r=".9" fill="${INK}"/><circle cx="32.7" cy="20" r=".9" fill="${INK}"/>
    <path d="M30 21.5v3" stroke="${INK}" stroke-width=".7" fill="none"/>`;
  const robe = `<path d="M5 62 8 41Q15 32 30 31q15 1 22 10l3 21z" fill="${main}" ${o}/>
    <path d="M26 37h8v25h-8z" fill="${GOLD}" ${o}/>
    <path d="M26 44h8M26 51h8M26 58h8" stroke="${INK}" stroke-width=".6"/>
    <path d="M12 46l7 4-7 4M48 46l-7 4 7 4" fill="none" stroke="${GOLD}" stroke-width="2"/>
    <path d="M17 33.5Q30 43 43 33.5l-2-2.6Q30 38 19 30.9z" fill="${trim}" ${o}/>`;
  let fig = '';
  if (r === 13) { // king: crown, beard, sword
    fig = `<path d="M47.5 4h3v44h-3z" fill="#d9d9d9" ${o}/><path d="M42 41h14v3H42z" fill="${GOLD}" ${o}/>
      ${robe}
      <path d="M22 22q0 14 8 16 8-2 8-16-3 7-8 7t-8-7z" fill="${GOLD}" ${o}/>
      ${face}<path d="M26 26q4-2 8 0" stroke="${INK}" stroke-width=".8" fill="none"/>
      <path d="M21 13V3l4 5 3-7 2 6 2-6 3 7 4-5v10z" fill="${GOLD}" ${o}/><circle cx="30" cy="10" r="1.4" fill="${trim}"/>
      <circle cx="49" cy="46" r="3" fill="${SKIN}" ${o}/>`;
  } else if (r === 12) { // queen: long hair, tiara, flower
    fig = `<path d="M13 58V36" stroke="#3a7d32" stroke-width="1.4"/><path d="M13 44q-6-2-7-7 6 0 7 5z" fill="#3a7d32"/>
      ${robe}
      <path d="M21 16q-4 14 0 22l5-6q-3-6-1-14zM39 16q4 14 0 22l-5-6q3-6 1-14z" fill="${GOLD}" ${o}/>
      ${face}<path d="M28.2 26q1.8 1.2 3.6 0" stroke="${RED}" stroke-width="1" fill="none"/>
      <path d="M22 13l1-6 4 3 3-5 3 5 4-3 1 6z" fill="${GOLD}" ${o}/>
      <circle cx="23" cy="6.5" r="1.3" fill="${GOLD}" ${o}/><circle cx="30" cy="4.5" r="1.4" fill="${GOLD}" ${o}/><circle cx="37" cy="6.5" r="1.3" fill="${GOLD}" ${o}/>
      <circle cx="13" cy="33" r="4" fill="${trim}" ${o}/><circle cx="13" cy="33" r="1.6" fill="${GOLD}"/>
      <circle cx="13" cy="45" r="3" fill="${SKIN}" ${o}/>`;
  } else { // jack: cap with feather, staff
    fig = `<path d="M9.5 62V6h2v56z" fill="#8a5a2b" ${o}/><path d="M10.5 6q-7 4-6 11 3-3 6-3 3 0 6 3 1-7-6-11z" fill="#cfcfcf" ${o}/>
      ${robe}
      <path d="M22 17q-3 7 1 11l2-5zM38 17q3 7-1 11l-2-5z" fill="${GOLD}" ${o}/>
      ${face}
      <path d="M21 15q9-14 18 0z" fill="${trim}" ${o}/><path d="M20 15h20v2.5H20z" fill="${GOLD}" ${o}/>
      <path d="M37 9q9-8 16-4-8 1-14 7z" fill="${GOLD}" ${o}/>
      <circle cx="11" cy="45" r="3" fill="${SKIN}" ${o}/>`;
  }
  return fig + pipAt(s, 52, 7, 9, false, col);
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
const faceHtml = id => faceSvg(id, false);

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
    const maxByH = (Hh - gap * 3) / (1.4 * (large ? 3.3 : 3.7));
    cw = Math.floor(Math.min(cw, maxByH, 150));
  } else {
    // landscape: foundations in one side column, stock + waste in the other, tableau in the middle
    gap = Math.max(3, Math.round(Hh * (large ? 0.014 : 0.022)));
    cw = (W - gap * 13) / 9;
    const maxByH = (Hh - gap * 5) / 4 / 1.4;
    cw = Math.floor(Math.min(cw, maxByH * (large ? 1.12 : 1), 150));
  }
  const ch = Math.round(cw * 1.4);
  const fi = Math.round(cw * (large ? 0.42 : 0.33));   // index font size
  const fs = Math.round(cw * (large ? 0.34 : 0.27));   // small suit size
  const topY = Math.max(gap, 6);
  L = {
    W, H: Hh, cw, ch, gap, fi, fs, side,
    upOff: Math.round(cw * (idxMetrics().sy + idxMetrics().ss + 4) / 100),
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
  st.setProperty('--cr', Math.max(3, Math.round(cw * 0.08)) + 'px');
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
  else render();
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
  if (!G || !G.started || G.won || document.hidden || !$('modal').hidden && dialogPausesClock) return;
  G.time++;
  if (!G.vegas && G.time % 10 === 0) G.score = Math.max(0, G.score - 2);
  updateHud();
  if (G.time % 5 === 0) saveGame();
}, 1000);
let dialogPausesClock = true;

/* ================= Toast ================= */
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ================= Dialogs ================= */
function dialog(title, html, buttons) {
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
    ${row('Kaartletters', seg('letters', [['en', 'K Q J'], ['nl', 'H V B'], ['fr', 'R D V']]))}
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
  <p class="note" style="text-align:center">Patience ${VERSION} · zonder reclame</p>`;
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
  if (changed === 'letters' || changed === 'size') refreshFaces();
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
  <p><b>De stapel:</b> tik op de dichte stapel om ${S.draw === 1 ? 'een kaart' : 'drie kaarten'} om te draaien. Is de stapel op, tik dan op de lege plek om opnieuw te beginnen.</p>
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
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(faceSvg(id, true));
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
const isAndroid = /Android/i.test(navigator.userAgent);
function setLandingTab(tab) {
  document.querySelectorAll('.ld-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.ld-steps').forEach(o => o.hidden = o.dataset.pane !== tab);
}
document.querySelectorAll('.ld-tabs button').forEach(b => b.addEventListener('click', () => setLandingTab(b.dataset.tab)));
let gameShown = false;
function showLanding(scrollToInstall) {
  closeDialog();
  const ld = $('landing');
  const hasGame = !!(G && G.counted && !G.won) || !!(load(LS_GAME, null) || {}).G;
  $('ldPlay').textContent = gameShown ? 'Terug naar het spel' : (hasGame ? 'Verder spelen' : 'Spelen');
  $('ldPlay2').textContent = $('ldPlay').textContent;
  $('ldResume').hidden = gameShown || !hasGame;
  setLandingTab(isAndroid ? 'android' : 'ios');
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
window.__patience = { get G() { return G; }, set G(v) { G = v; }, render: () => { render(); updateHud(); }, afterChange: () => afterChange(), usefulMoves, autoMove, drawStock, undo, newGame, hint, S, ST, locate, layout: () => L };
boot();
})();
