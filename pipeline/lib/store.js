// File-backed store. The repository itself is the database: every write is atomic,
// and git history provides durable, versioned persistence across runs and restarts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Corrupt JSON in ${file}: ${err.message}`);
  }
}

// Writes only when content changes, so unchanged data never produces a commit.
// `stableKeys` (e.g. generatedAt) keep their previous value when nothing else changed,
// so a run with no new football data produces no commit.
export function writeJson(file, data, { pretty = false, stableKeys = [] } = {}) {
  let previous = null;
  try { previous = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
  if (previous && stableKeys.length && data && typeof data === 'object') {
    try {
      const prev = JSON.parse(previous);
      const probe = { ...data };
      for (const k of stableKeys) if (k in prev) probe[k] = prev[k];
      if (JSON.stringify(probe) === JSON.stringify(prev)) return false;
    } catch { /* rewrite */ }
  }
  const text = JSON.stringify(data, null, pretty ? 2 : 0) + '\n';
  if (previous === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return true;
}

export function hash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

export function listFiles(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}
