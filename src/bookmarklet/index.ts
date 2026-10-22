// Bookmarklet build: the transcript panel injected straight into the YouTube page (for iPad Safari
// and any browser without the extension). Loaded by a tiny bookmarklet from the install page, then
// run in the page itself, so it reaches the player exactly like the extension's page-bridge does.
// Plain DOM, no React, and no innerHTML (YouTube enforces Trusted Types).

import { TranscriptError, messageFor } from '../extractor/errors.ts';
import { createExtractor } from '../extractor/index.ts';
import { pickDefaultTrack, watchVideoId } from '../extractor/parsers.ts';
import { installHooks, playerApi } from '../extractor/player.ts';
import type { CaptionTrack, Transcript, VideoInfo } from '../extractor/types.ts';
import { formatTimestamp, transcriptFile, transcriptFilename, transcriptToText } from '../format.ts';
import { css as popupCss } from '../popup/styles.ts';
import { findMatches, splitMatches } from '../search.ts';

declare global {
  interface Window {
    __ytTranscriber?: { toggle(): void };
  }
}

const log = (...args: unknown[]) => console.info('[yt-transcriber]', ...args);
const TIMESTAMPS_KEY = 'yt-transcriber:timestamps';

// The popup's stylesheet, scoped to the shadow root, plus a floating sheet at the top right.
const css =
  popupCss
    .replace(':root.dark', ':host(.dark)')
    .replace(':root', ':host')
    .replace('html.dark mark', ':host(.dark) mark')
    .replace(/html, body \{[^}]*\}/, '') +
  `
:host { all: initial; }
.panel {
  position: fixed; top: 12px; right: 12px; z-index: 2300;
  width: 342px; max-width: calc(100vw - 24px); height: min(600px, calc(100vh - 24px));
  border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 32px rgba(0,0,0,.28); overflow: hidden;
  -webkit-text-size-adjust: 100%;
}
.ts, .btn, .seg button, .icon { touch-action: manipulation; }
`;

