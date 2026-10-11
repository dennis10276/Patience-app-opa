/* Compact session summaries and observed gameplay signals; no board or move log. */
(() => {
'use strict';
// Automated browser runs must not create real players or gameplay history.
if (navigator.webdriver === true) return;
const KEY = 'patience.sharing.v1', QUEUE = 'patience.sessions.v1';
const CURSOR = 'patience.play-record.v2';
const IDLE = 120000, HEARTBEAT = 30000, MAX_PENDING = 500;
const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch (_) { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const validKey = k => /^[a-f0-9]{32}$/.test(k || '');
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const dayFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' });
const day = t => dayFormatter.format(t);
let sharing = read(KEY, {}), pending = read(QUEUE, {});
// Automatic on every installation, including upgrades from the former sharing switch.
if (!sharing || typeof sharing !== 'object') sharing = {};
if (!validKey(sharing.key)) sharing.key = randomId();
sharing = { key: sharing.key };
write(KEY, sharing);
// Never upload under an identity that will disappear on the next visit.
const identityReady = () => read(KEY, {}).key === sharing.key;
const device = /iPhone|iPod/.test(navigator.userAgent || '') ? 'iPhone' : /iPad/.test(navigator.userAgent || '') || (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(navigator.userAgent || '') ? 'Android' : 'Computer';
if (!pending || typeof pending !== 'object' || Array.isArray(pending)) pending = {};
let current = null, lastTouch = 0, lastTick = 0, lastSent = 0, flushing = false;
let state = {}, recent = null;
const terminal = new Set(['won', 'new_game', 'restart', 'midnight', 'unknown']);
const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
// Tab-scoped: reloading can resume, but independent tabs never overwrite each other's totals.
try {
  const cursor = JSON.parse(sessionStorage.getItem(CURSOR));
  if (cursor && cursor.key === sharing.key && validKey(cursor.id) && cursor.data?.detail?.v === 2 &&
      validKey(cursor.data.detail.round) && Number.isFinite(cursor.ms) && cursor.ms >= 0 &&
      cursor.ms < 90000000 && day(cursor.data.start) === day(Date.now())) {
    recent = cursor;
    if (recent.data.active) {
      recent.data.active = false;
      recent.data.detail.reason = 'recovered'; recent.data.detail.ended = recent.data.last;
      recent.data.detail.stops ||= {};
      recent.data.detail.stops.recovered = Math.min(10000, (recent.data.detail.stops.recovered || 0) + 1);
    }
  }
} catch (_) { /* Tracking still works without tab storage; only reload reuse is lost. */ }
const reasons = new Set(['unknown', 'won', 'lost', 'stuck', 'new_game', 'restart', 'menu', 'pause', 'hidden', 'closed', 'idle', 'suspended', 'midnight', 'recovered']);
const actions = new Set(['move', 'draw', 'recycle', 'undo', 'hint', 'blocked', 'auto_finish', 'input', 'mistake', 'note', 'erase', 'second_chance']);
const registered = new Set();
const base = () => String((window.PATIENCE_TRACKING || {}).databaseUrl || '').replace(/\/$/, '');
// Never resend a stale 'active' state after a browser crash or offline close.
for (const [id, entry] of Object.entries(pending)) {
  if (!entry || !validKey(entry.key) || !entry.data) delete pending[id];
  else { if (entry.data.active && entry.data.detail) { entry.data.detail.reason = 'recovered'; entry.data.detail.ended = entry.data.last; } entry.data.active = false; }
}
if (recent) pending[recent.id] = { key: sharing.key, data: JSON.parse(JSON.stringify(recent.data)) };
write(QUEUE, pending);
function save(record = current) {
  if (!record) return;
  pending[record.id] = { key: sharing.key, data: JSON.parse(JSON.stringify(record.data)) };
  const ids = Object.keys(pending);
  while (ids.length > MAX_PENDING) delete pending[ids.shift()];
  write(QUEUE, pending);
  try { sessionStorage.setItem(CURSOR, JSON.stringify({ ...record, key: sharing.key })); } catch (_) {}
}
function account(now) {
  if (!current) return;
  const dt = now - lastTick;
  // A suspended browser timer is not evidence of play during the gap.
  if (dt > 0 && dt <= 5000) {
    const until = Math.min(now, lastTouch + IDLE);
    current.hourMs ||= {};
    for (let t = lastTick; t < until;) {
      const end = Math.min(until, (Math.floor(t / 1000) + 1) * 1000);
      const h = 'h' + hourFormatter.format(t);
      current.hourMs[h] = (current.hourMs[h] || 0) + end - t;
      t = end;
    }
    current.ms += Math.max(0, until - lastTick);
    current.data.last = Math.max(current.data.last, until);
  }
  lastTick = now;
  current.data.seconds = Math.floor(current.ms / 1000);
  // Sparse, bounded hourly counters preserve actual play times across long pauses.
  current.data.detail.hours = Object.fromEntries(Object.entries(current.hourMs || {}).map(([h, ms]) => [h, Math.floor(ms / 1000)]).filter(([, n]) => n > 0));
}
function setState(details = {}) {
  state = { ...state, ...details };
  if (!current) return;
  const d = current.data.detail;
  if (validKey(state.round)) d.round = state.round;
  for (const k of ['build', 'mode']) if (typeof state[k] === 'string') d[k] = state[k].slice(0, 24);
  for (const k of ['progress', 'total', 'score', 'gameSeconds']) if (Number.isFinite(state[k])) {
    const n = Math.round(state[k]);
    if (k === 'progress' && n > d.progress) d.lastProgressAt = Date.now();
    d[k] = Math.max(k === 'score' ? -100000 : 0, Math.min(k === 'gameSeconds' ? 9000000 : k === 'score' ? 1000000 : 81, n));
  }
  for (const k of ['autoCheck', 'mistakeLimit', 'tapMove', 'autoFinish']) if (typeof state[k] === 'boolean') d[k] = state[k];
}
function stop(reason = 'unknown') {
  if (!reasons.has(reason)) reason = 'unknown';
  if (!current) {
    // A menu can stop the timer before its Restart/New game button is chosen.
    // Refine that observed ending without creating a fictitious play session.
    if (recent && ['new_game', 'restart'].includes(reason) && ['menu', 'pause', 'idle'].includes(recent.data.detail.reason) && Date.now() - recent.data.detail.ended < 300000) {
      const d = recent.data.detail;
      if (d.v === 2) {
        d.stops[d.reason] = Math.max(0, (d.stops[d.reason] || 1) - 1);
        if (!d.stops[d.reason]) delete d.stops[d.reason];
        d.stops[reason] = Math.min(10000, (d.stops[reason] || 0) + 1);
      }
      d.reason = reason; save(recent); flush();
    }
    return;
  }
  const now = Date.now(); account(now);
  const d = current.data.detail;
  d.reason = reason; d.ended = now;
  d.stops ||= {}; d.stops[reason] = Math.min(10000, (d.stops[reason] || 0) + 1);
  if (d.actionAt) d.maxGap = Math.max(d.maxGap, Math.min(120, Math.floor((now - d.actionAt) / 1000)));
  current.data.active = false;
  save(); recent = current; current = null;
  flush();
}
function touch(newGame = false, details = {}) {
  if (document.hidden) return false;
  if (!identityReady()) {
    write(KEY, sharing);
    if (!identityReady()) return false;
  }
  const now = Date.now();
  if (current && now - lastTouch >= IDLE) stop('idle');
  if (current && day(now) !== day(current.data.start)) stop('midnight');
  state = { ...state, ...details };
  if (current && validKey(details.round) && details.round !== current.data.detail.round) stop('new_game');
  if (!current) {
    if (!validKey(state.round) || newGame && !validKey(details.round)) state.round = randomId();
    if (recent?.data.detail.v === 2 && recent.data.detail.round === state.round &&
        !terminal.has(recent.data.detail.reason) && day(recent.data.start) === day(now) && now >= recent.data.last) {
      current = recent; current.data.active = true; current.data.detail.reason = 'playing';
      delete current.data.detail.ended;
      current.data.last = now;
      setState();
    } else {
      current = { id: randomId(), ms: 0, hourMs: {}, data: { start: now, last: now, seconds: 0, games: 0, wins: 0, active: true, detail: {
        v: 2, stops: {}, hours: {}, round: state.round, reason: 'playing', progress: 0, initial: 0, total: 52, actions: {}, lastAction: 'none', actionAt: 0, lastProgressAt: now, maxGap: 0
      } } };
      setState(); current.data.detail.initial = current.data.detail.progress;
    }
    recent = null; lastTick = now; lastTouch = now; lastSent = 0;
  } else { account(now); setState(); }
  lastTouch = now; current.data.last = now;
  if (newGame) current.data.games = 1;
  save();
  if (!lastSent) { lastSent = now; flush(); }
  return true;
}
function action(name, details = {}) {
  if (!current || !actions.has(name)) return;
  const previous = current.data.detail.actionAt;
  if (!touch(false, details)) return;
  const d = current.data.detail, now = Date.now();
  d.actions[name] = Math.min(10000, (d.actions[name] || 0) + 1);
  if (previous) d.maxGap = Math.max(d.maxGap, Math.min(120, Math.floor((now - previous) / 1000)));
  d.lastAction = name; d.actionAt = now;
  save();
}
function tick(playing) {
  if (!current) return;
  const now = Date.now();
  if (document.hidden) return stop('hidden');
  if (!playing) return stop('menu');
  if (now - lastTick > 5000) return stop('suspended');
  if (now - lastTouch >= IDLE) return stop('idle');
  // A midnight boundary is bookkeeping, not evidence that the player quit.
  if (day(now) !== day(current.data.start)) { stop('midnight'); touch(false, state); return; }
  account(now); save();
  if (now - lastSent >= HEARTBEAT) { lastSent = now; flush(); }
}
async function flush() {
  if (flushing || !base() || navigator.onLine === false) return;
  flushing = true;
  try {
    for (const id of Object.keys(pending)) {
      const entry = pending[id], body = JSON.stringify(entry.data);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        if (!registered.has(entry.key)) {
          // PATCH preserves any friendly name given in the family dashboard.
          const profile = await fetch(`${base()}/players/${entry.key}.json`, {
            method: 'PATCH', body: JSON.stringify({ device }), headers: { 'Content-Type': 'application/json' },
            signal: controller.signal, keepalive: true
          });
          if (!profile.ok) break;
          registered.add(entry.key);
        }
        const response = await fetch(`${base()}/sessions/${entry.key}/${id}.json`, {
          method: 'PUT', body, headers: { 'Content-Type': 'application/json' },
          signal: controller.signal, keepalive: true
        });
        if (!response.ok) break;
        // A new snapshot may have been saved while this request was in flight.
        if (pending[id] && JSON.stringify(pending[id].data) === body) { delete pending[id]; write(QUEUE, pending); }
      } finally { clearTimeout(timeout); }
    }
  } catch (_) { /* Offline/denied: retain summaries and retry later. */ }
  finally { flushing = false; }
}
window.PatienceTracking = {
  touch, tick, stop, flush, action, state: setState, newRound: randomId,
  win() { if (current) { current.data.wins++; stop('won'); } },
  get deviceId() { return sharing.key; }
};
document.addEventListener('visibilitychange', () => { if (document.hidden) stop('hidden'); else flush(); });
addEventListener('pagehide', () => stop('closed'));
addEventListener('online', flush);
setInterval(flush, HEARTBEAT);
flush();
})();
