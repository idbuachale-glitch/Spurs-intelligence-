// Live match feed: while a Spurs match is in play, fetch in-game team statistics from
// API-Football (free plan, 100 requests/day) and per-player figures from the FPL live
// endpoint, and attach them to the match. Snapshots are kept in state/live so the last
// figures survive after the match.
import path from 'node:path';
import { readJson, writeJson } from '../lib/store.js';
import * as af from '../adapters/apifootball.js';
import * as fpl from '../adapters/fpl.js';

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

const FINISHED = new Set(['FT', 'AET', 'PEN', 'ABD', 'AWD', 'WO', 'CANC']);

export async function runLive({ built, stateDir, now, spursElementIds, elementsById, health }) {
  const fx = liveCandidate(built.fixtures, now);
  const dir = path.join(stateDir, 'live');
  const snapFile = fx ? path.join(dir, `${fx.id}.json`) : null;
  const snap = fx ? readJson(snapFile, { matchId: fx.id }) : null;
  const notes = [];

  if (fx && !snap.final) {
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
          Object.assign(snap, { status: live.status, statusLong: live.statusLong, minute: live.minute, extra: live.extra, score: live.score, stats: live.stats || snap.stats || null, events: live.events || snap.events || null, retrievedAt: now.toISOString() });
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
        const players = els.filter((e) => spursElementIds.has(e.id) && (e.stats?.minutes || 0) > 0).map((e) => {
          const s = e.stats; const el = elementsById.get(e.id);
          return { elementId: e.id, name: el ? el.web_name : String(e.id), minutes: s.minutes, goals: s.goals_scored, assists: s.assists, yc: s.yellow_cards, rc: s.red_cards, saves: s.saves,
            tackles: s.tackles ?? null, cbi: s.clearances_blocks_interceptions ?? null, recoveries: s.recoveries ?? null, bps: s.bps, xg: s.expected_goals !== undefined ? Number(s.expected_goals) : null };
        }).sort((a, b) => b.minutes - a.minutes || (b.bps || 0) - (a.bps || 0));
        if (players.length) { snap.players = players; snap.playersAt = now.toISOString(); }
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
  if (fx && (snap.stats || snap.players || snap.score || snap.planBlocked)) {
    const live = { ...snap, source: { stats: 'API-Football (free plan)', players: 'Fantasy Premier League live data' }, updateEveryMin: 5, isLive: !snap.final };
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
    if (!s || (!s.stats && !s.players)) continue;
    const mf = built.files[`matches/${f.id}.json`];
    if (mf && !mf.live) mf.live = { ...s, source: { stats: 'API-Football (free plan)', players: 'Fantasy Premier League live data' }, isLive: false };
  }
}
