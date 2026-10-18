// Adapter: TheSportsDB (free public key). Used for Tottenham's matches outside the
// Premier League (domestic cups, Europe, friendlies) and as an independent check of
// Premier League scores. Scores only — no player statistics.
import { PROVIDERS, CLUB } from '../config.js';
import { request } from '../lib/http.js';
import { num } from '../lib/validate.js';

const cfg = PROVIDERS.theSportsDb;
const get = (p) => request(`${cfg.base}/${cfg.key}/${p}`, { minGapMs: cfg.minGapMs }).then((r) => r.body);

export const id = 'thesportsdb';
export const label = 'TheSportsDB (free tier)';

export async function resolveTeamId() {
  let teams = [];
  for (const q of ['Tottenham_Hotspur', 'Tottenham', 'Spurs']) {
    const r = await get(`searchteams.php?t=${q}`).catch(() => null);
    teams = (r && r.teams) || [];
    if (teams.length) break;
  }
  const ok = (t) => (!t.strSport || t.strSport === 'Soccer') && /tottenham|spurs/i.test(`${t.strTeam} ${t.strTeamAlternate || ''}`) && !/women|u21|u23|u18|ladies|academy/i.test(t.strTeam);
  const hit = teams.find((t) => ok(t) && /english premier league/i.test(`${t.strLeague} ${t.strLeague2 || ''}`)) || teams.find(ok);
  if (!hit) throw new Error('TheSportsDB: Tottenham Hotspur not found');
  return hit.idTeam;
}

export async function fetchEvents(teamId) {
  const [last, next] = await Promise.all([
    get(`eventslast.php?id=${teamId}`).catch((e) => ({ error: e })),
    get(`eventsnext.php?id=${teamId}`).catch((e) => ({ error: e })),
  ]);
  if (last.error && next.error) throw last.error;
  const rows = [...((last && last.results) || []), ...((next && next.events) || [])];
  return rows.map((e) => normalizeEvent(e, teamId)).filter(Boolean);
}

export function normalizeEvent(e, teamId) {
  if (!e || !e.idEvent || e.strSport && e.strSport !== 'Soccer') return null;
  const home = String(e.idHomeTeam) === String(teamId);
  const away = String(e.idAwayTeam) === String(teamId);
  if (!home && !away) return null;
  const kickoff = e.strTimestamp ? new Date(e.strTimestamp.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? e.strTimestamp : `${e.strTimestamp}Z`).toISOString()
    : e.dateEvent ? new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}Z`).toISOString() : null;
  const hs = num(e.intHomeScore);
  const as = num(e.intAwayScore);
  const status = String(e.strStatus || '');
  const finished = /^(FT|AET|PEN|Match Finished)$/i.test(status) || (hs !== null && as !== null && kickoff && Date.parse(kickoff) < Date.now() - 3 * 3600e3);
  return {
    id: `tsdb-${e.idEvent}`,
    source: 'thesportsdb',
    sourceId: String(e.idEvent),
    competition: e.strLeague || 'Unknown competition',
    competitionId: e.idLeague ? `tsdb-${e.idLeague}` : null,
    season: e.strSeason || null,
    kickoff,
    home,
    opponent: home ? e.strAwayTeam : e.strHomeTeam,
    venue: e.strVenue || null,
    status: /postp/i.test(status) ? 'POSTPONED' : /aband/i.test(status) ? 'ABANDONED' : finished ? 'FT' : status && !/not started|ns/i.test(status) ? 'LIVE' : 'SCHEDULED',
    statusDetail: status || null,
    score: hs !== null && as !== null ? { spurs: home ? hs : as, opp: home ? as : hs } : null,
    resultNote: /AET/i.test(status) ? 'After extra time' : /PEN/i.test(status) ? 'Penalty shoot-out' : null,
    video: e.strVideo || null,
    club: CLUB.name,
  };
}

// Club badge by name (for opponents outside the Premier League). Returns a URL or null.
export async function findBadge(name) {
  const q = String(name).replace(/\s+/g, '_');
  const r = await get(`searchteams.php?t=${encodeURIComponent(q)}`).catch(() => null);
  const teams = ((r && r.teams) || []).filter((t) => (!t.strSport || t.strSport === 'Soccer') && !/women|u21|u23|u19|u18|ladies|academy|futsal/i.test(t.strTeam) && t.strGender !== 'Female');
  const norm = (s) => String(s || '').toLowerCase().replace(/\b(fc|afc|cf|sc|ac)\b/g, '').replace(/[^a-z0-9]/g, '');
  const want = norm(name);
  const hit = teams.find((t) => norm(t.strTeam) === want) || teams.find((t) => norm(t.strTeam).includes(want) || want.includes(norm(t.strTeam))) || teams[0];
  const url = hit && (hit.strBadge || hit.strTeamBadge);
  return url ? `${url}/small` : null;
}
