// Fallback: open YouTube's own "Show transcript" panel and read it. Runs in the MAIN world.
//
// Preferred source is the panel's `youtubei/v1/get_transcript` response, observed (never altered)
// through page-bridge's network hooks: JSON is more stable than markup. If no response is seen, the
// rendered segments are read from the DOM instead. The panel is closed again afterwards if we opened it.
//
// UNVERIFIED: selectors and the get_transcript shape are from known structures, not yet checked against
// the live panel (Oct 2026). Verify with scripts/capture-transcript-panel.js and save a real fixture.

import { TranscriptError } from './errors.ts';
import { parsePanelRows, parseTranscriptPanelJson, type PanelRow, type PanelTranscript } from './panel-parsers.ts';

const PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
const EXPANDED = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
const HIDDEN = 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';
// Old and new segment elements; the generic fallback below handles anything else with a timestamp.
const SEGMENT = 'ytd-transcript-segment-renderer, transcript-segment-view-model';

/** videoId → latest get_transcript JSON seen for it. */
const responses = new Map<string, unknown>();

/** Called by page-bridge for every get_transcript response the page receives. */
export function recordTranscriptResponse(videoId: string | undefined, json: unknown): void {
  if (!videoId) return;
  responses.delete(videoId);
  responses.set(videoId, json);
  if (responses.size > 10) responses.delete(responses.keys().next().value!);
}

export const isTranscriptRequest = (url: string) => url.includes('/youtubei/v1/get_transcript');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function transcriptButton(): HTMLElement | null {
  const known = document.querySelector<HTMLElement>(
    'ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer [role="button"]',
  );
  if (known) return known;
  // Label-based search in case the section was renamed. English-only, so it's the last resort.
  const below = document.querySelector('#below, ytd-watch-metadata') ?? document;
  return (
    [...below.querySelectorAll<HTMLElement>('button, [role="button"]')].find((b) =>
      /show transcript/i.test(`${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`),
    ) ?? null
  );
}

/** Opens the panel; returns a function that restores its previous state. */
async function openPanel(): Promise<() => void> {
  const panel = document.querySelector(PANEL);
  const before = panel?.getAttribute('visibility');
  if (before === EXPANDED) return () => {};

  let button = transcriptButton();
  if (!button) {
    // The button lives in the description, which may be collapsed.
    document.querySelector<HTMLElement>('#description-inline-expander #expand, ytd-text-inline-expander #expand')?.click();
    await sleep(300);
    button = transcriptButton();
  }
  if (button) button.click();
  else if (panel) panel.setAttribute('visibility', EXPANDED);
  else throw new TranscriptError('PAGE_CHANGED', 'no "Show transcript" button or panel found');

  return () => document.querySelector(PANEL)?.setAttribute('visibility', before ?? HIDDEN);
}

function readDomRows(): PanelRow[] {
  const panel = document.querySelector(PANEL);
  if (!panel) return [];
  let els = [...panel.querySelectorAll<HTMLElement>(SEGMENT)];
  if (!els.length) {
    // Unknown markup: any element whose first line is a timestamp and that has text after it.
    els = [...panel.querySelectorAll<HTMLElement>('[role="button"], div')].filter((el) =>
      /^\s*\d{1,2}(:\d{2}){1,2}\s*\n\s*\S/.test(el.innerText) && el.children.length <= 6,
    );
  }
  return els.map((el) => {
    const ts =
      el.querySelector<HTMLElement>('.segment-timestamp, [class*="timestamp"]')?.innerText ??
      /^\s*(\d{1,2}(?::\d{2}){1,2})/.exec(el.innerText)?.[1] ??
      '';
    const text =
      el.querySelector<HTMLElement>('.segment-text, [class*="segment-text"], yt-formatted-string')?.innerText ??
      el.innerText.replace(ts, '');
    return { timestamp: ts, text };
  });
}

/** Waits until the DOM segment count stops changing (the panel renders in batches). */
async function waitForStableRows(deadline: number): Promise<PanelRow[]> {
  let last = -1;
  let stableSince = 0;
  for (;;) {
    const rows = readDomRows();
    const now = performance.now();
    if (rows.length > 0 && rows.length === last) {
      if (now - stableSince > 400) return rows;
    } else {
      last = rows.length;
      stableSince = now;
    }
    if (now > deadline) return rows.length === last && rows.length > 0 ? rows : [];
    await sleep(100);
  }
}

export async function readTranscriptPanel(videoId: string): Promise<PanelTranscript & { via: 'json' | 'dom' }> {
  responses.delete(videoId); // only trust a response that arrives for this request
  const close = await openPanel();
  try {
    const deadline = performance.now() + 10_000;
    // Give the JSON a head start; YouTube fetches it as soon as the panel opens.
    while (performance.now() < deadline && !responses.has(videoId)) {
      if (performance.now() > deadline - 7_000 && readDomRows().length > 0) break;
      await sleep(50);
    }
    const json = responses.get(videoId);
    if (json !== undefined) {
      const parsed = parseTranscriptPanelJson(json);
      if (parsed.segments.length) return { ...parsed, via: 'json' };
    }
    const rows = await waitForStableRows(deadline);
    if (!rows.length) throw new TranscriptError('BLOCKED', 'the transcript panel did not load');
    return { segments: parsePanelRows(rows), languageLabel: null, via: 'dom' };
  } finally {
    close();
  }
}
