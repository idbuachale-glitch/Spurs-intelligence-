// Assembles one season's website dataset from normalised provider data.
// Used identically by the live sync and by the historical backfill.
import { STATS, POS, normalizePos, playerMatch, aggregate, resultOf, leagueTable, round, ageOn } from './stats.js';
import { num } from '../lib/validate.js';
import { recordedColumns, playerRow as fcPlayerRow, teamSide, shotRow, tournamentLabel, opponentFromSlug } from '../adapters/fplcore.js';

const TEAM_ALIASES = {
  'man utd': ['manchester united', 'man utd', 'man united'],
  'man city': ['manchester city', 'man city'],
  "nott'm forest": ['nottingham forest', "nott'm forest", 'forest'],
  wolves: ['wolverhampton', 'wolves'],
  spurs: ['tottenham', 'spurs'],
  brighton: ['brighton'],
  newcastle: ['newcastle'],
  'west ham': ['west ham'],
  leeds: ['leeds'],
  leicester: ['leicester'],
  ipswich: ['ipswich'],
  'ipswich town': ['ipswich'],
  'hull city': ['hull'],
  'coventry city': ['coventry'],
  'crystal palace': ['crystal palace', 'palace'],
  'aston villa': ['aston villa', 'villa'],
  'sheffield utd': ['sheffield united', 'sheffield utd'],
};
export const teamAliases = (name) => TEAM_ALIASES[String(name).toLowerCase()] || [String(name).toLowerCase()];

export function fplFixtureStatus(f) {
  if (f.event === null || f.event === undefined || !f.kickoff_time) return 'POSTPONED';
  if (f.finished) return 'FT';
  if (f.finished_provisional) return 'FT_PROVISIONAL';
  if (f.started) return 'LIVE';
  return 'SCHEDULED';
}

