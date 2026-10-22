import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { TranscriptError } from '../src/extractor/errors.ts';
import {
  buildTemplateUrl,
  buildTrackUrl,
  parseJson3,
  parsePlayerResponse,
  parseXml,
  pickDefaultTrack,
  watchVideoId,
} from '../src/extractor/parsers.ts';
import type { CaptionTrack } from '../src/extractor/types.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));

function throwsCode(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof TranscriptError && e.code === code);
}

describe('parseJson3', () => {
  it('parses a manual track, joining in-caption line breaks', () => {
    const segs = parseJson3(fixture('json3-manual-en.json'));
    assert.equal(segs.length, 6);
    assert.deepEqual(segs[0], { startMs: 1200, durMs: 2160, text: 'All right, so here we are, in front of the elephants' });
    assert.equal(segs[5]!.text, "and that's pretty much all there is to say");
  });

  it('keeps non-English text byte-for-byte', () => {
    const segs = parseJson3(fixture('json3-manual-de.json'));
    assert.equal(segs.length, 4);
    assert.equal(segs[1]!.text, 'Das Coole an den Typen ist dass sie sehr, sehr, sehr, lange Rüssel haben.');
    assert.equal(segs[0]!.startMs, 0);
  });

  it('parses an auto-generated track: joins word segments, drops window and line-break events', () => {
    const segs = parseJson3(fixture('json3-asr-en.json'));
    // 33 events: 1 window definition + 16 "\n" append events + 16 caption lines
    assert.equal(segs.length, 16);
    assert.deepEqual(segs[0], { startMs: 0, durMs: 2480, text: 'Deepest secret.' });
    assert.equal(segs[2]!.text, '>> Wait, that could actually work. I');
    assert.equal(segs[3]!.text, 'have [music] to start this now, right');
    assert.equal(segs.at(-1)!.text, 'Here we go again.');
    assert.ok(segs.every((s) => s.text.trim() === s.text && !s.text.includes('\n')));
  });

  it('every word of the raw response survives parsing', () => {
    const raw = json('json3-asr-en.json') as { events: { segs?: { utf8: string }[] }[] };
    const rawWords = raw.events.flatMap((e) => (e.segs ?? []).map((s) => s.utf8)).join('').split(/\s+/).filter(Boolean);
    const parsedWords = parseJson3(fixture('json3-asr-en.json')).map((s) => s.text).join(' ').split(/\s+/);
    assert.deepEqual(parsedWords, rawWords);
  });

  it('treats an empty body as blocked, not as "no captions"', () => {
    throwsCode(() => parseJson3(''), 'BLOCKED');
    throwsCode(() => parseJson3('  \n'), 'BLOCKED');
  });

  it('rejects truncated JSON instead of returning a partial transcript', () => {
    const full = fixture('json3-manual-en.json');
    throwsCode(() => parseJson3(full.slice(0, Math.floor(full.length / 2))), 'MALFORMED');
  });

  it('rejects JSON without an events array', () => {
    throwsCode(() => parseJson3('{"wireMagic":"pb3"}'), 'MALFORMED');
  });
});

describe('parseXml', () => {
  it('parses and double-decodes entities', () => {
    const segs = parseXml(fixture('xml-manual-en.xml'));
    assert.equal(segs.length, 6);
    assert.deepEqual(segs[3], { startMs: 12616, durMs: 1751, text: "and that's cool" });
  });

  it('matches the json3 parse of the same track', () => {
    assert.deepEqual(parseXml(fixture('xml-manual-en.xml')), parseJson3(fixture('json3-manual-en.json')));
  });

  it('rejects truncated XML', () => {
    const full = fixture('xml-manual-en.xml');
    throwsCode(() => parseXml(full.slice(0, 200)), 'MALFORMED');
    throwsCode(() => parseXml(''), 'BLOCKED');
  });
});

describe('parsePlayerResponse', () => {
  it('lists manual tracks', () => {
    const info = parsePlayerResponse(json('player-response-manual.json'), 'jNQXAC9IVRw');
    assert.equal(info.title, 'Me at the zoo');
    assert.equal(info.lengthSec, 19);
    assert.deepEqual(
      info.tracks.map((t) => [t.id, t.languageCode, t.label, t.kind]),
      [
        ['.en', 'en', 'English', 'manual'],
        ['.de', 'de', 'German', 'manual'],
      ],
    );
  });

  it('lists auto-generated tracks', () => {
    const info = parsePlayerResponse(json('player-response-asr.json'), 'XmOtb60B7U4');
    assert.deepEqual(
      info.tracks.map((t) => [t.id, t.label, t.kind]),
      [['a.en', 'English (auto-generated)', 'asr']],
    );
  });

  it('reports no captions when the tracklist is absent', () => {
    const pr = json('player-response-manual.json');
    delete pr.captions;
    throwsCode(() => parsePlayerResponse(pr, 'jNQXAC9IVRw'), 'NO_CAPTIONS');
  });

  it('refuses a stale response for a different video', () => {
    throwsCode(() => parsePlayerResponse(json('player-response-manual.json'), 'XmOtb60B7U4'), 'PAGE_CHANGED');
  });

  it('reports live and upcoming streams', () => {
    const pr = json('player-response-asr.json');
    pr.videoDetails.isLive = true;
    throwsCode(() => parsePlayerResponse(pr, 'XmOtb60B7U4'), 'LIVE');
    throwsCode(() => parsePlayerResponse({ playabilityStatus: { status: 'LIVE_STREAM_OFFLINE', reason: 'Premieres in 2 hours' } }, 'x'), 'LIVE');
  });

  it('classifies unplayable videos', () => {
    const ps = (status: string, reason?: string) => ({ playabilityStatus: { status, reason } });
    throwsCode(() => parsePlayerResponse(ps('LOGIN_REQUIRED', 'This video is private'), 'x'), 'PRIVATE');
    throwsCode(() => parsePlayerResponse(ps('LOGIN_REQUIRED', 'Sign in to confirm your age'), 'x'), 'AGE_RESTRICTED');
    throwsCode(() => parsePlayerResponse(ps('AGE_VERIFICATION_REQUIRED'), 'x'), 'AGE_RESTRICTED');
    throwsCode(() => parsePlayerResponse(ps('ERROR', 'Video unavailable'), 'x'), 'UNAVAILABLE');
    throwsCode(() => parsePlayerResponse(ps('UNPLAYABLE', 'This video is not available in your country'), 'x'), 'UNAVAILABLE');
    throwsCode(() => parsePlayerResponse(ps('SOMETHING_NEW'), 'x'), 'UNAVAILABLE');
  });

  it('reports a missing response as a page change', () => {
    throwsCode(() => parsePlayerResponse(undefined, 'x'), 'PAGE_CHANGED');
    throwsCode(() => parsePlayerResponse({ playabilityStatus: { status: 'OK' } }, 'x'), 'PAGE_CHANGED');
  });
});

