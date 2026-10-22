// Pure functions that turn YouTube's raw data into our types. No DOM, no network:
// everything here runs under `node --test` against saved fixtures.

import { TranscriptError } from './errors.ts';
import type { CaptionTrack, Segment, TrackKind, VideoInfo } from './types.ts';
import { parseVideoUrl } from './video-id.ts';

// ---------------------------------------------------------------------------
// Player response → video info + track list
// ---------------------------------------------------------------------------

interface Text {
  simpleText?: string;
  runs?: { text?: string }[];
}

interface RawTrack {
  baseUrl?: string;
  name?: Text;
  vssId?: string;
  languageCode?: string;
  kind?: string;
}

/** The subset of YouTube's player response we read. Everything optional: never trust its shape. */
export interface PlayerResponse {
  playabilityStatus?: {
    status?: string;
    reason?: string;
    errorScreen?: { playerErrorMessageRenderer?: { reason?: Text; subreason?: Text } };
  };
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    isLive?: boolean;
    isUpcoming?: boolean;
  };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: RawTrack[] } };
}

function textOf(t: Text | undefined): string {
  if (!t) return '';
  if (typeof t.simpleText === 'string') return t.simpleText;
  return (t.runs ?? []).map((r) => r.text ?? '').join('');
}

/**
 * Validates that the video can have a transcript and returns its caption tracks.
 * Throws a TranscriptError describing why not otherwise.
 */
export function parsePlayerResponse(pr: PlayerResponse | null | undefined, expectedVideoId: string): VideoInfo {
  if (!pr || typeof pr !== 'object') throw new TranscriptError('PAGE_CHANGED', 'player response missing');

  const ps = pr.playabilityStatus ?? {};
  const status = ps.status ?? '';
  const reason =
    ps.reason || textOf(ps.errorScreen?.playerErrorMessageRenderer?.reason) || textOf(ps.errorScreen?.playerErrorMessageRenderer?.subreason);
  const lower = reason.toLowerCase();

  if (status !== 'OK') {
    if (status === 'LIVE_STREAM_OFFLINE') throw new TranscriptError('LIVE', reason || undefined);
    if (status === 'AGE_VERIFICATION_REQUIRED' || status === 'AGE_CHECK_REQUIRED' || /\bage\b|inappropriate/.test(lower)) {
      throw new TranscriptError('AGE_RESTRICTED', reason || undefined);
    }
    if (lower.includes('private')) throw new TranscriptError('PRIVATE', reason);
    if (status === 'LOGIN_REQUIRED' || status === 'UNPLAYABLE' || status === 'ERROR' || status === 'CONTENT_CHECK_REQUIRED') {
      throw new TranscriptError('UNAVAILABLE', reason || status);
    }
    // Unknown status: YouTube added something new. Report it rather than guess.
    throw new TranscriptError('UNAVAILABLE', reason || `playability status ${status || 'missing'}`);
  }

  const vd = pr.videoDetails;
  if (!vd?.videoId) throw new TranscriptError('PAGE_CHANGED', 'video details missing');
  if (vd.videoId !== expectedVideoId) {
    throw new TranscriptError('PAGE_CHANGED', `player has ${vd.videoId}, expected ${expectedVideoId}`);
  }
  if (vd.isLive || vd.isUpcoming) throw new TranscriptError('LIVE');

  const raw = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const tracks: CaptionTrack[] = [];
  for (const t of raw) {
    if (!t.baseUrl || !t.languageCode) continue;
    const kind: TrackKind = t.kind === 'asr' ? 'asr' : 'manual';
    tracks.push({
      id: t.vssId || `${kind === 'asr' ? 'a' : ''}.${t.languageCode}`,
      languageCode: t.languageCode,
      label: textOf(t.name) || t.languageCode,
      kind,
      baseUrl: t.baseUrl,
    });
  }
  if (tracks.length === 0) throw new TranscriptError('NO_CAPTIONS');

  return {
    videoId: vd.videoId,
    title: vd.title ?? '',
    lengthSec: Number(vd.lengthSeconds) || 0,
    tracks,
  };
}

/**
 * Default track: manual in a preferred language, then auto-generated in a preferred
 * language, then any manual track, then whatever is first.
 * `preferred` is navigator.languages, e.g. ["en-US", "en", "de"].
 */
export function pickDefaultTrack(tracks: CaptionTrack[], preferred: readonly string[]): CaptionTrack | undefined {
  const base = (code: string) => code.toLowerCase().split('-')[0];
  const matches = (t: CaptionTrack, lang: string) =>
    t.languageCode.toLowerCase() === lang.toLowerCase() || base(t.languageCode) === base(lang);

  for (const kind of ['manual', 'asr'] as const) {
    for (const lang of preferred) {
      const hit = tracks.find((t) => t.kind === kind && matches(t, lang));
      if (hit) return hit;
    }
  }
  return tracks.find((t) => t.kind === 'manual') ?? tracks[0];
}

