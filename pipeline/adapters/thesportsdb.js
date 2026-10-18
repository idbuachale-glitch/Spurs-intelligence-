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
  const r = await get('searchteams.php?t=Tottenham');
  const teams = (r && r.teams) || [];
  const hit = teams.find((t) => t.strSport === 'Soccer' && /tottenham hotspur/i.test(t.strTeam) && !/women|u21|u18|ladies/i.test(t.strTeam));
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
