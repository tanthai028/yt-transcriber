import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { parseJson3 } from '../src/extractor/parsers.ts';
import { findMatches, splitMatches } from '../src/search.ts';

const asr = parseJson3(readFileSync(new URL('./fixtures/json3-asr-en.json', import.meta.url), 'utf8'));

describe('findMatches', () => {
  it('finds case-insensitive matches in order', () => {
    // "People" is in lines 6 and 9; "email" in 10 ("Just email her.") and 11 ("Emailing her…").
    assert.deepEqual(findMatches(asr, 'people'), [6, 9]);
    assert.deepEqual(findMatches(asr, 'EMAIL'), [10, 11]);
  });
  it('ignores empty and whitespace-only queries', () => {
    assert.deepEqual(findMatches(asr, ''), []);
    assert.deepEqual(findMatches(asr, '   '), []);
  });
  it('returns nothing for no match', () => {
    assert.deepEqual(findMatches(asr, 'zebra'), []);
  });
});

describe('splitMatches', () => {
  it('splits around every match, preserving original case', () => {
    assert.deepEqual(splitMatches('Emailing her. Emailed her.', 'email'), [
      { text: 'Email', match: true },
      { text: 'ing her. ', match: false },
      { text: 'Email', match: true },
      { text: 'ed her.', match: false },
    ]);
  });
  it('round-trips the text exactly', () => {
    for (const s of asr) for (const q of ['e', 'the', 'xyz', ' ']) assert.equal(splitMatches(s.text, q).map((p) => p.text).join(''), s.text);
  });
  it('no query → one plain part', () => {
    assert.deepEqual(splitMatches('abc', ''), [{ text: 'abc', match: false }]);
  });
});
