// Polite HTTP client: per-host spacing, timeouts, retries with exponential backoff,
// Retry-After support and request accounting (used for quota reporting).
const lastCall = new Map();
export const requestLog = []; // { host, url, status, ms, at }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(message, { status, url, retryable }) {
    super(message);
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

export async function request(url, {
  headers = {},
  minGapMs = 0,
  retries = 3,
  timeoutMs = 20000,
  as = 'json',
  fetchImpl = globalThis.fetch,
} = {}) {
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    const wait = (lastCall.get(host) || 0) + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { 'User-Agent': 'SpursIntelligence/1.0 (personal analytics site)', Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      requestLog.push({ host, url: redact(url), status: 'network-error', ms: Date.now() - started, at: new Date().toISOString() });
      if (attempt < retries) { await sleep(backoff(attempt++)); continue; }
      throw new HttpError(`Network error for ${redact(url)}: ${err.message}`, { status: 0, url, retryable: true });
    }
    requestLog.push({ host, url: redact(url), status: res.status, ms: Date.now() - started, at: new Date().toISOString() });
    if (res.ok) {
      const body = as === 'text' ? await res.text() : await res.json();
      return { body, headers: Object.fromEntries(res.headers.entries()), status: res.status };
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60000) : backoff(attempt));
      attempt++;
      continue;
    }
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new HttpError(`HTTP ${res.status} for ${redact(url)} ${detail}`.trim(), { status: res.status, url, retryable });
  }
}

function backoff(attempt) {
  return Math.min(30000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 400);
}

// Never let a credential that sits in a URL reach logs or committed files.
export function redact(url) {
  return String(url).replace(/(json\/)([^/]+)(\/)/, (m, a, key, c) => (key === '123' ? m : `${a}***${c}`));
}

export function quotaSummary() {
  const byHost = {};
  for (const r of requestLog) {
    const h = (byHost[r.host] ||= { requests: 0, failures: 0 });
    h.requests++;
    if (!(typeof r.status === 'number' && r.status < 400)) h.failures++;
  }
  return byHost;
}
