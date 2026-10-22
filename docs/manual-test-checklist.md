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
