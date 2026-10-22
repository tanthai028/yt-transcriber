// Pure parsers for YouTube's "Show transcript" panel (the fallback path).
// Two inputs: the panel's own `youtubei/v1/get_transcript` JSON (preferred), or rows read from its DOM.

import { TranscriptError } from './errors.ts';
import type { Segment } from './types.ts';

interface Text {
  simpleText?: string;
  runs?: { text?: string }[];
}
const textOf = (t: Text | undefined) => (t?.simpleText ?? (t?.runs ?? []).map((r) => r.text ?? '').join('')).trim();

/** Depth-first walk over arbitrary JSON, calling `visit` on every object. */
function walk(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) for (const n of node) walk(n, visit);
  else if (node && typeof node === 'object') {
    visit(node as Record<string, unknown>);
    for (const v of Object.values(node)) walk(v, visit);
  }
}

export interface PanelTranscript {
  segments: Segment[];
  /** Language shown in the panel's language menu, if found. */
  languageLabel: string | null;
}

/**
 * Parses a get_transcript response. Looks for `transcriptSegmentRenderer`-shaped objects
 * ({startMs, endMs, snippet}) anywhere in the tree, so it survives wrapper renames.
 */
export function parseTranscriptPanelJson(body: unknown): PanelTranscript {
  const segments: Segment[] = [];
  let languageLabel: string | null = null;

  walk(body, (obj) => {
    const seg = (obj.transcriptSegmentRenderer ?? null) as { startMs?: string; endMs?: string; snippet?: Text } | null;
    if (seg) {
      const start = Number(seg.startMs);
      const end = Number(seg.endMs);
      const text = textOf(seg.snippet).replace(/\s*\n\s*/g, ' ');
      if (!Number.isFinite(start)) throw new TranscriptError('MALFORMED', 'transcript panel segment without start time');
      if (text) segments.push({ startMs: start, durMs: Number.isFinite(end) ? Math.max(0, end - start) : 0, text });
    }
    const menu = obj.sortFilterSubMenuRenderer as { subMenuItems?: { title?: string; selected?: boolean }[] } | undefined;
    const selected = menu?.subMenuItems?.find((i) => i.selected)?.title;
    if (selected && !languageLabel) languageLabel = selected;
  });

  return { segments, languageLabel };
}

/** "1:02:05" / "2:05" / "05" → milliseconds, or null if it isn't a timestamp. */
export function parseTimestamp(s: string): number | null {
  const m = /^\s*(?:(\d+):)?(?:(\d+):)?(\d+)\s*$/.exec(s);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((p): p is string => p !== undefined).map(Number);
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return sec * 1000;
}

/** Rows as read from the panel's DOM: the timestamp text and the caption text of each segment. */
export interface PanelRow {
  timestamp: string;
  text: string;
}

/** DOM rows → segments. The DOM has no durations, so each runs until the next one starts. */
export function parsePanelRows(rows: readonly PanelRow[]): Segment[] {
  const out: Segment[] = [];
  for (const row of rows) {
    const text = row.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const startMs = parseTimestamp(row.timestamp);
    if (startMs === null) throw new TranscriptError('MALFORMED', `unreadable panel timestamp "${row.timestamp}"`);
    out.push({ startMs, durMs: 0, text });
  }
  for (let i = 0; i < out.length - 1; i++) out[i]!.durMs = Math.max(0, out[i + 1]!.startMs - out[i]!.startMs);
  return out;
}
