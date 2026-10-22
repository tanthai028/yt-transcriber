import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeMiss, detectVideo, parseVideoUrl } from '../src/extractor/video-id.ts';

const ID = 'jNQXAC9IVRw';

describe('parseVideoUrl', () => {
  const cases: [string, string | null, string | null][] = [
    [`https://www.youtube.com/watch?v=${ID}`, ID, 'watch'],
    [`https://m.youtube.com/watch?v=${ID}`, ID, 'watch'],
    [`https://youtube.com/watch?v=${ID}`, ID, 'watch'],
    [`https://www.youtube.com/watch?v=${ID}&t=42s`, ID, 'watch'],
    [`https://m.youtube.com/watch?list=PLx&v=${ID}&index=3&si=abc`, ID, 'watch'],
    [`https://www.youtube.com/shorts/RmKRlhsH1UE`, 'RmKRlhsH1UE', 'shorts'],
    [`https://m.youtube.com/shorts/RmKRlhsH1UE?si=xyz`, 'RmKRlhsH1UE', 'shorts'],
    [`https://youtu.be/${ID}`, ID, 'youtu.be'],
    [`https://youtu.be/${ID}?t=5&si=abc`, ID, 'youtu.be'],
    [`https://www.youtube.com/live/${ID}?feature=share`, ID, 'live'],
    [`https://www.youtube.com/embed/${ID}?start=10`, ID, 'embed'],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID, 'embed'],
    [`https://www.youtube.com/v/${ID}`, ID, 'embed'],
  ];
  for (const [url, id, kind] of cases) {
    it(url, () => {
      const p = parseVideoUrl(url);
      assert.equal(p.videoId, id);
      assert.equal(p.kind, kind);
    });
  }

  it('rejects non-video pages and bad IDs', () => {
    assert.equal(parseVideoUrl('https://www.youtube.com/').videoId, null);
    assert.equal(parseVideoUrl('https://m.youtube.com/results?search_query=x').videoId, null);
    assert.equal(parseVideoUrl('https://www.youtube.com/shorts').videoId, null);
    assert.equal(parseVideoUrl('https://www.youtube.com/watch?v=short').videoId, null);
    assert.equal(parseVideoUrl(`https://evil.example/watch?v=${ID}`).videoId, null);
    assert.equal(parseVideoUrl(`https://notyoutube.com/watch?v=${ID}`).videoId, null);
    assert.equal(parseVideoUrl('not a url').videoId, null);
  });

  it('reports where it looked', () => {
    assert.equal(parseVideoUrl('https://m.youtube.com/results?search_query=x').where, 'm.youtube.com/results');
  });
});

describe('detectVideo', () => {
  it('prefers the URL', () => {
    assert.deepEqual(detectVideo({ href: `https://m.youtube.com/watch?v=${ID}`, canonical: 'https://www.youtube.com/watch?v=AAAAAAAAAAA' }), {
      videoId: ID,
      kind: 'watch',
      source: 'url',
      where: 'm.youtube.com/watch',
    });
  });

  it('falls back to the canonical link, then og:url, then the player', () => {
    const href = 'https://m.youtube.com/';
    assert.equal(detectVideo({ href, canonical: `https://www.youtube.com/watch?v=${ID}` }).source, 'canonical');
    assert.equal(detectVideo({ href, canonical: 'https://www.youtube.com/', ogUrl: `https://www.youtube.com/shorts/${ID}` }).source, 'og:url');
    const fromPlayer = detectVideo({ href, canonical: 'https://www.youtube.com/', playerVideoId: ID });
    assert.equal(fromPlayer.source, 'player');
    assert.equal(fromPlayer.videoId, ID);
  });

  it('explains a miss', () => {
    const miss = detectVideo({ href: 'https://m.youtube.com/feed/subscriptions', canonical: 'https://www.youtube.com/feed/subscriptions' });
    assert.equal(miss.videoId, null);
    assert.match(describeMiss(miss), /^m\.youtube\.com\/feed\/subscriptions: not a video page/);
    assert.match(describeMiss(detectVideo({ href: 'https://www.youtube.com/watch?v=bad' })), /a watch URL without a valid video ID/);
  });
});
