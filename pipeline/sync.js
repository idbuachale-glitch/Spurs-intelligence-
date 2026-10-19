#!/usr/bin/env node
// Scheduled sync. Runs on GitHub Actions every ~20 minutes with no browser involved.
// Each job decides whether it is due; failures never overwrite the last valid data.
import path from 'node:path';
import fs from 'node:fs';
import { SITE_DATA, STATE_DIR, CLUB, CADENCE, ALERT_AFTER_FAILURES, PROVIDERS, COACH_ERAS } from './config.js';
import { readJson, writeJson, listFiles } from './lib/store.js';
import { quotaSummary, requestLog } from './lib/http.js';
import * as log from './lib/log.js';
import * as fpl from './adapters/fpl.js';
import * as tsdb from './adapters/thesportsdb.js';
import * as fd from './adapters/footballdata.js';
import * as yt from './adapters/youtube.js';
import * as fc from './adapters/fplcore.js';
import * as wiki from './adapters/wikipedia.js';
import { buildSeason } from './derive/build.js';
import { fotmobPool, strengthsProfile, proxyPanel } from './derive/profile.js';
import { setMinMinutes, minMinutes, leaguePool, leagueTeamRanks, insights, tactical, squadPlanner, positionRanks, playerPercentiles, scoutingSummary, article, coachFor } from './derive/analysis.js';
import { STATS, RATES, UNAVAILABLE, NOW_AVAILABLE, POS_LABEL } from './derive/stats.js';
import { leaders, roundContext, deservedTable } from './derive/leaguecontext.js';
import { runLive, attachStoredLive } from './derive/live.js';
import { buildBrief, checkBrief } from './derive/briefing.js';
import * as espn from './adapters/espn.js';
import { lineupEffect, teamIdFor } from './derive/lineups.js';
import { gameReport } from './derive/gamereport.js';
import { num } from './lib/validate.js';
import * as af from './adapters/apifootball.js';
import { ratings, expectedGoals, matchProbabilities, simulateSeason, priorFromElo, absencesFrom, backtest, PRIOR_MATCHES } from './derive/simulate.js';

const ELEMENT_FIELDS = ['id', 'code', 'first_name', 'second_name', 'web_name', 'known_name', 'team', 'element_type', 'birth_date', 'region', 'squad_number', 'team_join_date',
  'status', 'news', 'news_added', 'chance_of_playing_next_round', 'removed', 'minutes', 'starts', 'goals_scored', 'assists', 'expected_goals', 'expected_assists',
  'expected_goals_conceded', 'goals_conceded', 'clearances_blocks_interceptions', 'tackles', 'recoveries', 'defensive_contribution', 'saves', 'yellow_cards', 'red_cards', 'clean_sheets', 'corners_and_indirect_freekicks_order', 'direct_freekicks_order', 'penalties_order', 'threat', 'creativity', 'influence'];

