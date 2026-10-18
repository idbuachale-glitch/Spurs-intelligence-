// Structured JSON-lines logging (visible in the GitHub Actions run log).
export const events = [];

export function log(level, msg, extra = {}) {
  const entry = { at: new Date().toISOString(), level, msg, ...extra };
  events.push(entry);
  if (process.env.SPURS_QUIET !== '1') console.log(JSON.stringify(entry));
}

export const info = (m, e) => log('info', m, e);
export const warn = (m, e) => log('warn', m, e);
export const error = (m, e) => log('error', m, e);
