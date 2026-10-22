import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { TranscriptCache, type KeyValueStore } from '../src/cache.ts';
import { parseJson3 } from '../src/extractor/parsers.ts';
import type { Segment } from '../src/extractor/types.ts';

const asr = parseJson3(readFileSync(new URL('./fixtures/json3-asr-en.json', import.meta.url), 'utf8'));

/** In-memory stand-in for chrome.storage.local (values are JSON round-tripped, as Chrome does). */
class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  async get(keys: string | string[]) {
    const out: Record<string, unknown> = {};
    for (const k of typeof keys === 'string' ? [keys] : keys) if (this.data.has(k)) out[k] = JSON.parse(this.data.get(k)!);
    return out;
  }
  async set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) this.data.set(k, JSON.stringify(v));
  }
  async remove(keys: string | string[]) {
    for (const k of typeof keys === 'string' ? [keys] : keys) this.data.delete(k);
  }
  transcriptKeys() {
    return [...this.data.keys()].filter((k) => k.startsWith('cache:t:')).sort();
  }
}

function setup(maxBytes = 1_000_000, maxAgeMs = 1_000_000) {
  let clock = 1_000;
  const store = new MemoryStore();
  const cache = new TranscriptCache(store, { maxBytes, maxAgeMs, now: () => clock });
  return { store, cache, tick: (ms = 1) => (clock += ms) };
}

const seg = (n: number): Segment[] => [{ startMs: 0, durMs: 1, text: 'x'.repeat(n) }];

describe('TranscriptCache', () => {
  it('round-trips a transcript exactly', async () => {
    const { cache } = setup();
    assert.equal(await cache.get('vid', 'a.en'), null);
    assert.equal(await cache.put('vid', 'a.en', asr), true);
    assert.deepEqual(await cache.get('vid', 'a.en'), asr);
  });

  it('keys by video and track', async () => {
    const { cache } = setup();
    await cache.put('vid', '.en', seg(1));
    await cache.put('vid', '.de', seg(2));
    assert.equal((await cache.get('vid', '.en'))![0]!.text, 'x');
    assert.equal((await cache.get('vid', '.de'))![0]!.text, 'xx');
    assert.equal(await cache.get('other', '.en'), null);
  });

  it('evicts least-recently-used entries to stay under the cap', async () => {
    const { store, cache, tick } = setup(400);
    await cache.put('a', 't', seg(100));
    tick();
    await cache.put('b', 't', seg(100));
    tick();
    await cache.get('a', 't'); // a is now more recent than b
    tick();
    // Each entry is ~137 bytes, so two fit under 400.
    await cache.put('c', 't', seg(100));
    assert.deepEqual(store.transcriptKeys(), ['cache:t:a:t', 'cache:t:c:t'], 'b was least recently used');
    tick();
    await cache.put('d', 't', seg(100));
    assert.deepEqual(store.transcriptKeys(), ['cache:t:c:t', 'cache:t:d:t'], 'then a');
    const { bytes } = await cache.stats();
    assert.ok(bytes <= 400, `total ${bytes} over cap`);
  });

  it('refuses a single transcript larger than the cap and keeps existing entries', async () => {
    const { cache } = setup(300);
    await cache.put('a', 't', seg(10));
    assert.equal(await cache.put('big', 't', seg(1000)), false);
    assert.notEqual(await cache.get('a', 't'), null);
  });

  it('expires old entries', async () => {
    const { store, cache, tick } = setup(1_000_000, 100);
    await cache.put('a', 't', seg(5));
    tick(101);
    assert.equal(await cache.get('a', 't'), null);
    assert.deepEqual(store.transcriptKeys(), []);
  });

  it('drops corrupt entries instead of returning them', async () => {
    const { store, cache } = setup();
    await cache.put('a', 't', seg(5));
    await store.set({ 'cache:t:a:t': { v: 1, savedAt: 1_000, rows: [[0, 'bad']] } });
    assert.equal(await cache.get('a', 't'), null);
    assert.deepEqual((await cache.stats()).entries, 0);
  });

  it('clear removes everything it owns', async () => {
    const { store, cache } = setup();
    await store.set({ unrelated: 1 });
    await cache.put('a', 't', seg(5));
    await cache.clear();
    assert.deepEqual([...store.data.keys()], ['unrelated']);
  });
});
