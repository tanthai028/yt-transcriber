import assert from 'node:assert/strict';
import { it } from 'node:test';

import { formatTimestamp } from '../src/format.ts';

it('formatTimestamp', () => {
  assert.equal(formatTimestamp(0), '0:00');
  assert.equal(formatTimestamp(1_999), '0:01');
  assert.equal(formatTimestamp(75_000), '1:15');
  assert.equal(formatTimestamp(3_725_000), '1:02:05');
  assert.equal(formatTimestamp(65_000, true), '0:01:05');
  assert.equal(formatTimestamp(-5), '0:00');
});