export async function runSync({ now = new Date(), force = false, siteData = SITE_DATA, stateDir = STATE_DIR } = {}) {
  const S = (...p) => path.join(stateDir, ...p);
  const D = (...p) => path.join(siteData, ...p);
  const nowIso = now.toISOString();
  const sched = readJson(S('scheduler.json'), { jobs: {} });
  const status = readJson(D('status.json'), { sources: {} });
  const meta = readJson(D('meta.json'), {});
  const due = (job, minutes) => force || !sched.jobs[job]?.lastRun || (now - new Date(sched.jobs[job].lastRun)) / 60000 >= minutes - 1;
  const mark = (job) => { (sched.jobs[job] ||= {}).lastRun = nowIso; };

  const health = (key, label) => (status.sources[key] ||= { label, lastSuccess: null, lastFailure: null, consecutiveFailures: 0, lastError: null });
  const ok = (key, label, detail = {}) => Object.assign(health(key, label), { lastSuccess: nowIso, consecutiveFailures: 0, lastError: null, ...detail });
  const fail = (key, label, err) => {
    const h = health(key, label);
    h.lastFailure = nowIso; h.consecutiveFailures++; h.lastError = String(err.message || err).slice(0, 300);
    log.error(`${key} failed`, { error: h.lastError, consecutive: h.consecutiveFailures });
  };

  // ---------------- Core: bootstrap + fixtures ----------------
  let boot = readJson(S('raw', 'fpl', 'bootstrap-lite.json'));
  let fixtures = readJson(S('raw', 'fpl', 'fixtures.json'));
  if (due('core', CADENCE.core) || !boot || !fixtures) {
    mark('core');
    try {
      const b = await fpl.fetchBootstrap();
      const teamIds = new Set(b.teams.map((t) => t.id));
      const f = await fpl.fetchFixtures(teamIds);
      boot = {
        retrievedAt: nowIso, source: `${PROVIDERS.fpl.base}/bootstrap-static/`,
        events: b.events.map(({ id, name, deadline_time, finished, is_current, is_next, data_checked }) => ({ id, name, deadline_time, finished, is_current, is_next, data_checked })),
        teams: b.teams.map(({ id, code, name, short_name, position, played }) => ({ id, code, name, short_name, position, played })),
        elements: b.elements.map((e) => Object.fromEntries(ELEMENT_FIELDS.map((k) => [k, e[k] ?? null]))),
      };
      fixtures = { retrievedAt: nowIso, source: `${PROVIDERS.fpl.base}/fixtures/`, fixtures: f };
      writeJson(S('raw', 'fpl', 'bootstrap-lite.json'), boot);
      writeJson(S('raw', 'fpl', 'fixtures.json'), fixtures);
      ok('fpl-core', 'FPL fixtures, squads & season totals', { records: { players: b.elements.length, fixtures: f.length } });
    } catch (err) {
      fail('fpl-core', 'FPL fixtures, squads & season totals', err);
      if (!boot || !fixtures) {
        writeJson(D('status.json'), finalizeStatus(status, nowIso));
        writeJson(S('scheduler.json'), sched);
        throw new Error(`No FPL data available yet and fetch failed: ${err.message}`);
      }
    }
  }

  const season = fpl.seasonFromEvents(boot.events);
  const spursId = fpl.resolveTeamId(boot.teams, CLUB.matchNames);
  const teams = boot.teams.map((t) => ({ id: t.id, name: t.name, short: t.short_name, code: t.code }));
  const clubCode = boot.teams.find((t) => t.id === spursId).code;
  const elements = new Map(boot.elements.map((e) => [e.id, e]));
  if (meta.currentSeason && meta.currentSeason !== season) log.info('Season rollover detected', { from: meta.currentSeason, to: season });

  // Players who have ever been Spurs players this season (keeps leavers' Spurs stats).
  const seenFile = S('seen-elements', `${season}.json`);
  const seen = new Set(readJson(seenFile, []));
  for (const e of boot.elements) if (e.team === spursId) seen.add(e.id);
  writeJson(seenFile, [...seen].sort((a, b) => a - b));

  // ---------------- Player match stats ----------------
  const histDir = S('histories', season);
  const spursFx = fixtures.fixtures.filter((f) => f.team_h === spursId || f.team_a === spursId);
  const prevMatches = readJson(D('seasons', season, 'fixtures.json'), { fixtures: [] }).fixtures;
  const recentIncomplete = spursFx.some((f) => (f.finished || f.finished_provisional) && f.kickoff_time && now - new Date(f.kickoff_time) < 72 * 3600e3
    && !prevMatches.find((m) => m.id === `pl-${season}-${f.id}`)?.statsComplete);
  const missing = [...seen].filter((id) => !fs.existsSync(path.join(histDir, `${id}.json`)));
  if (due('playerStats', CADENCE.playerStats) || (recentIncomplete && due('playerStats', CADENCE.playerStatsMatch)) || missing.length) {
    mark('playerStats');
    let okCount = 0; let failCount = 0; let lastErr = null;
    for (const id of seen) {
      try {
        const s = await fpl.fetchElementSummary(id);
        writeJson(path.join(histDir, `${id}.json`), { retrievedAt: nowIso, source: `${PROVIDERS.fpl.base}/element-summary/${id}/`, history: s.history, history_past: s.history_past || [] });
        okCount++;
      } catch (err) { failCount++; lastErr = err; }
    }
    if (okCount && failCount <= Math.max(2, seen.size * 0.1)) ok('fpl-players', 'FPL player match statistics', { records: { players: okCount, failed: failCount } });
    else fail('fpl-players', 'FPL player match statistics', lastErr || new Error('no player summaries fetched'));
  }
  const histories = new Map();
  for (const f of listFiles(histDir)) {
    const h = readJson(path.join(histDir, f));
    if (h) histories.set(Number(f.replace('.json', '')), h.history);
  }

  // ---------------- Supplementary match detail (FPL Core Insights) ----------------
  const fcDir = S('fplcore', season);
  if (fc.enabled()) {
    const stored = new Map(listFiles(fcDir).map((f) => [f.replace('.json', ''), readJson(path.join(fcDir, f))]));
    const needs = (key, kickoffs) => {
      const r = stored.get(key);
      if (!r) return true;
      if (key.startsWith('Premier League__') && !Array.isArray(r.leaguePlayers)) return true; // one-off: add league-wide player rows
      if (key.startsWith('Premier League__') && r.leaguePlayers.length && !r.leaguePlayers.some((x) => x.running_distance !== undefined)) return true; // one-off: add tracking + recoveries columns
      const unfinished = r.matches.some((m) => (m.finished !== 'True' || m.player_stats_processed !== 'True') && m.kickoff_time && Date.parse(`${m.kickoff_time}Z`) < now.getTime());
      const fresh = kickoffs.some((k) => now - new Date(k) < 7 * 86400e3);
      return unfinished || fresh;
    };
    if (due('detail', recentIncomplete ? CADENCE.playerStatsMatch : 180)) {
      mark('detail');
      let fetched = 0; let errors = 0; let lastErr = null;
      try {
        const sd = fc.seasonDir(season);
        const tournaments = await fc.listDir(`data/${sd}/By Tournament`);
        for (const t of tournaments) {
          let rounds;
          if (t === 'Premier League') {
            rounds = [...new Set(spursFx.filter((f) => (f.finished || f.finished_provisional) && f.event).map((f) => `GW${f.event}`))];
          } else {
            rounds = await fc.listDir(`data/${sd}/By Tournament/${t}`);
          }
          for (const gw of rounds) {
            const key = `${t}__${gw}`;
            const kos = t === 'Premier League' ? spursFx.filter((f) => `GW${f.event}` === gw).map((f) => f.kickoff_time) : [];
            const isNewCupRound = t !== 'Premier League' && !stored.has(key);
            if (!needs(key, kos) && !isNewCupRound) continue;
            if (stored.has(key) && !stored.get(key).matches.length && now - new Date(stored.get(key).retrievedAt) < 86400e3) continue;
            try {
              const r = await fc.fetchRound(season, t, gw, clubCode);
              writeJson(path.join(fcDir, `${key}.json`), { retrievedAt: nowIso, tournament: t, gw, source: `github.com/${process.env.FPLCORE_REPO || 'olbauday/FPL-Elo-Insights'}`, ...r });
              fetched++;
            } catch (err) { errors++; lastErr = err; }
          }
        }
        if (errors && !fetched) throw lastErr;
        ok('fplcore', fc.label, { records: { roundsFetched: fetched, errors } });
      } catch (err) { fail('fplcore', fc.label, err); }
    }
  } else {
    status.sources.fplcore = { label: fc.label, disabled: true, note: 'Disabled (SUPPLEMENTARY_STATS=off). Shots, passing, take-ons, duels and cup player stats are hidden.' };
  }
  const detail = { matches: [], players: [], shots: [], momentum: [], xgMinute: [], leagueMatches: [], leaguePlayers: [] };
  if (fc.enabled()) for (const f of listFiles(fcDir)) {
    const r = readJson(path.join(fcDir, f));
    if (!r) continue;
    for (const m of r.matches) detail.matches.push({ tournament: r.tournament, gw: r.gw, row: m });
    detail.players.push(...r.players); detail.shots.push(...r.shots); detail.momentum.push(...(r.momentum || [])); detail.xgMinute.push(...(r.xgMinute || [])); detail.leagueMatches.push(...(r.leagueMatches || [])); detail.leaguePlayers.push(...(r.leaguePlayers || []));
  }

  // ---------------- Other competitions (TheSportsDB) ----------------
  const cupsFile = S('cups', `${season}.json`);
  const cups = readJson(cupsFile, { events: {} });
  const nextSpurs = spursFx.filter((f) => f.kickoff_time && !f.finished).map((f) => new Date(f.kickoff_time)).sort((a, b) => a - b)[0];
  const matchday = nextSpurs && Math.abs(nextSpurs - now) < 12 * 3600e3;
  if (due('cups', matchday ? 60 : CADENCE.cups)) {
    mark('cups');
    try {
      const st = readJson(S('ids.json'), {});
      st.tsdbTeam ||= await tsdb.resolveTeamId();
      writeJson(S('ids.json'), st);
      const evs = await tsdb.fetchEvents(st.tsdbTeam);
      let added = 0;
      for (const e of evs) {
        if (!e.kickoff || seasonOfDate(e.kickoff) !== season) continue;
        const prev = cups.events[e.id];
        // Never replace a known final score with a missing one.
        cups.events[e.id] = prev && prev.score && !e.score ? { ...e, score: prev.score, status: prev.status } : e;
        if (!prev) added++;
      }
      cups.retrievedAt = nowIso;
      writeJson(cupsFile, cups);
      ok('thesportsdb', 'TheSportsDB — cups, Europe & score cross-check', { records: { received: evs.length, new: added } });
    } catch (err) { fail('thesportsdb', 'TheSportsDB — cups, Europe & score cross-check', err); }
  }

  // ---------------- Video (YouTube RSS) ----------------
  const vidFile = S('videos.json');
  const vids = readJson(vidFile, { videos: {} });
  if (due('video', matchday ? 30 : CADENCE.video)) {
    mark('video');
    for (const ch of PROVIDERS.youtube.channels) {
      const key = `youtube-${ch.key}`;
      try {
        const r = await yt.fetchChannel(ch);
        // General channels publish about every club: keep only videos that mention Spurs.
        const keepV = r.videos.filter((v) => ch.spursOnly || /tottenham|\bspurs\b|de zerbi/i.test(`${v.title} ${v.description}`));
        for (const v of keepV) vids.videos[v.videoId] = { ...vids.videos[v.videoId], ...v, firstSeen: vids.videos[v.videoId]?.firstSeen || nowIso };
        ok(key, `YouTube — ${r.author}`, { records: { feedItems: r.videos.length, spursItems: keepV.length }, channelId: r.channelId, optional: !!ch.optional });
      } catch (err) { fail(key, `YouTube — ${ch.handle}`, err); if (ch.optional) status.sources[key].optional = true; }
    }
    const keep = Object.values(vids.videos).sort((a, b) => String(b.published).localeCompare(String(a.published))).slice(0, 600);
    vids.videos = Object.fromEntries(keep.map((v) => [v.videoId, v]));
    writeJson(vidFile, vids);
  }

  // ---------------- Regions (nationalities) ----------------
  let regions = readJson(S('raw', 'fpl', 'regions.json'), null);
  if (due('regions', CADENCE.regions) || !regions) {
    mark('regions');
    try {
      const r = await fpl.fetchRegions();
      regions = { retrievedAt: nowIso, regions: r.map(({ id, name, iso_code_short }) => ({ id, name, iso: iso_code_short })) };
      writeJson(S('raw', 'fpl', 'regions.json'), regions);
      ok('fpl-regions', 'FPL nationality list');
    } catch (err) { fail('fpl-regions', 'FPL nationality list', err); }
  }

  // ---------------- Head coach (era labels) ----------------
  const erasFile = S('coach-eras.json');
  const eras = readJson(erasFile, null) || COACH_ERAS.map((e) => ({ ...e }));
  if (due('coach', 7 * 24 * 60)) {
    mark('coach');
    try {
      const name = await wiki.fetchHeadCoach();
      const cur = eras[eras.length - 1];
      const same = (a, b) => a.toLowerCase().split(' ').pop() === b.toLowerCase().split(' ').pop();
      if (!same(name, cur.coach)) {
        cur.to = nowIso.slice(0, 10);
        eras.push({ coach: name, from: nowIso.slice(0, 10), to: null, detected: 'Wikipedia infobox' });
        log.info('Head coach change detected', { from: cur.coach, to: name });
      }
      writeJson(erasFile, eras);
      ok('wikipedia', 'Wikipedia — head coach (era labels)', { headCoach: name });
    } catch (err) { fail('wikipedia', 'Wikipedia — head coach (era labels)', err); }
  }
  COACH_ERAS.splice(0, COACH_ERAS.length, ...eras);

  // ---------------- Build season dataset ----------------
  const aliases = readJson(path.join(path.dirname(new URL(import.meta.url).pathname), 'aliases.json'), {});
  const built = buildSeason({
    season, generatedAt: nowIso, isCurrent: true, teams, spursId, fplFixtures: fixtures.fixtures, elements, histories,
    cupMatches: Object.values(cups.events), prevFixtures: prevMatches, videos: Object.values(vids.videos),
    regions: new Map(((regions && regions.regions) || []).map((r) => [r.id, r])), aliases, sourceRef: 'Fantasy Premier League API',
    detail, clubCode, spursElementIds: seen,
  });

  // ---------------- Independent standings check ----------------
  let standingsCheck = readJson(S('standings-check.json'), null);
  if (fd.enabled() && due('standingsCheck', CADENCE.standingsCheck)) {
    mark('standingsCheck');
    try {
      const s = await fd.fetchPlStandings();
      const spurs = s.rows.find((r) => /tottenham/i.test(r.team));
      standingsCheck = { retrievedAt: nowIso, source: 'football-data.org', spurs, agrees: spurs && built.table.find((r) => r.teamId === spursId)?.points === spurs.points && built.table.find((r) => r.teamId === spursId)?.played === spurs.played };
      writeJson(S('standings-check.json'), standingsCheck);
      ok('football-data', 'football-data.org — standings cross-check');
    } catch (err) { fail('football-data', 'football-data.org — standings cross-check', err); }
  } else if (!fd.enabled()) {
    status.sources['football-data'] = { label: 'football-data.org — standings cross-check', disabled: true, note: 'Optional. Add a free FOOTBALL_DATA_KEY secret to enable an independent table check.' };
  }
  const fplPos = boot.teams.find((t) => t.id === spursId);
  built.files['table.json'].verification = {
    fplOfficialPosition: fplPos && fplPos.position && fplPos.played > 0 ? { position: fplPos.position, agrees: fplPos.position === built.files['table.json'].spurs?.position } : null,
    footballData: standingsCheck,
  };
  try {
    built.files['table.json'].leaders = { source: 'FPL API season totals (all clubs)', ...leaders(boot.elements, teams) };
    built.files['table.json'].deserved = deservedTable(detail.leagueMatches || [], teams, built.table);
    built.files['table.json'].round = roundContext({ table: built.table, fplFixtures: fixtures.fixtures, spursId, teams, now });
  } catch (err) { log.error('table context failed', { error: String(err.message || err) }); }

  // ---------------- Analysis ----------------
  setMinMinutes(Math.max(0, ...built.table.map((r) => r.played)));
  const pool = leaguePool(boot.elements, teams);
  const ranks = leagueTeamRanks(pool, built.table);
  const prevSeason = previousSeason(season);
  const prevTeam = readJson(D('seasons', prevSeason, 'team.json'), null);
  const allTeamMatches = [];
  for (const s of listFiles(D('seasons')).filter((x) => /^\d{4}-\d{2}$/.test(x) && x !== season).sort()) {
    const t = readJson(D('seasons', s, 'team.json'), null);
    if (t) allTeamMatches.push(...t.matches);
  }
  allTeamMatches.push(...built.teamMatches);
  const ins = insights({ team: built.teamSummary, players: built.players, table: built.table, spursId, ranks, prevTeam });
  const tac = tactical({ allTeamMatches, team: built.teamSummary, players: built.players, season });
  const squad = squadPlanner({ players: built.players, pool, spursId, ranksByPos: positionRanks(pool, spursId) });
  const scouting = {};
  const elementsById = new Map(boot.elements.map((e) => [Number(e.id), e]));
  const fotPool = fotmobPool(detail.leaguePlayers, elementsById);
  for (const p of built.players) {
    const pc = playerPercentiles(pool, p.id);
    const prof = strengthsProfile({ player: p, fotPool, fplPct: pc, minMinutes: minMinutes() });
    const proxies = proxyPanel({ player: p, fotPool, minMinutes: minMinutes() });
    scouting[p.id] = { percentiles: pc, summary: scoutingSummary(p, pc), profile: prof };
    if (built.files[`players/${p.id}.json`]) Object.assign(built.files[`players/${p.id}.json`], { percentiles: pc, summary: scouting[p.id].summary, profile: prof, proxies });
  }
  const sources = [...(fc.enabled() ? ['FPL Core Insights — github.com/olbauday/FPL-Elo-Insights (shots, passing, take-ons, possession; match data collected from FotMob)'] : []), 'Fantasy Premier League API — fantasy.premierleague.com/api (fixtures, results, player statistics; Opta-derived xG/xA)', 'TheSportsDB — thesportsdb.com (non-Premier League fixtures and score cross-check)', 'YouTube — official Tottenham Hotspur and Premier League channels plus Sky Sports Premier League, The Athletic FC, Coaches\' Voice, HITC Sevens, The Overlap and Last Word On Spurs (video metadata and links only)'];
  const art = article({ season, generatedAt: nowIso, team: built.teamSummary, insightsList: ins, tacticalData: tac, sources });
  built.files['analysis.json'] = { season, generatedAt: nowIso, label: 'Calculated analysis — generated by fixed rules from the stored figures; not official fact.', insights: ins, tactical: tac, squad, leagueRanks: ranks, articleMarkdown: art };
  built.files['league-players.json'] = { season, generatedAt: nowIso, source: 'Fantasy Premier League API', minMinutesForRates: minMinutes(), players: pool.map(({ f, ...p }) => ({ ...p, per90: f })) };

  // ---------------- Season simulator & match probabilities ----------------
  try {
    // Long-term prior: last season's final Elo ratings (fetched once per season).
    const priorFile = S(`prior-elo-${season}.json`);
    let eloPrior = readJson(priorFile, null);
    if (!eloPrior && fc.enabled()) {
      const y = Number(season.slice(0, 4)); const prevDir = `${y - 1}-${y}`;
      for (const path_ of [`data/${prevDir}/By Gameweek/GW38/teams.csv`, `data/${prevDir}/teams.csv`]) {
        try {
          const rows = await fc.fetchCsv(path_);
          const elo = Object.fromEntries(rows.filter((r) => Number(r.elo) > 0).map((r) => [Number(r.code), Number(r.elo)]));
          if (Object.keys(elo).length >= 15) { eloPrior = { retrievedAt: nowIso, source: path_, elo }; writeJson(priorFile, eloPrior); break; }
        } catch { /* try the next path */ }
      }
    }
    const prior = priorFromElo(teams, eloPrior?.elo || null);
    const absences = absencesFrom(boot.elements, teams);
    const R = ratings(detail.leagueMatches || [], teams, { prior, fplFixtures: fixtures.fixtures, now, absences });

    // ---- Confirmed line-ups (match day): fetched from 100 minutes before kick-off ----
    const luDir = S('lineups');
    const overrides = new Map(); const lineupInfo = new Map(); // key "homeId-awayId"
    const windowFx = fixtures.fixtures.filter((f) => f.kickoff_time && !(f.finished || f.finished_provisional) && Math.abs(Date.parse(f.kickoff_time) - now.getTime()) < 100 * 60e3 || (f.kickoff_time && now.getTime() - Date.parse(f.kickoff_time) < 3 * 3600e3 && now.getTime() > Date.parse(f.kickoff_time)));
    // Spurs cup ties too (league code from the competition name).
    const cupFx = built.fixtures.filter((f) => f.kickoff && f.competition !== 'Premier League' && !f.friendly && espn.LEAGUES[f.competition] && Math.abs(Date.parse(f.kickoff) - now.getTime()) < 100 * 60e3);
    if (espn.enabled() && (windowFx.length || cupFx.length)) {
      try {
        const want = [...windowFx.map((f) => ({ key: `${num(f.team_h)}-${num(f.team_a)}`, h: num(f.team_h), a: num(f.team_a), ko: f.kickoff_time, league: 'eng.1' })),
          ...cupFx.map((f) => ({ key: `cup-${f.id}`, h: f.home ? spursId : null, a: f.home ? null : spursId, ko: f.kickoff, league: espn.LEAGUES[f.competition], fixtureId: f.id }))];
        const boards = new Map();
        for (const w of want) {
          const file = path.join(luDir, `${w.key}-${w.ko.slice(0, 10)}.json`);
          let lu = readJson(file, null);
          if (!lu) {
            const ymd = w.ko.slice(0, 10).replace(/-/g, '');
            const bk = `${w.league}-${ymd}`;
            if (!boards.has(bk)) boards.set(bk, await espn.scoreboard(w.league, ymd).catch(() => []));
            const ev = boards.get(bk).find((e) => (w.h === null || teamIdFor(e.home, teams) === w.h) && (w.a === null || teamIdFor(e.away, teams) === w.a) && (w.h !== null || w.a !== null));
            if (!ev) continue;
            const got = await espn.lineups(w.league, ev.id).catch(() => null);
            if (!got) continue;
            lu = { retrievedAt: nowIso, espnEvent: ev.id, ...got }; writeJson(file, lu);
          }
          const hE = w.h !== null ? lineupEffect(lu.home, w.h, boot.elements) : null; const aE = w.a !== null ? lineupEffect(lu.away, w.a, boot.elements) : null;
          if (hE && aE) overrides.set(w.key, { home: hE, away: aE });
          lineupInfo.set(w.key, { retrievedAt: lu.retrievedAt, home: { ...lu.home, effect: hE }, away: { ...lu.away, effect: aE } });
        }
        ok('espn', espn.label, { records: { lineupsConfirmed: lineupInfo.size } });
      } catch (err) { fail('espn', espn.label, err); }
    }
    const ovFor = (homeId, awayId) => overrides.get(`${homeId}-${awayId}`) || null;
    // Re-simulate only when the table, remaining fixtures or ratings change.
    const simKey = JSON.stringify([built.table.map((r) => [r.teamId, r.points, r.gd, r.gf]), fixtures.fixtures.filter((f) => !(f.finished || f.finished_provisional)).map((f) => f.id), [...R.ratings].map(([k, v]) => [k, v.att.toFixed(3), v.def.toFixed(3)]), 'v2', [...overrides.keys()]]);
    const simCache = readJson(S('sim-cache.json'), null);
    const sim = simCache && simCache.key === simKey ? simCache.sim : simulateSeason({ table: built.table, fplFixtures: fixtures.fixtures, teams, R, spursId, now, overrides });
    if (!simCache || simCache.key !== simKey) writeJson(S('sim-cache.json'), { key: simKey, sim });
    const predFile = S('predictions.json');
    const preds = readJson(predFile, {});
    const nextFx = built.fixtures.find((f) => f.status === 'SCHEDULED' && f.kickoff && !f.friendly);
    let next = null;
    if (nextFx && nextFx.opponentTeamId && R.ratings.has(nextFx.opponentTeamId)) {
      const neutral = nextFx.competition !== 'Premier League' && /final/i.test(nextFx.competition);
      const hId = nextFx.home ? spursId : nextFx.opponentTeamId; const aId = nextFx.home ? nextFx.opponentTeamId : spursId;
      const ov = ovFor(hId, aId);
      const xg = expectedGoals(R, hId, aId, neutral, ov);
      const p = matchProbabilities(xg.home, xg.away);
      let early = null;
      if (ov) { const x0 = expectedGoals(R, hId, aId, neutral); const p0 = matchProbabilities(x0.home, x0.away); early = { win: Math.round((nextFx.home ? p0.home : p0.away) * 1000) / 10, draw: Math.round(p0.draw * 1000) / 10, loss: Math.round((nextFx.home ? p0.away : p0.home) * 1000) / 10, expectedGoals: { spurs: Math.round((nextFx.home ? x0.home : x0.away) * 100) / 100, opp: Math.round((nextFx.home ? x0.away : x0.home) * 100) / 100 } }; }
      const lu = lineupInfo.get(`${hId}-${aId}`) || lineupInfo.get(`cup-${nextFx.id}`) || null;
      const spursWin = nextFx.home ? p.home : p.away; const oppWin = nextFx.home ? p.away : p.home;
      next = {
        matchId: nextFx.id, opponent: nextFx.opponent, home: nextFx.home, kickoff: nextFx.kickoff, competition: nextFx.competition,
        win: Math.round(spursWin * 1000) / 10, draw: Math.round(p.draw * 1000) / 10, loss: Math.round(oppWin * 1000) / 10,
        expectedGoals: { spurs: Math.round((nextFx.home ? xg.home : xg.away) * 100) / 100, opp: Math.round((nextFx.home ? xg.away : xg.home) * 100) / 100 },
        likelyScores: p.likelyScores.map((x) => ({ spurs: nextFx.home ? x.h : x.a, opp: nextFx.home ? x.a : x.h, p: x.p })),
        over25: Math.round(p.over25 * 1000) / 10, btts: Math.round(p.btts * 1000) / 10,
        lineupsConfirmed: Boolean(ov), early,
        lineups: lu ? { retrievedAt: lu.retrievedAt, spurs: nextFx.home ? lu.home : lu.away, opp: nextFx.home ? lu.away : lu.home } : null,
      };
      // Keep the latest pre-kick-off forecast so it can be compared with the result later.
      if (Date.parse(nextFx.kickoff) > now.getTime()) preds[nextFx.id] = { ...next, savedAt: nowIso };
      const mf = built.files[`matches/${nextFx.id}.json`];
      if (mf) { mf.forecast = next; if (mf.preview) mf.preview.forecast = next; if (next.lineups) mf.lineups = next.lineups; }
    }
    // Difficulty for every upcoming match against a rated (Premier League) opponent:
    // expected points for Spurs from the same model (3 × win% + draw%).
    for (const f of built.fixtures) {
      if (f.status !== 'SCHEDULED' || f.friendly || !f.opponentTeamId || !R.ratings.has(f.opponentTeamId) || !R.ratings.has(spursId)) continue;
      const neutral = f.competition !== 'Premier League' && /final/i.test(f.competition);
      const xg = f.home ? expectedGoals(R, spursId, f.opponentTeamId, neutral, ovFor(spursId, f.opponentTeamId)) : expectedGoals(R, f.opponentTeamId, spursId, neutral, ovFor(f.opponentTeamId, spursId));
      if (!xg) continue;
      const p = matchProbabilities(xg.home, xg.away);
      const win = f.home ? p.home : p.away; const loss = f.home ? p.away : p.home;
      const xpts = 3 * win + p.draw;
      f.difficulty = { level: xpts >= 1.6 ? 'easy' : xpts >= 1.2 ? 'medium' : 'hard', win: Math.round(win * 100), draw: Math.round(p.draw * 100), loss: Math.round(loss * 100), xpts: Math.round(xpts * 100) / 100 };
    }
    // Scoreline forecasts for Spurs' next league fixtures (grid rows = Spurs goals, columns = opponent goals).
    const upcoming = [];
    for (const f of built.fixtures.filter((x) => x.status === 'SCHEDULED' && !x.friendly && x.opponentTeamId && R.ratings.has(x.opponentTeamId)).slice(0, 6)) {
      const ovU = f.home ? ovFor(spursId, f.opponentTeamId) : ovFor(f.opponentTeamId, spursId);
      const xg = f.home ? expectedGoals(R, spursId, f.opponentTeamId, false, ovU) : expectedGoals(R, f.opponentTeamId, spursId, false, ovU);
      if (!xg) continue;
      const p = matchProbabilities(xg.home, xg.away);
      const sG = f.home ? p.grid : p.grid[0].map((_, j) => p.grid.map((r) => r[j])); // orient: rows = Spurs goals
      upcoming.push({ matchId: f.id, opponent: f.opponent, opponentTeamId: f.opponentTeamId, home: f.home, kickoff: f.kickoff, competition: f.competition,
        win: Math.round((f.home ? p.home : p.away) * 1000) / 10, draw: Math.round(p.draw * 1000) / 10, loss: Math.round((f.home ? p.away : p.home) * 1000) / 10,
        xg: { spurs: Math.round((f.home ? xg.home : xg.away) * 100) / 100, opp: Math.round((f.home ? xg.away : xg.home) * 100) / 100 },
        over25: Math.round(p.over25 * 1000) / 10, btts: Math.round(p.btts * 1000) / 10, grid: sG,
        scores: p.likelyScores.map((x) => ({ spurs: f.home ? x.h : x.a, opp: f.home ? x.a : x.h, p: x.p })),
        news: ovU ? null : { spurs: R.ratings.get(spursId)?.absence || null, opp: R.ratings.get(f.opponentTeamId)?.absence || null },
        lineupsConfirmed: Boolean(ovU), early: ovU && next && next.matchId === f.id ? next.early : null });
    }
    let bt = null;
    try { bt = backtest({ leagueMatches: detail.leagueMatches || [], teams, prior, fplFixtures: fixtures.fixtures }); } catch (err) { log.error('backtest failed', { error: String(err.message || err) }); }
    // Record of past forecasts against actual results.
    const record = [];
    for (const [id, pr] of Object.entries(preds)) {
      const fx = built.fixtures.find((f) => f.id === id);
      if (!fx || !fx.result) continue;
      const res = fx.result; const pOf = { W: pr.win, D: pr.draw, L: pr.loss };
      const brier = (((res === 'W' ? 1 : 0) - pr.win / 100) ** 2 + ((res === 'D' ? 1 : 0) - pr.draw / 100) ** 2 + ((res === 'L' ? 1 : 0) - pr.loss / 100) ** 2);
      record.push({ ...pr, result: res, score: fx.score, probOfResult: pOf[res], favourite: pr.win >= pr.draw && pr.win >= pr.loss ? 'W' : pr.loss >= pr.draw ? 'L' : 'D', brier: Math.round(brier * 1000) / 1000 });
      const mf = built.files[`matches/${id}.json`];
      if (mf) mf.forecast = { ...pr, result: res, probOfResult: pOf[res] };
    }
    record.sort((a, b) => String(b.kickoff).localeCompare(String(a.kickoff)));
    writeJson(predFile, preds);
    built.files['simulation.json'] = {
      season, generatedAt: nowIso, ...sim, next, record, upcoming, backtest: bt,
      prior: eloPrior ? { source: eloPrior.source, used: Boolean(prior) } : null,
      method: `Team strength = last season's final Elo rating (counted as ${PRIOR_MATCHES} matches) blended with this season's xG created and conceded per league match, recent matches weighted more (60-day half-life). Missing players lower a team's rating for the next fortnight. Scores: Poisson goals with the Dixon–Coles low-score correction. The rest of the season is played 10,000 times, each run with slightly different team strengths to reflect uncertainty.`,
      label: 'Probabilities from a simple statistical model, not betting odds. They move after every match as the data changes.',
    };
    ok('simulator', 'Season simulator', { records: { remainingFixtures: sim.remainingFixtures } });
  } catch (err) { fail('simulator', 'Season simulator', err); }

  // ---------------- Matchday briefing ----------------
  try {
    const briefDir = S('briefs');
    const preds = readJson(S('predictions.json'), {});
    const nextF = built.fixtures.find((f) => (f.status === 'SCHEDULED' || f.status === 'LIVE') && f.kickoff && !f.friendly);
    let brief = null;
    if (nextF) {
      brief = buildBrief({ fixture: nextF, match: built.files[`matches/${nextF.id}.json`], round: built.files['table.json'].round, players: built.players, teamMatches: built.teamMatches });
      // Saved until kick-off so it can be checked honestly afterwards.
      if (Date.parse(nextF.kickoff) > now.getTime()) writeJson(path.join(briefDir, `${nextF.id}.json`), { savedAt: nowIso, ...brief });
    }
    const past = built.fixtures.filter((f) => f.result && !f.friendly).slice(-6).reverse();
    const reviews = [];
    for (const f of past) {
      const mf = built.files[`matches/${f.id}.json`]; if (!mf) continue;
      const r = checkBrief({ brief: readJson(path.join(briefDir, `${f.id}.json`), null), prediction: preds[f.id] || null, match: mf });
      if (r && r.checks.length) reviews.push(r);
    }
    built.files['briefing.json'] = { season, generatedAt: nowIso, next: brief, reviews,
      label: 'Built by fixed rules from the stored data. The watch-list is saved before kick-off and checked against the match statistics afterwards.' };
  } catch (err) { log.error('briefing failed', { error: String(err.message || err) }); }

  // ---------------- Badges for opponents outside the Premier League ----------------
  const badgeFile = S('badges.json');
  const badges = readJson(badgeFile, { names: {} });
  try {
    const plNames = new Set(teams.flatMap((t) => [t.name, t.short]).map((x) => x.toLowerCase()));
    const want = [...new Set(built.fixtures.filter((f) => !f.opponentTeamId && f.opponent).map((f) => f.opponent))].filter((n) => !plNames.has(n.toLowerCase()));
    let looked = 0;
    for (const n of want) {
      const b = badges.names[n];
      if (b && (b.url || now - new Date(b.at) < 7 * 86400e3)) continue; // misses retried weekly
      if (looked >= 15) break; // keep each run light
      looked++;
      badges.names[n] = { url: await tsdb.findBadge(n).catch(() => null), at: nowIso };
    }
    if (looked) writeJson(badgeFile, badges);
  } catch (err) { log.error('badge lookup failed', { error: String(err.message || err) }); }

  // ---------------- Live match feed (only while a Spurs match is in play) ----------------
  attachStoredLive(built, stateDir);
  if (af.enabled()) health('api-football', af.label).optional = true; else status.sources['api-football'] = { label: af.label, disabled: true, note: 'Optional. Add a free API_FOOTBALL_KEY secret for live shots, fouls, cards and corners during Spurs matches.' };
  try {
    const liveRes = await runLive({ built, stateDir, now, spursElementIds: seen, elementsById,
      health: { ok: (d) => ok('api-football', af.label, d), fail: (e) => fail('api-football', af.label, e), espnOk: (d) => ok('espn', espn.label, d), espnFail: (e) => fail('espn', espn.label, e) } });
    if (liveRes.match) log.info('live window', { match: liveRes.match, notes: liveRes.notes });
  } catch (err) { log.error('live feed failed', { error: String(err.message || err) }); }

  // ---------------- Game reports (De Zerbi tracker) ----------------
  // Team sheets for finished Spurs matches come from ESPN once each (cached for good);
  // the report itself is rebuilt from the stored figures on every run.
  try {
    const luDir2 = S('lineups');
    const missFile = path.join(luDir2, 'misses.json'); const misses = readJson(missFile, {});
    let fetched = 0;
    const done = built.fixtures.filter((f) => f.result && f.kickoff && !f.friendly && espn.LEAGUES[f.competition] && now.getTime() - Date.parse(f.kickoff) > 2.5 * 3600e3);
    const sheetOf = (f) => readJson(path.join(luDir2, `match-${f.id}.json`), null);
    if (espn.enabled()) {
      for (const f of done) {
        if (fetched >= 8 || sheetOf(f)) continue;
        const ms = misses[f.id];
        if (ms && (ms.tries >= 4 || now.getTime() - Date.parse(ms.at) < 6 * 3600e3)) continue;
        const ymd = f.kickoff.slice(0, 10).replace(/-/g, '');
        try {
          fetched++;
          const board = await espn.scoreboard(espn.LEAGUES[f.competition], ymd);
          const ev = board.find((e) => /tottenham/i.test(`${e.home} ${e.away}`));
          const got = ev ? await espn.lineups(espn.LEAGUES[f.competition], ev.id) : null;
          if (got) { writeJson(path.join(luDir2, `match-${f.id}.json`), { retrievedAt: nowIso, espnEvent: ev.id, ...got }); delete misses[f.id]; } else misses[f.id] = { tries: (ms?.tries || 0) + 1, at: nowIso };
        } catch (err) { misses[f.id] = { tries: (ms?.tries || 0) + 1, at: nowIso, error: String(err.message || err) }; }
      }
      writeJson(missFile, misses);
    }
    let prevSheet = null; let prevOpp = null; let reports = 0;
    for (const f of done.concat(built.fixtures.filter((x) => x.result && !x.friendly && !espn.LEAGUES[x.competition]))
      .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))) {
      const mf = built.files[`matches/${f.id}.json`]; if (!mf) continue;
      const sheet = espn.LEAGUES[f.competition] ? sheetOf(f) : null;
      const gr = gameReport({ match: mf, sheet, prevSheet, prevOpp, teamMatches: built.teamMatches, leagueMetrics: built.teamSummary.leagueRanks?.metrics || {} });
      if (gr) { mf.gameReport = gr; reports++; }
      if (sheet) { prevSheet = sheet; prevOpp = f.opponent; }
    }
    if (fetched) ok('espn', espn.label, { records: { teamSheetsFetched: fetched, reports } });
  } catch (err) { log.error('game reports failed', { error: String(err.message || err) }); }

  // ---------------- Write (with no-partial-overwrite protection) ----------------
  let changed = 0;
  for (const [rel, data] of Object.entries(built.files)) {
    const file = D('seasons', season, rel);
    if (rel.startsWith('matches/')) {
      const prev = readJson(file, null);
      if (prev && prev.statsComplete && (!data.statsComplete || data.lineup.length < prev.lineup.length)) {
        log.warn('Kept complete match record over partial update', { match: rel });
        data.lineup = prev.lineup; data.team = prev.team; data.statsComplete = true;
      }
    }
    if (writeJson(file, data, { stableKeys: ['generatedAt'] })) changed++;
  }

  // ---------------- Indexes, meta, status ----------------
  const seasonsList = listFiles(D('seasons')).filter((x) => /^\d{4}-\d{2}$/.test(x)).sort().reverse();
  writeJson(D('seasons.json'), { current: season, seasons: seasonsList });
  if (writeJson(D('players-index.json'), buildPlayerIndex(D, seasonsList))) changed++;
  const next = built.fixtures.find((f) => f.status === 'SCHEDULED' || f.status === 'LIVE');
  const last = [...built.fixtures].reverse().find((f) => f.result);
  writeJson(D('meta.json'), {
    club: CLUB.name, currentSeason: season, displayTimeZone: CLUB.displayTimeZone, providerTeamIds: { fpl: spursId, thesportsdb: readJson(S('ids.json'), {}).tsdbTeam || null },
    headCoach: coachFor(nowIso), coachEras: COACH_ERAS, generatedAt: nowIso,
    dataUpdatedAt: { fixtures: fixtures.retrievedAt, playerStats: maxRetrieved(histDir), matchDetail: maxRetrieved(fcDir), cups: cups.retrievedAt || null, video: status.sources['youtube-spurs']?.lastSuccess || null },
    nextMatchId: next ? next.id : null, lastMatchId: last ? last.id : null,
    statDefs: STATS.map(({ field, ...s }) => ({ ...s, sourceField: field || null })), rateDefs: RATES, supplementaryEnabled: fc.enabled(), unavailable: UNAVAILABLE, nowAvailable: NOW_AVAILABLE, posLabels: POS_LABEL,
    teamCodes: Object.fromEntries(teams.map((t) => [t.id, t.code])), teamShort: Object.fromEntries(teams.map((t) => [t.id, t.short])), teamNames: Object.fromEntries(teams.map((t) => [t.id, t.name])),
    extraBadges: Object.fromEntries(Object.entries(readJson(S('badges.json'), { names: {} }).names).filter(([, v]) => v.url).map(([k, v]) => [k, v.url])),
  });
  status.lastRun = nowIso;
  status.runFilesChanged = changed;
  status.requests = quotaSummary();
  status.quotaNotes = {
    'fantasy.premierleague.com': 'No published quota; this site makes ~2 requests per 20 min plus ~30 after matches, spaced 400 ms apart.',
    'www.thesportsdb.com': 'Free tier: 30 requests/min; this site uses 2–3 per run every 1–6 h.',
    'api.football-data.org': 'Free tier: 10 requests/min (only if a key is configured).',
    'www.youtube.com': 'Public RSS feeds; 2–4 requests every 0.5–2 h.',
    'raw.githubusercontent.com / api.github.com': 'Community dataset: ~10 small files every 3 h (30 min after matches). GitHub API listing uses the workflow token (1,000 req/h).',
  };
  writeJson(D('status.json'), finalizeStatus(status, nowIso));
  writeJson(S('scheduler.json'), sched);
  log.info('Sync complete', { season, filesChanged: changed, requests: requestLog.length });
  const persistent = Object.entries(status.sources).filter(([, s]) => !s.optional && s.consecutiveFailures >= ALERT_AFTER_FAILURES);
  return { season, changed, persistent };
}

