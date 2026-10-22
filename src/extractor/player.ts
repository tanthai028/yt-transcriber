// Everything that touches YouTube's player and caption network requests. Runs in the page's MAIN
// world: via page-bridge.ts in the extension (at document_start), or directly in the bookmarklet.
//
// Why: since 2026 YouTube's caption URLs (`exp=xpe`) return an empty body unless the request carries
// a proof-of-origin token (`pot`) minted inside the player. We never mint tokens. We watch the caption
// requests the player itself makes, remember the URL (with its token), and reuse its extra parameters
// to fetch the track the user picked. Requests are observed, never modified.

import { TranscriptError } from './errors.ts';
import { isTranscriptRequest, readTranscriptPanel, recordTranscriptResponse } from './panel-fallback.ts';
import { buildTemplateUrl, buildTrackUrl, type PlayerResponse } from './parsers.ts';

interface CaptionOption {
  languageCode?: string;
  translationLanguage?: { languageCode: string; languageName?: string } | null;
}

interface Player extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse | undefined;
  getVideoData?: () => { video_id?: string } | undefined;
  getPlayerState?: () => number;
  isSubtitlesOn?: () => boolean;
  toggleSubtitles?: () => void;
  getOption?: (module: string, key: string) => unknown;
  setOption?: (module: string, key: string, value: unknown) => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
}

/** What the extractor needs from the page. page-bridge exposes it over postMessage; the bookmarklet calls it directly. */
export interface PlayerApi {
  getPlayerResponse(videoId: string): Promise<PlayerResponse>;
  fetchTrack(videoId: string, baseUrl: string): Promise<{ body: string; timings: Record<string, number> }>;
  panelTranscript(videoId: string): ReturnType<typeof readTranscriptPanel>;
  /** `videoId` picks the right player when a page has more than one (desktop Shorts). */
  seek(seconds: number, videoId?: string): Promise<null>;
}

// ---------------------------------------------------------------------------
// Observe the player's caption requests
// ---------------------------------------------------------------------------

/** videoId → most recent player caption request URL that carried a token. */
const captured = new Map<string, string>();
const MAX_CAPTURED = 30;

function observe(url: unknown): void {
  try {
    const u = new URL(String(url), location.href);
    if (!u.pathname.endsWith('/api/timedtext') || !u.searchParams.has('pot')) return;
    const v = u.searchParams.get('v');
    if (!v) return;
    captured.delete(v);
    captured.set(v, u.href);
    if (captured.size > MAX_CAPTURED) captured.delete(captured.keys().next().value!);
  } catch {
    // Never let our observer break the page.
  }
}

const currentVideoId = () => player()?.getVideoData?.()?.video_id;

let origFetch: typeof window.fetch = window.fetch;
let hooked = false;

/** Starts observing the page's network requests. Safe to call more than once. */
export function installHooks(): void {
  if (hooked) return;
  hooked = true;

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    const url = String(args[1]);
    observe(url);
    if (isTranscriptRequest(url)) {
      const videoId = currentVideoId();
      this.addEventListener('load', () => {
        try {
          recordTranscriptResponse(videoId, this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
        } catch {
          // Not JSON: the fallback will read the DOM instead.
        }
      });
    }
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;

  origFetch = window.fetch;
  const ownFetch = origFetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url = input instanceof Request ? input.url : String(input);
    observe(url);
    const res = ownFetch.call(this, input, init);
    if (isTranscriptRequest(url)) {
      const videoId = currentVideoId();
      // Read a clone so the page's own consumer gets the untouched response.
      res.then((r) => r.clone().json()).then((json) => recordTranscriptResponse(videoId, json), () => {});
    }
    return res;
  };
}

// ---------------------------------------------------------------------------
// Player access
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The player showing `videoId`. Watch pages (desktop and m.youtube.com) have one, #movie_player;
 * desktop Shorts add #shorts-player while a hidden #movie_player may still hold an older video.
 */
function player(videoId?: string): Player | null {
  const all = [...document.querySelectorAll<Player>('#movie_player, #shorts-player, .html5-video-player')];
  if (videoId) {
    const showing = all.find((p) => p.getVideoData?.()?.video_id === videoId);
    if (showing) return showing;
  }
  return all.find((p) => p.id === 'movie_player') ?? all[0] ?? null;
}

/** The video the main player has loaded, for detecting the video when the URL doesn't say. */
export const playerVideoId = (): string | undefined => player()?.getVideoData?.()?.video_id;

async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs: number, stepMs = 25): Promise<T | null> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() >= end) return null;
    await sleep(stepMs);
  }
}

/**
 * The player response for `videoId`. After in-app navigation `ytInitialPlayerResponse`
 * is stale, so the live player is the source of truth; wait until it has switched videos.
 */
