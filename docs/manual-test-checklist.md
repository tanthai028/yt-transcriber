# Manual test checklist

Run after any change to `src/extractor/` and before trusting a new build. Takes about 15 minutes.

**Setup:** `npm run build`, reload the extension on `chrome://extensions`, then open a **new** YouTube tab.
Keep DevTools open on the Console with the filter `[yt-transcriber]` so you can see each load's timings.

For each case, write the date and pass/fail. Pick fresh videos when one listed here stops fitting the case
(captions get added or removed over time).

## Core cases

| # | Case | Example | Steps | Expected | Result |
|---|---|---|---|---|---|
| 1 | **Short video** | `jNQXAC9IVRw` (Me at the zoo, 19 s) | Open video, press Alt+T | Panel opens with a spinner immediately; 6 lines, English, in well under 2 s | |
| 2 | **Long video (1 hour+)** | Any lecture or podcast over 1 h with captions | Open, press Alt+T, scroll to the end quickly | Loads in under 2 s; timestamps show `h:mm:ss`; scrolling is smooth; last line is near the video's end | |
| 3 | **Manual captions** | `jNQXAC9IVRw` | Open the Captions dropdown | Tracks listed under "Captions"; default is the manual track in your browser language | |
| 4 | **Auto-generated only** | `XmOtb60B7U4` (35 s ad) | Open panel | Track shows "English (auto-generated)" under "Auto-generated"; text has no stray line breaks | |
| 5 | **Non-English** | `jNQXAC9IVRw` → choose German | Switch the track | German text, umlauts intact ("Rüssel"); footer timing is for the switch only | |
| 6 | **No captions** | A video with no CC button | Open panel | "No captions available for this video…" and no transcript | |
| 7 | **Live stream** | Any live webcam stream | Open panel | Live-stream message, not "no captions" | |
| 8 | **Switching videos without reload** | Click a video in the sidebar while the panel is open, three times in a row | Watch the panel | Each switch shows the new video's title and transcript; never the previous video's text | |

## Features

| # | Case | Steps | Expected | Result |
|---|---|---|---|---|
| 9 | Seek | Click a timestamp mid-list | Video jumps there | |
| 10 | Copy, timestamps on | Include timestamps: On → Copy → paste in a text editor | One line per caption, `[m:ss] text` | |
| 11 | Copy, timestamps off | Include timestamps: Off → Copy → paste | Plain text, one caption per line, identical words | |
| 12 | Download | Download | `Title [videoId].txt` with title, link and track header, then the transcript | |
| 13 | Setting persists | Turn timestamps Off, reload tab, reopen panel | Still Off | |
| 14 | Cache | Open panel on a video, close, reopen | Footer says "from cache"; console shows `(cache)` | |
| 15 | CC state preserved | With CC **off** in the player, open the panel | Transcript loads; CC stays off afterwards. Repeat with CC on | |
| 16 | Not a watch page | Open panel on the YouTube home page | "Open a YouTube video to see its transcript." | |
| 17 | Theme | Toggle YouTube between light and dark, reopen panel | Panel follows | |

## Error cases

| # | Case | Steps | Expected | Result |
|---|---|---|---|---|
| 18 | Ad before the video | Open a video that starts with an ad, open panel during the ad | After 2.5 s: "Waiting for the player…"; transcript appears once the video starts | |
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
