// Adapter: official YouTube channels via their public RSS feeds (no key needed).
// Only metadata and links are stored; videos are shown with YouTube's own embed
// player, which is the channel owner's authorised distribution method.
import { PROVIDERS } from '../config.js';
import { request } from '../lib/http.js';

const cfg = PROVIDERS.youtube;
export const id = 'youtube';
export const label = 'YouTube RSS — official club/league channels plus established analysis channels';

export async function resolveChannelId(channel) {
  try {
    const { body } = await request(`${cfg.base}/${channel.handle}`, { as: 'text', retries: 1, headers: { 'Accept-Language': 'en' } });
    // Use the page's own canonical channel link; a bare "channelId" can belong to a
    // recommended channel elsewhere on the page.
    const m = body.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || body.match(/"externalId":"(UC[\w-]{22})"/);
    if (m) return m[1];
  } catch { /* fall back */ }
  return channel.fallbackId;
}

export async function fetchChannel(channel) {
  const resolved = await resolveChannelId(channel);
  let lastErr = null;
  const ids = [...new Set([resolved, channel.fallbackId])].filter(Boolean);
  if (!ids.length) throw new Error(`YouTube: could not resolve ${channel.handle}`);
  for (const channelId of ids) {
    try {
      // One retry only: feeds are re-read every 30–120 minutes, so a miss costs little.
      const { body } = await request(`${cfg.base}/feeds/videos.xml?channel_id=${channelId}`, { as: 'text', retries: 1 });
      const feed = parseFeed(body);
      if (!feed.author.toLowerCase().includes(channel.expectName)) {
        lastErr = new Error(`YouTube: channel ${channelId} is "${feed.author}", expected "${channel.expectName}" — refusing unverified source`);
        continue;
      }
      return { channelId, author: feed.author, videos: feed.entries.map((e) => ({ ...e, channel: channel.key, channelName: feed.author })) };
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1].trim()) : ''; };

export function parseFeed(xml) {
  const head = xml.split('<entry>')[0];
  const a = head.match(/<author>([\s\S]*?)<\/author>/);
  const author = (a && tag(a[1], 'name')) || tag(head, 'title');
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    videoId: tag(e, 'yt:videoId'),
    title: tag(e, 'title'),
    published: tag(e, 'published'),
    url: (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || null,
    description: tag(e, 'media:description').slice(0, 500),
    thumbnail: (e.match(/<media:thumbnail url="([^"]+)"/) || [])[1] || null,
  })).filter((v) => /^[\w-]{11}$/.test(v.videoId));
  return { author, entries };
}
