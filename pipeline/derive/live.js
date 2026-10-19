// Live match feed: while a Spurs match is in play, fetch in-game team statistics from
// API-Football (free plan, 100 requests/day) and per-player figures from the FPL live
// endpoint, and attach them to the match. Snapshots are kept in state/live so the last
// figures survive after the match.
import path from 'node:path';
import { readJson, writeJson } from '../lib/store.js';
import * as af from '../adapters/apifootball.js';
import * as fpl from '../adapters/fpl.js';
import * as espn from '../adapters/espn.js';

export const LIVE_WINDOW = { beforeMin: 2, afterMin: 150 }; // around kick-off
const DAILY_BUDGET = 90; // keep 10 of the 100 free requests spare

// The Spurs match currently in its live window (kick-off passed, not long finished).
export function liveCandidate(fixtures, now) {
  return fixtures.find((f) => {
    if (!f.kickoff || f.friendly) return false;
    const t = (now - new Date(f.kickoff)) / 60000;
    return t >= -LIVE_WINDOW.beforeMin && t <= LIVE_WINDOW.afterMin && f.status !== 'POSTPONED';
  }) || null;
}

// Team stats from both feeds: API-Football's figures (incl. xG) take priority, ESPN fills the rest.
function mergeStats(espnStats, apiStats) {
  if (!espnStats) return apiStats;
  const side = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) if (v !== null && v !== undefined) o[k] = v; return o; };
  return { spurs: side(espnStats.spurs, apiStats.spurs), opp: side(espnStats.opp, apiStats.opp) };
}
const FINISHED = new Set(['FT', 'AET', 'PEN', 'ABD', 'AWD', 'WO', 'CANC']);