describe('pickDefaultTrack', () => {
  const t = (id: string, languageCode: string, kind: 'manual' | 'asr'): CaptionTrack => ({ id, languageCode, kind, label: id, baseUrl: '' });
  const tracks = [t('a.en', 'en', 'asr'), t('.de', 'de', 'manual'), t('.en-GB', 'en-GB', 'manual'), t('a.fr', 'fr', 'asr')];

  it('prefers a manual track in the browser language (matching region-less)', () => {
    assert.equal(pickDefaultTrack(tracks, ['en-US', 'en'])?.id, '.en-GB');
  });
  it('then an auto-generated track in the browser language', () => {
    assert.equal(pickDefaultTrack(tracks, ['fr-FR'])?.id, 'a.fr');
  });
  it('then any manual track', () => {
    assert.equal(pickDefaultTrack(tracks, ['ja'])?.id, '.de');
  });
  it('then the first track', () => {
    assert.equal(pickDefaultTrack([t('a.ja', 'ja', 'asr')], ['en'])?.id, 'a.ja');
    assert.equal(pickDefaultTrack([], ['en']), undefined);
  });
});

describe('timedtext URLs', () => {
  const asrBase = json('player-response-asr.json').captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl as string;
  const manualBase = json('player-response-manual.json').captions.playerCaptionsTracklistRenderer.captionTracks[1].baseUrl as string;
  const playerReq =
    'https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw&ei=OTHER&opi=1&exp=xpe&expire=1&sparams=ip&signature=OTHERSIG&key=yt8&lang=en&potc=1&pot=TOKEN&fmt=json3&xorb=2&c=WEB&cver=2.2026&tlang=fr';

  it('buildTrackUrl keeps the track signature and adds the player params', () => {
    const u = new URL(buildTrackUrl(manualBase, playerReq));
    assert.equal(u.searchParams.get('signature'), 'SIG');
    assert.equal(u.searchParams.get('lang'), 'de');
    assert.equal(u.searchParams.get('pot'), 'TOKEN');
    assert.equal(u.searchParams.get('c'), 'WEB');
    assert.equal(u.searchParams.get('fmt'), 'json3');
    assert.equal(u.searchParams.get('tlang'), null, "must not inherit the player's translation");
  });

  it('buildTrackUrl keeps signed ASR params (caps, variant)', () => {
    const u = new URL(buildTrackUrl(asrBase, playerReq));
    assert.equal(u.searchParams.get('caps'), 'asr');
    assert.equal(u.searchParams.get('kind'), 'asr');
    assert.equal(u.searchParams.get('variant'), 'gemini');
  });

  it("resolves the mobile site's relative baseUrls against the player's own host", () => {
    const mobileBase = '/api/timedtext?v=jNQXAC9IVRw&ei=EI&exp=xpe&sparams=ip&signature=SIG&key=yt8&lang=de';
    const mobilePlayer = 'https://m.youtube.com/api/timedtext?v=jNQXAC9IVRw&lang=en&pot=TOKEN&c=MWEB';
    for (const build of [buildTrackUrl, buildTemplateUrl]) {
      const u = new URL(build(mobileBase, mobilePlayer));
      assert.equal(u.host, 'm.youtube.com');
      assert.equal(u.searchParams.get('lang'), 'de');
      assert.equal(u.searchParams.get('pot'), 'TOKEN');
      assert.equal(u.searchParams.get('c'), 'MWEB');
    }
  });

  it('buildTemplateUrl swaps only track params into the player request', () => {
    const u = new URL(buildTemplateUrl(asrBase, playerReq));
    assert.equal(u.searchParams.get('signature'), 'OTHERSIG');
    assert.equal(u.searchParams.get('lang'), 'en');
    assert.equal(u.searchParams.get('kind'), 'asr');
    assert.equal(u.searchParams.get('variant'), 'gemini');
    assert.equal(u.searchParams.get('tlang'), null);
    assert.equal(u.searchParams.get('pot'), 'TOKEN');
  });
});

describe('watchVideoId', () => {
  it('extracts the ID only on video pages', () => {
    assert.equal(watchVideoId('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=5s'), 'jNQXAC9IVRw');
    assert.equal(watchVideoId('https://www.youtube.com/'), null);
    assert.equal(watchVideoId('https://www.youtube.com/shorts/jNQXAC9IVRw'), 'jNQXAC9IVRw');
    assert.equal(watchVideoId('https://www.youtube.com/watch?v=bad'), null);
    assert.equal(watchVideoId('https://evil.example/watch?v=jNQXAC9IVRw'), null);
  });
});