function finalizeStatus(status, nowIso) {
  const warnings = [];
  for (const [k, s] of Object.entries(status.sources)) {
    if (s.disabled) continue;
    if (s.optional && s.consecutiveFailures >= ALERT_AFTER_FAILURES) warnings.push({ source: k, level: 'warn', text: `${s.label} (optional analysis channel) has been unreachable since ${s.lastSuccess || 'the start'}; the Video Evidence Room uses the other channels. Reason: ${s.lastError}` });
    else if (s.consecutiveFailures >= ALERT_AFTER_FAILURES) warnings.push({ source: k, level: 'error', text: `${s.label} has failed ${s.consecutiveFailures} times in a row since ${s.lastSuccess || 'the start'}. Showing the last valid data. Reason: ${s.lastError}` });
    else if (s.consecutiveFailures > 0) warnings.push({ source: k, level: 'warn', text: `${s.label}: latest refresh failed (${s.lastError}); retrying automatically.` });
  }
  return { ...status, checkedAt: nowIso, warnings, healthy: !warnings.some((w) => w.level === 'error') };
}

function maxRetrieved(dir) {
  let max = null;
  for (const f of listFiles(dir)) { const r = readJson(path.join(dir, f))?.retrievedAt; if (r && (!max || r > max)) max = r; }
  return max;
}

