// Chrome's extension popup: opens directly under the toolbar icon (click or Alt+T).

import { createRoot } from 'react-dom/client';

import { TranscriptError } from '../extractor/errors.ts';
import { App } from './App.tsx';
import { getPageInfo } from './rpc.ts';
import { css } from './styles.ts';

const requestedAt = performance.now();
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);

const root = createRoot(document.getElementById('root')!);
const close = () => window.close();

getPageInfo().then(
  (page) => {
    // Follow YouTube's theme; fall back to the system theme if the page didn't say.
    document.documentElement.classList.toggle('dark', page.dark);
    const notFound = page.videoId ? undefined : new TranscriptError('NOT_WATCH_PAGE', page.detail);
    root.render(<App videoId={page.videoId} requestedAt={requestedAt} onClose={close} initialError={notFound} />);
  },
  (e) => {
    document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
    const err = e instanceof TranscriptError ? e : new TranscriptError('PAGE_CHANGED', String(e));
    root.render(<App videoId={null} requestedAt={requestedAt} onClose={close} initialError={err} />);
  },
);
