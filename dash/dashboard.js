/* Opa's speeloverzicht – how opa is doing with Patience and Sudoku. Reads the shared Firebase database. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const base = String((window.PATIENCE_TRACKING || {}).databaseUrl || '').replace(/\/$/, '');
const ZONE = 'Europe/Amsterdam';
const DAY = 86400000, LIVE_MS = 75000;

/* ================= formatting ================= */
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE });
const timeFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: ZONE, weekday: 'long', day: 'numeric', month: 'long' });
const shortDayFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: ZONE, weekday: 'short', day: 'numeric' });
const hourFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' });
const weekdayFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: ZONE, weekday: 'short' });
const dayKey = t => dayFmt.format(t);
const noon = d => Date.parse(`${d}T12:00:00Z`);
const minutes = s => {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s ? `${s} sec` : '0 min';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const m = Math.floor(s % 3600 / 60);
  return `${Math.floor(s / 3600)} u${m ? ' ' + m + ' min' : ''}`;
};
const when = t => {
  const d = dayKey(t), today = dayKey(Date.now()), yesterday = dayKey(Date.now() - DAY);
  return (d === today ? 'vandaag' : d === yesterday ? 'gisteren' : dateFmt.format(t)) + ' om ' + timeFmt.format(t);
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ================= record validation =================
   The database is writable by the apps without login, so every record is checked before it counts. */
const ENDINGS = { playing: 'Aan het spelen', won: 'Uitgespeeld', lost: '3 fouten gemaakt', stuck: 'Geen zetten meer', new_game: 'Nieuw spel gekozen', restart: 'Opnieuw begonnen', menu: 'Naar het menu', pause: 'Pauze', hidden: 'App weggelegd', closed: 'App gesloten', idle: '2 minuten niets gedaan', suspended: 'Onderbroken', midnight: 'Middernacht', recovered: 'Later hervat', unknown: 'Onbekend' };
const ACTIONS = { move: 'kaart verplaatst', draw: 'kaart getrokken', recycle: 'stapel omgedraaid', undo: 'ongedaan', hint: 'hint', blocked: 'zet lukte niet', auto_finish: 'automatisch uitgespeeld', input: 'getal ingevuld', mistake: 'fout getal', note: 'notitie', erase: 'gewist', second_chance: 'tweede kans' };
const BANDS = ['easy', 'medium', 'hard', 'expert', 'master', 'extreme'];
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const validKey = k => /^[a-f0-9]{32}$/.test(k || '');
function validCounts(map, allowed, max) {
  return map === undefined || (!!map && typeof map === 'object' && !Array.isArray(map) && Object.entries(map).every(([k, n]) => allowed(k) && isInt(n, 0, max)));
}
function validDetail(d, r) {
  if (!d || typeof d !== 'object' || ![1, 2].includes(d.v) || !validKey(d.round) || !has(ENDINGS, d.reason)) return false;
  if (!['progress', 'initial', 'total', 'maxGap', 'actionAt', 'lastProgressAt'].every(k => isInt(d[k], 0, Number.MAX_SAFE_INTEGER))) return false;
  if (d.total < 1 || d.total > 81 || d.progress > d.total || d.initial > d.total || d.maxGap > 120) return false;
  if (d.lastProgressAt < r.start || d.lastProgressAt > r.last || (d.actionAt !== 0 && (d.actionAt < r.start || d.actionAt > r.last))) return false;
  if (d.ended !== undefined && (!Number.isInteger(d.ended) || d.ended < r.last)) return false;
  if ((d.reason !== 'playing' && d.ended === undefined) || (d.lastAction !== 'none' && !has(ACTIONS, d.lastAction))) return false;
  if (!validCounts(d.actions, k => has(ACTIONS, k), 10000)) return false;
  if (d.v === 2) {
    if (!validCounts(d.stops, k => k !== 'playing' && has(ENDINGS, k), 10000)) return false;
    if (!validCounts(d.hours, k => /^h([01][0-9]|2[0-3])$/.test(k), 90000)) return false;
    if (Object.values(d.hours || {}).reduce((a, b) => a + b, 0) > r.seconds) return false;
  }
  return true;
}
// Sudoku got a new level list in build sudoku-15 and everyone started again at level 1; older levels are ignored.
const NEW_LEVELS_BUILD = 15;
function sudokuBuild(b) { const m = typeof b === 'string' && /^sudoku-(\d+)$/.exec(b); return m ? Number(m[1]) : 0; }
// "L37|38" = playing level 37, unlocked up to 38; "D|38" daily challenge; "O|38" old puzzle.
function parseLevel(mode) {
  const m = typeof mode === 'string' && /^(?:L(\d{1,5})|D|O)\|(\d{1,5})$/.exec(mode);
  if (!m) return null;
  const reached = Number(m[2]), played = m[1] ? Number(m[1]) : null;
  if (reached < 1 || reached > 100000 || (played !== null && (played < 1 || played > reached))) return null;
  return { played, reached, daily: mode[0] === 'D' };
}
function sanitize(raw, key, device) {
  const out = [];
  for (const [id, r] of Object.entries(raw || {})) {
    if (!r || typeof r !== 'object') continue;
    if (!['start', 'last', 'seconds', 'games', 'wins'].every(k => Number.isInteger(r[k]))) continue;
    if (r.start < 1577836800000 || r.last < r.start || r.last - r.start > 90000000) continue;
    if (!isInt(r.seconds, 0, 90000) || !isInt(r.games, 0, 1000) || !isInt(r.wins, 0, 1000) || typeof r.active !== 'boolean') continue;
    if (r.app !== undefined && r.app !== 'sudoku') continue;
    const app = r.app || 'patience';
    if (app === 'sudoku' && (!BANDS.includes(r.level) || typeof r.daily !== 'boolean' || !isInt(r.hints, 0, 1000) || !isInt(r.mistakes, 0, 1000))) continue;
    if (r.detail !== undefined && !validDetail(r.detail, r)) continue;
    const detail = r.detail ? { ...r.detail, actions: r.detail.actions || {} } : null;
    out.push({
      id, key, device, app, start: r.start, last: r.last, seconds: r.seconds, games: r.games, wins: r.wins, active: r.active,
      hints: app === 'sudoku' ? r.hints : (detail?.actions.hint || 0),
      mistakes: app === 'sudoku' ? r.mistakes : 0,
      daily: app === 'sudoku' && r.daily,
      level: app === 'sudoku' && sudokuBuild(detail?.build) >= NEW_LEVELS_BUILD ? parseLevel(detail?.mode) : null,
      cards: app === 'patience' && detail?.mode ? (detail.mode.endsWith('3') ? 3 : 1) : null,
      detail,
    });
  }
  return out;
}

/* ================= people: devices with the same name are one person =================
   On an iPhone every app on the home screen has its own storage, so Patience and Sudoku each get
   their own device code. Giving both the same name in the dashboard makes them one player. */
const norm = s => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '';
function people(players) {
  const groups = new Map();
  for (const [id, p] of Object.entries(players)) {
    if (!validKey(id) || !p || typeof p !== 'object') continue;
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 40) : '';
    const gid = name ? 'n:' + norm(name) : 'k:' + id;
    if (!groups.has(gid)) groups.set(gid, { gid, names: [], keys: [], devices: [] });
    const g = groups.get(gid);
    g.keys.push(id); if (name) g.names.push(name);
    g.devices.push({ id, name, device: ['iPhone', 'iPad', 'Android', 'Computer'].includes(p.device) ? p.device : 'Apparaat' });
  }
  for (const g of groups.values()) {
    // show the spelling most devices use, preferring a capital first letter ("Opa" over "OPa")
    const count = new Map(); g.names.forEach(n => count.set(n, (count.get(n) || 0) + 1));
    const score = n => count.get(n) * 10 + (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(n) ? 1 : 0);
    g.name = g.names.length ? [...count.keys()].sort((a, b) => score(b) - score(a) || a.localeCompare(b, 'nl'))[0] : '';
    g.label = g.name || `${g.devices[0].device} ${g.keys[0].slice(0, 4)}`;
    g.keys.sort();
  }
  return groups;
}