function parseStats(stats) {
  if (Array.isArray(stats)) return stats;
  if (typeof stats === 'string' && stats.startsWith('[')) {
    try { return JSON.parse(stats.replace(/'/g, '"').replace(/\bNone\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false')); } catch { return []; }
  }
  return [];
}

const EVENT_TYPES = { goals_scored: 'goal', assists: 'assist', own_goals: 'own_goal', yellow_cards: 'yellow', red_cards: 'red', penalties_saved: 'pen_saved', penalties_missed: 'pen_missed', saves: 'saves', bonus: 'bonus' };

export function buildSeason(input) {
  const {
    season, generatedAt, isCurrent = false, teams, spursId, fplFixtures, elements, histories,
    cupMatches = [], prevFixtures = [], videos = [], regions = new Map(), aliases = {}, sourceRef,
    detail = { matches: [], players: [], shots: [], momentum: [], xgMinute: [], leagueMatches: [] }, clubCode = null, spursElementIds = new Set(),
  } = input;
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const nameOf = (id) => { const e = elements.get(id); return e ? (e.web_name || `${e.first_name} ${e.second_name}`) : `Player ${id}`; };
  const prevById = new Map(prevFixtures.map((f) => [f.id, f]));

  // ---- League fixtures (for the table) and Spurs fixtures ----
  const tableFixtures = fplFixtures.map((f) => ({
    id: f.id, homeId: num(f.team_h), awayId: num(f.team_a), hs: num(f.team_h_score), as: num(f.team_a_score), kickoff: f.kickoff_time,
    counted: Boolean((f.finished || f.finished_provisional) && num(f.team_h_score) !== null && num(f.team_a_score) !== null),
  }));
  const spursFpl = fplFixtures.filter((f) => num(f.team_h) === spursId || num(f.team_a) === spursId);
  const spursFixtureIds = new Map(spursFpl.map((f) => [num(f.id), f]));

  const fixtures = spursFpl.map((f) => {
    const home = num(f.team_h) === spursId;
    const opp = teamById.get(home ? num(f.team_a) : num(f.team_h));
    const hs = num(f.team_h_score); const as = num(f.team_a_score);
    const id = `pl-${season}-${f.id}`;
    const status = fplFixtureStatus(f);
    const score = hs !== null && as !== null && status !== 'SCHEDULED' && status !== 'POSTPONED' ? { spurs: home ? hs : as, opp: home ? as : hs } : null;
    const prev = prevById.get(id);
    const kickoffHistory = [...((prev && prev.kickoffHistory) || [])];
    if (prev && prev.kickoff && f.kickoff_time && prev.kickoff !== f.kickoff_time) kickoffHistory.push({ was: prev.kickoff, changedAt: generatedAt });
    const events = [];
    for (const s of parseStats(f.stats)) {
      const type = EVENT_TYPES[s.identifier];
      if (!type) continue;
      for (const side of ['h', 'a']) {
        for (const x of s[side] || []) {
          const isSpurs = (side === 'h') === home;
          events.push({ type, team: isSpurs ? 'spurs' : 'opp', playerId: x.element, player: nameOf(x.element), value: x.value });
        }
      }
    }
    return {
      id, source: 'fpl', sourceId: num(f.id), competition: 'Premier League', competitionId: 'pl', gameweek: num(f.event),
      kickoff: f.kickoff_time || null, kickoffHistory, home, opponent: opp ? opp.name : 'Unknown', opponentShort: opp ? opp.short : null,
      opponentTeamId: opp ? opp.id : null, venue: home ? 'Home' : 'Away', status, minute: status === 'LIVE' ? num(f.minutes) : null,
      score, result: score ? resultOf(score.spurs, score.opp) : null, events,
    };
  });

  // ---- Supplementary match detail (FPL Core Insights): PL enrichment + other competitions ----
  const teamByCode = new Map(teams.filter((t) => t.code !== undefined && t.code !== null).map((t) => [Number(t.code), t]));
  const group = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
  const fcPlayersByMatch = group(detail.players, 'match_id');
  const fcShotsByMatch = group(detail.shots, 'match_id');
  const fcMomentumByMatch = group(detail.momentum || [], 'match_id');
  const fcXgMinuteByMatch = group(detail.xgMinute || [], 'match_id');
  const fcByFixture = new Map(); // fixture id -> { row, home }
  for (const d of detail.matches) {
    const m = d.row;
    const comp = tournamentLabel(d.tournament);
    const hc = num(m.home_team); const ac = num(m.away_team);
    const slugLeftIsClub = /-tottenham-hotspur-vs-/.test(m.match_id) || /^\d\d-\d\d-[a-z-]*?tottenham-hotspur-vs-/.test(m.match_id);
    const home = hc === clubCode ? true : ac === clubCode ? false : slugLeftIsClub;
    const oppTeam = teamByCode.get(home ? ac : hc);
    const processed = m.player_stats_processed === 'True';
    const shots = (fcShotsByMatch.get(m.match_id) || []).map((x) => { const sh = shotRow(x); return { ...sh, player: sh.player || (sh.elementId !== null && elements.has(sh.elementId) ? nameOf(sh.elementId) : null), team: (x.is_home === 'True') === home ? 'spurs' : 'opp' }; });
    // Momentum: the source's per-minute attacking-momentum value is positive for the
    // home side; it is flipped so positive always means Spurs.
    const momentum = (fcMomentumByMatch.get(m.match_id) || []).map((x) => ({ minute: num(x.minute), value: num(x.value) === null ? null : (home ? 1 : -1) * num(x.value) }))
      .filter((x) => x.minute !== null && x.value !== null).sort((a, b) => a.minute - b.minute);
    const xgRace = (fcXgMinuteByMatch.get(m.match_id) || []).map((x) => ({ minute: num(x.minute), spurs: num(home ? x.home_cumulative_xg : x.away_cumulative_xg), opp: num(home ? x.away_cumulative_xg : x.home_cumulative_xg) }))
      .filter((x) => x.minute !== null).sort((a, b) => a.minute - b.minute);
    const fotmobUrl = m.match_url && /^\/matches\//.test(m.match_url) ? `https://www.fotmob.com${m.match_url}` : null;
    const det = { source: 'fplcore', key: m.match_id, fotmobUrl, spurs: teamSide(m, home ? 'home' : 'away'), opp: teamSide(m, home ? 'away' : 'home'), shots, processed, momentum, xgRace };
    if (comp === 'Premier League') {
      const f = fixtures.find((x) => x.source === 'fpl' && x.gameweek === num(m.gameweek) && oppTeam && x.opponentTeamId === oppTeam.id)
        || fixtures.find((x) => x.source === 'fpl' && x.kickoff && m.kickoff_time && Math.abs(Date.parse(x.kickoff) - Date.parse(`${m.kickoff_time}Z`)) < 48 * 3600e3 && oppTeam && x.opponentTeamId === oppTeam.id);
      if (f && m.finished === 'True') { f.detail = det; fcByFixture.set(f.id, { row: m, home }); }
      continue;
    }
    const hs = num(m.home_score); const as = num(m.away_score);
    const finished = m.finished === 'True' && hs !== null && as !== null;
    const score = finished ? { spurs: home ? hs : as, opp: home ? as : hs } : null;
    const f = {
      id: `fc-${m.match_id}`, source: 'fplcore', sourceId: m.match_id, competition: comp, competitionId: d.tournament, gameweek: null,
      kickoff: m.kickoff_time ? `${m.kickoff_time.replace(/Z$/, '')}Z` : null, kickoffHistory: [], home,
      opponent: oppTeam ? oppTeam.name : opponentFromSlug(m.match_id) || 'Unknown', opponentShort: oppTeam ? oppTeam.short : null, opponentTeamId: oppTeam ? oppTeam.id : null,
      venue: home ? 'Home' : 'Away', status: finished ? 'FT' : 'SCHEDULED', minute: null, score, result: score ? resultOf(score.spurs, score.opp) : null,
      events: [], friendly: comp === 'Friendly', detail: finished ? det : null,
    };
    fixtures.push(f);
    if (finished) fcByFixture.set(f.id, { row: m, home });
  }

  for (const c of cupMatches) {
    if (/premier league/i.test(c.competition)) continue; // PL comes from the primary source
    const twin = fixtures.find((f) => f.source === 'fplcore' && f.kickoff && c.kickoff && Math.abs(Date.parse(f.kickoff) - Date.parse(c.kickoff)) < 36 * 3600e3
      && teamAliases(c.opponent).some((a) => f.opponent.toLowerCase().includes(a.split(' ')[0])));
    if (twin) {
      if (twin.score && c.score) twin.verification = { source: 'thesportsdb', agrees: twin.score.spurs === c.score.spurs && twin.score.opp === c.score.opp, other: c.score };
      if (!twin.venueName && c.venue) twin.venueName = c.venue;
      continue;
    }
    fixtures.push({ ...c, result: c.score ? resultOf(c.score.spurs, c.score.opp) : null, events: [], friendly: /friendl/i.test(c.competition) });
  }
  fixtures.sort((a, b) => String(a.kickoff || '9999').localeCompare(String(b.kickoff || '9999')));

  // Independent verification of PL scores against TheSportsDB.
  for (const f of fixtures.filter((x) => x.source === 'fpl' && x.score)) {
    const twin = cupMatches.find((c) => /premier league/i.test(c.competition) && c.score && c.kickoff && f.kickoff
      && Math.abs(Date.parse(c.kickoff) - Date.parse(f.kickoff)) < 36 * 3600e3
      && teamAliases(f.opponent).some((a) => String(c.opponent).toLowerCase().includes(a)));
    if (twin) f.verification = { source: 'thesportsdb', agrees: twin.score.spurs === f.score.spurs && twin.score.opp === f.score.opp, other: twin.score };
  }

  // ---- Player match records (Spurs matches only, Spurs side only) ----
  const playerRows = new Map(); // elementId -> [records]
  for (const [elementId, rows] of histories) {
    const recs = [];
    for (const row of rows) {
      const fx = spursFixtureIds.get(num(row.fixture));
      if (!fx) continue;
      const wasHome = row.was_home === true || row.was_home === 'True';
      if (wasHome !== (num(fx.team_h) === spursId)) continue; // played for the opponent in this fixture
      const r = playerMatch(row);
      r.matchId = `pl-${season}-${r.fixture}`;
      recs.push(r);
    }
    if (recs.length) playerRows.set(elementId, recs.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff))));
  }

  for (const recs of playerRows.values()) for (const r of recs) r.comp = 'Premier League';
  blankUnrecordedStats(playerRows);

  const ADV = STATS.filter((x) => x.src === 'fplcore').map((x) => x.key);
  for (const [fixtureId, { row: m }] of fcByFixture) {
    const f = fixtures.find((x) => x.id === fixtureId);
    const processed = m.player_stats_processed === 'True';
    const rawRows = fcPlayersByMatch.get(m.match_id) || [];
    const recorded = recordedColumns(rawRows);
    for (const raw of rawRows) {
      const adv = fcPlayerRow(raw, processed, recorded);
      if (f.source === 'fpl') {
        const rec = (playerRows.get(adv.elementId) || []).find((r) => r.matchId === fixtureId);
        if (rec) for (const k of ADV) rec[k] = adv[k];
      } else if (spursElementIds.has(adv.elementId) && (adv.minutes || 0) > 0) {
        const rec = { fixture: null, round: null, kickoff: f.kickoff, home: f.home, opponentTeamId: f.opponentTeamId, matchId: fixtureId, comp: f.competition };
        for (const st of STATS) rec[st.key] = null;
        for (const k of ADV) rec[k] = adv[k];
        Object.assign(rec, { minutes: adv.minutes, goals: adv.goals, assists: adv.assists, starts: adv.starter === null ? null : adv.starter ? 1 : 0 });
        if (!playerRows.has(adv.elementId)) playerRows.set(adv.elementId, []);
        playerRows.get(adv.elementId).push(rec);
      }
    }
  }
  const fxById = new Map(fixtures.map((f) => [f.id, f]));
  for (const recs of playerRows.values()) {
    recs.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
    for (const r of recs) { const f = fxById.get(r.matchId); if (f) { r.opponent = f.opponent; r.result = f.result; } }
  }

  // ---- Players ----
  const players = [];
  const playerFiles = {};
  const ids = new Set([...playerRows.keys(), ...[...elements.values()].filter((e) => num(e.team) === spursId).map((e) => e.id)]);
  for (const elementId of ids) {
    const e = elements.get(elementId);
    if (!e) continue;
    const pos = normalizePos(e.element_type);
    if (!pos) continue;
    const rows = playerRows.get(elementId) || [];
    const agg = aggregate(rows.filter((r) => r.comp === 'Premier League'));
    const aggAll = aggregate(rows.filter((r) => r.comp !== 'Friendly'));
    const aggCups = aggregate(rows.filter((r) => r.comp !== 'Friendly' && r.comp !== 'Premier League'));
    const membership = isCurrent ? squadMembership(e, spursId, teamById) : { state: 'archived', label: null, note: null };
    const current = membership.state === 'current';
    // A permanent departure with no Spurs minutes this season has nothing to show here;
    // the player stays reachable through earlier seasons.
    if (membership.state === 'left' && !rows.some((r) => (r.minutes || 0) > 0)) continue;
    const code = num(e.code) ?? `s${season}-${elementId}`;
    const region = regions.get(num(e.region));
    const status = current ? e.status || null : null;
    const p = {
      id: String(code), elementId, name: [e.first_name, e.second_name].filter(Boolean).join(' ') || e.web_name, web: e.web_name,
      knownName: e.known_name || null, pos, birthDate: e.birth_date && e.birth_date !== 'None' ? e.birth_date : null,
      age: ageOn(e.birth_date), nationality: region ? region.name : null,
      squadNumber: num(e.squad_number), joinDate: e.team_join_date && e.team_join_date !== 'None' ? e.team_join_date : null,
      photo: e.code ? String(e.code) : null, current, membership: membership.state, membershipLabel: membership.label, membershipNote: membership.note,
      leftClub: isCurrent && !current,
      status, statusLabel: statusLabel(status), news: current && e.news ? e.news : null, newsAdded: current ? e.news_added || null : null,
      chanceNext: current ? num(e.chance_of_playing_next_round) : null,
      aliases: [...new Set([e.web_name, e.known_name, e.first_name, e.second_name, ...(aliases[String(code)] || []), ...(aliases[e.second_name] || []), ...(aliases[e.web_name] || [])].filter(Boolean))],
      season: agg, seasonAll: aggAll, seasonCups: aggCups.apps ? aggCups : null,
      lastMatch: rows.length ? rows[rows.length - 1].matchId : null,
    };
    players.push(p);
    playerFiles[`players/${p.id}.json`] = { season, generatedAt, source: sourceRef, player: p, matches: rows, shots: [] };
  }
  players.sort((a, b) => (b.season.totals.minutes || 0) - (a.season.totals.minutes || 0));

  // ---- Matches (detail pages) and team-level match stats ----
  const byMatch = new Map();
  for (const [elementId, rows] of playerRows) for (const r of rows) {
    if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, []);
    byMatch.get(r.matchId).push({ elementId, r });
  }
  const pById = new Map(players.map((p) => [p.elementId, p]));
  const matchFiles = {};
  const teamMatches = [];
  for (const f of fixtures) {
    const lineup = (byMatch.get(f.id) || []).filter((x) => (x.r.minutes || 0) > 0).map(({ elementId, r }) => {
      const p = pById.get(elementId);
      return { playerId: p ? p.id : String(elementId), name: p ? p.web : nameOf(elementId), pos: p ? p.pos : null, role: r.starts === 1 ? 'starter' : r.starts === 0 ? 'sub' : 'unknown', ...pick(r) };
    }).sort((a, b) => (a.role === b.role ? posOrder(a.pos) - posOrder(b.pos) : a.role === 'starter' ? -1 : 1));
    const team = teamMatchStats(lineup, f);
    if (f.source === 'fpl' && (f.status === 'FT' || f.status === 'FT_PROVISIONAL') && lineup.length) teamMatches.push(team);
    const statsComplete = f.source === 'fpl' ? f.status === 'FT' && lineup.length >= 11 && lineup.some((l) => l.bonus !== null) && (!f.detail || f.detail.processed)
      : f.source === 'fplcore' ? f.status === 'FT' && lineup.length >= 11 : null;
    const { detail: det, ...fixtureLite } = f;
    matchFiles[`matches/${f.id}.json`] = {
      season, generatedAt, source: f.source === 'fpl' ? sourceRef : f.source === 'fplcore' ? 'FPL Core Insights (FotMob match data)' : 'TheSportsDB',
      fixture: fixtureLite, lineup, team, detail: det || null, statsComplete, videos: [],
    };
    f.statsComplete = statsComplete;
  }

  // Each player's shots (with locations) for the profile shot map.
  const fileByElement = new Map(players.map((p) => [p.elementId, playerFiles[`players/${p.id}.json`]]));
  for (const f of fixtures) {
    if (!f.detail) continue;
    for (const sh of f.detail.shots) {
      if (sh.team !== 'spurs' || sh.elementId === null) continue;
      const pf = fileByElement.get(sh.elementId);
      if (pf) pf.shots.push({ ...sh, matchId: f.id, opponent: f.opponent, competition: f.competition, kickoff: f.kickoff });
    }
  }
  for (const f of fixtures) { f.hasDetail = Boolean(f.detail); delete f.detail; }

  // ---- Table ----
  const table = leagueTable(tableFixtures, teams);
  const spursRow = table.find((r) => r.teamId === spursId) || null;

  // ---- Team intelligence ----
  const teamSummary = summariseTeam(teamMatches, fixtures);
  teamSummary.leagueRanks = leagueAdvancedRanks(detail.leagueMatches || [], teams, clubCode);
  teamSummary.shotZones = shotZones(Object.values(matchFiles).filter((m) => m.fixture.competition === 'Premier League' && m.detail).flatMap((m) => m.detail.shots));

  // ---- Video evidence linking ----
  const evidence = linkVideos(videos, fixtures);
  for (const ev of evidence) if (ev.matchId && matchFiles[`matches/${ev.matchId}.json`]) matchFiles[`matches/${ev.matchId}.json`].videos.push(ev);

  const files = {
    'fixtures.json': { season, generatedAt, timezone: 'UTC (displayed in Asia/Bahrain)', fixtures },
    'table.json': { season, generatedAt, source: `Computed from ${sourceRef} results`, rows: table, spurs: spursRow },
    'players.json': { season, generatedAt, source: sourceRef, competition: 'Premier League (season); all competitive matches (seasonAll)', players: players.map(({ season: s, seasonAll: a, seasonCups: c, ...rest }) => ({ ...rest, season: slim(s), seasonAll: slim(a), seasonCups: c ? slim(c) : null })) },
    'team.json': { season, generatedAt, source: sourceRef, competition: 'Premier League', ...teamSummary },
    'evidence.json': { season, generatedAt, items: evidence },
    ...playerFiles,
    ...matchFiles,
  };
  return { files, players, fixtures, table, teamSummary, teamMatches, evidence };
}

