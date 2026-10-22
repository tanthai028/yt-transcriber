// Which video is this page about? Pure functions, so every URL format has a test.

export type UrlKind = 'watch' | 'shorts' | 'live' | 'embed' | 'youtu.be';

export interface ParsedVideoUrl {
  videoId: string | null;
  kind: UrlKind | null;
  /** Hostname and path as seen, for error messages ("m.youtube.com/results"). */
  where: string;
}

const ID = /^[\w-]{11}$/;
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/;

/**
 * Video ID from any common YouTube URL: youtube.com/watch?v=, m.youtube.com/watch?v=,
 * /shorts/ID, /live/ID, /embed/ID, youtu.be/ID. Extra parameters (&t=, &list=, &si=) are ignored.
 */
export function parseVideoUrl(href: string): ParsedVideoUrl {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { videoId: null, kind: null, where: href.slice(0, 60) };
  }
  const where = `${u.hostname}${u.pathname}`;
  const segments = u.pathname.split('/').filter(Boolean);
  const valid = (id: string | null | undefined) => (id && ID.test(id) ? id : null);

  if (u.hostname === 'youtu.be') return { videoId: valid(segments[0]), kind: 'youtu.be', where };
  if (!YOUTUBE_HOST.test(u.hostname)) return { videoId: null, kind: null, where };

  if (u.pathname === '/watch') return { videoId: valid(u.searchParams.get('v')), kind: 'watch', where };
  const kinds: Record<string, UrlKind> = { shorts: 'shorts', live: 'live', embed: 'embed', v: 'embed' };
  const kind = kinds[segments[0] ?? ''];
  if (kind) return { videoId: valid(segments[1]), kind, where };
  return { videoId: null, kind: null, where };
}

export interface VideoClues {
  href: string;
  /** <link rel="canonical"> */
  canonical?: string | null;
  /** <meta property="og:url"> */
  ogUrl?: string | null;
  /** The player's own idea of what's loaded (only readable from the page's main world). */
  playerVideoId?: string | null;
}

export interface DetectedVideo {
  videoId: string | null;
  source: 'url' | 'canonical' | 'og:url' | 'player' | null;
  kind: UrlKind | null;
  where: string;
}

/** The URL first; then the page's canonical link, og:url, and finally the player. */
export function detectVideo(clues: VideoClues): DetectedVideo {
  const fromUrl = parseVideoUrl(clues.href);
  if (fromUrl.videoId) return { ...fromUrl, source: 'url' };
  for (const [source, value] of [
    ['canonical', clues.canonical],
    ['og:url', clues.ogUrl],
  ] as const) {
    if (!value) continue;
    const p = parseVideoUrl(value);
    if (p.videoId) return { videoId: p.videoId, kind: p.kind, source, where: fromUrl.where };
  }
  if (clues.playerVideoId && ID.test(clues.playerVideoId)) {
    return { videoId: clues.playerVideoId, kind: fromUrl.kind, source: 'player', where: fromUrl.where };
  }
  return { videoId: null, kind: fromUrl.kind, source: null, where: fromUrl.where };
}

/** Error detail for "no video found", e.g. "m.youtube.com/results: no video ID in the URL, canonical link or player". */
export function describeMiss(d: DetectedVideo): string {
  const what = d.kind ? `a ${d.kind} URL without a valid video ID` : 'not a video page';
  return `${d.where}: ${what} (checked the URL, canonical link, og:url and player)`;
}

/** Reads the clues available in the DOM. `playerVideoId` must be added by callers in the page's main world. */
export function domClues(doc: Document, href: string): VideoClues {
  return {
    href,
    canonical: doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
    ogUrl: doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content ?? null,
  };
}