/** Tiny element builder: h('div', { className: 'x', onclick }, child, 'text'). */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {},
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('aria') || k === 'role' || k.startsWith('data-')) el.setAttribute(k.replace(/^aria([A-Z])/, (_, c: string) => `aria-${c.toLowerCase()}`), String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

function readTimestampsSetting(): boolean {
  try {
    return localStorage.getItem(TIMESTAMPS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function start(): void {
  installHooks();
  const extractor = createExtractor(playerApi);

  const host = h('div', { id: 'yt-transcriber-bookmarklet' });
  const shadow = host.attachShadow({ mode: 'open' });
  const panel = h('section', { className: 'panel', ariaLabel: 'Transcript' });
  shadow.append(h('style', { textContent: css }), panel);
  document.documentElement.append(host);

  let open = true;
  let generation = 0;
  let timestamps = readTimestampsSetting();
  let current: { video: VideoInfo; track: CaptionTrack; transcript: Transcript } | null = null;

  const sub = h('p', { className: 'sub' });
  const head = h(
    'header',
    { className: 'head' },
    h('div', { className: 'titles' }, h('h2', { textContent: 'Transcript' }), sub),
    h('button', { className: 'icon', textContent: '×', ariaLabel: 'Close transcript', title: 'Close', onclick: () => toggle() }),
  );
  const body = h('div');
  body.style.display = 'contents';
  const foot = h('footer', { className: 'foot' });
  panel.append(head, body, foot);

  function setTheme() {
    host.classList.toggle('dark', document.documentElement.hasAttribute('dark'));
  }

  function showStatus(text: string) {
    body.replaceChildren(h('div', { className: 'status', role: 'status' }, h('span', { className: 'spinner' }), h('div', { textContent: text })));
    foot.textContent = '';
  }

  function showError(e: unknown) {
    const err = e instanceof TranscriptError ? e : new TranscriptError('PAGE_CHANGED', String(e));
    log('failed', err.code, err.detail ?? '');
    body.replaceChildren(
      h(
        'div',
        { className: `status error ${err.code === 'NOT_WATCH_PAGE' ? 'neutral' : ''}`, role: 'alert' },
        h('p', { textContent: messageFor(err.code) }),
        err.detail ? h('p', { className: 'detail', textContent: err.detail }) : null,
      ),
    );
    foot.textContent = '';
  }

  async function load(video: VideoInfo, track: CaptionTrack, startedAt: number) {
    const gen = generation;
    showStatus(`Loading ${track.label} captions…`);
    try {
      const { transcript, timings } = await extractor.getTranscript(video, track);
      if (gen !== generation) return;
      current = { video, track, transcript };
      render();
      requestAnimationFrame(() => {
        const ms = Math.round(performance.now() - startedAt);
        foot.textContent = `${transcript.segments.length} lines${transcript.source === 'panel' ? ' · from YouTube’s transcript panel' : ''} · loaded in ${ms} ms`;
        log(`${video.videoId} [${track.id}] ${transcript.segments.length} lines in ${ms} ms`, timings);
      });
    } catch (e) {
      if (gen === generation) showError(e);
    }
  }

  async function loadVideo() {
    const gen = ++generation;
    const startedAt = performance.now();
    current = null;
    setTheme();
    const videoId = watchVideoId(location.href);
    sub.textContent = '';
    if (!videoId) return showError(new TranscriptError('NOT_WATCH_PAGE'));
    showStatus('Reading caption tracks…');
    try {
      const video = await extractor.getVideoInfo(videoId);
      if (gen !== generation) return;
      sub.textContent = video.title;
      sub.title = video.title;
      await load(video, pickDefaultTrack(video.tracks, navigator.languages)!, startedAt);
    } catch (e) {
      if (gen === generation) showError(e);
    }
  }

  function render() {
    if (!current) return;
    const { video, track, transcript } = current;
    const segs = transcript.segments;
    const long = video.lengthSec >= 3600;

    // Controls: track picker, timestamps switch, copy / download.
    const select = h('select', {
      id: 'track',
      onchange: () => {
        ++generation;
        const next = video.tracks.find((t) => t.id === select.value)!;
        void load(video, next, performance.now());
      },
    });
    for (const kind of ['manual', 'asr'] as const) {
      const group = video.tracks.filter((t) => t.kind === kind);
      if (!group.length) continue;
      const og = h('optgroup', { label: kind === 'manual' ? 'Captions' : 'Auto-generated' });
      for (const t of group) og.append(h('option', { value: t.id, textContent: t.label, selected: t.id === track.id }));
      select.append(og);
    }
    const onBtn = h('button', { textContent: 'On' });
    const offBtn = h('button', { textContent: 'Off' });
    const syncSeg = () => {
      onBtn.setAttribute('aria-pressed', String(timestamps));
      offBtn.setAttribute('aria-pressed', String(!timestamps));
    };
    const setTs = (on: boolean) => {
      timestamps = on;
      syncSeg();
      try {
        localStorage.setItem(TIMESTAMPS_KEY, on ? 'on' : 'off');
      } catch {
        // Private browsing: the choice just isn't remembered.
      }
    };
    onBtn.onclick = () => setTs(true);
    offBtn.onclick = () => setTs(false);
    syncSeg();
    const copyBtn = h('button', { className: 'btn primary', textContent: 'Copy' });
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(transcriptToText(segs, timestamps));
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    };
    const dlBtn = h('button', {
      className: 'btn',
      textContent: 'Download',
      onclick: () => {
        const meta = { title: video.title, videoId: video.videoId, trackLabel: track.label };
        saveFile(transcriptFilename(meta), transcriptFile(segs, timestamps, meta));
      },
    });
    const controls = h(
      'div',
      { className: 'controls' },
      h('div', {}, h('label', { className: 'label', htmlFor: 'track', textContent: 'Captions' }), select),
      h(
        'div',
        { className: 'inline' },
        h('div', {}, h('span', { className: 'label', textContent: 'Include timestamps' }), h('div', { className: 'seg', role: 'group' }, onBtn, offBtn)),
        h('div', { className: 'actions' }, copyBtn, dlBtn),
      ),
    );

    // Transcript list. Rows are built once; search only rewrites the text of matching rows.
    const textEls: HTMLSpanElement[] = [];
    const rows: HTMLLIElement[] = [];
    const list = h('ol', { className: 'list' });
    segs.forEach((s, i) => {
      const text = h('span', { className: 'text', textContent: s.text });
      const ts = h('button', {
        className: 'ts',
        textContent: formatTimestamp(s.startMs, long),
        title: 'Jump to this point',
        onclick: () => void extractor.seekTo(s.startMs / 1000),
      });
      const row = h('li', { className: 'row' }, ts, text);
      textEls.push(text);
      rows.push(row);
      list.append(row);
    });

    let matches: number[] = [];
    let cur = 0;
    const count = h('span', { className: 'count', ariaLive: 'polite' });
    const setText = (i: number, query: string) => {
      const el = textEls[i]!;
      if (!query) el.textContent = segs[i]!.text;
      else el.replaceChildren(...splitMatches(segs[i]!.text, query).map((p) => (p.match ? h('mark', { textContent: p.text }) : p.text)));
    };
    const showCurrent = () => {
      rows.forEach((r) => r.classList.remove('current'));
      const i = matches[cur];
      count.textContent = input.value.trim() ? (matches.length ? `${cur + 1} / ${matches.length}` : 'No matches') : '';
      if (i === undefined) return;
      rows[i]!.classList.add('current');
      rows[i]!.scrollIntoView({ block: 'center' });
    };
    const step = (d: number) => {
      if (!matches.length) return;
      cur = (cur + d + matches.length) % matches.length;
      showCurrent();
    };
    const input = h('input', { type: 'search', placeholder: 'Search transcript', ariaLabel: 'Search transcript' });
    input.oninput = () => {
      for (const i of matches) setText(i, '');
      matches = findMatches(segs, input.value);
      for (const i of matches) setText(i, input.value);
      cur = 0;
      showCurrent();
    };
    // Keep typing away from YouTube's keyboard shortcuts (f = fullscreen, k = pause, …).
    for (const type of ['keydown', 'keyup', 'keypress'] as const) input.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
    });
    const search = h(
      'div',
      { className: 'search' },
      input,
      count,
      h('button', { className: 'icon small', textContent: '↑', ariaLabel: 'Previous match', onclick: () => step(-1) }),
      h('button', { className: 'icon small', textContent: '↓', ariaLabel: 'Next match', onclick: () => step(1) }),
    );

    const notes: HTMLElement[] = [];
    if (transcript.source === 'panel') {
      notes.push(h('p', { className: 'note', textContent: 'The caption track couldn’t be fetched, so this was read from YouTube’s transcript panel. It may be in a different language than the track selected above.' }));
    }
    const last = segs[segs.length - 1]!;
    const endMs = last.startMs + last.durMs;
    const lengthMs = video.lengthSec * 1000;
    if (lengthMs > 0 && endMs < lengthMs - Math.max(60_000, lengthMs * 0.1)) {
      notes.push(h('p', { className: 'note', textContent: `Captions end at ${formatTimestamp(endMs, long)}; the video is ${formatTimestamp(lengthMs, long)} long. This is everything YouTube provides for this track.` }));
    }
    body.replaceChildren(controls, ...notes, search, list);
  }

  function toggle() {
    open = !open;
    host.style.display = open ? '' : 'none';
    if (open) void loadVideo();
  }

  // Reload when YouTube navigates in-app to another video while the panel is open.
  let lastUrl = location.href;
  document.addEventListener('yt-navigate-finish', () => {
    if (open && location.href !== lastUrl) void loadVideo();
    lastUrl = location.href;
  });

  window.__ytTranscriber = { toggle };
  void loadVideo();
}

// Running the bookmarklet again toggles the panel instead of adding a second one.
if (window.__ytTranscriber) window.__ytTranscriber.toggle();
else start();