async function getPlayerResponse(videoId: string): Promise<PlayerResponse> {
  const pr = await waitFor(() => {
    const p = player(videoId);
    if (!p?.getPlayerResponse || !p.getVideoData) return null;
    if (p.getVideoData()?.video_id !== videoId) return null;
    const r = p.getPlayerResponse();
    if (!r) return null;
    // Error responses (private, removed) may have no videoDetails at all.
    if (r.videoDetails?.videoId === videoId || (r.playabilityStatus?.status ?? 'OK') !== 'OK') return r;
    return null;
  }, 8000, 50);
  if (pr) return pr;

  // First page load before the player API is ready: the server-rendered copy is valid.
  const initial = (window as unknown as { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
  if (initial?.videoDetails?.videoId === videoId) return initial;

  const p = player(videoId);
  if (!p) throw new TranscriptError('PAGE_CHANGED', 'video player element not found');
  if (!p.getPlayerResponse) throw new TranscriptError('PAGE_CHANGED', 'player API not found');
  throw new TranscriptError('PAGE_CHANGED', 'player did not load this video in time');
}

type CaptionPlayer = Player & Required<Pick<Player, 'toggleSubtitles' | 'isSubtitlesOn'>>;
const hasCaptionApi = (p: Player | null): p is CaptionPlayer => !!p?.toggleSubtitles && !!p.isSubtitlesOn;
const showingAd = (p: Player) => p.classList.contains('ad-showing');
/** Ended, playing or paused (not unstarted -1 / cued 5), and no ad. */
const playing = (p: Player) => [0, 1, 2].includes(p.getPlayerState?.() ?? -1) && !showingAd(p);

/**
 * Make the player request captions for the current video so we can observe its token.
 * Tried right away, even before the video has played: that works on the mobile site, where videos
 * don't autoplay. Only if that fails, wait for an ad to end or the video to start, and try again.
 */
async function captureToken(videoId: string): Promise<string | null> {
  const existing = captured.get(videoId);
  if (existing) return existing;

  const p = player(videoId);
  if (!hasCaptionApi(p)) throw new TranscriptError('PAGE_CHANGED', 'player subtitle API not found');

  if (!showingAd(p)) {
    const now = await requestCaptions(p, videoId);
    if (now) return now;
  }
  // A pre-roll ad, or a player that won't load captions yet: wait (it may also fetch them by itself).
  const later = await waitFor(() => captured.get(videoId) ?? playing(p), 15_000, 50);
  if (typeof later === 'string') return later;
  return later ? requestCaptions(p, videoId) : null;
}

/**
 * First a CC off/on; if the player serves that from its own cache (seen when our hooks were installed
 * late, as in the bookmarklet), ask it for a translation of the current track, which always triggers a
 * request. Its token works for every track of the video. The user's CC state is put back either way.
 */
async function requestCaptions(p: CaptionPlayer, videoId: string): Promise<string | null> {
  const wasOn = p.isSubtitlesOn();
  try {
    if (wasOn) p.toggleSubtitles(); // off then on forces a (re)load
    p.toggleSubtitles();
    const viaToggle = await waitFor(() => captured.get(videoId), 2000);
    if (viaToggle || !p.getOption || !p.setOption) return viaToggle;

    const track = p.getOption('captions', 'track') as CaptionOption | undefined;
    const base = track?.languageCode ? track : ((p.getOption('captions', 'tracklist') as CaptionOption[] | undefined)?.[0] ?? null);
    if (!base) return null;
    const lang = base.languageCode === 'en' ? 'fr' : 'en';
    try {
      p.setOption('captions', 'track', { ...base, translationLanguage: { languageCode: lang } });
      return await waitFor(() => captured.get(videoId), 2000);
    } finally {
      p.setOption('captions', 'track', track?.languageCode ? track : base);
    }
  } finally {
    if (p.isSubtitlesOn() !== wasOn) p.toggleSubtitles();
  }
}

async function fetchBody(url: string): Promise<string> {
  let res: Response;
  try {
    res = await origFetch.call(window, url, { credentials: 'same-origin' });
  } catch (e) {
    throw new TranscriptError('NETWORK', e instanceof Error ? e.message : String(e));
  }
  if (res.status === 429) throw new TranscriptError('BLOCKED', 'HTTP 429: YouTube is rate-limiting requests');
  if (!res.ok) throw new TranscriptError('NETWORK', `HTTP ${res.status}`);
  try {
    return await res.text();
  } catch {
    throw new TranscriptError('NETWORK', 'connection dropped while reading captions');
  }
}

async function fetchTrack(videoId: string, baseUrl: string) {
  const timings: Record<string, number> = {};
  let t = performance.now();
  const playerUrl = await captureToken(videoId);
  timings.tokenMs = Math.round(performance.now() - t);
  if (!playerUrl) {
    const p = player(videoId);
    const state = p?.getPlayerState?.();
    const hint = p?.classList.contains('ad-showing')
      ? 'an ad is playing; try again when it ends'
      : state === -1 || state === 5
        ? 'press play once, then try again'
        : 'the player never requested captions';
    throw new TranscriptError('BLOCKED', `no caption token: ${hint}`);
  }

  t = performance.now();
  let body = await fetchBody(buildTrackUrl(baseUrl, playerUrl));
  if (body.trim() === '') body = await fetchBody(buildTemplateUrl(baseUrl, playerUrl));
  timings.fetchMs = Math.round(performance.now() - t);
  if (body.trim() === '') captured.delete(videoId); // stale token: force a fresh capture next time
  return { body, timings };
}

export const playerApi: PlayerApi = {
  async getPlayerResponse(videoId) {
    const pr = await getPlayerResponse(videoId);
    // Only what we parse: the full response is large and holds unrelated data.
    return { playabilityStatus: pr.playabilityStatus, videoDetails: pr.videoDetails, captions: pr.captions };
  },
  fetchTrack,
  async panelTranscript(videoId) {
    if (currentVideoId() !== videoId) throw new TranscriptError('PAGE_CHANGED', 'player is on a different video');
    return readTranscriptPanel(videoId);
  },
  async seek(seconds, videoId) {
    const p = player(videoId);
    if (!p?.seekTo) throw new TranscriptError('PAGE_CHANGED', 'player seek API not found');
    p.seekTo(seconds, true);
    return null;
  },
};
