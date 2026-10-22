import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TranscriptError } from '../src/extractor/errors.ts';
import { parsePanelRows, parseTimestamp, parseTranscriptPanelJson } from '../src/extractor/panel-parsers.ts';

const throwsCode = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof TranscriptError && e.code === code);

// NOT a captured response: a minimal sample in the documented get_transcript shape.
// TODO: replace with a real response saved from Chrome once the panel fallback is verified there.
const seg = (startMs: number, endMs: number, text: string) => ({
  transcriptSegmentRenderer: { startMs: String(startMs), endMs: String(endMs), snippet: { runs: [{ text }] } },
});
const sample = {
  actions: [
    {
      updateEngagementPanelAction: {
        content: {
          transcriptRenderer: {
            content: {
              transcriptSearchPanelRenderer: {
                body: {
                  transcriptSegmentListRenderer: {
                    initialSegments: [
                      seg(1200, 3360, 'All right, so here we are, in front of the\nelephants'),
                      { transcriptSectionHeaderRenderer: { startMs: '5000', sectionHeader: {} } },
                      seg(5318, 7974, 'the cool thing about these guys'),
                      seg(7974, 12616, ''),
                    ],
                  },
                },
                footer: {
                  transcriptFooterRenderer: {
                    languageMenu: {
                      sortFilterSubMenuRenderer: {
                        subMenuItems: [
                          { title: 'English', selected: true },
                          { title: 'German', selected: false },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
};

describe('parseTranscriptPanelJson', () => {
  it('finds segments anywhere in the tree, skips headers and empty lines', () => {
    const { segments, languageLabel } = parseTranscriptPanelJson(sample);
    assert.deepEqual(segments, [
      { startMs: 1200, durMs: 2160, text: 'All right, so here we are, in front of the elephants' },
      { startMs: 5318, durMs: 2656, text: 'the cool thing about these guys' },
    ]);
    assert.equal(languageLabel, 'English');
  });

  it('returns nothing (not an error) for an unrelated response', () => {
    assert.deepEqual(parseTranscriptPanelJson({ responseContext: {} }).segments, []);
  });

  it('rejects a segment without a start time', () => {
    throwsCode(() => parseTranscriptPanelJson({ transcriptSegmentRenderer: { snippet: { simpleText: 'x' } } }), 'MALFORMED');
  });
});

describe('parsePanelRows (DOM)', () => {
  it('derives durations from the next start time', () => {
    assert.deepEqual(
      parsePanelRows([
        { timestamp: '0:01', text: '  All right,\n so here we are ' },
        { timestamp: '0:05', text: 'the cool thing' },
        { timestamp: '1:02:03', text: 'much later' },
      ]),
      [
        { startMs: 1000, durMs: 4000, text: 'All right, so here we are' },
        { startMs: 5000, durMs: 3_718_000, text: 'the cool thing' },
        { startMs: 3_723_000, durMs: 0, text: 'much later' },
      ],
    );
  });

  it('rejects unreadable timestamps rather than guessing', () => {
    throwsCode(() => parsePanelRows([{ timestamp: 'soon', text: 'x' }]), 'MALFORMED');
  });

  it('parseTimestamp', () => {
    assert.equal(parseTimestamp('0:07'), 7_000);
    assert.equal(parseTimestamp(' 1:02:05 '), 3_725_000);
    assert.equal(parseTimestamp('45'), 45_000);
    assert.equal(parseTimestamp('abc'), null);
    assert.equal(parseTimestamp(''), null);
  });
});
