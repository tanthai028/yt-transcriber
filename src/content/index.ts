// Content script (isolated world). Draws nothing on YouTube: it relays requests from the popup
// to the extraction module, which talks to the player through page-bridge.

import { TranscriptError, getTranscript, getVideoInfo, seekTo, watchVideoId } from '../extractor/index.ts';
import { RPC_TYPE, type RpcMessage, type RpcReply, type RpcRequest } from '../rpc.ts';

async function handle(req: RpcRequest): Promise<unknown> {
  switch (req.method) {
    case 'page':
      return { videoId: watchVideoId(location.href), dark: document.documentElement.hasAttribute('dark') };
    case 'getVideoInfo':
      return getVideoInfo(req.videoId);
    case 'getTranscript':
      return getTranscript(req.video, req.track);
    case 'seek':
      return seekTo(req.seconds);
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse: (r: RpcReply) => void) => {
  if ((msg as RpcMessage)?.type !== RPC_TYPE) return false;
  handle((msg as RpcMessage).req).then(
    (data) => sendResponse({ ok: true, data }),
    (e) =>
      sendResponse(
        e instanceof TranscriptError
          ? { ok: false, code: e.code, detail: e.detail }
          : { ok: false, code: 'PAGE_CHANGED', detail: e instanceof Error ? e.message : String(e) },
      ),
  );
  return true; // reply asynchronously
});
