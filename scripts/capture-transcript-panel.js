// Dev helper: captures the real "Show transcript" panel structure and its network response.
// Usage: open https://www.youtube.com/watch?v=jNQXAC9IVRw in a fresh tab, open DevTools → Console,
// paste this whole file, press Enter. After ~5 s the result is copied to your clipboard.
// It only reads the page; the one action it takes is clicking "Show transcript".
(async () => {
  const seen = [];
  const youtubei = [];
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const res = origFetch.call(this, input, init);
    if (url.includes('/youtubei/')) youtubei.push(url.split('?')[0]);
    if (url.includes('get_transcript')) res.then((r) => r.clone().text()).then((t) => seen.push({ via: 'fetch', url: url.split('?')[0], body: t }));
    return res;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (String(url).includes('/youtubei/')) youtubei.push(String(url).split('?')[0]);
    if (String(url).includes('get_transcript')) this.addEventListener('load', () => seen.push({ via: 'xhr', url: String(url).split('?')[0], body: this.responseText }));
    return origOpen.apply(this, arguments);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('#description-inline-expander #expand, ytd-text-inline-expander #expand')?.click();
  await sleep(500);
  const known = document.querySelector('ytd-video-description-transcript-section-renderer button');
  const button =
    known || [...document.querySelectorAll('button, [role="button"]')].find((b) => /transcript/i.test(`${b.getAttribute('aria-label') || ''} ${b.textContent}`));
  button?.click();
  await sleep(4000);

  const PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const panel = document.querySelector(PANEL);
  const segs = panel ? panel.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model') : [];
  const result = {
    knownButtonSelectorWorked: !!known,
    button: button ? { tag: button.tagName, label: (button.getAttribute('aria-label') || button.textContent.trim()).slice(0, 80), parent: button.parentElement?.closest('*[class]')?.tagName } : null,
    panelFound: !!panel,
    panelVisibility: panel?.getAttribute('visibility'),
    allPanelIds: [...document.querySelectorAll('ytd-engagement-panel-section-list-renderer')].map((p) => p.getAttribute('target-id')),
    transcriptTags: [...new Set([...(panel || document).querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).filter((t) => /transcript|segment/.test(t)))],
    segmentCount: segs.length,
    firstSegmentsHTML: [...segs].slice(0, 2).map((s) => s.outerHTML.replace(/\s+/g, ' ').slice(0, 2500)),
    panelHTMLIfNoSegments: segs.length ? null : panel?.outerHTML.replace(/\s+/g, ' ').slice(0, 4000),
    youtubeiCallsAfterClick: [...new Set(youtubei)],
    getTranscriptResponses: seen.map((s) => ({ via: s.via, url: s.url, bytes: s.body.length, body: s.body.slice(0, 80000) })),
  };
  copy(JSON.stringify(result));
  console.log('yt-transcriber: copied to clipboard', result);
})();
