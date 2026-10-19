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

// Team sheets and key events for one match. Returns null until both sides have 11 starters.
export async function lineups(league, eventId) {
  const b = await get(`/${league}/summary?event=${eventId}`);
  const rosters = Array.isArray(b?.rosters) ? b.rosters : [];
  const out = {};
  for (const r of rosters) {
    const starters = (r.roster || []).filter((p) => p.starter);
    if (starters.length < 11) continue;
    const pl = (p) => ({ name: p.athlete?.displayName || p.athlete?.fullName || '', short: p.athlete?.shortName || '', pos: p.position?.abbreviation || null, num: p.jersey || null, place: p.formationPlace ?? null, subbedIn: Boolean(p.subbedIn), subbedOut: Boolean(p.subbedOut) });
    out[r.homeAway] = {
      team: r.team?.displayName || null, formation: r.formation || null,
      starters: starters.map(pl),
      subs: (r.roster || []).filter((p) => !p.starter).map(pl),
    };
  }
  if (!(out.home && out.away)) return null;
  // Goals, cards and substitutions with their minutes (present once the match has started).
  out.keyEvents = (Array.isArray(b?.keyEvents) ? b.keyEvents : []).map((e) => ({
    type: e.type?.text || e.type?.type || null, clock: e.clock?.displayValue || null, team: e.team?.displayName || null,
    text: e.text || e.shortText || null, players: (e.participants || []).map((x) => x.athlete?.displayName).filter(Boolean),
  })).filter((e) => e.type);
  out.state = b?.header?.competitions?.[0]?.status?.type?.state || null;
  return out;
}

// Live state of one match: score, clock, key events, team stats and per-player stats,
// using only the fields the feed actually carries. Also lists which stat names were
// present, so the site can show exactly what is (and isn't) supplied.
export async function liveMatch(league, eventId) {
  const b = await get(`/${league}/summary?event=${eventId}`);
  const comp = b?.header?.competitions?.[0] || {};
  const st = comp.status || {};
  const sides = {};
  for (const c of comp.competitors || []) sides[c.homeAway] = { team: c.team?.displayName || c.team?.name || null, score: c.score !== undefined && c.score !== '' ? Number(c.score) : null };
  const teamStats = {};
  for (const t of b?.boxscore?.teams || []) {
    const ha = t.homeAway || (t.team?.displayName === sides.home?.team ? 'home' : 'away');
    teamStats[ha] = Object.fromEntries((t.statistics || []).map((s) => [s.name, s.displayValue ?? s.value ?? null]));
  }
  const players = {};
  for (const r of b?.rosters || []) {
    players[r.homeAway] = (r.roster || []).map((p) => ({
      name: p.athlete?.displayName || '', short: p.athlete?.shortName || '', pos: p.position?.abbreviation || null, starter: Boolean(p.starter), subbedIn: Boolean(p.subbedIn), subbedOut: Boolean(p.subbedOut),
      stats: Object.fromEntries((p.stats || []).map((s) => [s.name || s.abbreviation, s.value ?? s.displayValue ?? null])),
    }));
  }
  const keyEvents = (Array.isArray(b?.keyEvents) ? b.keyEvents : []).map((e) => ({
    type: e.type?.text || null, clock: e.clock?.displayValue || null, team: e.team?.displayName || null, text: e.text || e.shortText || null,
    players: (e.participants || []).map((x) => x.athlete?.displayName).filter(Boolean),
  })).filter((e) => e.type);
  const statNames = { team: [...new Set(Object.values(teamStats).flatMap((o) => Object.keys(o)))], player: [...new Set(Object.values(players).flat().flatMap((p) => Object.keys(p.stats)))] };
  return { state: st.type?.state || null, detail: st.type?.shortDetail || st.type?.detail || null, clock: st.displayClock || null, period: st.period ?? null, sides, teamStats, players, keyEvents, statNames };
}