// The provider reports 0 (not "missing") for statistics it had not started recording
// yet — e.g. xG before mid-2022-23, defensive actions before 2025-26. A whole team
// recording zero xG, zero xG conceded, or zero tackles+recoveries in a match is not
// physically plausible, so those zeros are converted to "unavailable".
export const STAT_GROUPS = [
  { keys: ['xg', 'xa', 'xgi', 'xgc'], empty: (rows) => rows.every((r) => !r.xg && !r.xa && !r.xgc) },
  { keys: ['tackles', 'cbi', 'recoveries', 'defcon'], empty: (rows) => rows.every((r) => !r.tackles && !r.recoveries && !r.cbi) },
  { keys: ['starts'], empty: (rows) => rows.every((r) => !r.starts) },
];
export function blankUnrecordedStats(playerRows) {
  const byMatch = new Map();
  for (const rows of playerRows.values()) for (const r of rows) {
    if ((r.minutes || 0) <= 0) continue;
    if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, []);
    byMatch.get(r.matchId).push(r);
  }
  for (const rows of playerRows.values()) for (const r of rows) {
    const team = byMatch.get(r.matchId) || [];
    if (team.length < 7) continue;
    for (const g of STAT_GROUPS) if (g.empty(team)) for (const k of g.keys) r[k] = null;
  }
}

