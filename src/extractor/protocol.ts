// Messages between the content script (isolated world) and page-bridge (page's main world).
// Both share `window`, so they talk with window.postMessage.

import type { ErrorCode } from './errors.ts';
import type { PlayerResponse } from './parsers.ts';

export const CHANNEL = 'yt-transcriber/v1';

export type BridgeRequest =
  | { kind: 'getPlayerResponse'; videoId: string }
  | { kind: 'fetchTrack'; videoId: string; baseUrl: string }
  | { kind: 'seek'; seconds: number };

export interface BridgeResults {
  getPlayerResponse: PlayerResponse;
  fetchTrack: { body: string; timings: Record<string, number> };
  seek: null;
}

export type BridgeReply<K extends BridgeRequest['kind'] = BridgeRequest['kind']> =
  | { ok: true; data: BridgeResults[K] }
  | { ok: false; code: ErrorCode; detail?: string };

export interface Envelope {
  channel: typeof CHANNEL;
  dir: 'req' | 'res';
  id: string;
  payload: unknown;
}

export function isEnvelope(d: unknown, dir: Envelope['dir']): d is Envelope {
  return (
    typeof d === 'object' &&
    d !== null &&
    (d as Envelope).channel === CHANNEL &&
    (d as Envelope).dir === dir &&
    typeof (d as Envelope).id === 'string'
  );
}
