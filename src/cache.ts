// Transcript cache in chrome.storage.local, keyed by video + track.
// A small index tracks each entry's size and last use, so eviction never has to read the transcripts.
// Eviction is least-recently-used first ("oldest" = longest since you last opened it).

import type { Segment } from './extractor/types.ts';

/** The part of chrome.storage.StorageArea we use; lets tests pass an in-memory store. */
export interface KeyValueStore {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface CacheOptions {
  /** Total budget for cached transcripts. chrome.storage.local allows 10 MB without unlimitedStorage. */
  maxBytes: number;
  /** Creators can edit captions; refetch after this long. */
  maxAgeMs: number;
  now?: () => number;
}

export const DEFAULT_CACHE_OPTIONS: CacheOptions = { maxBytes: 8 * 1024 * 1024, maxAgeMs: 30 * 24 * 3600 * 1000 };

type Row = [startMs: number, durMs: number, text: string];
interface Entry {
  v: 1;
  savedAt: number;
  rows: Row[];
}
interface IndexItem {
  bytes: number;
  savedAt: number;
  usedAt: number;
}
type Index = Record<string, IndexItem>;

const INDEX_KEY = 'cache:index';
const PREFIX = 'cache:t:';
const keyFor = (videoId: string, trackId: string) => `${PREFIX}${videoId}:${trackId}`;
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function isRows(x: unknown): x is Row[] {
  return (
    Array.isArray(x) &&
    x.every((r) => Array.isArray(r) && r.length === 3 && typeof r[0] === 'number' && typeof r[1] === 'number' && typeof r[2] === 'string')
  );
}

export class TranscriptCache {
  private readonly store: KeyValueStore;
  private readonly opts: CacheOptions;
  private readonly now: () => number;
  /** Serializes index updates within this tab. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(store: KeyValueStore, opts: CacheOptions = DEFAULT_CACHE_OPTIONS) {
    this.store = store;
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private async readIndex(): Promise<Index> {
    const idx = (await this.store.get(INDEX_KEY))[INDEX_KEY];
    return idx && typeof idx === 'object' ? (idx as Index) : {};
  }

  get(videoId: string, trackId: string): Promise<Segment[] | null> {
    return this.serial(async () => {
      const key = keyFor(videoId, trackId);
      const entry = (await this.store.get(key))[key] as Entry | undefined;
      const index = await this.readIndex();

      const valid = entry?.v === 1 && isRows(entry.rows) && this.now() - entry.savedAt < this.opts.maxAgeMs;
      if (!valid) {
        if (entry || index[key]) {
          delete index[key];
          await this.store.remove(key);
          await this.store.set({ [INDEX_KEY]: index });
        }
        return null;
      }

      index[key] = { bytes: index[key]?.bytes ?? byteLength(entry), savedAt: entry.savedAt, usedAt: this.now() };
      await this.store.set({ [INDEX_KEY]: index });
      return entry.rows.map(([startMs, durMs, text]) => ({ startMs, durMs, text }));
    });
  }

  /** Returns false (and stores nothing) if the transcript alone is over the budget. */
  put(videoId: string, trackId: string, segments: readonly Segment[]): Promise<boolean> {
    return this.serial(async () => {
      const key = keyFor(videoId, trackId);
      const entry: Entry = { v: 1, savedAt: this.now(), rows: segments.map((s) => [s.startMs, s.durMs, s.text]) };
      const bytes = byteLength(entry);
      if (bytes > this.opts.maxBytes) return false;

      const index = await this.readIndex();
      delete index[key];
      let total = bytes + Object.values(index).reduce((sum, i) => sum + i.bytes, 0);
      const evict: string[] = [];
      for (const [k] of Object.entries(index).sort(([, a], [, b]) => a.usedAt - b.usedAt)) {
        if (total <= this.opts.maxBytes) break;
        total -= index[k]!.bytes;
        evict.push(k);
        delete index[k];
      }

      // Free space before writing, so the write can't hit the storage quota.
      if (evict.length) await this.store.remove(evict);
      index[key] = { bytes, savedAt: entry.savedAt, usedAt: entry.savedAt };
      await this.store.set({ [key]: entry, [INDEX_KEY]: index });
      return true;
    });
  }

  stats(): Promise<{ entries: number; bytes: number }> {
    return this.serial(async () => {
      const items = Object.values(await this.readIndex());
      return { entries: items.length, bytes: items.reduce((s, i) => s + i.bytes, 0) };
    });
  }

  clear(): Promise<void> {
    return this.serial(async () => {
      const index = await this.readIndex();
      await this.store.remove([...Object.keys(index), INDEX_KEY]);
    });
  }
}