const slim = (s) => ({ apps: s.apps, subApps: s.subApps, totals: s.totals, per90: s.per90, derived: s.derived, rates: s.rates, coverage: s.coverage });

function pick(r) {
  const o = {};
  for (const s of STATS) o[s.key] = r[s.key];
  return o;
}
const posOrder = (p) => ({ GK: 0, DEF: 1, MID: 2, FWD: 3 }[p] ?? 4);

// Squad membership from the Premier League's own player list. FPL keeps players who
// left or went on loan attached to their old club with status "u" and a note such as
// "Has joined Juventus on loan"; those are not part of the current squad.
export function squadMembership(e, spursId, teamById) {
  const removed = e.removed === true || e.removed === 'True';
  const news = String(e.news || '');
  if (num(e.team) !== spursId) {
    const now = teamById.get(num(e.team));
    return { state: 'left', label: 'Left the club', note: now ? `Now at ${now.name}` : 'No longer listed by the Premier League' };
  }
  if (removed) return { state: 'left', label: 'Left the club', note: 'Removed from the Premier League player list' };
  if (e.status === 'u') {
    if (/on loan/i.test(news)) return { state: 'loan', label: 'Out on loan', note: news };
    if (/permanent|has left|released|retire|contract (terminated|ended)|joined/i.test(news)) return { state: 'left', label: 'Left the club', note: news };
    return { state: 'unregistered', label: 'Not in the registered squad', note: news || 'Listed as unavailable by the Premier League' };
  }
  return { state: 'current', label: 'Current squad', note: null };
}

