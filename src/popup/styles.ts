// Styles for the popup page. Chrome draws the popup frame under the toolbar icon; this fills it.
export const css = `
:root {
  --bg: #ffffff; --fg: #1f1f1f; --muted: #5f6368; --line: #dadce0; --hover: #f1f3f4; --field: #ffffff;
  --accent: #1a7486; --accent-fg: #ffffff; --link: #1a7486;
  --err-bg: #fce8e6; --err-fg: #a50e0e; --note-bg: #fef7e0;
}
:root.dark {
  --bg: #202124; --fg: #e8eaed; --muted: #9aa0a6; --line: #3c4043; --hover: #2d2f31; --field: #2a2b2e;
  --accent: #2f7f91; --accent-fg: #ffffff; --link: #5fb6c8;
  --err-bg: #3c1f1c; --err-fg: #f6aea9; --note-bg: #3a3322;
  color-scheme: dark;
}
html, body { margin: 0; background: var(--bg); }
.panel {
  /* Height is the most Chrome allows (popups are capped at 800x600). */
  width: 342px; height: 600px;
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--fg);
  font: 13px/1.45 "Google Sans", Roboto, Arial, sans-serif;
}
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
button:focus-visible, select:focus-visible { outline: 2px solid var(--link); outline-offset: 1px; }

.head { display: flex; align-items: flex-start; gap: 8px; padding: 14px 10px 6px 16px; }
.titles { flex: 1; min-width: 0; }
h2 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: .1px; }
.sub { margin: 2px 0 0; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon { flex: none; width: 28px; height: 28px; border-radius: 50%; font-size: 20px; line-height: 1; color: var(--muted); }
.icon:hover { background: var(--hover); color: var(--fg); }

.controls { padding: 4px 16px 12px; display: grid; gap: 10px; border-bottom: 1px solid var(--line); }
.label { display: block; margin: 0 0 4px; font-size: 13px; font-weight: 600; }
.controls select {
  width: 100%; height: 30px; padding: 0 8px; border-radius: 6px;
  border: 1px solid var(--line); background: var(--field); color: var(--fg); font: inherit;
}
.inline { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }

/* Segmented control, as in DocsAfterDark: joined buttons, the selected one filled. */
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { padding: 4px 12px; font-size: 13px; color: var(--fg); }
.seg button + button { border-left: 1px solid var(--line); }
.seg button:hover:not([aria-pressed="true"]) { background: var(--hover); }
.seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }

.actions { display: flex; gap: 6px; }
.btn { height: 30px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--line); font-size: 13px; font-weight: 500; }
.btn:hover:not(:disabled) { background: var(--hover); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.primary:hover:not(:disabled) { filter: brightness(1.1); background: var(--accent); }
.btn:disabled, select:disabled { opacity: .5; cursor: default; }

.status { padding: 18px 16px; color: var(--muted); display: flex; gap: 10px; align-items: flex-start; }
.status.error { display: block; margin: 12px; padding: 12px 14px; border-radius: 8px; background: var(--err-bg); color: var(--err-fg); }
.status.error.neutral { background: var(--hover); color: var(--fg); }
.status.error p { margin: 0; }
.status .detail { margin: 6px 0 0; font-size: 12px; opacity: .85; }
.spinner { width: 14px; height: 14px; margin-top: 2px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--link); animation: spin .8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.note { margin: 10px 12px 0; padding: 8px 12px; border-radius: 8px; background: var(--note-bg); font-size: 12px; }

.search { display: flex; align-items: center; gap: 4px; padding: 8px 10px 8px 16px; border-bottom: 1px solid var(--line); }
.search input {
  flex: 1; min-width: 0; height: 28px; padding: 0 8px; border-radius: 6px;
  border: 1px solid var(--line); background: var(--field); color: var(--fg); font: inherit;
}
.search input:focus { outline: 2px solid var(--link); outline-offset: -1px; }
.count { min-width: 64px; text-align: right; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.icon.small { width: 26px; height: 26px; font-size: 14px; border-radius: 6px; }
.icon:disabled { opacity: .4; cursor: default; background: none; }
mark { background: #fde293; color: #202124; border-radius: 2px; padding: 0 1px; }
html.dark mark { background: #8a6d1a; color: #fff; }
.row.current { background: var(--hover); box-shadow: inset 3px 0 0 var(--link); }
.row.current mark { background: #f9ab00; color: #202124; }
.list { list-style: none; margin: 0; padding: 6px 0; overflow-y: auto; flex: 1; min-height: 0; overscroll-behavior: contain; }
.row {
  display: flex; gap: 10px; padding: 3px 14px 3px 6px; align-items: baseline;
  /* Browser-native list virtualization: off-screen rows skip layout and paint. */
  content-visibility: auto; contain-intrinsic-size: auto 26px;
}
.row:hover { background: var(--hover); }
.ts { flex: none; min-width: 50px; padding: 2px 6px; border-radius: 4px; color: var(--link); font-variant-numeric: tabular-nums; text-align: right; }
.ts:hover { background: var(--line); }
.text { flex: 1; user-select: text; }
.foot { padding: 8px 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
`;
