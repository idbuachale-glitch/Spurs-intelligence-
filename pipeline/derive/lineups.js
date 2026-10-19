// Confirmed line-ups → rating adjustments. On match day, once the teams are announced,
// each side's attack and defence are scaled by how its actual XI compares with its usual
// XI (the 11 players with the most league minutes), using each player's real per-90
// output. This replaces the injury estimate for that match.
import { num } from '../lib/validate.js';
import { round } from './stats.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const ALIAS = { spurs: 'tottenham hotspur', 'man utd': 'manchester united', 'man city': 'manchester city', 'nott m forest': 'nottingham forest', 'nottm forest': 'nottingham forest', wolves: 'wolverhampton wanderers', brighton: 'brighton and hove albion', 'brighton hove albion': 'brighton and hove albion', bournemouth: 'afc bournemouth', 'afc bournemouth': 'bournemouth', sunderland: 'sunderland', 'leeds united': 'leeds united', newcastle: 'newcastle united', leeds: 'leeds united', 'west ham': 'west ham united', ipswich: 'ipswich town', hull: 'hull city', coventry: 'coventry city' };
const canon = (n) => { const k = norm(String(n || '').replace(/&/g, ' and ')).replace(/ fc$/, '').replace(/^afc /, ''); return ALIAS[k] || k; };

// FPL team id for an ESPN team name.
export function teamIdFor(name, teams) {
  const c = canon(name);
  const hit = teams.find((t) => canon(t.name) === c) || teams.find((t) => c.includes(canon(t.name)) || canon(t.name).includes(c));
  return hit ? hit.id : null;
}

// Match an ESPN player name to an FPL element of that team.
function matchPlayer(p, squad) {
  const full = norm(p.name); const parts = full.split(' '); const last = parts.slice(1).join(' ') || full;
  return squad.find((e) => norm(`${e.first_name} ${e.second_name}`) === full)
    || squad.find((e) => norm(e.second_name) === last || norm(e.second_name).endsWith(` ${parts[parts.length - 1]}`) && norm(e.first_name)[0] === full[0])
    || squad.find((e) => norm(e.web_name) && (full.endsWith(` ${norm(e.web_name)}`) || full === norm(e.web_name) || norm(p.short).endsWith(norm(e.web_name))))
    || null;
}

const p90 = (e, k) => { const m = num(e.minutes) || 0; return m >= 90 ? ((num(e[k]) || 0) / m) * 90 : null; };

// Attack/defence multipliers for one side from its confirmed XI.
export function lineupEffect(side, teamId, elements) {
  const squad = elements.filter((e) => num(e.team) === teamId);
  const usual = squad.slice().sort((a, b) => (num(b.minutes) || 0) - (num(a.minutes) || 0)).slice(0, 11);
  const att = (e) => (p90(e, 'expected_goals') ?? 0.05) + (p90(e, 'expected_assists') ?? 0.03);
  const dfn = (e) => p90(e, 'defensive_contribution') ?? p90(e, 'clearances_blocks_interceptions') ?? 3;
  const matched = side.starters.map((p) => ({ p, e: matchPlayer(p, squad) }));
  const known = matched.filter((x) => x.e);
  // An unknown starter (no league minutes, e.g. a youngster) counts at 80% of the usual XI's average.
  const uAtt = usual.reduce((a, e) => a + att(e), 0); const uDef = usual.reduce((a, e) => a + dfn(e), 0);
  const avgA = uAtt / (usual.length || 1); const avgD = uDef / (usual.length || 1);
  const sAtt = known.reduce((a, x) => a + att(x.e), 0) + (11 - known.length) * avgA * 0.8;
  const sDef = known.reduce((a, x) => a + dfn(x.e), 0) + (11 - known.length) * avgD * 0.8;
  // Half the measured difference is applied (team-mates adapt; per-90 figures are noisy).
  const attMult = Math.max(0.82, Math.min(1.15, 1 + ((sAtt / (uAtt || 1)) - 1) * 0.5));
  const defMult = Math.max(0.9, Math.min(1.12, 1 - ((sDef / (uDef || 1)) - 1) * 0.25));
  const usualIds = new Set(usual.map((e) => e.id));
  const missingUsual = usual.filter((e) => !known.some((x) => x.e.id === e.id)).map((e) => e.web_name);
  return { attMult: round(attMult, 3), defMult: round(defMult, 3), formation: side.formation, starters: matched.map((x) => ({ name: x.e ? x.e.web_name : x.p.name, pos: x.p.pos, matched: Boolean(x.e), usual: x.e ? usualIds.has(x.e.id) : false })), missingUsual, matched: known.length };
}
