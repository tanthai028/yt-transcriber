// Runs in the page's MAIN world at document_start (see manifest.json).
//
// Why it exists: since 2026 YouTube's caption URLs (`exp=xpe`) return an empty body
// unless the request carries a proof-of-origin token (`pot`) minted inside the player.
// We never mint tokens. We only watch the caption requests the player itself makes,
// remember the URL (which includes its token), and reuse its extra parameters to fetch
// the track the user picked. Requests are observed, never modified.

import { TranscriptError } from './errors.ts';
import { buildTemplateUrl, buildTrackUrl, type PlayerResponse } from './parsers.ts';
import { CHANNEL, isEnvelope, type BridgeReply, type BridgeRequest, type Envelope } from './protocol.ts';

interface Player extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse | undefined;
  getVideoData?: () => { video_id?: string } | undefined;
  getPlayerState?: () => number;
  isSubtitlesOn?: () => boolean;
  toggleSubtitles?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
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

const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
  observe(args[1]);
  return (origOpen as (...a: unknown[]) => void).apply(this, args);
} as typeof XMLHttpRequest.prototype.open;

const origFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  observe(input instanceof Request ? input.url : input);
  return origFetch.call(this, input, init);
};

// ---------------------------------------------------------------------------
// Player access
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function player(): Player | null {
  return document.getElementById('movie_player') as Player | null;
}

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
    const p = player();
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

  const p = player();
  if (!p) throw new TranscriptError('PAGE_CHANGED', 'video player element not found');
  if (!p.getPlayerResponse) throw new TranscriptError('PAGE_CHANGED', 'player API not found');
  throw new TranscriptError('PAGE_CHANGED', 'player did not load this video in time');
}

/** Playing or paused, and not showing an ad: only then does toggling CC make the player load captions. */
function playerReady(p: Player): boolean {
  const state = p.getPlayerState?.();
  return (state === 1 || state === 2) && !p.classList.contains('ad-showing');
}

/**
 * Make the player request captions for the current video so we can observe its token.
 * Uses the player's own subtitle toggle and restores the user's CC setting afterwards.
 */
async function captureToken(videoId: string): Promise<string | null> {
  const existing = captured.get(videoId);
  if (existing) return existing;

  const p = player();
  if (!p?.toggleSubtitles || !p.isSubtitlesOn) throw new TranscriptError('PAGE_CHANGED', 'player subtitle API not found');

  // Still starting up, or a pre-roll ad: wait (the player may also fetch captions by itself meanwhile).
  const early = await waitFor(() => captured.get(videoId) ?? playerReady(p), 15_000, 50);
  if (typeof early === 'string') return early;
  if (!early) return null;

  const wasOn = p.isSubtitlesOn();
  try {
    if (wasOn) p.toggleSubtitles(); // off then on forces a (re)load
    p.toggleSubtitles();
    return await waitFor(() => captured.get(videoId), 3000);
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
    const p = player();
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

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handle(req: BridgeRequest): Promise<BridgeReply> {
  try {
    switch (req.kind) {
      case 'getPlayerResponse': {
        const pr = await getPlayerResponse(req.videoId);
        // Send only what we parse: the full response is large and holds unrelated data.
        const data: PlayerResponse = {
          playabilityStatus: pr.playabilityStatus,
          videoDetails: pr.videoDetails,
          captions: pr.captions,
        };
        return { ok: true, data };
      }
      case 'fetchTrack':
        return { ok: true, data: await fetchTrack(req.videoId, req.baseUrl) };
      case 'seek': {
        const p = player();
        if (!p?.seekTo) throw new TranscriptError('PAGE_CHANGED', 'player seek API not found');
        p.seekTo(req.seconds, true);
        return { ok: true, data: null };
      }
    }
  } catch (e) {
    if (e instanceof TranscriptError) return { ok: false, code: e.code, detail: e.detail };
    return { ok: false, code: 'PAGE_CHANGED', detail: e instanceof Error ? e.message : String(e) };
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window || !isEnvelope(e.data, 'req')) return;
  const { id, payload } = e.data;
  void handle(payload as BridgeRequest).then((reply) => {
    const res: Envelope = { channel: CHANNEL, dir: 'res', id, payload: reply };
    window.postMessage(res, location.origin);
  });
});
