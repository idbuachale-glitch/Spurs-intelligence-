// Adapter: FPL Core Insights community dataset (github.com/olbauday/FPL-Elo-Insights).
// Supplementary source for match-level detail the official FPL API lacks: shots,
// passing, take-ons, duels, possession, shot locations and cup/European matches.
// The maintainer states the data may be used freely with a link back; the match
// statistics are collected by the project from FotMob. Labelled on every stat it feeds.
// Disable entirely with SUPPLEMENTARY_STATS=off.
import { request } from '../lib/http.js';
import { num } from '../lib/validate.js';

export const id = 'fplcore';
export const label = 'FPL Core Insights community dataset (match detail via FotMob)';
export const enabled = () => (process.env.SUPPLEMENTARY_STATS || 'on') !== 'off';
const REPO = () => process.env.FPLCORE_REPO || 'olbauday/FPL-Elo-Insights';
const RAW = () => process.env.FPLCORE_RAW || `https://raw.githubusercontent.com/${REPO()}/main`;
const API = () => process.env.FPLCORE_API || `https://api.github.com/repos/${REPO()}/contents`;
const ghHeaders = () => (process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {});

export const seasonDir = (season) => `${season.slice(0, 4)}-20${season.slice(5)}`; // 2026-27 -> 2026-2027

