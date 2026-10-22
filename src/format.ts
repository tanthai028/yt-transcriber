import type { Segment } from './extractor/types.ts';

/** 75_000 → "1:15", 3_725_000 → "1:02:05". Uses h:mm:ss when `forceHours` (keeps a long list aligned). */
export function formatTimestamp(ms: number, forceHours = false): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0 || forceHours) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** One caption per line, optionally prefixed with "[m:ss] ". Text is never changed. */
export function transcriptToText(segments: readonly Segment[], timestamps: boolean): string {
  const hours = segments.some((s) => s.startMs >= 3_600_000);
  return segments.map((s) => (timestamps ? `[${formatTimestamp(s.startMs, hours)}] ${s.text}` : s.text)).join('\n');
}

export interface ExportMeta {
  title: string;
  videoId: string;
  trackLabel: string;
}

/** TXT download: a short header so the file makes sense on its own, then the transcript. */
export function transcriptFile(segments: readonly Segment[], timestamps: boolean, meta: ExportMeta): string {
  const header = [meta.title, `https://www.youtube.com/watch?v=${meta.videoId}`, `Captions: ${meta.trackLabel}`, ''];
  return [...header, transcriptToText(segments, timestamps), ''].join('\n');
}

/** Safe on Windows, macOS and Linux; keeps the video ID so files never collide. */
export function transcriptFilename(meta: ExportMeta): string {
  const title = meta.title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/, '');
  return `${title || 'transcript'} [${meta.videoId}].txt`;
}