export function statusLabel(s) {
  return { a: 'Available', d: 'Doubtful', i: 'Injured', s: 'Suspended', u: 'Not in squad', n: 'Not in squad (loan / ineligible)' }[s] || null;
}

const sum = (rows, k) => {
  const v = rows.map((r) => r[k]).filter((x) => x !== null && x !== undefined);
  return v.length ? round(v.reduce((a, b) => a + b, 0), 2) : null;
};

export function teamMatchStats(lineup, f) {
  const full = lineup.filter((l) => (l.minutes || 0) >= 90 && l.xgc !== null);
  const xgcVals = (full.length ? full : lineup.filter((l) => l.xgc !== null)).map((l) => l.xgc);
  return {
    matchId: f.id, kickoff: f.kickoff, opponent: f.opponent, opponentShort: f.opponentShort, home: f.home,
    gf: f.score ? f.score.spurs : null, ga: f.score ? f.score.opp : null, result: f.result,
    xg: sum(lineup, 'xg'), xa: sum(lineup, 'xa'),
    // xG against = xG conceded while on pitch for a player who played the whole match.
    xga: xgcVals.length ? round(Math.max(...xgcVals), 2) : null,
    tackles: sum(lineup, 'tackles'), cbi: sum(lineup, 'cbi'), recoveries: sum(lineup, 'recoveries'), defcon: sum(lineup, 'defcon'),
    saves: sum(lineup, 'saves'), yc: sum(lineup, 'yc'), rc: sum(lineup, 'rc'), playersUsed: lineup.length,
    adv: f.detail ? advancedTeam(f.detail) : null,
  };
}

