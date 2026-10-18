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
import { setMinMinutes, minMinutes, leaguePool, leagueTeamRanks, insights, tactical, squadPlanner, positionRanks, playerPercentiles, scoutingSummary, article, coachFor } from './derive/analysis.js';
import { STATS, RATES, UNAVAILABLE, NOW_AVAILABLE, POS_LABEL } from './derive/stats.js';
import { ratings, expectedGoals, matchProbabilities, simulateSeason } from './derive/simulate.js';

const ELEMENT_FIELDS = ['id', 'code', 'first_name', 'second_name', 'web_name', 'known_name', 'team', 'element_type', 'birth_date', 'region', 'squad_number', 'team_join_date',
  'status', 'news', 'news_added', 'chance_of_playing_next_round', 'removed', 'minutes', 'starts', 'goals_scored', 'assists', 'expected_goals', 'expected_assists',
  'expected_goals_conceded', 'goals_conceded', 'clearances_blocks_interceptions', 'tackles', 'recoveries', 'defensive_contribution', 'saves', 'yellow_cards', 'clean_sheets', 'corners_and_indirect_freekicks_order', 'direct_freekicks_order', 'penalties_order', 'threat', 'creativity', 'influence'];

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
  const detail = { matches: [], players: [], shots: [], momentum: [], xgMinute: [], leagueMatches: [] };
  if (fc.enabled()) for (const f of listFiles(fcDir)) {
    const r = readJson(path.join(fcDir, f));
    if (!r) continue;
    for (const m of r.matches) detail.matches.push({ tournament: r.tournament, gw: r.gw, row: m });
    detail.players.push(...r.players); detail.shots.push(...r.shots); detail.momentum.push(...(r.momentum || [])); detail.xgMinute.push(...(r.xgMinute || [])); detail.leagueMatches.push(...(r.leagueMatches || []));
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
  for (const p of built.players) {
    const pc = playerPercentiles(pool, p.id);
    scouting[p.id] = { percentiles: pc, summary: scoutingSummary(p, pc) };
    if (built.files[`players/${p.id}.json`]) Object.assign(built.files[`players/${p.id}.json`], { percentiles: pc, summary: scouting[p.id].summary });
  }
  const sources = [...(fc.enabled() ? ['FPL Core Insights — github.com/olbauday/FPL-Elo-Insights (shots, passing, take-ons, possession; match data collected from FotMob)'] : []), 'Fantasy Premier League API — fantasy.premierleague.com/api (fixtures, results, player statistics; Opta-derived xG/xA)', 'TheSportsDB — thesportsdb.com (non-Premier League fixtures and score cross-check)', 'YouTube — official Tottenham Hotspur and Premier League channels plus Sky Sports Premier League, The Athletic FC, Coaches\' Voice, HITC Sevens, The Overlap and Last Word On Spurs (video metadata and links only)'];
  const art = article({ season, generatedAt: nowIso, team: built.teamSummary, insightsList: ins, tacticalData: tac, sources });
  built.files['analysis.json'] = { season, generatedAt: nowIso, label: 'Calculated analysis — generated by fixed rules from the stored figures; not official fact.', insights: ins, tactical: tac, squad, leagueRanks: ranks, articleMarkdown: art };
  built.files['league-players.json'] = { season, generatedAt: nowIso, source: 'Fantasy Premier League API', minMinutesForRates: minMinutes(), players: pool.map(({ f, ...p }) => ({ ...p, per90: f })) };

  // ---------------- Season simulator & match probabilities ----------------
  try {
    const R = ratings(detail.leagueMatches || [], teams);
    // Re-simulate only when the table, remaining fixtures or ratings change.
    const simKey = JSON.stringify([built.table.map((r) => [r.teamId, r.points, r.gd, r.gf]), fixtures.fixtures.filter((f) => !(f.finished || f.finished_provisional)).map((f) => f.id), [...R.ratings].map(([k, v]) => [k, v.att.toFixed(3), v.def.toFixed(3)])]);
    const simCache = readJson(S('sim-cache.json'), null);
    const sim = simCache && simCache.key === simKey ? simCache.sim : simulateSeason({ table: built.table, fplFixtures: fixtures.fixtures, teams, R, spursId });
    if (!simCache || simCache.key !== simKey) writeJson(S('sim-cache.json'), { key: simKey, sim });
    const predFile = S('predictions.json');
    const preds = readJson(predFile, {});
    const nextFx = built.fixtures.find((f) => f.status === 'SCHEDULED' && f.kickoff && !f.friendly);
    let next = null;
    if (nextFx && nextFx.opponentTeamId && R.ratings.has(nextFx.opponentTeamId)) {
      const neutral = nextFx.competition !== 'Premier League' && /final/i.test(nextFx.competition);
      const xg = nextFx.home ? expectedGoals(R, spursId, nextFx.opponentTeamId, neutral) : expectedGoals(R, nextFx.opponentTeamId, spursId, neutral);
      const p = matchProbabilities(xg.home, xg.away);
      const spursWin = nextFx.home ? p.home : p.away; const oppWin = nextFx.home ? p.away : p.home;
      next = {
        matchId: nextFx.id, opponent: nextFx.opponent, home: nextFx.home, kickoff: nextFx.kickoff, competition: nextFx.competition,
        win: Math.round(spursWin * 1000) / 10, draw: Math.round(p.draw * 1000) / 10, loss: Math.round(oppWin * 1000) / 10,
        expectedGoals: { spurs: Math.round((nextFx.home ? xg.home : xg.away) * 100) / 100, opp: Math.round((nextFx.home ? xg.away : xg.home) * 100) / 100 },
        likelyScores: p.likelyScores.map((x) => ({ spurs: nextFx.home ? x.h : x.a, opp: nextFx.home ? x.a : x.h, p: x.p })),
      };
      // Keep the latest pre-kick-off forecast so it can be compared with the result later.
      if (Date.parse(nextFx.kickoff) > now.getTime()) preds[nextFx.id] = { ...next, savedAt: nowIso };
      const mf = built.files[`matches/${nextFx.id}.json`];
      if (mf) { mf.forecast = next; if (mf.preview) mf.preview.forecast = next; }
    }
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
      season, generatedAt: nowIso, ...sim, next, record,
      method: 'Ratings from xG created and conceded per match (FotMob data, all league matches), shrunk towards the league average; Poisson goals; remaining league fixtures played out 10,000 times with a fixed seed.',
      label: 'Probabilities from a simple statistical model, not betting odds. They move after every match as the data changes.',
    };
    ok('simulator', 'Season simulator', { records: { remainingFixtures: sim.remainingFixtures } });
  } catch (err) { fail('simulator', 'Season simulator', err); }

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