// ---------------------------------------------------------------------------
// Caption bodies → segments
// ---------------------------------------------------------------------------

interface Json3 {
  events?: {
    tStartMs?: number;
    dDurationMs?: number;
    aAppend?: number;
    segs?: { utf8?: string }[];
  }[];
}

/** Line breaks inside a caption are layout, not content: join them with a space. */
function tidy(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').trim();
}

/** Parses YouTube's `fmt=json3` caption format (both manual and auto-generated tracks). */
export function parseJson3(body: string): Segment[] {
  if (body.trim() === '') throw new TranscriptError('BLOCKED', 'empty caption response');
  let data: Json3;
  try {
    data = JSON.parse(body) as Json3;
  } catch {
    throw new TranscriptError('MALFORMED', 'caption JSON did not parse (truncated?)');
  }
  if (!data || !Array.isArray(data.events)) throw new TranscriptError('MALFORMED', 'caption JSON has no events');

  const out: Segment[] = [];
  for (const ev of data.events) {
    if (!ev.segs) continue; // window/style definitions
    const text = tidy(ev.segs.map((s) => s.utf8 ?? '').join(''));
    if (!text) continue; // ASR line-break events ("aAppend": "\n")
    if (typeof ev.tStartMs !== 'number') throw new TranscriptError('MALFORMED', 'caption event without start time');
    out.push({ startMs: ev.tStartMs, durMs: ev.dDurationMs ?? 0, text });
  }
  return out;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Parses YouTube's default XML caption format (`<transcript><text start dur>`).
 * Text is entity-encoded twice ("&amp;#39;"), so it is decoded twice.
 */
export function parseXml(body: string): Segment[] {
  if (body.trim() === '') throw new TranscriptError('BLOCKED', 'empty caption response');
  if (!/<transcript[\s>]/.test(body) || !/<\/transcript>\s*$/.test(body)) {
    throw new TranscriptError('MALFORMED', 'caption XML incomplete');
  }
  const out: Segment[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>|<text\b[^>]*\/>/g;
  for (const m of body.matchAll(re)) {
    if (m[2] === undefined) continue; // self-closing, no text
    const attrs = m[1] ?? '';
    const start = /\bstart="([\d.]+)"/.exec(attrs)?.[1];
    const dur = /\bdur="([\d.]+)"/.exec(attrs)?.[1];
    if (start === undefined) throw new TranscriptError('MALFORMED', 'caption line without start time');
    const text = tidy(decodeEntities(decodeEntities(m[2])).replace(/<\/?(?:font|b|i|u)\b[^>]*>/gi, ''));
    if (!text) continue;
    out.push({ startMs: Math.round(Number(start) * 1000), durMs: Math.round(Number(dur ?? 0) * 1000), text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timedtext URLs
// ---------------------------------------------------------------------------

/** Params that identify a track. Everything else in a timedtext URL is signing or client info. */
const TRACK_PARAMS = ['lang', 'kind', 'name', 'variant', 'tlang'] as const;

/**
 * Primary: the track's own signed baseUrl, plus every parameter the player added
 * to its own request (pot, potc, c, cver, …). Verified to work for manual and ASR tracks.
 * The mobile site gives relative baseUrls ("/api/timedtext?…"); they resolve against the
 * player's request, which is always absolute and on the page's own host (www. or m.).
 */
export function buildTrackUrl(baseUrl: string, playerRequestUrl: string): string {
  const player = new URL(playerRequestUrl);
  const base = new URL(baseUrl, player);
  for (const [k, v] of player.searchParams) {
    if (!base.searchParams.has(k) && !(TRACK_PARAMS as readonly string[]).includes(k)) base.searchParams.set(k, v);
  }
  base.searchParams.set('fmt', 'json3');
  return base.toString();
}

/**
 * Fallback: the player's own request with only the track-identifying params swapped.
 * Used when the baseUrl was signed in a different player session than the token.
 */
export function buildTemplateUrl(baseUrl: string, playerRequestUrl: string): string {
  const url = new URL(playerRequestUrl);
  const base = new URL(baseUrl, url);
  for (const k of TRACK_PARAMS) {
    const v = base.searchParams.get(k);
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  url.searchParams.set('fmt', 'json3');
  return url.toString();
}

/** Video ID from any YouTube video URL (watch, Shorts, youtu.be, live, embed), or null. */
export function watchVideoId(href: string): string | null {
  return parseVideoUrl(href).videoId;
}