export function seasonOfDate(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear(); const start = d.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export function previousSeason(s) {
  const y = Number(s.slice(0, 4)) - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function buildPlayerIndex(D, seasonsList) {
  const idx = new Map();
  for (const s of seasonsList) {
    const ps = readJson(D('seasons', s, 'players.json'), { players: [] }).players;
    for (const p of ps) {
      const e = idx.get(p.id) || { id: p.id, name: p.name, web: p.web, pos: p.pos, photo: p.photo, aliases: new Set(), seasons: [], current: false, latestSeason: s };
      p.aliases.forEach((a) => e.aliases.add(a));
      e.seasons.push({ season: s, apps: p.season.apps, minutes: p.season.totals.minutes, goals: p.season.totals.goals });
      if (p.current) e.current = true;
      if (s === seasonsList[0] && p.membershipLabel && !e.membershipLabel) e.membershipLabel = p.membershipLabel;
      idx.set(p.id, e);
    }
  }
  return { players: [...idx.values()].map((e) => ({ ...e, aliases: [...e.aliases] })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force') || process.env.FORCE_ALL === '1';
  runSync({ force }).then(({ persistent }) => {
    if (persistent.length) {
      console.error(`Persistent source failures: ${persistent.map(([k]) => k).join(', ')} — exiting non-zero so GitHub notifies the owner.`);
      process.exit(2);
    }
  }).catch((err) => { console.error(err); process.exit(1); });
}
