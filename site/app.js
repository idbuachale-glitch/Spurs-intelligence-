import { state, load, loadSeason, esc, fmt, fmtPlain, fmtDate, fmtTime, fmtDateTime, ago, statusText, resultChip, photoHtml, norm, sortableTable } from './lib.js';
import { lineChart, pairBars, shotMap, barList, xgRace, momentumChart, shotZonePitch, conceptPitch, radar } from './charts.js';
import { answer, renderAnswer, suggestions } from './analyst.js';
import { managerView, managerAfter } from './manager.js';
import { replayHtml, bindReplay } from './replay.js';
import { shareButtonHtml, bindShare, makeGraphic } from './share.js';

const NAV = [
  ['overview', 'Overview', 'i-home'], ['fixtures', 'Fixtures & results', 'i-cal'], ['players', 'Player Lab', 'i-user'], ['team', 'Team statistics', 'i-chart'],
  ['tactics', 'Tactical analysis', 'i-board'], ['video', 'Video Evidence Room', 'i-play'], ['squad', 'Squad planner', 'i-squad'], ['injuries', 'Injury tracker', 'i-medic'], ['briefing', 'Matchday briefing', 'i-doc'], ['replays', 'Goal replays', 'i-replay'], ['graphic', 'Match graphic', 'i-share'], ['table', 'League table', 'i-table'],
  ['breakdown', 'Match breakdown', 'i-spark'], ['simulator', 'Season forecast', 'i-dice'], ['manager', 'Matchday Simulator', 'i-whistle'], ['style', 'De Zerbi tracker', 'i-trend'], ['match', 'Match Centre', 'i-ball'], ['sources', 'Data sources & settings', 'i-gear'],
];
const BOTTOM = ['overview', 'breakdown', 'players', 'fixtures'];
const view = document.getElementById('view');
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

// ---------------- Boot ----------------
async function boot() {
  try {
    state.meta = await load('meta.json', { fresh: true });
    [state.status, state.seasons] = await Promise.all([load('status.json', { fresh: true }), load('seasons.json')]);
  } catch (e) {
    view.innerHTML = `<div class="banner error">The data files could not be loaded (${esc(e.message)}). The site shows data only after its first automatic update has run.</div>`;
    return;
  }
  let saved = null; try { saved = localStorage.getItem('si-season'); } catch { /* ignore */ }
  state.season = saved && state.seasons.seasons.includes(saved) ? saved : state.seasons.current;
  const sel = document.getElementById('season');
  sel.innerHTML = state.seasons.seasons.map((s) => `<option value="${s}">${s.replace('-', '/')}${s === state.seasons.current ? ' (current)' : ''}</option>`).join('');
  sel.value = state.season;
  sel.addEventListener('change', () => { state.season = sel.value; try { localStorage.setItem('si-season', sel.value); } catch { /* ignore */ } route(); });
  buildNav();
  setupSearch();
  document.getElementById('sidebar-foot').innerHTML = `Updated ${esc(ago(state.meta.generatedAt))}<br>${state.status.healthy === false ? '<span style="color:var(--loss)">Source problem — see Data sources</span>' : (state.status.warnings || []).length ? 'Some sources retrying' : 'All sources healthy'}`;
  window.addEventListener('hashchange', route);
  route();
  // Installed app: work offline, and refresh when reopened after a while.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt < 10 * 60e3) return;
    try { const m = await load('meta.json', { fresh: true }); if (m.generatedAt !== state.meta.generatedAt) { state.meta = m; state.cache.clear(); state.status = await load('status.json', { fresh: true }); route(); } } catch { /* offline: keep what is shown */ }
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installEvt = e; document.querySelectorAll('[data-install]').forEach((b) => (b.hidden = false)); });
}
// Refresh button: fetch the newest release and data (also clears the offline copy).
document.getElementById('refresh-btn')?.addEventListener('click', async (e) => {
  const b = e.currentTarget; b.classList.add('spin'); b.disabled = true;
  try {
    const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update().catch(() => {});
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  } catch { /* ignore */ }
  location.reload();
});
// "Add to home screen" help, shown until installed or dismissed.
function installBanner() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let dismissed = false; try { dismissed = localStorage.getItem('si-install-dismissed') === '1'; } catch { /* ignore */ }
  if (standalone || dismissed) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<div class="banner info install-banner" id="install-banner"><span>📲 <strong>Get the app:</strong> ${ios ? 'tap the <strong>Share</strong> button in Safari, then <strong>Add to Home Screen</strong>.' : 'install Spurs Intelligence on your home screen.'}</span>${ios ? '' : `<button class="btn" data-install ${window.__installEvt ? '' : 'hidden'}>Install</button>`}<button class="btn ghost" data-install-close aria-label="Dismiss">✕</button></div>`;
}
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-install]') && window.__installEvt) { window.__installEvt.prompt(); try { await window.__installEvt.userChoice; } catch { /* ignore */ } window.__installEvt = null; document.getElementById('install-banner')?.remove(); }
  if (e.target.closest('[data-install-close]')) { try { localStorage.setItem('si-install-dismissed', '1'); } catch { /* ignore */ } document.getElementById('install-banner')?.remove(); }
});

function buildNav() {
  document.getElementById('nav').innerHTML = NAV.map(([k, l, i]) => `<a href="#/${k}" data-k="${k}">${icon(i)}${l}</a>`).join('');
  document.getElementById('bottom-nav').innerHTML = BOTTOM.map((k) => { const n = NAV.find((x) => x[0] === k); return `<a href="#/${k}" data-k="${k}">${icon(n[2])}${{ breakdown: 'Breakdown', players: 'Players' }[k] || n[1].split(' ')[0]}</a>`; }).join('') + `<button id="more-btn" aria-expanded="false">${icon('i-more')}More</button>`;
  const sheet = document.getElementById('more-sheet');
  sheet.innerHTML = NAV.filter(([k]) => !BOTTOM.includes(k)).map(([k, l, i]) => `<a href="#/${k}" data-k="${k}">${icon(i)}${l}</a>`).join('');
  const btn = document.getElementById('more-btn');
  const back = document.createElement('div'); back.className = 'more-backdrop'; document.body.appendChild(back);
  const setOpen = (open) => { sheet.classList.toggle('open', open); back.classList.toggle('open', open); btn.setAttribute('aria-expanded', open); };
  btn.addEventListener('click', () => setOpen(!sheet.classList.contains('open')));
  sheet.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  back.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  window.addEventListener('hashchange', () => setOpen(false));
}

async function route() {
  const [, k = 'overview', ...args] = (location.hash || '#/overview').split('/');
  const top = { player: 'players', compare: 'players' }[k] || k;
  document.querySelectorAll('[data-k]').forEach((a) => (a.dataset.k === top ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  view.innerHTML = '<div class="skeleton"></div>';
  const fn = VIEWS[k] || VIEWS.overview;
  try {
    const html = await fn(...args.map(decodeURIComponent));
    view.innerHTML = banners() + html;
    view.querySelectorAll('table[data-sortable]').forEach(sortableTable);
    AFTER[k]?.(...args.map(decodeURIComponent));
    window.scrollTo(0, 0);
    view.querySelectorAll('.mp-strip').forEach((st) => { const c = st.querySelector('[aria-current]') || st.lastElementChild; if (c) st.scrollLeft = c.offsetLeft - st.clientWidth / 2 + c.clientWidth / 2; });
    document.title = `${(NAV.find((n) => n[0] === top) || [, 'Spurs Intelligence'])[1]} · Spurs Intelligence`;
  } catch (e) {
    console.error(e);
    view.innerHTML = banners() + `<div class="banner error">This page could not be built: ${esc(e.message)}. Other pages may still work, and the data refreshes automatically.</div>`;
  }
}

function banners() {
  const out = [];
  const age = (Date.now() - new Date(state.meta.generatedAt)) / 3600e3;
  if (age > 3) out.push(`<div class="banner warn">The data was last refreshed ${esc(ago(state.meta.generatedAt))}. Automatic updates may be delayed; the figures shown are the last valid set.</div>`);
  for (const w of state.status.warnings || []) if (w.level === 'error') out.push(`<div class="banner error">${esc(w.text)}</div>`);
  if (state.season !== state.seasons.current) out.push(`<div class="banner info">Viewing the archived ${state.season.replace('-', '/')} season. <a href="#" id="to-current">Switch to ${state.seasons.current.replace('-', '/')}</a></div>`);
  return out.join('');
}
document.addEventListener('click', (e) => {
  if (e.target.id === 'to-current') { e.preventDefault(); const s = document.getElementById('season'); s.value = state.seasons.current; s.dispatchEvent(new Event('change')); }
});

// ---------------- Search with live autocomplete ----------------
async function setupSearch() {
  const input = document.getElementById('search'); const list = document.getElementById('suggest');
  let items = []; let active = -1;
  const index = async () => (state.index ||= (await load('players-index.json')).players);
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const highlight = (text, q) => { const i = norm(text).indexOf(q); return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`; };
  const render = async () => {
    const q = norm(input.value.trim());
    if (!q) return close();
    const idx = await index();
    items = idx.map((p) => {
      const names = [p.name, p.web, ...p.aliases];
      let score = 0;
      for (const n of names) {
        const nn = norm(n);
        if (nn === q) score = Math.max(score, 100);
        else if (nn.startsWith(q)) score = Math.max(score, 80);
        else if (nn.split(/[\s-]/).some((w) => w.startsWith(q))) score = Math.max(score, 60);
        else if (nn.includes(q)) score = Math.max(score, 30);
      }
      return { p, score: score + (p.current ? 5 : 0) + Math.min(4, p.seasons.length) };
    }).filter((x) => x.score > 30 || (q.length >= 3 && x.score > 0)).sort((a, b) => b.score - a.score).slice(0, 8);
    if (!items.length) { list.innerHTML = '<li aria-disabled="true" class="muted">No matching Spurs player in the stored seasons</li>'; list.hidden = false; return; }
    list.innerHTML = items.map(({ p }, i) => `<li role="option" id="opt-${i}" data-id="${esc(p.id)}" aria-selected="${i === active}">${photoHtml(p, 'sm')}<span>${highlight(p.name, q)}${norm(p.name).includes(q) ? '' : ` <span class="faint">(${esc(p.web)})</span>`}</span><span class="meta">${p.current ? 'Current squad' : p.membershipLabel ? esc(p.membershipLabel) : `Former · ${esc(p.seasons.map((s) => s.season.replace('-', '/')).slice(0, 3).join(', '))}`} · ${esc(p.pos)}</span></li>`).join('');
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  const choose = (id) => { const p = state.index.find((x) => x.id === id); close(); input.value = ''; input.blur(); if (p) location.hash = `#/player/${p.id}`; };
  input.addEventListener('input', () => { active = -1; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      list.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', i === active));
      input.setAttribute('aria-activedescendant', `opt-${active}`);
    } else if (e.key === 'Enter') { e.preventDefault(); const it = items[active >= 0 ? active : 0]; if (it) choose(it.p.id); } else if (e.key === 'Escape') close();
  });
  list.addEventListener('pointerdown', (e) => { const li = e.target.closest('li[data-id]'); if (li) { e.preventDefault(); choose(li.dataset.id); } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) close(); });
}

// ---------------- Shared bits ----------------
// Club crests from the Premier League image server (FPL team codes; Spurs = 6).
// Opponents outside the Premier League have no code and show no crest.
const crestUrl = (code) => `https://resources.premierleague.com/premierleague/badges/70/t${code}.png`;
const crestImg = (code, cls = '') => (code ? `<img class="tcrest ${cls}" src="${crestUrl(code)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '');
const normTeam = (n) => String(n || '').toLowerCase().replace(/\b(fc|afc|cf|sc|ac)\b/g, '').replace(/[^a-z0-9]/g, '');
let teamIndex = null;
const teamIdByName = (name) => {
  if (!teamIndex) { teamIndex = new Map(); for (const src of [state.meta.teamNames || {}, state.meta.teamShort || {}]) for (const [id, n] of Object.entries(src)) teamIndex.set(normTeam(n), Number(id)); }
  return teamIndex.get(normTeam(name)) ?? null;
};
// Crest for any club: by FPL team id, else by name (Premier League clubs, Spurs, or a cup/European opponent's badge).
const crestOf = (name, teamId = null, cls = '') => {
  if (teamId && state.meta.teamCodes?.[teamId]) return crestImg(state.meta.teamCodes[teamId], cls);
  if (/^(spurs|tottenham( hotspur)?|tot)$/i.test(String(name || '').trim())) return crestImg(6, cls);
  const id = name ? teamIdByName(name) : null;
  if (id && state.meta.teamCodes?.[id]) return crestImg(state.meta.teamCodes[id], cls);
  const url = name ? state.meta.extraBadges?.[name] || Object.entries(state.meta.extraBadges || {}).find(([k]) => normTeam(k) === normTeam(name))?.[1] : null;
  return url ? `<img class="tcrest ${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '';
};
const crest = (teamId, cls = '', name = null) => crestOf(name, teamId, cls);
const oc = (f, cls = '') => crestOf(f.opponent, f.opponentTeamId, cls); // a fixture's opponent
const spursCrest = (cls = '') => crestImg(6, cls);
const fixtureRow = (f) => `<a class="fx" href="#/match/${encodeURIComponent(f.id)}">
  <div class="when">${esc(fmtDate(f.kickoff))}<br><span class="faint">${esc(fmtTime(f.kickoff))} Bahrain</span></div>
  <div><div class="who">${oc(f)}${f.home ? '' : '@ '}${esc(f.opponent)}${f.home ? ' (H)' : ''}</div><div class="comp">${esc(f.competition)}${f.gameweek ? ` · GW${f.gameweek}` : ''}${f.status !== 'FT' && f.status !== 'SCHEDULED' ? ` · ${esc(statusText[f.status] || f.status)}` : ''}${f.kickoffHistory?.length ? ' · rescheduled' : ''}${f.hasPreview ? ' · <span style="color:var(--cyan)">scouting report</span>' : ''}</div></div>
  <div class="scorebox">${!f.score && f.live?.score ? `${f.live.score.spurs}–${f.live.score.opp} <span class="live-pill">${f.live.minute ? `${f.live.minute}′` : 'LIVE'}</span>` : ''}${!f.score && !f.live?.score && f.difficulty ? `<span class="diff ${f.difficulty.level}" title="${{ easy: 'Easier game', medium: 'Tougher game', hard: 'Hard game' }[f.difficulty.level]}: Spurs win ${f.difficulty.win}% · draw ${f.difficulty.draw}% · lose ${f.difficulty.loss}%" aria-label="${{ easy: 'Easier', medium: 'Tougher', hard: 'Hard' }[f.difficulty.level]} game, Spurs win chance ${f.difficulty.win}%"></span><span class="diff-pct">${f.difficulty.win}%</span>` : ''}${f.score ? `${f.score.spurs}–${f.score.opp} ${resultChip(f.result, true)}` : `<span class="small muted" style="font-family:var(--body);font-weight:400">${f.status === 'POSTPONED' ? 'TBC' : ''}</span>`}</div></a>`;
// Key for the difficulty dots on upcoming fixtures.
const diffKey = (list) => (list.some((f) => f.difficulty && !f.score) ? `<p class="small muted diff-key"><span class="diff easy"></span>Easier <span class="diff medium"></span>Tougher <span class="diff hard"></span>Hard · % = Spurs' chance of winning. From the site's match model (expected points from xG ratings): a rough guide, not betting odds. Cup ties against non-Premier League clubs are not rated.</p>` : '');

const src = (text, at) => `<p class="source">Source: ${esc(text)}${at ? `. Retrieved ${esc(fmtDateTime(at))} (Bahrain)` : ''}.</p>`;
const per = (v, dp = 2) => fmt(v, dp);
const statDefs = () => state.meta.statDefs;

