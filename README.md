# yt-transcriber

A Chrome extension that shows the transcript of the YouTube video you're watching, with clickable
timestamps, using only YouTube's own captions. No backend, no API keys, nothing that costs money.
Personal use; not published to the Chrome Web Store.

> Status: **v0.1, minimal version.** Detects the video, loads the default caption track, and renders
> it with timestamps that seek the video. Coming next: "Show transcript" panel fallback, track
> switching, copy/download, caching.

## Build and load

Requires Node 24+ (tests use Node's built-in TypeScript support).

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select the `dist` folder.
3. **Reload any YouTube tabs that were already open.** Scripts are only injected into pages loaded after install.
4. On a video page, click the extension's toolbar icon (pin it from the puzzle-piece menu) or press **Alt+T**.

After changing code: `npm run build`, click the reload icon on the extension's card in
`chrome://extensions`, then reload the YouTube tab. `npm run watch` rebuilds on save.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Bundle to `dist/` with esbuild |
| `npm run watch` | Rebuild on change (unminified) |
| `npm test` | Parser unit tests against saved YouTube responses (`node --test`) |
| `npm run typecheck` | `tsc --noEmit` |

## How it gets captions (October 2026)

YouTube's caption URLs (`/api/timedtext`, marked `exp=xpe`) now return an **empty body** unless the
request carries a proof-of-origin token (`pot`) minted by the player. The extension never mints
tokens. A tiny page script watches the caption requests the player itself makes, keeps the URL
with its token, and fetches the chosen track by adding the player's parameters to that track's
own signed URL. If the player hasn't loaded captions yet, the extension toggles CC through the
player's API to make it do so, then restores your CC setting.

All of this lives in [`src/extractor/`](src/extractor/). When YouTube changes, that is the
folder to fix.

## Permissions

- `https://www.youtube.com/*`: run on YouTube and fetch captions from it.
- `storage`: transcript cache (coming in the next step).

No other network access: every request goes to `www.youtube.com`.
