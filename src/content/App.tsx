import { useEffect, useRef, useState } from 'react';

import { TranscriptCache, type KeyValueStore } from '../cache.ts';
import {
  TranscriptError,
  getTranscript,
  getVideoInfo,
  messageFor,
  pickDefaultTrack,
  seekTo,
  type ErrorCode,
  type Transcript,
  type VideoInfo,
} from '../extractor/index.ts';
import { formatTimestamp, transcriptFile, transcriptFilename, transcriptToText } from '../format.ts';

type Load =
  | { phase: 'loading'; step: string }
  | { phase: 'error'; code: ErrorCode; detail?: string }
  | { phase: 'ready'; transcript: Transcript; timings: Record<string, number>; fromCache: boolean };

interface Props {
  videoId: string | null;
  /** performance.now() when the user asked for this transcript (open, or navigated while open). */
  requestedAt: number;
  onClose: () => void;
}

const log = (...args: unknown[]) => console.info('[yt-transcriber]', ...args);

const storage: KeyValueStore = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
};
const cache = new TranscriptCache(storage);
const TIMESTAMPS_KEY = 'settings:exportTimestamps';

function toError(e: unknown): Load {
  const err = e instanceof TranscriptError ? e : new TranscriptError('PAGE_CHANGED', String(e));
  log('failed', err.code, err.detail ?? '');
  return { phase: 'error', code: err.code, detail: err.detail };
}

