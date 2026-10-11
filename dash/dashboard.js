(() => {
'use strict';
const $ = id => document.getElementById(id);
const zone = 'Europe/Amsterdam';
const dayFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone });
const timeFormatter = new Intl.DateTimeFormat('nl-NL', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayKey = t => dayFormatter.format(t);
const dateTime = t => timeFormatter.format(t);
const duration = s => s < 60 ? `${Math.floor(s)} sec` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} u ${Math.floor(s % 3600 / 60)} min`;
const levels = { easy: 'Makkelijk', medium: 'Gemiddeld', hard: 'Moeilijk', expert: 'Expert', master: 'Meester', extreme: 'Extreem' };
const endings = { playing: 'Aan het spelen', won: 'Gewonnen / voltooid', lost: 'Foutenlimiet bereikt', stuck: 'Geen zetten meer gemeld', new_game: 'Nieuw spel gekozen', restart: 'Opnieuw begonnen', menu: 'Menu / startscherm geopend', pause: 'Pauze gekozen', hidden: 'App verborgen / scherm uit', closed: 'Pagina verlaten', idle: '2 minuten geen aanraking', suspended: 'Browser onderbroken', midnight: 'Daggrens (geen stop)', recovered: 'Hersteld na onderbreking', unknown: 'Geen betrouwbare eindmelding' };
const actionNames = { move: 'Kaart verplaatst', draw: 'Stapel getrokken', recycle: 'Stapel omgedraaid', undo: 'Ongedaan', hint: 'Hint', blocked: 'Zet lukte niet', auto_finish: 'Automatisch uitgespeeld', input: 'Getal ingevuld', mistake: 'Fout getal gemeld', note: 'Notitie gewijzigd', erase: 'Gewist', second_chance: 'Tweede kans' };
const hourFormatter = new Intl.DateTimeFormat('nl-NL', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' });
const weekdayFormatter = new Intl.DateTimeFormat('nl-NL', { timeZone: zone, weekday: 'short' });
let periodDays = 30;
const validGame = game => ['all', 'patience', 'sudoku'].includes(game);
const params = new URLSearchParams(location.search || '');
let game = params.get('game');
if (!validGame(game)) { try { game = localStorage.getItem('opa.dashboard.game'); } catch (_) {} }
if (!validGame(game)) game = 'all';
$('game').value = game;
const appOf = record => record.app || 'patience';
function bookmark() {
  const query = new URLSearchParams(location.search || '');
  query.set('game', game);
  const queryString = query.toString();
  history.replaceState(null, '', location.pathname + (queryString ? '?' + queryString : '') + '#' + key);
}
const expandedSessions = new Set();
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
  bookmark();
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
$('period').onchange = () => { if ([7, 30, 90].includes(Number($('period').value))) { periodDays = Number($('period').value); render(); } };
$('who').onchange = () => choose($('who').value);
$('game').onchange = () => {
  if (!validGame($('game').value)) return;
  game = $('game').value;
  try { localStorage.setItem('opa.dashboard.game', game); } catch (_) {}
  if (key) bookmark();
  render();
};
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
  const visible = records.filter(r => game === 'all' || appOf(r) === game);
  const showSudoku = game !== 'patience';
  $('gameSummary').textContent = game === 'sudoku' ? 'Sudoku' : game === 'patience' ? 'Patience' : 'Patience en Sudoku samen';
  const now = Date.now(), today = dayKey(now);
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) - i * 86400000).toISOString().slice(0, 10));
  const totals = new Map(weekDays.map(d => [d, { seconds: 0, games: 0, wins: 0, hints: 0, mistakes: 0 }]));
  visible.forEach(r => {
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
    // Completed puzzles and actions belong to the day of the session's last activity.
    const endEntry = totals.get(dayKey(r.last));
    if (endEntry) { endEntry.wins += r.wins; endEntry.hints += r.hints || 0; endEntry.mistakes += r.mistakes || 0; }
  });
  $('todayTime').textContent = duration(totals.get(today).seconds);
  $('weekTime').textContent = duration([...totals.values()].reduce((n, d) => n + d.seconds, 0));
  $('weekWins').textContent = [...totals.values()].reduce((n, d) => n + d.wins, 0);
  const sudoku = visible.filter(r => appOf(r) === 'sudoku' && totals.has(dayKey(r.last)));
  $('sudokuSummary').hidden = !showSudoku;
  $('sudokuHints').textContent = sudoku.reduce((n, r) => n + r.hints, 0);
  $('sudokuMistakes').textContent = sudoku.reduce((n, r) => n + r.mistakes, 0);
  const gamesToday = totals.get(today).games;
  $('todayGames').textContent = `${gamesToday} ${gamesToday === 1 ? 'spel' : 'spellen'}`;
  const latest = visible.reduce((a, b) => !a || b.last > a.last ? b : a, null);
  const active = connected ? visible.filter(r => r.active && now >= r.last && now - r.last < 75000) : [];
  const live = !!active.length;
  $('status').textContent = !key ? 'Nog geen spelers' : !connected ? 'Geen verbinding' : live ? (game === 'all' ? 'Nu aan het spelen' : `Speelt nu ${game === 'sudoku' ? 'Sudoku' : 'Patience'}`) : 'Nu niet actief';
  $('status').classList.toggle('live', live);
  $('lastPlayed').textContent = latest ? `${dateTime(latest.last)} · ${appOf(latest) === 'sudoku' ? 'Sudoku' : 'Patience'} · ${duration(latest.seconds)}` : 'Nog geen speelgegevens voor deze keuze. Nieuwe speelmomenten verschijnen automatisch zodra opa speelt.';
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
  [...visible].sort((a, b) => b.start - a.start).slice(0, 40).forEach(r => {
    const row = document.createElement('tr');
    const isSudoku = appOf(r) === 'sudoku';
    const d = r.detail;
    const values = [dateTime(r.start), isSudoku ? 'Sudoku' : 'Patience', duration(r.seconds), ending(r, now), d ? `${Math.round(d.initial / Math.max(1, d.total) * 100)} → ${Math.round(d.progress / Math.max(1, d.total) * 100)}%` : 'Niet gemeten'];
    values.forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); });
    const detailCell = document.createElement('td');
    if (d) {
      const details = document.createElement('details'), summary = document.createElement('summary');
      const expansionKey = key + ':' + r._id;
      details.open = expandedSessions.has(expansionKey);
      details.addEventListener('toggle', () => { if (details.open) expandedSessions.add(expansionKey); else expandedSessions.delete(expansionKey); });
      summary.textContent = isSudoku ? `${levels[r.level]}${r.daily ? ' · dagelijks' : ''} · ${r.hints} hints · ${r.mistakes} fouten` : 'Bekijk spelacties'; details.appendChild(summary);
      const add = text => { const line = document.createElement('p'); line.textContent = text; details.appendChild(line); };
      add(`Begonnen: ${r.games} · Gewonnen / voltooid: ${r.wins} · Laatste activiteit: ${dateTime(r.last)} · Eindmelding: ${d.ended ? dateTime(d.ended) : 'nog geen eindmelding'}`);
      add(Object.entries(d.actions || {}).map(([k, n]) => `${actionNames[k]}: ${n}`).join(' · ') || 'Geen spelacties gemeten');
      add(`Laatste spelactie: ${actionNames[d.lastAction] || 'Niet gemeten'}${d.actionAt ? ' om ' + dateTime(d.actionAt) : ''}. Langste tijd zonder spelactie: ${duration(d.maxGap)} (maximaal 2 min).`);
      add(`Voortgang sinds ${dateTime(d.lastProgressAt)} niet verder toegenomen. Dit meet ${isSudoku ? 'goed ingevulde vakjes' : 'kaarten op de stapels boven'}, niet alle nuttige zetten.`);
      add(`Voortgang: ${d.progress} van ${d.total} ${isSudoku ? 'in te vullen vakjes goed' : 'kaarten bovenop'}. Score: ${d.score == null ? '—' : d.score}. Spelklok: ${d.gameSeconds == null ? '—' : duration(d.gameSeconds)}.`);
      if (isSudoku) add(`Fouten tonen: ${d.autoCheck ? 'aan' : 'uit'} · 3-foutenlimiet: ${d.mistakeLimit ? 'aan' : 'uit'}`);
      else add(`Tik om te verplaatsen: ${d.tapMove ? 'aan' : 'uit'} · Automatisch uitspelen: ${d.autoFinish ? 'aan' : 'uit'}`);
      add(`Appversie: ${d.build || 'onbekend'} · Poging: ${d.round.slice(0, 8)} (dezelfde code = verder gespeeld). Eindtijd is de tijd van de eindmelding; achtergrond of onderbreking vertelt niet waarom hij stopte.`);
      detailCell.appendChild(details);
    } else detailCell.textContent = `${isSudoku ? levels[r.level] + (r.daily ? ' · Dagelijks' : '') + ' · ' + r.hints + ' hints · ' + r.mistakes + ' fouten · ' : ''}Begonnen: ${r.games} · Voltooid: ${r.wins} · Laatste update: ${dateTime(r.last)}. Oude versie: geen uitgebreide spelacties.`;
    row.appendChild(detailCell); $('sessions').appendChild(row);
  });
  renderInsights(visible, now);
}
function ending(r, now) {
  if (!r.detail) return 'Niet gemeten (oude versie)';
  const reason = r.detail.reason;
  if (reason === 'playing' && (!r.active || now < r.last || now - r.last >= 75000)) return endings.unknown;
  return endings[reason] || endings.unknown;
}
function validDetail(d, r) {
  if (!d || d.v !== 1 || !validKey(d.round) || !Object.prototype.hasOwnProperty.call(endings, d.reason)) return false;
  if (!['progress', 'initial', 'total', 'maxGap', 'actionAt', 'lastProgressAt'].every(k => Number.isInteger(d[k]) && d[k] >= 0)) return false;
  if (d.total < 1 || d.total > 81 || d.progress > d.total || d.initial > d.total || d.maxGap > 120) return false;
  if (d.lastProgressAt < r.start || d.lastProgressAt > r.last || d.actionAt !== 0 && (d.actionAt < r.start || d.actionAt > r.last)) return false;
  if (d.ended !== undefined && (!Number.isInteger(d.ended) || d.ended < r.last)) return false;
  if (d.reason !== 'playing' && d.ended === undefined || d.lastAction !== 'none' && !Object.prototype.hasOwnProperty.call(actionNames, d.lastAction)) return false;
  return d.actions === undefined || d.actions && typeof d.actions === 'object' && !Array.isArray(d.actions) && Object.entries(d.actions).every(([k, n]) => Object.prototype.hasOwnProperty.call(actionNames, k) && Number.isInteger(n) && n >= 0 && n <= 10000);
}
function bars(id, entries, formatter = duration) {
  const parent = $(id); parent.replaceChildren();
  const max = Math.max(1, ...entries.map(([, n]) => n));
  for (const [label, n] of entries) {
    const row = document.createElement('div'), name = document.createElement('span'), bar = document.createElement('div'), fill = document.createElement('i'), value = document.createElement('span');
    row.className = 'bar-row'; name.textContent = label; bar.className = 'bar'; fill.style.width = `${n / max * 100}%`; value.textContent = formatter(n);
    bar.appendChild(fill); row.append(name, bar, value); parent.appendChild(row);
  }
}
function renderInsights(visible, now) {
  const cutoff = now - periodDays * 86400000;
  const selected = visible.filter(r => r.last >= cutoff);
  const measured = selected.filter(r => r.detail), actual = measured.filter(r => r.detail.reason !== 'midnight');
  $('coverage').textContent = `${selected.length} ${selected.length === 1 ? 'speelblok' : 'speelblokken'} in ${periodDays} dagen; ${measured.length} met uitgebreide metingen. Een pauze of menu kan een spel in meerdere blokken splitsen. Oudere blokken missen deze extra gegevens.`;
  const lengths = actual.map(r => r.seconds).sort((a, b) => a - b);
  const median = lengths.length ? (lengths[Math.floor((lengths.length - 1) / 2)] + lengths[Math.floor(lengths.length / 2)]) / 2 : 0;
  $('typicalTime').textContent = lengths.length ? duration(median) : 'Nog geen metingen';
  $('measuredSessions').textContent = actual.length;
  const rounds = new Map();
  for (const r of measured) { const group = rounds.get(r.detail.round) || []; group.push(r); rounds.set(r.detail.round, group); }
  $('observedRounds').textContent = rounds.size;
  $('observedCompleted').textContent = [...rounds.values()].filter(list => list.some(r => r.wins > 0)).length;
  const hours = Array(24).fill(0), weekdays = new Map(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(d => [d, 0]));
  for (const r of selected) {
    const span = Math.max(1, r.last - r.start);
    // Allocate measured play proportionally; the summary does not contain an event timeline.
    for (let t = Math.max(r.start, cutoff); t < r.last;) {
      const end = Math.min(r.last, (Math.floor(t / 3600000) + 1) * 3600000), seconds = r.seconds * (end - t) / span;
      hours[Number(hourFormatter.format(t)) % 24] += seconds;
      const weekday = weekdayFormatter.format(t).replace('.', '');
      if (weekdays.has(weekday)) weekdays.set(weekday, weekdays.get(weekday) + seconds);
      t = end;
    }
  }
  const peakHour = hours.indexOf(Math.max(...hours)), peakDay = [...weekdays].sort((a, b) => b[1] - a[1])[0];
  $('preferredTimes').textContent = hours.some(n => n > 0) ? `Meeste gemeten speeltijd: ${String(peakHour).padStart(2, '0')}:00–${String((peakHour + 1) % 24).padStart(2, '0')}:00; weekdag: ${peakDay[0]}. Bekijk de verdeling hieronder; bij gelijke waarden wordt één piek getoond.` : 'Nog geen speeltijd om uren of weekdagen te vergelijken.';
  bars('hours', hours.map((n, h) => [`${String(h).padStart(2, '0')}:00`, n]));
  bars('weekdays', [...weekdays]);
  const counts = new Map();
  for (const r of actual) { const label = ending(r, now); counts.set(label, (counts.get(label) || 0) + 1); }
  bars('endings', [...counts].sort((a, b) => b[1] - a[1]), n => `${n}×`);
  $('endingEmpty').hidden = !!actual.length;
  const actions = {};
  for (const r of measured) for (const [k, n] of Object.entries(r.detail.actions)) actions[k] = (actions[k] || 0) + n;
  bars('actionCounts', Object.entries(actions).map(([k, n]) => [actionNames[k], n]).sort((a, b) => b[1] - a[1]), n => `${n}×`);
  const groups = new Map();
  for (const list of rounds.values()) {
    const r = list[0], mode = r.app === 'sudoku' ? `Sudoku · ${levels[r.level]}${r.daily ? ' · dagelijks' : ''}` : `Patience · ${r.detail.mode?.startsWith('vegas') ? 'Vegas ' : ''}${r.detail.mode?.endsWith('3') ? '3 kaarten' : '1 kaart'}`;
    const group = groups.get(mode) || { attempts: 0, completed: 0, hints: 0, errors: 0 };
    group.attempts++; if (list.some(x => x.wins > 0)) group.completed++;
    group.hints += list.reduce((n, x) => n + (x.detail.actions.hint || 0), 0);
    group.errors += list.reduce((n, x) => n + (x.detail.actions.mistake || 0) + (x.detail.actions.blocked || 0), 0);
    groups.set(mode, group);
  }
  $('modes').replaceChildren();
  for (const [mode, g] of groups) {
    const row = document.createElement('tr');
    for (const value of [mode, g.attempts, g.completed, g.hints, g.errors]) { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); }
    $('modes').appendChild(row);
  }
  $('signals').replaceChildren();
  const signal = text => { const p = document.createElement('p'); p.textContent = text; $('signals').appendChild(p); };
  const lost = actual.filter(r => r.detail.reason === 'lost').length, stuck = actual.filter(r => r.detail.reason === 'stuck').length;
  if (actions.blocked) signal(`${actions.blocked} kaartacties leverden geen zet op. Dit kan een ongeldige zet of een lastig aanraakdoel zijn. Bekijk de laatste actie en voortgang voordat je de bediening aanpast.`);
  if (lost) signal(`${lost} ${lost === 1 ? 'speelblok eindigde' : 'speelblokken eindigden'} bij de foutenlimiet. Vergelijk Sudoku-niveaus en de 3-fouteninstelling om te zien waar extra uitleg of een mildere limiet kan helpen.`);
  if (stuck) signal(`${stuck} ${stuck === 1 ? 'speelblok eindigde' : 'speelblokken eindigden'} met de melding Geen zetten meer. Controleer of de opties Nieuw spel, Opnieuw en Terug duidelijk genoeg zijn.`);
  const afterHelp = actual.filter(r => !['won', 'midnight', 'playing'].includes(r.detail.reason) && ['hint', 'mistake', 'blocked'].includes(r.detail.lastAction) && r.last - r.detail.actionAt <= 30000).length;
  if (afterHelp) signal(`${afterHelp} ${afterHelp === 1 ? 'blok eindigde' : 'blokken eindigden'} binnen 30 seconden na een hint, foutmelding of mislukte zet. Dit is een samenloop, geen bewezen reden om te stoppen; open de speldetails om het te bekijken.`);
  if (actions.hint) signal(`${actions.hint} hints gebruikt in de gemeten blokken. Vergelijk hints per niveau en voortgang om te beoordelen waar de uitleg nuttiger kan.`);
  if (!measured.length) signal('Nieuwe spelinformatie verschijnt automatisch na het spelen met de bijgewerkte apps. Persoonlijke redenen zoals moe of geen tijd kunnen de apps niet vaststellen.');
  else signal('Menu, pauze, scherm uit en inactiviteit zijn waargenomen appgebeurtenissen. Ze bewijzen geen frustratie, verveling of andere persoonlijke reden. Open pogingen kunnen later nog worden voltooid; de tabel is geen definitief winstpercentage.');
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
    records = Object.entries(cache).map(([id, r]) => ({ ...r, _id: id })).filter(r => r && ['start', 'last', 'seconds', 'games', 'wins'].every(k => Number.isInteger(r[k])) && r.start >= 1577836800000 && r.last >= r.start && r.last - r.start <= 90000000 && r.seconds >= 0 && r.seconds <= 90000 && r.games >= 0 && r.games <= 1000 && r.wins >= 0 && r.wins <= 1000 && typeof r.active === 'boolean' && (r.detail === undefined || validDetail(r.detail, r)) && (r.app === undefined || r.app === 'sudoku') && (r.app !== 'sudoku' || Object.prototype.hasOwnProperty.call(levels, r.level) && typeof r.daily === 'boolean' && ['hints', 'mistakes'].every(k => Number.isInteger(r[k]) && r[k] >= 0 && r[k] <= 1000))).map(r => r.detail ? { ...r, detail: { ...r.detail, actions: r.detail.actions || {} } } : r);
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
