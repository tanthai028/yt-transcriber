// Lives inside the panel's shadow root, so none of this leaks into YouTube (or vice versa).
export const css = `
:host { all: initial; }
.panel {
  --bg: #ffffff; --fg: #0f0f0f; --muted: #606060; --line: #e5e5e5; --hover: #f2f2f2;
  --accent: #065fd4; --err-bg: #fdecea; --err-fg: #8a1c12; --note-bg: #fff6e0;
  position: fixed; top: 64px; right: 16px; z-index: 2200;
  width: 400px; max-width: calc(100vw - 32px); height: calc(100vh - 80px);
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0,0,0,.18);
  font: 14px/1.45 Roboto, Arial, sans-serif;
  overflow: hidden;
}
.dark > .panel {
  --bg: #212121; --fg: #f1f1f1; --muted: #aaaaaa; --line: #3a3a3a; --hover: #2f2f2f;
  --accent: #3ea6ff; --err-bg: #3b1d1a; --err-fg: #ffb4a9; --note-bg: #3a3220;
}
.head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px 16px; border-bottom: 1px solid var(--line); }
.titles { flex: 1; min-width: 0; }
h2 { margin: 0; font-size: 16px; font-weight: 500; }
.sub { margin: 2px 0 0; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.icon { width: 32px; height: 32px; border-radius: 50%; font-size: 22px; line-height: 1; }
.icon:hover { background: var(--hover); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.status { padding: 20px 16px; color: var(--muted); display: flex; gap: 10px; align-items: center; }
.status.error { display: block; margin: 12px; padding: 12px 14px; border-radius: 8px; background: var(--err-bg); color: var(--err-fg); }
.status.error.neutral { background: var(--hover); color: var(--fg); }
.status.error p { margin: 0; }
.status .detail { margin-top: 6px; font-size: 12px; opacity: .85; }
.spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
.note { margin: 10px 12px 0; padding: 8px 12px; border-radius: 8px; background: var(--note-bg); font-size: 12px; }
.list { list-style: none; margin: 0; padding: 6px 0; overflow-y: auto; flex: 1; overscroll-behavior: contain; }
.row {
  display: flex; gap: 12px; padding: 4px 16px 4px 8px; align-items: baseline;
  /* Browser-native list virtualization: off-screen rows skip layout and paint. */
  content-visibility: auto; contain-intrinsic-size: auto 28px;
}
.row:hover { background: var(--hover); }
.ts { flex: none; min-width: 52px; padding: 2px 6px; border-radius: 4px; color: var(--accent); font-variant-numeric: tabular-nums; text-align: right; }
.ts:hover { background: var(--line); }
.text { flex: 1; user-select: text; }
.foot { padding: 8px 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
`;