/* ================= calculations ================= */
const appFilter = (records, game) => game === 'all' ? records : records.filter(r => r.app === game);
function daysBack(n, now) {
  const today = dayKey(now);
  return Array.from({ length: n }, (_, i) => dayKey(noon(today) - (n - 1 - i) * DAY));
}
// active seconds per day and app; compact records (v2) belong to their start day, old ones are spread
function secondsByDay(records) {
  const map = new Map();
  const add = (d, app, s) => { if (!map.has(d)) map.set(d, { patience: 0, sudoku: 0 }); map.get(d)[app] += s; };
  for (const r of records) {
    if (r.detail?.v === 2 || r.last === r.start) { add(dayKey(r.start), r.app, r.seconds); continue; }
    const span = r.last - r.start;
    for (let t = r.start; t < r.last;) {
      const end = Math.min(r.last, (Math.floor(t / 60000) + 1) * 60000);
      add(dayKey(t), r.app, r.seconds * (end - t) / span); t = end;
    }
  }
  return map;
}
function summarize(all, game, periodDays, now) {
  const records = appFilter(all, game);
  const days = daysBack(periodDays, now), week = daysBack(7, now), weekStart = week[0], today = week[6];
  const perDay = secondsByDay(records);
  const sumDays = list => list.reduce((n, d) => n + ((perDay.get(d)?.patience || 0) + (perDay.get(d)?.sudoku || 0)), 0);
  const inWeek = r => dayKey(r.last) >= weekStart;
  const live = records.filter(r => r.active && now >= r.last && now - r.last < LIVE_MS).sort((a, b) => b.last - a.last)[0] || null;
  const latest = records.reduce((a, b) => !a || b.last > a.last ? b : a, null);
  // Sudoku level: the highest unlocked level any record reports
  const sud = all.filter(r => r.app === 'sudoku');
  const withLevel = sud.filter(r => r.level);
  const level = withLevel.length ? Math.max(...withLevel.map(r => r.level.reached)) : null;
  const before = withLevel.filter(r => dayKey(r.last) < weekStart);
  const levelWeekAgo = before.length ? Math.max(...before.map(r => r.level.reached)) : null;
  const firstThisWeek = withLevel.filter(inWeek).sort((a, b) => a.last - b.last)[0];
  const levelGain = level == null ? null : level - (levelWeekAgo ?? (firstThisWeek ? firstThisWeek.level.reached - firstThisWeek.wins : level));
  const levelByDay = new Map();
  for (const r of withLevel) { const d = dayKey(r.last); levelByDay.set(d, Math.max(levelByDay.get(d) || 0, r.level.reached)); }
  const game7 = app => {
    const list = all.filter(r => r.app === app && inWeek(r));
    return { seconds: week.reduce((n, d) => n + (perDayAll.get(d)?.[app] || 0), 0), wins: list.reduce((n, r) => n + r.wins, 0), games: list.reduce((n, r) => n + r.games, 0), hints: list.reduce((n, r) => n + r.hints, 0), mistakes: list.reduce((n, r) => n + r.mistakes, 0), lost: list.reduce((n, r) => n + (r.detail?.v === 2 ? r.detail.stops?.lost || 0 : r.detail?.reason === 'lost' ? 1 : 0), 0), any: all.some(r => r.app === app) };
  };
  const perDayAll = secondsByDay(all);
  // when does he play: measured hourly counters, otherwise spread over the session
  const cutoff = noon(days[0]) - DAY / 2;
  const heat = Object.fromEntries(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(d => [d, Array(24).fill(0)]));
  for (const r of records) {
    if (r.last < cutoff) continue;
    if (r.detail?.v === 2) {
      const wd = weekdayFmt.format(r.start).replace('.', '');
      for (const [h, s] of Object.entries(r.detail.hours || {})) if (heat[wd]) heat[wd][Number(h.slice(1))] += s;
      continue;
    }
    const span = Math.max(1, r.last - r.start);
    for (let t = Math.max(r.start, cutoff); t < r.last;) {
      const end = Math.min(r.last, (Math.floor(t / 3600000) + 1) * 3600000);
      const wd = weekdayFmt.format(t).replace('.', ''), h = Number(hourFmt.format(t)) % 24;
      if (heat[wd]) heat[wd][h] += r.seconds * (end - t) / span;
      t = end;
    }
  }
  return {
    days, week, perDay, live, latest,
    today: sumDays([today]), weekTotal: sumDays(week), periodTotal: sumDays(days),
    level, levelGain, levelByDay,
    sudoku: game7('sudoku'), patience: game7('patience'),
    heat, history: buildHistory(records, days[0]),
  };
}
// one entry per attempt (resumes share a round code), grouped per day, newest first
function buildHistory(records, fromDay) {
  const attempts = new Map();
  for (const r of records) {
    if (dayKey(r.last) < fromDay) continue;
    const id = r.app + ':' + dayKey(r.start) + ':' + (r.detail?.round || r.key + r.id);
    if (!attempts.has(id)) attempts.set(id, []);
    attempts.get(id).push(r);
  }
  const days = new Map();
  for (const list of attempts.values()) {
    list.sort((a, b) => a.start - b.start);
    const first = list[0], last = list.reduce((a, b) => b.last > a.last ? b : a);
    const actions = {}, stops = {};
    for (const r of list) {
      for (const [k, n] of Object.entries(r.detail?.actions || {})) actions[k] = (actions[k] || 0) + n;
      if (r.detail?.v === 2) for (const [k, n] of Object.entries(r.detail.stops || {})) { if (k !== 'midnight') stops[k] = (stops[k] || 0) + n; }
      else if (r.detail && !['playing', 'midnight'].includes(r.detail.reason)) stops[r.detail.reason] = (stops[r.detail.reason] || 0) + 1;
    }
    const a = {
      app: first.app, start: first.start, last: last.last, seconds: list.reduce((n, r) => n + r.seconds, 0),
      won: list.some(r => r.wins > 0), hints: list.reduce((n, r) => n + r.hints, 0), mistakes: list.reduce((n, r) => n + r.mistakes, 0),
      level: list.map(r => r.level).filter(Boolean).pop() || null, daily: first.daily, cards: first.cards,
      progress: last.detail ? Math.round(last.detail.progress / last.detail.total * 100) : null,
      reason: last.detail?.reason || null, active: last.active, last_r: last, actions, stops, measured: !!last.detail,
    };
    const d = dayKey(a.start);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(a);
  }
  return [...days].sort((a, b) => b[0].localeCompare(a[0])).map(([day, list]) => ({ day, list: list.sort((a, b) => b.start - a.start) }));
}
function signals(s, all, now) {
  const out = [];
  const week = all.filter(r => dayKey(r.last) >= s.week[0]);
  if (!week.length) { out.push({ tone: 'calm', text: 'Afgelopen week niet gespeeld.' }); return out; }
  if (s.sudoku.lost) out.push({ tone: 'warn', text: `${plural(s.sudoku.lost, 'keer', 'keer')} 3 fouten gemaakt bij Sudoku deze week. Met de tweede kans of de instelling "Maximaal 3 fouten" uit kan het rustiger.` });
  const hintShare = s.sudoku.wins ? s.sudoku.hints / s.sudoku.wins : 0;
  if (s.sudoku.hints >= 10 && hintShare >= 5) out.push({ tone: 'warn', text: `Veel hints bij Sudoku: gemiddeld ${Math.round(hintShare)} per opgeloste puzzel. De puzzels zijn misschien net te lastig.` });
  const stuck = week.reduce((n, r) => n + (r.detail?.v === 2 ? r.detail.stops?.stuck || 0 : r.detail?.reason === 'stuck' ? 1 : 0), 0);
  if (stuck) out.push({ tone: 'warn', text: `${plural(stuck, 'Patience-spel liep', 'Patience-spellen liepen')} vast (geen zetten meer).` });
  const blocked = week.reduce((n, r) => n + (r.detail?.actions.blocked || 0), 0);
  if (blocked >= 20) out.push({ tone: 'warn', text: `${blocked} keer lukte een kaartzet niet. Misschien zijn de kaarten lastig te raken.` });
  if (s.levelGain > 0) out.push({ tone: 'good', text: `${plural(s.levelGain, 'Sudoku-level', 'Sudoku-levels')} verder gekomen deze week.` });
  const wins = s.sudoku.wins + s.patience.wins;
  if (wins) out.push({ tone: 'good', text: `${plural(wins, 'spel', 'spellen')} uitgespeeld deze week.` });
  const playDays = s.week.filter(d => (s.perDay.get(d)?.patience || 0) + (s.perDay.get(d)?.sudoku || 0) > 0).length;
  out.push({ tone: 'calm', text: `Gespeeld op ${plural(playDays, 'dag', 'dagen')} van de afgelopen 7.` });
  return out;
}

