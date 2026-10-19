// Game report for the De Zerbi tracker: how Spurs set up and how they played in one
// match, phase by phase. Every sentence is produced by fixed rules from recorded figures
// (FotMob team and player stats via FPL Core Insights, FPL events, ESPN team sheets).
// Nothing is written that the data does not show; missing figures are left out.
import { round } from './stats.js';

const n2 = (v) => Number(v).toFixed(2);
const n1 = (v) => Number(v).toFixed(1);
const has = (v) => v !== null && v !== undefined && !Number.isNaN(v);
const LINE = { G: 'Goalkeeper', GK: 'Goalkeeper', D: 'Defence', CB: 'Defence', CD: 'Defence', LB: 'Defence', RB: 'Defence', M: 'Midfield', DM: 'Midfield', CM: 'Midfield', AM: 'Midfield', LM: 'Midfield', RM: 'Midfield', F: 'Attack', FW: 'Attack', ST: 'Attack', CF: 'Attack', LW: 'Attack', RW: 'Attack' };
const lineOf = (pos) => LINE[String(pos || '').toUpperCase().replace(/-.*/, '')] || 'Other';
const surname = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(' ').slice(-1)[0];
const minuteOf = (clock) => { const m = String(clock || '').match(/(\d+)(?:'?\s*\+\s*(\d+))?/); return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0) : null; };

// Spurs' side of an ESPN sheet.
function spursSide(sheet) {
  if (!sheet) return null;
  const isSpurs = (s) => /tottenham|spurs/i.test(s?.team || '');
  return isSpurs(sheet.home) ? ['home', 'away'] : isSpurs(sheet.away) ? ['away', 'home'] : null;
}

function setupFrom(sheet, prevSheet, prevOpp) {
  const sides = spursSide(sheet); if (!sides) return null;
  const me = sheet[sides[0]]; const them = sheet[sides[1]];
  const order = ['Goalkeeper', 'Defence', 'Midfield', 'Attack', 'Other'];
  const xi = me.starters.map((p) => ({ name: p.name, short: p.short || p.name, line: lineOf(p.pos), num: p.num, place: p.place }));
  xi.sort((a, b) => order.indexOf(a.line) - order.indexOf(b.line) || (a.place ?? 99) - (b.place ?? 99));
  const lines = order.map((l) => ({ line: l, players: xi.filter((p) => p.line === l).map((p) => p.short) })).filter((l) => l.players.length);
  // Substitutions with minutes from the key events ("X replaces Y").
  const subs = [];
  for (const e of sheet.keyEvents || []) {
    if (!/substitut/i.test(e.type || '') || !/tottenham|spurs/i.test(e.team || '')) continue;
    const m = String(e.text || '').match(/[.,]\s*([^.,]+?) replaces ([^.,]+?)(?:\s+because[^.]*)?\.?\s*$/i);
    if (m) subs.push({ on: m[1].trim(), off: m[2].trim(), minute: e.clock });
    else if (e.players.length >= 2) subs.push({ on: e.players[0], off: e.players[1], minute: e.clock });
  }
  if (!subs.length) for (const p of me.subs.filter((x) => x.subbedIn)) subs.push({ on: p.name, off: null, minute: null });
  const cards = (sheet.keyEvents || []).filter((e) => /card/i.test(e.type || '')).map((e) => ({ type: /red/i.test(e.type) ? 'red' : 'yellow', minute: e.clock, team: /tottenham|spurs/i.test(e.team || '') ? 'spurs' : 'opp', player: e.players[0] || null }));
  let changes = null;
  const ps = spursSide(prevSheet);
  if (ps) {
    const before = new Set(prevSheet[ps[0]].starters.map((p) => surname(p.name)));
    const now = new Set(me.starters.map((p) => surname(p.name)));
    changes = { vs: prevOpp, in: me.starters.filter((p) => !before.has(surname(p.name))).map((p) => p.short || p.name), out: prevSheet[ps[0]].starters.filter((p) => !now.has(surname(p.name))).map((p) => p.short || p.name), formationBefore: prevSheet[ps[0]].formation || null };
  }
  return { formation: me.formation || null, oppFormation: them.formation || null, lines, subs, cards, changes, source: 'ESPN match feed (team sheets)' };
}

// Average of a metric over Spurs' other league matches this season.
function seasonAvg(others, get) {
  const v = others.map(get).filter(has);
  return v.length ? { value: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null;
}

export function gameReport({ match, sheet = null, prevSheet = null, prevOpp = null, teamMatches = [], leagueMetrics = {} }) {
  const f = match.fixture; const d = match.detail; const bd = match.breakdown;
  if (!f?.score || !d?.spurs || !d?.opp) return null;
  const S = d.spurs; const O = d.opp; const opp = f.opponent;
  const adv = match.team?.adv || {};
  const others = teamMatches.filter((m) => m.adv && m.matchId !== f.id);
  const avg = (get) => seasonAvg(others, get);
  const L = (k) => leagueMetrics[k]?.leagueAvg ?? null;
  const tilt = adv.fieldTilt ?? (has(S.oppHalf) && has(O.oppHalf) && S.oppHalf + O.oppHalf ? (S.oppHalf / (S.oppHalf + O.oppHalf)) * 100 : null);
  const ppda = adv.ppda ?? null;
  const longShare = has(S.longBallsAcc) && S.passesAcc ? (S.longBallsAcc / S.passesAcc) * 100 : null;
  const xgShot = has(S.xg) && S.shots ? S.xg / S.shots : null;
  const oppXgShot = has(O.xg) && O.shots ? O.xg / O.shots : null;
  const sit = adv.situations || {};
  const sum = (keys, side, k) => keys.reduce((a, key) => a + (sit[key]?.[side]?.[k] || 0), 0);
  const SETP = ['corner', 'set-piece', 'free-kick', 'throw-in-set-piece', 'penalty'];
  const A = {
    possession: avg((m) => m.adv.spurs.possession), fieldTilt: avg((m) => m.adv.fieldTilt), passPct: avg((m) => m.adv.spurs.passPct), passes: avg((m) => m.adv.spurs.passes),
    longShare: avg((m) => (has(m.adv.spurs.longBallsAcc) && m.adv.spurs.passesAcc ? (m.adv.spurs.longBallsAcc / m.adv.spurs.passesAcc) * 100 : null)),
    shots: avg((m) => m.adv.spurs.shots), xg: avg((m) => m.adv.spurs.xg), xgShot: avg((m) => (has(m.adv.spurs.xg) && m.adv.spurs.shots ? m.adv.spurs.xg / m.adv.spurs.shots : null)),
    bigChances: avg((m) => m.adv.spurs.bigChances), touchesOppBox: avg((m) => m.adv.spurs.touchesOppBox), dribbles: avg((m) => m.adv.spurs.dribbles),
    ppda: avg((m) => m.adv.ppda), tacklesWon: avg((m) => m.adv.spurs.tacklesWon), interceptions: avg((m) => m.adv.spurs.interceptions), duelsWon: avg((m) => m.adv.spurs.duelsWon),
    xga: avg((m) => m.adv.opp.xg), oppShots: avg((m) => m.adv.opp.shots), oppBox: avg((m) => m.adv.opp.touchesOppBox), countersAgainst: avg((m) => m.adv.counters?.against.shots ?? null),
    aerialPct: avg((m) => m.adv.spurs.aerialPct),
  };
  const row = (label, spurs, oppV, a, league = null, dp = 0, unit = '', lowerBetter = false) => ({ label, spurs: has(spurs) ? round(spurs, dp) : null, opp: has(oppV) ? round(oppV, dp) : null, season: a ? round(a.value, dp) : null, league: has(league) ? round(league, dp) : null, unit, dp, lowerBetter });
  // Compare a value with the season average: returns 'well above' etc. or null when too close to call.
  const vs = (v, a, rel = 0.12, abs = 0) => { if (!has(v) || !a) return null; const diff = v - a.value; if (Math.abs(diff) <= Math.max(Math.abs(a.value) * rel, abs)) return 'in line with'; return diff > 0 ? (Math.abs(diff) > Math.abs(a.value) * rel * 2.5 ? 'well above' : 'above') : (Math.abs(diff) > Math.abs(a.value) * rel * 2.5 ? 'well below' : 'below'); };
  const seasonTxt = (a, dp = 1, unit = '') => (a ? ` (season average ${dp === 0 ? Math.round(a.value) : a.value.toFixed(dp)}${unit})` : '');

  const phases = [];
  // ---- 1. Build-up and possession ----
  {
    const read = [];
    if (has(S.possession)) read.push(`Spurs had ${Math.round(S.possession)}% of the ball${seasonTxt(A.possession, 0, '%')}${has(S.passes) ? `, completing ${S.passesAcc ?? '—'} of ${S.passes} passes (${S.passPct}%)` : ''}.`);
    if (has(tilt)) {
      const w = vs(tilt, A.fieldTilt, 0.08, 3);
      read.push(`${Math.round(tilt)}% of all passing in the opposition half was by Spurs (field tilt)${w ? `, ${w} their usual ${Math.round(A.fieldTilt.value)}%` : ''}. ${tilt >= 60 ? `They spent long spells camped in ${opp}'s half.` : tilt <= 45 ? `${opp} had more of the play in Spurs' half than Spurs had in theirs.` : 'Territory was fairly shared.'}`);
    }
    if (has(S.ownHalf) && has(S.oppHalf) && S.ownHalf + S.oppHalf > 0) read.push(`${Math.round((S.ownHalf / (S.ownHalf + S.oppHalf)) * 100)}% of Spurs' accurate passes were in their own half (${S.ownHalf} own half, ${S.oppHalf} opposition half): ${S.ownHalf > S.oppHalf * 1.3 ? 'a lot of circulation at the back before progressing' : S.oppHalf > S.ownHalf ? 'most of the passing happened high up the pitch' : 'a balanced split between building and attacking'}.`);
    if (has(longShare)) {
      const w = vs(longShare, A.longShare, 0.2, 1);
      read.push(`Long balls made up ${n1(longShare)}% of accurate passes${w ? ` (${w} the season's ${n1(A.longShare.value)}%)` : ''}${has(S.longBallPct) ? `, with ${S.longBallPct}% of long balls finding a teammate` : ''}. ${longShare <= 4 ? 'Spurs built short and rarely went direct.' : longShare >= 8 ? 'Spurs went long more than a short-passing side normally would.' : ''}`.trim());
    }
    phases.push({ key: 'build', title: 'Build-up and possession', rows: [
      row('Possession', S.possession, O.possession, A.possession, L('possession'), 0, '%'), row('Field tilt', tilt, has(tilt) ? 100 - tilt : null, A.fieldTilt, L('fieldTilt'), 0, '%'),
      row('Passes', S.passes, O.passes, A.passes), row('Pass accuracy', S.passPct, O.passPct, A.passPct, L('passPct'), 0, '%'),
      row('Accurate passes, own half', S.ownHalf, O.ownHalf, null), row('Accurate passes, opposition half', S.oppHalf, O.oppHalf, null),
      row('Long balls, share of accurate passes', longShare, has(O.longBallsAcc) && O.passesAcc ? (O.longBallsAcc / O.passesAcc) * 100 : null, A.longShare, null, 1, '%'),
      row('Long-ball accuracy', S.longBallPct, O.longBallPct, null, L('longBallPct'), 0, '%'),
    ], read });
  }
  // ---- 2. Chance creation ----
  {
    const read = [];
    if (has(S.shots)) read.push(`${S.shots} shots (${S.sot ?? '—'} on target) worth ${n2(S.xg)} xG${has(xgShot) ? `, ${n2(xgShot)} per shot` : ''}${A.xgShot && has(xgShot) ? `; the season average is ${n2(A.xgShot.value)} per shot, so the chances were ${xgShot >= A.xgShot.value * 1.15 ? 'better quality than usual' : xgShot <= A.xgShot.value * 0.85 ? 'lower quality than usual' : 'of typical quality'}` : ''}.`);
    if (has(S.shotsInBox) && has(S.shotsOutBox)) read.push(`${S.shotsInBox} shots came from inside the box and ${S.shotsOutBox} from outside${S.shots ? ` (${Math.round((S.shotsOutBox / S.shots) * 100)}% from distance)` : ''}.`);
    if (has(S.bigChances)) read.push(`Spurs created ${S.bigChances} big chance${S.bigChances === 1 ? '' : 's'}${has(S.bigChancesMissed) ? ` and missed ${S.bigChancesMissed}` : ''}${A.bigChances ? ` (season average ${n1(A.bigChances.value)})` : ''}.`);
    if (has(S.touchesOppBox)) read.push(`${S.touchesOppBox} touches in ${opp}'s box${A.touchesOppBox ? `, ${vs(S.touchesOppBox, A.touchesOppBox)} the season average of ${Math.round(A.touchesOppBox.value)}` : ''}${has(O.touchesOppBox) ? `; ${opp} had ${O.touchesOppBox} in Spurs' box` : ''}.`);
    const open = sum(['assisted', 'regular'], 'for', 'xg'); const fast = sum(['fast-break'], 'for', 'xg'); const setp = sum(SETP, 'for', 'xg');
    if (open + fast + setp > 0) {
      const tot = open + fast + setp;
      read.push(`Where the xG came from: open play ${n2(open)} (${Math.round((open / tot) * 100)}%), fast breaks ${n2(fast)}, set pieces ${n2(setp)}.${sit.assisted?.for?.shots ? ` ${sit.assisted.for.shots} of the shots came straight from a teammate's pass (assisted).` : ''}`);
    }
    if (has(S.dribbles)) read.push(`${S.dribbles} successful take-ons${has(S.dribblePct) ? ` (${S.dribblePct}% success)` : ''}${A.dribbles ? `, season average ${n1(A.dribbles.value)}` : ''}.`);
    phases.push({ key: 'create', title: 'Chance creation', rows: [
      row('Shots', S.shots, O.shots, A.shots, L('shots')), row('Shots on target', S.sot, O.sot, null, L('sot')), row('xG', S.xg, O.xg, A.xg, L('xg'), 2),
      row('xG per shot', xgShot, oppXgShot, A.xgShot, null, 3), row('Big chances', S.bigChances, O.bigChances, A.bigChances, L('bigChances')),
      row('Touches in opposition box', S.touchesOppBox, O.touchesOppBox, A.touchesOppBox, L('touchesOppBox')), row('Shots inside the box', S.shotsInBox, O.shotsInBox, null),
      row('Open-play xG', S.xgOpenPlay, O.xgOpenPlay, null, null, 2), row('Set-play xG', S.xgSetPlay, O.xgSetPlay, null, L('xgSetPlay'), 2), row('Successful take-ons', S.dribbles, O.dribbles, A.dribbles, L('dribbles')),
    ], read });
  }
  // ---- 3. Finishing ----
  {
    const read = [];
    if (has(S.xg)) {
      const g = f.score.spurs; const diff = g - S.xg;
      read.push(`Spurs scored ${g} from ${n2(S.xg)} xG: ${Math.abs(diff) < 0.4 ? 'about what the chances were worth' : diff > 0 ? `${n1(diff)} more than the chances were worth` : `${n1(-diff)} fewer than the chances were worth`}.`);
    }
    if (has(S.xgot) && has(S.xg)) read.push(`Shots on target were worth ${n2(S.xgot)} xGOT against ${n2(S.xg)} xG before the shot: ${S.xgot >= S.xg + 0.2 ? 'the finishing placed shots better than average' : S.xgot <= S.xg - 0.2 ? 'too many shots were off target or easy for the keeper' : 'placement was roughly average'}.`);
    if (has(O.saves)) read.push(`${opp}'s goalkeeper made ${O.saves} save${O.saves === 1 ? '' : 's'}.`);
    phases.push({ key: 'finish', title: 'Finishing', rows: [row('Goals', f.score.spurs, f.score.opp, null), row('xG', S.xg, O.xg, null, null, 2), row('xG on target (xGOT)', S.xgot, O.xgot, null, null, 2), row('Big chances missed', S.bigChancesMissed, O.bigChancesMissed, null, null, 0, '', true), row('Saves made', S.saves, O.saves, null)], read });
  }
  // ---- 4. Out of possession ----
  {
    const read = [];
    if (has(ppda)) read.push(`PPDA (estimated): ${n1(ppda)} ${opp} passes in their own half per Spurs defensive action${A.ppda ? `; season average ${n1(A.ppda.value)}` : ''}. Lower means a more aggressive press, so this was ${A.ppda ? (ppda <= A.ppda.value * 0.85 ? 'a more intense press than usual' : ppda >= A.ppda.value * 1.15 ? 'a less intense press than usual' : 'Spurs\' usual pressing level') : 'the measured level'}.`);
    if (has(S.tacklesWon) || has(S.interceptions)) read.push(`${S.tacklesWon ?? '—'} tackles won and ${S.interceptions ?? '—'} interceptions${A.tacklesWon && A.interceptions ? ` (season averages ${n1(A.tacklesWon.value)} and ${n1(A.interceptions.value)})` : ''}; ${S.clearances ?? '—'} clearances and ${S.blocks ?? '—'} blocks.`);
    if (has(S.duelsWon) && has(O.duelsWon)) read.push(`Duels: Spurs won ${S.duelsWon}, ${opp} ${O.duelsWon} (${Math.round((S.duelsWon / (S.duelsWon + O.duelsWon)) * 100)}% for Spurs)${has(S.aerialPct) ? `; ${S.aerialPct}% of aerial duels won` : ''}.`);
    if (has(O.xg)) read.push(`${opp} managed ${O.shots} shots worth ${n2(O.xg)} xG${A.xga ? ` (Spurs usually concede ${n2(A.xga.value)} xG)` : ''}${has(O.bigChances) ? ` and ${O.bigChances} big chance${O.bigChances === 1 ? '' : 's'}` : ''}.`);
    phases.push({ key: 'defend', title: 'Out of possession', rows: [
      row('PPDA (est., lower = harder press)', ppda, adv.oppPpda, A.ppda, L('ppda'), 1, '', true), row('Tackles won', S.tacklesWon, O.tacklesWon, A.tacklesWon), row('Interceptions', S.interceptions, O.interceptions, A.interceptions),
      row('Clearances', S.clearances, O.clearances, null), row('Blocks', S.blocks, O.blocks, null), row('Duels won', S.duelsWon, O.duelsWon, A.duelsWon), row('Aerial duels won', S.aerialPct, O.aerialPct, A.aerialPct, null, 0, '%'),
      row('xG conceded', O.xg, null, A.xga, L('xga'), 2, '', true), row('Shots conceded', O.shots, null, A.oppShots, L('shotsAgainst'), 0, '', true),
    ], read });
  }
  // ---- 5. Transitions and set pieces ----
  {
    const read = []; const c = adv.counters;
    if (c) {
      read.push(`Fast breaks: Spurs had ${c.for.shots} shot${c.for.shots === 1 ? '' : 's'} on the break (${n2(c.for.xg)} xG); ${opp} had ${c.against.shots} (${n2(c.against.xg)} xG)${A.countersAgainst ? `, against a season average of ${n1(A.countersAgainst.value)} shots conceded on the break` : ''}.`);
      if (c.against.shots >= 2 && has(S.possession) && S.possession >= 55) read.push('With Spurs holding most of the ball, those breaks show the space left behind when the team pushed up.');
    }
    const spF = sum(SETP, 'for', 'shots'); const spA = sum(SETP, 'against', 'shots');
    if (spF || spA) read.push(`Set pieces: ${spF} Spurs shot${spF === 1 ? '' : 's'} (${n2(sum(SETP, 'for', 'xg'))} xG, ${sum(SETP, 'for', 'goals')} goal${sum(SETP, 'for', 'goals') === 1 ? '' : 's'}); ${opp} ${spA} (${n2(sum(SETP, 'against', 'xg'))} xG, ${sum(SETP, 'against', 'goals')} goal${sum(SETP, 'against', 'goals') === 1 ? '' : 's'}). Corners: ${S.corners ?? '—'}–${O.corners ?? '—'}.`);
    phases.push({ key: 'transition', title: 'Transitions and set pieces', rows: [
      row('Shots on the break', c?.for.shots, c?.against.shots, null), row('xG on the break', c?.for.xg, c?.against.xg, null, null, 2),
      row('Set-piece shots', spF, spA, null), row('Set-piece xG', sum(SETP, 'for', 'xg'), sum(SETP, 'against', 'xg'), null, null, 2), row('Corners', S.corners, O.corners, null),
    ], read });
  }
  // ---- Flow of the game ----
  const flow = [];
  const h = adv.halves;
  if (h) flow.push(`First half: ${n2(h.first.xgf)} xG for, ${n2(h.first.xga)} against (${h.first.gf}–${h.first.ga}). Second half: ${n2(h.second.xgf)} for, ${n2(h.second.xga)} against (${h.second.gf}–${h.second.ga}).${Math.abs((h.second.xgf - h.second.xga) - (h.first.xgf - h.first.xga)) >= 0.5 ? ` The balance shifted ${(h.second.xgf - h.second.xga) > (h.first.xgf - h.first.xga) ? 'towards' : 'away from'} Spurs after half-time.` : ''}`);
  if (bd?.spells?.length) flow.push(`Spells on top (momentum index): ${bd.spells.map((s) => s.text.replace(/^Spurs on top, /, 'Spurs ').replace(new RegExp(`^${opp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} on top, `), `${opp} `)).join('; ')}.`);
  for (const m of (bd?.moments || []).filter((x) => x.kind === 'goal')) flow.push(`${m.label} ${m.side === 'spurs' ? 'Spurs' : opp} goal: ${m.text.replace(/^Goal: /, '')}.`);
  const setup = setupFrom(sheet, prevSheet, prevOpp);
  const reds = (f.events || []).filter((e) => e.type === 'red');
  for (const r of reds) {
    const t = setup?.cards.find((c) => c.type === 'red' && surname(c.player) === surname(r.player));
    flow.push(`${r.team === 'spurs' ? 'Spurs' : opp} played with ten men after ${r.player}'s red card${t?.minute ? ` (${t.minute})` : ''}; figures after that point reflect the numbers difference.`);
  }

  // ---- Summary: the biggest departures from Spurs' normal game, in plain words ----
  const summary = [];
  if (setup?.formation) summary.push(`Spurs lined up in a ${setup.formation}${setup.oppFormation ? ` against ${opp}'s ${setup.oppFormation}` : ''}${setup.changes && (setup.changes.in.length || setup.changes.formationBefore !== setup.formation) ? ` (${setup.changes.in.length} change${setup.changes.in.length === 1 ? '' : 's'} from the ${setup.changes.vs} game${setup.changes.formationBefore && setup.changes.formationBefore !== setup.formation ? `, switching from ${setup.changes.formationBefore}` : ''})` : ''}.`);
  if (bd?.verdict?.text) summary.push(bd.verdict.text);
  const devs = [
    // [key, value, average, wording if higher, wording if lower, unit, decimals, weight]
    // Weights reflect how much each measure normally varies (possession moves little game to game).
    ['possession', S.possession, A.possession, 'had more of the ball', 'had less of the ball', '%', 0, 3],
    ['fieldTilt', tilt, A.fieldTilt, 'played higher up the pitch', 'spent less time in the opposition half', '%', 0, 2],
    ['ppda', ppda, A.ppda, 'pressed less intensely', 'pressed harder', '', 1, 1],
    ['xgShot', xgShot, A.xgShot, 'created better-quality chances', 'settled for lower-quality chances', '', 2, 0.6],
    ['touchesOppBox', S.touchesOppBox, A.touchesOppBox, 'got into the box more', 'got into the box less', '', 0, 1],
    ['longShare', longShare, A.longShare, 'went long more often', 'went long less often', '%', 1, 0.4],
    ['xga', O.xg, A.xga, 'conceded more', 'conceded less', ' xG', 2, 0.8],
  ].filter(([, v, a]) => has(v) && a && a.n >= 2 && a.value).map(([k, v, a, up, down, unit, dp, w]) => ({ k, v, a, rel: (v - a.value) / Math.abs(a.value), up, down, unit, dp, w }))
    .filter((x) => Math.abs(x.rel) >= 0.15).sort((a, b) => Math.abs(b.rel) * b.w - Math.abs(a.rel) * a.w).slice(0, 4);
  if (devs.length) summary.push(`Compared with their other league games, Spurs ${devs.map((x) => `${x.rel > 0 ? x.up : x.down} (${x.v.toFixed(x.dp)}${x.unit} vs ${x.a.value.toFixed(x.dp)}${x.unit})`).join(', ')}.`);
  else if (others.length >= 2) summary.push('On the main style measures this was a typical Spurs performance for the season: nothing moved more than 15% from their average.');
  if (bd?.standouts?.length) { const a = bd.standouts.find((s) => /dangerous/.test(s.label)); const b = bd.standouts.find((s) => /Ball-winner/.test(s.label)); summary.push([a && `${a.name} was the biggest attacking threat (${a.value} xG + xA)`, b && `${b.name} won the ball back most often (${b.value} tackles won + interceptions)`].filter(Boolean).join('; ') + '.'); }

  return {
    matchId: f.id, setup, summary, phases, flow,
    standouts: bd?.standouts || [], tags: bd?.styleTags || [],
    seasonMatches: others.length,
    notMeasured: 'Not in the free data, so not claimed here: player positions and movements during play (tracking data), pressing triggers, exact build-up shapes, and pass maps. Formation is the one listed on the team sheet, not a measured shape in possession.',
    sources: ['FotMob match statistics via FPL Core Insights', 'Fantasy Premier League API (events)', ...(setup ? ['ESPN match feed (formation, starting XI, substitutions)'] : [])],
    label: 'Written automatically by fixed rules from the recorded match figures. Season averages use Spurs\' other Premier League matches this season.',
  };
}
