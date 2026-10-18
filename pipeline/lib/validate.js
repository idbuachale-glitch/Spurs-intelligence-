// Minimal schema validation. Incoming provider data is checked before anything is
// written; a payload that fails validation is rejected and the last valid data stays.
export class ValidationError extends Error {}

export function check(cond, message) {
  if (!cond) throw new ValidationError(message);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateBootstrap(b) {
  check(b && Array.isArray(b.teams) && Array.isArray(b.elements) && Array.isArray(b.events), 'bootstrap: missing teams/elements/events');
  check(b.teams.length >= 18 && b.teams.length <= 24, `bootstrap: unexpected team count ${b.teams.length}`);
  check(b.elements.length > 300, `bootstrap: too few players (${b.elements.length})`);
  for (const t of b.teams) check(isNum(t.id) && typeof t.name === 'string', 'bootstrap: bad team row');
  for (const e of b.elements.slice(0, 50)) {
    check(isNum(e.id) && isNum(e.team) && isNum(e.element_type), 'bootstrap: bad player row');
    check('minutes' in e && 'goals_scored' in e, 'bootstrap: player row missing core stats');
  }
  return b;
}

export function validateFixtures(f, teamIds) {
  check(Array.isArray(f) && f.length >= 300, `fixtures: expected a full season list, got ${Array.isArray(f) ? f.length : typeof f}`);
  const ids = new Set();
  for (const x of f) {
    check(isNum(x.id) && !ids.has(x.id), `fixtures: missing or duplicate id ${x.id}`);
    ids.add(x.id);
    check(teamIds.has(x.team_h) && teamIds.has(x.team_a), `fixtures: unknown team in fixture ${x.id}`);
    if (x.finished) check(isNum(x.team_h_score) && isNum(x.team_a_score), `fixtures: finished fixture ${x.id} without score`);
  }
  return f;
}

export function validateElementSummary(s, id) {
  check(s && Array.isArray(s.history), `element-summary ${id}: missing history`);
  for (const h of s.history) check(isNum(h.fixture) && isNum(h.minutes), `element-summary ${id}: bad history row`);
  return s;
}

// Numbers that may be missing must stay missing. FPL sends xG as strings ("0.34").
export function num(v) {
  if (v === null || v === undefined || v === '' || v === 'None') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