/* ================= state ================= */
const S = {
  players: {}, groups: new Map(), gid: null, keys: [], streams: new Map(), caches: new Map(), connected: new Set(),
  game: 'all', period: 30, directory: null, loaded: false, dayState: new Map(), openAttempts: new Set(),
};
const params = new URLSearchParams(location.search || '');
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const recall = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
S.game = ['all', 'patience', 'sudoku'].includes(params.get('game')) ? params.get('game') : ['all', 'patience', 'sudoku'].includes(recall('opa.dashboard.game')) ? recall('opa.dashboard.game') : 'all';
S.period = [7, 30, 90].includes(Number(recall('opa.dashboard.period'))) ? Number(recall('opa.dashboard.period')) : 30;
let wanted = validKey(location.hash.slice(1)) ? location.hash.slice(1) : validKey(recall('patience.dashboard.player')) ? recall('patience.dashboard.player') : '';

function bookmark() {
  const q = new URLSearchParams(location.search || '');
  q.set('game', S.game);
  history.replaceState(null, '', location.pathname + '?' + q.toString() + (S.keys[0] ? '#' + (wanted && S.keys.includes(wanted) ? wanted : S.keys[0]) : ''));
}
function groupOf(key) { for (const g of S.groups.values()) if (g.keys.includes(key)) return g; return null; }
function select(gid) {
  const g = S.groups.get(gid); if (!g) return;
  const sameGroup = S.gid === gid;
  S.gid = gid;
  if (!g.keys.includes(wanted)) wanted = g.keys[0];
  remember('patience.dashboard.player', wanted);
  // keep streams for keys that stay, open new ones, close the rest
  for (const [k, s] of S.streams) if (!g.keys.includes(k)) { s.close(); S.streams.delete(k); S.caches.delete(k); S.connected.delete(k); }
  S.keys = g.keys.slice();
  if (!sameGroup) { S.dayState.clear(); S.openAttempts.clear(); }
  bookmark(); open(); render();
}
// before the player list arrives a bookmarked code still works on its own
function selectKey(key) {
  const g = groupOf(key);
  if (g) { wanted = key; select(g.gid); return; }
  S.gid = 'k:' + key; S.keys = [key]; wanted = key;
  S.groups.set(S.gid, { gid: S.gid, keys: [key], names: [], name: '', label: 'Apparaat ' + key.slice(0, 4), devices: [{ id: key, name: '', device: 'Apparaat' }] });
  bookmark(); open(); render();
}
function open() {
  if (document.hidden || !base) return;
  for (const key of S.keys) {
    if (S.streams.has(key)) continue;
    const q = new URLSearchParams({ orderBy: '"start"', startAt: String(Date.now() - 90 * DAY) });
    const src = new EventSource(`${base}/sessions/${key}.json?${q}`);
    S.streams.set(key, src);
    const handle = patch => ev => {
      if (S.streams.get(key) !== src) return;
      try { S.caches.set(key, apply(S.caches.get(key) || Object.create(null), ev, patch)); S.connected.add(key); $('notice').hidden = true; render(); }
      catch (_) { note('Een update kon niet worden gelezen.'); }
    };
    src.addEventListener('put', handle(false));
    src.addEventListener('patch', handle(true));
    src.onerror = () => { if (S.streams.get(key) !== src) return; S.connected.delete(key); render(); };
    const denied = () => { if (S.streams.get(key) !== src) return; src.close(); S.streams.delete(key); S.connected.delete(key); note('De database staat dit overzicht niet toe. Controleer de Firebase-regels.'); render(); };
    src.addEventListener('cancel', denied); src.addEventListener('auth_revoked', denied);
  }
}
function closeAll() { for (const s of S.streams.values()) s.close(); S.streams.clear(); S.connected.clear(); if (S.directory) S.directory.close(); S.directory = null; }
function note(text) { $('notice').textContent = text; $('notice').hidden = false; }
function put(target, path, data) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return Object.assign(Object.create(null), data || {});
  if (parts.length > 2 || parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) return target;
  const [id, field] = parts;
  if (!field) { if (data === null) delete target[id]; else target[id] = data; }
  else {
    if (!target[id] || typeof target[id] !== 'object') target[id] = Object.create(null);
    if (data === null) delete target[id][field]; else target[id][field] = data;
  }
  return target;
}
function apply(target, ev, patch) {
  const msg = JSON.parse(ev.data);
  if (patch) { for (const [f, v] of Object.entries(msg.data || {})) target = put(target, `${msg.path}/${f}`, v); return target; }
  return put(target, msg.path, msg.data);
}
function loadPlayers() {
  if (S.directory || document.hidden || !base) return;
  const src = S.directory = new EventSource(`${base}/players.json`);
  for (const kind of ['put', 'patch']) src.addEventListener(kind, ev => {
    if (S.directory !== src) return;
    try { S.players = apply(S.players, ev, kind === 'patch'); S.loaded = true; regroup(); }
    catch (_) { note('De spelerslijst kon niet worden gelezen.'); }
  });
  src.onerror = () => { if (S.directory === src) note('Spelerslijst even niet bereikbaar. We proberen het zo weer.'); };
  const denied = () => { if (S.directory !== src) return; src.close(); S.directory = null; note('De spelerslijst is niet toegankelijk. Controleer de Firebase-regels.'); };
  src.addEventListener('cancel', denied); src.addEventListener('auth_revoked', denied);
}
function regroup() {
  S.groups = people(S.players);
  const current = wanted && groupOf(wanted);
  if (current) select(current.gid);
  else if (wanted) selectKey(wanted);
  else {
    const list = [...S.groups.values()];
    const opa = list.find(g => /^opa$/i.test(g.name)) || list.find(g => g.name) || list[0];
    if (opa) select(opa.gid); else render();
  }
  fillPicker();
}

