(() => {
'use strict';
const $ = id => document.getElementById(id);
const zone = 'Europe/Amsterdam';
const dayFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone });
const timeFormatter = new Intl.DateTimeFormat('nl-NL', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayKey = t => dayFormatter.format(t);
const dateTime = t => timeFormatter.format(t);
const duration = s => s < 60 ? `${Math.floor(s)} sec` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} u ${Math.floor(s % 3600 / 60)} min`;
let records = [], cache = Object.create(null), stream = null, connected = false;
const key = location.hash.slice(1);
const valid = /^[a-f0-9]{32}$/.test(key);
const base = String((window.PATIENCE_TRACKING || {}).databaseUrl || '').replace(/\/$/, '');
$('connect').hidden = valid;
$('overview').hidden = !valid;
$('connectForm').onsubmit = e => {
  e.preventDefault();
  const input = $('privateLink').value.trim().split('#').pop();
  if (!/^[a-f0-9]{32}$/.test(input)) { $('notice').textContent = 'Plak de apparaatcode uit Firebase of een bestaande privélink.'; return; }
  location.hash = input;
};
addEventListener('hashchange', () => location.reload());
function render() {
  const now = Date.now(), today = dayKey(now);
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) - i * 86400000).toISOString().slice(0, 10));
  const totals = new Map(weekDays.map(d => [d, { seconds: 0, games: 0 }]));
  records.forEach(r => {
    if (dayKey(r.last) < weekDays[6]) return;
    // Split the measured time proportionally if a session spans a clock/date boundary.
    const span = Math.max(1, r.last - r.start);
    for (let t = r.start; t < r.last;) {
      const end = Math.min(r.last, (Math.floor(t / 60000) + 1) * 60000);
      const d = dayKey(t), entry = totals.get(d);
      if (entry) entry.seconds += r.seconds * (end - t) / span;
      t = end;
    }
    const entry = totals.get(dayKey(r.start));
    if (entry) entry.games += r.games;
  });
  $('todayTime').textContent = duration(totals.get(today).seconds);
  $('weekTime').textContent = duration([...totals.values()].reduce((n, d) => n + d.seconds, 0));
  const gamesToday = totals.get(today).games;
  $('todayGames').textContent = `${gamesToday} ${gamesToday === 1 ? 'spel' : 'spellen'}`;
  const latest = records.reduce((a, b) => !a || b.last > a.last ? b : a, null);
  const live = connected && records.some(r => r.active && now >= r.last && now - r.last < 75000);
  $('status').textContent = !connected ? 'Geen verbinding' : live ? 'Nu aan het spelen' : 'Nu niet actief';
  $('status').classList.toggle('live', live);
  $('lastPlayed').textContent = latest ? `${dateTime(latest.last)} · ${duration(latest.seconds)}` : 'Nog geen speelgegevens. Nieuwe speelmomenten verschijnen automatisch zodra opa speelt.';
  const max = Math.max(60, ...[...totals.values()].map(d => d.seconds));
  $('days').replaceChildren();
  [...weekDays].reverse().forEach(d => {
    const row = document.createElement('div'); row.className = 'bar-row';
    const label = document.createElement('span'); label.textContent = d.slice(8) + '-' + d.slice(5, 7);
    const bar = document.createElement('div'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = `${totals.get(d).seconds / max * 100}%`; bar.appendChild(fill);
    const time = document.createElement('span'); time.textContent = duration(totals.get(d).seconds);
    row.append(label, bar, time); $('days').appendChild(row);
  });
  $('sessions').replaceChildren();
  [...records].sort((a, b) => b.start - a.start).slice(0, 40).forEach(r => {
    const row = document.createElement('tr');
    [dateTime(r.start), duration(r.seconds), r.games, r.wins].forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); });
    $('sessions').appendChild(row);
  });
}
function put(path, data) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) { cache = Object.assign(Object.create(null), data || {}); return; }
  const [id, field] = parts;
  if (parts.length > 2 || parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) return;
  if (!field) { if (data === null) delete cache[id]; else cache[id] = data; }
  else if (cache[id]) { if (data === null) delete cache[id][field]; else cache[id][field] = data; }
}
function update(event, patch) {
  try {
    const message = JSON.parse(event.data);
    if (patch) Object.entries(message.data || {}).forEach(([key, value]) => put(`${message.path}/${key}`, value));
    else put(message.path, message.data);
    records = Object.values(cache).filter(r => r && ['start', 'last', 'seconds', 'games', 'wins'].every(k => Number.isFinite(r[k])) && r.last >= r.start && r.seconds >= 0);
    connected = true; $('notice').textContent = ''; render();
  } catch (_) { $('notice').textContent = 'Een update kon niet worden gelezen.'; }
}
function refresh() {
  if (!valid || stream || document.hidden || !base) return;
  const query = new URLSearchParams({ orderBy: '"start"', startAt: String(Date.now() - 90 * 86400000) });
  // Load history once, then receive only changes. No repeated history downloads.
  stream = new EventSource(`${base}/sessions/${key}.json?${query}`);
  stream.addEventListener('put', event => update(event, false));
  stream.addEventListener('patch', event => update(event, true));
  stream.onerror = () => { connected = false; $('notice').textContent = 'Geen verbinding. We proberen het zo weer.'; render(); };
  const denied = () => {
    stream.close(); stream = null; connected = false;
    $('notice').textContent = 'De database staat dit overzicht nog niet toe. Controleer de Firebase-regels.'; render();
  };
  stream.addEventListener('cancel', denied);
  stream.addEventListener('auth_revoked', denied);
}
if (!base) { $('notice').textContent = 'De aparte Firebase-database voor Patience is nog niet ingesteld.'; $('status').textContent = 'Nog niet ingesteld'; }
else if (!valid) $('status').textContent = 'Privélink nodig';
else { refresh(); setInterval(render, 10000); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (stream) stream.close(); stream = null; connected = false; }
  else refresh();
});
})();
