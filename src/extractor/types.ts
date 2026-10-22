export type TrackKind = 'manual' | 'asr';

export interface CaptionTrack {
  /** Unique within a video. YouTube's vssId, e.g. ".en", "a.en", ".en.abc123". */
  id: string;
  languageCode: string;
  /** Human label from YouTube, e.g. "English (auto-generated)". */
  label: string;
  kind: TrackKind;
  /** Signed timedtext URL from the player response. Not fetchable on its own (needs the player's token). */
  baseUrl: string;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  lengthSec: number;
  tracks: CaptionTrack[];
}

export interface Segment {
  startMs: number;
  durMs: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  trackId: string;
  segments: Segment[];
  source: 'captions' | 'panel';
}
