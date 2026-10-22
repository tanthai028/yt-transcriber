import type { Segment } from './extractor/types.ts';

/** Case-insensitive. Returns the indices of segments whose text contains `query`. */
export function findMatches(segments: readonly Segment[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  segments.forEach((s, i) => {
    if (s.text.toLowerCase().includes(q)) out.push(i);
  });
  return out;
}

/** Splits `text` into alternating plain/matched parts for highlighting. Joining the parts gives `text` back. */
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, at + q.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + q.length), match: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