export async function runLive({ built, stateDir, now, spursElementIds, elementsById, health }) {
  const fx = liveCandidate(built.fixtures, now);
  const dir = path.join(stateDir, 'live');
  const snapFile = fx ? path.join(dir, `${fx.id}.json`) : null;
  const snap = fx ? readJson(snapFile, { matchId: fx.id }) : null;
  const notes = [];

  if (fx && !snap.final) {
    // ---- ESPN: score, clock, goals/cards/subs, team and player stats (free, no key) ----
    const league = espn.LEAGUES[fx.competition];
    if (league && espn.enabled() && (now - new Date(fx.kickoff)) / 60000 >= -2) {
      try {
        if (!snap.espnEvent) {
          const board = await espn.scoreboard(league, fx.kickoff.slice(0, 10).replace(/-/g, ''));
          snap.espnEvent = board.find((e) => /tottenham/i.test(`${e.home} ${e.away}`))?.id || null;
        }
        if (snap.espnEvent) {
          const lv = await espn.liveMatch(league, snap.espnEvent);
          const me = /tottenham/i.test(lv.sides.home?.team || '') ? 'home' : 'away'; const them = me === 'home' ? 'away' : 'home';
          const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace('%', '')); return Number.isFinite(n) ? n : null; };
          const T = (side) => { const t = lv.teamStats[side] || {}; const g = (...ks) => { for (const k of ks) if (t[k] !== undefined) return num(t[k]); return undefined; };
            return { shots: g('totalShots'), sot: g('shotsOnTarget'), possession: g('possessionPct'), corners: g('wonCorners'), fouls: g('foulsCommitted'), yc: g('yellowCards'), rc: g('redCards'), saves: g('saves'), offsides: g('offsides'),
              passes: g('totalPasses'), passPct: (() => { const v = g('passPct'); return v !== undefined && v !== null && v <= 1 ? Math.round(v * 100) : v; })(), tackles: g('effectiveTackles', 'totalTackles'), interceptions: g('interceptions'), clearances: g('effectiveClearance', 'totalClearance'), blocked: g('blockedShots'), crosses: g('accurateCrosses'), longBalls: g('accurateLongBalls') }; };
          const mins = (c) => { const m = String(c || '').match(/(\d+)'?(?:\s*\+\s*(\d+))?/); return m ? { minute: Number(m[1]), extra: m[2] ? Number(m[2]) : null } : { minute: null, extra: null }; };
          const evs = lv.keyEvents.filter((e) => /goal|card|substitution/i.test(e.type)).map((e) => {
            const { minute, extra } = mins(e.clock); const team = /tottenham/i.test(e.team || '') ? 'spurs' : 'opp';
            if (/substitution/i.test(e.type)) { const m = String(e.text || '').match(/[.,]\s*([^.,]+?) replaces ([^.,]+?)(?:\s+because[^.]*)?\.?\s*$/i); return { minute, extra, team, type: 'subst', player: m ? m[1].trim() : e.players[0] || null, assist: m ? m[2].trim() : e.players[1] || null, detail: 'Substitution' }; }
            if (/card/i.test(e.type)) return { minute, extra, team, type: 'Card', player: e.players[0] || null, detail: /red/i.test(e.type) ? 'Red Card' : 'Yellow Card' };
            return { minute, extra, team, type: 'Goal', player: e.players[0] || null, assist: e.players[1] || null, detail: /own/i.test(e.type) ? 'Own Goal' : /penalty/i.test(e.type) ? 'Penalty' : 'Normal Goal' };
          });
          const cm = mins(lv.clock);
          snap.espn = { retrievedAt: now.toISOString(), state: lv.state, detail: lv.detail, statNames: lv.statNames,
            players: (lv.players[me] || []).map((p) => ({ name: p.name, short: p.short, pos: p.pos, starter: p.starter, subbedIn: p.subbedIn, subbedOut: p.subbedOut, stats: p.stats })) };
          if (lv.state === 'in' || lv.state === 'post') {
            const sc = { spurs: lv.sides[me]?.score ?? null, opp: lv.sides[them]?.score ?? null };
            if (sc.spurs !== null) snap.score = sc;
            snap.statusLong = lv.detail; snap.status = lv.state === 'post' ? 'FT' : /half/i.test(lv.detail || '') || lv.detail === 'HT' ? 'HT' : 'LIVE';
            if (cm.minute !== null && lv.state === 'in') { snap.minute = cm.minute; snap.extra = cm.extra; }
            snap.events = evs;
            const ts = { spurs: T(me), opp: T(them) };
            if (Object.values(ts.spurs).some((v) => v !== undefined && v !== null)) { snap.stats = ts; snap.statsSource = 'ESPN match feed'; }
            snap.retrievedAt = now.toISOString();
            if (lv.state === 'post') snap.final = true;
          }
          health.espnOk?.({ records: { liveMatch: fx.id, state: lv.state, teamStats: lv.statNames.team.length, playerStats: lv.statNames.player.length } });
        }
      } catch (err) { notes.push(`ESPN live: ${err.message}`); health.espnFail?.(err); }
    }
    // ---- API-Football: team statistics ----
    if (af.enabled()) {
      const budgetFile = path.join(dir, 'budget.json');
      const day = now.toISOString().slice(0, 10);
      const budget = readJson(budgetFile, { day, used: 0 });
      if (budget.day !== day) { budget.day = day; budget.used = 0; }
      const ids = readJson(path.join(dir, 'ids.json'), {});
      const spend = () => { budget.used++; };
      try {
        if (budget.used >= DAILY_BUDGET) throw Object.assign(new Error(`daily request budget used (${budget.used}/${DAILY_BUDGET})`), { quota: true });
        if (!ids.teamId) { ids.teamId = await af.findTeamId(); spend(); writeJson(path.join(dir, 'ids.json'), ids); }
        let live = null;
        if (snap.apiFixtureId) { live = await af.fixtureById(snap.apiFixtureId, ids.teamId); spend(); }
        else if ((now - new Date(fx.kickoff)) / 60000 >= 1) { live = await af.liveFixture(ids.teamId); spend(); if (live) snap.apiFixtureId = live.fixtureId; }
        if (live) {
          Object.assign(snap, { status: live.status || snap.status, statusLong: live.statusLong || snap.statusLong, minute: live.minute ?? snap.minute, extra: live.extra ?? snap.extra, score: live.score || snap.score, stats: live.stats ? mergeStats(snap.statsSource === 'ESPN match feed' || snap.statsSource?.includes('ESPN') ? snap.stats : null, live.stats) : snap.stats || null,
            // ESPN's events include substitutions and assists, so they win when present.
            events: snap.espn && snap.events?.length ? snap.events : live.events || snap.events || null, retrievedAt: now.toISOString() });
          if (live.stats) snap.statsSource = snap.espn ? 'API-Football (free plan) and ESPN match feed' : 'API-Football (free plan)';
          if (FINISHED.has(live.status)) snap.final = true;
        }
        health.ok({ records: { requestsToday: budget.used, budget: DAILY_BUDGET, match: fx.id, status: snap.status || 'waiting for kick-off' } });
      } catch (err) {
        if (err.plan) { snap.planBlocked = String(err.message); notes.push(err.message); health.ok({ note: `Free plan restriction: ${err.message}` }); }
        else if (err.quota) { notes.push(err.message); health.ok({ note: err.message }); }
        else health.fail(err);
      }
      writeJson(budgetFile, budget);
    }
    // ---- FPL live: per-player figures (Premier League only, no key needed) ----
    if (fx.source === 'fpl' && fx.gameweek) {
      try {
        const els = await fpl.fetchLive(fx.gameweek);
        const oppTeam = fx.opponentTeamId ?? null;
        const isOpp = (e) => oppTeam !== null && Number(elementsById.get(e.id)?.team) === Number(oppTeam);
        const toRow = (e) => {
          const s = e.stats; const el = elementsById.get(e.id);
          return { elementId: e.id, name: el ? el.web_name : String(e.id), pos: ['GK', 'DEF', 'MID', 'FWD'][Number(el?.element_type) - 1] || null, starts: s.starts ?? null, minutes: s.minutes, goals: s.goals_scored, assists: s.assists, yc: s.yellow_cards, rc: s.red_cards, saves: s.saves,
            tackles: s.tackles ?? null, cbi: s.clearances_blocks_interceptions ?? null, recoveries: s.recoveries ?? null, bps: s.bps, xg: s.expected_goals !== undefined ? Number(s.expected_goals) : null };
        };
        // Starters first, then substitutes; within each, goalkeeper → defenders → midfielders → forwards.
        const PO = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
        const order = (a, b) => (b.starts ?? (b.minutes >= 45 ? 1 : 0)) - (a.starts ?? (a.minutes >= 45 ? 1 : 0)) || (PO[a.pos] ?? 9) - (PO[b.pos] ?? 9) || b.minutes - a.minutes;
        const played = els.filter((e) => (e.stats?.minutes || 0) > 0);
        const players = played.filter((e) => spursElementIds.has(e.id)).map(toRow).sort(order);
        const oppPlayers = played.filter(isOpp).map(toRow).sort(order);
        if (players.length) { snap.players = players; snap.playersAt = now.toISOString(); }
        if (oppPlayers.length) snap.oppPlayers = oppPlayers;
      } catch (err) { notes.push(`FPL live: ${err.message}`); }
    }
    writeJson(snapFile, snap);
  }

  // Outside a match: confirm once a day that the key works (free; not counted in the quota).
  if (!fx && af.enabled()) {
    const chkFile = path.join(dir, 'account.json');
    const chk = readJson(chkFile, {});
    if (!chk.at || now - new Date(chk.at) > 20 * 3600e3) {
      try {
        const a = await af.accountStatus();
        // Once a day, check the plan can read this season (2 requests at most).
        const ids = readJson(path.join(dir, 'ids.json'), {});
        if (!ids.teamId) { ids.teamId = await af.findTeamId(); writeJson(path.join(dir, 'ids.json'), ids); }
        const from = now.toISOString().slice(0, 10); const to = new Date(now.getTime() + 10 * 86400e3).toISOString().slice(0, 10);
        const yr = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
        const acc = await af.seasonAccess(ids.teamId, yr, from, to);
        writeJson(chkFile, { ...a, seasonAccess: acc, at: now.toISOString() });
        health.ok({ records: { plan: a.plan, active: a.active, usedToday: a.usedToday, limitDay: a.limitDay, seasonAccess: acc.ok, upcoming: acc.next ? `${acc.next.opponent} ${acc.next.date}` : null },
          note: acc.ok ? 'Key accepted and the current season is readable. Live statistics switch on automatically during Spurs matches.' : `Key accepted, but the free plan cannot read the current season (${acc.error}). Live player figures still come from FPL.` });
      }
      catch (err) { writeJson(chkFile, { at: now.toISOString(), error: String(err.message) }); health.fail(err); }
    }
  }

  // Attach the latest snapshot for the live match (or the most recent finished one).
  if (fx && (snap.stats || snap.players || snap.score || snap.planBlocked || snap.espn)) {
    const live = { ...snap, source: { stats: snap.statsSource || 'API-Football (free plan)', players: 'Fantasy Premier League live data', events: snap.espn ? 'ESPN match feed' : 'API-Football' }, updateEveryMin: 5, isLive: !snap.final };
    const mf = built.files[`matches/${fx.id}.json`];
    if (mf) mf.live = live;
    fx.live = { isLive: !snap.final, minute: snap.minute ?? null, score: snap.score ?? null, status: snap.status ?? null };
  }
  return { match: fx ? fx.id : null, notes };
}

// Attach stored snapshots of finished matches (so the live panel stays after full time).
export function attachStoredLive(built, stateDir) {
  for (const f of built.fixtures) {
    const s = readJson(path.join(stateDir, 'live', `${f.id}.json`), null);
    if (!s || (!s.stats && !s.players && !s.espn)) continue;
    const mf = built.files[`matches/${f.id}.json`];
    if (mf && !mf.live) mf.live = { ...s, source: { stats: s.statsSource || 'API-Football (free plan)', players: 'Fantasy Premier League live data', events: s.espn ? 'ESPN match feed' : 'API-Football' }, isLive: false };
  }
}