export async function listDir(path) {
  const { body } = await request(`${API()}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: { Accept: 'application/vnd.github+json', ...ghHeaders() }, minGapMs: 300 });
  if (!Array.isArray(body)) throw new Error(`fplcore: cannot list ${path}`);
  return body.filter((x) => x.type === 'dir').map((x) => x.name);
}

export async function fetchCsv(path) {
  const { body } = await request(`${RAW()}/${path.split('/').map(encodeURIComponent).join('/')}`, { as: 'text', minGapMs: 150, retries: 2 });
  return parseCsv(body);
}

export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return [];
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// Fetch one tournament-gameweek folder, keeping only matches involving the club.
export async function fetchRound(season, tournament, gw, clubCode, clubSlug = 'tottenham-hotspur') {
  const base = `data/${seasonDir(season)}/By Tournament/${tournament}/${gw}`;
  const allMatches = await fetchCsv(`${base}/matches.csv`);
  const matches = allMatches.filter((m) => num(m.home_team) === clubCode || num(m.away_team) === clubCode || String(m.match_id).includes(clubSlug));
  // Team-level stats for every league match in the round, for league rankings.
  const leagueMatches = tournament === 'Premier League'
    ? allMatches.filter((m) => m.finished === 'True' && m.stats_processed === 'True').map((m) => {
      const o = { match_id: m.match_id, home_team: m.home_team, away_team: m.away_team, home_score: m.home_score, away_score: m.away_score };
      for (const f of Object.values(TEAM_FIELDS)) { o[`home_${f}`] = m[`home_${f}`]; o[`away_${f}`] = m[`away_${f}`]; }
      return o;
    }) : [];
  if (!matches.length) return { matches: [], players: [], shots: [], momentum: [], xgMinute: [], leagueMatches };
  const ids = new Set(matches.map((m) => m.match_id));
  const anyProcessed = matches.some((m) => m.player_stats_processed === 'True');
  const statsDone = matches.some((m) => m.stats_processed === 'True');
  const [players, shots, momentum, xgMinute] = await Promise.all([
    anyProcessed ? fetchCsv(`${base}/playermatchstats.csv`).catch(() => []) : [],
    statsDone ? fetchCsv(`${base}/shots.csv`).catch(() => []) : [],
    statsDone ? fetchCsv(`${base}/momentum.csv`).catch(() => []) : [],
    statsDone ? fetchCsv(`${base}/xg_by_minute.csv`).catch(() => []) : [],
  ]);
  const mine = (rows) => rows.filter((r) => ids.has(r.match_id));
  // Every Premier League player's match row (trimmed to the columns we use), so Spurs
  // players can be compared with their whole position group across the league.
  const processedIds = new Set(allMatches.filter((m) => m.player_stats_processed === 'True').map((m) => m.match_id));
  const keep = ['player_id', 'match_id', 'minutes_played', 'goals', 'assists', ...Object.values(PLAYER_FIELDS), 'accurate_passes_percent', 'aerial_duels_won_percent', 'successful_dribbles_percent', 'ground_duels_won_percent'];
  const leaguePlayers = tournament === 'Premier League' ? players.filter((r) => processedIds.has(r.match_id) && Number(r.minutes_played) > 0).map((r) => Object.fromEntries(keep.filter((k) => r[k] !== undefined && r[k] !== '').map((k) => [k, r[k]]))) : [];
  return { matches, players: mine(players), shots: mine(shots), momentum: mine(momentum), xgMinute: mine(xgMinute), leagueMatches, leaguePlayers };
}

// ---------- Normalisation ----------
const PCT_FIELDS = new Set(['accurate_passes_percent', 'accurate_crosses_percent', 'accurate_long_balls_percent', 'ground_duels_won_percent', 'aerial_duels_won_percent', 'successful_dribbles_percent', 'tackles_won_percent']);

// The source omits a count when it is zero, so for a player who played in a match
// whose player stats were processed, a blank count means 0. Percentages stay blank.
export const PLAYER_FIELDS = {
  shots: 'total_shots', sot: 'shots_on_target', bigChancesMissed: 'big_chances_missed', xgot: 'xgot', fcXg: 'xg', fcXa: 'xa',
  dribbles: 'successful_dribbles', touchesBox: 'touches_opposition_box', touches: 'touches', passesAcc: 'accurate_passes',
  chancesCreated: 'chances_created', finalThirdPasses: 'final_third_passes', crossesAcc: 'accurate_crosses', longBallsAcc: 'accurate_long_balls',
  tacklesWon: 'tackles_won', tacklesAtt: 'tackles', interceptions: 'interceptions', blocks: 'blocks', clearances: 'clearances', dribbledPast: 'dribbled_past',
  duelsWon: 'duels_won', duelsLost: 'duels_lost', aerialWon: 'aerial_duels_won', wasFouled: 'was_fouled', foulsCommitted: 'fouls_committed',
  dispossessed: 'dispossessed', offsides: 'offsides', corners: 'corners',
  gkSaves: 'saves', xgotFaced: 'xgot_faced', goalsPrevented: 'goals_prevented', sweeperActions: 'sweeper_actions', highClaims: 'high_claim', savesInBox: 'saves_inside_box',
  penScored: 'penalties_scored', distance: 'distance_covered', sprints: 'number_of_sprints',
  groundDuelsWon: 'ground_duels_won', headedClearances: 'headed_clearances', gkPassesAcc: 'gk_accurate_passes', gkLongBallsAcc: 'gk_accurate_long_balls',
  fcRecoveries: 'recoveries', runDist: 'running_distance', sprintDist: 'sprinting_distance',
};
// Tracking distances are physical measurements, never "blank means zero".
const NO_ZERO_FILL = new Set(['xgot', 'xgotFaced', 'goalsPrevented', 'distance', 'sprints', 'runDist', 'sprintDist']);

// Columns that hold at least one value for a player who featured in this match. A
// column that is blank for everyone was not recorded for the match (not "all zero").
export function recordedColumns(rows) {
  const set = new Set();
  for (const r of rows) {
    if (!(num(r.minutes_played) > 0)) continue;
    for (const [k, v] of Object.entries(r)) if (v !== '' && v !== undefined) set.add(k);
  }
  return set;
}

export function playerRow(r, matchProcessed, recorded = null) {
  const minutes = num(r.minutes_played);
  const out = { elementId: num(r.player_id), matchKey: r.match_id, minutes, startMin: num(r.start_min), finishMin: num(r.finish_min), goals: num(r.goals), assists: num(r.assists) };
  const played = matchProcessed && (minutes || 0) > 0;
  for (const [k, f] of Object.entries(PLAYER_FIELDS)) {
    const v = num(r[f]);
    const columnRecorded = !recorded || recorded.has(f);
    out[k] = v !== null ? v : (played && columnRecorded && !PCT_FIELDS.has(f) && !NO_ZERO_FILL.has(k) ? 0 : null);
  }
  if (played) { out.goals ??= 0; out.assists ??= 0; }
  // Goalkeepers' passing is recorded in goalkeeper-only columns; the outfield passing
  // columns are blank for them and must not be read as zero.
  if (num(r.gk_accurate_passes) !== null || num(r.gk_accurate_long_balls) !== null) {
    if (num(r.accurate_passes) === null) out.passesAcc = num(r.gk_accurate_passes);
    if (num(r.accurate_long_balls) === null) out.longBallsAcc = num(r.gk_accurate_long_balls);
  }
  // Attempts are derivable only when a success count and a success % are both present.
  const att = (succ, pctField) => { const p = num(r[pctField]); return succ > 0 && p > 0 ? Math.round(succ / (p / 100)) : null; };
  out.dribbleAtt = att(out.dribbles, 'successful_dribbles_percent');
  out.passesAtt = att(out.passesAcc, 'accurate_passes_percent');
  out.aerialAtt = att(out.aerialWon, 'aerial_duels_won_percent');
  out.groundDuelAtt = att(out.groundDuelsWon, 'ground_duels_won_percent');
  // Closest free stand-ins for metrics that need paid event data (labelled "est." in the UI):
  // high-intensity distance (running + sprinting) as pressing volume, and ball-winning
  // actions (recoveries + tackles won + interceptions) as pressing outcome.
  // A blank sprint distance alongside no recorded sprints means the player did not sprint.
  out.hiDist = out.runDist !== null && (out.sprintDist !== null || !out.sprints) ? out.runDist + (out.sprintDist ?? 0) : null;
  out.ballWins = out.fcRecoveries !== null && out.tacklesWon !== null && out.interceptions !== null ? out.fcRecoveries + out.tacklesWon + out.interceptions : null;
  out.starter = out.startMin === 0 ? true : out.startMin > 0 ? false : null;
  return out;
}

export const TEAM_FIELDS = {
  possession: 'possession', xg: 'expected_goals_xg', shots: 'total_shots', sot: 'shots_on_target', bigChances: 'big_chances', bigChancesMissed: 'big_chances_missed',
  passesAcc: 'accurate_passes', passPct: 'accurate_passes_pct', passes: 'passes', ownHalf: 'own_half', oppHalf: 'opposition_half', fouls: 'fouls_committed', corners: 'corners',
  xgOpenPlay: 'xg_open_play', xgSetPlay: 'xg_set_play', npxg: 'non_penalty_xg', xgot: 'xg_on_target_xgot', shotsInBox: 'shots_inside_box', shotsOutBox: 'shots_outside_box',
  longBallsAcc: 'accurate_long_balls', longBallPct: 'accurate_long_balls_pct', crossesAcc: 'accurate_crosses', touchesOppBox: 'touches_in_opposition_box', offsides: 'offsides',
  tacklesWon: 'tackles_won', tackleWinPct: 'tackles_won_pct', interceptions: 'interceptions', blocks: 'blocks', clearances: 'clearances', saves: 'keeper_saves',
  duelsWon: 'duels_won', aerialWon: 'aerial_duels_won', aerialPct: 'aerial_duels_won_pct', dribbles: 'successful_dribbles', dribblePct: 'successful_dribbles_pct',
  distance: 'distance_covered', sprints: 'number_of_sprints',
};

export function teamSide(m, side) {
  const o = {};
  for (const [k, f] of Object.entries(TEAM_FIELDS)) o[k] = num(m[`${side}_${f}`]);
  return o;
}

export function shotRow(s) {
  return {
    minute: num(s.minute), added: num(s.added_time), isHome: s.is_home === 'True', elementId: num(s.player_id), player: s.player_name || null,
    outcome: s.outcome || null, situation: s.situation || null, bodyPart: s.body_part || null, xg: num(s.xg), xgot: num(s.xgot),
    x: num(s.start_x), y: num(s.start_y),
  };
}

const TOURNAMENT_LABEL = { 'Premier League': 'Premier League', 'EFL Cup': 'EFL Cup', 'FA Cup': 'FA Cup', 'Champions League': 'Champions League', 'Europa League': 'Europa League', 'Conference League': 'Conference League', Friendlies: 'Friendly', 'Community Shield': 'Community Shield', 'Uefa Super Cup': 'UEFA Super Cup' };
export const tournamentLabel = (t) => TOURNAMENT_LABEL[t] || t;

// Opponent name from the match slug when the opponent is not a Premier League club,
// e.g. "26-27-efl-cup-tottenham-hotspur-vs-charlton-athletic-2026-08-24".
const PREFIX = /^\d\d-\d\d-(prem|efl-cup|fa-cup|friendly|ucl|uel|uecl|champions-league|europa-league|conference-league|community-shield|uefa-super-cup|super-cup)-/;
export function opponentFromSlug(slug, clubSlug = 'tottenham-hotspur') {
  const core = String(slug).replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(PREFIX, '');
  const [left, right] = core.split('-vs-');
  if (!right) return null;
  const raw = left === clubSlug ? right : right === clubSlug ? left : null;
  if (!raw) return null;
  return raw.split('-').map((w) => (['fc', 'afc', 'sc', 'cf'].includes(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}
