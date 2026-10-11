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
let players = Object.create(null), directory = null, directoryLoaded = false;
const validKey = key => /^[a-f0-9]{32}$/.test(key || '');
let key = validKey(location.hash.slice(1)) ? location.hash.slice(1) : '';
if (!key) { try { const saved = localStorage.getItem('patience.dashboard.player'); if (validKey(saved)) key = saved; } catch (_) {} }
const base = String((window.PATIENCE_TRACKING || {}).databaseUrl || '').replace(/\/$/, '');
function choose(next) {
  if (!validKey(next)) return;
  if (next !== key) {
    if (stream) stream.close(); stream = null;
    cache = Object.create(null); records = []; connected = false;
  }
  key = next;
  history.replaceState(null, '', '#' + key);
  try { localStorage.setItem('patience.dashboard.player', key); } catch (_) {}
  $('who').value = key;
  $('playerName').value = players[key]?.name || '';
  $('nameStatus').textContent = '';
  $('overview').hidden = false; $('naming').hidden = false;
  render(); refresh();
}
function fillPicker() {
  const list = Object.entries(players).filter(([id, p]) => validKey(id) && p && typeof p === 'object');
  // Preserve old bookmarked links, including devices that have not received the update yet.
  if (key && !list.some(([id]) => id === key)) list.push([key, {}]);
  const label = (id, p) => `${typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : p.device || 'Apparaat'} · ${id.slice(0, 8)}`;
  list.sort((a, b) => label(...a).localeCompare(label(...b), 'nl'));
  $('who').replaceChildren();
  for (const [id, p] of list) { const option = document.createElement('option'); option.value = id; option.textContent = label(id, p); $('who').appendChild(option); }
  $('who').disabled = !list.length;
  $('empty').hidden = !!list.length || !directoryLoaded;
  if (!list.length) { const option = document.createElement('option'); option.textContent = 'Nog geen spelers'; $('who').appendChild(option); $('status').textContent = 'Nog geen spelers'; return; }
  if (!key) choose((list.find(([, p]) => /^opa$/i.test(p.name || '')) || list[0])[0]);
  else { $('who').value = key; $('overview').hidden = false; $('naming').hidden = false; refresh(); }
}
$('who').onchange = () => choose($('who').value);
addEventListener('hashchange', () => { const next = location.hash.slice(1); if (validKey(next)) { choose(next); fillPicker(); } });
$('nameForm').onsubmit = async e => {
  e.preventDefault();
  const id = key, name = $('playerName').value.trim();
  if (!validKey(id) || !name || name.length > 40) return;
  $('saveName').disabled = true; $('nameStatus').textContent = 'Opslaan…';
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${base}/players/${id}.json`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), signal: controller.signal });
    if (!response.ok) throw new Error('denied');
    if (!players[id]) players[id] = {};
    players[id].name = name; fillPicker();
    if (key === id) $('nameStatus').textContent = 'Naam opgeslagen.';
  } catch (_) { if (key === id) $('nameStatus').textContent = 'Naam niet opgeslagen. Probeer het opnieuw zodra er verbinding is.'; }
  finally { clearTimeout(timeout); $('saveName').disabled = false; }
};
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
function put(target, path, data) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return Object.assign(Object.create(null), data || {});
  const [id, field] = parts;
  if (parts.length > 2 || parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) return target;
  if (!field) { if (data === null) delete target[id]; else target[id] = data; }
  else {
    if (!target[id] || typeof target[id] !== 'object') target[id] = Object.create(null);
    if (data === null) delete target[id][field]; else target[id][field] = data;
  }
  return target;
}
function apply(target, event, patch) {
  const message = JSON.parse(event.data);
  if (patch) Object.entries(message.data || {}).forEach(([field, value]) => { target = put(target, `${message.path}/${field}`, value); });
  else target = put(target, message.path, message.data);
  return target;
}
function update(event, patch) {
  try {
    cache = apply(cache, event, patch);
    records = Object.values(cache).filter(r => r && ['start', 'last', 'seconds', 'games', 'wins'].every(k => Number.isInteger(r[k])) && r.last >= r.start && r.last - r.start <= 90000000 && r.seconds >= 0 && r.seconds <= 90000 && r.games >= 0 && r.games <= 1000 && r.wins >= 0 && r.wins <= 1000 && typeof r.active === 'boolean');
    connected = true; $('notice').textContent = ''; render();
  } catch (_) { $('notice').textContent = 'Een update kon niet worden gelezen.'; }
}
function refresh() {
  if (!validKey(key) || stream || document.hidden || !base) return;
  const query = new URLSearchParams({ orderBy: '"start"', startAt: String(Date.now() - 90 * 86400000) });
  // Load history once, then receive only changes. No repeated history downloads.
  const source = stream = new EventSource(`${base}/sessions/${key}.json?${query}`);
  source.addEventListener('put', event => { if (source === stream) update(event, false); });
  source.addEventListener('patch', event => { if (source === stream) update(event, true); });
  source.onerror = () => { if (source !== stream) return; connected = false; $('notice').textContent = 'Geen verbinding. We proberen het zo weer.'; render(); };
  const denied = () => {
    if (source !== stream) return;
    source.close(); stream = null; connected = false;
    $('notice').textContent = 'De database staat dit overzicht nog niet toe. Controleer de Firebase-regels.'; render();
  };
  source.addEventListener('cancel', denied);
  source.addEventListener('auth_revoked', denied);
}
function loadPlayers() {
  if (directory || document.hidden || !base) return;
  const source = directory = new EventSource(`${base}/players.json`);
  for (const kind of ['put', 'patch']) source.addEventListener(kind, event => {
    if (directory !== source) return;
    try { players = apply(players, event, kind === 'patch'); directoryLoaded = true; $('notice').textContent = ''; fillPicker(); }
    catch (_) { $('notice').textContent = 'De spelerslijst kon niet worden gelezen.'; }
  });
  source.onerror = () => { if (directory === source) $('notice').textContent = 'Spelerslijst tijdelijk niet bereikbaar. We proberen het zo weer.'; };
  const denied = () => {
    if (directory !== source) return;
    source.close(); directory = null;
    $('notice').textContent = 'De spelerslijst is nog niet toegankelijk. Controleer de Firebase-regels.';
    if (!key) $('status').textContent = 'Spelerslijst niet beschikbaar';
  };
  source.addEventListener('cancel', denied); source.addEventListener('auth_revoked', denied);
}
if (!base) { $('notice').textContent = 'De aparte Firebase-database voor Patience is nog niet ingesteld.'; $('status').textContent = 'Nog niet ingesteld'; }
else { if (key) { fillPicker(); choose(key); } loadPlayers(); setInterval(() => { if (key) render(); }, 10000); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (stream) stream.close(); stream = null; connected = false;
    if (directory) directory.close(); directory = null;
    if (key) render();
  } else { refresh(); loadPlayers(); }
});
})();