// Team-level detail from the supplementary source: both sides, halves and shot situations.
export function advancedTeam(d) {
  const halves = { first: { gf: 0, ga: 0, xgf: 0, xga: 0 }, second: { gf: 0, ga: 0, xgf: 0, xga: 0 } };
  const situations = {};
  for (const sh of d.shots) {
    if (sh.minute === null) continue;
    const half = sh.minute <= 45 ? 'first' : sh.minute <= 90 ? 'second' : null;
    const goal = sh.outcome === 'goal';
    if (half) {
      const h = halves[half];
      if (sh.team === 'spurs') { h.xgf += sh.xg || 0; if (goal) h.gf++; } else { h.xga += sh.xg || 0; if (goal) h.ga++; }
    }
    const sit = (situations[sh.situation || 'unknown'] ||= { for: { shots: 0, goals: 0, xg: 0 }, against: { shots: 0, goals: 0, xg: 0 } });
    const side = sit[sh.team === 'spurs' ? 'for' : 'against'];
    side.shots++; side.xg += sh.xg || 0; if (goal) side.goals++;
  }
  for (const h of Object.values(halves)) { h.xgf = round(h.xgf, 2); h.xga = round(h.xga, 2); }
  for (const v of Object.values(situations)) for (const k of ['for', 'against']) v[k].xg = round(v[k].xg, 2);
  const tilt = d.spurs.oppHalf !== null && d.opp.oppHalf !== null && d.spurs.oppHalf + d.opp.oppHalf > 0
    ? round((d.spurs.oppHalf / (d.spurs.oppHalf + d.opp.oppHalf)) * 100, 1) : null;
  return { spurs: d.spurs, opp: d.opp, fieldTilt: tilt, halves: d.shots.length ? halves : null, situations: d.shots.length ? situations : null, shotsRecorded: d.shots.length };
}

function avg(rows, k) {
  const v = rows.map((r) => r[k]).filter((x) => x !== null && x !== undefined);
  return v.length ? { value: round(v.reduce((a, b) => a + b, 0) / v.length, 2), n: v.length } : { value: null, n: 0 };
}

