export type ErrorCode =
  | 'NOT_WATCH_PAGE'
  | 'NO_CAPTIONS'
  | 'LIVE'
  | 'AGE_RESTRICTED'
  | 'PRIVATE'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'BLOCKED'
  | 'MALFORMED'
  | 'PAGE_CHANGED';

const MESSAGES: Record<ErrorCode, string> = {
  NOT_WATCH_PAGE: 'Open a YouTube video to see its transcript.',
  NO_CAPTIONS:
    'No captions available for this video. Either none were uploaded or generated, or the creator disabled them (YouTube reports both the same way).',
  LIVE: 'This is a live stream or an upcoming premiere. Transcripts are available once it has ended and been processed.',
  AGE_RESTRICTED: 'This video is age-restricted. Sign in to YouTube with an age-verified account, then try again.',
  PRIVATE: 'This video is private.',
  UNAVAILABLE: 'This video is unavailable.',
  NETWORK: 'Network error while loading captions. Check your connection and try again.',
  BLOCKED:
    "YouTube returned no caption data. It may have blocked the request, or the player's caption token was not available.",
  MALFORMED: 'YouTube returned caption data in an unexpected format, so nothing is shown rather than a possibly incomplete transcript.',
  PAGE_CHANGED:
    "YouTube's page structure has changed and the extension can no longer read the player. The extraction module needs an update.",
};

export class TranscriptError extends Error {
  readonly code: ErrorCode;
  /** Extra context, e.g. YouTube's own reason text or an HTTP status. Shown under the main message. */
  readonly detail: string | undefined;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
    this.name = 'TranscriptError';
    this.code = code;
    this.detail = detail;
  }

  get userMessage(): string {
    return MESSAGES[this.code];
  }
}

export function messageFor(code: ErrorCode): string {
  return MESSAGES[code];
}
