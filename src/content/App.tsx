import { useEffect, useRef, useState } from 'react';

import {
  TranscriptError,
  getTranscript,
  getVideoInfo,
  messageFor,
  pickDefaultTrack,
  seekTo,
  type CaptionTrack,
  type ErrorCode,
  type Transcript,
  type VideoInfo,
} from '../extractor/index.ts';
import { formatTimestamp } from '../format.ts';

type State =
  | { phase: 'loading'; step: string }
  | { phase: 'error'; code: ErrorCode; detail?: string }
  | { phase: 'ready'; video: VideoInfo; track: CaptionTrack; transcript: Transcript; timings: Record<string, number> };

interface Props {
  videoId: string | null;
  /** performance.now() when the user asked for this transcript (open, or navigated while open). */
  requestedAt: number;
  onClose: () => void;
}

const log = (...args: unknown[]) => console.info('[yt-transcriber]', ...args);

export function App({ videoId, requestedAt, onClose }: Props) {
  const [state, setState] = useState<State>({ phase: 'loading', step: 'Starting…' });
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const loadId = useRef(0);

  useEffect(() => {
    setSlow(false);
    if (state.phase !== 'loading') return;
    const timer = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(timer);
  }, [state.phase]);

  useEffect(() => {
    const id = ++loadId.current;
    const current = () => id === loadId.current;
    setRenderMs(null);

    if (!videoId) {
      setState({ phase: 'error', code: 'NOT_WATCH_PAGE' });
      return;
    }

    void (async () => {
      try {
        setState({ phase: 'loading', step: 'Reading caption tracks…' });
        const t = performance.now();
        const video = await getVideoInfo(videoId);
        const tracksMs = Math.round(performance.now() - t);
        if (!current()) return;

        const track = pickDefaultTrack(video.tracks, navigator.languages)!;
        setState({ phase: 'loading', step: `Loading ${track.label} captions…` });
        const { transcript, timings } = await getTranscript(video, track);
        if (!current()) return;
        setState({ phase: 'ready', video, track, transcript, timings: { tracksMs, ...timings } });
      } catch (e) {
        if (!current()) return;
        const err = e instanceof TranscriptError ? e : new TranscriptError('PAGE_CHANGED', String(e));
        log('failed', err.code, err.detail ?? '');
        setState({ phase: 'error', code: err.code, detail: err.detail });
      }
    })();
  }, [videoId, requestedAt]);

  // End-to-end timing: from the user's request to the first paint of the transcript.
  useEffect(() => {
    if (state.phase !== 'ready') return;
    const raf = requestAnimationFrame(() => {
      const total = Math.round(performance.now() - requestedAt);
      setRenderMs(total);
      log(`${state.video.videoId} [${state.track.id}] ${state.transcript.segments.length} lines in ${total} ms`, state.timings);
    });
    return () => cancelAnimationFrame(raf);
  }, [state, requestedAt]);

  return (
    <section className="panel" aria-label="Transcript">
      <header className="head">
        <div className="titles">
          <h2>Transcript</h2>
          {state.phase === 'ready' && <p className="sub">{state.track.label}</p>}
        </div>
        <button className="icon" onClick={onClose} aria-label="Close transcript" title="Close (Alt+T)">
          ×
        </button>
      </header>

      {state.phase === 'loading' && (
        <div className="status" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            {state.step}
            {slow && <p className="detail">Waiting for the player. If an ad is playing or the video hasn't started yet, captions load once the video itself plays.</p>}
          </div>
        </div>
      )}

      {state.phase === 'error' && (
        <div className={`status error ${state.code === 'NOT_WATCH_PAGE' ? 'neutral' : ''}`} role="alert">
          <p>{messageFor(state.code)}</p>
          {state.detail && <p className="detail">{state.detail}</p>}
        </div>
      )}

      {state.phase === 'ready' && <TranscriptView video={state.video} transcript={state.transcript} />}

      {state.phase === 'ready' && (
        <footer className="foot">
          {state.transcript.segments.length} lines
          {renderMs !== null && ` · loaded in ${renderMs} ms`}
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