export function summariseTeam(matches, fixtures) {
  const block = (rows) => ({
    n: rows.length,
    w: rows.filter((r) => r.result === 'W').length, d: rows.filter((r) => r.result === 'D').length, l: rows.filter((r) => r.result === 'L').length,
    gf: sum(rows, 'gf'), ga: sum(rows, 'ga'), xg: sum(rows, 'xg'), xga: sum(rows, 'xga'),
    // Goals in only the matches where xG exists, so goals-vs-xG comparisons are like for like.
    xgMatches: rows.filter((r) => r.xg !== null).length,
    gfWithXg: sum(rows.filter((r) => r.xg !== null), 'gf'), gaWithXga: sum(rows.filter((r) => r.xga !== null), 'ga'),
    points: rows.reduce((a, r) => a + (r.result === 'W' ? 3 : r.result === 'D' ? 1 : 0), 0),
    perMatch: Object.fromEntries(['gf', 'ga', 'xg', 'xga', 'tackles', 'cbi', 'recoveries', 'defcon', 'saves', 'yc'].map((k) => [k, avg(rows, k)])),
    cleanSheets: rows.filter((r) => r.ga === 0).length,
    failedToScore: rows.filter((r) => r.gf === 0).length,
    adv: advancedBlock(rows.filter((r) => r.adv)),
  });
  const allComps = fixtures.filter((f) => f.result);
  const byComp = {};
  for (const f of allComps) {
    const b = (byComp[f.competition] ||= { n: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    b.n++; b[f.result.toLowerCase()]++; b.gf += f.score.spurs; b.ga += f.score.opp;
  }
  return {
    matches,
    overall: block(matches),
    home: block(matches.filter((m) => m.home)),
    away: block(matches.filter((m) => !m.home)),
    last5: block(matches.slice(-5)),
    last10: block(matches.slice(-10)),
    byCompetition: byComp,
    formAllComps: allComps.slice(-10).map((f) => ({ matchId: f.id, result: f.result, competition: f.competition, opponent: f.opponent })),
  };
}

// League-wide per-match averages for each club from the supplementary match data,
// ranked so a Spurs figure can be shown with its league position.
export function leagueAdvancedRanks(rows, teams, clubCode) {
  const seen = new Set(); const by = new Map();
  for (const m of rows) {
    if (seen.has(m.match_id)) continue; seen.add(m.match_id);
    for (const [side, other] of [['home', 'away'], ['away', 'home']]) {
      const code = num(m[`${side}_team`]); if (code === null) continue;
      const t = by.get(code) || { code, n: 0, sums: {}, counts: {} };
      const add = (k, v) => { if (v === null) return; t.sums[k] = (t.sums[k] || 0) + v; t.counts[k] = (t.counts[k] || 0) + 1; };
      t.n++;
      add('possession', num(m[`${side}_possession`])); add('shots', num(m[`${side}_total_shots`])); add('sot', num(m[`${side}_shots_on_target`]));
      add('xg', num(m[`${side}_expected_goals_xg`])); add('xga', num(m[`${other}_expected_goals_xg`])); add('bigChances', num(m[`${side}_big_chances`]));
      add('shotsAgainst', num(m[`${other}_total_shots`])); add('passPct', num(m[`${side}_accurate_passes_pct`])); add('touchesOppBox', num(m[`${side}_touches_in_opposition_box`]));
      const a = num(m[`${side}_opposition_half`]); const b = num(m[`${other}_opposition_half`]);
      add('fieldTilt', a !== null && b !== null && a + b > 0 ? (a / (a + b)) * 100 : null);
      add('dribbles', num(m[`${side}_successful_dribbles`])); add('xgSetPlay', num(m[`${side}_xg_set_play`]));
      by.set(code, t);
    }
  }
  const defs = { possession: ['Possession', '%', false], fieldTilt: ['Field tilt', '%', false], shots: ['Shots per match', '', false], sot: ['Shots on target per match', '', false],
    xg: ['xG per match', '', false], bigChances: ['Big chances per match', '', false], touchesOppBox: ['Touches in opposition box', '', false], passPct: ['Pass accuracy', '%', false],
    dribbles: ['Successful take-ons per match', '', false], xgSetPlay: ['Set-piece xG per match', '', false], xga: ['xG conceded per match', '', true], shotsAgainst: ['Shots conceded per match', '', true] };
  const teamByCode = new Map(teams.map((t) => [Number(t.code), t]));
  const out = {};
  for (const [k, [label, unit, lowerBetter]] of Object.entries(defs)) {
    const list = [...by.values()].filter((t) => t.counts[k]).map((t) => ({ code: t.code, value: t.sums[k] / t.counts[k], n: t.counts[k] }));
    if (list.length < 10) continue;
    list.sort((x, y) => (lowerBetter ? x.value - y.value : y.value - x.value));
    const i = list.findIndex((t) => t.code === clubCode);
    if (i < 0) continue;
    const avg = list.reduce((s, t) => s + t.value, 0) / list.length;
    out[k] = { label, unit, lowerBetter, value: round(list[i].value, 2), rank: i + 1, of: list.length, leagueAvg: round(avg, 2), leader: { team: teamByCode.get(list[0].code)?.name || null, value: round(list[0].value, 2) }, matches: list[i].n };
  }
  return { metrics: out, source: 'FPL Core Insights (FotMob match data), all Premier League matches in rounds where Spurs have played' };
}

// Spurs shots by pitch zone (measured from shot coordinates).
export function shotZones(shots) {
  const zones = {};
  for (const s of shots) {
    if (s.team !== 'spurs' || s.x === null || s.y === null) continue;
    const depth = s.x <= 5.5 ? 'six' : s.x <= 16.5 ? 'box' : 'outside';
    const lane = depth === 'outside' ? (s.y < 33 ? 'left' : s.y > 67 ? 'right' : 'centre') : (s.y < 36 ? 'left' : s.y > 64 ? 'right' : 'centre');
    const k = `${depth}-${lane}`;
    const z = (zones[k] ||= { shots: 0, goals: 0, xg: 0 });
    z.shots++; z.xg = round(z.xg + (s.xg || 0), 2); if (s.outcome === 'goal') z.goals++;
  }
  return zones;
}

function advancedBlock(rows) {
  if (!rows.length) return null;
  const av = (fn) => { const v = rows.map(fn).filter((x) => x !== null && x !== undefined); return v.length ? { value: round(v.reduce((a, b) => a + b, 0) / v.length, 2), n: v.length } : { value: null, n: 0 }; };
  const keys = ['possession', 'shots', 'sot', 'bigChances', 'passes', 'passPct', 'xgSetPlay', 'xgOpenPlay', 'touchesOppBox', 'corners', 'tacklesWon', 'interceptions', 'clearances', 'dribbles', 'aerialPct', 'longBallPct', 'distance'];
  const perMatch = {};
  for (const k of keys) perMatch[k] = { spurs: av((r) => r.adv.spurs[k]), opp: av((r) => r.adv.opp[k]) };
  perMatch.fieldTilt = av((r) => r.adv.fieldTilt);
  const halves = { first: { gf: 0, ga: 0, xgf: 0, xga: 0 }, second: { gf: 0, ga: 0, xgf: 0, xga: 0 } };
  const situations = {};
  let halfN = 0;
  for (const r of rows) {
    if (r.adv.halves) { halfN++; for (const h of ['first', 'second']) for (const k of ['gf', 'ga', 'xgf', 'xga']) halves[h][k] = round(halves[h][k] + r.adv.halves[h][k], 2); }
    for (const [sit, v] of Object.entries(r.adv.situations || {})) {
      const t = (situations[sit] ||= { for: { shots: 0, goals: 0, xg: 0 }, against: { shots: 0, goals: 0, xg: 0 } });
      for (const side of ['for', 'against']) { t[side].shots += v[side].shots; t[side].goals += v[side].goals; t[side].xg = round(t[side].xg + v[side].xg, 2); }
    }
  }
  return { n: rows.length, perMatch, halves: halfN ? { ...halves, n: halfN } : null, situations, source: 'FPL Core Insights (FotMob match data)' };
}

export function linkVideos(videos, fixtures) {
  const items = [];
  const played = fixtures.filter((f) => f.kickoff && (f.status === 'FT' || f.status === 'FT_PROVISIONAL' || f.status === 'LIVE'));
  for (const v of videos) {
    const t = `${v.title}`.toLowerCase();
    const pub = Date.parse(v.published);
    const spursRelated = v.channel === 'spurs' || /tottenham|spurs/.test(t);
    if (!spursRelated) continue;
    const match = played.find((f) => {
      const k = Date.parse(f.kickoff);
      return pub >= k - 6 * 3600e3 && pub <= k + 5 * 86400e3 && teamAliases(f.opponent).some((a) => t.includes(a));
    });
    const kind = /highlight/.test(t) ? 'highlights' : /press conference|presser/.test(t) ? 'press' : /reaction|interview|speaks|reacts/.test(t) ? 'interview'
      : /goal|every|all the/.test(t) ? 'goals' : /preview/.test(t) ? 'preview' : 'other';
    items.push({
      videoId: v.videoId, title: v.title, url: v.url || `https://www.youtube.com/watch?v=${v.videoId}`, published: v.published,
      channel: v.channelName || v.channel, thumbnail: v.thumbnail, kind,
      matchId: match ? match.id : null,
      opponent: match ? match.opponent : null,
      competition: match ? match.competition : null,
      // Linking is by title + publication date only; we never claim a clip shows a
      // specific event, and no timestamps are inferred.
      relation: match ? (kind === 'highlights' || kind === 'goals' ? 'contextual' : 'illustrative') : 'illustrative',
      matchConfidence: match ? 'title + date match' : 'not linked to a match',
    });
  }
  return items.sort((a, b) => String(b.published).localeCompare(String(a.published)));
}
