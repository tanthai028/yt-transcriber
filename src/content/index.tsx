// Content script (isolated world). Mounts the panel in a shadow root and tracks the current video.

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { watchVideoId } from '../extractor/index.ts';
import { App } from './App.tsx';
import { css } from './styles.ts';

const host = document.createElement('div');
host.id = 'yt-transcriber-root';
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = css;
const mount = document.createElement('div');
shadow.append(style, mount);
document.documentElement.append(host);

/** Calls `onChange` whenever YouTube navigates in-app to a different video (or away from one). */
function onVideoChange(onChange: (videoId: string | null) => void): () => void {
  let last = watchVideoId(location.href);
  const check = () => {
    const v = watchVideoId(location.href);
    if (v !== last) {
      last = v;
      onChange(v);
    }
  };
  document.addEventListener('yt-navigate-finish', check);
  window.addEventListener('popstate', check);
  const timer = setInterval(check, 1000); // safety net if YouTube renames its navigation event
  return () => {
    document.removeEventListener('yt-navigate-finish', check);
    window.removeEventListener('popstate', check);
    clearInterval(timer);
  };
}

function Root() {
  const [open, setOpen] = useState(false);
  const [videoId, setVideoId] = useState(() => watchVideoId(location.href));
  const [requestedAt, setRequestedAt] = useState(0);
  const [dark, setDark] = useState(false);

  useEffect(
    () =>
      onVideoChange((v) => {
        setVideoId(v);
        setRequestedAt(performance.now());
      }),
    [],
  );

  useEffect(() => {
    const listener = (msg: unknown) => {
      if ((msg as { type?: string })?.type !== 'toggle-panel') return;
      setOpen((o) => {
        if (!o) {
          setRequestedAt(performance.now());
          setVideoId(watchVideoId(location.href));
          setDark(document.documentElement.hasAttribute('dark'));
        }
        return !o;
      });
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  if (!open) return null;
  return (
    <div className={dark ? 'panel-theme dark' : 'panel-theme'}>
      <App videoId={videoId} requestedAt={requestedAt} onClose={() => setOpen(false)} />
    </div>
  );
}

createRoot(mount).render(<Root />);
