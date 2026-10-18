// Adapter: Wikipedia API (CC BY-SA). Reads the head coach from the club article's
// infobox so coach-era labels stay current without manual edits.
import { request } from '../lib/http.js';

export async function fetchHeadCoach() {
  const base = process.env.WIKI_BASE || 'https://en.wikipedia.org';
  const { body } = await request(`${base}/w/api.php?action=parse&page=Tottenham_Hotspur_F.C.&prop=wikitext&section=0&format=json&formatversion=2`, { retries: 1 });
  const text = body?.parse?.wikitext || '';
  const m = text.match(/\|\s*manager\s*=\s*([^\n]+)/i);
  const line = m ? m[1] : '';
  const link = line.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  const name = (link ? (link[2] || link[1]) : line).replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').trim();
  if (!name || name.length > 60) throw new Error('Wikipedia: head coach not found in infobox');
  return name;
}
