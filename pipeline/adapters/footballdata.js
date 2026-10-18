// Adapter: football-data.org (optional; free key). When a key is configured it is
// used as an independent check of the Premier League table computed from FPL results,
// and adds Champions League fixtures if Tottenham qualify. Never required.
import { PROVIDERS } from '../config.js';
import { request } from '../lib/http.js';

const cfg = PROVIDERS.footballData;
export const id = 'football-data';
export const label = 'football-data.org (free tier)';
export const enabled = () => Boolean(cfg.key);

const get = (p) => request(`${cfg.base}${p}`, { headers: { 'X-Auth-Token': cfg.key }, minGapMs: cfg.minGapMs }).then((r) => r.body);

export async function fetchPlStandings() {
  const r = await get('/competitions/PL/standings');
  const total = (r.standings || []).find((s) => s.type === 'TOTAL');
  if (!total) throw new Error('football-data: no TOTAL standings');
  return {
    season: r.season ? `${r.season.startDate?.slice(0, 4)}` : null,
    rows: total.table.map((t) => ({
      position: t.position, team: t.team.name, shortName: t.team.shortName, tla: t.team.tla,
      played: t.playedGames, won: t.won, drawn: t.draw, lost: t.lost, gf: t.goalsFor, ga: t.goalsAgainst, gd: t.goalDifference, points: t.points,
    })),
  };
}
