// Adapter: ESPN's public match feed (site.api.espn.com). Unofficial and keyless; used only
// for confirmed starting line-ups on match day (published about an hour before kick-off).
// If it fails or changes, the site keeps its normal forecasts.
import { request } from '../lib/http.js';

const BASE = () => process.env.ESPN_BASE || 'https://site.api.espn.com/apis/site/v2/sports/soccer';
export const id = 'espn';
export const label = 'ESPN match feed (confirmed line-ups, unofficial)';
export const enabled = () => (process.env.LINEUPS || 'on') !== 'off';
export const LEAGUES = { 'Premier League': 'eng.1', 'FA Cup': 'eng.fa', 'EFL Cup': 'eng.league_cup', 'Champions League': 'uefa.champions', 'Europa League': 'uefa.europa', 'Conference League': 'uefa.europa.conf' };

const get = (path) => request(`${BASE()}${path}`, { minGapMs: 600, retries: 1, timeoutMs: 15000 }).then((r) => r.body);

// Matches on a date (UTC, YYYYMMDD) for a league.
export async function scoreboard(league, ymd) {
  const b = await get(`/${league}/scoreboard?dates=${ymd}`);
  return (b?.events || []).map((e) => {
    const c = e.competitions?.[0] || {};
    const side = (ha) => c.competitors?.find((x) => x.homeAway === ha)?.team || {};
    return { id: e.id, date: e.date, home: side('home').displayName || side('home').name, away: side('away').displayName || side('away').name, state: e.status?.type?.state || null };
  });
}

// Confirmed line-ups for one match: null until the teams are announced.
export async function lineups(league, eventId) {
  const b = await get(`/${league}/summary?event=${eventId}`);
  const rosters = Array.isArray(b?.rosters) ? b.rosters : [];
  const out = {};
  for (const r of rosters) {
    const starters = (r.roster || []).filter((p) => p.starter);
    if (starters.length < 11) continue;
    out[r.homeAway] = {
      team: r.team?.displayName || null, formation: r.formation || null,
      starters: starters.map((p) => ({ name: p.athlete?.displayName || p.athlete?.fullName || '', short: p.athlete?.shortName || '', pos: p.position?.abbreviation || null, num: p.jersey || null })),
      subs: (r.roster || []).filter((p) => !p.starter).map((p) => ({ name: p.athlete?.displayName || '', pos: p.position?.abbreviation || null })),
    };
  }
  return out.home && out.away ? out : null;
}