export function App({ videoId, requestedAt, onClose }: Props) {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ phase: 'loading', step: 'Starting…' });
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const [timestamps, setTimestamps] = useState(true);
  const [copied, setCopied] = useState(false);
  /** When the current load was requested; end-to-end timing is measured from here. */
  const startedAt = useRef(requestedAt);
  const generation = useRef(0);
  /** Lets an in-flight load notice that the user picked another track meanwhile. */
  const trackIdRef = useRef(trackId);
  trackIdRef.current = trackId;

  useEffect(() => {
    void chrome.storage.local.get(TIMESTAMPS_KEY).then((r) => {
      if (typeof r[TIMESTAMPS_KEY] === 'boolean') setTimestamps(r[TIMESTAMPS_KEY]);
    });
  }, []);

  // 1. Video changed (or panel opened): read the player's track list and pick a default.
  useEffect(() => {
    const gen = ++generation.current;
    startedAt.current = requestedAt;
    setVideo(null);
    setTrackId(null);
    if (!videoId) {
      setLoad({ phase: 'error', code: 'NOT_WATCH_PAGE' });
      return;
    }
    setLoad({ phase: 'loading', step: 'Reading caption tracks…' });
    const t = performance.now();
    getVideoInfo(videoId).then(
      (info) => {
        if (gen !== generation.current) return;
        log(`tracks for ${videoId} in ${Math.round(performance.now() - t)} ms`, info.tracks.map((tr) => tr.id));
        setVideo(info);
        setTrackId(pickDefaultTrack(info.tracks, navigator.languages)!.id);
      },
      (e) => gen === generation.current && setLoad(toError(e)),
    );
  }, [videoId, requestedAt]);

  // 2. Track chosen: cache first, then YouTube.
  useEffect(() => {
    if (!video || !trackId) return;
    const track = video.tracks.find((tr) => tr.id === trackId)!;
    const gen = generation.current;
    const stale = () => gen !== generation.current || track.id !== trackIdRef.current;
    setRenderMs(null);
    setLoad({ phase: 'loading', step: `Loading ${track.label} captions…` });

    void (async () => {
      try {
        let t = performance.now();
        const cached = await cache.get(video.videoId, track.id).catch(() => null);
        const cacheMs = Math.round(performance.now() - t);
        if (stale()) return;
        if (cached) {
          const transcript: Transcript = { videoId: video.videoId, trackId: track.id, segments: cached, source: 'captions' };
          setLoad({ phase: 'ready', transcript, timings: { cacheMs }, fromCache: true });
          return;
        }
        const { transcript, timings } = await getTranscript(video, track);
        if (stale()) return;
        setLoad({ phase: 'ready', transcript, timings: { cacheMs, ...timings }, fromCache: false });
        // Panel transcripts may be in a different language than the selected track; don't file them under it.
        if (transcript.source !== 'captions') return;
        t = performance.now();
        // Only complete transcripts reach here (getTranscript throws otherwise), so they are safe to cache.
        const stored = await cache.put(video.videoId, track.id, transcript.segments).catch((e) => (log('cache write failed', e), false));
        log(stored ? `cached in ${Math.round(performance.now() - t)} ms` : 'not cached (too large or storage error)');
      } catch (e) {
        if (!stale()) setLoad(toError(e));
      }
    })();
  }, [video, trackId]);

  // End-to-end timing: from the user's request to the first paint of the transcript.
  useEffect(() => {
    if (load.phase !== 'ready') return;
    const raf = requestAnimationFrame(() => {
      const total = Math.round(performance.now() - startedAt.current);
      setRenderMs(total);
      const { transcript, timings, fromCache } = load;
      log(`${transcript.videoId} [${transcript.trackId}] ${transcript.segments.length} lines in ${total} ms${fromCache ? ' (cache)' : ''}`, timings);
    });
    return () => cancelAnimationFrame(raf);
  }, [load]);

  useEffect(() => {
    setSlow(false);
    if (load.phase !== 'loading') return;
    const timer = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(timer);
  }, [load.phase, trackId]);

  const chooseTrack = (id: string) => {
    startedAt.current = performance.now();
    setTrackId(id);
  };

  const toggleTimestamps = (on: boolean) => {
    setTimestamps(on);
    void chrome.storage.local.set({ [TIMESTAMPS_KEY]: on });
  };

  const track = video?.tracks.find((tr) => tr.id === trackId);
  const ready = load.phase === 'ready' ? load : null;

  const copy = async () => {
    if (!ready) return;
    await copyText(transcriptToText(ready.transcript.segments, timestamps));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    if (!ready || !video || !track) return;
    const meta = { title: video.title, videoId: video.videoId, trackLabel: track.label };
    saveFile(transcriptFilename(meta), transcriptFile(ready.transcript.segments, timestamps, meta));
  };

  return (
    <section className="panel" aria-label="Transcript">
      <header className="head">
        <div className="titles">
          <h2>Transcript</h2>
          {video && <p className="sub" title={video.title}>{video.title}</p>}
        </div>
        <button className="icon" onClick={onClose} aria-label="Close transcript" title="Close (Alt+T)">
          ×
        </button>
      </header>

      {video && track && (
        <div className="controls">
          <div>
            <label className="label" htmlFor="track">
              Captions
            </label>
            <select id="track" value={track.id} onChange={(e) => chooseTrack(e.target.value)} disabled={load.phase === 'loading'}>
            {(['manual', 'asr'] as const).map((kind) => {
              const group = video.tracks.filter((tr) => tr.kind === kind);
              if (!group.length) return null;
              return (
                <optgroup key={kind} label={kind === 'manual' ? 'Captions' : 'Auto-generated'}>
                  {group.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
            </select>
          </div>
          <div className="inline">
            <div>
              <span className="label" id="ts-label" title="Applies to Copy and Download">
                Include timestamps
              </span>
              <div className="seg" role="group" aria-labelledby="ts-label">
                <button aria-pressed={timestamps} onClick={() => toggleTimestamps(true)}>
                  On
                </button>
                <button aria-pressed={!timestamps} onClick={() => toggleTimestamps(false)}>
                  Off
                </button>
              </div>
            </div>
            <div className="actions">
              <button className="btn primary" onClick={() => void copy()} disabled={!ready}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn" onClick={download} disabled={!ready}>
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {load.phase === 'loading' && (
        <div className="status" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            {load.step}
            {slow && (
              <p className="detail">
                Waiting for the player. If an ad is playing or the video hasn't started yet, captions load once the video itself plays.
              </p>
            )}
          </div>
        </div>
      )}

      {load.phase === 'error' && (
        <div className={`status error ${load.code === 'NOT_WATCH_PAGE' ? 'neutral' : ''}`} role="alert">
          <p>{messageFor(load.code)}</p>
          {load.detail && <p className="detail">{load.detail}</p>}
        </div>
      )}

      {ready?.transcript.source === 'panel' && (
        <p className="note">
          The caption track couldn’t be fetched, so this was read from YouTube’s transcript panel
          {ready.transcript.panelLanguage ? ` (${ready.transcript.panelLanguage})` : ''}. It may be in a different
          language than the track selected above.
        </p>
      )}

      {ready && video && <TranscriptView video={video} transcript={ready.transcript} />}

      {ready && (
        <footer className="foot">
          {ready.transcript.segments.length} lines
          {ready.transcript.source === 'panel' && ' · from YouTube’s transcript panel'}
          {renderMs !== null && ` · ${ready.fromCache ? 'from cache in' : 'loaded in'} ${renderMs} ms`}
        </footer>
      )}
    </section>
  );
}

function TranscriptView({ video, transcript }: { video: VideoInfo; transcript: Transcript }) {
  const segs = transcript.segments;
  const long = video.lengthSec >= 3600;
  const last = segs[segs.length - 1]!;
  const endMs = last.startMs + last.durMs;
  const lengthMs = video.lengthSec * 1000;
  // Captions often stop before end credits; only flag a large gap.
  const endsEarly = lengthMs > 0 && endMs < lengthMs - Math.max(60_000, lengthMs * 0.1);

  return (
    <>
      {endsEarly && (
        <p className="note">
          Captions end at {formatTimestamp(endMs, long)}; the video is {formatTimestamp(lengthMs, long)} long. This is
          everything YouTube provides for this track.
        </p>
      )}
      <ol className="list">
        {segs.map((s, i) => (
          <li key={i} className="row">
            <button className="ts" onClick={() => void seekTo(s.startMs / 1000)} title="Jump to this point">
              {formatTimestamp(s.startMs, long)}
            </button>
            <span className="text">{s.text}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API can refuse if the page lost focus; the legacy path works from a click.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
