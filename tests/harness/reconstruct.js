// Test harness: rebuilds FPL-API-shaped responses (bootstrap-static, fixtures,
// element-summary) from the community dataset's per-gameweek CSV snapshots, which are
// themselves taken from the FPL API. Used only for offline testing and previews when
// the live FPL API cannot be reached from the build machine.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../../pipeline/adapters/fplcore.js';

const n = (v) => (v === '' || v === undefined || v === null ? null : Number(v));

export function reconstruct(seasonDir) {
  const csv = (p) => parseCsv(fs.readFileSync(path.join(seasonDir, p), 'utf8'));
  const teamsRaw = csv('teams.csv');
  const teams = teamsRaw.map((t) => ({ id: n(t.id), code: n(t.code), name: t.name, short_name: t.short_name, position: 0, played: 0 }));
  const byCode = new Map(teams.map((t) => [t.code, t]));
  const players = csv('players.csv');
  const stats = csv('playerstats.csv');
  const latest = new Map();
  for (const s of stats) { const prev = latest.get(s.id); if (!prev || n(s.gw) > n(prev.gw)) latest.set(s.id, s); }
  const posMap = { Goalkeeper: 1, Defender: 2, Midfielder: 3, Forward: 4 };
  const elements = players.map((p) => {
    const s = latest.get(p.player_id) || {};
    const t = byCode.get(n(p.team_code));
    const e = { ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === '' ? null : v])) };
    return {
      ...e, id: n(p.player_id), code: n(p.player_code), first_name: p.first_name, second_name: p.second_name, web_name: p.web_name,
      team: t ? t.id : 0, element_type: posMap[p.position] || 0, birth_date: null, region: null, squad_number: null, team_join_date: null, removed: false,
      expected_goals: s.expected_goals ?? '0.00', expected_assists: s.expected_assists ?? '0.00', expected_goals_conceded: s.expected_goals_conceded ?? '0.00',
    };
  }).filter((e) => e.team);

  // Fixtures: one per Premier League match in the gameweek folders.
  const gwDirs = fs.readdirSync(path.join(seasonDir, 'By Gameweek')).filter((d) => /^GW\d+$/.test(d)).sort((a, b) => n(a.slice(2)) - n(b.slice(2)));
  const fixtures = []; const fixtureIndex = new Map();
  let fid = 1;
  for (const gw of gwDirs) {
    const f = path.join(seasonDir, 'By Gameweek', gw, 'fixtures.csv');
    if (!fs.existsSync(f)) continue;
    for (const m of parseCsv(fs.readFileSync(f, 'utf8'))) {
      if (m.tournament && m.tournament !== 'prem') continue;
      const h = byCode.get(n(m.home_team)); const a = byCode.get(n(m.away_team));
      if (!h || !a) continue;
      const finished = m.finished === 'True';
      const fx = { id: fid++, code: null, event: n(m.gameweek), kickoff_time: m.kickoff_time ? `${m.kickoff_time}Z` : null, team_h: h.id, team_a: a.id,
        team_h_score: finished ? n(m.home_score) : null, team_a_score: finished ? n(m.away_score) : null, finished, finished_provisional: finished, started: finished,
        minutes: finished ? 90 : 0, provisional_start_time: false, stats: [] };
      fixtures.push(fx);
      fixtureIndex.set(`${fx.event}-${h.id}`, fx); fixtureIndex.set(`${fx.event}-${a.id}`, fx);
    }
  }
  const events = gwDirs.map((gw) => {
    const id = n(gw.slice(2));
    const ks = fixtures.filter((f) => f.event === id).map((f) => f.kickoff_time).filter(Boolean).sort();
    return { id, name: `Gameweek ${id}`, deadline_time: ks[0] ? new Date(Date.parse(ks[0]) - 90 * 60000).toISOString() : null, finished: fixtures.filter((f) => f.event === id).every((f) => f.finished), is_current: false, is_next: false, data_checked: true };
  });

  // Element summaries from per-gameweek player stats.
  const histories = new Map();
  for (const gw of gwDirs) {
    const f = path.join(seasonDir, 'By Gameweek', gw, 'player_gameweek_stats.csv');
    if (!fs.existsSync(f)) continue;
    for (const r of parseCsv(fs.readFileSync(f, 'utf8'))) {
      const e = elements.find((x) => x.id === n(r.id));
      if (!e) continue;
      const fx = fixtureIndex.get(`${n(r.gw)}-${e.team}`);
      if (!fx || !fx.finished) continue;
      const row = { element: e.id, fixture: fx.id, opponent_team: fx.team_h === e.team ? fx.team_a : fx.team_h, was_home: fx.team_h === e.team, kickoff_time: fx.kickoff_time,
        team_h_score: fx.team_h_score, team_a_score: fx.team_a_score, round: fx.event };
      for (const k of ['total_points', 'minutes', 'goals_scored', 'assists', 'clean_sheets', 'goals_conceded', 'own_goals', 'penalties_saved', 'penalties_missed', 'yellow_cards', 'red_cards', 'saves', 'bonus', 'bps', 'starts', 'clearances_blocks_interceptions', 'recoveries', 'tackles', 'defensive_contribution']) row[k] = n(r[k]) ?? 0;
      for (const k of ['influence', 'creativity', 'threat', 'ict_index', 'expected_goals', 'expected_assists', 'expected_goal_involvements', 'expected_goals_conceded']) row[k] = r[k] === '' ? '0.0' : r[k];
      if (!histories.has(e.id)) histories.set(e.id, []);
      histories.get(e.id).push(row);
      // Fixture event stats (goals/assists/cards) for the match timeline.
      const side = fx.team_h === e.team ? 'h' : 'a';
      for (const [id, k] of [['goals_scored', 'goals_scored'], ['assists', 'assists'], ['yellow_cards', 'yellow_cards'], ['red_cards', 'red_cards'], ['own_goals', 'own_goals'], ['saves', 'saves'], ['bonus', 'bonus']]) {
        const v = n(r[k]);
        if (!v) continue;
        let st = fx.stats.find((s) => s.identifier === id);
        if (!st) { st = { identifier: id, h: [], a: [] }; fx.stats.push(st); }
        st[side].push({ value: v, element: e.id });
      }
    }
  }
  return { bootstrap: { events, teams, elements, element_types: [] }, fixtures, histories };
}