/* ================= rendering ================= */
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function fillPicker() {
  const pick = $('who');
  pick.replaceChildren();
  const list = [...S.groups.values()].filter(g => g.name || g.gid === S.gid || S.showAll);
  list.sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || a.label.localeCompare(b.label, 'nl'));
  for (const g of list) { const o = el('option', null, g.label + (g.keys.length > 1 ? ` (${g.keys.length} apparaten)` : '')); o.value = g.gid; pick.appendChild(o); }
  if (!list.length) { const o = el('option', null, S.loaded ? 'Nog geen spelers' : 'Spelers laden…'); pick.appendChild(o); }
  pick.value = S.gid || ''; pick.disabled = !list.length;
  const unnamed = [...S.groups.values()].filter(g => !g.name).length;
  $('moreDevices').hidden = !unnamed;
  $('moreDevices').textContent = S.showAll ? 'Alleen spelers met een naam' : `Apparaten zonder naam tonen (${unnamed})`;
}
function setSeg(id, value) { for (const b of $(id).children) b.setAttribute?.('aria-pressed', String(b.dataset?.v === String(value))); }
function render() {
  const now = Date.now();
  const g = S.groups.get(S.gid);
  setSeg('gameSeg', S.game); setSeg('periodSeg', S.period);
  if (!g) { $('who-name').textContent = S.loaded ? 'Nog geen spelers' : 'Laden…'; $('statusText').textContent = base ? 'Verbinden…' : 'Database niet ingesteld'; return; }
  const all = [];
  for (const key of S.keys) {
    const dev = g.devices.find(d => d.id === key);
    all.push(...sanitize(S.caches.get(key), key, dev ? dev.device : 'Apparaat'));
  }
  const s = summarize(all, S.game, S.period, now);
  const connected = S.keys.some(k => S.connected.has(k));
  $('who-name').textContent = g.label;
  document.title = `${g.label} · speeloverzicht`;
  // status line
  const live = connected ? s.live : null;
  $('status').classList.toggle('live', !!live);
  $('statusText').textContent = !connected ? 'Geen verbinding met de database' : live
    ? `Speelt nu ${live.app === 'sudoku' ? 'Sudoku' + (live.level?.played ? ' · level ' + live.level.played : live.daily ? ' · dagelijkse uitdaging' : '') : 'Patience'}`
    : s.latest ? `Laatst gespeeld ${when(s.latest.last)} (${s.latest.app === 'sudoku' ? 'Sudoku' : 'Patience'})` : 'Nog niet gespeeld';
  // hero figures
  $('figLevel').textContent = s.level ?? '–';
  $('figLevelSub').textContent = s.level == null ? (all.some(r => r.app === 'sudoku') ? 'zichtbaar na de volgende Sudoku-ronde' : 'nog geen Sudoku gespeeld') : s.levelGain > 0 ? `+${s.levelGain} deze week` : 'deze week gelijk gebleven';
  $('figLevelBox').hidden = S.game === 'patience';
  $('figToday').textContent = minutes(s.today);
  $('figWeek').textContent = minutes(s.weekTotal);
  $('figWeekSub').textContent = `${plural(s.sudoku.wins + s.patience.wins, 'spel', 'spellen')} uitgespeeld`;
  renderGames(s);
  renderWeek(s);
  renderLevel(s);
  renderHeat(s);
  renderSignals(signals(s, appFilter(all, S.game), now));
  renderHistory(s, now);
  renderDevices(g);
  $('periodLabel').textContent = `${S.period} dagen`;
}
function renderGames(s) {
  const tile = (id, app, info) => {
    const t = $(id); t.hidden = S.game !== 'all' && S.game !== app;
    $(id + 'Time').textContent = minutes(info.seconds);
    $(id + 'Wins').textContent = info.wins;
    $(id + 'Games').textContent = info.games;
    if (app === 'sudoku') { $(id + 'Hints').textContent = info.hints; $(id + 'Mistakes').textContent = info.mistakes; }
    $(id + 'Empty').hidden = info.any;
  };
  tile('tileSudoku', 'sudoku', s.sudoku);
  tile('tilePatience', 'patience', s.patience);
}
function renderWeek(s) {
  const days = s.week, W = chartWidth('weekChart'), H = 220, top = 26, bottom = 34, gap = W < 500 ? 8 : 18;
  const max = Math.max(1800, ...days.map(d => (s.perDay.get(d)?.patience || 0) + (s.perDay.get(d)?.sudoku || 0)));
  const bw = (W - gap * 8) / 7, scale = (H - top - bottom) / max;
  let svg = '';
  // a light guide every 30 minutes
  const narrow = W < 440;
  for (let m = 1800; m <= max; m += 1800) { const y = H - bottom - m * scale; svg += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" class="grid"/>`; }
  days.forEach((d, i) => {
    const x = gap + i * (bw + gap), p = s.perDay.get(d)?.patience || 0, q = s.perDay.get(d)?.sudoku || 0;
    const show = app => S.game === 'all' || S.game === app;
    let y = H - bottom;
    for (const [app, v] of [['patience', p], ['sudoku', q]]) {
      if (!show(app) || v <= 0) continue;
      const h = Math.max(3, v * scale); y -= h;
      svg += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" class="bar ${app}"/>`;
    }
    const total = (show('patience') ? p : 0) + (show('sudoku') ? q : 0);
    if (total > 0) svg += `<text x="${x + bw / 2}" y="${y - 7}" class="val">${total < 60 ? '<1' : Math.round(total / 60)}</text>`;
    const label = narrow ? weekdayFmt.format(noon(d)).replace('.', '') : shortDayFmt.format(noon(d)).replace('.', '');
    svg += `<text x="${x + bw / 2}" y="${H - 12}" class="axis mid${i === 6 ? ' today' : ''}">${i === 6 ? (narrow ? 'nu' : 'vandaag') : label}</text>`;
  });
  $('weekChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Speeltijd per dag, afgelopen 7 dagen">${svg}</svg>`;
  $('weekLegend').hidden = S.game !== 'all';
}
// draw charts at their real size so the text stays readable on a phone
const chartWidth = id => Math.max(300, Math.round($(id).clientWidth || 700));
function renderLevel(s) {
  const sec = $('levelSec'); sec.hidden = S.game === 'patience';
  if (S.game === 'patience') return;
  const days = s.days;
  const pts = [];
  let cur = null;
  const known = [...s.levelByDay].sort((a, b) => a[0].localeCompare(b[0]));
  const startKnown = known.filter(([d]) => d < days[0]).pop();
  if (startKnown) cur = startKnown[1];
  days.forEach((d, i) => { if (s.levelByDay.has(d)) cur = Math.max(cur || 0, s.levelByDay.get(d)); if (cur != null) pts.push([i, cur]); });
  $('levelEmpty').hidden = pts.length > 0;
  $('levelChart').hidden = !pts.length;
  if (!pts.length) return;
  const W = chartWidth('levelChart'), H = 200, L = 44, R = 16, T = 26, B = 30;
  const lo = Math.max(1, Math.min(...pts.map(p => p[1])) - 2), hi = Math.max(...pts.map(p => p[1])) + 2;
  const x = i => L + i * (W - L - R) / Math.max(1, days.length - 1), y = v => T + (hi - v) * (H - T - B) / Math.max(1, hi - lo);
  let path = '', prev = null;
  for (const [i, v] of pts) { path += prev == null ? `M${x(i)},${y(v)}` : `H${x(i)}V${y(v)}`; prev = v; }
  const last = pts[pts.length - 1];
  let svg = `<path d="${path}H${x(last[0])}V${H - B}H${x(pts[0][0])}Z" class="area"/><path d="${path}" class="line"/>`;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  for (const t of ticks) svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 8}" y="${y(t) + 4}" class="axis end">${t}</text>`;
  svg += `<circle cx="${x(last[0])}" cy="${y(last[1])}" r="7" class="dot"/><text x="${x(last[0]) - 12}" y="${y(last[1]) - 12}" class="val end">level ${last[1]}</text>`;
  const step = Math.ceil(days.length / 6);
  days.forEach((d, i) => { if ((days.length - 1 - i) % step === 0) svg += `<text x="${x(i)}" y="${H - 8}" class="axis mid">${shortDayFmt.format(noon(d)).replace('.', '')}</text>`; });
  $('levelChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sudoku-level per dag">${svg}</svg>`;
}
function renderHeat(s) {
  const rows = Object.entries(s.heat), max = Math.max(1, ...rows.flatMap(([, v]) => v));
  const box = $('heatmap'); box.replaceChildren();
  box.appendChild(el('span'));
  for (let h = 0; h < 24; h++) box.appendChild(el('span', 'hh', h % 3 === 0 ? String(h).padStart(2, '0') : ''));
  let best = null;
  for (const [day, vals] of rows) {
    box.appendChild(el('span', 'hd', day));
    vals.forEach((v, h) => {
      const c = el('span', 'hc h' + (v > 0 ? Math.min(4, 1 + Math.floor(v / max * 3.999)) : 0));
      c.title = `${day} ${String(h).padStart(2, '0')}:00 · ${minutes(v)}`;
      box.appendChild(c);
      if (!best || v > best.v) best = { v, day, h };
    });
  }
  const total = rows.reduce((n, [, v]) => n + v.reduce((a, b) => a + b, 0), 0);
  const hours = Array(24).fill(0); rows.forEach(([, v]) => v.forEach((n, h) => { hours[h] += n; }));
  const part = h => h < 6 ? "'s nachts" : h < 12 ? "'s ochtends" : h < 18 ? "'s middags" : "'s avonds";
  const parts = {}; hours.forEach((n, h) => { parts[part(h)] = (parts[part(h)] || 0) + n; });
  const topPart = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  $('whenText').textContent = total ? `Speelt het meest ${topPart[0]}, vooral rond ${String(hours.indexOf(Math.max(...hours))).padStart(2, '0')}:00.` : 'Nog geen speeltijd in deze periode.';
}
function renderSignals(list) {
  const box = $('signals'); box.replaceChildren();
  for (const s of list) { const li = el('li', s.tone); li.textContent = s.text; box.appendChild(li); }
}
function attemptTitle(a) {
  if (a.app === 'sudoku') return a.daily ? 'Sudoku · dagelijkse uitdaging' : a.level?.played ? `Sudoku · level ${a.level.played}` : 'Sudoku';
  return 'Patience' + (a.cards ? ` · ${a.cards} ${a.cards === 1 ? 'kaart' : 'kaarten'}` : '');
}
function renderHistory(s, now) {
  const box = $('history'); box.replaceChildren();
  if (!s.history.length) { box.appendChild(el('p', 'empty', 'Nog geen speelmomenten in deze periode.')); return; }
  for (const { day, list } of s.history) {
    const det = el('details', 'day');
    const dk = S.gid + ':' + day;
    // the newest day starts open; after that only what he clicks open or closed is remembered
    det.open = S.dayState.has(dk) ? S.dayState.get(dk) : day === s.history[0].day;
    const sum = el('summary');
    sum.addEventListener('click', () => S.dayState.set(dk, !det.open));
    const t = el('span', 'dname', day === dayKey(now) ? 'Vandaag' : day === dayKey(now - DAY) ? 'Gisteren' : dateFmt.format(noon(day)));
    const secs = list.reduce((n, a) => n + a.seconds, 0), won = list.filter(a => a.won).length;
    const stats = el('span', 'dstats', `${minutes(secs)} · ${plural(list.length, 'spel', 'spellen')}${won ? ` · ${won} uitgespeeld` : ''}`);
    sum.append(t, stats); det.appendChild(sum);
    for (const a of list) {
      const row = el('div', 'att ' + a.app);
      const head = el('div', 'att-head');
      head.append(el('span', 'att-time', timeFmt.format(a.start)), el('span', 'att-title', attemptTitle(a)), el('span', 'att-dur', minutes(a.seconds)));
      const chips = el('div', 'chips');
      const live = a.active && now >= a.last && now - a.last < LIVE_MS;
      chips.appendChild(el('span', 'chip ' + (live ? 'live' : a.won ? 'won' : 'open'), live ? 'nu bezig' : a.won ? 'uitgespeeld' : a.progress != null ? `${a.progress}% klaar` : 'niet uitgespeeld'));
      if (a.hints) chips.appendChild(el('span', 'chip', plural(a.hints, 'hint', 'hints')));
      if (a.mistakes) chips.appendChild(el('span', 'chip warn', plural(a.mistakes, 'fout', 'fouten')));
      if (a.app === 'sudoku' && a.level && !a.daily && a.won) chips.appendChild(el('span', 'chip gold', `naar level ${a.level.reached}`));
      row.append(head, chips);
      if (a.measured) {
        const more = el('details', 'more');
        const ak = S.gid + ':' + a.app + a.start;
        more.open = S.openAttempts.has(ak);
        const ms = el('summary', null, 'Meer');
        ms.addEventListener('click', () => { if (more.open) S.openAttempts.delete(ak); else S.openAttempts.add(ak); });
        more.appendChild(ms);
        const acts = Object.entries(a.actions).filter(([, n]) => n > 0).map(([k, n]) => `${ACTIONS[k]} ${n}×`).join(' · ');
        const stops = Object.entries(a.stops).map(([k, n]) => `${ENDINGS[k]} ${n}×`).join(' · ');
        more.appendChild(el('p', null, `Van ${timeFmt.format(a.start)} tot ${timeFmt.format(a.last)}. ${a.reason && !live ? 'Gestopt: ' + (ENDINGS[a.reason] || 'onbekend').toLowerCase() + '.' : ''}`));
        if (acts) more.appendChild(el('p', null, 'Wat hij deed: ' + acts + '.'));
        if (stops) more.appendChild(el('p', null, 'Onderbrekingen: ' + stops + '.'));
        row.appendChild(more);
      }
      det.appendChild(row);
    }
    box.appendChild(det);
  }
}
const DEVICE_ICONS = {
  iPhone: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  iPad: '<svg viewBox="0 0 24 24"><rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  Android: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  Computer: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>',
};
function renderDevices(g) {
  const box = $('devices'); box.replaceChildren();
  $('devicesTitle').textContent = g.name ? `Apparaten van ${g.name}` : 'Dit apparaat';
  for (const d of g.devices) {
    const recs = sanitize(S.caches.get(d.id), d.id, d.device);
    const apps = [...new Set(recs.map(r => r.app === 'sudoku' ? 'Sudoku' : 'Patience'))];
    const row = el('form', 'dev');
    const ic = el('span', 'dev-ic'); ic.innerHTML = DEVICE_ICONS[d.device] || DEVICE_ICONS.iPhone; row.append(ic);
    const txt = el('span', 'dev-txt');
    txt.append(el('b', null, `${d.device} · ${d.id.slice(0, 4)}`), el('small', null, apps.length ? apps.join(' en ') : 'nog niets gespeeld in 90 dagen'));
    const input = el('input'); input.value = d.name; input.maxLength = 40; input.placeholder = 'Naam'; input.setAttribute?.('aria-label', 'Naam voor dit apparaat');
    const btn = el('button', null, 'Bewaar'); btn.type = 'submit';
    const msg = el('small', 'dev-msg', '');
    row.append(txt, input, btn, msg);
    row.onsubmit = async e => { e.preventDefault(); await rename(d.id, input.value, msg, btn); };
    box.appendChild(row);
  }
}
async function rename(id, name, msg, btn) {
  name = String(name || '').trim();
  if (!validKey(id) || !name || name.length > 40) { msg.textContent = 'Vul een naam in.'; return; }
  btn.disabled = true; msg.textContent = 'Opslaan…';
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(`${base}/players/${id}.json`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), signal: ctl.signal });
    if (!res.ok) throw new Error('denied');
    S.players[id] = Object.assign(S.players[id] || {}, { name });
    msg.textContent = 'Opgeslagen.';
    wanted = id; regroup();
  } catch (_) { msg.textContent = 'Niet opgeslagen. Probeer het opnieuw.'; }
  finally { clearTimeout(t); btn.disabled = false; }
}

