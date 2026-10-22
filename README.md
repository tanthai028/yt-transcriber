# yt-transcriber

Shows the transcript of the YouTube video you're watching, with clickable timestamps, using only
YouTube's own captions. No backend, no API keys, nothing that costs money. Two ways to use it:

- **Chrome extension**: a popup under the toolbar icon.
- **Bookmarklet** (iPad Safari, or any browser): a panel on the YouTube page, installed from a static
  site you host on Vercel. See [iPad and other browsers](#ipad-and-other-browsers-bookmarklet).

**v0.4**: transcript with seekable timestamps, search, caption track picker, copy and TXT download
(with or without timestamps), local cache (extension), and a fallback to YouTube's "Show transcript"
panel (**unverified**, see [Known limitations](#known-limitations)).

## Setup

Requires Chrome 111+ and Node 24+ (the tests use Node's built-in TypeScript support).

```bash
npm install
```
```bash
npm run build
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select the `dist` folder.
3. **Reload any YouTube tabs that were already open.** The extension only attaches to pages loaded after it's installed.
4. Pin the extension from the puzzle-piece menu so its icon sits in the toolbar.

**Updating after a code change:** `npm run build`, click the reload arrow on the extension's card in
`chrome://extensions`, then reload the YouTube tab. `npm run watch` rebuilds on every save.

## Usage

On a `youtube.com/watch` page, click the toolbar icon or press **Alt+T**. The transcript opens in a
popup directly under the icon. Like any Chrome extension popup, it closes when you click elsewhere
(including the video); reopen it and the transcript comes back instantly from the cache.

- **Click a timestamp** to jump the video there (the popup stays open).
- **Search** highlights every match and shows "3 / 17"; Enter / Shift+Enter or ↓ / ↑ step through them.
- **Captions**: pick a track. Creator-uploaded tracks are listed under "Captions", YouTube's speech
  recognition under "Auto-generated". The default is a manual track in your browser language, then an
  auto-generated one in your language, then any manual track.
- **Include timestamps On / Off**: applies to both Copy and Download, and is remembered.
- **Copy** puts one caption per line on the clipboard. **Download** saves `Title [videoId].txt` with
  the title, link and track name at the top.
- The footer shows the line count and how long the load took ("from cache" when cached). Each load
  also logs a timing breakdown to the popup's console (right-click the popup → Inspect), prefixed
`[yt-transcriber]`.

## iPad and other browsers (bookmarklet)

The `dist-web/` build is a static site: an install page plus `bookmarklet.js`. The bookmarklet you save
is a few hundred characters long. When you tap it on a YouTube video, it downloads the latest
`bookmarklet.js` from your site and runs it inside the YouTube page. That page-side code is the same
as the extension's, so it reaches the player the same way. Captions still come only from YouTube, and
nothing is sent to your site except the request for the script.

### Deploy to Vercel (free Hobby plan)

```bash
npx vercel login
```
```bash
npx vercel --prod
```

`vercel.json` already sets the build (`npm run build`), the output folder (`dist-web`), and the CORS
header that lets the YouTube page download `bookmarklet.js`. The first deploy asks for a project name:
`yt-transcriber` gives `yt-transcriber.vercel.app` if that name is free. Run `npx vercel --prod` again
after changes; bookmarklets pick up the new code automatically.

### Install on iPad

Open your site in Safari and follow its steps: **Copy bookmarklet**, bookmark the page, then edit that
bookmark and replace its address with the copied code. To use it, open a video on youtube.com in
Safari (not the YouTube app) and tap the bookmark. Tap it again to hide or show the panel.

On a computer, drag **YT Transcript** from the install page to the bookmarks bar.

## How it works

YouTube's caption URLs (`/api/timedtext`, marked `exp=xpe`) return an **empty response** unless the
request carries a proof-of-origin token (`pot`) minted inside YouTube's player. This changed in 2026
and broke most older tutorials and libraries. The extension never creates tokens. Instead:

1. A small script runs in the page from the very start and watches the caption requests the
   player itself makes, remembering each one (with its token) per video.
2. To fetch a track, it takes that track's own signed URL from the player and adds the extra
   parameters from the player's request. Verified for manual and auto-generated tracks.
3. If the player hasn't loaded captions yet, the extension switches CC on through the player's own
   API, waits for the request, then puts your CC setting back. If the video hasn't started or an ad
   is playing, it waits for the video itself.
4. If YouTube still returns nothing, it opens YouTube's "Show transcript" panel and reads that instead.

The extension never invents or alters text. Line breaks inside a caption are joined with a space, and
that is the only change. If a response is empty, cut off or unreadable, you get an error, never a
partial transcript. If captions end well before the video does, the panel says so.

Observed during development on live YouTube (not a formal benchmark): a 19-second video in 40–210 ms,
a 23-minute auto-generated transcript (817 lines) in 90 ms, a 47-minute video (783 lines) from cache in
41 ms, and about 350 ms right after a fresh video load, including token capture.

## Project layout

```
manifest.json               MV3 manifest
build.mjs                   esbuild: extension → dist/, bookmarklet + install page → dist-web/
vercel.json                 static hosting config for dist-web/ (CORS header for bookmarklet.js)
web/index.html              bookmarklet install page
src/extractor/              ALL YouTube-specific logic; when YouTube changes, fix it here
  index.ts                  public interface used by the UI: getVideoInfo, getTranscript, seekTo
  player.ts                 runs inside the page: reads the player, observes caption requests, fetches
  page-bridge.ts            extension only: exposes player.ts to the content script via postMessage
  parsers.ts                pure: player response → tracks; json3/XML → lines; URL building
  panel-fallback.ts         opens and reads the "Show transcript" panel
  panel-parsers.ts          pure: panel JSON / panel rows → lines
  protocol.ts, errors.ts, types.ts
src/bookmarklet/index.ts    bookmarklet: the transcript panel on the YouTube page (plain DOM, no React)
src/content/index.ts        content script: relays popup requests to the extractor (draws nothing on YouTube)
src/popup/                  the popup UI (React): App.tsx, styles.ts, rpc.ts (talks to the tab)
src/rpc.ts                  popup ↔ content script message types
src/cache.ts                chrome.storage.local cache
src/format.ts, search.ts    timestamps, TXT export, transcript search
test/                       unit tests; test/fixtures/ holds real YouTube responses
docs/manual-test-checklist.md
scripts/capture-transcript-panel.js   dev helper for checking the panel fallback
```

| Command | What it does |
|---|---|
| `npm run build` | Build the extension (`dist/`) and the website (`dist-web/`) |
| `npm run watch` | Rebuild on change (unminified, with source maps) |
| `npm test` | Unit tests: parsers against saved YouTube responses, cache, export formatting |
| `npm run typecheck` | `tsc --noEmit` |

Before trusting a new build, run [docs/manual-test-checklist.md](docs/manual-test-checklist.md).

## Permissions and privacy

- `https://www.youtube.com/*`: run on YouTube and request captions from it.
- `storage`: the transcript cache and your timestamp setting.

Every network request goes to `www.youtube.com`, made the same way the page itself makes it. The
bookmarklet also downloads its own code from your Vercel site. Nothing else is sent anywhere, and all
data stays in your browser. The cache holds up to 8 MB; when it's full,
the transcript you opened least recently is removed first, and entries expire after 30 days.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Reload this YouTube tab…" | The tab was opened before the extension was installed or reloaded. Reload it. |
| Alt+T does nothing | Another extension may use it; change it at `chrome://extensions/shortcuts`. |
| "Waiting for the player…" | An ad is playing or the video hasn't started. Let the video play, then open the popup again. |
| "YouTube returned no caption data… press play once" | The player never loaded captions. Play the video for a second, then reopen the panel. |
| "YouTube returned no caption data" (other) | YouTube blocked the caption request and the panel fallback failed too. Reload the tab and retry; if it persists, YouTube changed something. See below. |
| "YouTube's page structure has changed…" | The player API or markup the extension relies on moved. Fix `src/extractor/` (start with the detail line shown under the message). |
| Transcript looks out of date | Captions were edited after caching. Clear the cache: right-click the popup → Inspect, and in that console run `chrome.storage.local.clear()`. |
| Bookmarklet: nothing happens on iPad | Make sure you're on youtube.com in Safari, not the YouTube app, and that the bookmark's address starts with `javascript:`. Let the video play for a second, then tap it again. |
| Bookmarklet: "could not load" | Your Vercel site is unreachable, or `bookmarklet.js` lacks the CORS header. Open `https://<your-site>/bookmarklet.js` to check it loads. |
| Wrong language | Pick another track in the Captions menu. If the note says it came from the transcript panel, the panel uses its own language choice. |

**When YouTube changes:** check the page console for `[yt-transcriber]` lines, then work in
`src/extractor/`. The pure parsers have fixture tests. Save a new real response in `test/fixtures/`
and add a test before changing a parser.

## Known limitations

- **Panel fallback unverified.** It was written against known structures of YouTube's transcript
  panel and its `get_transcript` response, but hasn't been checked against the live panel (October 2026).
  Its JSON test uses a hand-written sample. To verify, run
  [scripts/capture-transcript-panel.js](scripts/capture-transcript-panel.js) on a video page and update
  the selectors and fixture. A panel transcript may be in a different language than the selected track,
  and it isn't cached.
- **Briefly toggles CC.** When the player hasn't loaded captions for a video yet, the extension turns
  CC on and back off, which can flash captions for a moment.
- **Captions only.** Videos without captions (or with captions disabled by the creator; YouTube reports
  both the same way) have no transcript. Audio transcription is out of scope for v1.
- **Live streams and premieres** aren't supported until they've ended and been processed.
- **Watch pages only**: not Shorts or embeds. The extension runs on `www.youtube.com` only; the
  bookmarklet also accepts `m.youtube.com`, but it was only tested on the desktop site.
- **Bookmarklet on iPad is untested.** I tested it on desktop Chrome against live YouTube. Whether
  iPad Safari runs bookmarklets on YouTube, given its security policy, needs a check on a real iPad.
  The bookmarklet has no cache and no Alt+T shortcut, and if YouTube ever restricts which Trusted Types
  policies pages may create, the loader will stop working.
- **Age-restricted videos** need you to be signed in with an age-verified account.
- **The popup closes when you click outside it.** That's how Chrome extension popups work. Clicking
  timestamps inside it keeps it open; reopening is instant thanks to the cache.
- **Depends on YouTube internals** (player API, request format). A YouTube update can break it; the
  error messages say which part failed.
- **Translations:** YouTube's auto-translate languages aren't offered (the code supports `tlang`, but the
  UI doesn't expose it yet).

## Possible later work

- Audio transcription for videos without captions (e.g. local faster-whisper).
- Auto-translated tracks in the Captions menu.
- Highlighting the current line during playback.
