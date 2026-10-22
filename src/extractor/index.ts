// Public interface of the extraction module. The UI imports only from here.
// Runs in the content script (isolated world) and talks to page-bridge.ts.

import { TranscriptError } from './errors.ts';
import { parseJson3, parsePlayerResponse } from './parsers.ts';
import { CHANNEL, isEnvelope, type BridgeReply, type BridgeRequest, type BridgeResults, type Envelope } from './protocol.ts';
import type { CaptionTrack, Transcript, VideoInfo } from './types.ts';

export { TranscriptError, messageFor, type ErrorCode } from './errors.ts';
export { pickDefaultTrack, watchVideoId } from './parsers.ts';
export type { CaptionTrack, Segment, Transcript, VideoInfo } from './types.ts';

const BRIDGE_TIMEOUT_MS = 15_000;
const pending = new Map<string, (reply: BridgeReply) => void>();
let listening = false;

function call<K extends BridgeRequest['kind']>(req: Extract<BridgeRequest, { kind: K }>): Promise<BridgeResults[K]> {
  if (!listening) {
    listening = true;
    window.addEventListener('message', (e) => {
      if (e.source !== window || !isEnvelope(e.data, 'res')) return;
      pending.get(e.data.id)?.(e.data.payload as BridgeReply);
    });
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new TranscriptError('PAGE_CHANGED', 'page script did not respond. Reload the tab'));
    }, BRIDGE_TIMEOUT_MS);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      pending.delete(id);
      if (reply.ok) resolve(reply.data as BridgeResults[K]);
      else reject(new TranscriptError(reply.code, reply.detail));
    });
    const env: Envelope = { channel: CHANNEL, dir: 'req', id, payload: req };
    window.postMessage(env, location.origin);
  });
}

/** Reads the player for `videoId` and returns its caption tracks, or throws a TranscriptError. */
export async function getVideoInfo(videoId: string): Promise<VideoInfo> {
  const pr = await call({ kind: 'getPlayerResponse', videoId });
  return parsePlayerResponse(pr, videoId);
}

export interface TranscriptResult {
  transcript: Transcript;
  timings: Record<string, number>;
}

async function fromCaptions(video: VideoInfo, track: CaptionTrack): Promise<TranscriptResult> {
  const { body, timings } = await call({ kind: 'fetchTrack', videoId: video.videoId, baseUrl: track.baseUrl });
  const t = performance.now();
  const segments = parseJson3(body);
  timings.parseMs = Math.round(performance.now() - t);
  if (segments.length === 0) throw new TranscriptError('NO_CAPTIONS', `track "${track.label}" is empty`);
  return { transcript: { videoId: video.videoId, trackId: track.id, segments, source: 'captions' }, timings };
}

async function fromPanel(video: VideoInfo): Promise<TranscriptResult> {
  const t = performance.now();
  const { segments, languageLabel, via } = await call({ kind: 'panelTranscript', videoId: video.videoId });
  if (segments.length === 0) throw new TranscriptError('NO_CAPTIONS', 'the transcript panel was empty');
  return {
    transcript: { videoId: video.videoId, trackId: 'panel', segments, source: 'panel', panelLanguage: languageLabel },
    timings: { panelMs: Math.round(performance.now() - t), [`panelVia_${via}`]: 1 },
  };
}

/** Failures the "Show transcript" panel can work around (it uses its own request path). */
const PANEL_CAN_HELP = new Set(['BLOCKED', 'PAGE_CHANGED', 'MALFORMED']);

/**
 * Fetches and parses one caption track; if YouTube blocks that, reads the transcript panel instead.
 * Never returns a partial transcript: any doubt throws.
 */
export async function getTranscript(video: VideoInfo, track: CaptionTrack): Promise<TranscriptResult> {
  try {
    return await fromCaptions(video, track);
  } catch (e) {
    if (!(e instanceof TranscriptError) || !PANEL_CAN_HELP.has(e.code)) throw e;
    console.info('[yt-transcriber] caption fetch failed, trying transcript panel:', e.code, e.detail ?? '');
    try {
      return await fromPanel(video);
    } catch (e2) {
      const why = e2 instanceof TranscriptError ? (e2.detail ?? e2.code) : String(e2);
      // Report the original failure; it is the more informative one.
      throw new TranscriptError(e.code, `${e.detail ?? e.code}; transcript panel fallback also failed: ${why}`);
    }
  }
}

export function seekTo(seconds: number): Promise<null> {
  return call({ kind: 'seek', seconds });
}