// ---------------- Overview ----------------
// Per-match descriptions for interactive charts (team match rows from team.json).
// Opponent crest for chart badges (Premier League image server); cup opponents show initials.
const badgeOf = (m) => {
  const tid = m.opponentTeamId || teamIdByName(m.opponent); const code = tid ? state.meta.teamCodes?.[tid] : null;
  const name = m.opponentShort || state.meta.teamShort?.[m.opponentTeamId] || (m.opponent || '').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('');
  return { url: code ? `https://resources.premierleague.com/premierleague/badges/70/t${code}.png` : (state.meta.extraBadges?.[m.opponent] || null), short: name };
};
const matchPoints = (ms) => ms.map((m) => ({
  title: `${m.home ? 'v' : '@'} ${m.opponent}`,
  sub: `${fmtDate(m.kickoff, { weekday: 'short', day: 'numeric', month: 'short' })} · Premier League`,
  result: m.result, score: m.gf !== null && m.gf !== undefined ? `${m.gf}–${m.ga}` : '',
  crest: badgeOf(m).url,
  links: [['Match breakdown', `#/breakdown/${encodeURIComponent(m.matchId)}`], ['Match Centre', `#/match/${encodeURIComponent(m.matchId)}`]],
}));
// Match picker: a swipeable row of opponent badges (oldest left, newest right). Tap to open.
function matchPicker(list, curId, route) {
  const chron = [...list].sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  return `<nav class="mp-strip" aria-label="Choose a match">${chron.map((f) => {
    const b = badgeOf(f); const sc = f.score ? `${f.score.spurs}–${f.score.opp}` : '';
    const cup = f.friendly ? 'Friendly' : f.competition !== 'Premier League' ? (f.competition || '').replace(/ Cup$/, ' Cup').replace('Champions League', 'UCL').replace('Europa League', 'UEL') : '';
    return `<a class="mp-chip" href="#/${route}/${encodeURIComponent(f.id)}" ${f.id === curId ? 'aria-current="true"' : ''} title="${esc(`${f.home ? 'v' : '@'} ${f.opponent}`)}">
      <span class="mp-badge">${b.url ? `<img src="${esc(b.url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<i>${esc(b.short)}</i></span>
      <em class="${f.result === 'W' ? 'w' : f.result === 'L' ? 'l' : 'd'}">${esc(sc)}</em>
      <small>${f.home ? 'H' : 'A'} · ${esc(fmtDate(f.kickoff, { day: 'numeric', month: 'short' }))}</small>${cup ? `<b>${esc(cup)}</b>` : ''}</a>`;
  }).join('')}</nav>`;
}
const VIEWS = {};
const AFTER = {};

VIEWS.overview = async () => {
  const s = state.season;
  const [fx, table, team, players, analysis] = await Promise.all([loadSeason('fixtures.json'), loadSeason('table.json'), loadSeason('team.json'), loadSeason('players.json'), loadSeason('analysis.json', s, { optional: true })]);
  const all = fx.fixtures.filter((f) => !f.friendly);
  const next = all.find((f) => f.status === 'SCHEDULED' || f.status === 'LIVE');
  const last = [...all].reverse().find((f) => f.result);
  const me = table.spurs;
  const o = team.overall;
  const top = (key) => players.players.filter((p) => (p.current || state.season !== state.seasons.current) && p.season.totals[key] !== null).sort((a, b) => (b.season.totals[key] || 0) - (a.season.totals[key] || 0)).slice(0, 5);
  const hero = next ? `<section class="hero" aria-label="Next match">
      <div class="kicker">${next.status === 'LIVE' ? 'Live now' : 'Next match'} · ${esc(next.competition)}${next.gameweek ? `, gameweek ${next.gameweek}` : ''}</div>
      <div class="fixture-board"><div class="team">${next.home ? spursCrest('big') : oc(next, 'big')}${next.home ? 'Spurs' : esc(next.opponent)}</div>
        <div class="mid"><div class="clock">${next.status === 'LIVE' && next.score ? `${next.home ? next.score.spurs : next.score.opp}–${next.home ? next.score.opp : next.score.spurs}` : esc(fmtTime(next.kickoff))}</div><div class="vs">${esc(fmtDate(next.kickoff, { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div>
        <div class="team right">${next.home ? oc(next, 'big') : spursCrest('big')}${next.home ? esc(next.opponent) : 'Spurs'}</div></div>
      <div class="countdown" id="countdown" data-k="${esc(next.kickoff || '')}"></div>
      <div class="hero-meta">${next.hasPreview ? `<a href="#/match/${encodeURIComponent(next.id)}" style="color:#3ce8ff;font-weight:600">${oc(next)}Scout ${esc(next.opponent)}</a>` : ''}<span>Kick-off <strong>${esc(fmtTime(next.kickoff))}</strong> Bahrain time</span><span>${next.home ? 'Tottenham Hotspur Stadium' : 'Away'}</span>${me ? `<span>Spurs are <strong>${ordinal(me.position)}</strong> on ${me.points} pts</span>` : ''}</div>
    </section>` : `<section class="hero"><div class="kicker">No upcoming fixture is listed yet for ${esc(s.replace('-', '/'))}.</div></section>`;
  const outNow = players.players.filter((p) => p.current && ['i', 's'].includes(p.status));
  const soonest = outNow.map((p) => ({ p, a: parseAbsence(p) })).filter((x) => x.a.back).sort((a, b) => a.a.back - b.a.back)[0];
  const teamNews = state.season === state.seasons.current && outNow.length ? `<a class="panel section team-news" href="#/injuries"><span>🩹 <strong>${outNow.length} out</strong>${players.players.some((p) => p.current && p.status === 'd') ? ` · ${players.players.filter((p) => p.current && p.status === 'd').length} doubtful` : ''}${soonest ? ` · next back: <strong>${esc(soonest.p.web)}</strong> ${esc(fmtDate(soonest.a.back.toISOString(), { day: 'numeric', month: 'short' }))}` : ''}</span><span class="muted small">Injury tracker →</span></a>` : '';
  return installBanner() + `${hero}${teamNews}
  <div class="grid four section">
    <div class="panel stat-tile"><span class="lbl">Latest result</span>${last ? `<a href="#/match/${encodeURIComponent(last.id)}" class="big" style="color:var(--text)">${last.score.spurs}–${last.score.opp} ${resultChip(last.result, true)}</a><span class="small muted">${oc(last)}${last.home ? 'v' : '@'} ${esc(last.opponent)}, ${esc(fmtDate(last.kickoff))}</span>` : '<span class="na">No result yet</span>'}</div>
    <div class="panel stat-tile"><span class="lbl">League position</span>${me ? `<span class="big">${ordinal(me.position)}</span><span class="small muted">${me.played} played · ${me.points} pts · GD ${me.gd > 0 ? '+' : ''}${me.gd}</span>` : '<span class="na">—</span>'}</div>
    <div class="panel stat-tile"><span class="lbl">Premier League record</span><span class="big">${o.w}-${o.d}-${o.l}</span><span class="small muted">${o.gf} scored, ${o.ga} conceded</span></div>
    <div class="panel stat-tile"><span class="lbl">xG for / against</span><span class="big">${fmtPlain(o.xg, 1)} / ${fmtPlain(o.xga, 1)}</span><span class="small muted">${o.xgMatches} matches with xG</span></div>
  </div>
  ${team.leagueRanks?.metrics?.possession ? `<section class="section"><div class="section-head"><h2>Against the league</h2><a class="small" href="#/team">All rankings</a></div>${rankTiles(team.leagueRanks, ['possession', 'fieldTilt', 'xg', 'xga'])}</section>` : ''}
  <div class="grid two section">
    <div class="panel"><h2>Recent form</h2><div class="form-strip">${team.formAllComps.map((f) => `<a href="#/match/${encodeURIComponent(f.matchId)}" title="${esc(f.opponent)} (${esc(f.competition)})" class="form-cr">${oc(f)}${resultChip(f.result)}</a>`).join('') || '<span class="na">No matches yet</span>'}</div>
      <p class="small muted" style="margin-top:10px">Last ${team.formAllComps.length} competitive matches, oldest first. Last five PL: ${team.last5.w}W ${team.last5.d}D ${team.last5.l}L.</p>
      <h3 style="margin-top:18px">Chance quality, match by match</h3>
      ${lineChart({ labels: team.matches.map((m) => m.opponentShort || m.opponent.slice(0, 3)), series: [{ name: 'xG for', color: 'var(--cyan)', values: team.matches.map((m) => m.xg) }, { name: 'xG against', color: 'var(--loss)', values: team.matches.map((m) => m.xga) }], height: 200, format: (v) => v.toFixed(2), points: matchPoints(team.matches), title: 'Chance quality, match by match', badges: team.matches.map(badgeOf) })}
    </div>
    <div class="panel"><h2>Leading performers</h2>
      <h3 class="muted small" style="font-family:var(--body);font-weight:500">Goals + assists (PL)${state.season === state.seasons.current ? ', current squad' : ''}</h3>
      ${barList(players.players.filter((p) => p.current || state.season !== state.seasons.current).map((p) => ({ label: p.web, value: (p.season.totals.goals || 0) + (p.season.totals.assists || 0), href: `#/player/${p.id}` })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 5)) || '<p class="na">No goal involvements yet.</p>'}
      <h3 class="muted small" style="font-family:var(--body);font-weight:500;margin-top:14px">Expected goal involvement (xG + xA)</h3>
      ${barList(top('xgi').map((p) => ({ label: p.web, value: p.season.totals.xgi, href: `#/player/${p.id}` })), { format: (v) => fmtPlain(v, 2) })}
      ${src(players.source, players.generatedAt)}
    </div>
  </div>
  ${analysis && analysis.insights.length ? `<section class="section panel"><div class="section-head"><h2>What the numbers say</h2><span class="label-analysis">Calculated analysis</span></div>
    ${analysis.insights.slice(0, 3).map(insightHtml).join('')}<a href="#/tactics">All findings and the De Zerbi analysis</a></section>` : ''}`;
};
AFTER.overview = () => {
  const el = document.getElementById('countdown');
  if (!el || !el.dataset.k) return;
  const tick = () => {
    const ms = new Date(el.dataset.k) - Date.now();
    if (ms <= 0) { el.textContent = ''; return; }
    const d = Math.floor(ms / 864e5); const h = Math.floor((ms % 864e5) / 36e5); const m = Math.floor((ms % 36e5) / 6e4);
    el.innerHTML = `<span>${d} d</span><span>${h} h</span><span>${m} min</span>`;
  };
  tick(); clearInterval(window.__cd); window.__cd = setInterval(tick, 30000);
};
const RADAR_LABELS = { xg: 'xG', xa: 'xA', goals: 'Goals', assists: 'Assists', threat: 'Threat', creativity: 'Creativity', tackles: 'Tackles', cbi: 'Clear/Block/Int', recoveries: 'Recoveries', defcon: 'Def. contribution', xgc: 'Low xG conceded', saves: 'Saves', gc: 'Low goals conceded' };
const RADAR_NAMES = { xg: 'expected goals', xa: 'expected assists', goals: 'goals', assists: 'assists', threat: 'attacking threat', creativity: 'creativity (chance and build-up involvement)', tackles: 'tackling', cbi: 'clearances, blocks and interceptions', recoveries: 'winning the ball back', defcon: 'overall defensive work', xgc: 'limiting chances against while on the pitch', saves: 'shot-stopping volume', gc: 'keeping goals out while on the pitch' };
const radarKeysOf = (pct) => (pct.radarKeys || Object.keys(pct.percentiles)).filter((k) => k in pct.percentiles);
// Plain-English read of the radar: where he shines and where he is weaker than his peers.
function radarComment(pct, p) {
  const items = radarKeysOf(pct).map((k) => ({ k, v: radarValue(k, pct.percentiles[k]) })).filter((x) => x.v !== null);
  if (items.length < 3) return '';
  const nth = (v) => ordinal(Math.max(1, Math.round(v)));
  const list = (a) => a.map((x) => `${RADAR_NAMES[x.k] || x.k} (${nth(x.v)} percentile)`).join(a.length === 2 ? ' and ' : ', ');
  const strong = items.filter((x) => x.v >= 60).sort((a, b) => b.v - a.v).slice(0, 3);
  const weak = items.filter((x) => x.v <= 40).sort((a, b) => a.v - b.v).slice(0, 3);
  const pw = state.meta.posLabels[pct.pos].toLowerCase();
  const parts = [];
  parts.push(strong.length ? `<strong>Shining:</strong> ${esc(list(strong))}.` : `<strong>Shining:</strong> nothing clearly above the average ${esc(pw)} yet; his best area is ${esc(list([items.slice().sort((a, b) => b.v - a.v)[0]]))}.`);
  parts.push(weak.length ? `<strong>Weaker:</strong> ${esc(list(weak))}.` : `<strong>Weaker:</strong> no area clearly below the average ${esc(pw)}; his lowest is ${esc(list([items.slice().sort((a, b) => a.v - b.v)[0]]))}.`);
  return `<div class="radar-note small" style="margin:10px 4px 6px;line-height:1.5">${parts.map((x) => `<p style="margin:4px 0">${x}</p>`).join('')}<p class="tiny faint" style="margin:4px 0">Compared with ${pct.peers} Premier League ${esc(pw)}s with ${pct.minMinutes}+ minutes, per 90 (FPL/Opta). Calculated, not official.</p></div>`;
}
const radarValue = (k, v) => (v === null || v === undefined ? null : ['xgc', 'gc'].includes(k) ? 100 - v : v);

function rankTiles(ranks, keys) {
  if (!ranks || !ranks.metrics) return '';
  const tiles = keys.map((k) => ranks.metrics[k] && [k, ranks.metrics[k]]).filter(Boolean);
  if (!tiles.length) return '';
  return `<div class="rank-grid">${tiles.map(([, m]) => {
    const cls = m.rank <= 5 ? 'good' : m.rank >= 16 ? 'bad' : '';
    const fill = ((m.of - m.rank) / (m.of - 1)) * 100;
    return `<div class="rank-tile ${cls}"><div class="val">${fmtPlain(m.value, m.unit === '%' ? 1 : 2)}${m.unit}</div><div class="lbl">${esc(m.label)}</div>
      <div class="ctx"><span class="rk">${ordinal(m.rank)} of ${m.of}</span> · league average ${fmtPlain(m.leagueAvg, m.unit === '%' ? 1 : 2)}${m.unit}${m.rank === 1 ? '' : ` · best: ${crestOf(m.leader.team)}${esc(m.leader.team)} ${fmtPlain(m.leader.value, m.unit === '%' ? 1 : 2)}${m.unit}`}</div>
      <div class="meter" style="width:${fill.toFixed(0)}%"></div></div>`;
  }).join('')}</div>`;
}
const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const insightHtml = (i) => `<div class="insight"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p>${i.interpretation ? `<p class="interp">Interpretation: ${esc(i.interpretation)}</p>` : ''}<p class="tiny faint">${esc(i.category)} · Sample: ${esc(i.sample)}${i.note ? ` · ${esc(i.note)}` : ''} · ${i.type === 'observed' ? 'Observed data' : 'Calculated'}</p></div>`;

// ---------------- Fixtures ----------------
VIEWS.fixtures = async () => {
  const fx = await loadSeason('fixtures.json');
  const comps = [...new Set(fx.fixtures.map((f) => f.competition))];
  return `<div class="section-head"><h1>Fixtures & results</h1><span class="muted small">All times Bahrain (UTC+3)</span></div>
  <div class="filters"><div class="tabs" role="group" aria-label="Show">${['Upcoming', 'Results', 'All'].map((t, i) => `<button data-tab="${t}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>
    <select class="ctl" id="comp" aria-label="Competition"><option value="">All competitive</option>${comps.map((c) => `<option>${esc(c)}</option>`).join('')}<option value="__all">Including friendlies</option></select></div>
  <div class="panel" style="padding:0" id="fx-list"></div>
  <p class="source">Premier League: Fantasy Premier League API (retrieved ${esc(fmtDateTime(state.meta.dataUpdatedAt.fixtures))}). Other competitions: FPL Core Insights community dataset and TheSportsDB. Postponed matches show "TBC" until a new date is published; changed kick-off times are marked "rescheduled".</p>`;
};
AFTER.fixtures = async () => {
  const fx = await loadSeason('fixtures.json');
  let tab = 'Upcoming';
  const draw = () => {
    const comp = document.getElementById('comp').value;
    let list = fx.fixtures.filter((f) => (comp === '__all' ? true : comp ? f.competition === comp : !f.friendly));
    if (tab === 'Upcoming') list = list.filter((f) => ['SCHEDULED', 'LIVE', 'POSTPONED'].includes(f.status));
    if (tab === 'Results') list = list.filter((f) => f.result).reverse();
    document.getElementById('fx-list').innerHTML = (list.map(fixtureRow).join('') + diffKey(list)) || '<div class="empty">No matches in this view.</div>';
  };
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); }));
  document.getElementById('comp').addEventListener('change', draw);
  draw();
};

// ---------------- Player Lab ----------------
// Stats are split into groups so each table fits a phone screen without sideways swiping.
// A column is [key, label, decimals] or [key, label, decimals, 'rate'] for a success %.
// Misplaced passes (attempts − accurate, over the same matches) + times dispossessed.
const possLost = (st) => { const r = st.rates?.passPct; const d = st.totals?.dispossessed; return r && d !== null && d !== undefined ? r.den - r.num + d : null; };
const LAB_GROUPS = {
  Attacking: [['goals', 'Goals', 0], ['assists', 'Assists', 0], ['xg', 'xG', 2], ['xa', 'xA', 2], ['shots', 'Shots', 0], ['chancesCreated', 'Chances', 0]],
  Dribbling: [['dribbles', 'Take-ons won', 0], ['takeOnPct', 'Take-on %', 1, 'rate'], ['touchesBox', 'Box touches', 0], ['wasFouled', 'Fouled', 0], ['dispossessed', 'Dispossessed', 0], ['dribbledPast', 'Dribbled past', 0]],
  Passing: [['passesAcc', 'Acc. passes', 0], ['passPct', 'Pass %', 1, 'rate'], ['finalThirdPasses', 'Final third', 0], ['crossesAcc', 'Crosses', 0], ['longBallsAcc', 'Long balls', 0], ['touches', 'Touches', 0]],
  Progression: [['finalThirdPasses', 'Final third', 0], ['chancesCreated', 'Chances', 0], ['touchesBox', 'Box touches', 0], ['longBallsAcc', 'Long balls', 0], ['crossesAcc', 'Crosses', 0], ['possLost', 'Poss. lost (est.)', 0, 'possLost']],
  Pressing: [['hiDist', 'Hi-int. m', 0], ['sprints', 'Sprints', 0], ['ballWins', 'Ball wins', 0], ['groundDuelPct', 'Ground duel %', 1, 'rate'], ['fcRecoveries', 'Recov.', 0], ['distance', 'Distance m', 0]],
  Defending: [['tacklesWon', 'Tackles', 0], ['defcon', 'DefCon /game', 1, 'perGame'], ['foulsCommitted', 'Fouls', 0], ['interceptions', 'Int.', 0], ['recoveries', 'Recov.', 0], ['cbi', 'CBI', 0], ['duelsWon', 'Duels', 0]],
  Fouls: [['foulsCommitted', 'Fouls', 0], ['wasFouled', 'Fouled', 0], ['yc', 'Yellow', 0], ['rc', 'Red', 0], ['offsides', 'Offsides', 0]],
  Goalkeeping: [['saves', 'Saves', 0], ['cs', 'Clean sheets', 0], ['gc', 'Conceded', 0], ['xgotFaced', 'xGOT faced', 2], ['goalsPrevented', 'Goals prev.', 2], ['gkPassesAcc', 'Acc. passes', 0]],
};
VIEWS.players = async () => {
  const ps = await loadSeason('players.json');
  return `<div class="section-head"><h1>Player Lab</h1><span class="muted small">${esc(state.season.replace('-', '/'))} · tap a column to sort · tap a player for the full profile</span></div>
  <div class="filters">
    <select class="ctl" id="f-pos" aria-label="Position"><option value="">All positions</option><option value="GK">Goalkeepers</option><option value="DEF">Defenders</option><option value="MID">Midfielders</option><option value="FWD">Forwards</option></select>
    <select class="ctl" id="f-comp" aria-label="Competition"><option value="season">Premier League</option><option value="seasonAll">All competitive</option><option value="seasonCups">Cups & Europe</option></select>
    <select class="ctl" id="f-mode" aria-label="Values"><option value="totals">Season totals</option><option value="per90">Per 90 minutes</option></select>
    <select class="ctl" id="f-who" aria-label="Players"><option value="current">Current squad</option><option value="all">Include loans & departures</option></select>
    <a class="btn ghost" href="#/compare">Compare players</a>
  </div>
  <div class="tabs lab-tabs" role="group" aria-label="Statistic group" id="lab-group">${Object.keys(LAB_GROUPS).map((g, i) => `<button data-g="${g}" aria-pressed="${i === 0}">${g}</button>`).join('')}</div>
  <div class="panel" style="padding:6px;margin-top:12px"><div class="table-wrap" id="lab-table"></div></div>
  ${src(`${ps.source}; shots/passing/take-ons/tackles won from FPL Core Insights (FotMob). Per-90 uses minutes from matches where each statistic was recorded`, ps.generatedAt)}`;
};
AFTER.players = async () => {
  const ps = await loadSeason('players.json');
  let group = 'Attacking';
  const draw = () => {
    const pos = document.getElementById('f-pos').value; const comp = document.getElementById('f-comp').value; const mode = document.getElementById('f-mode').value; const who = document.getElementById('f-who').value;
    const gkOnly = group === 'Goalkeeping';
    const rows = ps.players.filter((p) => (!pos || p.pos === pos) && (gkOnly ? p.pos === 'GK' : (pos === 'GK' || p.pos !== 'GK' || group === 'Passing')) && (who === 'all' ? (p[comp]?.apps || 0) > 0 || p.current || p.membership === 'loan' : p.current));
    const val = (p, [k, , , kind]) => { const st = p[comp]; return !st ? null : kind === 'rate' ? st.rates?.[k]?.value ?? null : kind === 'perGame' ? (st.totals?.[k] ?? null) !== null && st.apps ? st.totals[k] / st.apps : null : kind === 'possLost' ? possLost(st) : st.totals?.[k] ?? null; };
    // A column nobody has a value for was not recorded by the source; hide it and say so.
    const cols = LAB_GROUPS[group].filter((c) => rows.some((p) => val(p, c) !== null));
    const hidden = LAB_GROUPS[group].filter((c) => !cols.includes(c)).map(([, l]) => l);
    const cell = (p, [k, , dp, kind]) => {
      const s = p[comp];
      if (!s) return '<td class="r" data-v=""><span class="na">—</span></td>';
      const perStd = kind !== 'perGame' && mode === 'per90' && s.per90 && s.per90[k] !== undefined;
      const per = kind === 'possLost' ? mode === 'per90' : perStd;
      let v = kind === 'rate' || kind === 'perGame' || kind === 'possLost' ? val(p, [k, , , kind]) : per ? s.per90[k] : s.totals?.[k];
      if (kind === 'possLost' && per && v !== null) v = s.totals.minutes ? (v / s.totals.minutes) * 90 : null;
      return `<td class="r" data-v="${v ?? ''}">${kind === 'rate' && v !== null ? `${fmt(v, 0)}%` : fmt(v, per ? 2 : dp)}</td>`;
    };
    const minCol = (p) => p[comp]?.totals.minutes ?? 0;
    document.getElementById('lab-table').innerHTML = `<table data-sortable class="lab"><thead><tr><th class="sortable sticky-col">Player</th>${cols.map(([, l]) => `<th class="sortable r">${l}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((p) => `<tr class="clickable" data-href="#/player/${p.id}"><td class="sticky-col" data-v="${esc(p.web)}"><a href="#/player/${p.id}">${esc(p.web)}</a><span class="sub">${p.pos} · ${p[comp]?.apps ?? 0} apps · ${minCol(p)}′${p.current ? '' : ` · ${esc(p.membershipLabel || 'former')}`}${p.status && p.status !== 'a' ? `<span class="st" style="color:var(--warn)">${esc(p.statusLabel)}</span>` : ''}</span></td>${cols.map((c) => cell(p, c)).join('')}</tr>`).join('')}</tbody></table>
      ${rows.length ? '' : '<div class="empty">No players match these filters.</div>'}
      ${group === 'Progression' && rows.length ? '<p class="source" style="padding:0 8px">How each player moves the ball forward, using what the free data records: passes into the final third, chances created, touches in the opposition box, accurate long balls and crosses. Final-third passes are the closest free measure of progressive passes, and box touches the closest for progressive carries; exact counts need where-on-the-pitch data for every touch, which only paid providers sell. Every player profile shows these with league percentiles. Poss. lost (est.) = misplaced passes + times dispossessed. That is a minimum: failed take-ons and miscontrols are not recorded this season, so the true figure is higher.</p>' : ''}
      ${group === 'Pressing' && rows.length ? '<p class="source" style="padding:0 8px">Closest free measures of pressures and pressure success (estimates): Hi-int. m = running + sprinting distance, the pressing volume. Ball wins = recoveries + tackles won + interceptions, the pressing outcome. Ground duel % = ground duels won / contested. Tracking from FotMob; recorded for most but not every match.</p>' : ''}
      ${group === 'Defending' && rows.length ? '<p class="source" style="padding:0 8px">DefCon /game = FPL defensive contribution per appearance (clearances, blocks, interceptions and tackles, plus recoveries for midfielders and forwards). Fouls = fouls committed. Int. = interceptions. CBI = clearances, blocks and interceptions combined (FPL). Duels = duels won.</p>' : ''}
      ${hidden.length && rows.length ? `<p class="source" style="padding:0 8px">Not shown: ${esc(hidden.join(', '))}. The free source does not record ${hidden.length > 1 ? 'these' : 'this'} for individual players in this selection${group === 'Dribbling' ? ' (Spurs\' team take-on totals are on Team statistics)' : ''}; the column appears automatically once data exists.</p>` : ''}`;
    const t = document.querySelector('#lab-table table');
    sortableTable(t);
    t.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.hash = tr.dataset.href; });
  };
  document.getElementById('lab-group').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; group = b.dataset.g; document.querySelectorAll('#lab-group button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); });
  ['f-pos', 'f-comp', 'f-mode', 'f-who'].forEach((id) => document.getElementById(id).addEventListener('change', draw));
  draw();
};

// Strengths & weaknesses vs every Premier League player in the same position.
const swPanel = (p, prof) => {
  if (!prof) return '';
  if (!prof.metrics.length) return `<div class="panel section"><h2>Strengths & weaknesses</h2><p class="muted">Not enough Premier League minutes yet to compare ${esc(p.web)} fairly (needs ${prof.minMinutes}+ minutes; he has ${prof.minutes ?? 0}). This fills in automatically as he plays.</p></div>`;
  const val = (m) => (m.kind === 'rate' ? `${fmt(m.value, 0)}%` : `${fmt(m.value, 2)} per 90`);
  const avg = (m) => (m.leagueAvg === null ? '' : ` · league avg ${m.kind === 'rate' ? `${fmt(m.leagueAvg, 0)}%` : fmt(m.leagueAvg, 2)}`);
  const item = (m, good) => `<li class="sw-item ${good ? 'up' : 'down'}"><div class="sw-top"><strong>${esc(m.label)}</strong><span class="sw-score">${good ? 'Top' : 'Bottom'} ${good ? 100 - m.score || 1 : m.score || 1}%</span></div>
    <div class="sw-bar"><i style="width:${m.score}%"></i></div><span class="sw-meta">${esc(m.good && good ? cap(m.good) : cap(m.bad))} · ${val(m)}${avg(m)}${m.lowerIsBetter ? ' (lower is better)' : ''}</span></li>`;
  const all = prof.metrics.map((m) => `<tr><td class="wrap">${esc(m.label)}</td><td class="r">${m.kind === 'rate' ? `${fmt(m.value, 0)}%` : fmt(m.value, 2)}</td><td class="r">${m.leagueAvg === null ? '—' : m.kind === 'rate' ? `${fmt(m.leagueAvg, 0)}%` : fmt(m.leagueAvg, 2)}</td><td class="r"><span class="sw-chip ${m.score >= 70 ? 'up' : m.score <= 30 ? 'down' : ''}">${m.score}</span></td></tr>`).join('');
  return `<div class="panel section sw"><div class="section-head"><h2>Strengths & weaknesses</h2><span class="label-analysis">Calculated, not official</span></div>
    <p class="sw-text">${esc(prof.text)}</p>
    <div class="grid two"><div><h3 class="sw-h up">Strengths</h3>${prof.strengths.length ? `<ul class="sw-list">${prof.strengths.map((m) => item(m, true)).join('')}</ul>` : '<p class="small muted">Nothing clearly above the league norm for his position yet.</p>'}</div>
    <div><h3 class="sw-h down">Weaknesses</h3>${prof.weaknesses.length ? `<ul class="sw-list">${prof.weaknesses.map((m) => item(m, false)).join('')}</ul>` : '<p class="small muted">Nothing clearly below the league norm for his position.</p>'}</div></div>
    <details class="sw-all"><summary>All ${prof.metrics.length} measures compared</summary><div class="table-wrap"><table><thead><tr><th>Measure</th><th class="r">${esc(p.web)}</th><th class="r">League avg</th><th class="r">Score (0–100)</th></tr></thead><tbody>${all}</tbody></table></div>
    <p class="source">Score = how he compares with Premier League ${esc(prof.posWord || '')} who have played ${prof.minMinutes}+ minutes: 100 is the best in the league, 50 is average. Where fewer is better (fouls, being dribbled past, being dispossessed) the score is flipped. FPL lists full-backs and centre-backs together as defenders, so a centre-back can look weak on crossing.</p></details>
    <p class="source">${esc(prof.label)} Based on ${prof.minutes ?? '—'} Premier League minutes${(prof.minutes ?? 0) < 450 ? '; still a small sample, so treat it as an early read' : ''}.</p></div>`;
};
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
const spDuties = (p) => { const sp = p.setPieces; if (!sp) return ''; return [['penalties', 'Penalties'], ['freeKicks', 'Direct free kicks'], ['corners', 'Corners & indirect free kicks']].filter(([k]) => sp[k]).map(([k, l]) => `${l} <strong>${ordinal(sp[k])} choice</strong>`).join(' · '); };
VIEWS.player = async (id) => {
  const idx = (state.index ||= (await load('players-index.json')).players).find((p) => p.id === id);
  const data = await loadSeason(`players/${id}.json`, state.season, { optional: true });
  if (!data) {
    if (!idx) return '<div class="empty">This player is not in the stored data.</div>';
    return `<h1>${esc(idx.name)}</h1><div class="empty">No ${esc(state.season.replace('-', '/'))} record for ${esc(idx.web)}. Seasons available: ${idx.seasons.map((s) => `<a href="#" data-season="${s.season}">${s.season.replace('-', '/')}</a>`).join(', ')}</div>`;
  }
  const p = data.player;
  const isGK = p.pos === 'GK';
  const block = (title, cat, which) => {
    const s = p[which]; if (!s) return '';
    const defs = statDefs().filter((d) => !d.hidden && d.cat === cat && (d.pos === 'all' || (d.pos === 'gk' ? isGK : !isGK)));
    const rates = (state.meta.rateDefs || []).filter((r) => r.cat === cat && !(isGK && ['takeOnPct', 'shotConversion', 'sotPct'].includes(r.key)));
    const rows = defs.map((d) => {
      const v = s.totals[d.key]; const cov = s.coverage?.[d.key];
      return `<div class="statrow" title="${d.src === 'fplcore' ? 'Source: FPL Core Insights (FotMob)' : 'Source: FPL API (Opta)'}${cov ? ` — recorded in ${cov.reported} of ${cov.of} appearances` : ''}"><span>${esc(d.label)}${d.src === 'fplcore' ? ' <sup class="faint">F</sup>' : ''}</span><span class="v">${fmt(v, d.dp ?? 0)}${d.per90 && v !== null ? `<small>${fmtPlain(s.per90[d.key], 2)}/90</small>` : ''}${cov ? '<small>*</small>' : ''}</span></div>`;
    }).concat(rates.map((r) => { const x = s.rates?.[r.key]; return `<div class="statrow" title="${esc(r.note || '')}"><span>${esc(r.label)} <sup class="faint">calc</sup></span><span class="v">${x ? `${x.value}%<small>${x.num}/${x.den}</small>` : '<span class="na">—</span>'}</span></div>`; }));
    return `<div class="panel"><h3>${title}</h3><div class="statlist">${rows.join('')}</div></div>`;
  };
  const which = 'season';
  const pct = data.percentiles;
  const matches = data.matches.filter((m) => (m.minutes || 0) > 0);
  const un = state.meta.unavailable;
  return `<div class="player-head">${photoHtml(p)}<div><h1 style="margin:0">${esc(p.name)}</h1>
    <div class="facts"><span><strong>${esc(state.meta.posLabels[p.pos])}</strong></span>${p.squadNumber ? `<span>No. <strong>${p.squadNumber}</strong></span>` : ''}${p.age !== null ? `<span>Age <strong>${p.age}</strong>${p.birthDate ? ` (born ${esc(fmtDate(p.birthDate, { day: 'numeric', month: 'short', year: 'numeric' }))})` : ''}</span>` : ''}${p.nationality ? `<span>${esc(p.nationality)}</span>` : ''}${p.joinDate ? `<span>Joined <strong>${esc(fmtDate(p.joinDate, { month: 'short', year: 'numeric' }))}</strong></span>` : ''}<span>${p.current ? 'Current squad' : p.membershipLabel ? `<strong style="color:var(--warn)">${esc(p.membershipLabel)}</strong>${p.membershipNote ? ` — ${esc(p.membershipNote)}` : ''}` : 'Archived season'}</span></div>
    ${spDuties(p) ? `<p class="small" style="margin:6px 0 0"><span class="muted">Set-piece duties (FPL order):</span> ${spDuties(p)}</p>` : ''}
    ${p.status && p.status !== 'a' ? `<p class="small" style="color:var(--warn);margin:6px 0 0">${esc(p.statusLabel)}${p.news ? ` — ${esc(p.news)}` : ''}${p.chanceNext !== null ? ` (chance of playing next round: ${p.chanceNext}%)` : ''}</p>` : ''}
    ${idx && idx.seasons.length > 1 ? `<p class="small muted" style="margin:6px 0 0">Other seasons: ${idx.seasons.filter((s) => s.season !== state.season).map((s) => `<a href="#" data-season="${s.season}">${s.season.replace('-', '/')}</a>`).join(', ')}</p>` : ''}</div></div>
  <div class="grid four section">
    <div class="panel stat-tile"><span class="lbl">PL appearances</span><span class="big">${p.season.apps}</span><span class="small muted">${p.season.totals.starts ?? '—'} starts · ${p.season.subApps ?? '—'} as sub</span></div>
    <div class="panel stat-tile"><span class="lbl">Minutes</span><span class="big">${p.season.totals.minutes ?? 0}</span><span class="small muted">All competitive: ${p.seasonAll?.totals.minutes ?? '—'}</span></div>
    <div class="panel stat-tile"><span class="lbl">${isGK ? 'Clean sheets' : 'Goals / assists'}</span><span class="big">${isGK ? fmt(p.season.totals.cs) : `${p.season.totals.goals ?? 0} / ${p.season.totals.assists ?? 0}`}</span><span class="small muted">${isGK ? `${fmtPlain(p.season.totals.gc)} conceded` : `All competitive: ${p.seasonAll?.totals.goals ?? '—'} / ${p.seasonAll?.totals.assists ?? '—'}`}</span></div>
    <div class="panel stat-tile"><span class="lbl">${isGK ? 'Goals prevented (xGOT − goals)' : 'Goals minus xG'}</span><span class="big">${isGK ? fmt(p.season.totals.goalsPrevented, 2) : fmt(p.season.derived.goalsMinusXg, 2)}</span><span class="small muted">${isGK ? 'From FotMob post-shot model' : 'Positive = finishing above chance quality'}</span></div>
  </div>
  ${swPanel(p, data.profile)}
  ${data.summary ? `<div class="panel section"><div class="section-head"><h2>Scouting summary</h2><span class="label-analysis">Calculated, not official</span></div><p>${esc(data.summary.text)}</p><p class="tiny faint">${esc(data.summary.label)}.</p></div>` : ''}
  <div class="grid two section">
    ${isGK ? block('Goalkeeping', 'goalkeeping', which) : block('Attacking', 'attacking', which)}
    ${isGK ? block('Distribution & general', 'passing', which) : block('Passing & possession', 'passing', which)}
    ${block('Defending', 'defensive', which)}
    ${block('Discipline & FPL', 'discipline', which)}
  </div>
  ${proxyPanelHtml(data.proxies, p)}
  <p class="source">Premier League ${esc(state.season.replace('-', '/'))}. <sup>F</sup> = FPL Core Insights (FotMob definitions); others = FPL API (Opta). "calc" = calculated rate from the same matches only. * = recorded in only some matches. Retrieved ${esc(fmtDateTime(data.generatedAt))}.</p>
  ${pct ? `<div class="panel section"><div class="section-head"><h2>Player radar</h2><span class="muted small">vs ${pct.peers} Premier League ${esc(state.meta.posLabels[pct.pos].toLowerCase())}s</span></div>${radar(radarKeysOf(pct).map((k) => ({ label: RADAR_LABELS[k] || k, a: radarValue(k, pct.percentiles[k]) })), { aName: p.web })}${radarComment(pct, p)}<p class="small muted" style="text-align:center">Further out = better than more of the league. <a href="#/compare/${p.id}">Compare with another player</a></p></div>` : ''}
  ${pct ? `<div class="panel section"><div class="section-head"><h2>Against Premier League ${esc(state.meta.posLabels[pct.pos].toLowerCase())}s</h2><span class="muted small">Percentile among ${pct.peers} with ${pct.minMinutes}+ minutes</span></div>
    ${Object.entries(pct.percentiles).filter(([, v]) => v !== null).map(([k, v]) => { const d = statDefs().find((x) => x.key === k); return `<div class="pbar"><span>${esc(d ? d.label : k)} /90</span><div class="track"><div class="fill" style="width:${v}%"></div></div><span class="num" style="text-align:right">${v}</span></div>`; }).join('')}
    <p class="source">Per-90 values from FPL season totals (all clubs, so a mid-season signing's figures include his previous PL club). For xG conceded and goals conceded, a lower percentile is better.</p></div>` : ''}
  ${matches.length > 1 ? `<div class="panel section"><h2>Form, match by match</h2>${lineChart({ labels: matches.map((m) => fmtDate(m.kickoff, { day: 'numeric', month: 'short' })), series: isGK ? [{ name: 'Saves', color: 'var(--cyan)', values: matches.map((m) => m.saves ?? m.gkSaves) }, { name: 'Goals conceded', color: 'var(--loss)', values: matches.map((m) => m.gc) }] : p.pos === 'DEF' ? [{ name: 'Clear./blocks/int.', color: 'var(--cyan)', values: matches.map((m) => m.cbi) }, { name: 'Recoveries', color: 'var(--draw)', values: matches.map((m) => m.recoveries) }, { name: 'Tackles', color: 'var(--win)', values: matches.map((m) => m.tackles), dash: true }] : [{ name: 'xG', color: 'var(--cyan)', values: matches.map((m) => m.xg) }, { name: 'xA', color: 'var(--draw)', values: matches.map((m) => m.xa) }], format: (v) => v.toFixed(isGK || p.pos === 'DEF' ? 0 : 2), title: `${p.web}, match by match`, badges: matches.map(badgeOf),
    points: matches.map((m) => ({ title: `${m.home ? 'v' : '@'} ${oppName(m)}`, sub: `${fmtDate(m.kickoff, { weekday: 'short', day: 'numeric', month: 'short' })} · ${m.comp} · ${m.minutes ?? 0} min${m.goals ? ` · ${m.goals} goal${m.goals > 1 ? 's' : ''}` : ''}${m.assists ? ` · ${m.assists} assist${m.assists > 1 ? 's' : ''}` : ''}`, result: m.result, links: [['Match Centre', `#/match/${encodeURIComponent(m.matchId)}`], ...(m.comp === 'Premier League' ? [['Match breakdown', `#/breakdown/${encodeURIComponent(m.matchId)}`]] : [])] })) })}</div>` : ''}
  ${!isGK ? `<div class="panel section"><div class="section-head"><h2>Shot map</h2><select class="ctl" id="p-shot-match" aria-label="Match"><option value="">All matches (${(data.shots || []).length} shots)</option>${[...new Map((data.shots || []).map((x) => [x.matchId, x])).values()].map((x) => `<option value="${esc(x.matchId)}">${esc(fmtDate(x.kickoff, { day: 'numeric', month: 'short' }))} v ${esc(x.opponent)}</option>`).join('')}</select></div>
    <div id="p-shots">${shotMap(data.shots || [])}</div><p class="source">Shot locations from FotMob via FPL Core Insights, all competitions; updated after every match. About one shot in five has no player attached in the source and is not shown.</p></div>` : ''}
  <div class="panel section"><h2>Match log</h2><div class="table-wrap"><table data-sortable class="stack"><thead><tr><th class="sortable">Date</th><th>Match</th><th>Comp</th><th class="sortable r">Min</th><th class="sortable r">G</th><th class="sortable r">A</th><th class="sortable r">xG</th><th class="sortable r">xA</th>${p.pos === 'DEF' ? '<th class="sortable r">Tackles</th><th class="sortable r">CBI</th>' : '<th class="sortable r">Shots</th><th class="sortable r">Chances</th>'}<th class="sortable r">Recov.</th>${isGK ? '<th class="sortable r">Saves</th>' : ''}</tr></thead><tbody>
    ${matches.slice().reverse().map((m) => `<tr><td data-v="${esc(m.kickoff)}" data-label="Date">${esc(fmtDate(m.kickoff, { day: 'numeric', month: 'short' }))}</td><td data-label="Match"><a href="#/match/${encodeURIComponent(m.matchId)}">${crestOf(oppName(m), m.opponentTeamId)}${m.home ? 'v' : '@'} ${esc(oppName(m))}</a></td><td data-label="Comp">${esc(m.comp === 'Premier League' ? 'PL' : m.comp)}</td>${['minutes', 'goals', 'assists', 'xg', 'xa', ...(p.pos === 'DEF' ? ['tackles', 'cbi'] : ['shots', 'chancesCreated']), 'recoveries', ...(isGK ? ['saves'] : [])].map((k) => `<td class="r" data-v="${m[k] ?? ''}" data-label="${LOG_LABELS[k] || k}">${fmt(m[k], ['xg', 'xa'].includes(k) ? 2 : 0)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div></div>
  <div class="panel section flat"><h3>Not available from the free data sources</h3><div class="unavail">${[...un.identity, ...(isGK ? un.goalkeeping : [...un.attacking, ...un.defensive])].map((u) => `<span>${esc(u)}</span>`).join('')}${p.season.totals.dribbles === null && !isGK ? '<span>Take-ons (not recorded per player this season)</span>' : ''}</div></div>`;
};
const LOG_LABELS = { minutes: 'Minutes', goals: 'Goals', assists: 'Assists', xg: 'xG', xa: 'xA', shots: 'Shots', chancesCreated: 'Chances created', recoveries: 'Recoveries', saves: 'Saves', tackles: 'Tackles', cbi: 'Clearances, blocks & int.' };
// Progression & pressing: closest free measures for progressive passes, carries and pressures.
function proxyPanelHtml(px, p) {
  if (!px || !px.groups) return '';
  const val = (it) => (it.value === null ? '<span class="na">—</span>' : it.kind === 'rate' ? `${fmtPlain(it.value, 1)}%` : `${it.key === 'hiDist' ? Math.round(it.value).toLocaleString() : fmtPlain(it.value, 2)}<small style="white-space:nowrap">/90</small>`);
  const avg = (it) => (it.leagueAvg === null ? '' : `<span class="lrank">League ${esc(state.meta.posLabels[px.pos].toLowerCase())} avg ${it.kind === 'rate' ? `${fmtPlain(it.leagueAvg, 1)}%` : it.key === 'hiDist' ? Math.round(it.leagueAvg).toLocaleString() : fmtPlain(it.leagueAvg, 2)}</span>`);
  const groups = px.groups.map((g) => `<div class="panel"><div class="section-head"><h3 style="margin:0">${esc(g.title)}</h3><span class="label-analysis">Estimate</span></div>
    <div class="statlist">${g.items.map((it) => `<div class="statrow"><span>${it.headline ? '<strong>' : ''}${esc(it.label)}${it.headline ? '</strong>' : ''}${avg(it)}</span><span class="v">${val(it)}${it.pct !== null ? `<span class="rk-chip">${ordinal(it.pct)} pct</span>` : ''}</span></div>${it.pct !== null ? `<div class="pxbar" role="img" aria-label="${it.pct}th percentile"><div style="width:${it.pct}%"></div></div>` : ''}`).join('')}</div>
    <p class="tiny faint" style="margin:8px 0 0"><strong>Exact stat:</strong> ${esc(g.exact)} <strong>Why these:</strong> ${esc(g.why)}</p></div>`).join('');
  const short = px.minutes !== null && px.minutes < px.minMinutes;
  return `<div class="section"><div class="section-head"><h2>Progression &amp; pressing</h2><span class="muted small">Closest free measures</span></div>
    ${short ? `<div class="banner info">${esc(p.web)} has ${px.minutes} Premier League minutes; percentiles appear after ${px.minMinutes}.</div>` : ''}
    ${px.minutes === null ? '<div class="banner info">No Premier League match data for this player yet.</div>' : ''}
    <div class="grid three">${groups}</div>
    <p class="source">${esc(px.label)} Source: ${esc(px.source)}. Per 90 minutes, counting only matches where the measure was recorded.</p></div>`;
}
let teamNames = null;
const oppName = (m) => m.opponent || (m.opponentTeamId && teamNames?.get(m.opponentTeamId)) || 'opponent';
AFTER.player = async (id) => {
  const sel = document.getElementById('p-shot-match');
  if (sel) {
    const data = await loadSeason(`players/${id}.json`, state.season, { optional: true });
    sel.addEventListener('change', () => { document.getElementById('p-shots').innerHTML = shotMap((data.shots || []).filter((x) => !sel.value || x.matchId === sel.value)); });
  }
  view.querySelectorAll('[data-season]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const s = document.getElementById('season'); s.value = a.dataset.season; s.dispatchEvent(new Event('change')); }));
};
const origPlayer = VIEWS.player;
VIEWS.player = async (id) => { const t = await loadSeason('table.json'); teamNames = new Map(t.rows.map((r) => [r.teamId, r.team])); return origPlayer(id); };

VIEWS.compare = async (a = '', b = '') => {
  const ps = (await loadSeason('players.json')).players.filter((p) => (p.season.apps || 0) > 0);
  const opts = (sel) => ps.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.web)} (${p.pos})</option>`).join('');
  const A = ps.find((p) => p.id === a); const B = ps.find((p) => p.id === b);
  const keys = ['minutes', 'goals', 'assists', 'xg', 'xa', 'shots', 'sot', 'chancesCreated', 'touchesBox', 'passesAcc', 'finalThirdPasses', 'tacklesWon', 'interceptions', 'recoveries', 'cbi', 'duelsWon', 'aerialWon', 'saves'];
  const table = A && B ? `<div class="panel section"><div class="table-wrap"><table><thead><tr><th>Statistic</th><th class="r">${esc(A.web)}</th><th class="r">${esc(B.web)}</th><th class="r">${esc(A.web)} /90</th><th class="r">${esc(B.web)} /90</th></tr></thead><tbody>
    ${keys.map((k) => { const d = statDefs().find((x) => x.key === k); return `<tr><td>${esc(d.label)}</td><td class="r">${fmt(A.season.totals[k], d.dp ?? 0)}</td><td class="r">${fmt(B.season.totals[k], d.dp ?? 0)}</td><td class="r">${d.per90 ? fmt(A.season.per90[k], 2) : ''}</td><td class="r">${d.per90 ? fmt(B.season.per90[k], 2) : ''}</td></tr>`; }).join('')}
    ${(state.meta.rateDefs || []).map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${A.season.rates?.[r.key] ? `${A.season.rates[r.key].value}%` : '<span class="na">—</span>'}</td><td class="r">${B.season.rates?.[r.key] ? `${B.season.rates[r.key].value}%` : '<span class="na">—</span>'}</td><td></td><td></td></tr>`).join('')}
    </tbody></table></div><p class="source">Premier League ${esc(state.season.replace('-', '/'))}. Per-90 rates for low-minute players are volatile.</p></div>` : '<div class="empty section">Choose two players.</div>';
  let radarHtml = '';
  if (A && B) {
    const [fa, fb] = await Promise.all([loadSeason(`players/${A.id}.json`, state.season, { optional: true }), loadSeason(`players/${B.id}.json`, state.season, { optional: true })]);
    const pa = fa?.percentiles; const pb = fb?.percentiles;
    if (pa && pb) {
      const keys = (pa.pos === pb.pos ? radarKeysOf(pa) : Object.keys(pa.percentiles)).filter((k) => k in pb.percentiles);
      radarHtml = `<div class="panel section"><div class="section-head"><h2>Radar</h2><span class="muted small">${pa.pos === pb.pos ? `Percentiles vs Premier League ${esc(state.meta.posLabels[pa.pos].toLowerCase())}s` : 'Different positions: each is ranked against his own position'}</span></div>${radar(keys.map((k) => ({ label: RADAR_LABELS[k] || k, a: radarValue(k, pa.percentiles[k]), b: radarValue(k, pb.percentiles[k]) })), { aName: A.web, bName: B.web })}</div>`;
    } else radarHtml = '<div class="banner info section">A radar needs enough Premier League minutes for both players (about 40% of the matches played so far).</div>';
  }
  return `<h1>Compare players</h1><div class="filters"><select class="ctl" id="cmp-a" aria-label="First player"><option value="">First player</option>${opts(a)}</select><select class="ctl" id="cmp-b" aria-label="Second player"><option value="">Second player</option>${opts(b)}</select></div>${radarHtml}${table}`;
};
AFTER.compare = () => {
  const go = () => { location.hash = `#/compare/${document.getElementById('cmp-a').value}/${document.getElementById('cmp-b').value}`; };
  document.getElementById('cmp-a').addEventListener('change', go); document.getElementById('cmp-b').addEventListener('change', go);
};

// ---------------- Team ----------------
VIEWS.team = async () => {
  const team = await loadSeason('team.json');
  const prev = state.seasons.seasons.filter((s) => s < state.season).slice(0, 3);
  const prevTeams = await Promise.all(prev.map((s) => loadSeason('team.json', s, { optional: true })));
  const o = team.overall; const adv = o.adv;
  const squadPs = (await loadSeason('players.json', state.season, { optional: true }))?.players || [];
  const spTakers = [['penalties', 'Penalties'], ['freeKicks', 'Direct free kicks'], ['corners', 'Corners & indirect free kicks']].map(([k, l]) => {
    const list = squadPs.filter((p) => p.current && p.setPieces?.[k]).sort((a, b) => a.setPieces[k] - b.setPieces[k]);
    return list.length ? `<div class="statrow"><span>${l}</span><span class="small" style="text-align:right">${list.slice(0, 3).map((p, i) => `${i ? '' : '<strong>'}<a href="#/player/${p.id}">${esc(p.web)}</a>${i ? '' : '</strong>'}`).join(' → ')}</span></div>` : '';
  }).join('');
  const blockRow = (name, b) => `<tr><td class="sticky-col" data-label="">${name}</td><td class="r" data-label="Played">${b.n}</td><td class="r" data-label="Won-drawn-lost">${b.w}-${b.d}-${b.l}</td><td class="r" data-label="Points per game">${b.n ? (b.points / b.n).toFixed(2) : '—'}</td><td class="r" data-label="Goals for–against">${b.gf ?? 0}–${b.ga ?? 0}</td><td class="r" data-label="xG per game">${fmt(b.perMatch.xg.value, 2)}</td><td class="r" data-label="xG against per game">${fmt(b.perMatch.xga.value, 2)}</td><td class="r" data-label="Clean sheets">${b.cleanSheets}</td></tr>`;
  const pm = (k) => adv?.perMatch[k];
  return `<h1>Team statistics</h1>
  ${team.leagueRanks && Object.keys(team.leagueRanks.metrics || {}).length ? `<section style="margin-bottom:22px"><div class="section-head"><h2>Where Spurs rank</h2><span class="muted small">Per-match averages, all 20 clubs</span></div>
    ${rankTiles(team.leagueRanks, ['possession', 'fieldTilt', 'passPct', 'touchesOppBox', 'shots', 'sot', 'xg', 'bigChances', 'dribbles', 'xgSetPlay', 'xga', 'shotsAgainst', 'ppda', 'longBallPct'])}
    <p class="source">${esc(team.leagueRanks.source)}. Bar length = league position (longer is better). FotMob xG here; elsewhere the site uses FPL/Opta xG.</p></section>` : ''}
  <div class="panel"><h2>Premier League record by split</h2><div class="table-wrap"><table class="stack"><thead><tr><th class="sticky-col">Split</th><th class="r">P</th><th class="r">W-D-L</th><th class="r">Pts/game</th><th class="r">Goals</th><th class="r">xG/game</th><th class="r">xGA/game</th><th class="r">Clean sheets</th></tr></thead><tbody>
    ${blockRow('Season', o)}${blockRow('Home', team.home)}${blockRow('Away', team.away)}${blockRow('Last 5', team.last5)}${blockRow('Last 10', team.last10)}
    ${prevTeams.map((t, i) => (t ? blockRow(`${prev[i].replace('-', '/')} season`, t.overall) : '')).join('')}</tbody></table></div>
    <p class="source">xG against = xG conceded while on the pitch for a Spurs player who completed the match (FPL/Opta). Earlier seasons from the archived FPL dataset; xG exists from mid-2022/23.</p></div>
  <div class="panel section"><h2>All competitions</h2><div class="table-wrap"><table><thead><tr><th>Competition</th><th class="r">P</th><th class="r">W-D-L</th><th class="r">Goals</th></tr></thead><tbody>${Object.entries(team.byCompetition).map(([c, b]) => `<tr><td>${esc(c)}</td><td class="r">${b.n}</td><td class="r">${b.w}-${b.d}-${b.l}</td><td class="r">${b.gf}–${b.ga}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="panel section"><h2>xG trend</h2>${lineChart({ labels: team.matches.map((m) => m.opponentShort || m.opponent.slice(0, 3)), series: [{ name: 'xG for', color: 'var(--cyan)', values: team.matches.map((m) => m.xg) }, { name: 'xG against', color: 'var(--loss)', values: team.matches.map((m) => m.xga) }, { name: 'Goals for', color: 'var(--win)', values: team.matches.map((m) => m.gf), dash: true, fmt: (v) => String(v) }], format: (v) => v.toFixed(2), points: matchPoints(team.matches), title: 'xG trend', badges: team.matches.map(badgeOf) })}</div>
  ${adv ? `<div class="grid two section"><div class="panel"><h2>Per match, Spurs v opponents</h2>
    ${pairBars([
      { label: 'Possession', a: pm('possession').spurs.value, b: pm('possession').opp.value, unit: '%' },
      { label: 'Shots', a: pm('shots').spurs.value, b: pm('shots').opp.value, dp: 1 }, { label: 'On target', a: pm('sot').spurs.value, b: pm('sot').opp.value, dp: 1 },
      { label: 'Big chances', a: pm('bigChances').spurs.value, b: pm('bigChances').opp.value, dp: 1 }, { label: 'Touches in opp. box', a: pm('touchesOppBox').spurs.value, b: pm('touchesOppBox').opp.value, dp: 1 },
      { label: 'Pass accuracy', a: pm('passPct').spurs.value, b: pm('passPct').opp.value, unit: '%', dp: 1 }, { label: 'Successful take-ons', a: pm('dribbles').spurs.value, b: pm('dribbles').opp.value, dp: 1 },
      { label: 'Tackles won', a: pm('tacklesWon').spurs.value, b: pm('tacklesWon').opp.value, dp: 1 }, { label: 'Interceptions', a: pm('interceptions').spurs.value, b: pm('interceptions').opp.value, dp: 1 },
      { label: 'Corners', a: pm('corners').spurs.value, b: pm('corners').opp.value, dp: 1 },
    ])}
    <p class="small muted">Field tilt (share of passes in the opposition half): <strong>${fmt(adv.perMatch.fieldTilt.value, 1, { unit: '%' })}</strong>.</p>
    <p class="source">Averages over ${adv.n} PL matches. Source: ${esc(adv.source)}.</p></div>
    <div class="panel"><h2>By half</h2>${adv.halves ? `<div class="table-wrap"><table><thead><tr><th></th><th class="r">Goals for</th><th class="r">Goals against</th><th class="r">xG for</th><th class="r">xG against</th></tr></thead><tbody>
      <tr><td>First half</td><td class="r">${adv.halves.first.gf}</td><td class="r">${adv.halves.first.ga}</td><td class="r">${fmtPlain(adv.halves.first.xgf, 2)}</td><td class="r">${fmtPlain(adv.halves.first.xga, 2)}</td></tr>
      <tr><td>Second half</td><td class="r">${adv.halves.second.gf}</td><td class="r">${adv.halves.second.ga}</td><td class="r">${fmtPlain(adv.halves.second.xgf, 2)}</td><td class="r">${fmtPlain(adv.halves.second.xga, 2)}</td></tr></tbody></table></div><p class="source">From shot-level data in ${adv.halves.n} matches; own goals are not shots and are excluded.</p>` : '<p class="na">No shot data yet.</p>'}
    <h2 style="margin-top:18px">By situation</h2>${situationTable(adv.situations)}</div></div>
  ${pressTransitionsHtml(team, adv)}` : '<div class="banner info section">Possession, shots and passing appear here once the supplementary match source has data for this season.</div>'}
  <div class="panel section"><div class="section-head"><h2>Work without the ball</h2><span class="muted small">Per match v the other 19 clubs</span></div><p class="small" style="margin:0 0 10px">How much defending Spurs do in an average league game, and where that ranks. It sits beside pressing because together they show <em>how</em> Spurs defend: pressing high (low PPDA) or defending deep (lots of clearances and blocks).</p><div class="statlist">${['tackles', 'cbi', 'recoveries', 'defcon', 'saves', 'yc'].map((k) => { const r = team.fplRanks?.metrics?.[k]; return `<div class="statrow"><span>${esc({ tackles: 'Tackles', cbi: 'Clearances, blocks & interceptions', recoveries: 'Recoveries', defcon: 'Defensive contribution', saves: 'Saves', yc: 'Yellow cards' }[k])}${r ? `<span class="lrank">League avg ${fmt(r.leagueAvg, 1)} · highest: ${crestOf(r.leader.team)}${esc(r.leader.team)} ${fmt(r.leader.value, 1)}</span>` : ''}</span><span class="v">${fmt(o.perMatch[k].value, 1)}${r ? `<span class="rk-chip">${ordinal(r.rank)} of ${r.of}</span>` : ''}</span></div>`; }).join('')}</div>${team.fplRanks?.metrics && Object.keys(team.fplRanks.metrics).length ? `<p class="tiny faint">${esc(team.fplRanks.basis)} A high rank is not always good: more saves or clearances can mean more pressure faced, and more yellow cards is worse.</p>` : ''}
    <p class="source">Source: Fantasy Premier League (Opta). Formations are not in the free data.</p></div>
  ${spTakers ? `<div class="panel section"><h2>Set-piece takers</h2><div class="statlist">${spTakers}</div><p class="source">Fantasy Premier League's published set-piece order for current players (1st = first choice). Retrieved ${esc(fmtDateTime(team.generatedAt))}.</p></div>` : ''}`;
};
function tacticalReading(team) {
  const m = team.leagueRanks?.metrics || {};
  const out = [];
  if (m.possession && m.xg) {
    if (m.possession.rank <= 6 && m.xg.rank >= 13) out.push(`Spurs keep the ball (${ordinal(m.possession.rank)} for possession, ${ordinal(m.passPct?.rank ?? 0)} for pass accuracy) but turn it into little chance quality (${ordinal(m.xg.rank)} for xG per match). The build-up is working; the final third is not.`);
    else if (m.possession.rank <= 6) out.push(`Spurs dominate the ball (${ordinal(m.possession.rank)} for possession) and that is producing chances (${ordinal(m.xg.rank)} for xG).`);
    else out.push(`Spurs are ${ordinal(m.possession.rank)} for possession and ${ordinal(m.xg.rank)} for xG per match.`);
  }
  if (m.fieldTilt) out.push(`Field tilt of ${fmtPlain(m.fieldTilt.value, 1)}% (${ordinal(m.fieldTilt.rank)}) means most of the passing happens in the opposition half.`);
  if (m.sot && m.shots) out.push(`${fmtPlain(m.shots.value, 1)} shots per match (${ordinal(m.shots.rank)}) but only ${fmtPlain(m.sot.value, 1)} on target (${ordinal(m.sot.rank)}), which points to low-quality or blocked attempts.`);
  if (m.dribbles) out.push(`${ordinal(m.dribbles.rank)} for successful take-ons (${fmtPlain(m.dribbles.value, 1)} per match).`);
  if (m.xga) out.push(`Defensively, ${ordinal(m.xga.rank)} for xG conceded per match (${fmtPlain(m.xga.value, 2)}).`);
  return out.length ? `${out.map((t) => `<p>${esc(t)}</p>`).join('')}<p><span class="label-analysis">Calculated analysis</span> <span class="tiny faint">Generated by fixed rules from the league rankings above.</span></p>` : '<p class="na">Not enough match data yet.</p>';
}

const SIT = { regular: 'Open play (regular)', assisted: 'Open play (assisted)', 'fast-break': 'Fast break', 'set-piece': 'Set piece', corner: 'Corner', 'free-kick': 'Direct free kick', penalty: 'Penalty', 'throw-in-set-piece': 'Throw-in set piece', unknown: 'Unknown' };
function situationTable(s) {
  if (!s || !Object.keys(s).length) return '<p class="na">No shot data yet.</p>';
  return `<div class="table-wrap"><table class="sit"><thead><tr><th rowspan="2">Situation</th><th class="r grp" colspan="3">Spurs</th><th class="r grp" colspan="3">Opponents</th></tr><tr><th class="r">Shots</th><th class="r">Goals</th><th class="r">xG</th><th class="r">Shots</th><th class="r">Goals</th><th class="r">xG</th></tr></thead><tbody>${Object.entries(s).sort((a, b) => b[1].for.xg + b[1].against.xg - a[1].for.xg - a[1].against.xg).map(([k, v]) => `<tr><td class="wrap">${esc(SIT[k] || k)}</td><td class="r">${v.for.shots}</td><td class="r">${v.for.goals}</td><td class="r">${fmtPlain(v.for.xg, 2)}</td><td class="r">${v.against.shots}</td><td class="r">${v.against.goals}</td><td class="r">${fmtPlain(v.against.xg, 2)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------------- Tactics ----------------
VIEWS.tactics = async () => {
  const [a, team, ps] = await Promise.all([loadSeason('analysis.json', state.season, { optional: true }), loadSeason('team.json'), loadSeason('players.json')]);
  if (!a) return '<h1>Tactical analysis</h1><div class="empty">Tactical analysis is generated for the current season only. Switch to the current season.</div>';
  const t = a.tactical;
  const dz = t.deZerbi;
  return `<div class="section-head"><h1>Tactical analysis: De Zerbi's Tottenham</h1><span class="label-analysis">Calculated analysis</span></div>
  <p class="muted">Head coach: ${esc(state.meta.headCoach || 'unknown')}. Everything below is generated by fixed rules from the stored match data. Measured evidence is kept separate from interpretation, and areas the data cannot measure are listed as such.</p>
  <div class="panel section"><h2>Coach comparison (Premier League)</h2><div class="table-wrap"><table class="stack"><thead><tr><th class="sticky-col">Coach</th><th class="r">Matches</th><th class="r">Pts per game</th><th class="r">Goals per game</th><th class="r">Conceded per game</th><th class="r">xG per game</th><th class="r">xGA per game</th><th class="r">Tackles + CBI</th></tr></thead><tbody>
    ${t.eras.map((e) => `<tr class="${e.coach === 'Roberto De Zerbi' ? 'hl' : ''}"><td class="sticky-col wrap" data-label="Coach">${esc(e.coach)}</td><td class="r" data-label="Matches">${e.matches}</td><td class="r" data-label="Pts/game">${fmt(e.ppg, 2)}</td><td class="r" data-label="Goals/game">${fmt(e.gfPer, 2)}</td><td class="r" data-label="Conceded/game">${fmt(e.gaPer, 2)}</td><td class="r" data-label="xG/game">${fmt(e.xgPer, 2)}</td><td class="r" data-label="xGA/game">${fmt(e.xgaPer, 2)}</td><td class="r" data-label="Tackles + CBI">${fmt(e.defActionsPer, 1)}</td></tr>`).join('')}</tbody></table></div>
    <p class="source">Stored seasons from 2020/21. Small samples (fewer than ~10 matches) are unreliable.</p></div>
  ${team.leagueRanks?.metrics?.possession ? `<section class="section"><div class="section-head"><h2>De Zerbi's game in numbers</h2><span class="label-observed">Measured</span></div>
    ${rankTiles(team.leagueRanks, ['possession', 'passPct', 'fieldTilt', 'xg', 'sot', 'dribbles'])}</section>` : ''}
  <div class="grid two section">
    <div class="panel"><div class="section-head"><h2>Where Spurs shoot from</h2><span class="label-observed">Measured</span></div>${shotZonePitch(team.shotZones)}<p class="small muted">Zones shaded by total xG; numbers show xG, shots and goals. Premier League, this season.</p><p class="source">Shot coordinates from FotMob via FPL Core Insights.</p></div>
    <div class="panel"><div class="section-head"><h2>Drawing the press</h2><span class="illustrative">Illustrative</span></div>${conceptPitch('buildup')}
      <p class="small">The idea behind De Zerbi's build-up: the goalkeeper and centre-backs invite the opposition press, then pass past it to the free player beyond (cyan). The risk is losing the ball close to goal.</p>
      <p class="tiny faint">A hand-drawn explanation of the coaching idea, not Tottenham's measured positions from any match. Free data has no player positions.</p></div>
  </div>
  <div class="grid two section">
    <div class="panel"><div class="section-head"><h2>3-2-5 in possession</h2><span class="illustrative">Illustrative</span></div>${conceptPitch('325')}
      <p class="small">A common shape for De Zerbi's teams on the ball: three at the back and two midfielders guard against counter-attacks while five players occupy the attacking lanes.</p>
      <p class="tiny faint">Concept diagram, not a measured Tottenham formation.</p></div>
    <div class="panel"><h2>What the measured numbers say about it</h2>${tacticalReading(team)}</div>
  </div>
  <div class="panel section"><h2>Under De Zerbi: rolling five-match xG</h2>${lineChart({ labels: dz.rolling.map((r) => r.opponent), series: [{ name: 'xG for (5-match avg)', color: 'var(--cyan)', values: dz.rolling.map((r) => r.xg5) }, { name: 'xG against (5-match avg)', color: 'var(--loss)', values: dz.rolling.map((r) => r.xga5) }], format: (v) => v.toFixed(2) })}<p class="source">${dz.matches} PL matches since April 2026.</p></div>
  <section class="section panel"><h2>Findings</h2>${a.insights.map(insightHtml).join('') || '<p class="na">Not enough matches yet.</p>'}</section>
  ${team.overall.adv ? `<div class="grid two section"><div class="panel"><h2>Where the shots come from</h2>${situationTable(team.overall.adv.situations)}<p class="source">Set-piece and open-play outcomes from shot-level data (FPL Core Insights / FotMob).</p></div><div class="panel"><h2>Season shot map</h2><p class="small muted">Spurs shots, PL. Hover a circle for details.</p><div id="season-shots"><div class="skeleton" style="height:240px"></div></div></div></div>` : ''}
  <div class="grid two section">
    <div class="panel"><h2>Who supplies the chance quality</h2>${barList(t.positionShare.filter((x) => x.xgiShare !== null).map((x) => ({ label: state.meta.posLabels[x.pos] + 's', value: x.xgiShare })), { max: 100, format: (v) => `${fmtPlain(v, 0)}%` })}<p class="source">Share of the squad's xG + xA by position group.</p></div>
    <div class="panel"><h2>Player roles from the numbers</h2>${t.roles.filter((r) => r.tags.length).map((r) => `<div class="statrow"><a href="#/player/${r.playerId}">${esc(r.name)}</a><span class="small muted" style="text-align:right">${r.tags.map(esc).join(', ')}</span></div>`).join('') || '<p class="na">No player meets the role thresholds yet.</p>'}<p class="source">Tags from per-90 thresholds (270+ minutes), e.g. primary creator = 0.20+ xA per 90.</p></div>
  </div>
  <div class="panel section"><h2>What can and cannot be measured</h2>${t.areas.map((x) => `<div class="area-row"><strong>${esc(x.area)}</strong><span class="badge ${x.measurable}">${{ yes: 'Measured', partial: 'Partly measured', no: 'Not measurable' }[x.measurable]}</span><span class="small muted">${esc(x.evidence)} ${x.missing ? `<span class="faint">Missing: ${esc(x.missing)}</span>` : ''}</span></div>`).join('')}</div>
  <div class="panel section" id="analyst"><h2>Ask the analyst</h2><p class="small muted">Answers come only from the stored data, with season, sample and source. It is rule-based, not a chatbot, so it says when data is missing rather than guessing.</p>
    <form class="ask" id="ask-form"><input class="ctl" id="ask-q" placeholder="e.g. Which players create the most chances per 90?" aria-label="Question"><button class="btn" type="submit">Ask</button></form>
    <div class="chips">${suggestions().map((s) => `<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div><div id="ask-out"></div></div>
  <div class="panel section"><div class="section-head"><h2>Export as an article</h2><div style="display:flex;gap:8px"><button class="btn ghost" id="copy-md">Copy Markdown</button><button class="btn" id="dl-md">Download .md</button></div></div><p class="small muted">A Substack-ready write-up of the findings with data cut-off date, tables and sources. Paste into Substack's editor (it accepts Markdown).</p><details><summary class="small">Preview</summary><pre style="white-space:pre-wrap;font-size:.82rem;background:var(--bg-2);padding:12px;border-radius:8px">${esc(a.articleMarkdown)}</pre></details></div>`;
};
AFTER.tactics = async () => {
  const [a, team, ps] = await Promise.all([loadSeason('analysis.json', state.season, { optional: true }), loadSeason('team.json'), loadSeason('players.json')]);
  if (!a) return;
  const ctx = { players: ps.players, team, analysis: a, season: state.season };
  const out = document.getElementById('ask-out');
  const ask = (q) => { out.innerHTML = renderAnswer(answer(q, ctx)); };
  document.getElementById('ask-form').addEventListener('submit', (e) => { e.preventDefault(); const q = document.getElementById('ask-q').value.trim(); if (q) ask(q); });
  document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { document.getElementById('ask-q').value = b.dataset.q; ask(b.dataset.q); }));
  document.getElementById('copy-md').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(a.articleMarkdown); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Copy failed — use Download'; } });
  document.getElementById('dl-md').addEventListener('click', () => { const blob = new Blob([a.articleMarkdown], { type: 'text/markdown' }); const u = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = u; l.download = `spurs-analysis-${a.generatedAt.slice(0, 10)}.md`; l.click(); URL.revokeObjectURL(u); });
  const box = document.getElementById('season-shots');
  if (box) {
    const ms = await Promise.all(team.matches.map((m) => loadSeason(`matches/${m.matchId}.json`, state.season, { optional: true })));
    box.innerHTML = shotMap(ms.filter(Boolean).flatMap((m) => (m.detail?.shots || []).filter((s) => s.team === 'spurs')));
  }
};

// ---------------- Video Evidence Room ----------------
// Only analysis of how Spurs play: match reviews, tactical breakdowns, stats/data
// videos and player-role analysis. Highlights live on each match page instead.
const statStrip = (m) => m ? `<div class="vstats">
  <span class="vres ${m.result === 'W' ? 'w' : m.result === 'L' ? 'l' : 'd'}">${esc(m.result || '')} ${esc(m.score)}</span>
  ${m.xg !== null && m.xga !== null ? `<span><b>${fmt(m.xg, 2)}–${fmt(m.xga, 2)}</b> xG</span>` : ''}
  ${m.possession !== null ? `<span><b>${fmt(m.possession, 0)}%</b> poss.</span>` : ''}
  ${m.shots !== null ? `<span><b>${fmt(m.shots, 0)}–${fmt(m.shotsAgainst, 0)}</b> shots</span>` : ''}
  ${m.boxTouches !== null ? `<span><b>${fmt(m.boxTouches, 0)}</b> box touches</span>` : ''}</div>` : '';
const videoCard = (v) => `<article class="panel video-card">
  <button class="thumb" data-vid="${esc(v.videoId)}" aria-label="Play ${esc(v.title)}"><img loading="lazy" alt="" src="${esc(v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`)}"><span class="play">${icon('i-play')}</span></button>
  <div class="vmeta"><span class="vcat c-${esc(v.category)}">${esc(v.categoryLabel)}</span><span class="pill">${esc(v.tierLabel)}</span></div>
  <strong>${esc(v.title)}</strong>
  <span class="small muted">${esc(v.channel)} · ${esc(fmtDate(v.published, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
  ${v.topics?.length ? `<div class="vtopics">${v.topics.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
  ${v.players?.length ? `<span class="small">Players: ${v.players.map((p) => `<a href="#/player/${encodeURIComponent(p.id)}">${esc(p.name)}</a>`).join(', ')}</span>` : ''}
  ${v.matchId ? `<div class="vmatch"><span class="small">Match: <a href="#/match/${encodeURIComponent(v.matchId)}">${crestOf(v.opponent)}${esc(v.opponent)}</a> · ${esc(v.competition)}</span>${statStrip(v.matchStats)}${v.matchStats ? `<a class="small" href="#/breakdown/${encodeURIComponent(v.matchId)}">Check the claims against the data →</a>` : ''}</div>` : ''}
  <a class="small" href="${esc(v.url)}" target="_blank" rel="noopener">Open on YouTube</a></article>`;

VIEWS.video = async () => {
  const ev = await loadSeason('evidence.json', state.season, { optional: true });
  const items = ev ? ev.items : [];
  const cats = ev?.categories || {};
  const topics = [...new Set(items.flatMap((v) => v.topics || []))].sort();
  const plist = [...new Map(items.flatMap((v) => v.players || []).map((p) => [p.id, p])).values()].sort((x, y) => x.name.localeCompare(y.name));
  const matches = [...new Map(items.filter((v) => v.matchId).map((v) => [v.matchId, v])).values()].sort((x, y) => String(y.matchKickoff).localeCompare(String(x.matchKickoff)));
  const latest = matches.find((m) => m.matchStats);
  const latestVids = latest ? items.filter((v) => v.matchId === latest.matchId) : [];
  const count = (c) => items.filter((v) => v.category === c).length;
  return `<div class="section-head"><h1>Video Evidence Room</h1><span class="muted small">${items.length} analysis video${items.length === 1 ? '' : 's'} on how Spurs play</span></div>
  <p class="lede">Tactical breakdowns, statistical deep-dives and match reviews of Tottenham, gathered from broadcasters, tactical analysts and Spurs review shows. Match highlights, interviews, training clips and promos are left out; highlights are on each match page.</p>
  ${latest ? `<section class="panel section feature"><div class="section-head"><h2>Latest match under review: ${crestOf(latest.opponent)}${esc(latest.opponent)}</h2><a class="small" href="#/breakdown/${encodeURIComponent(latest.matchId)}">Full breakdown →</a></div>
    ${statStrip(latest.matchStats)}${latest.matchStats.verdict ? `<p class="small muted">What the data says: ${esc(latest.matchStats.verdict)}</p>` : ''}
    <div class="grid three">${latestVids.slice(0, 3).map(videoCard).join('')}</div></section>` : ''}
  <div class="tabs" role="group" aria-label="Video type" id="v-cat"><button data-cat="" aria-pressed="true">All</button>${Object.entries(cats).filter(([k]) => count(k)).map(([k, l]) => `<button data-cat="${k}" aria-pressed="false">${esc(l)} <span class="faint">${count(k)}</span></button>`).join('')}</div>
  <div class="filters" style="margin-top:12px">
    <select class="ctl" id="v-topic" aria-label="Topic"><option value="">All topics</option>${topics.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
    <select class="ctl" id="v-player" aria-label="Player"><option value="">All players</option>${plist.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
    <select class="ctl" id="v-match" aria-label="Match"><option value="">All matches</option>${matches.map((m) => `<option value="${esc(m.matchId)}">${esc(m.opponent)} · ${esc(fmtDate(m.matchKickoff, { day: 'numeric', month: 'short' }))}</option>`).join('')}</select>
    <input class="ctl" id="v-q" placeholder="Search titles" aria-label="Search videos"></div>
  <div class="grid three" id="v-grid"></div>
  <details class="panel section"><summary><strong>How videos are chosen</strong></summary>
    <p class="small">Every couple of hours (every 30 minutes on match days) the site reads the public feeds of: the official Tottenham Hotspur and Premier League channels; Sky Sports Premier League and The Overlap (broadcaster analysis, including Monday Night Football); The Athletic FC, Coaches' Voice and HITC Sevens (tactical analysts); and Last Word On Spurs (a Spurs match-review show). A video is kept only if it is about Spurs <em>and</em> its title or description shows it is analysis (review, tactics, stats, a player's role and so on).</p>
    <p class="small">It is linked to a match only when it names the opponent and came out in that match's window. The match's real numbers sit beside it so you can check the video's argument against the data. The site sorts videos by their title and description; it has not watched the footage, so it never claims a clip shows a particular action, and it adds no timestamps. Videos play in YouTube's own player.</p></details>
  <p class="source">Feeds last read: ${esc(fmtDateTime(state.meta.dataUpdatedAt.video))}. YouTube's public feeds only list each channel's latest uploads, so the library has been building up since collection started.</p>`;
};
AFTER.video = async () => {
  const ev = await loadSeason('evidence.json', state.season, { optional: true });
  const items = ev ? ev.items : [];
  let cat = '';
  const featured = new Set((() => { const m = items.filter((v) => v.matchId && v.matchStats).sort((x, y) => String(y.matchKickoff).localeCompare(String(x.matchKickoff)))[0]; return m ? items.filter((v) => v.matchId === m.matchId).slice(0, 3).map((v) => v.videoId) : []; })());
  const draw = () => {
    const t = document.getElementById('v-topic').value; const pl = document.getElementById('v-player').value; const mt = document.getElementById('v-match').value; const q = norm(document.getElementById('v-q').value);
    const list = items.filter((v) => (!cat || v.category === cat) && (!t || (v.topics || []).includes(t)) && (!pl || (v.players || []).some((p) => p.id === pl)) && (!mt || v.matchId === mt) && (!q || norm(`${v.title} ${v.opponent || ''} ${v.channel}`).includes(q)) && (cat || t || pl || mt || q || !featured.has(v.videoId)));
    document.getElementById('v-grid').innerHTML = list.map(videoCard).join('') || `<div class="empty">${items.length ? 'No analysis videos match these filters.' : 'No Spurs analysis videos have been published on the watched channels since collection began. They usually appear within a day of each match, and this page fills automatically.'}</div>`;
  };
  if (!view.dataset.vidBound) {
    view.dataset.vidBound = '1';
    view.addEventListener('click', (e) => { const b = e.target.closest('[data-vid]'); if (b && b.isConnected) b.outerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.dataset.vid)}?autoplay=1" title="Video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`; });
  }
  document.getElementById('v-cat').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; document.querySelectorAll('#v-cat button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); });
  ['v-topic', 'v-player', 'v-match', 'v-q'].forEach((id) => document.getElementById(id).addEventListener('input', draw));
  draw();
};

// ---------------- Squad planner ----------------
VIEWS.squad = async () => {
  const a = await loadSeason('analysis.json', state.season, { optional: true });
  if (!a) return '<h1>Squad planner</h1><div class="empty">The squad planner covers the current season. Switch to the current season.</div>';
  const sq = a.squad; const ps = (await loadSeason('players.json')).players;
  return `<h1>Squad planner</h1>
  ${sq.weaknesses.length || sq.thin.length ? `<div class="panel"><h2>Areas to watch</h2>${[...sq.weaknesses, ...sq.thin].map((w) => `<p>${esc(w.text)}</p>`).join('')}<span class="label-analysis">Calculated</span></div>` : '<div class="panel"><h2>Areas to watch</h2><p class="muted">No position group is in the league\'s bottom third on its key measure, and every group has enough available players.</p></div>'}
  <div class="grid two section">${['GK', 'DEF', 'MID', 'FWD'].map((pos) => { const g = sq.groups[pos]; return `<div class="panel"><div class="section-head"><h2>${state.meta.posLabels[pos]}s</h2><span class="small muted">${g.count} players · avg age ${fmtPlain(g.averageAge, 1)}</span></div>
    ${g.leagueRank ? `<p class="small muted">League rank: <strong style="color:var(--text)">${ordinal(g.leagueRank.rank)}</strong> of ${g.leagueRank.of} for ${esc(g.leagueRank.metric)} (${fmtPlain(g.leagueRank.value, 2)}).</p>` : ''}
    ${g.depth.map((d) => `<div class="pbar"><span><a href="#/player/${d.playerId}">${esc(d.name)}</a>${d.age ? ` <span class="faint tiny">${d.age}</span>` : ''}${d.status && d.status !== 'a' ? ` <span class="tiny" style="color:var(--warn)" title="${esc(d.news || '')}">${esc(d.statusLabel)}</span>` : ''}</span><div class="track"><div class="fill" style="width:${d.share}%"></div></div><span class="num" style="text-align:right">${d.minutes}</span></div>`).join('')}
    <p class="tiny faint">Bar = share of the group's PL minutes. Contract dates are not available.</p></div>`; }).join('')}</div>
  <div class="panel section"><div class="section-head"><h2>Replacement shortlist</h2><span class="label-analysis">Algorithmic recommendation</span></div>
    <select class="ctl" id="rep-player" aria-label="Player">${ps.filter((p) => sq.replacements[p.id]?.length).map((p) => `<option value="${p.id}">${esc(p.web)} (${p.pos})</option>`).join('')}</select>
    <div id="rep-out" style="margin-top:12px"></div>
    <p class="tiny faint">Similarity compares per-90 numbers within the same position across all Premier League players with enough minutes (about 40% of the matches played so far), from the official FPL data. Strengths = measures in the top quarter of the league for that position.</p>${sq.notes.map((n) => `<p class="tiny faint">${esc(n)}</p>`).join('')}</div>
  ${[['loans', 'Out on loan'], ['departures', 'Left the club this season'], ['unregistered', 'Not in the registered squad']].filter(([k]) => sq[k]?.length).map(([k, title]) => `<div class="panel section"><h2>${title}</h2>${sq[k].map((d) => `<div class="statrow"><span><a href="#/player/${d.playerId}">${esc(d.name)}</a> <span class="faint tiny">${esc(d.pos || '')}</span></span><span class="small muted" style="text-align:right">${esc(d.note || '')}${d.apps ? ` · ${d.apps} Spurs apps this season` : ''}</span></div>`).join('')}<p class="tiny faint">Status and note as published by the Premier League (FPL player list). These players are excluded from the current squad, depth charts and replacement analysis.</p></div>`).join('')}`;
};
AFTER.squad = async () => {
  const a = await loadSeason('analysis.json', state.season, { optional: true });
  const sel = document.getElementById('rep-player'); if (!sel) return;
  const draw = () => {
    const r = a.squad.replacements[sel.value] || []; const tgt = a.squad.replacementTargets?.[sel.value];
    document.getElementById('rep-out').innerHTML = r.map((x) => `<div class="panel" style="margin-bottom:12px">
      <div class="section-head" style="margin-bottom:4px"><div><strong style="font-size:1.1rem">${esc(x.name)}</strong><div class="small muted">${crestOf(x.team, x.teamId)}${esc(x.team)} · age ${fmt(x.age)} · ${x.minutes} PL minutes${x.starts !== null && x.starts !== undefined ? ` · ${x.starts} starts` : ''}</div></div><div class="rank-tile" style="padding:8px 12px;text-align:center"><div class="val" style="font-size:1.6rem">${x.similarity}%</div><div class="tiny muted">similar</div></div></div>
      ${x.why?.length ? `<h3 class="small" style="margin:12px 0 4px">Why they're similar</h3>${x.why.map((d) => `<div class="statrow"><span>${esc(d.label)} per 90</span><span class="small">${esc(x.web)} <strong class="num">${d.them}</strong> · ${esc(tgt?.name || 'Spurs')} <strong class="num">${d.spurs}</strong></span></div>`).join('')}` : ''}
      ${x.strengths?.length ? `<h3 class="small" style="margin:12px 0 4px">Strengths</h3><div class="chips">${x.strengths.map((st) => `<span class="pill" style="border-color:var(--win);color:var(--text)">${esc(st.label)}: top ${Math.max(1, 100 - st.pct)}% <span class="faint">(${st.value}/90)</span></span>`).join('')}</div>` : '<p class="small muted" style="margin-top:10px">No measure in the top quarter of the league for his position.</p>'}
      ${x.differs?.length ? `<p class="small" style="margin:8px 0 0"><span class="muted">Where he differs:</span> ${x.differs.map((d) => `${d.higher ? 'more' : 'less'} ${esc(d.label.toLowerCase())} (${d.them} v ${d.spurs} per 90)`).join('; ')}</p>` : ''}
      <div class="chips" style="margin-top:10px">${[['G', x.season.goals], ['A', x.season.assists], ['xG', x.season.xg], ['xA', x.season.xa], ['CBI', x.season.cbi], ['Tackles', x.season.tackles], ['Recoveries', x.season.recoveries], ...(x.season.saves ? [['Saves', x.season.saves], ['Clean sheets', x.season.cs]] : [])].filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `<span class="pill"><span class="faint">${k}</span> <strong style="color:var(--text)">${v}</strong></span>`).join('')}</div>
      </div>`).join('') || '<p class="na">Not enough minutes to compare yet.</p>';
  };
  sel.addEventListener('change', draw); draw();
};

// ---------------- League table ----------------
AFTER.table = () => {
  document.getElementById('tbl-toggle')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    document.querySelectorAll('#tbl-toggle button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    document.getElementById('tbl-real').hidden = b.dataset.t !== 'real'; document.getElementById('tbl-deserved').hidden = b.dataset.t !== 'deserved';
  });
};
VIEWS.table = async () => {
  const t = await loadSeason('table.json');
  const v = t.verification || {};
  return `<div class="section-head"><h1>Premier League table</h1><span class="muted small">${esc(state.season.replace('-', '/'))}</span></div>
  ${t.deserved?.rows?.length ? `<div class="seg tbl-toggle" id="tbl-toggle"><button data-t="real" aria-pressed="true">Real table</button><button data-t="deserved" aria-pressed="false">Deserved table</button></div>` : ''}
  <div id="tbl-deserved" hidden>${deservedHtml(t.deserved, t.spurs?.teamId)}</div>
  <div id="tbl-real">
  <div class="panel" style="padding:6px"><div class="table-wrap"><table><thead><tr><th class="r">#</th><th>Club</th><th class="r">P</th><th class="r">W</th><th class="r">D</th><th class="r">L</th><th class="r hide-xs">GF</th><th class="r hide-xs">GA</th><th class="r">GD</th><th class="r">Pts</th><th>Form</th></tr></thead><tbody>
  ${t.rows.map((r) => `<tr class="${r.teamId === t.spurs?.teamId ? 'hl' : ''}"><td class="r">${r.position}</td><td>${crest(r.teamId)}<span class="cl-l">${esc(r.team)}</span><span class="cl-s">${esc(r.short || r.team)}</span></td><td class="r">${r.played}</td><td class="r">${r.won}</td><td class="r">${r.drawn}</td><td class="r">${r.lost}</td><td class="r hide-xs">${r.gf}</td><td class="r hide-xs">${r.ga}</td><td class="r">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="r"><strong>${r.points}</strong></td><td><span class="form-strip">${r.form.map((x) => resultChip(x, true)).join('')}</span></td></tr>`).join('')}</tbody></table></div></div>
  <p class="source">${esc(t.source)}, ordered by points, goal difference, goals scored, then head-to-head. Includes provisionally finished matches. Retrieved ${esc(fmtDateTime(t.generatedAt))}.
  ${v.fplOfficialPosition ? ` Cross-check with the Premier League's published position: ${v.fplOfficialPosition.agrees ? 'matches' : `differs (official ${v.fplOfficialPosition.position})`}.` : ''}
  ${v.footballData ? ` football-data.org check: ${v.footballData.agrees ? 'matches' : 'differs'} (${esc(fmtDateTime(v.footballData.retrievedAt))}).` : ''}</p></div>
  ${leadersPanel(t.leaders)}
  ${xgLeadersPanel(t.leaders)}
  ${roundPanel(t.round)}`;
};
// Table re-ranked by expected points from each match's chances, with a luck meter.
function deservedHtml(d, spursId) {
  if (!d?.rows?.length) return '';
  const maxLuck = Math.max(1, ...d.rows.map((r) => Math.abs(r.luck)));
  const sp = d.rows.find((r) => r.teamId === spursId);
  const luckBar = (l) => `<div class="luck"><div class="luck-mid"></div><div class="luck-fill ${l >= 0 ? 'pos' : 'neg'}" style="${l >= 0 ? 'left:50%' : `right:50%`};width:${(Math.abs(l) / maxLuck) * 50}%"></div></div>`;
  const move = (r) => { if (!r.realPosition) return ''; const d2 = r.realPosition - r.position; return d2 === 0 ? '<span class="faint">=</span>' : `<span class="${d2 > 0 ? 'mv-up' : 'mv-down'}">${d2 > 0 ? '▲' : '▼'}${Math.abs(d2)}</span>`; };
  const story = sp ? `Spurs are <strong>${ordinal(sp.realPosition)}</strong> on points but <strong>${ordinal(sp.position)}</strong> on performance: ${fmtPlain(sp.xPts, 1)} expected points from their chances against ${sp.points} real points (${sp.luck >= 0 ? '+' : ''}${fmtPlain(sp.luck, 1)}). ${sp.luck <= -2 ? 'Results have been worse than the football.' : sp.luck >= 2 ? 'Results have been kinder than the football.' : 'Results are close to what the chances deserved.'}` : '';
  const lucky = d.rows.slice().sort((a, b) => b.luck - a.luck)[0]; const unlucky = d.rows.slice().sort((a, b) => a.luck - b.luck)[0];
  return `${story ? `<div class="panel section"><p style="margin:0">${story}</p><p class="small muted" style="margin:6px 0 0">Luckiest: ${crest(lucky.teamId)}${esc(lucky.team)} (+${fmtPlain(lucky.luck, 1)} pts) · Unluckiest: ${crest(unlucky.teamId)}${esc(unlucky.team)} (${fmtPlain(unlucky.luck, 1)} pts)</p></div>` : ''}
  <div class="panel" style="padding:6px"><div class="table-wrap"><table class="deserved"><thead><tr><th class="r">#</th><th>Club</th><th class="r">xPts</th><th class="r">Pts</th><th class="r hide-xs">xG±</th><th>Luck</th><th class="r">Real</th></tr></thead><tbody>
  ${d.rows.map((r) => `<tr class="${r.teamId === spursId ? 'hl' : ''}"><td class="r">${r.position}</td><td>${crest(r.teamId)}<span class="cl-l">${esc(r.team)}</span><span class="cl-s">${esc(r.short)}</span></td><td class="r"><strong>${fmtPlain(r.xPts, 1)}</strong></td><td class="r">${r.points}</td><td class="r hide-xs">${r.xgd > 0 ? '+' : ''}${fmtPlain(r.xgd, 1)}</td><td>${luckBar(r.luck)}<span class="tiny ${r.luck >= 0 ? 'mv-up' : 'mv-down'}">${r.luck > 0 ? '+' : ''}${fmtPlain(r.luck, 1)}</span></td><td class="r">${r.realPosition ?? '—'} ${move(r)}</td></tr>`).join('')}
  </tbody></table></div></div>
  <p class="source">Ranked by expected points (xPts): for every league match, the chance of winning × 3 plus the chance of drawing, worked out from both teams' xG. Luck = real points − xPts over the same ${d.matches} matches; green = more points than the chances deserved. Real = position in the real table (▲ means the real table has them higher). ${esc(d.source)}</p>`;
}

// League-wide xG and xA rankings (FPL/Opta), with per-90 context.
function xgLeadersPanel(L) {
  if (!L || (!L.xg && !L.xa)) return '';
  const card = (x) => `<div class="panel"><h3 style="margin-top:0">${esc(x.title)}</h3>${x.rows.length ? `<ol class="leaders">${x.rows.map((r) => `<li class="${r.teamId === state.meta.providerTeamIds?.fpl ? 'hl' : ''}"><span>${crest(r.teamId)}<strong>${esc(r.name)}</strong> <span class="faint tiny">${esc(r.team || '')}${r.minutes ? ` · ${fmtPlain((r.value / r.minutes) * 90, 2)}/90` : ''}</span></span><span class="v">${fmtPlain(r.value, 2)}</span></li>`).join('')}</ol>` : '<p class="small muted">Not available yet.</p>'}</div>`;
  return `<section class="section"><div class="section-head"><h2>xG and xA rankings</h2><span class="muted small">All clubs · Spurs players highlighted</span></div>
    <div class="grid two">${[L.xg, L.xa].filter(Boolean).map(card).join('')}</div><p class="source">Season totals from the FPL API (Opta expected goals and assists), with the rate per 90 minutes. xG = quality of chances a player shot from; xA = quality of chances he set up.</p></section>`;
}
// Spurs' next gameweek: the range of positions Spurs could hold and the other fixtures that matter.
function roundPanel(r) {
  if (!r) return '';
  const pos = (n) => ordinal(n);
  const rg = r.range;
  const rangeTxt = `Spurs are ${pos(rg.current)} on ${r.spurs.points} points. After gameweek ${r.gameweek} they could be as high as <strong>${pos(rg.best)}</strong>${rg.bestNeedsGd ? ` (${pos(rg.bestSafe)} if goal difference goes against them)` : ''} with a win, or as low as <strong>${pos(rg.worst)}</strong>${rg.worst !== rg.worstIfGd ? ` (${pos(rg.worstIfGd)} if goal difference helps)` : ''} with a defeat, depending on other results.`;
  const side = (x, win) => `<span class="rf-team${win ? ' want' : ''}">${crest(x.teamId)}<span>${esc(x.short)}</span><span class="faint tiny">${x.position ? pos(x.position) : ''}</span></span>`;
  const row = (f) => {
    const mid = f.score ? `<strong class="rf-score">${f.score.home}–${f.score.away}</strong>${f.status === 'LIVE' ? '<span class="live-dot">LIVE</span>' : ''}` : `<span class="small muted">${esc(fmtDate(f.kickoff, { weekday: 'short', day: 'numeric', month: 'short' }))}<br>${esc(fmtTime(f.kickoff))}</span>`;
    const out = f.outcome ? `<span class="rf-out ${f.outcome}">${{ good: 'Good for Spurs', mixed: 'Mixed for Spurs', bad: 'Bad for Spurs' }[f.outcome]}</span>` : '';
    const want = f.wants ? `<span class="rf-want">Spurs want: ${f.wants === 'draw' ? 'a draw' : `${esc(f.wants === 'home' ? f.home.short : f.away.short)} win`}</span>` : '';
    return `<div class="rf-row${f.relevant ? ' rel' : ''}"><div class="rf-line">${side(f.home, f.wants === 'home')}<div class="rf-mid">${mid}</div>${side(f.away, f.wants === 'away')}</div>
      ${f.relevant ? `<div class="rf-note">${f.sameDay ? '<span class="rf-tag">Same day as Spurs</span>' : ''}${want}${out}<p class="small" style="margin:4px 0 0">${esc(f.note)}</p></div>` : ''}</div>`;
  };
  const rel = r.fixtures.filter((f) => f.relevant); const rest = r.fixtures.filter((f) => !f.relevant);
  const sm = r.spursMatch;
  return `<section class="panel section"><div class="section-head"><h2>Gameweek ${r.gameweek}: what it means for Spurs</h2><span class="label-analysis">Calculated</span></div>
    <p class="small" style="margin:0 0 6px">${crest(sm.opponentTeamId)}Spurs ${sm.home ? 'v' : '@'} <strong>${esc(sm.opponent)}</strong> · ${esc(fmtDate(sm.kickoff, { weekday: 'short', day: 'numeric', month: 'short' }))}, ${esc(fmtTime(sm.kickoff))} Bahrain</p>
    <p class="small" style="margin:0 0 12px">${rangeTxt}</p>
    ${rel.length ? `<h3 style="margin:8px 0">Results that matter to Spurs</h3><div class="rf-list">${rel.map(row).join('')}</div>` : '<p class="small muted">No other fixture this gameweek involves a team close enough to swap places with Spurs.</p>'}
    ${rest.length ? `<details class="rf-more"><summary class="small">Other fixtures this gameweek (${rest.length})</summary><div class="rf-list">${rest.map(row).join('')}</div></details>` : ''}
    <p class="source">${esc(r.label)} "Close enough" = within six points of Spurs.</p></section>`;
}
// League-wide leaders: goals, assists, yellow and red cards.
function leadersPanel(L) {
  if (!L) return '';
  const lists = ['goals', 'assists', 'yellows', 'reds'].map((k) => L[k]).filter(Boolean);
  if (!lists.length) return '';
  const card = (x) => `<div class="panel"><h3 style="margin-top:0">${esc(x.title)}</h3>${x.rows.length ? `<ol class="leaders">${x.rows.map((r) => `<li class="${r.teamId === state.meta.providerTeamIds?.fpl ? 'hl' : ''}"><span>${crest(r.teamId)}<strong>${esc(r.name)}</strong> <span class="faint tiny">${esc(r.team || '')}</span></span><span class="v">${r.value}</span></li>`).join('')}</ol>` : `<p class="small muted">${x.recorded ? 'None yet this season.' : 'Not available yet; appears after the next data refresh.'}</p>`}</div>`;
  return `<section class="section"><div class="section-head"><h2>Premier League leaders</h2><span class="muted small">All clubs · Spurs players highlighted</span></div>
    <div class="grid two">${lists.map(card).join('')}</div><p class="source">${esc(L.source)}. Ties with fifth place are included (up to eight players).</p></section>`;
}

// ---------------- Match Centre ----------------
VIEWS.match = async (id) => {
  const fx = await loadSeason('fixtures.json');
  if (!id) {
    const played = fx.fixtures.filter((f) => f.result || f.status === 'LIVE').reverse();
    const next = fx.fixtures.filter((f) => f.status === 'SCHEDULED' && !f.friendly).slice(0, 3);
    return `<h1>Match Centre</h1>${next.length ? `<div class="panel" style="padding:0;margin-bottom:16px">${next.map(fixtureRow).join('')}</div>` : ''}<h2>Played</h2><div class="panel" style="padding:0">${played.map(fixtureRow).join('') || '<div class="empty">No matches played yet.</div>'}</div>`;
  }
  const m = await loadSeason(`matches/${id}.json`, state.season, { optional: true });
  if (!m) return '<div class="empty">This match is not in the stored data for the selected season.</div>';
  const f = m.fixture; const d = m.detail; const adv = m.team?.adv;
  const L = f.home ? 'Spurs' : f.opponent; const R = f.home ? f.opponent : 'Spurs';
  const sc = f.score ? (f.home ? `${f.score.spurs}–${f.score.opp}` : `${f.score.opp}–${f.score.spurs}`) : esc(fmtTime(f.kickoff));
  const goals = (d?.shots || []).filter((s) => s.outcome === 'goal').sort((a, b) => a.minute - b.minute);
  const ev = (type) => f.events.filter((e) => e.type === type);
  const notes = postMatch(m);
  return `<section class="hero"><div class="kicker">${esc(f.competition)}${f.gameweek ? `, gameweek ${f.gameweek}` : ''} · ${esc(statusText[f.status] || f.status)}${f.resultNote ? ` · ${esc(f.resultNote)}` : ''}</div>
    <div class="fixture-board"><div class="team">${f.home ? spursCrest('big') : oc(f, 'big')}${esc(L)}</div><div class="mid"><div class="clock">${sc}</div><div class="vs">${esc(fmtDate(f.kickoff, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}, ${esc(fmtTime(f.kickoff))} Bahrain</div></div><div class="team right">${f.home ? oc(f, 'big') : spursCrest('big')}${esc(R)}</div></div>
    <div class="hero-meta"><span>${f.home ? 'Home' : 'Away'}${f.venueName ? ` · ${esc(f.venueName)}` : ''}</span>${f.kickoffHistory?.length ? `<span>Rescheduled (was ${esc(fmtDateTime(f.kickoffHistory[f.kickoffHistory.length - 1].was))})</span>` : ''}${f.verification ? `<span>Score ${f.verification.agrees ? 'confirmed' : 'differs'} by ${esc(f.verification.source)}</span>` : ''}</div></section>
    ${shareButtonHtml(m)}
  ${livePanel(m)}
  ${lineupsPanel(m)}
  ${m.preview ? scoutHtml(m.preview, f) : ''}
  <div class="grid two section" ${f.score ? '' : 'hidden'}>
    <div class="panel"><h2>Key events</h2>
      ${goals.length ? goals.map((g) => `<div class="statrow"><span>${g.team === 'spurs' ? '⚽ ' : ''}<strong>${esc(g.player || 'Unknown')}</strong> <span class="muted small">${g.team === 'spurs' ? `${spursCrest()}Spurs` : `${oc(f)}${esc(f.opponent)}`} · ${esc(SIT[g.situation] || g.situation || '')}</span></span><span class="v">${g.minute}'${g.added ? `+${g.added}` : ''}</span></div>`).join('') : ev('goal').map((e) => `<div class="statrow"><span><strong>${esc(e.player)}</strong> <span class="muted small">${e.team === 'spurs' ? 'Spurs' : esc(f.opponent)}</span></span><span class="v">${e.value > 1 ? `${e.value} goals` : 'Goal'}</span></div>`).join('') || '<p class="na">No goals.</p>'}
      ${ev('own_goal').map((e) => `<div class="statrow"><span>Own goal: ${esc(e.player)}</span><span></span></div>`).join('')}
      ${ev('assist').length ? `<p class="small muted" style="margin-top:10px">Assists: ${ev('assist').map((e) => `${esc(e.player)}${e.team === 'opp' ? ` (${esc(f.opponent)})` : ''}`).join(', ')}</p>` : ''}
      ${ev('yellow').length || ev('red').length ? `<p class="small muted">Cards: ${[...ev('yellow').map((e) => `🟨 ${esc(e.player)}`), ...ev('red').map((e) => `🟥 ${esc(e.player)}`)].join(', ')}</p>` : ''}
      <p class="source">Goal minutes and situations from shot data (FPL Core Insights); scorers, assists and cards from the FPL API. Substitution times are not in the free data.</p></div>
    <div class="panel"><h2>Team statistics</h2>${adv ? pairBars([
      { label: 'xG', a: adv.spurs.xg, b: adv.opp.xg, dp: 2 }, { label: 'Possession', a: adv.spurs.possession, b: adv.opp.possession, unit: '%' }, { label: 'Shots', a: adv.spurs.shots, b: adv.opp.shots },
      { label: 'On target', a: adv.spurs.sot, b: adv.opp.sot }, { label: 'Big chances', a: adv.spurs.bigChances, b: adv.opp.bigChances }, { label: 'Passes', a: adv.spurs.passes, b: adv.opp.passes },
      { label: 'Pass accuracy', a: adv.spurs.passPct, b: adv.opp.passPct, unit: '%' }, { label: 'Successful take-ons', a: adv.spurs.dribbles, b: adv.opp.dribbles }, { label: 'Tackles won', a: adv.spurs.tacklesWon, b: adv.opp.tacklesWon }, { label: 'Corners', a: adv.spurs.corners, b: adv.opp.corners },
    ], { right: f.opponent }) + `<p class="source">FotMob match statistics via FPL Core Insights (xG here is FotMob's; the season figures use FPL/Opta xG).</p>` : m.team && m.team.xg !== null ? `<div class="statlist"><div class="statrow"><span>Spurs xG (FPL)</span><span class="v">${fmtPlain(m.team.xg, 2)}</span></div><div class="statrow"><span>xG against (est.)</span><span class="v">${fmtPlain(m.team.xga, 2)}</span></div></div>` : '<p class="na">Team statistics are not available for this match.</p>'}</div>
  </div>
  ${notes.length ? `<div class="panel section"><div class="section-head"><h2>Post-match notes</h2><span class="label-analysis">Calculated analysis</span></div>${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}

  ${d?.fotmobUrl ? `<div class="banner info section">Player heat maps, average positions and pass maps for this match are not in the free data. FotMob shows them on its own match page: <a href="${esc(d.fotmobUrl)}" target="_blank" rel="noopener">open this match on FotMob</a>.</div>` : ''}
  ${d && (d.xgRace?.length || d.momentum?.length) ? `<div class="grid two section"><div class="panel"><h2>xG race</h2>${xgRace(d.xgRace, { opp: f.opponent })}<p class="source">Cumulative xG by minute (FotMob).</p></div><div class="panel"><h2>Momentum</h2>${momentumChart(d.momentum, { opp: f.opponent })}<p class="source">FotMob attacking-momentum index per minute.</p></div></div>` : ''}
  ${d?.shots?.length ? `<div class="grid two section"><div class="panel"><h2>${spursCrest()}Spurs shots</h2>${shotMap(d.shots.filter((s) => s.team === 'spurs'), { matchXg: m.team?.adv?.spurs?.xg })}</div><div class="panel"><h2>${oc(f)}${esc(f.opponent)} shots</h2>${shotMap(d.shots.filter((s) => s.team === 'opp'), { matchXg: m.team?.adv?.opp?.xg })}</div></div>` : ''}
  ${replayHtml(m)}
  <div class="panel section" ${f.score || m.lineup.length ? '' : 'hidden'}><div class="section-head"><h2>Spurs players</h2>${m.lineup.length ? `<div class="tabs" role="group" aria-label="Statistic group">${Object.keys(MATCH_TABS).map((t, i) => `<button data-mtab="${t}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>` : ''}</div>
    <div id="m-lineup">${m.lineup.length ? lineupTable(m.lineup, 'Attacking') : '<p class="na">Player statistics are not available for this match yet.</p>'}</div>
    ${m.statsComplete === false && f.status !== 'SCHEDULED' ? '<p class="small" style="color:var(--warn)">Statistics may still be incomplete; the site re-checks automatically after each match.</p>' : ''}</div>
  ${m.videos?.length ? `<div class="panel section"><h2>Video</h2><div class="grid three">${m.videos.map((v) => `<div class="video-card"><a href="${esc(v.url)}" target="_blank" rel="noopener"><img loading="lazy" alt="" src="${esc(v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`)}" style="width:100%;border-radius:8px"></a><span class="vcat c-${esc(v.category || 'highlights')}">${esc(v.categoryLabel || 'Video')}</span><span class="small">${esc(v.title)}</span><span class="small faint">${esc(v.channel)}</span></div>`).join('')}</div><p class="source">Linked by opponent name and publication date. <a href="#/video">More Spurs analysis in the Video Evidence Room →</a></p></div>` : ''}
  <p class="source">Sources: ${esc(m.source)}${d ? '; FPL Core Insights (FotMob match data)' : ''}. Built ${esc(fmtDateTime(m.generatedAt))} Bahrain.</p>`;
};
const MATCH_TABS = {
  Attacking: [['minutes', 'Min'], ['goals', 'G'], ['assists', 'A'], ['xg', 'xG', 2], ['xa', 'xA', 2], ['shots', 'Shots'], ['sot', 'On target'], ['xgot', 'xGOT', 2], ['chancesCreated', 'Chances'], ['touchesBox', 'Box touches'], ['wasFouled', 'Fouled'], ['dispossessed', 'Dispossessed']],
  Passing: [['minutes', 'Min'], ['touches', 'Touches'], ['passesAcc', 'Acc. passes'], ['passesAtt', 'Attempted'], ['finalThirdPasses', 'Final third'], ['crossesAcc', 'Acc. crosses'], ['longBallsAcc', 'Acc. long balls'], ['chancesCreated', 'Chances']],
  Defending: [['minutes', 'Min'], ['tacklesWon', 'Tackles won'], ['interceptions', 'Interceptions'], ['blocks', 'Blocks'], ['clearances', 'Clearances'], ['recoveries', 'Recoveries'], ['duelsWon', 'Duels won'], ['duelsLost', 'Duels lost'], ['aerialWon', 'Aerials won'], ['dribbledPast', 'Dribbled past'], ['foulsCommitted', 'Fouls']],
  Goalkeeping: [['minutes', 'Min'], ['saves', 'Saves (FPL)'], ['gkSaves', 'Saves (FotMob)'], ['savesInBox', 'Saves in box'], ['xgotFaced', 'xGOT faced', 2], ['goalsPrevented', 'Goals prevented', 2], ['highClaims', 'High claims'], ['sweeperActions', 'Sweeper actions'], ['gc', 'Conceded']],
  FPL: [['minutes', 'Min'], ['points', 'Points'], ['bonus', 'Bonus'], ['bps', 'BPS'], ['influence', 'Influence', 1], ['creativity', 'Creativity', 1], ['threat', 'Threat', 1], ['defcon', 'Def. contribution']],
};
function lineupTable(lineup, tab) {
  const cols = MATCH_TABS[tab];
  const rows = tab === 'Goalkeeping' ? lineup.filter((l) => l.pos === 'GK') : lineup;
  return `<div class="table-wrap"><table data-sortable class="stack"><thead><tr><th class="sortable sticky-col">Player</th><th class="sortable">Role</th>${cols.map(([, l]) => `<th class="sortable r">${l}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((l) => `<tr><td class="sticky-col" data-v="${esc(l.name)}" data-label="Player"><a href="#/player/${l.playerId}">${esc(l.name)}</a> <span class="faint tiny">${esc(l.pos || '')}</span></td><td data-label="Role">${{ starter: 'Started', sub: 'Sub', unknown: '—' }[l.role]}</td>${cols.map(([k, lab, dp]) => `<td class="r" data-v="${l[k] ?? ''}" data-label="${esc(lab)}">${fmt(l[k], dp || 0)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
AFTER.match = async (id) => {
  clearTimeout(window.__liveT);
  if (!id) return;
  const m = await loadSeason(`matches/${id}.json`, state.season, { optional: true });
  if (m) { bindReplay(m); bindShare(m); }
  // During a match, reload this page's data every minute (the site itself updates about every 5).
  if (m && inLiveWindow(m.fixture)) {
    const hash = location.hash;
    window.__liveT = setTimeout(async () => {
      if (location.hash !== hash) return;
      try { await Promise.all([loadSeason(`matches/${id}.json`, state.season, { fresh: true, optional: true }), loadSeason('fixtures.json', state.season, { fresh: true })]); } catch { /* keep current view */ }
      if (location.hash === hash) route();
    }, 60000);
  }
  if (!m || !m.lineup.length) return;
  document.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-mtab]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    const box = document.getElementById('m-lineup'); box.innerHTML = lineupTable(m.lineup, b.dataset.mtab); sortableTable(box.querySelector('table'));
  }));
};

const inLiveWindow = (f) => { if (!f?.kickoff || f.friendly) return false; const t = (Date.now() - Date.parse(f.kickoff)) / 60000; return t >= -5 && t <= 155; };
// Live in-game statistics (API-Football) and per-player figures (FPL live).
function livePanel(m) {
  const lv = m.live; const f = m.fixture;
  const windowOpen = inLiveWindow(f);
  if (!lv && !windowOpen) return '';
  if (!lv) return `<div class="banner info section">${state.status?.sources?.['api-football']?.disabled ? 'Live statistics appear here during the match once the free API-Football key is added.' : 'Live statistics will appear here a few minutes after kick-off. This page refreshes itself every minute.'}</div>`;
  const st = lv.stats;
  const min = lv.minute !== null && lv.minute !== undefined ? `${lv.minute}${lv.extra ? `+${lv.extra}` : ''}′` : '';
  const head = `<div class="section-head"><h2>${lv.isLive ? '<span class="live-pill">LIVE</span> ' : ''}Match stats${min && lv.isLive ? ` · ${min}` : lv.isLive ? '' : ' (final live feed)'}</h2>${lv.score ? `<span class="big-score">${f.home ? `Spurs ${lv.score.spurs}–${lv.score.opp} ${esc(f.opponent)}` : `${esc(f.opponent)} ${lv.score.opp}–${lv.score.spurs} Spurs`}</span>` : ''}</div>`;
  const bars = st ? pairBars([
    { label: 'Shots', a: st.spurs.shots, b: st.opp.shots }, { label: 'On target', a: st.spurs.sot, b: st.opp.sot },
    { label: 'Possession', a: st.spurs.possession, b: st.opp.possession, unit: '%' }, { label: 'Corners', a: st.spurs.corners, b: st.opp.corners },
    { label: 'Fouls', a: st.spurs.fouls, b: st.opp.fouls }, { label: 'Yellow cards', a: st.spurs.yc, b: st.opp.yc }, { label: 'Red cards', a: st.spurs.rc, b: st.opp.rc },
    ...(st.spurs.saves !== undefined ? [{ label: 'Saves', a: st.spurs.saves, b: st.opp.saves }] : []), ...(st.spurs.xg !== undefined && st.spurs.xg !== null ? [{ label: 'xG', a: st.spurs.xg, b: st.opp.xg, dp: 2 }] : []),
  ], { right: f.opponent }) : `<p class="small muted">${lv.planBlocked ? 'Team statistics are not available on the free API-Football plan for this match.' : 'Team statistics are waiting for the first update from the provider.'}</p>`;
  const evs = (lv.events || []).filter((e) => ['Goal', 'Card'].includes(e.type));
  const evHtml = evs.length ? `<div class="statlist" style="margin-top:10px">${evs.map((e) => `<div class="statrow"><span>${e.type === 'Goal' ? '⚽' : /red/i.test(e.detail) ? '🟥' : '🟨'} <strong>${esc(e.player || 'Unknown')}</strong> <span class="muted small">${e.team === 'spurs' ? 'Spurs' : esc(f.opponent)}${e.type === 'Goal' && e.detail && e.detail !== 'Normal Goal' ? ` · ${esc(e.detail)}` : ''}</span></span><span class="v">${e.minute ?? ''}${e.extra ? `+${e.extra}` : ''}′</span></div>`).join('')}</div>` : '';
  const pl = lv.players || [];
  const plHtml = pl.length ? `<div class="table-wrap" style="margin-top:12px"><table class="live-pl"><thead><tr><th>Spurs player</th><th class="r">Min</th><th class="r">G</th><th class="r">A</th><th class="r">Tkl</th><th class="r">CBI</th><th class="r">Rec</th><th></th></tr></thead><tbody>${pl.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${p.minutes}</td><td class="r">${p.goals || ''}</td><td class="r">${p.assists || ''}</td><td class="r">${fmt(p.tackles)}</td><td class="r">${fmt(p.cbi)}</td><td class="r">${fmt(p.recoveries)}</td><td>${p.yc ? '🟨' : ''}${p.rc ? '🟥' : ''}</td></tr>`).join('')}</tbody></table></div><p class="tiny faint" style="margin:4px 0 0">G goals · A assists · Tkl tackles · CBI clearances, blocks &amp; interceptions · Rec recoveries.</p>` : '';
  return `<section class="panel section live-panel">${head}${bars}${evHtml}${plHtml}
    <p class="source">${st ? `Team stats: ${esc(lv.source.stats)}` : ''}${st && pl.length ? '; ' : ''}${pl.length ? `players: ${esc(lv.source.players)}` : ''}. Last update ${esc(fmtTime(lv.retrievedAt || lv.playersAt))} Bahrain${lv.isLive ? ' · the site updates about every 5 minutes during the match and this page reloads itself every minute' : ''}.</p></section>`;
}

// Pressing (PPDA estimate), territory and counter-attacks, season and match by match.
function pressTransitionsHtml(team, adv) {
  const ms = (team.matches || []).filter((m) => m.adv);
  const r = team.leagueRanks?.metrics || {};
  const c = adv.counters;
  const per = (x) => (c && c.n ? fmtPlain(x / c.n, 2) : '—');
  const rk = (k) => (r[k] ? `<span class="rk-chip">${ordinal(r[k].rank)} of ${r[k].of}</span>` : '');
  const tiles = `<div class="grid three" style="margin-bottom:12px">
    <div class="panel stat-tile"><span class="lbl">PPDA (est.)</span><span class="big">${fmt(adv.perMatch.ppda?.value, 1)}</span><span class="small muted">${rk('ppda')} League avg ${fmtPlain(r.ppda?.leagueAvg, 1)}. Lower = Spurs press harder.</span></div>
    <div class="panel stat-tile"><span class="lbl">Opponents' PPDA v Spurs</span><span class="big">${fmt(adv.perMatch.oppPpda?.value, 1)}</span><span class="small muted">Lower = opponents press Spurs harder.</span></div>
    <div class="panel stat-tile"><span class="lbl">Field tilt</span><span class="big">${fmt(adv.perMatch.fieldTilt?.value, 1, { unit: '%' })}</span><span class="small muted">${rk('fieldTilt')} Share of passing in the opposition half.</span></div>
  </div>`;
  const counters = c ? `<div class="panel"><h3 style="margin-top:0">Counter-attacks (fast breaks)</h3><div class="statlist">
    <div class="statrow"><span>Shots conceded on the break</span><span class="v">${c.against.shots}<small>${per(c.against.shots)}/match</small></span></div>
    <div class="statrow"><span>xG conceded on the break</span><span class="v">${fmtPlain(c.against.xg, 2)}<small>${per(c.against.xg)}/match</small></span></div>
    <div class="statrow"><span>Goals conceded on the break</span><span class="v">${c.against.goals}</span></div>
    <div class="statrow"><span>Spurs shots on the break</span><span class="v">${c.for.shots}<small>${per(c.for.shots)}/match</small></span></div>
    <div class="statrow"><span>Spurs xG on the break</span><span class="v">${fmtPlain(c.for.xg, 2)}</span></div>
    <div class="statrow"><span>Spurs goals on the break</span><span class="v">${c.for.goals}</span></div></div>
    <p class="source">Shots the source tags as fast breaks, over ${c.n} PL matches. A counter that ends without a shot is not counted.</p></div>` : '';
  const chart = ms.length > 1 ? `<div class="panel"><h3 style="margin-top:0">Match by match</h3>${lineChart({ labels: ms.map((m) => m.opponentShort || m.opponent.slice(0, 3)), series: [{ name: 'PPDA (est.)', color: 'var(--cyan)', values: ms.map((m) => m.adv.ppda ?? null) }, { name: 'Shots conceded on the break', color: 'var(--loss)', values: ms.map((m) => m.adv.counters?.against.shots ?? null) }], height: 200, format: (v) => v.toFixed(1), points: matchPoints(ms), title: 'Pressing and counters conceded', badges: ms.map(badgeOf) })}</div>` : '';
  return `<section class="section"><div class="section-head"><h2>Pressing &amp; transitions</h2><span class="label-analysis">Estimates</span></div>${tiles}<div class="grid two">${counters}${chart}</div>
    <p class="source">PPDA (passes per defensive action) estimate = opponent passes in their own half ÷ Spurs tackles won, interceptions and fouls, across the whole pitch (the standard version counts only actions in the opponent's 60% of the pitch, which needs paid location data). FotMob match data via FPL Core Insights.</p></section>`;
}

// Confirmed starting XIs (ESPN feed), with who is missing from each side's usual team.
function lineupsPanel(m) {
  const lu = m.lineups; if (!lu?.spurs?.starters) return '';
  const f = m.fixture;
  const col = (name, side) => `<div><h3 style="margin-top:0">${name === 'Spurs' ? spursCrest() : oc(f)}${esc(name)} <span class="muted small">${esc(side.formation || '')}</span></h3>
    <ol class="lu-list">${side.starters.map((p) => `<li><span class="mg-pos ${({ G: 'GK', GK: 'GK', D: 'DEF', CB: 'DEF', LB: 'DEF', RB: 'DEF', M: 'MID', DM: 'MID', CM: 'MID', AM: 'MID', F: 'FWD', FW: 'FWD', ST: 'FWD', LW: 'FWD', RW: 'FWD' })[p.pos] || ''}">${esc(p.pos || '')}</span>${esc(p.name)}${p.usual === false && p.matched ? ' <span class="tiny" style="color:var(--warn)">rotated in</span>' : ''}</li>`).join('')}</ol>
    ${side.effect?.missingUsual?.length ? `<p class="tiny faint" style="margin:6px 0 0">Not starting from the usual XI: ${esc(side.effect.missingUsual.join(', '))}</p>` : ''}</div>`;
  return `<section class="panel section"><div class="section-head"><h2>Confirmed line-ups</h2><span class="label-analysis">✓ Forecasts updated</span></div>
    <div class="grid two">${col('Spurs', lu.spurs)}${lu.opp ? col(f.opponent, lu.opp) : ''}</div>
    <p class="source">Starting XIs from ESPN's match feed, retrieved ${esc(fmtTime(lu.retrievedAt))} Bahrain. Forecasts, the Season forecast and the Matchday Simulator now use these teams.</p></section>`;
}

function forecastHtml(fc) {
  const bar = `<div style="display:flex;height:14px;border-radius:7px;overflow:hidden;margin:10px 0 6px"><div style="width:${fc.win}%;background:var(--win)"></div><div style="width:${fc.draw}%;background:var(--draw)"></div><div style="width:${fc.loss}%;background:var(--loss)"></div></div>`;
  return `<div class="panel section"><div class="section-head"><h3>${fc.lineupsConfirmed ? 'Final forecast' : 'Match forecast'}</h3><span class="label-analysis">${fc.lineupsConfirmed ? '✓ Line-ups confirmed' : 'Early forecast · updates when line-ups are confirmed'}</span></div>
    ${fc.lineupsConfirmed && fc.early ? `<p class="small" style="margin:0 0 6px">Before line-ups: Spurs win ${fc.early.win}% · draw ${fc.early.draw}% · lose ${fc.early.loss}% → now <strong>${fc.win}% · ${fc.draw}% · ${fc.loss}%</strong></p>` : ''}
    <div class="rank-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:8px"><div class="rank-tile" style="padding:12px"><div class="val" style="color:var(--win);font-size:1.5rem">${fc.win}%</div><div class="lbl">Spurs win</div></div><div class="rank-tile" style="padding:12px"><div class="val" style="color:var(--draw);font-size:1.5rem">${fc.draw}%</div><div class="lbl">Draw</div></div><div class="rank-tile" style="padding:12px"><div class="val" style="color:var(--loss);font-size:1.5rem">${fc.loss}%</div><div class="lbl">${esc(fc.opponent)} win</div></div></div>${bar}
    <p class="small muted">Expected goals: Spurs ${fc.expectedGoals.spurs} – ${fc.expectedGoals.opp} ${esc(fc.opponent)}. Most likely scores: ${fc.likelyScores.slice(0, 3).map((x) => `${x.spurs}–${x.opp} (${x.p}%)`).join(', ')}.</p>
    <p class="tiny faint">From a simple model of both teams' chance creation and concession this season. Not betting odds. <a href="#/simulator">How it works</a></p></div>`;
}

function scoutHtml(p, f) {
  const kindColor = { opportunity: 'var(--win)', threat: 'var(--loss)', watch: 'var(--draw)' };
  const kindLabel = { opportunity: 'Opportunity', threat: 'Threat', watch: 'Watch' };
  const t = p.table;
  const plist = (rows, cols) => rows.length ? rows.map((r) => `<div class="statrow"><span><strong>${esc(r.name)}</strong> <span class="faint tiny">${esc(r.pos || '')}</span></span><span class="small">${cols(r)}</span></div>`).join('') : '<p class="na small">None stand out yet.</p>';
  return `<section class="section"><div class="section-head"><h2>${crestOf(p.opponent, p.teamId)}Scouting ${esc(p.opponent)}</h2><span class="label-analysis">Next match · refreshed every update</span></div>
  <div class="rank-grid">
    ${t ? `<div class="rank-tile"><div class="val">${ordinal(t.position)}</div><div class="lbl">League position</div><div class="ctx">${t.points} pts from ${t.played} · ${t.won}W ${t.drawn}D ${t.lost}L · GD ${t.gd > 0 ? '+' : ''}${t.gd}${p.spursTable ? ` · Spurs ${ordinal(p.spursTable.position)}` : ''}</div></div>` : ''}
    <div class="rank-tile"><div class="val">${p.venue.w}-${p.venue.d}-${p.venue.l}</div><div class="lbl">${esc(p.venue.label)}</div><div class="ctx">${p.venue.n} matches · scored ${p.venue.gf}, conceded ${p.venue.ga}</div></div>
    <div class="rank-tile"><div class="val">${p.overall.gf}–${p.overall.ga}</div><div class="lbl">Goals for and against</div><div class="ctx">${p.overall.n} league matches this season</div></div>
  </div>
  ${p.forecast ? forecastHtml(p.forecast) : ''}
  ${p.form.length ? `<div class="panel section"><h3>Recent form</h3><div class="form-strip" style="margin-bottom:10px">${p.form.map((g) => resultChip(g.result)).join('')}</div>${p.form.slice().reverse().map((g) => `<div class="statrow"><span>${esc(fmtDate(g.kickoff, { day: 'numeric', month: 'short' }))} · ${g.home ? 'v' : '@'} ${crestOf(g.opponent, g.opponentTeamId)}${esc(g.opponent)}</span><span class="v">${g.gf}–${g.ga}</span></div>`).join('')}</div>` : ''}
  ${p.tags.length ? `<div class="chips section">${p.tags.map((x) => `<span class="pill" style="color:#bff6ff;border-color:rgba(60,232,255,.4)">${esc(x)}</span>`).join('')}</div>` : ''}
  <div class="grid three section">
    <div class="panel" style="border-color:rgba(239,95,116,.45)"><h3 style="color:var(--loss)">What to worry about</h3>${p.worries?.length ? p.worries.map((w) => `<p style="margin-bottom:6px">${esc(w.text)}</p>${w.evidence ? `<p class="tiny faint" style="margin-top:0">${esc(w.evidence)}</p>` : ''}`).join('') : '<p class="small muted">No clear danger signs in the numbers.</p>'}</div>
    <div class="panel" style="border-color:rgba(60,207,145,.45)"><h3 style="color:var(--win)">Where Spurs have the edge</h3>${p.edges?.length ? p.edges.map((w) => `<p style="margin-bottom:6px">${esc(w.text)}</p>${w.evidence ? `<p class="tiny faint" style="margin-top:0">${esc(w.evidence)}</p>` : ''}`).join('') : '<p class="small muted">No clear statistical edge.</p>'}</div>
    <div class="panel" style="border-color:rgba(60,232,255,.45)"><h3 style="color:var(--cyan)">How Spurs should approach it</h3>${p.plan?.length ? `<ul style="padding-left:18px;margin:0">${p.plan.map((x) => `<li style="margin-bottom:8px">${esc(x)}</li>`).join('')}</ul>` : '<p class="small muted">Not enough data for a suggested approach yet.</p>'}</div>
  </div>
  <p class="tiny faint">${esc(p.label)}</p>
  ${p.profile.length ? `<div class="panel section"><h3>How they play</h3><div class="table-wrap"><table><thead><tr><th>Per match</th><th class="r">${crestOf(p.opponent, p.teamId)}${esc(p.short || p.opponent)}</th><th class="r">Rank</th><th class="r">Spurs</th><th class="r">League avg</th></tr></thead><tbody>
    ${p.profile.map((r) => `<tr><td style="white-space:normal">${esc(r.label)}</td><td class="r"><strong>${fmtPlain(r.value, r.unit === '%' ? 1 : 2)}${r.unit}</strong></td><td class="r ${r.rank <= 5 ? '' : ''}" style="color:${r.rank <= 5 ? 'var(--win)' : r.rank >= 16 ? 'var(--loss)' : 'inherit'}">${r.rank ? `${ordinal(r.rank)}` : '—'}</td><td class="r">${r.spurs === null ? '—' : `${fmtPlain(r.spurs, r.unit === '%' ? 1 : 2)}${r.unit}`}</td><td class="r faint">${r.leagueAvg === null ? '—' : `${fmtPlain(r.leagueAvg, r.unit === '%' ? 1 : 2)}${r.unit}`}</td></tr>`).join('')}</tbody></table></div>
    <p class="source">Averages over ${p.profileMatches} league matches. Rank 1st = best in that measure (for "conceded" rows, 1st = conceded least).</p></div>` : '<div class="banner info section">Detailed style numbers for this opponent are not available yet.</div>'}
  <div class="grid two section">
    <div class="panel"><h3>Danger men (xG + xA)</h3>${plist(p.dangerMen, (r) => `${r.goals} G · ${r.assists} A · <strong class="num">${fmtPlain(r.xg + r.xa, 2)}</strong> xG+xA`)}
      <h3 style="margin-top:14px">Top scorers</h3>${plist(p.topScorers, (r) => `<strong class="num">${r.goals}</strong> goals · ${r.minutes} min`)}
      <h3 style="margin-top:14px">Chief creators (xA)</h3>${plist(p.creators, (r) => `<strong class="num">${fmtPlain(r.xa, 2)}</strong> xA · ${r.assists} assists`)}</div>
    <div class="panel"><h3>Team news</h3>${p.news.length ? p.news.map((n) => `<div class="statrow"><span><strong>${esc(n.name)}</strong> <span class="faint tiny">${esc(n.pos || '')}</span></span><span class="small" style="text-align:right;color:var(--warn)">${esc(n.status)}${n.chance !== null ? ` (${n.chance}%)` : ''}${n.news ? `<br><span class="muted">${esc(n.news)}</span>` : ''}</span></div>`).join('') : '<p class="small muted">No injuries or suspensions flagged for regular players.</p>'}
      ${p.keeper ? `<h3 style="margin-top:14px">Goalkeeper</h3><div class="statrow"><span><strong>${esc(p.keeper.name)}</strong></span><span class="small">${p.keeper.saves} saves · ${p.keeper.cs} clean sheets · ${p.keeper.gc} conceded</span></div>` : ''}
      <p class="source">Availability from the Premier League's official player status.</p></div>
  </div>
  <p class="source">Sources: ${esc(p.sources.join('; '))}.</p></section>`;
}

function postMatch(m) {
  const out = []; const f = m.fixture; const t = m.team; const adv = t?.adv;
  if (!f.score) return out;
  if (t && t.xg !== null && t.xga !== null) {
    const d = t.xg - t.xga;
    out.push(`Spurs produced ${t.xg.toFixed(2)} xG and allowed ${t.xga.toFixed(2)} (FPL/Opta). On chance quality the match ${Math.abs(d) < 0.3 ? 'was even' : d > 0 ? 'favoured Spurs' : `favoured ${f.opponent}`}; the result was ${{ W: 'a win', D: 'a draw', L: 'a defeat' }[f.result]}.`);
  }
  if (adv?.spurs?.possession !== null && adv?.spurs?.shots !== null) out.push(`Spurs had ${adv.spurs.possession}% of the ball and ${adv.spurs.shots} shots (${adv.spurs.sot ?? '—'} on target) to ${adv.opp.shots} (${adv.opp.sot ?? '—'}).`);
  const best = [...m.lineup].filter((l) => l.xg !== null).sort((a, b) => (b.xg + (b.xa || 0)) - (a.xg + (a.xa || 0)))[0];
  if (best && best.xg + (best.xa || 0) > 0.2) out.push(`${best.name} was the main source of chance quality (${best.xg.toFixed(2)} xG, ${(best.xa || 0).toFixed(2)} xA).`);
  return out;
}

// ---------------- Match breakdown ----------------
VIEWS.breakdown = async (id) => {
  const fx = await loadSeason('fixtures.json');
  const played = fx.fixtures.filter((f) => f.result).reverse();
  if (!played.length) return '<h1>Match breakdown</h1><div class="empty">No matches played yet this season.</div>';
  const competitive = played.filter((f) => !f.friendly);
  const cur = played.find((f) => f.id === id) || competitive[0] || played[0];
  const m = await loadSeason(`matches/${cur.id}.json`, state.season, { optional: true });
  const b = m?.breakdown;
  const idx = played.indexOf(cur);
  const sel = matchPicker(played, cur.id, 'breakdown');
  if (!m || !b) return `<h1>Match breakdown</h1>${sel}<div class="empty">No breakdown is available for this match yet.</div>`;
  const f = m.fixture; const d = m.detail;
  const L = f.home ? 'Spurs' : f.opponent; const R = f.home ? f.opponent : 'Spurs';
  const sc = f.home ? `${f.score.spurs}–${f.score.opp}` : `${f.score.opp}–${f.score.spurs}`;
  const dlt = (v, avg, lower) => { if (v === null || v === undefined || avg === null || avg === undefined) return ''; const up = v > avg * 1.1; const dn = v < avg * 0.9; if (!up && !dn) return '<span class="faint">≈</span>'; const good = lower ? dn : up; return `<span style="color:${good ? 'var(--win)' : 'var(--loss)'}">${up ? '▲' : '▼'}</span>`; };
  return `<div class="section-head"><h1>Match breakdown</h1><span class="label-analysis">Automatic, after every match</span></div>${sel}
  <section class="hero"><div class="kicker">${esc(f.competition)}${f.gameweek ? `, gameweek ${f.gameweek}` : ''} · ${esc(fmtDate(f.kickoff, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
    <div class="fixture-board"><div class="team">${f.home ? spursCrest('big') : oc(f, 'big')}${esc(L)}</div><div class="mid"><div class="clock">${sc}</div><div class="vs">${{ W: 'Spurs win', D: 'Draw', L: 'Spurs defeat' }[f.result]}</div></div><div class="team right">${f.home ? oc(f, 'big') : spursCrest('big')}${esc(R)}</div></div>
    ${b.verdict ? `<div class="hero-meta"><span>xG <strong>${fmtPlain(b.verdict.xgFor, 2)}</strong> v <strong>${fmtPlain(b.verdict.xgAgainst, 2)}</strong></span>${b.momentumShare !== undefined && b.momentumShare !== null ? `<span>Spurs on top for <strong>${b.momentumShare}%</strong> of the match</span>` : ''}</div><p style="margin:10px 0 0;color:#dfe9ff">${esc(b.verdict.text)}</p>` : ''}
    ${b.styleTags.length ? `<div class="chips" style="margin-top:12px">${b.styleTags.map((t) => `<span class="pill" style="color:#bff6ff;border-color:rgba(60,232,255,.4)">${esc(t)}</span>`).join('')}</div>` : ''}</section>

  ${m.forecast && m.forecast.result ? `<div class="banner info section">Pre-match forecast: Spurs win ${m.forecast.win}%, draw ${m.forecast.draw}%, ${esc(f.opponent)} win ${m.forecast.loss}%. The ${({ W: 'win', D: 'draw', L: 'defeat' })[m.forecast.result]} had a ${m.forecast.probOfResult}% chance. <a href="#/simulator">Season forecast</a></div>` : ''}
  <div class="grid two section">
    <div class="panel"><h2>Key moments</h2>${b.moments.length ? `<div class="timeline">${b.moments.map((x) => `<div class="tl-row ${x.side}"><span class="tl-min">${esc(x.label)}</span><span class="tl-dot ${x.kind}"></span><span>${esc(x.text)}<span class="faint small"> · ${x.side === 'spurs' ? 'Spurs' : esc(f.opponent)}</span></span></div>`).join('')}</div>` : '<p class="na">No goals or big chances recorded with minutes.</p>'}
      ${b.spells.length ? `<h3 style="margin-top:16px">Spells on top</h3><div class="chips">${b.spells.map((x) => `<span class="pill" style="border-color:${x.side === 'spurs' ? 'var(--cyan)' : 'var(--loss)'}">${esc(x.text)}</span>`).join('')}</div>` : ''}
      <p class="source">Minutes from shot data and FotMob's momentum index. Cards and substitutions have no times in the free data.</p></div>
    <div class="panel"><h2>How Spurs played</h2>${b.howSpursPlayed.map((t) => `<p>${esc(t)}</p>`).join('')}<p class="tiny faint">${esc(b.label)}</p></div>
  </div>

  ${d && (d.xgRace?.length || d.momentum?.length) ? `<div class="grid two section"><div class="panel"><h2>xG race</h2>${xgRace(d.xgRace, { opp: f.opponent })}</div><div class="panel"><h2>Momentum</h2>${momentumChart(d.momentum, { opp: f.opponent })}</div></div>` : ''}

  ${b.style.length ? `<div class="panel section"><h2>Style of play</h2><div class="table-wrap"><table><thead><tr><th>Measure</th><th class="r">This match</th><th class="r">Spurs season avg</th><th class="r">League avg</th></tr></thead><tbody>
    ${b.style.map((r) => `<tr><td style="white-space:normal">${esc(r.label)}</td><td class="r"><strong>${r.value === null ? '<span class="na">—</span>' : `${r.value}${r.unit}`}</strong></td><td class="r">${r.seasonAvg === null ? '<span class="na">—</span>' : `${fmtPlain(r.seasonAvg, 1)}${r.unit}`}</td><td class="r">${r.leagueAvg === null ? '<span class="na">—</span>' : `${fmtPlain(r.leagueAvg, 1)}${r.unit}`}</td></tr>`).join('')}</tbody></table></div></div>` : ''}

  ${b.comparison.length ? `<div class="grid two section"><div class="panel"><h2>Team stats</h2><div class="table-wrap"><table><thead><tr><th>Stat</th><th class="r">${spursCrest()}Spurs</th><th class="r">${oc(f)}${esc(f.opponent)}</th><th class="r">Spurs usual</th><th></th></tr></thead><tbody>
    ${b.comparison.map((r) => `<tr><td class="wrap">${esc(r.label)}</td><td class="r"><strong>${fmt(r.spurs, r.dp)}</strong></td><td class="r">${fmt(r.opp, r.dp)}</td><td class="r faint">${r.seasonAvg === null ? '' : fmtPlain(r.seasonAvg, Math.max(1, r.dp))}</td><td>${dlt(r.spurs, r.seasonAvg, r.lowerBetter)}</td></tr>`).join('')}</tbody></table></div><p class="source">▲▼ = at least 10% above or below Spurs' average this season (green is better).</p></div>
    <div class="panel"><h2>By half</h2>${b.halves ? `<div class="table-wrap"><table><thead><tr><th></th><th class="r">Goals</th><th class="r">Shots</th><th class="r">xG</th></tr></thead><tbody>
      <tr><td>1st half, Spurs</td><td class="r">${b.halves.first.gf}</td><td class="r">${b.halves.first.shotsF}</td><td class="r">${fmtPlain(b.halves.first.xgf, 2)}</td></tr><tr><td>1st half, ${esc(f.opponent)}</td><td class="r">${b.halves.first.ga}</td><td class="r">${b.halves.first.shotsA}</td><td class="r">${fmtPlain(b.halves.first.xga, 2)}</td></tr>
      <tr><td>2nd half, Spurs</td><td class="r">${b.halves.second.gf}</td><td class="r">${b.halves.second.shotsF}</td><td class="r">${fmtPlain(b.halves.second.xgf, 2)}</td></tr><tr><td>2nd half, ${esc(f.opponent)}</td><td class="r">${b.halves.second.ga}</td><td class="r">${b.halves.second.shotsA}</td><td class="r">${fmtPlain(b.halves.second.xga, 2)}</td></tr></tbody></table></div>` : '<p class="na">No shot data.</p>'}
      <h2 style="margin-top:18px">Standouts</h2>${b.standouts.map((x) => `<div class="statrow"><span>${esc(x.label)}</span><span><a href="#/player/${x.playerId}">${esc(x.name)}</a> <strong class="num">${esc(x.value)}</strong></span></div>`).join('') || '<p class="na">—</p>'}</div></div>` : ''}

  ${d?.shots?.length ? `<div class="grid two section"><div class="panel"><h2>${spursCrest()}Spurs shots</h2>${shotMap(d.shots.filter((x) => x.team === 'spurs'), { matchXg: m.team?.adv?.spurs?.xg })}</div><div class="panel"><h2>${oc(f)}${esc(f.opponent)} shots</h2>${shotMap(d.shots.filter((x) => x.team === 'opp'), { matchXg: m.team?.adv?.opp?.xg })}</div></div>` : ''}

  <section class="section"><div class="section-head"><h2>Every Spurs player</h2><span class="muted small">Starters first</span></div>
    <div class="grid three">${b.players.map((p) => `<div class="panel"><div class="section-head" style="margin-bottom:6px"><a href="#/player/${p.playerId}"><strong>${esc(p.name)}</strong></a><span class="small muted">${esc(p.pos || '')} · ${p.role === 'starter' ? 'started' : p.role === 'sub' ? 'sub' : ''} · ${p.minutes}'</span></div>
      <div class="chips" style="margin:6px 0">${p.key.map(([k, v]) => `<span class="pill"><span class="faint">${esc(k)}</span> <strong style="color:var(--text)">${esc(v)}</strong></span>`).join('')}</div>
      ${p.notes.length ? `<p class="small" style="margin:6px 0 0;color:var(--cyan)">${esc(p.notes.join(', '))}</p>` : ''}</div>`).join('')}</div>
    <p class="source">Compared with each player's own per-90 average this season. ${esc(b.sources.join('; '))}.</p></section>
  <p class="small"><a href="#/match/${encodeURIComponent(f.id)}">Full Match Centre for this game</a>${d?.fotmobUrl ? ` · <a href="${esc(d.fotmobUrl)}" target="_blank" rel="noopener">Heat maps and positions on FotMob</a>` : ''}</p>`;
};
AFTER.breakdown = () => {
  const s = document.getElementById('bd-match');
  if (s) s.addEventListener('change', () => { location.hash = `#/breakdown/${encodeURIComponent(s.value)}`; });
};

// ---------------- Injury tracker ----------------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// Read the return date from the Premier League's news text, e.g. "Hamstring injury - Expected back 24 Oct".
function parseAbsence(p) {
  const news = p.news || '';
  const m = news.match(/(?:expected back|back|until|from)\s+(\d{1,2})\s+([a-z]{3})/i);
  let back = null;
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    const added = p.newsAdded ? new Date(p.newsAdded) : new Date();
    let y = added.getUTCFullYear(); back = new Date(Date.UTC(y, MONTHS[m[2].toLowerCase()], Number(m[1])));
    if (back < added - 14 * 86400e3) back = new Date(Date.UTC(y + 1, MONTHS[m[2].toLowerCase()], Number(m[1])));
  }
  const reason = news.split(' - ')[0] || p.statusLabel || 'Unavailable';
  const kind = p.status === 's' ? 'suspended' : p.status === 'd' ? 'doubtful' : 'injured';
  return { back, unknown: !back && /unknown/i.test(news), reason: p.status === 's' ? 'Suspended' : reason, kind, chance: p.chanceNext };
}
VIEWS.injuries = async () => {
  const [ps, fx] = await Promise.all([loadSeason('players.json'), loadSeason('fixtures.json')]);
  const now = Date.now();
  const upcoming = fx.fixtures.filter((f) => !f.friendly && f.kickoff && (f.status === 'SCHEDULED' || f.status === 'LIVE') && Date.parse(f.kickoff) > now - 3 * 3600e3).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const cols = upcoming.slice(0, 6);
  const out = ps.players.filter((p) => p.current && ['i', 's', 'd'].includes(p.status)).map((p) => ({ p, a: parseAbsence(p) }))
    .map((x) => ({ ...x, misses: x.a.kind === 'doubtful' ? [] : x.a.back ? upcoming.filter((f) => Date.parse(f.kickoff) < x.a.back.getTime()) : null }))
    .sort((x, y) => (x.a.kind === 'doubtful') - (y.a.kind === 'doubtful') || (x.a.back ? x.a.back.getTime() : 9e15) - (y.a.back ? y.a.back.getTime() : 9e15));
  const fit = ps.players.filter((p) => p.current && !['i', 's', 'u', 'n'].includes(p.status)).length;
  const fmtBack = (a) => (a.back ? fmtDate(a.back.toISOString(), { weekday: 'short', day: 'numeric', month: 'short' }) : a.unknown ? 'Not announced' : '—');
  const daysTo = (a) => (a.back ? Math.max(0, Math.ceil((a.back.getTime() - now) / 86400e3)) : null);
  const cell = (x, f, i) => {
    if (x.a.kind === 'doubtful') return i === 0 ? `<td class="inj-c d" title="${x.a.chance ?? '?'}% chance of playing">${x.a.chance ?? '?'}%</td>` : '<td class="inj-c ok" title="Expected available">✓</td>';
    if (!x.a.back) return '<td class="inj-c u" title="Return date not announced">?</td>';
    return Date.parse(f.kickoff) < x.a.back.getTime() ? '<td class="inj-c x" title="Misses this match">✕</td>' : '<td class="inj-c ok" title="Expected back">✓</td>';
  };
  const grid = cols.length ? `<div class="table-wrap"><table class="inj-grid"><thead><tr><th>Player</th>${cols.map((f) => `<th title="${esc(f.opponent)} · ${esc(fmtDate(f.kickoff))}">${oc(f) || esc(f.opponentShort || f.opponent.slice(0, 3))}<span>${esc(fmtDate(f.kickoff, { day: 'numeric', month: 'short' }))}</span></th>`).join('')}</tr></thead>
    <tbody>${out.map((x) => `<tr><td><a href="#/player/${x.p.id}">${esc(x.p.web)}</a></td>${cols.map((f, i) => cell(x, f, i)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="tiny faint" style="margin:6px 0 0"><span class="inj-key x">✕</span> misses · <span class="inj-key ok">✓</span> expected back · <span class="inj-key d">%</span> chance of playing · <span class="inj-key u">?</span> return date not announced</p>` : '';
  const cards = out.map((x) => {
    const d = daysTo(x.a);
    const missTxt = x.a.kind === 'doubtful' ? `${x.a.chance ?? '?'}% chance of playing the next match` : x.misses === null ? 'Return date not announced' : x.misses.length ? `Misses ${x.misses.length} match${x.misses.length > 1 ? 'es' : ''}` : 'Expected back for the next match';
    return `<div class="panel inj-card ${x.a.kind}"><div class="inj-head">${photoHtml(x.p)}<div><a href="#/player/${x.p.id}"><strong>${esc(x.p.web)}</strong></a><div class="small muted">${esc(state.meta.posLabels[x.p.pos] || x.p.pos)}</div></div>
      <span class="inj-tag ${x.a.kind}">${{ injured: 'Injured', suspended: 'Suspended', doubtful: 'Doubtful' }[x.a.kind]}</span></div>
      <div class="statlist"><div class="statrow"><span>Reason</span><span class="v">${esc(x.a.reason)}</span></div>
      ${x.a.kind !== 'doubtful' ? `<div class="statrow"><span>Expected back</span><span class="v">${esc(fmtBack(x.a))}${d !== null ? `<small>${d === 0 ? 'today' : `in ${d} day${d > 1 ? 's' : ''}`}</small>` : ''}</span></div>` : ''}
      <div class="statrow"><span>${esc(missTxt)}</span><span class="v inj-miss">${(x.misses || []).slice(0, 8).map((f) => `<a href="#/match/${encodeURIComponent(f.id)}" title="${esc(f.opponent)} · ${esc(fmtDate(f.kickoff))}">${oc(f) || esc(f.opponentShort || f.opponent.slice(0, 3))}</a>`).join('')}</span></div></div>
      ${x.p.newsAdded ? `<p class="tiny faint" style="margin:6px 0 0">Reported ${esc(fmtDate(x.p.newsAdded, { day: 'numeric', month: 'short' }))}</p>` : ''}</div>`;
  }).join('');
  const next = upcoming[0];
  return `<div class="section-head"><h1>Injury tracker</h1><span class="muted small">Updated with the Premier League's team news</span></div>
    <div class="grid three section">
      <div class="panel stat-tile"><span class="lbl">Unavailable</span><span class="big">${out.filter((x) => x.a.kind !== 'doubtful').length}</span><span class="small muted">${out.filter((x) => x.a.kind === 'injured').length} injured · ${out.filter((x) => x.a.kind === 'suspended').length} suspended</span></div>
      <div class="panel stat-tile"><span class="lbl">Doubtful</span><span class="big">${out.filter((x) => x.a.kind === 'doubtful').length}</span><span class="small muted">Chance of playing given</span></div>
      <div class="panel stat-tile"><span class="lbl">Fit for ${next ? `${next.home ? 'v' : '@'} ${esc(next.opponentShort || next.opponent)}` : 'next match'}</span><span class="big">${fit}</span><span class="small muted">first-team players</span></div>
    </div>
    ${out.length ? `<section class="panel section"><h2 style="margin-top:0">Next ${cols.length} matches</h2>${grid}</section><div class="grid two section">${cards}</div>` : '<div class="empty">Everyone is available. No injuries or suspensions are listed.</div>'}
    <p class="source">From the Premier League's official availability flags and news (via the FPL API), checked every 20 minutes. Return dates are the club's estimates and often move; matches are counted as missed when they fall before the expected return date. Cup suspensions may not be listed.</p>`;
};

// ---------------- Matchday briefing ----------------
const BRIEF_ICON = { forecast: '📊', stakes: '🏆', opponent: '🔎', threat: '⚠️', edge: '✅', worry: '🚩', news: '🩹' };
VIEWS.briefing = async () => {
  const [br, table] = await Promise.all([loadSeason('briefing.json', state.season, { optional: true }), loadSeason('table.json')]);
  const nx = br?.next;
  const m = nx ? await loadSeason(`matches/${nx.matchId}.json`, state.season, { optional: true }) : null;
  const f = m?.fixture;
  const ko = f ? Date.parse(f.kickoff) : null;
  const hero = f ? `<section class="hero brief-hero"><div class="kicker">${esc(f.competition)}${f.gameweek ? ` · gameweek ${f.gameweek}` : ''} · ${f.home ? 'Home' : 'Away'}</div>
      <div class="fixture-board"><div class="team">${f.home ? spursCrest('big') : oc(f, 'big')}${esc(f.home ? 'Spurs' : f.opponent)}</div>
        <div class="mid"><div class="clock">${esc(fmtTime(f.kickoff))}</div><div class="vs">${esc(fmtDate(f.kickoff, { weekday: 'long', day: 'numeric', month: 'long' }))}<br>Bahrain time</div></div>
        <div class="team">${f.home ? oc(f, 'big') : spursCrest('big')}${esc(f.home ? f.opponent : 'Spurs')}</div></div>
      <div class="brief-count" id="brief-count" data-ko="${ko}"></div>
      <div class="brief-status">${m.lineups?.spurs ? '<span class="ok">✓ Line-ups confirmed: everything below uses the real XIs</span>' : `<span>Line-ups usually come out about an hour before kick-off (around ${esc(fmtTime(new Date(ko - 3600e3).toISOString()))}). This page updates on its own.</span>`}</div>
      <div class="brief-links"><a class="btn" href="#/manager">Play it in the Matchday Simulator</a><a class="btn ghost" href="#/match/${encodeURIComponent(f.id)}">Match Centre</a></div></section>` : '<h1>Matchday briefing</h1><div class="empty">No upcoming match in the stored fixtures.</div>';
  const bullets = nx?.bullets?.length ? `<section class="panel section"><div class="section-head"><h2>The 60-second brief</h2><span class="label-analysis">From the data</span></div>
      <ul class="brief-list">${nx.bullets.map((b) => `<li><span class="bi">${BRIEF_ICON[b.kind] || '•'}</span><span>${esc(b.text)}</span></li>`).join('')}</ul></section>` : '';
  const watch = nx?.watch?.length ? `<section class="section"><div class="section-head"><h2>What to watch</h2><span class="small muted">checked after the match</span></div>
      <div class="grid two">${nx.watch.map((w) => `<div class="panel watch-card"><h3>${esc(w.title)}</h3><p class="small">${esc(w.text)}</p><span class="watch-target">${w.expect.kind === 'approx' ? `About ${w.expect.dp ? Number(w.expect.value).toFixed(w.expect.dp) : w.expect.value}${esc(w.expect.unit || '')}` : w.expect.kind === 'atmost' ? `Target: ${w.key === 'dangerMan' ? 'no goal or assist' : `${w.expect.dp ? Number(w.expect.value).toFixed(w.expect.dp) : w.expect.value}${esc(w.expect.unit || '')} or fewer`}` : `Target: ${w.expect.value}${esc(w.expect.unit || '')} or more`}</span></div>`).join('')}</div></section>` : '';
  const lineups = m ? (m.lineups?.spurs ? lineupsPanel(m) : '') : '';
  const forecast = m?.forecast ? forecastHtml(m.forecast) : '';
  const stakes = table.round && f && table.round.spursMatch?.opponentTeamId === f.opponentTeamId ? roundPanel(table.round) : '';
  const scout = m?.preview ? scoutHtml({ ...m.preview, forecast: null }, f) : '';
  const V = { held: ['✓', 'held', 'As expected'], better: ['↑', 'better', 'Better than expected'], worse: ['↓', 'worse', 'Worse than expected'], missed: ['✗', 'missed', 'Not as expected'], neutral: ['•', 'neutral', ''], unknown: ['?', 'neutral', 'Not measured'] };
  const reviews = br?.reviews?.length ? `<section class="section"><div class="section-head"><h2>How the last briefs held up</h2><span class="small muted">accountability</span></div>
      ${br.reviews.map((r, i) => `<details class="panel review"${i === 0 ? ' open' : ''}><summary><span class="rv-team">${crestOf(r.opponent, r.opponentTeamId)}${r.home ? 'v' : '@'} ${esc(r.opponent)}</span><span class="ic-res ${r.result === 'W' ? 'w' : r.result === 'L' ? 'l' : 'd'}">${esc(r.result)} ${r.score.spurs}–${r.score.opp}</span><span class="rv-score">${r.held}/${r.of} held</span></summary>
        ${r.checks.map((c) => { const v = V[c.verdict] || V.neutral; return `<div class="rv-row"><span class="rv-mark ${v[1]}">${v[0]}</span><div><strong>${esc(c.title)}</strong>${v[2] ? ` <span class="rv-tag ${v[1]}">${v[2]}</span>` : ''}<p class="small muted">${esc(c.text)}</p><p class="small">${esc(c.actual)}</p></div></div>`; }).join('')}
        ${r.briefSaved ? '' : '<p class="tiny faint">This match was played before the briefing page existed, so only the saved pre-match forecast can be checked.</p>'}
        <div class="ic-links"><a href="#/style/${encodeURIComponent(r.matchId)}">How Spurs played →</a><a href="#/breakdown/${encodeURIComponent(r.matchId)}">Match breakdown →</a></div></details>`).join('')}</section>` : '';
  return `${hero}${bullets}${lineups}${forecast}${watch}${stakes}${scout}${reviews}<p class="source">${esc(br?.label || '')}</p>`;
};
AFTER.briefing = () => {
  const el = document.getElementById('brief-count'); if (!el) return;
  const ko = Number(el.dataset.ko);
  const tick = () => {
    if (!document.body.contains(el)) { clearInterval(t); return; }
    const d = ko - Date.now();
    if (d <= 0) { el.textContent = d > -2.5 * 3600e3 ? 'Kicked off' : ''; return; }
    const dd = Math.floor(d / 86400e3); const hh = Math.floor((d % 86400e3) / 3600e3); const mm = Math.floor((d % 3600e3) / 60e3);
    el.textContent = `Kick-off in ${dd ? `${dd}d ` : ''}${hh}h ${String(mm).padStart(2, '0')}m`;
  };
  const t = setInterval(tick, 30e3); tick();
};
VIEWS.weekly = VIEWS.briefing; AFTER.weekly = AFTER.briefing; // old links

// ---------------- Goal replays & match graphic (own pages) ----------------
async function playedWithShots() {
  const fx = await loadSeason('fixtures.json');
  return fx.fixtures.filter((f) => f.result && f.hasDetail && !f.friendly).sort((a, b) => b.kickoff.localeCompare(a.kickoff));
}
const matchSelect = (list, cur, id) => `<select class="ctl" id="${id}" aria-label="Match" style="flex:1 1 100%;min-width:0">${list.map((f) => `<option value="${esc(f.id)}" ${f.id === cur ? 'selected' : ''}>${esc(fmtDate(f.kickoff, { day: 'numeric', month: 'short' }))} · ${f.home ? 'v' : '@'} ${esc(f.opponent)} ${f.score ? `${f.score.spurs}–${f.score.opp}` : ''} (${esc(f.competition === 'Premier League' ? 'PL' : f.competition)})</option>`).join('')}</select>`;
VIEWS.replays = async (id) => {
  const list = await playedWithShots();
  if (!list.length) return '<h1>Goal replays</h1><div class="empty">Replays appear once a match has shot data.</div>';
  const cur = list.find((f) => f.id === id) || list[0];
  const m = await loadSeason(`matches/${cur.id}.json`, state.season, { optional: true });
  const goals = (m?.detail?.shots || []).filter((s) => s.outcome === 'goal');
  return `<div class="section-head"><h1>Goal replays</h1><span class="muted small">Every chance, played back in order</span></div>
    ${matchPicker(list, cur.id, 'replays')}
    <section class="hero" style="padding:16px"><div class="fixture-board"><div class="team">${cur.home ? spursCrest('big') : oc(cur, 'big')}${esc(cur.home ? 'Spurs' : cur.opponent)}</div><div class="mid"><div class="clock">${cur.home ? `${cur.score.spurs}–${cur.score.opp}` : `${cur.score.opp}–${cur.score.spurs}`}</div><div class="vs">${esc(fmtDate(cur.kickoff, { weekday: 'short', day: 'numeric', month: 'short' }))}</div></div><div class="team right">${cur.home ? oc(cur, 'big') : spursCrest('big')}${esc(cur.home ? cur.opponent : 'Spurs')}</div></div>
      ${goals.length ? `<p class="small" style="margin:8px 0 0;text-align:center">${goals.map((g) => `⚽ ${esc(g.player || (g.candidates ? g.candidates.join(' or ') : `${g.team === 'spurs' ? 'Spurs' : cur.opponent} goal`))} ${g.minute}${g.added ? `+${g.added}` : ''}′`).join(' · ')}</p>` : ''}</section>
    ${m ? replayHtml(m) || '<div class="empty section">Not enough shot data for this match.</div>' : ''}
    <p class="small muted"><a href="#/match/${encodeURIComponent(cur.id)}">Full Match Centre →</a></p>`;
};
AFTER.replays = async (id) => {
  document.getElementById('rp-match')?.addEventListener('change', (e) => { location.hash = `#/replays/${encodeURIComponent(e.target.value)}`; });
  const list = await playedWithShots(); const cur = list.find((f) => f.id === id) || list[0];
  if (!cur) return;
  const m = await loadSeason(`matches/${cur.id}.json`, state.season, { optional: true });
  if (m) bindReplay(m);
};
VIEWS.graphic = async (id) => {
  const fx = await loadSeason('fixtures.json');
  const list = fx.fixtures.filter((f) => f.result && f.score && !f.friendly).sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  if (!list.length) return '<h1>Match graphic</h1><div class="empty">A graphic can be made once Spurs have played.</div>';
  const cur = list.find((f) => f.id === id) || list[0];
  return `<div class="section-head"><h1>Match graphic</h1><span class="muted small">Ready for WhatsApp or Instagram</span></div>
    ${matchPicker(list, cur.id, 'graphic')}
    <div class="panel gr-wrap"><div id="gr-preview" class="gr-preview"><div class="skeleton" style="height:100%"></div></div></div>
    <div class="mgr-actions section"><button class="btn" id="gr-share">📤 Share</button><a class="btn ghost" id="gr-save" download>⬇ Save image</a></div>
    <p class="source">Score, xG, shot map and key stats from the stored match data (FotMob via FPL Core Insights; FPL for players). Star player = most goals, assists, xG and xA, plus the Premier League's bonus-points score. Club crests appear when the Premier League's image server allows them in an image.</p>`;
};
AFTER.graphic = async (id) => {
  document.getElementById('gr-match')?.addEventListener('change', (e) => { location.hash = `#/graphic/${encodeURIComponent(e.target.value)}`; });
  const fx = await loadSeason('fixtures.json');
  const list = fx.fixtures.filter((f) => f.result && f.score && !f.friendly).sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  const cur = list.find((f) => f.id === id) || list[0]; if (!cur) return;
  const m = await loadSeason(`matches/${cur.id}.json`, state.season, { optional: true }); if (!m) return;
  let blob;
  try { blob = await makeGraphic(m); } catch (e) { document.getElementById('gr-preview').innerHTML = `<div class="banner error">The graphic could not be made: ${esc(e.message)}</div>`; return; }
  const url = URL.createObjectURL(blob);
  const name = `spurs-${cur.home ? 'v' : 'at'}-${cur.opponent.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${cur.score.spurs}-${cur.score.opp}.png`;
  const prev = document.getElementById('gr-preview'); if (!prev) return;
  prev.innerHTML = `<img src="${url}" alt="Match graphic for Spurs ${cur.score.spurs}–${cur.score.opp} ${esc(cur.opponent)}">`;
  const save = document.getElementById('gr-save'); save.href = url; save.download = name;
  document.getElementById('gr-share').addEventListener('click', async () => {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: `Spurs ${cur.score.spurs}–${cur.score.opp} ${cur.opponent}` }); } catch { /* cancelled */ } }
    else save.click();
  });
};

VIEWS.manager = managerView;
AFTER.manager = managerAfter;

// ---------------- Season simulator ----------------
VIEWS.simulator = async () => {
  const sim = await loadSeason('simulation.json', state.season, { optional: true });
  if (!sim) return '<h1>Season forecast</h1><div class="empty">The forecast runs for the current season once match data is available.</div>';
  const s = sim.spurs;
  const likely = s.positions.indexOf(Math.max(...s.positions)) + 1;
  const tile = (v, l, ctx, col) => `<div class="rank-tile"><div class="val" style="${col ? `color:${col}` : ''}">${v}</div><div class="lbl">${l}</div><div class="ctx">${ctx}</div></div>`;
  const maxP = Math.max(...s.positions);
  const bars = s.positions.map((p, i) => { const pos = i + 1; const h = maxP ? (p / maxP) * 150 : 0; const col = pos >= 18 ? 'var(--loss)' : pos <= 6 ? 'var(--win)' : 'var(--cyan)';
    return `<g><rect x="${18 + i * 30}" y="${170 - h}" width="22" height="${h}" rx="3" fill="${col}" opacity="${pos === s.position ? 1 : 0.75}"><title>${ordinal(pos)}: ${p}%</title></rect><text x="${29 + i * 30}" y="186" text-anchor="middle">${pos}</text>${p >= 3 ? `<text x="${29 + i * 30}" y="${164 - h}" text-anchor="middle" style="font-size:9px">${Math.round(p)}</text>` : ''}</g>`; }).join('');
  const fc = sim.next;
  return `<div class="section-head"><h1>Season forecast</h1><span class="label-analysis">Re-run after every match</span></div>
  <p class="muted">The rest of the Premier League season played out ${sim.sims.toLocaleString()} times (${sim.remainingFixtures} fixtures left), based on each team's long-term strength and how well it creates and prevents chances this season.</p>
  <details class="panel howto"><summary><strong>How to read this page</strong></summary>
    <ol class="small">
      <li><strong>Every team gets a strength rating</strong>: part last season's final rating, part this season's chances created and allowed (xG), with recent games counting more. ${s.priorShare !== null && s.priorShare !== undefined ? `Right now last season counts for about ${Math.round(s.priorShare * 100)}%; that falls as more games are played.` : ''}</li>
      <li><strong>Injuries count</strong>: a team missing key players is weakened for its next fortnight.</li>
      <li><strong>Every remaining match is played</strong> using those ratings, ${sim.sims.toLocaleString()} times over, with a little randomness in the ratings each time because we can't know them exactly.</li>
      <li><strong>The percentages</strong> are how often each outcome happened. "${s.relegation}% relegation" means Spurs finished 18th–20th in about ${Math.round(s.relegation * sim.sims / 100).toLocaleString()} of the ${sim.sims.toLocaleString()} seasons.</li>
      <li><strong>It updates by itself</strong> whenever a Premier League result comes in (checked every 20 minutes), and when team news changes.</li>
    </ol>
    <p class="tiny faint">A model, not betting odds. Football is random: even good forecasts are wrong often on single matches, but should be right over many.</p></details>
  <div class="rank-grid">
    ${tile(`${s.relegation}%`, 'Relegation', 'Finishing 18th–20th', s.relegation >= 25 ? 'var(--loss)' : null)}
    ${tile(`${Math.round((100 - s.relegation) * 10) / 10}%`, 'Survival', 'Finishing 17th or higher')}
    ${tile(`${s.topHalf}%`, 'Top half', 'Finishing 1st–10th')}
    ${tile(`${s.top6}%`, 'Europe (top 6)', `Top 4: ${s.top4}% · title: ${s.title}%`)}
    ${tile(`${s.expectedPoints}`, 'Expected points', `Now ${s.points} from ${s.played} · most likely finish ${ordinal(likely)}`)}
  </div>
  <div class="panel section"><h2>Where Spurs finish</h2><div class="chart"><svg viewBox="0 0 620 196" role="img" aria-label="Finishing position probabilities">${bars}</svg></div>
    <div class="legend"><span><i style="background:var(--win)"></i>Europe places</span><span><i style="background:var(--cyan)"></i>Mid-table</span><span><i style="background:var(--loss)"></i>Relegation</span><span>Numbers = % chance</span></div></div>
  ${sim.upcoming?.length ? scorelineHtml(sim.upcoming) : fc ? `<section class="section"><h2>Next match: ${fc.home ? 'v' : '@'} ${crestOf(fc.opponent)}${esc(fc.opponent)}</h2>${forecastHtml(fc)}</section>` : ''}
  ${trackRecordHtml(sim.backtest)}
  ${sim.record.length ? `<div class="panel section"><h2>Forecast record</h2><div class="table-wrap"><table><thead><tr><th>Match</th><th class="r">W / D / L forecast</th><th class="r">Result</th><th class="r">Chance given</th></tr></thead><tbody>${sim.record.map((r) => `<tr><td>${esc(fmtDate(r.kickoff, { day: 'numeric', month: 'short' }))} ${r.home ? 'v' : '@'} ${crestOf(r.opponent, r.opponentTeamId)}${esc(r.opponent)}</td><td class="r">${r.win} / ${r.draw} / ${r.loss}</td><td class="r">${r.score ? `${r.score.spurs}–${r.score.opp}` : ''} ${resultChip(r.result, true)}</td><td class="r">${r.probOfResult}%</td></tr>`).join('')}</tbody></table></div><p class="source">Forecasts saved before kick-off. Average Brier score ${(sim.record.reduce((a, r) => a + r.brier, 0) / sim.record.length).toFixed(3)} (lower is better; always guessing a third each is 0.667).</p></div>` : '<p class="small muted section">Forecasts are saved before each match from now on, then compared with the result here.</p>'}
  <div class="panel section"><h2>Projected final table</h2><div class="table-wrap"><table class="sim"><thead><tr><th>#</th><th>Club</th><th class="r">Now</th><th class="r">Exp. pts</th><th class="r">Top 4</th><th class="r">Top 6</th><th class="r">Relegation</th></tr></thead><tbody>
    ${sim.teams.map((t, i) => `<tr class="${t.teamId === s.teamId ? 'hl' : ''}"><td>${i + 1}</td><td>${crest(t.teamId)}<span class="cl-l">${esc(t.team)}</span><span class="cl-s">${esc(t.short || t.team)}</span></td><td class="r">${t.points}</td><td class="r"><strong>${t.expectedPoints}</strong></td><td class="r">${t.top4}%</td><td class="r">${t.top6}%</td><td class="r" style="color:${t.relegation >= 30 ? 'var(--loss)' : 'inherit'}">${t.relegation}%</td></tr>`).join('')}</tbody></table></div></div>
  <p class="source">${esc(sim.method)} Home advantage ×${sim.homeAdvantage}; ratings are pulled towards average by the equivalent of ${sim.priorMatches} matches so early-season results don't dominate. ${esc(sim.label)}</p>`;
};

// Scorelines and fair odds for Spurs' next fixtures (selectable).
const fairOdds = (p) => (p > 0 ? (100 / p).toFixed(p >= 50 ? 2 : p >= 10 ? 1 : 0) : '—');
function scorelineHtml(list) {
  return `<section class="section" id="scorelines"><div class="section-head"><h2>Upcoming matches: scorelines &amp; odds</h2><select class="ctl" id="sc-sel" aria-label="Match">${list.map((u, i) => `<option value="${i}">${esc(fmtDate(u.kickoff, { day: 'numeric', month: 'short' }))} · ${u.home ? 'v' : '@'} ${esc(u.opponent)}</option>`).join('')}</select></div>
    <div id="sc-body">${scorelineBody(list[0])}</div></section>`;
}
// Most likely exact score within one result (w = Spurs win, d = draw, l = Spurs defeat).
const bestIn = (grid, c) => { let b = null; grid.forEach((r, i) => r.forEach((p, j) => { const k = i > j ? 'w' : i < j ? 'l' : 'd'; if (k === c && (!b || p > b.p)) b = { i, j, p }; })); return b; };
function scorelineBody(u) {
  const max = Math.max(...u.grid.flat());
  const cell = (p, i, j) => `<td class="${i > j ? 'w' : i < j ? 'l' : 'd'}" style="--a:${(p / max).toFixed(2)}" title="Spurs ${i}–${j} ${esc(u.opponent)}: ${p}% (fair odds ${fairOdds(p)})">${p >= 0.5 ? `${p.toFixed(p >= 10 ? 0 : 1)}` : ''}</td>`;
  const res = [['Spurs win', u.win, 'w'], ['Draw', u.draw, 'd'], [`${u.opponent} win`, u.loss, 'l']];
  const fav = res.slice().sort((a, b) => b[1] - a[1])[0][0];
  const news = [u.news?.spurs && `Spurs without ${u.news.spurs.players.join(', ')}`, u.news?.opp && `${u.opponent} without ${u.news.opp.players.join(', ')}`].filter(Boolean);
  return `${u.lineupsConfirmed ? `<div class="banner info" style="margin-bottom:8px">✓ <strong>Line-ups confirmed</strong>: this forecast uses both real XIs.${u.early ? ` Before line-ups: Spurs win ${u.early.win}% · draw ${u.early.draw}% · lose ${u.early.loss}%.` : ''}</div>` : '<p class="tiny faint" style="margin:0 0 6px">Early forecast: updates automatically when the line-ups are confirmed (about an hour before kick-off).</p>'}<div class="panel"><div class="sc-head">${u.home ? spursCrest() : crestOf(u.opponent, u.opponentTeamId)}<strong>${u.home ? 'Spurs' : esc(u.opponent)}</strong> v <strong>${u.home ? esc(u.opponent) : 'Spurs'}</strong>${u.home ? crestOf(u.opponent, u.opponentTeamId) : spursCrest()} <span class="small muted">${esc(fmtDate(u.kickoff, { weekday: 'short', day: 'numeric', month: 'short' }))}, ${esc(fmtTime(u.kickoff))}</span></div>
    <div class="sc-res">${res.map(([l, p, c]) => { const b = bestIn(u.grid, c); return `<div class="sc-r ${c}${l === fav ? ' fav' : ''}"><span>${esc(l)}</span><strong>${p}%</strong><small>fair odds ${fairOdds(p)}</small>${b ? `<small class="sc-best">likeliest: <b>${b.i}–${b.j}</b> (${b.p}%)</small>` : ''}${l === fav ? '<em>Most likely</em>' : ''}</div>`; }).join('')}</div>
    <p class="tiny faint" style="margin:8px 0 0">Why 1–1 tops the list so often: a win can happen in many ways (1–0, 2–1, 2–0…), so its chance is split across lots of scores, while draws pile onto just a few. That makes 1–1 the most common single score in the Premier League even when one side is favourite.</p>
    <div class="grid two" style="margin-top:12px">
      <div><h3 style="margin-top:0">Most likely scores</h3><div class="statlist">${u.scores.map((x, i) => `<div class="statrow"><span>${i === 0 ? '<strong>' : ''}Spurs ${x.spurs}–${x.opp} ${esc(u.opponent)}${i === 0 ? '</strong>' : ''}</span><span class="v">${x.p}%<small>fair odds ${fairOdds(x.p)}</small></span></div>`).join('')}</div>
        <div class="statlist" style="margin-top:10px"><div class="statrow"><span>Over 2.5 goals</span><span class="v">${u.over25}%<small>under ${Math.round((100 - u.over25) * 10) / 10}%</small></span></div><div class="statrow"><span>Both teams score</span><span class="v">${u.btts}%</span></div>
        <div class="statrow"><span>Expected goals</span><span class="v">${fmtPlain(u.xg.spurs, 2)}–${fmtPlain(u.xg.opp, 2)}</span></div></div></div>
      <div><h3 style="margin-top:0">Every scoreline</h3><div class="table-wrap"><table class="sc-grid"><thead><tr><th class="tiny">Spurs ↓ / ${esc((u.opponent || '').split(' ')[0])} →</th>${[0, 1, 2, 3, 4, 5].map((j) => `<th>${j}</th>`).join('')}</tr></thead><tbody>${u.grid.map((r, i) => `<tr><th>${i}</th>${r.map((p, j) => cell(p, i, j)).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="tiny faint" style="margin:6px 0 0">% chance of each exact score. Green = Spurs win, yellow = draw, red = defeat; darker = more likely.</p></div>
    </div>
    ${news.length ? `<p class="small" style="margin:10px 0 0">🩹 Allowed for: ${esc(news.join('; '))}.</p>` : ''}
    <p class="tiny faint" style="margin:6px 0 0">Fair odds = 1 ÷ the model's chance (decimal odds with no bookmaker margin). The lowest odds are the most likely outcome. For information, not betting advice.</p></div>`;
}
function trackRecordHtml(bt) {
  if (!bt) return '';
  const name = (id) => state.meta.teamShort?.[id] || '';
  return `<div class="panel section"><div class="section-head"><h2>How accurate is it?</h2><span class="label-analysis">Tested on ${bt.matches} league matches</span></div>
    <p class="small" style="margin-top:0">Every Premier League match this season was forecast using only the games played before it, then checked against the real result.</p>
    <div class="rank-grid bt-grid">
      <div class="rank-tile"><div class="val">${bt.favouriteRight}%</div><div class="lbl">Right result</div><div class="ctx">the most likely result happened · always backing the home team: ${bt.homeRight}%</div></div>
      <div class="rank-tile"><div class="val" style="color:${bt.skill > 0 ? 'var(--win)' : 'var(--loss)'}">${bt.skill > 0 ? '+' : ''}${bt.skill}%</div><div class="lbl">Better than guessing</div><div class="ctx">accuracy of the % chances v the league's average results</div></div>
      <div class="rank-tile"><div class="val">${bt.exactScore}%</div><div class="lbl">Exact score</div><div class="ctx">most likely score was the actual score</div></div>
    </div>
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Latest matches</th><th class="r">Forecast (H / D / A)</th><th class="r">Result</th><th class="r"></th></tr></thead><tbody>${bt.recent.map((x) => `<tr><td>${crest(x.home)}${esc(name(x.home))} v ${crest(x.away)}${esc(name(x.away))}</td><td class="r">${x.p.H} / ${x.p.D} / ${x.p.A}</td><td class="r">${x.score[0]}–${x.score[1]}</td><td class="r">${x.fav === x.outcome ? '<span class="mv-up">✓</span>' : '<span class="mv-down">✗</span>'}</td></tr>`).join('')}</tbody></table></div>
    <p class="tiny faint" style="margin:6px 0 0">With three possible results, top forecasters get about half right. "Better than guessing" compares the forecast percentages (Brier score) with simply using how often home wins, draws and away wins happen.</p></div>`;
}
AFTER.simulator = async () => {
  const sim = await loadSeason('simulation.json', state.season, { optional: true });
  document.getElementById('sc-sel')?.addEventListener('change', (e) => { document.getElementById('sc-body').innerHTML = scorelineBody(sim.upcoming[Number(e.target.value)]); });
};

// ---------------- De Zerbi style tracker ----------------
VIEWS.style = async (sel) => {
  const team = await loadSeason('team.json');
  const ms = team.matches.filter((m) => m.adv);
  if (ms.length < 2) return '<h1>De Zerbi tracker</h1><div class="empty">The tracker needs at least two Premier League matches with detailed data.</div>';
  const ranks = team.leagueRanks?.metrics || {};
  const metrics = [
    { key: 'possession', label: 'Possession', unit: '%', get: (m) => m.adv.spurs.possession, league: ranks.possession?.leagueAvg, why: 'De Zerbi teams aim to control the ball.' },
    { key: 'fieldTilt', label: 'Territory (field tilt)', unit: '%', get: (m) => m.adv.fieldTilt, league: ranks.fieldTilt?.leagueAvg, why: 'Share of the passing done in the opposition half: how high up the pitch Spurs play.' },
    { key: 'passPct', label: 'Pass accuracy', unit: '%', get: (m) => m.adv.spurs.passPct, league: ranks.passPct?.leagueAvg, why: 'Building through pressure needs secure, short passing.' },
    { key: 'xgShot', label: 'Chance quality (xG per shot)', unit: '', dp: 3, get: (m) => (m.adv.spurs.xg !== null && m.adv.spurs.shots ? m.adv.spurs.xg / m.adv.spurs.shots : null), league: null, why: 'Patient build-up should create better chances, not just more shots.' },
    { key: 'touchesOppBox', label: 'Touches in the opposition box', unit: '', get: (m) => m.adv.spurs.touchesOppBox, league: ranks.touchesOppBox?.leagueAvg, why: 'Possession should turn into presence in the box.' },
    { key: 'ppda', label: 'Pressing intensity (PPDA, est.)', unit: '', dp: 1, lower: true, get: (m) => m.adv.ppda ?? null, league: ranks.ppda?.leagueAvg, why: 'De Zerbi teams press to win the ball back high; lower = fewer passes allowed per defensive action.' },
    { key: 'counters', label: 'Shots conceded on the break', unit: '', dp: 0, lower: true, get: (m) => m.adv.counters?.against.shots ?? null, league: null, why: 'Committing players forward leaves space behind; this tracks how often it is punished.' },
    { key: 'xgaAgainst', label: 'xG conceded', unit: '', dp: 2, lower: true, get: (m) => m.adv.opp.xg, league: ranks.xga?.leagueAvg, why: 'Control of the ball should limit what opponents create.' },
  ];
  const labels = ms.map((m) => m.opponentShort || m.opponent.slice(0, 3));
  const roll = (vals) => vals.map((_, i) => { const w = vals.slice(Math.max(0, i - 2), i + 1).filter((v) => v !== null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; });
  const card = (mt) => {
    const vals = ms.map(mt.get).map((v) => (v === null || v === undefined ? null : Number(v)));
    const known = vals.filter((v) => v !== null);
    const half = Math.floor(known.length / 2);
    const first = known.slice(0, half); const last = known.slice(-half);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const a1 = avg(first); const a2 = avg(last);
    let verdict = 'Not enough matches to call a trend';
    if (a1 !== null && a2 !== null && half >= 2) {
      const ch = (a2 - a1) / (Math.abs(a1) || 1);
      const better = mt.lower ? ch < -0.08 : ch > 0.08; const worse = mt.lower ? ch > 0.08 : ch < -0.08;
      verdict = better ? `Improving: ${fmtPlain(a1, mt.dp ?? 1)} → ${fmtPlain(a2, mt.dp ?? 1)}${mt.unit}` : worse ? `Getting worse: ${fmtPlain(a1, mt.dp ?? 1)} → ${fmtPlain(a2, mt.dp ?? 1)}${mt.unit}` : `Stable around ${fmtPlain(a2, mt.dp ?? 1)}${mt.unit}`;
    }
    const col = /Improving/.test(verdict) ? 'var(--win)' : /worse/.test(verdict) ? 'var(--loss)' : 'var(--muted)';
    const series = [{ name: mt.label, color: 'var(--cyan)', values: vals }, { name: '3-match average', color: 'var(--draw)', values: roll(vals), dash: true }];
    if (mt.league !== null && mt.league !== undefined) series.push({ name: 'League average', color: 'var(--faint)', values: vals.map(() => mt.league), dash: true, ref: true });
    return `<div class="panel"><div class="section-head"><h3>${esc(mt.label)}</h3><span class="small" style="color:${col};font-weight:600">${esc(verdict)}</span></div>
      ${lineChart({ labels, series, height: 200, format: (v) => v.toFixed(mt.dp ?? 0) + mt.unit, readout: false, points: matchPoints(ms).map((pt, i) => ({ ...pt, links: [['How Spurs played', `#/style/${encodeURIComponent(ms[i].matchId)}`], ...pt.links] })), title: mt.label, badges: ms.map(badgeOf) })}<p class="small muted" style="margin-top:6px">${esc(mt.why)}</p></div>`;
  };
  return `<div class="section-head"><h1>De Zerbi tracker</h1><span class="label-observed">Measured, match by match</span></div>
  <p class="muted">Is Spurs' play moving towards what De Zerbi's teams are known for: keeping the ball, playing in the opposition half, passing securely and creating good chances? Each chart shows every Premier League match this season, a three-match average and the league average. Trends compare the earlier matches with the more recent ones.</p>
  ${gameReportShell(ms, sel)}
  <div class="grid two section">${metrics.map(card).join('')}</div>
  <p class="source">Match data from FotMob via FPL Core Insights, ${ms.length} Premier League matches. PPDA is estimated from passes and defensive actions; build-up shapes and player movement need tracking data, which isn't in the free data.</p>`;
};
// Game report: one match at a time, chosen from the crest strip or a chart card.
function gameReportShell(ms, sel) {
  const pick = ms.find((m) => m.matchId === sel) || ms[ms.length - 1];
  return `<section class="panel section" id="gr"><div class="section-head"><h2>How Spurs played</h2><span class="label-observed">From the match data</span></div>
    <div class="gr-strip" role="tablist">${ms.map((m) => { const b = badgeOf(m); return `<button class="gr-chip" role="tab" data-gr="${esc(m.matchId)}" aria-selected="${m === pick}" title="${esc(`${m.home ? 'v' : '@'} ${m.opponent}`)}">${b.url ? `<img src="${esc(b.url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<small>${esc(b.short)}</small><em class="${m.result === 'W' ? 'w' : m.result === 'L' ? 'l' : 'd'}">${m.gf}–${m.ga}</em></button>`; }).join('')}</div>
    <div id="gr-body" data-id="${esc(pick.matchId)}"><div class="skeleton" style="height:160px"></div></div></section>`;
}
const grFmt = (v, r) => (v === null || v === undefined ? '<span class="na">—</span>' : `${Number(v).toFixed(r.dp)}${r.unit}`);
function gameReportHtml(m) {
  const g = m?.gameReport; const f = m?.fixture;
  if (!g) return '<div class="empty">No detailed match data for this game yet. It appears automatically once the match statistics are published.</div>';
  const su = g.setup;
  const better = (r) => { if (r.spurs === null || r.season === null) return ''; const d = r.spurs - r.season; if (Math.abs(d) < Math.max(Math.abs(r.season) * 0.08, 10 ** -r.dp)) return ''; return (d > 0) !== r.lowerBetter ? 'up' : 'down'; };
  const setup = su ? `<div class="gr-setup">
      <div class="gr-forms"><div><span class="tiny faint">Spurs</span><strong>${esc(su.formation || '—')}</strong></div><div class="faint">v</div><div><span class="tiny faint">${esc(f.opponent)}</span><strong>${esc(su.oppFormation || '—')}</strong></div></div>
      <div class="gr-lines">${su.lines.map((l) => `<div><span class="tiny faint">${esc(l.line)}</span><span>${l.players.map(esc).join(' · ')}</span></div>`).join('')}</div>
      ${su.subs.length ? `<div class="gr-subs"><span class="tiny faint">Substitutions</span>${su.subs.map((x) => `<span>${x.minute ? `<b>${esc(x.minute)}</b> ` : ''}${esc(x.on)}${x.off ? ` <span class="faint">for</span> ${esc(x.off)}` : ''}</span>`).join('')}</div>` : ''}
      ${su.changes ? `<p class="small muted" style="margin:6px 0 0">${su.changes.in.length ? `Changes from the ${esc(su.changes.vs)} game: <strong>${su.changes.in.map(esc).join(', ')}</strong> in, ${su.changes.out.map(esc).join(', ')} out.` : `Unchanged XI from the ${esc(su.changes.vs)} game.`}${su.changes.formationBefore && su.changes.formationBefore !== su.formation ? ` Shape changed from ${esc(su.changes.formationBefore)}.` : ''}</p>` : ''}
    </div>` : '<p class="small faint">Team sheet (formation and XI) not available for this match.</p>';
  const phase = (p) => `<details class="gr-phase"${p.key === 'build' ? ' open' : ''}><summary><strong>${esc(p.title)}</strong><span class="faint gr-chev">▾</span></summary>
      ${p.read.length ? `<ul class="gr-read">${p.read.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="table-wrap"><table class="gr-table"><thead><tr><th></th><th class="r">Spurs</th><th class="r">${esc(f.opponentShort || f.opponent)}</th><th class="r" title="Spurs season average">Avg</th><th class="r" title="Premier League average">PL avg</th></tr></thead><tbody>
      ${p.rows.filter((r) => r.spurs !== null || r.opp !== null).map((r) => `<tr><td>${esc(r.label)}</td><td class="r gr-v ${better(r)}">${grFmt(r.spurs, r)}</td><td class="r">${grFmt(r.opp, r)}</td><td class="r faint">${grFmt(r.season, r)}</td><td class="r faint">${grFmt(r.league, r)}</td></tr>`).join('')}</tbody></table></div></details>`;
  return `<div class="gr-head">${crestOf(f.opponent, f.opponentTeamId, 'lg')}<div><strong>${f.home ? 'Spurs v ' : ''}${esc(f.opponent)}${f.home ? '' : ' v Spurs'}</strong><span class="small muted">${esc(fmtDate(f.kickoff, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${esc(f.competition)} · ${f.home ? 'Home' : 'Away'}</span></div><span class="ic-res ${f.result === 'W' ? 'w' : f.result === 'L' ? 'l' : 'd'}">${esc(f.result)} ${f.score.spurs}–${f.score.opp}</span></div>
    <div class="gr-summary">${g.summary.map((x) => `<p>${esc(x)}</p>`).join('')}</div>
    ${g.tags?.length ? `<div class="gr-tags">${g.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    <h3>The set-up</h3>${setup}
    <h3>Phase by phase</h3>${g.phases.map(phase).join('')}
    ${g.flow.length ? `<h3>How the game unfolded</h3><ul class="gr-read">${g.flow.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${g.standouts.length ? `<h3>Standouts</h3><div class="statlist">${g.standouts.map((s) => `<div class="statrow"><span>${esc(s.label)}</span><span class="v">${esc(s.name)} · ${esc(String(s.value))}</span></div>`).join('')}</div>` : ''}
    <p class="small faint" style="margin-top:12px">${esc(g.notMeasured)}</p>
    <p class="source">${esc(g.label)} Season averages from ${g.seasonMatches} other match${g.seasonMatches === 1 ? '' : 'es'}. Sources: ${g.sources.map(esc).join('; ')}. In the tables, Avg = Spurs' season average and PL avg = league average; green/red marks a Spurs figure clearly better/worse than their average. <a href="#/breakdown/${encodeURIComponent(f.id)}">Full match breakdown →</a></p>`;
}
AFTER.style = (sel) => {
  const body = document.getElementById('gr-body'); if (!body) return;
  const show = async (id) => {
    body.dataset.id = id;
    document.querySelectorAll('.gr-chip').forEach((c) => c.setAttribute('aria-selected', c.dataset.gr === id));
    const m = await loadSeason(`matches/${id}.json`, state.season, { optional: true });
    if (body.dataset.id === id) body.innerHTML = gameReportHtml(m);
  };
  document.querySelector('.gr-strip')?.addEventListener('click', (e) => { const c = e.target.closest('[data-gr]'); if (c) show(c.dataset.gr); });
  show(body.dataset.id);
  const chip = document.querySelector('.gr-chip[aria-selected="true"]'); chip?.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (sel) requestAnimationFrame(() => document.getElementById('gr')?.scrollIntoView({ block: 'start' }));
};

// ---------------- Data sources & settings ----------------
VIEWS.sources = async () => {
  const st = await load('status.json', { fresh: true });
  const m = state.meta;
  const rows = Object.entries(st.sources).map(([k, s]) => `<tr><td class="sticky-col wrap" data-label="Source">${esc(s.label || k)}</td><td data-label="Status">${s.disabled ? '<span class="badge partial">Off</span>' : s.consecutiveFailures ? `<span class="badge ${s.consecutiveFailures >= 6 ? 'no' : 'partial'}">Failing ×${s.consecutiveFailures}</span>` : '<span class="badge yes">Healthy</span>'}</td><td data-label="Last success">${s.lastSuccess ? `${esc(fmtDateTime(s.lastSuccess))}<br><span class="faint tiny">${esc(ago(s.lastSuccess))}</span>` : '<span class="na">never</span>'}</td><td class="small muted wrap" data-label="Notes">${esc(s.disabled ? s.note : s.lastError || '')}</td></tr>`).join('');
  return `<h1>Data sources & settings</h1>
  <p class="small muted">Spurs Intelligence is an unofficial fan site and is not affiliated with Tottenham Hotspur. The club crest is © Tottenham Hotspur and is shown from the Premier League's image server.</p>
  <div class="panel"><h2>Source health</h2><div class="table-wrap"><table class="stack"><thead><tr><th>Source</th><th>Status</th><th>Last success</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="source">Last automatic run ${esc(fmtDateTime(st.lastRun))} Bahrain (${esc(ago(st.lastRun))}). If a source fails, the last valid data stays on the site and retries continue automatically; after six failures in a row the repository owner gets an email from GitHub.</p></div>
  <div class="grid two section">
    <div class="panel"><h2>Update schedule</h2><div class="statlist" style="grid-template-columns:1fr">
      <div class="statrow"><span>Fixtures, scores, table, squad, availability</span><span class="small">every 20 min</span></div>
      <div class="statrow"><span>Player match statistics</span><span class="small">every 6 h; every 30 min after a match until complete</span></div>
      <div class="statrow"><span>Shots, passing, possession, cup matches</span><span class="small">every 3 h; every 30 min after a match</span></div>
      <div class="statrow"><span>Cup & European fixtures (cross-check)</span><span class="small">every 6 h; hourly on match days</span></div>
      <div class="statrow"><span>Analysis & official videos</span><span class="small">every 2 h; every 30 min on match days</span></div></div>
      <p class="source">Runs on GitHub Actions on a 20-minute schedule (GitHub may delay scheduled runs by a few minutes at busy times).</p></div>
    <div class="panel"><h2>Costs</h2><div class="statlist" style="grid-template-columns:1fr">
      <div class="statrow"><span>Hosting (GitHub Pages)</span><span class="v">$0</span></div><div class="statrow"><span>Scheduled jobs (GitHub Actions, public repository)</span><span class="v">$0</span></div>
      <div class="statrow"><span>Data (FPL API, community dataset, TheSportsDB free key, YouTube feeds)</span><span class="v">$0</span></div><div class="statrow"><span>Total per month</span><span class="v">$0</span></div></div>
      <p class="source">Request volumes and provider limits: ${Object.entries(st.quotaNotes || {}).map(([h, n]) => `${esc(h)} — ${esc(n)}`).join(' ')}</p></div>
  </div>
  <div class="panel section"><h2>Statistics: what is and isn't available</h2>
    <p class="small muted">Available (with source):</p><div class="unavail" style="margin-bottom:12px">${m.statDefs.map((d) => `<span style="border-style:solid;color:var(--text)">${esc(d.label)} <span class="faint">${d.src === 'fplcore' ? 'FotMob' : 'FPL'}</span></span>`).join('')}</div>
    ${m.nowAvailable ? `<p class="small muted">Collected and where to find it:</p><div class="statlist one">${m.nowAvailable.map(([what, where]) => `<div class="statrow"><span>${esc(what)}</span><span class="small muted" style="text-align:right">${esc(where)}</span></div>`).join('')}</div>` : ''}
    <p class="small muted" style="margin-top:14px">Still not available from any free source:</p><div class="unavail">${Object.values(m.unavailable).flat().filter((x, i, a) => a.indexOf(x) === i).map((u) => `<span>${esc(u)}</span>`).join('')}</div>
    <p class="source">Shots, passing, take-ons, possession and shot locations come from the FPL Core Insights community dataset, whose maintainer allows free use with a link back; its match statistics are collected from FotMob. Individual take-ons are not recorded by that source in 2026/27 (team totals are). A blank count for a player who featured is treated as zero only when the column was recorded for that match; otherwise it is shown as unavailable.</p></div>
  <div class="panel section"><h2>Settings</h2>
    <div class="filters"><label for="theme" class="small">Appearance</label><select class="ctl" id="theme"><option value="">Navy (default)</option><option value="light">Light</option></select></div>
    <p class="small muted">Times are shown in Bahrain time (UTC+3); stored data keeps the original UTC timestamps. Nothing here needs maintaining — updates run on their own.</p>
    <p class="small muted">Provider IDs resolved automatically: FPL team ${esc(m.providerTeamIds.fpl)}, TheSportsDB ${esc(m.providerTeamIds.thesportsdb || 'pending')}.</p></div>`;
};
AFTER.sources = () => {
  const t = document.getElementById('theme');
  try { t.value = localStorage.getItem('si-theme') || ''; } catch { /* ignore */ }
  t.addEventListener('change', () => { if (t.value) document.documentElement.dataset.theme = t.value; else delete document.documentElement.dataset.theme; try { localStorage.setItem('si-theme', t.value); } catch { /* ignore */ } });
};

boot();
