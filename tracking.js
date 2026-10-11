/* One small, replaceable summary per play session. No move history or card data. */
(() => {
'use strict';
const KEY = 'patience.sharing.v1', QUEUE = 'patience.sessions.v1';
const IDLE = 120000, HEARTBEAT = 30000, MAX_PENDING = 500;
const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch (_) { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const validKey = k => /^[a-f0-9]{32}$/.test(k || '');
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
const dayFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' });
const day = t => dayFormatter.format(t);
let sharing = read(KEY, {}), pending = read(QUEUE, {});
if (!pending || typeof pending !== 'object' || Array.isArray(pending)) pending = {};
let current = null, lastTouch = 0, lastTick = 0, lastSent = 0, flushing = false;
const base = () => String((window.PATIENCE_TRACKING || {}).databaseUrl || '').replace(/\/$/, '');
// Never resend a stale 'active' state after a browser crash or offline close.
for (const [id, entry] of Object.entries(pending)) {
  if (!entry || !validKey(entry.key) || !entry.data) delete pending[id];
  else entry.data.active = false;
}
write(QUEUE, pending);
function save() {
  if (!current) return;
  pending[current.id] = { key: sharing.key, data: { ...current.data } };
  const ids = Object.keys(pending);
  while (ids.length > MAX_PENDING) delete pending[ids.shift()];
  write(QUEUE, pending);
}
function account(now) {
  if (!current) return;
  const dt = now - lastTick;
  // A suspended browser timer is not evidence of play during the gap.
  if (dt > 0 && dt <= 5000) {
    current.ms += Math.max(0, Math.min(now, lastTouch + IDLE) - lastTick);
    current.data.last = Math.min(now, lastTouch + IDLE);
  }
  lastTick = now;
  current.data.seconds = Math.floor(current.ms / 1000);
}
function stop() {
  if (!current) return;
  account(Date.now());
  current.data.active = false;
  save(); current = null;
  flush();
}
function touch(newGame = false) {
  if (!sharing.enabled || !validKey(sharing.key) || document.hidden) return;
  const now = Date.now();
  if (current && (now - lastTouch >= IDLE || day(now) !== day(current.data.start))) stop();
  if (!current) {
    current = { id: randomId(), ms: 0, data: { start: now, last: now, seconds: 0, games: 0, wins: 0, active: true } };
    lastTick = now; lastSent = 0;
  } else account(now);
  lastTouch = now;
  current.data.last = now;
  if (newGame) current.data.games++;
  save();
  if (!lastSent) { lastSent = now; flush(); }
}
function tick(playing) {
  if (!current) return;
  const now = Date.now();
  if (!playing || document.hidden || now - lastTouch >= IDLE || now - lastTick > 5000) return stop();
  // Split at local midnight so daily totals stay accurate.
  if (day(now) !== day(current.data.start)) { stop(); touch(); return; }
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
function enable() {
  if (!validKey(sharing.key)) sharing.key = randomId();
  sharing.enabled = true; write(KEY, sharing);
}
function disable() { stop(); sharing.enabled = false; write(KEY, sharing); }
function link() { return validKey(sharing.key) ? new URL(`dash/#${sharing.key}`, location.href).href : ''; }
window.PatienceTracking = {
  touch, tick, stop, flush, enable, disable, link,
  win() { if (current) { current.data.wins++; stop(); } },
  get enabled() { return !!sharing.enabled; },
  get configured() { return !!base(); }
};
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else flush(); });
addEventListener('pagehide', stop);
addEventListener('online', flush);
setInterval(flush, HEARTBEAT);
flush();
})();
