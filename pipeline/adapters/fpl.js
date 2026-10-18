// Adapter: official Fantasy Premier League API (run by the Premier League).
// No key required. Covers every Premier League player and fixture of the current
// season, including Opta-derived xG / xA / xGC and defensive actions.
import { PROVIDERS } from '../config.js';
import { request } from '../lib/http.js';
import { validateBootstrap, validateFixtures, validateElementSummary } from '../lib/validate.js';

const cfg = PROVIDERS.fpl;
const get = (p, opts = {}) => request(`${cfg.base}${p}`, { minGapMs: cfg.minGapMs, ...opts }).then((r) => r.body);

export const id = 'fpl';
export const label = 'Fantasy Premier League API (Premier League)';

export async function fetchBootstrap() {
  return validateBootstrap(await get('/bootstrap-static/'));
}

export async function fetchFixtures(teamIds) {
  const f = await get('/fixtures/');
  return validateFixtures(f, teamIds);
}

export async function fetchElementSummary(elementId) {
  return validateElementSummary(await get(`/element-summary/${elementId}/`), elementId);
}

export async function fetchRegions() {
  const r = await get('/regions/', { retries: 1 });
  if (!Array.isArray(r)) throw new Error('regions: unexpected payload');
  return r;
}

// Resolve the club's provider ID from the data — never hard-coded.
export function resolveTeamId(teams, matchNames) {
  const norm = (s) => String(s || '').toLowerCase();
  const hit = teams.find((t) => matchNames.includes(norm(t.name)) || matchNames.includes(norm(t.short_name)));
  if (!hit) throw new Error('Could not find Tottenham Hotspur in the provider team list');
  return hit.id;
}

// Season label from the first gameweek deadline, e.g. "2026-27".
export function seasonFromEvents(events) {
  const first = events.map((e) => e.deadline_time).filter(Boolean).sort()[0];
  if (!first) throw new Error('Cannot determine season: no gameweek deadlines');
  const y = new Date(first).getUTCFullYear();
  const start = new Date(first).getUTCMonth() >= 5 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// Live per-player figures for a gameweek, updated by the Premier League during matches.
export async function fetchLive(gw) {
  const r = await get(`/event/${gw}/live/`, { retries: 1 });
  if (!r || !Array.isArray(r.elements)) throw new Error('fpl live: unexpected payload');
  return r.elements;
}
