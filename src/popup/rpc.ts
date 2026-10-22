// Popup side of the RPC: sends requests to the content script on the active YouTube tab.

import { TranscriptError } from '../extractor/errors.ts';
import { watchVideoId } from '../extractor/parsers.ts';
import type { TranscriptResult } from '../extractor/index.ts';
import type { CaptionTrack, VideoInfo } from '../extractor/types.ts';
import { RPC_TYPE, type RpcMessage, type RpcReply, type RpcRequest, type RpcResults } from '../rpc.ts';

const activeTab = chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab);

async function rpc<M extends RpcRequest['method']>(req: Extract<RpcRequest, { method: M }>): Promise<RpcResults[M]> {
  const tab = await activeTab;
  // Without the "tabs" permission, Chrome only reveals the URL of tabs we have host access to,
  // so a missing URL means "not YouTube".
  if (tab?.id === undefined || !tab.url || !watchVideoId(tab.url)) throw new TranscriptError('NOT_WATCH_PAGE');
  let reply: RpcReply | undefined;
  try {
    const msg: RpcMessage = { type: RPC_TYPE, req };
    reply = (await chrome.tabs.sendMessage(tab.id, msg)) as RpcReply | undefined;
  } catch {
    // No content script in the tab: it was opened before the extension was installed or reloaded.
    throw new TranscriptError('RELOAD_TAB');
  }
  if (!reply) throw new TranscriptError('RELOAD_TAB');
  if (!reply.ok) throw new TranscriptError(reply.code, reply.detail);
  return reply.data as RpcResults[M];
}

export const getPageInfo = () => rpc({ method: 'page' });
export const getVideoInfo = (videoId: string) => rpc({ method: 'getVideoInfo', videoId });
export const getTranscript = (video: VideoInfo, track: CaptionTrack): Promise<TranscriptResult> =>
  rpc({ method: 'getTranscript', video, track });
export const seekTo = (seconds: number) => rpc({ method: 'seek', seconds });
