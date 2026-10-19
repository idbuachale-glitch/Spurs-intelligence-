// Matchday briefing: a short, numbers-only brief for Spurs' next match and a list of
// measurable things to watch. The brief is saved before kick-off; after the match the
// same items are checked against what actually happened, so every claim is accountable.
import { round } from './stats.js';

const n2 = (v) => Number(v).toFixed(2);
const has = (v) => v !== null && v !== undefined && !Number.isNaN(v);
const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const SETP = ['corner', 'set-piece', 'free-kick', 'throw-in-set-piece', 'penalty'];
const surname = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^.*\./, '').trim().split(' ').slice(-1)[0];

function avgOf(rows, get) { const v = rows.map(get).filter(has); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

// The brief and watch-list for the next match.
export function buildBrief({ fixture, match, round: rnd, players, teamMatches }) {
  const f = fixture; const pv = match?.preview || null; const fc = match?.forecast || null;
  const opp = f.opponent;
  const bullets = [];
  if (fc) {
    const fav = fc.win >= fc.loss + 5 ? 'Spurs are favourites' : fc.loss >= fc.win + 5 ? `${opp} are favourites` : 'It is close to a coin toss';
    const top = fc.likelyScores?.[0];
    bullets.push({ kind: 'forecast', text: `${fav}: Spurs win ${fc.win}%, draw ${fc.draw}%, ${opp} win ${fc.loss}%. Expected goals ${fc.expectedGoals.spurs}–${fc.expectedGoals.opp}${top ? `; likeliest score ${top.spurs}–${top.opp} (${top.p}%)` : ''}.${fc.lineupsConfirmed ? ' Based on the confirmed line-ups.' : ' Updates when the line-ups are confirmed.'}` });
  }
  if (rnd?.range && rnd.spursMatch && rnd.spursMatch.opponentTeamId === f.opponentTeamId) {
    const r = rnd.range;
    bullets.push({ kind: 'stakes', text: `What's at stake: Spurs are ${ord(r.current)} on ${rnd.spurs.points} points. A win could lift them as high as ${ord(r.best)}${r.bestNeedsGd ? ` (${ord(r.bestSafe)} without help from goal difference)` : ''}; a defeat could leave them ${ord(r.worst)}.` });
  }
  if (pv) {
    const form = (pv.form || []).map((g) => g.result).join('');
    if (pv.table) bullets.push({ kind: 'opponent', text: `${opp}: ${ord(pv.table.position)} on ${pv.table.points} points${form ? `, last ${form.length}: ${form}` : ''}. ${pv.venue.label}: ${pv.venue.w}W ${pv.venue.d}D ${pv.venue.l}L (scored ${pv.venue.gf}, conceded ${pv.venue.ga}).` });
    const dm = pv.dangerMen?.[0];
    if (dm) bullets.push({ kind: 'threat', text: `Their main threat: ${dm.name}, ${dm.goals} goal${dm.goals === 1 ? '' : 's'} and ${dm.assists} assist${dm.assists === 1 ? '' : 's'} from ${n2(dm.xg + dm.xa)} xG+xA.` });
    const edge = pv.edges?.find((e) => !/are missing/.test(e.text));
    if (edge) bullets.push({ kind: 'edge', text: `Spurs' edge: ${edge.text}` });
    const worry = pv.worries?.find((w) => !/main threat|team news/i.test(w.text));
    if (worry) bullets.push({ kind: 'worry', text: `Biggest worry: ${worry.text}` });
  }
  const out = players.filter((p) => p.current && ['i', 's'].includes(p.status)).map((p) => p.web);
  const doubt = players.filter((p) => p.current && p.status === 'd').map((p) => `${p.web}${p.chanceNext !== null && p.chanceNext !== undefined ? ` ${p.chanceNext}%` : ''}`);
  if (out.length || doubt.length) bullets.push({ kind: 'news', text: `Spurs team news: ${out.length ? `out: ${out.join(', ')}` : 'no confirmed absentees'}${doubt.length ? `; doubtful: ${doubt.join(', ')}` : ''}.` });
  if (pv?.news?.length) bullets.push({ kind: 'news', text: `${opp} team news: ${pv.news.map((n) => `${n.name} (${n.status.toLowerCase()}${n.chance !== null && n.chance !== undefined && n.status === 'Doubtful' ? ` ${n.chance}%` : ''})`).join(', ')}.` });

  // Measurable things to watch, each checked after the match.
  const watch = [];
  const P = (k) => pv?.profile?.find((x) => x.key === k) || null;
  const pos = P('possession');
  if (pos && has(pos.spurs) && has(pos.value)) {
    const e = Math.round((pos.spurs + (100 - pos.value)) / 2);
    watch.push({ key: 'possession', title: 'Who controls the ball', text: `Spurs average ${Math.round(pos.spurs)}% possession; ${opp} average ${Math.round(pos.value)}%. Expect Spurs to have about ${e}%.`, expect: { kind: 'approx', value: e, tol: 7, unit: '%' } });
  }
  if (fc) {
    watch.push({ key: 'xgFor', title: 'Chances Spurs create', text: `The model expects Spurs to create about ${fc.expectedGoals.spurs} xG.`, expect: { kind: 'approx', value: fc.expectedGoals.spurs, tol: 0.5, unit: ' xG', dp: 2, good: 'up' } });
    watch.push({ key: 'xgAgainst', title: `Chances ${opp} create`, text: `The model expects ${opp} to create about ${fc.expectedGoals.opp} xG.`, expect: { kind: 'approx', value: fc.expectedGoals.opp, tol: 0.5, unit: ' xG', dp: 2, good: 'down' } });
  }
  const sp = P('xgSetPlay');
  if (sp && sp.rank && sp.rank <= 8) watch.push({ key: 'setPiecesAgainst', title: `${opp}'s set pieces`, text: `${opp} are ${ord(sp.rank)} for set-piece xG (${n2(sp.value)} per match). Keep them below that.`, expect: { kind: 'atmost', value: round(sp.value, 2), unit: ' xG', dp: 2 } });
  const dm = pv?.dangerMen?.[0];
  if (dm) watch.push({ key: 'dangerMan', title: `Keep ${dm.name} quiet`, text: `${dm.name} has ${dm.goals} goal${dm.goals === 1 ? '' : 's'} and ${dm.assists} assist${dm.assists === 1 ? '' : 's'} this season. No goal or assist from him counts as a success.`, expect: { kind: 'atmost', value: 0, unit: ' G+A' }, player: dm.name });
  const ca = avgOf(teamMatches.filter((m) => m.adv), (m) => m.adv.counters?.against.shots ?? null);
  if (has(ca) && pos && pos.spurs >= 52) watch.push({ key: 'countersAgainst', title: 'The space behind', text: `With Spurs on the ball, the risk is the counter: they concede ${ca.toFixed(1)} shots per match on the break.`, expect: { kind: 'atmost', value: Math.max(1, Math.round(ca)), unit: ' shots' } });
  const box = avgOf(teamMatches.filter((m) => m.adv), (m) => m.adv.spurs.touchesOppBox);
  if (has(box)) watch.push({ key: 'boxTouches', title: 'Getting into the box', text: `Spurs average ${Math.round(box)} touches in the opposition box. Matching that means the possession is going somewhere.`, expect: { kind: 'atleast', value: Math.round(box), unit: ' touches' } });
  return { matchId: f.id, opponent: opp, kickoff: f.kickoff, bullets, watch };
}

// After the match: check the saved brief (and the saved pre-kick-off forecast) against the result.
export function checkBrief({ brief, prediction, match }) {
  const f = match.fixture; const adv = match.team?.adv; const t = match.team;
  if (!f.score) return null;
  const actual = {
    possession: adv?.spurs?.possession ?? null,
    xgFor: adv?.spurs?.xg ?? t?.xg ?? null,
    xgAgainst: adv?.opp?.xg ?? t?.xga ?? null,
    setPiecesAgainst: adv?.situations ? SETP.reduce((a, k) => a + (adv.situations[k]?.against?.xg || 0), 0) : null,
    countersAgainst: adv?.counters?.against?.shots ?? null,
    boxTouches: adv?.spurs?.touchesOppBox ?? null,
  };
  const checks = [];
  if (prediction) {
    const fav = prediction.win >= prediction.loss + 5 ? 'W' : prediction.loss >= prediction.win + 5 ? 'L' : null;
    const label = { W: 'a Spurs win', D: 'a draw', L: `a ${f.opponent} win` };
    const top = prediction.likelyScores?.[0];
    checks.push({ title: 'The forecast', text: `Before kick-off: Spurs win ${prediction.win}%, draw ${prediction.draw}%, ${f.opponent} win ${prediction.loss}%${fav ? ` (favourite: ${label[fav]})` : ' (no clear favourite)'}.`,
      actual: `Result: ${label[f.result]}, ${f.score.spurs}–${f.score.opp}.${top ? ` Likeliest score was ${top.spurs}–${top.opp}${top.spurs === f.score.spurs && top.opp === f.score.opp ? ', which came in' : ''}.` : ''}`,
      verdict: fav === null ? 'neutral' : fav === f.result ? 'held' : 'missed' });
  }
  for (const w of brief?.watch || []) {
    let v = actual[w.key];
    if (w.key === 'dangerMan') {
      const n = surname(w.player);
      v = (f.events || []).filter((e) => e.team === 'opp' && (e.type === 'goal' || e.type === 'assist') && surname(e.player) === n).reduce((a, e) => a + (e.value || 1), 0);
      if (!match.lineup?.length && !(f.events || []).length) v = null;
    }
    if (!has(v) && !(w.key === 'xgFor' || w.key === 'xgAgainst')) { checks.push({ title: w.title, text: w.text, actual: 'Not measured for this match.', verdict: 'unknown' }); continue; }
    if (!has(v)) continue;
    const e = w.expect; const dp = e.dp ?? 0;
    const ok = e.kind === 'approx' ? Math.abs(v - e.value) <= e.tol : e.kind === 'atmost' ? v <= e.value : v >= e.value;
    const shown = `${Number(v).toFixed(dp)}${e.unit || ''}`;
    const how = e.kind === 'approx' ? (ok ? 'close to the expectation' : v > e.value ? 'more than expected' : 'less than expected') : ok ? 'target met' : 'target missed';
    checks.push({ title: w.title, text: w.text, actual: w.key === 'dangerMan' ? `${w.player}: ${v ? `${v} goal${v === 1 ? '' : 's'}/assist${v === 1 ? '' : 's'}` : 'no goal or assist'}.` : `Actual: ${shown} (${how}).`, verdict: ok ? 'held' : e.kind === 'approx' && e.good ? ((v > e.value) === (e.good === 'up') ? 'better' : 'worse') : 'missed' });
  }
  // xG checks come from the forecast even when no brief was saved before this page existed.
  if (!brief && prediction) {
    for (const [k, title, exp] of [['xgFor', 'Chances Spurs created', prediction.expectedGoals?.spurs], ['xgAgainst', `Chances ${f.opponent} created`, prediction.expectedGoals?.opp]]) {
      const v = actual[k]; if (!has(v) || !has(exp)) continue;
      const ok = Math.abs(v - exp) <= 0.5;
      checks.push({ title, text: `Expected about ${exp} xG.`, actual: `Actual: ${n2(v)} xG (${ok ? 'close to the expectation' : v > exp ? 'more than expected' : 'less than expected'}).`, verdict: ok ? 'held' : (v > exp) === (k === 'xgFor') ? 'better' : 'worse' });
    }
  }
  const scored = checks.filter((c) => c.verdict !== 'neutral' && c.verdict !== 'unknown');
  return { matchId: f.id, opponent: f.opponent, opponentTeamId: f.opponentTeamId ?? null, home: f.home, kickoff: f.kickoff, score: f.score, result: f.result, checks, held: scored.filter((c) => c.verdict === 'held' || c.verdict === 'better').length, of: scored.length, briefSaved: Boolean(brief) };
}
