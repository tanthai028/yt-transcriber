// Messages between the popup and the content script on the YouTube tab (chrome.tabs.sendMessage).

import type { ErrorCode } from './extractor/errors.ts';
import type { TranscriptResult } from './extractor/index.ts';
import type { CaptionTrack, VideoInfo } from './extractor/types.ts';

export const RPC_TYPE = 'yt-transcriber/rpc';

export interface PageInfo {
  videoId: string | null;
  /** When videoId is null: what was looked at, for the error message. */
  detail?: string;
  /** YouTube's dark theme is on. */
  dark: boolean;
}

export type RpcRequest =
  | { method: 'page' }
  | { method: 'getVideoInfo'; videoId: string }
  | { method: 'getTranscript'; video: VideoInfo; track: CaptionTrack }
  | { method: 'seek'; seconds: number; videoId?: string };

export interface RpcResults {
  page: PageInfo;
  getVideoInfo: VideoInfo;
  getTranscript: TranscriptResult;
  seek: null;
}

export type RpcReply = { ok: true; data: unknown } | { ok: false; code: ErrorCode; detail?: string };

export interface RpcMessage {
  type: typeof RPC_TYPE;
  req: RpcRequest;
}
