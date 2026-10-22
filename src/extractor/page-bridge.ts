// Extension only: runs in the page's MAIN world at document_start (see manifest.json), so the
// network hooks see every caption request the player makes. Answers the content script's requests
// (postMessage) with the player access in player.ts.

import { TranscriptError } from './errors.ts';
import { installHooks, playerApi } from './player.ts';
import { CHANNEL, isEnvelope, type BridgeReply, type BridgeRequest, type Envelope } from './protocol.ts';

installHooks();

async function handle(req: BridgeRequest): Promise<BridgeReply> {
  try {
    switch (req.kind) {
      case 'getPlayerResponse':
        return { ok: true, data: await playerApi.getPlayerResponse(req.videoId) };
      case 'fetchTrack':
        return { ok: true, data: await playerApi.fetchTrack(req.videoId, req.baseUrl) };
      case 'panelTranscript':
        return { ok: true, data: await playerApi.panelTranscript(req.videoId) };
      case 'seek':
        return { ok: true, data: await playerApi.seek(req.seconds) };
    }
  } catch (e) {
    if (e instanceof TranscriptError) return { ok: false, code: e.code, detail: e.detail };
    return { ok: false, code: 'PAGE_CHANGED', detail: e instanceof Error ? e.message : String(e) };
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window || !isEnvelope(e.data, 'req')) return;
  const { id, payload } = e.data;
  void handle(payload as BridgeRequest).then((reply) => {
    const res: Envelope = { channel: CHANNEL, dir: 'res', id, payload: reply };
    window.postMessage(res, location.origin);
  });
});
