// Adapter: API-Football (api-sports.io), free plan. Used only for live in-game team
// statistics during Spurs matches (shots, shots on target, fouls, cards, corners,
// possession). Optional: switched on by the API_FOOTBALL_KEY repository secret.
// The free plan allows 100 requests a day; the caller keeps a daily budget.
import { request } from '../lib/http.js';

const BASE = () => process.env.API_FOOTBALL_BASE || 'https://v3.football.api-sports.io';
const KEY = () => process.env.API_FOOTBALL_KEY || '';
export const id = 'api-football';
export const label = 'API-Football (live match statistics, free plan)';
export const enabled = () => Boolean(KEY());

async function get(path) {
  const { body } = await request(`${BASE()}${path}`, { headers: { 'x-apisports-key': KEY() }, minGapMs: 1200, retries: 1 });
  // Errors come back with HTTP 200 as an object or array, e.g. plan or quota limits.
  const errs = body && body.errors && (Array.isArray(body.errors) ? body.errors : Object.values(body.errors));
  if (errs && errs.length) {
    const e = new Error(`API-Football: ${errs.join('; ')}`);
    e.plan = /plan|season|subscri/i.test(errs.join(' '));
    e.quota = /limit|quota|requests/i.test(errs.join(' '));
    throw e;
  }
  if (!body || !Array.isArray(body.response)) throw new Error('API-Football: unexpected payload');
  return body.response;
}

export async function findTeamId(name = 'Tottenham') {
  const r = await get(`/teams?search=${encodeURIComponent(name)}`);
  const t = r.find((x) => /tottenham/i.test(x.team?.name) && !/women|u21|u18/i.test(x.team?.name) && x.team?.national === false) || r[0];
  if (!t) throw new Error('API-Football: Tottenham not found');
  return t.team.id;
}

// All matches in play right now (one request), filtered to the club.
export async function liveFixture(teamId) {
  const r = await get('/fixtures?live=all');
  const f = r.find((x) => x.teams?.home?.id === teamId || x.teams?.away?.id === teamId);
  return f ? normFixture(f, teamId) : null;
}

// A specific fixture (used once after full time to capture final statistics).
export async function fixtureById(fixtureId, teamId) {
  const r = await get(`/fixtures?id=${fixtureId}`);
  return r[0] ? normFixture(r[0], teamId) : null;
}

function normFixture(f, teamId) {
  const home = f.teams.home.id === teamId;
  const stats = Array.isArray(f.statistics) && f.statistics.length ? normStats(f.statistics, teamId) : null;
  return {
    fixtureId: f.fixture.id, kickoff: f.fixture.date, status: f.fixture.status?.short || null, statusLong: f.fixture.status?.long || null,
    minute: f.fixture.status?.elapsed ?? null, extra: f.fixture.status?.extra ?? null,
    home, opponent: home ? f.teams.away.name : f.teams.home.name, league: f.league?.name || null,
    score: f.goals && f.goals.home !== null ? { spurs: home ? f.goals.home : f.goals.away, opp: home ? f.goals.away : f.goals.home } : null,
    stats,
    events: Array.isArray(f.events) ? f.events.map((e) => ({ minute: e.time?.elapsed ?? null, extra: e.time?.extra ?? null, team: e.team?.id === teamId ? 'spurs' : 'opp', player: e.player?.name || null, type: e.type, detail: e.detail })) : null,
  };
}

const STAT_MAP = {
  'Shots on Goal': 'sot', 'Total Shots': 'shots', 'Shots off Goal': 'shotsOff', 'Blocked Shots': 'shotsBlocked', 'Shots insidebox': 'shotsInBox',
  Fouls: 'fouls', 'Corner Kicks': 'corners', Offsides: 'offsides', 'Ball Possession': 'possession', 'Yellow Cards': 'yc', 'Red Cards': 'rc',
  'Goalkeeper Saves': 'saves', 'Total passes': 'passes', 'Passes accurate': 'passesAcc', 'Passes %': 'passPct', expected_goals: 'xg',
};
const val = (v) => (v === null || v === undefined ? null : typeof v === 'number' ? v : Number(String(v).replace('%', '')) || (String(v).trim() === '0' ? 0 : null));

export function normStats(list, teamId) {
  const out = { spurs: {}, opp: {} };
  for (const t of list) {
    const side = t.team?.id === teamId ? 'spurs' : 'opp';
    for (const s of t.statistics || []) { const k = STAT_MAP[s.type]; if (k) out[side][k] = val(s.value); }
  }
  // A card or shot type the provider leaves out for a team means none so far.
  for (const side of ['spurs', 'opp']) for (const k of ['yc', 'rc', 'sot', 'shots', 'fouls', 'corners']) if (out[side][k] === undefined || out[side][k] === null) out[side][k] = 0;
  return out;
}

export async function fixtureStats(fixtureId, teamId) {
  const r = await get(`/fixtures/statistics?fixture=${fixtureId}`);
  return r.length ? normStats(r, teamId) : null;
}

// Account check (does not count towards the daily quota): confirms the key works.
export async function accountStatus() {
  const { body } = await request(`${BASE()}/status`, { headers: { 'x-apisports-key': KEY() }, minGapMs: 1200, retries: 1 });
  const errs = body && body.errors && (Array.isArray(body.errors) ? body.errors : Object.values(body.errors));
  if (errs && errs.length) throw new Error(`API-Football: ${errs.join('; ')}`);
  const r = body && body.response;
  if (!r || Array.isArray(r)) throw new Error('API-Football: key not accepted');
  return { plan: r.subscription?.plan || null, active: r.subscription?.active ?? null, usedToday: r.requests?.current ?? null, limitDay: r.requests?.limit_day ?? null };
}

// One request: can this plan read the current season? (Free plans are season-limited.)
export async function seasonAccess(teamId, seasonYear, fromIso, toIso) {
  try {
    const r = await get(`/fixtures?team=${teamId}&season=${seasonYear}&from=${fromIso}&to=${toIso}`);
    return { ok: true, fixtures: r.length, next: r[0] ? { id: r[0].fixture.id, date: r[0].fixture.date, opponent: r[0].teams.home.id === teamId ? r[0].teams.away.name : r[0].teams.home.name } : null };
  } catch (err) { return { ok: false, error: String(err.message) }; }
}
