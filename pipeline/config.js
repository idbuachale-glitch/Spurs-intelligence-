// Central configuration. Nothing here is a source of truth for football data —
// team, season and player IDs are resolved from the providers at run time.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ROOT = root;
export const SITE_DATA = process.env.SPURS_SITE_DATA || path.join(root, 'site', 'data');
export const STATE_DIR = process.env.SPURS_STATE_DIR || path.join(root, 'state');

export const CLUB = {
  name: 'Tottenham Hotspur',
  // Names the club goes by in different providers; used only to *find* the club's ID.
  matchNames: ['spurs', 'tottenham', 'tottenham hotspur', 'tot'],
  displayTimeZone: 'Asia/Bahrain',
};

// Head-coach periods (documented record). Used only to split "eras" in analysis, never
// to compute statistics. A weekly job reads the club's Wikipedia infobox and, if the
// listed head coach changes, appends a new era automatically (state/coach-eras.json).
export const COACH_ERAS = [
  { coach: 'José Mourinho', from: '2019-11-20', to: '2021-04-18' },
  { coach: 'Ryan Mason (interim)', from: '2021-04-19', to: '2021-06-29' },
  { coach: 'Nuno Espírito Santo', from: '2021-06-30', to: '2021-11-01' },
  { coach: 'Antonio Conte', from: '2021-11-02', to: '2023-03-26' },
  { coach: 'Cristian Stellini (interim)', from: '2023-03-27', to: '2023-04-24' },
  { coach: 'Ryan Mason (interim)', from: '2023-04-25', to: '2023-06-30' },
  { coach: 'Ange Postecoglou', from: '2023-07-01', to: '2025-06-06' },
  { coach: 'Thomas Frank', from: '2025-06-12', to: '2026-02-11' },
  { coach: 'Igor Tudor', from: '2026-02-14', to: '2026-03-30' },
  { coach: 'Roberto De Zerbi', from: '2026-03-31', to: null },
];

export const PROVIDERS = {
  fpl: {
    base: process.env.FPL_BASE || 'https://fantasy.premierleague.com/api',
    minGapMs: Number(process.env.FPL_GAP_MS ?? 400),
  },
  footballData: {
    base: process.env.FOOTBALL_DATA_BASE || 'https://api.football-data.org/v4',
    key: process.env.FOOTBALL_DATA_KEY || '',
    minGapMs: 6500, // free tier: 10 calls/min
  },
  theSportsDb: {
    base: process.env.TSDB_BASE || 'https://www.thesportsdb.com/api/v1/json',
    key: process.env.TSDB_KEY || '123', // public free test key
    minGapMs: 2500, // free tier: 30 calls/min
  },
  youtube: {
    base: process.env.YT_BASE || 'https://www.youtube.com',
    channels: [
      // Official, authorised channels only. IDs are resolved from the handle at run
      // time; the fallback ID is used only if the handle page cannot be read, and the
      // feed's channel name is always checked before any video is accepted.
      { key: 'spurs', handle: '@SpursOfficial', fallbackId: 'UCEg25rdRZXg32iwai6N6l0w', expectName: 'tottenham' },
      { key: 'premierleague', handle: '@premierleague', fallbackId: 'UCG5qGWdu8nIRZqJ_GgDwQ-w', expectName: 'premier league' },
    ],
  },
};

// How often each job runs (minutes). The scheduler runs every ~20 minutes; each job
// decides whether it is due. Match windows tighten the schedule automatically.
export const CADENCE = {
  core: 20,              // bootstrap + fixtures (2 requests)
  playerStats: 360,      // Spurs element summaries (~30 requests)
  playerStatsMatch: 30,  // when a Spurs match finished in the last 72 h and is incomplete
  cups: 360,             // TheSportsDB last/next events (2-3 requests)
  video: 120,            // YouTube RSS (2 requests)
  standingsCheck: 360,   // football-data.org (only when a key is configured)
  regions: 7 * 24 * 60,
};

// A source counts as persistently failing after this many consecutive failures;
// the scheduled run then exits non-zero so GitHub emails the repository owner.
export const ALERT_AFTER_FAILURES = 6;
