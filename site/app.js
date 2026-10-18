import { state, load, loadSeason, esc, fmt, fmtPlain, fmtDate, fmtTime, fmtDateTime, ago, statusText, resultChip, photoHtml, norm, sortableTable } from './lib.js';
import { lineChart, pairBars, shotMap, barList, xgRace, momentumChart } from './charts.js';
import { answer, renderAnswer, suggestions } from './analyst.js';

const NAV = [
  ['overview', 'Overview', 'i-home'], ['fixtures', 'Fixtures & results', 'i-cal'], ['players', 'Player Lab', 'i-user'], ['team', 'Team statistics', 'i-chart'],
  ['tactics', 'Tactical analysis', 'i-board'], ['video', 'Video Evidence Room', 'i-play'], ['squad', 'Squad planner', 'i-squad'], ['table', 'League table', 'i-table'],
  ['match', 'Match Centre', 'i-ball'], ['sources', 'Data sources & settings', 'i-gear'],
];
const BOTTOM = ['overview', 'fixtures', 'players', 'team'];
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
}

function buildNav() {
  document.getElementById('nav').innerHTML = NAV.map(([k, l, i]) => `<a href="#/${k}" data-k="${k}">${icon(i)}${l}</a>`).join('');
  document.getElementById('bottom-nav').innerHTML = BOTTOM.map((k) => { const n = NAV.find((x) => x[0] === k); return `<a href="#/${k}" data-k="${k}">${icon(n[2])}${n[1].split(' ')[0]}</a>`; }).join('') + `<button id="more-btn" aria-expanded="false">${icon('i-more')}More</button>`;
  const sheet = document.getElementById('more-sheet');
  sheet.innerHTML = NAV.filter(([k]) => !BOTTOM.includes(k)).map(([k, l, i]) => `<a href="#/${k}" data-k="${k}">${icon(i)}${l}</a>`).join('');
  const btn = document.getElementById('more-btn');
  btn.addEventListener('click', () => { const open = sheet.classList.toggle('open'); btn.setAttribute('aria-expanded', open); });
  sheet.addEventListener('click', () => { sheet.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
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
const fixtureRow = (f) => `<a class="fx" href="#/match/${encodeURIComponent(f.id)}">
  <div class="when">${esc(fmtDate(f.kickoff))}<br><span class="faint">${esc(fmtTime(f.kickoff))} Bahrain</span></div>
  <div><div class="who">${f.home ? '' : '@ '}${esc(f.opponent)}${f.home ? ' (H)' : ''}</div><div class="comp">${esc(f.competition)}${f.gameweek ? ` · GW${f.gameweek}` : ''}${f.status !== 'FT' && f.status !== 'SCHEDULED' ? ` · ${esc(statusText[f.status] || f.status)}` : ''}${f.kickoffHistory?.length ? ' · rescheduled' : ''}</div></div>
  <div class="scorebox">${f.score ? `${f.score.spurs}–${f.score.opp} ${resultChip(f.result, true)}` : `<span class="small muted" style="font-family:var(--body);font-weight:400">${f.status === 'POSTPONED' ? 'TBC' : ''}</span>`}</div></a>`;

const src = (text, at) => `<p class="source">Source: ${esc(text)}${at ? `. Retrieved ${esc(fmtDateTime(at))} (Bahrain)` : ''}.</p>`;
const per = (v, dp = 2) => fmt(v, dp);
const statDefs = () => state.meta.statDefs;

// ---------------- Overview ----------------
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
      <div class="fixture-board"><div class="team">${next.home ? 'Spurs' : esc(next.opponent)}</div>
        <div class="mid"><div class="clock">${next.status === 'LIVE' && next.score ? `${next.home ? next.score.spurs : next.score.opp}–${next.home ? next.score.opp : next.score.spurs}` : esc(fmtTime(next.kickoff))}</div><div class="vs">${esc(fmtDate(next.kickoff, { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div>
        <div class="team right">${next.home ? esc(next.opponent) : 'Spurs'}</div></div>
      <div class="countdown" id="countdown" data-k="${esc(next.kickoff || '')}"></div>
      <div class="hero-meta"><span>Kick-off <strong>${esc(fmtTime(next.kickoff))}</strong> Bahrain time</span><span>${next.home ? 'Tottenham Hotspur Stadium' : 'Away'}</span>${me ? `<span>Spurs are <strong>${ordinal(me.position)}</strong> on ${me.points} pts</span>` : ''}</div>
    </section>` : `<section class="hero"><div class="kicker">No upcoming fixture is listed yet for ${esc(s.replace('-', '/'))}.</div></section>`;
  return `${hero}
  <div class="grid four section">
    <div class="panel stat-tile"><span class="lbl">Latest result</span>${last ? `<a href="#/match/${encodeURIComponent(last.id)}" class="big" style="color:var(--text)">${last.score.spurs}–${last.score.opp} ${resultChip(last.result, true)}</a><span class="small muted">${last.home ? 'v' : '@'} ${esc(last.opponent)}, ${esc(fmtDate(last.kickoff))}</span>` : '<span class="na">No result yet</span>'}</div>
    <div class="panel stat-tile"><span class="lbl">League position</span>${me ? `<span class="big">${ordinal(me.position)}</span><span class="small muted">${me.played} played · ${me.points} pts · GD ${me.gd > 0 ? '+' : ''}${me.gd}</span>` : '<span class="na">—</span>'}</div>
    <div class="panel stat-tile"><span class="lbl">Premier League record</span><span class="big">${o.w}-${o.d}-${o.l}</span><span class="small muted">${o.gf} scored, ${o.ga} conceded</span></div>
    <div class="panel stat-tile"><span class="lbl">xG for / against</span><span class="big">${fmtPlain(o.xg, 1)} / ${fmtPlain(o.xga, 1)}</span><span class="small muted">${o.xgMatches} matches with xG</span></div>
  </div>
  <div class="grid two section">
    <div class="panel"><h2>Recent form</h2><div class="form-strip">${team.formAllComps.map((f) => `<a href="#/match/${encodeURIComponent(f.matchId)}" title="${esc(f.opponent)} (${esc(f.competition)})">${resultChip(f.result)}</a>`).join('') || '<span class="na">No matches yet</span>'}</div>
      <p class="small muted" style="margin-top:10px">Last ${team.formAllComps.length} competitive matches, oldest first. Last five PL: ${team.last5.w}W ${team.last5.d}D ${team.last5.l}L.</p>
      <h3 style="margin-top:18px">Chance quality, match by match</h3>
      ${lineChart({ labels: team.matches.map((m) => m.opponentShort || m.opponent.slice(0, 3)), series: [{ name: 'xG for', color: 'var(--cyan)', values: team.matches.map((m) => m.xg) }, { name: 'xG against', color: 'var(--loss)', values: team.matches.map((m) => m.xga) }], height: 200, format: (v) => v.toFixed(1) })}
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
    document.getElementById('fx-list').innerHTML = list.map(fixtureRow).join('') || '<div class="empty">No matches in this view.</div>';
  };
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); }));
  document.getElementById('comp').addEventListener('change', draw);
  draw();
};

// ---------------- Player Lab ----------------
const LAB_COLS = [
  ['minutes', 'Min', 0], ['goals', 'G', 0], ['assists', 'A', 0], ['xg', 'xG', 2], ['xa', 'xA', 2], ['shots', 'Shots', 0], ['chancesCreated', 'Chances', 0],
  ['dribbles', 'Take-ons won', 0], ['passesAcc', 'Acc. passes', 0], ['tacklesWon', 'Tackles won', 0], ['recoveries', 'Recoveries', 0], ['cbi', 'CBI', 0], ['saves', 'Saves', 0],
];
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
  <div class="panel" style="padding:6px"><div class="table-wrap" id="lab-table"></div></div>
  ${src(`${ps.source}; shots/passing/take-ons/tackles won from FPL Core Insights (FotMob). Per-90 uses minutes from matches where each statistic was recorded`, ps.generatedAt)}`;
};
AFTER.players = async () => {
  const ps = await loadSeason('players.json');
  const draw = () => {
    const pos = document.getElementById('f-pos').value; const comp = document.getElementById('f-comp').value; const mode = document.getElementById('f-mode').value; const who = document.getElementById('f-who').value;
    const rows = ps.players.filter((p) => (!pos || p.pos === pos) && (who === 'all' ? (p[comp]?.apps || 0) > 0 || p.current || p.membership === 'loan' : p.current));
    const cols = LAB_COLS.filter(([k]) => (mode === 'per90' ? k !== 'minutes' : true));
    const cell = (p, k, dp) => {
      const s = p[comp];
      if (!s) return '<td class="r" data-v=""><span class="na">—</span></td>';
      const v = mode === 'per90' && k !== 'minutes' ? s.per90?.[k] : s.totals?.[k];
      return `<td class="r" data-v="${v ?? ''}" data-label="${esc(k)}">${fmt(v, mode === 'per90' ? 2 : dp)}</td>`;
    };
    document.getElementById('lab-table').innerHTML = `<table data-sortable class="stack"><thead><tr><th class="sortable sticky-col">Player</th><th class="sortable">Pos</th><th class="sortable r">Apps</th>${mode === 'per90' ? '<th class="sortable r">Min</th>' : ''}${cols.map(([, l]) => `<th class="sortable r">${l}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((p) => `<tr class="clickable" data-href="#/player/${p.id}"><td class="sticky-col" data-v="${esc(p.web)}"><a href="#/player/${p.id}">${esc(p.web)}</a>${p.current ? '' : ` <span class="faint tiny">${esc(p.membershipLabel || 'former')}</span>`}${p.status && p.status !== 'a' ? ` <span class="tiny" style="color:var(--warn)">${esc(p.statusLabel)}</span>` : ''}</td><td data-v="${p.pos}" data-label="Pos">${p.pos}</td><td class="r" data-v="${p[comp]?.apps ?? ''}" data-label="Apps">${p[comp]?.apps ?? 0}</td>${mode === 'per90' ? `<td class="r" data-v="${p[comp]?.totals.minutes ?? ''}" data-label="Min">${p[comp]?.totals.minutes ?? 0}</td>` : ''}${cols.map(([k, , dp]) => cell(p, k, dp)).join('')}</tr>`).join('')}</tbody></table>`;
    const t = document.querySelector('#lab-table table');
    t.querySelectorAll('td[data-label]').forEach((td, i) => { const th = t.tHead.rows[0].cells[td.cellIndex]; if (th) td.dataset.label = th.textContent; void i; });
    sortableTable(t);
    t.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.hash = tr.dataset.href; });
  };
  ['f-pos', 'f-comp', 'f-mode', 'f-who'].forEach((id) => document.getElementById(id).addEventListener('change', draw));
  draw();
};

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
    const defs = statDefs().filter((d) => d.cat === cat && (d.pos === 'all' || (d.pos === 'gk' ? isGK : !isGK)));
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
    ${p.status && p.status !== 'a' ? `<p class="small" style="color:var(--warn);margin:6px 0 0">${esc(p.statusLabel)}${p.news ? ` — ${esc(p.news)}` : ''}${p.chanceNext !== null ? ` (chance of playing next round: ${p.chanceNext}%)` : ''}</p>` : ''}
    ${idx && idx.seasons.length > 1 ? `<p class="small muted" style="margin:6px 0 0">Other seasons: ${idx.seasons.filter((s) => s.season !== state.season).map((s) => `<a href="#" data-season="${s.season}">${s.season.replace('-', '/')}</a>`).join(', ')}</p>` : ''}</div></div>
  <div class="grid four section">
    <div class="panel stat-tile"><span class="lbl">PL appearances</span><span class="big">${p.season.apps}</span><span class="small muted">${p.season.totals.starts ?? '—'} starts · ${p.season.subApps ?? '—'} as sub</span></div>
    <div class="panel stat-tile"><span class="lbl">Minutes</span><span class="big">${p.season.totals.minutes ?? 0}</span><span class="small muted">All competitive: ${p.seasonAll?.totals.minutes ?? '—'}</span></div>
    <div class="panel stat-tile"><span class="lbl">${isGK ? 'Clean sheets' : 'Goals / assists'}</span><span class="big">${isGK ? fmt(p.season.totals.cs) : `${p.season.totals.goals ?? 0} / ${p.season.totals.assists ?? 0}`}</span><span class="small muted">${isGK ? `${fmtPlain(p.season.totals.gc)} conceded` : `All competitive: ${p.seasonAll?.totals.goals ?? '—'} / ${p.seasonAll?.totals.assists ?? '—'}`}</span></div>
    <div class="panel stat-tile"><span class="lbl">${isGK ? 'Goals prevented (xGOT − goals)' : 'Goals minus xG'}</span><span class="big">${isGK ? fmt(p.season.totals.goalsPrevented, 2) : fmt(p.season.derived.goalsMinusXg, 2)}</span><span class="small muted">${isGK ? 'From FotMob post-shot model' : 'Positive = finishing above chance quality'}</span></div>
  </div>
  ${data.summary ? `<div class="panel section"><div class="section-head"><h2>Scouting summary</h2><span class="label-analysis">Calculated, not official</span></div><p>${esc(data.summary.text)}</p><p class="tiny faint">${esc(data.summary.label)}.</p></div>` : ''}
  <div class="grid two section">
    ${isGK ? block('Goalkeeping', 'goalkeeping', which) : block('Attacking', 'attacking', which)}
    ${isGK ? block('Distribution & general', 'passing', which) : block('Passing & possession', 'passing', which)}
    ${block('Defending', 'defensive', which)}
    ${block('Discipline & FPL', 'discipline', which)}
  </div>
  <p class="source">Premier League ${esc(state.season.replace('-', '/'))}. <sup>F</sup> = FPL Core Insights (FotMob definitions); others = FPL API (Opta). "calc" = calculated rate from the same matches only. * = recorded in only some matches. Retrieved ${esc(fmtDateTime(data.generatedAt))}.</p>
  ${pct ? `<div class="panel section"><div class="section-head"><h2>Against Premier League ${esc(state.meta.posLabels[pct.pos].toLowerCase())}s</h2><span class="muted small">Percentile among ${pct.peers} with ${pct.minMinutes}+ minutes</span></div>
    ${Object.entries(pct.percentiles).filter(([, v]) => v !== null).map(([k, v]) => { const d = statDefs().find((x) => x.key === k); return `<div class="pbar"><span>${esc(d ? d.label : k)} /90</span><div class="track"><div class="fill" style="width:${v}%"></div></div><span class="num" style="text-align:right">${v}</span></div>`; }).join('')}
    <p class="source">Per-90 values from FPL season totals (all clubs, so a mid-season signing's figures include his previous PL club). For xG conceded and goals conceded, a lower percentile is better.</p></div>` : ''}
  ${matches.length > 1 ? `<div class="panel section"><h2>Form, match by match</h2>${lineChart({ labels: matches.map((m) => fmtDate(m.kickoff, { day: 'numeric', month: 'short' })), series: isGK ? [{ name: 'Saves', color: 'var(--cyan)', values: matches.map((m) => m.saves ?? m.gkSaves) }, { name: 'Goals conceded', color: 'var(--loss)', values: matches.map((m) => m.gc) }] : [{ name: 'xG', color: 'var(--cyan)', values: matches.map((m) => m.xg) }, { name: 'xA', color: 'var(--draw)', values: matches.map((m) => m.xa) }], format: (v) => v.toFixed(isGK ? 0 : 1) })}</div>` : ''}
  ${!isGK ? `<div class="panel section"><div class="section-head"><h2>Shot map</h2><select class="ctl" id="p-shot-match" aria-label="Match"><option value="">All matches (${(data.shots || []).length} shots)</option>${[...new Map((data.shots || []).map((x) => [x.matchId, x])).values()].map((x) => `<option value="${esc(x.matchId)}">${esc(fmtDate(x.kickoff, { day: 'numeric', month: 'short' }))} v ${esc(x.opponent)}</option>`).join('')}</select></div>
    <div id="p-shots">${shotMap(data.shots || [])}</div><p class="source">Shot locations from FotMob via FPL Core Insights, all competitions; updated after every match. About one shot in five has no player attached in the source and is not shown.</p></div>` : ''}
  <div class="panel section"><h2>Match log</h2><div class="table-wrap"><table data-sortable class="stack"><thead><tr><th class="sortable">Date</th><th>Match</th><th>Comp</th><th class="sortable r">Min</th><th class="sortable r">G</th><th class="sortable r">A</th><th class="sortable r">xG</th><th class="sortable r">xA</th><th class="sortable r">Shots</th><th class="sortable r">Chances</th><th class="sortable r">Recov.</th>${isGK ? '<th class="sortable r">Saves</th>' : ''}</tr></thead><tbody>
    ${matches.slice().reverse().map((m) => `<tr><td data-v="${esc(m.kickoff)}" data-label="Date">${esc(fmtDate(m.kickoff, { day: 'numeric', month: 'short' }))}</td><td data-label="Match"><a href="#/match/${encodeURIComponent(m.matchId)}">${m.home ? 'v' : '@'} ${esc(oppName(m))}</a></td><td data-label="Comp">${esc(m.comp === 'Premier League' ? 'PL' : m.comp)}</td>${['minutes', 'goals', 'assists', 'xg', 'xa', 'shots', 'chancesCreated', 'recoveries', ...(isGK ? ['saves'] : [])].map((k) => `<td class="r" data-v="${m[k] ?? ''}" data-label="${k}">${fmt(m[k], ['xg', 'xa'].includes(k) ? 2 : 0)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div></div>
  <div class="panel section flat"><h3>Not available from the free data sources</h3><div class="unavail">${[...un.identity, ...(isGK ? un.goalkeeping : []), 'Carries & progressive carries', 'Progressive passes', 'Pressures'].map((u) => `<span>${esc(u)}</span>`).join('')}${p.season.totals.dribbles === null && !isGK ? '<span>Take-ons (not recorded per player this season)</span>' : ''}</div></div>`;
};
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
  return `<h1>Compare players</h1><div class="filters"><select class="ctl" id="cmp-a" aria-label="First player"><option value="">First player</option>${opts(a)}</select><select class="ctl" id="cmp-b" aria-label="Second player"><option value="">Second player</option>${opts(b)}</select></div>${table}`;
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
  const blockRow = (name, b) => `<tr><td class="sticky-col">${name}</td><td class="r">${b.n}</td><td class="r">${b.w}-${b.d}-${b.l}</td><td class="r">${b.n ? (b.points / b.n).toFixed(2) : '—'}</td><td class="r">${b.gf ?? 0}–${b.ga ?? 0}</td><td class="r">${fmt(b.perMatch.xg.value, 2)}</td><td class="r">${fmt(b.perMatch.xga.value, 2)}</td><td class="r">${b.cleanSheets}</td></tr>`;
  const pm = (k) => adv?.perMatch[k];
  return `<h1>Team statistics</h1>
  <div class="panel"><h2>Premier League record by split</h2><div class="table-wrap"><table class="stack"><thead><tr><th class="sticky-col">Split</th><th class="r">P</th><th class="r">W-D-L</th><th class="r">Pts/game</th><th class="r">Goals</th><th class="r">xG/game</th><th class="r">xGA/game</th><th class="r">Clean sheets</th></tr></thead><tbody>
    ${blockRow('Season', o)}${blockRow('Home', team.home)}${blockRow('Away', team.away)}${blockRow('Last 5', team.last5)}${blockRow('Last 10', team.last10)}
    ${prevTeams.map((t, i) => (t ? blockRow(`${prev[i].replace('-', '/')} season`, t.overall) : '')).join('')}</tbody></table></div>
    <p class="source">xG against = xG conceded while on the pitch for a Spurs player who completed the match (FPL/Opta). Earlier seasons from the archived FPL dataset; xG exists from mid-2022/23.</p></div>
  <div class="panel section"><h2>All competitions</h2><div class="table-wrap"><table><thead><tr><th>Competition</th><th class="r">P</th><th class="r">W-D-L</th><th class="r">Goals</th></tr></thead><tbody>${Object.entries(team.byCompetition).map(([c, b]) => `<tr><td>${esc(c)}</td><td class="r">${b.n}</td><td class="r">${b.w}-${b.d}-${b.l}</td><td class="r">${b.gf}–${b.ga}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="panel section"><h2>xG trend</h2>${lineChart({ labels: team.matches.map((m) => m.opponentShort || m.opponent.slice(0, 3)), series: [{ name: 'xG for', color: 'var(--cyan)', values: team.matches.map((m) => m.xg) }, { name: 'xG against', color: 'var(--loss)', values: team.matches.map((m) => m.xga) }, { name: 'Goals for', color: 'var(--win)', values: team.matches.map((m) => m.gf), dash: true }], format: (v) => v.toFixed(1) })}</div>
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
    <h2 style="margin-top:18px">By situation</h2>${situationTable(adv.situations)}</div></div>` : '<div class="banner info section">Possession, shots and passing appear here once the supplementary match source has data for this season.</div>'}
  <div class="panel section"><h2>Defensive actions per match (FPL)</h2><div class="statlist">${['tackles', 'cbi', 'recoveries', 'defcon', 'saves', 'yc'].map((k) => `<div class="statrow"><span>${esc({ tackles: 'Tackles', cbi: 'Clearances, blocks & interceptions', recoveries: 'Recoveries', defcon: 'Defensive contribution', saves: 'Saves', yc: 'Yellow cards' }[k])}</span><span class="v">${fmt(o.perMatch[k].value, 1)}</span></div>`).join('')}</div>
    <p class="source">Not available free: ${esc(state.meta.unavailable.team.filter((x) => !/Possession|Shots|Pass accuracy|Big chances|Set-piece|First\/second/.test(x)).join(', '))}.</p></div>`;
};
const SIT = { regular: 'Open play (regular)', assisted: 'Open play (assisted)', 'fast-break': 'Fast break', 'set-piece': 'Set piece', corner: 'Corner', 'free-kick': 'Direct free kick', penalty: 'Penalty', 'throw-in-set-piece': 'Throw-in set piece', unknown: 'Unknown' };
function situationTable(s) {
  if (!s || !Object.keys(s).length) return '<p class="na">No shot data yet.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Situation</th><th class="r">Shots for</th><th class="r">Goals</th><th class="r">xG</th><th class="r">Shots ag.</th><th class="r">Goals</th><th class="r">xG</th></tr></thead><tbody>${Object.entries(s).sort((a, b) => b[1].for.xg + b[1].against.xg - a[1].for.xg - a[1].against.xg).map(([k, v]) => `<tr><td>${esc(SIT[k] || k)}</td><td class="r">${v.for.shots}</td><td class="r">${v.for.goals}</td><td class="r">${fmtPlain(v.for.xg, 2)}</td><td class="r">${v.against.shots}</td><td class="r">${v.against.goals}</td><td class="r">${fmtPlain(v.against.xg, 2)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------------- Tactics ----------------
VIEWS.tactics = async () => {
  const [a, team, ps] = await Promise.all([loadSeason('analysis.json', state.season, { optional: true }), loadSeason('team.json'), loadSeason('players.json')]);
  if (!a) return '<h1>Tactical analysis</h1><div class="empty">Tactical analysis is generated for the current season only. Switch to the current season.</div>';
  const t = a.tactical;
  const dz = t.deZerbi;
  return `<div class="section-head"><h1>Tactical analysis: De Zerbi's Tottenham</h1><span class="label-analysis">Calculated analysis</span></div>
  <p class="muted">Head coach: ${esc(state.meta.headCoach || 'unknown')}. Everything below is generated by fixed rules from the stored match data. Measured evidence is kept separate from interpretation, and areas the data cannot measure are listed as such.</p>
  <div class="panel section"><h2>Coach comparison (Premier League)</h2><div class="table-wrap"><table class="stack"><thead><tr><th class="sticky-col">Coach</th><th class="r">Matches</th><th class="r">Pts/game</th><th class="r">Goals/game</th><th class="r">Conceded/game</th><th class="r">xG/game</th><th class="r">xGA/game</th><th class="r">Tackles + CBI</th></tr></thead><tbody>
    ${t.eras.map((e) => `<tr class="${e.coach === 'Roberto De Zerbi' ? 'hl' : ''}"><td class="sticky-col" data-label="Coach">${esc(e.coach)}</td><td class="r" data-label="Matches">${e.matches}</td><td class="r" data-label="Pts/game">${fmt(e.ppg, 2)}</td><td class="r" data-label="Goals/game">${fmt(e.gfPer, 2)}</td><td class="r" data-label="Conceded/game">${fmt(e.gaPer, 2)}</td><td class="r" data-label="xG/game">${fmt(e.xgPer, 2)}</td><td class="r" data-label="xGA/game">${fmt(e.xgaPer, 2)}</td><td class="r" data-label="Tackles + CBI">${fmt(e.defActionsPer, 1)}</td></tr>`).join('')}</tbody></table></div>
    <p class="source">Stored seasons from 2020/21. Small samples (fewer than ~10 matches) are unreliable.</p></div>
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
VIEWS.video = async () => {
  const ev = await loadSeason('evidence.json', state.season, { optional: true });
  const items = ev ? ev.items : [];
  const kinds = { highlights: 'Match highlights', goals: 'Goals', interview: 'Interviews & reaction', press: 'Press conferences', preview: 'Previews', other: 'Other club video' };
  return `<div class="section-head"><h1>Video Evidence Room</h1><span class="muted small">${items.length} official videos indexed</span></div>
  <div class="banner info">Videos come only from the official Tottenham Hotspur and Premier League YouTube channels and play in YouTube's own player. Each is linked to a match by its title and publication date. No clip boundaries or timestamps are claimed, and no video is described as showing a specific action, because the free data has no verified event-to-video timing. Match highlights are therefore marked <strong>contextual</strong> evidence for that match's statistics; anything else is <strong>illustrative</strong>.</div>
  <div class="filters"><select class="ctl" id="v-kind" aria-label="Type"><option value="">All types</option>${Object.entries(kinds).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><input class="ctl" id="v-q" placeholder="Filter by opponent or title" aria-label="Filter videos"><label class="small"><input type="checkbox" id="v-linked"> Linked to a match only</label></div>
  <div class="grid three" id="v-grid"></div>
  <p class="source">Feed retrieval: ${esc(fmtDateTime(state.meta.dataUpdatedAt.video))}. YouTube's public feeds list each channel's latest uploads, so the library grows from when this site started collecting.</p>`;
};
AFTER.video = async () => {
  const ev = await loadSeason('evidence.json', state.season, { optional: true });
  const items = ev ? ev.items : [];
  const draw = () => {
    const k = document.getElementById('v-kind').value; const q = norm(document.getElementById('v-q').value); const linked = document.getElementById('v-linked').checked;
    const list = items.filter((v) => (!k || v.kind === k) && (!q || norm(`${v.title} ${v.opponent || ''}`).includes(q)) && (!linked || v.matchId));
    document.getElementById('v-grid').innerHTML = list.map((v) => `<div class="panel video-card"><button class="thumb" data-vid="${esc(v.videoId)}" aria-label="Play ${esc(v.title)}"><img loading="lazy" alt="" src="${esc(v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`)}"></button>
      <strong>${esc(v.title)}</strong><span class="small muted">${esc(v.channel)} · ${esc(fmtDate(v.published, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
      <span class="small">${v.matchId ? `Match: <a href="#/match/${encodeURIComponent(v.matchId)}">${esc(v.opponent)} (${esc(v.competition)})</a>` : '<span class="faint">Not linked to a match</span>'}</span>
      <span class="small"><span class="badge ${v.relation === 'contextual' ? 'partial' : 'no'}">${v.relation === 'contextual' ? 'Contextual' : 'Illustrative'}</span> <span class="faint">${esc(v.matchConfidence)}</span></span>
      <a class="small" href="${esc(v.url)}" target="_blank" rel="noopener">Open on YouTube</a></div>`).join('') || '<div class="empty">No videos match. The library fills automatically as the official channels publish.</div>';
  };
  document.getElementById('v-grid').addEventListener('click', (e) => { const b = e.target.closest('[data-vid]'); if (b) b.outerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.dataset.vid)}?autoplay=1" title="Video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`; });
  ['v-kind', 'v-q', 'v-linked'].forEach((id) => document.getElementById(id).addEventListener('input', draw));
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
    ${sq.notes.map((n) => `<p class="tiny faint">${esc(n)}</p>`).join('')}</div>
  ${[['loans', 'Out on loan'], ['departures', 'Left the club this season'], ['unregistered', 'Not in the registered squad']].filter(([k]) => sq[k]?.length).map(([k, title]) => `<div class="panel section"><h2>${title}</h2>${sq[k].map((d) => `<div class="statrow"><span><a href="#/player/${d.playerId}">${esc(d.name)}</a> <span class="faint tiny">${esc(d.pos || '')}</span></span><span class="small muted" style="text-align:right">${esc(d.note || '')}${d.apps ? ` · ${d.apps} Spurs apps this season` : ''}</span></div>`).join('')}<p class="tiny faint">Status and note as published by the Premier League (FPL player list). These players are excluded from the current squad, depth charts and replacement analysis.</p></div>`).join('')}`;
};
AFTER.squad = async () => {
  const a = await loadSeason('analysis.json', state.season, { optional: true });
  const sel = document.getElementById('rep-player'); if (!sel) return;
  const draw = () => { const r = a.squad.replacements[sel.value] || []; document.getElementById('rep-out').innerHTML = `<div class="table-wrap"><table class="stack"><thead><tr><th>Player</th><th>Club</th><th class="r">Age</th><th class="r">PL minutes</th><th class="r">Similarity</th></tr></thead><tbody>${r.map((x) => `<tr><td data-label="Player">${esc(x.name)}</td><td data-label="Club">${esc(x.team)}</td><td class="r" data-label="Age">${fmt(x.age)}</td><td class="r" data-label="Minutes">${x.minutes}</td><td class="r" data-label="Similarity">${x.similarity}%</td></tr>`).join('')}</tbody></table></div>`; };
  sel.addEventListener('change', draw); draw();
};

// ---------------- League table ----------------
VIEWS.table = async () => {
  const t = await loadSeason('table.json');
  const v = t.verification || {};
  return `<div class="section-head"><h1>Premier League table</h1><span class="muted small">${esc(state.season.replace('-', '/'))}</span></div>
  <div class="panel" style="padding:6px"><div class="table-wrap"><table><thead><tr><th class="r">#</th><th>Club</th><th class="r">P</th><th class="r">W</th><th class="r">D</th><th class="r">L</th><th class="r">GF</th><th class="r">GA</th><th class="r">GD</th><th class="r">Pts</th><th>Form</th></tr></thead><tbody>
  ${t.rows.map((r) => `<tr class="${r.teamId === t.spurs?.teamId ? 'hl' : ''}"><td class="r">${r.position}</td><td>${esc(r.team)}</td><td class="r">${r.played}</td><td class="r">${r.won}</td><td class="r">${r.drawn}</td><td class="r">${r.lost}</td><td class="r">${r.gf}</td><td class="r">${r.ga}</td><td class="r">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="r"><strong>${r.points}</strong></td><td><span class="form-strip">${r.form.map((x) => resultChip(x, true)).join('')}</span></td></tr>`).join('')}</tbody></table></div></div>
  <p class="source">${esc(t.source)}, ordered by points, goal difference, goals scored, then head-to-head. Includes provisionally finished matches. Retrieved ${esc(fmtDateTime(t.generatedAt))}.
  ${v.fplOfficialPosition ? ` Cross-check with the Premier League's published position: ${v.fplOfficialPosition.agrees ? 'matches' : `differs (official ${v.fplOfficialPosition.position})`}.` : ''}
  ${v.footballData ? ` football-data.org check: ${v.footballData.agrees ? 'matches' : 'differs'} (${esc(fmtDateTime(v.footballData.retrievedAt))}).` : ''}</p>`;
};

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
    <div class="fixture-board"><div class="team">${esc(L)}</div><div class="mid"><div class="clock">${sc}</div><div class="vs">${esc(fmtDate(f.kickoff, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}, ${esc(fmtTime(f.kickoff))} Bahrain</div></div><div class="team right">${esc(R)}</div></div>
    <div class="hero-meta"><span>${f.home ? 'Home' : 'Away'}${f.venueName ? ` · ${esc(f.venueName)}` : ''}</span>${f.kickoffHistory?.length ? `<span>Rescheduled (was ${esc(fmtDateTime(f.kickoffHistory[f.kickoffHistory.length - 1].was))})</span>` : ''}${f.verification ? `<span>Score ${f.verification.agrees ? 'confirmed' : 'differs'} by ${esc(f.verification.source)}</span>` : ''}</div></section>
  <div class="grid two section">
    <div class="panel"><h2>Key events</h2>
      ${goals.length ? goals.map((g) => `<div class="statrow"><span>${g.team === 'spurs' ? '⚽ ' : ''}<strong>${esc(g.player || 'Unknown')}</strong> <span class="muted small">${g.team === 'spurs' ? 'Spurs' : esc(f.opponent)} · ${esc(SIT[g.situation] || g.situation || '')}</span></span><span class="v">${g.minute}'${g.added ? `+${g.added}` : ''}</span></div>`).join('') : ev('goal').map((e) => `<div class="statrow"><span><strong>${esc(e.player)}</strong> <span class="muted small">${e.team === 'spurs' ? 'Spurs' : esc(f.opponent)}</span></span><span class="v">${e.value > 1 ? `${e.value} goals` : 'Goal'}</span></div>`).join('') || '<p class="na">No goals.</p>'}
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
  ${d?.shots?.length ? `<div class="grid two section"><div class="panel"><h2>Spurs shots</h2>${shotMap(d.shots.filter((s) => s.team === 'spurs'))}</div><div class="panel"><h2>${esc(f.opponent)} shots</h2>${shotMap(d.shots.filter((s) => s.team === 'opp'))}</div></div>` : ''}
  <div class="panel section"><div class="section-head"><h2>Spurs players</h2>${m.lineup.length ? `<div class="tabs" role="group" aria-label="Statistic group">${Object.keys(MATCH_TABS).map((t, i) => `<button data-mtab="${t}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>` : ''}</div>
    <div id="m-lineup">${m.lineup.length ? lineupTable(m.lineup, 'Attacking') : '<p class="na">Player statistics are not available for this match yet.</p>'}</div>
    ${m.statsComplete === false && f.status !== 'SCHEDULED' ? '<p class="small" style="color:var(--warn)">Statistics may still be incomplete; the site re-checks automatically after each match.</p>' : ''}</div>
  ${m.videos?.length ? `<div class="panel section"><h2>Official video</h2><div class="grid three">${m.videos.map((v) => `<div class="video-card"><a href="${esc(v.url)}" target="_blank" rel="noopener"><img loading="lazy" alt="" src="${esc(v.thumbnail || '')}" style="width:100%;border-radius:8px"></a><span class="small">${esc(v.title)}</span><span class="badge ${v.relation === 'contextual' ? 'partial' : 'no'}">${v.relation === 'contextual' ? 'Contextual' : 'Illustrative'}</span></div>`).join('')}</div></div>` : ''}
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
  if (!id) return;
  const m = await loadSeason(`matches/${id}.json`, state.season, { optional: true });
  if (!m || !m.lineup.length) return;
  document.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-mtab]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    const box = document.getElementById('m-lineup'); box.innerHTML = lineupTable(m.lineup, b.dataset.mtab); sortableTable(box.querySelector('table'));
  }));
};

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

// ---------------- Data sources & settings ----------------
VIEWS.sources = async () => {
  const st = await load('status.json', { fresh: true });
  const m = state.meta;
  const rows = Object.entries(st.sources).map(([k, s]) => `<tr><td>${esc(s.label || k)}</td><td>${s.disabled ? '<span class="badge partial">Off</span>' : s.consecutiveFailures ? `<span class="badge ${s.consecutiveFailures >= 6 ? 'no' : 'partial'}">Failing ×${s.consecutiveFailures}</span>` : '<span class="badge yes">Healthy</span>'}</td><td>${s.lastSuccess ? `${esc(fmtDateTime(s.lastSuccess))}<br><span class="faint tiny">${esc(ago(s.lastSuccess))}</span>` : '<span class="na">never</span>'}</td><td class="small muted" style="white-space:normal;min-width:200px">${esc(s.disabled ? s.note : s.lastError || '')}</td></tr>`).join('');
  return `<h1>Data sources & settings</h1>
  <div class="panel"><h2>Source health</h2><div class="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Last success</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="source">Last automatic run ${esc(fmtDateTime(st.lastRun))} Bahrain (${esc(ago(st.lastRun))}). If a source fails, the last valid data stays on the site and retries continue automatically; after six failures in a row the repository owner gets an email from GitHub.</p></div>
  <div class="grid two section">
    <div class="panel"><h2>Update schedule</h2><div class="statlist" style="grid-template-columns:1fr">
      <div class="statrow"><span>Fixtures, scores, table, squad, availability</span><span class="small">every 20 min</span></div>
      <div class="statrow"><span>Player match statistics</span><span class="small">every 6 h; every 30 min after a match until complete</span></div>
      <div class="statrow"><span>Shots, passing, possession, cup matches</span><span class="small">every 3 h; every 30 min after a match</span></div>
      <div class="statrow"><span>Cup & European fixtures (cross-check)</span><span class="small">every 6 h; hourly on match days</span></div>
      <div class="statrow"><span>Official videos</span><span class="small">every 2 h; every 30 min on match days</span></div></div>
      <p class="source">Runs on GitHub Actions on a 20-minute schedule (GitHub may delay scheduled runs by a few minutes at busy times).</p></div>
    <div class="panel"><h2>Costs</h2><div class="statlist" style="grid-template-columns:1fr">
      <div class="statrow"><span>Hosting (GitHub Pages)</span><span class="v">$0</span></div><div class="statrow"><span>Scheduled jobs (GitHub Actions, public repository)</span><span class="v">$0</span></div>
      <div class="statrow"><span>Data (FPL API, community dataset, TheSportsDB free key, YouTube feeds)</span><span class="v">$0</span></div><div class="statrow"><span>Total per month</span><span class="v">$0</span></div></div>
      <p class="source">Request volumes and provider limits: ${Object.entries(st.quotaNotes || {}).map(([h, n]) => `${esc(h)} — ${esc(n)}`).join(' ')}</p></div>
  </div>
  <div class="panel section"><h2>Statistics: what is and isn't available</h2>
    <p class="small muted">Available (with source):</p><div class="unavail" style="margin-bottom:12px">${m.statDefs.map((d) => `<span style="border-style:solid;color:var(--text)">${esc(d.label)} <span class="faint">${d.src === 'fplcore' ? 'FotMob' : 'FPL'}</span></span>`).join('')}</div>
    <p class="small muted">Not available from any free source:</p><div class="unavail">${Object.values(m.unavailable).flat().filter((x, i, a) => a.indexOf(x) === i).map((u) => `<span>${esc(u)}</span>`).join('')}</div>
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