/* ================= controls ================= */
$('who').onchange = () => { const g = S.groups.get($('who').value); if (g) { wanted = g.keys[0]; select(g.gid); } };
$('moreDevices').onclick = () => { S.showAll = !S.showAll; fillPicker(); };
for (const [seg, set] of [['gameSeg', v => { S.game = v; remember('opa.dashboard.game', v); bookmark(); }], ['periodSeg', v => { S.period = Number(v); remember('opa.dashboard.period', v); }]]) {
  $(seg).addEventListener('click', e => { const b = e.target.closest ? e.target.closest('button') : e.target; if (!b || !b.dataset || !b.dataset.v) return; set(b.dataset.v); render(); });
}
addEventListener('hashchange', () => { const k = location.hash.slice(1); if (validKey(k) && !S.keys.includes(k)) { wanted = k; const g = groupOf(k); if (g) select(g.gid); else selectKey(k); fillPicker(); } });
let resizeT = 0;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 150); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { closeAll(); render(); }
  else { open(); loadPlayers(); }
});

/* ================= start ================= */
if (!base) { note('De database voor het speeloverzicht is nog niet ingesteld.'); render(); }
else {
  if (wanted) selectKey(wanted);
  loadPlayers();
  setInterval(render, 15000);
}
window.OpaDashboard = { sanitize, people, summarize, parseLevel, signals, state: S };
})();
