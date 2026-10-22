# Manual test checklist

Run after any change to `src/extractor/` and before trusting a new build. Takes about 15 minutes.

**Setup:** `npm run build`, reload the extension on `chrome://extensions`, then open a **new** YouTube tab.
To see each load's timings, right-click the popup → Inspect, and filter the Console by `[yt-transcriber]`.

For each case, write the date and pass/fail. Pick fresh videos when one listed here stops fitting the case
(captions get added or removed over time).

## Core cases

| # | Case | Example | Steps | Expected | Result |
|---|---|---|---|---|---|
| 1 | **Short video** | `jNQXAC9IVRw` (Me at the zoo, 19 s) | Open video, press Alt+T | Popup opens directly under the icon with a spinner immediately; 6 lines, English, in well under 2 s | |
| 2 | **Long video (1 hour+)** | Any lecture or podcast over 1 h with captions | Open, press Alt+T, scroll to the end quickly | Loads in under 2 s; timestamps show `h:mm:ss`; scrolling is smooth; last line is near the video's end | |
| 3 | **Manual captions** | `jNQXAC9IVRw` | Open the Captions dropdown | Tracks listed under "Captions"; default is the manual track in your browser language | |
| 4 | **Auto-generated only** | `XmOtb60B7U4` (35 s ad) | Open the popup | Track shows "English (auto-generated)" under "Auto-generated"; text has no stray line breaks | |
| 5 | **Non-English** | `jNQXAC9IVRw` → choose German | Switch the track | German text, umlauts intact ("Rüssel"); footer timing is for the switch only | |
| 6 | **No captions** | A video with no CC button | Open the popup | "No captions available for this video…" and no transcript | |
| 7 | **Live stream** | Any live webcam stream | Open the popup | Live-stream message, not "no captions" | |
| 8 | **Switching videos without reload** | Click a video in the sidebar, open the popup; repeat three times | Watch the popup | Each time it shows the new video's title and transcript; never the previous video's text | |

## Features

| # | Case | Steps | Expected | Result |
|---|---|---|---|---|
| 9 | Seek | Click a timestamp mid-list | Video jumps there; popup stays open | |
| 9b | Search | Type a word that appears several times; press Enter, Shift+Enter | Matches highlighted, "1 / N" counter, list scrolls to each match; "No matches" for a missing word | |
| 10 | Copy, timestamps on | Include timestamps: On → Copy → paste in a text editor | One line per caption, `[m:ss] text` | |
| 11 | Copy, timestamps off | Include timestamps: Off → Copy → paste | Plain text, one caption per line, identical words | |
| 12 | Download | Download | `Title [videoId].txt` with title, link and track header, then the transcript | |
| 13 | Setting persists | Turn timestamps Off, reload tab, reopen panel | Still Off | |
| 14 | Cache | Open the popup on a video, close it, reopen | Footer says "from cache" | |
| 15 | CC state preserved | With CC **off** in the player, open the panel | Transcript loads; CC stays off afterwards. Repeat with CC on | |
| 16 | Not a watch page | Open the popup on the YouTube home page, and on a non-YouTube site | "Open a YouTube video to see its transcript." | |
| 16b | Tab opened before install | Reload the extension, then open the popup on an already-open YouTube tab without reloading it | "Reload this YouTube tab…" | |
| 17 | Theme | Toggle YouTube between light and dark, reopen the popup | Popup follows | |

## Error cases

| # | Case | Steps | Expected | Result |
|---|---|---|---|---|
| 18 | Ad before the video | Open a video that starts with an ad, open the popup during the ad | After 2.5 s: "Waiting for the player…"; once the video starts, reopening the popup shows the transcript | |
| 19 | Age-restricted | Signed out, open an age-restricted video | Age-restricted message | |
| 20 | Private / removed | Open a private or deleted video URL | "This video is private." / "unavailable" | |
| 21 | Network failure | DevTools → Network → Offline, choose an uncached track | Network error message, no partial transcript | |
| 22 | Fallback (**unverified**) | Temporarily make the caption path fail, e.g. block `*api/timedtext*` in DevTools → Network request blocking | Transcript read from the panel, with the note "read from YouTube's transcript panel" | |

## Performance spot-check

For cases 1, 2 and 5 note the console line `… lines in N ms` (first load, not cached). The target is
under 2000 ms from opening the panel to the rendered transcript.

| Video | Length | Lines | First load (ms) | Cached (ms) |
|---|---|---|---|---|
| | | | | |

## Bookmarklet (website build)

Deploy first (`npx vercel --prod`), then open the install page.

| # | Case | Steps | Expected | Result |
|---|---|---|---|---|
| B1 | Install on iPad | Follow the install page's steps in Safari | Bookmark address starts with `javascript:` | |
| B2 | Open on iPad | youtube.com video in Safari → tap the bookmark | Panel at top right with the transcript | |
| B3 | Late start | Let a video play, turn CC on, then tap the bookmark | Transcript loads (token recovered via CC toggle or translation) | |
| B4 | Ended video | Let a short video finish, then tap the bookmark | Transcript loads | |
| B5 | Toggle | Tap the bookmark twice | Panel hides, then shows and reloads | |
| B6 | In-app navigation | With the panel open, tap a related video | Panel reloads for the new video | |
| B7 | Search, seek, switch track, copy, download | As in cases 9–12 | Same results as the extension | |
| B8 | Not YouTube | Tap the bookmark on another site | Alert naming the page ("…this page is example.com") | |
| B9 | iPhone, mobile site | Regular video on `m.youtube.com`, not yet played → tap the bookmark from the Bookmarks list | Transcript loads | |
| B10 | iPhone, Short | Open a Short in Safari → tap the bookmark | Transcript loads; timestamps seek the Short | |
| B11 | iPhone, youtu.be | Open a `youtu.be/…` link in Safari → tap the bookmark | Transcript loads | |
| B12 | iPhone, timestamp link | Open a link with `&t=90s` → tap the bookmark | Transcript loads (the `t` is ignored) | |
| B13 | iPhone, desktop site | aA → Request Desktop Website → tap the bookmark | Transcript loads | |
| B14 | Address bar | Start the bookmark by typing its name in the address bar | Safari's "Cannot Run Script" (expected; use the Bookmarks list) | |
| B15 | Not a video | Tap the bookmark on the home page | "Open a YouTube video…" with a grey line naming the page | |
