import {
  ListeningMediaProvider,
  ListeningMediaType,
  ListeningMode,
} from '@prisma/client';
import {
  ContentPublishDraft,
  MAX_SHADOWING_SEGMENT_MS,
  validateContentForPublish,
  validateSegmentDocument,
} from './segment-validation';

// Sprint 11 — the publish gate.
//
// Each test asserts the MESSAGE, not just that something failed. These strings
// are what an admin reads when publishing is refused, and a refusal that does
// not name the problem is barely better than a 500.

const segment = (
  startTimeMs: number,
  endTimeMs: number,
  text = 'Good morning everyone.',
) => ({ text, startTimeMs, endTimeMs });

const draft = (
  overrides: Partial<ContentPublishDraft> = {},
): ContentPublishDraft => ({
  supportedModes: [ListeningMode.DICTATION],
  mediaType: ListeningMediaType.VIDEO,
  mediaProvider: ListeningMediaProvider.YOUTUBE,
  mediaUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  sourceName: 'BBC Learning English',
  sourceUrl: 'https://www.youtube.com/@bbclearningenglish',
  durationMs: 60_000,
  categoryIsPublished: true,
  segments: [segment(0, 4_000), segment(4_000, 9_000)],
  ...overrides,
});

describe('validateSegmentDocument (write-time)', () => {
  it('accepts a well-formed document', () => {
    expect(validateSegmentDocument([segment(0, 4_000)])).toBeNull();
  });

  it('accepts an EMPTY document — a draft may have no segments yet', () => {
    // This is the rule that keeps the editor usable. An author creates the
    // recording first and transcribes it afterwards.
    expect(validateSegmentDocument([])).toBeNull();
  });

  it('accepts OVERLAPPING segments — that is a publish-time concern', () => {
    // Deliberate: an author mid-transcription routinely has timings that do
    // not tile yet, and refusing the save would lose their work.
    expect(
      validateSegmentDocument([segment(0, 5_000), segment(3_000, 8_000)]),
    ).toBeNull();
  });

  it('rejects empty text, naming the position', () => {
    expect(validateSegmentDocument([segment(0, 1_000, '   ')])).toBe(
      'Segment 1: text must not be empty.',
    );
  });

  it('rejects a negative start', () => {
    expect(validateSegmentDocument([segment(-1, 1_000)])).toBe(
      'Segment 1: startTimeMs must be an integer of 0 or more.',
    );
  });

  it('rejects an end at or before the start', () => {
    expect(validateSegmentDocument([segment(4_000, 4_000)])).toBe(
      'Segment 1: endTimeMs (4000) must be greater than startTimeMs (4000).',
    );
  });

  it('names the position of the FIRST bad segment', () => {
    expect(
      validateSegmentDocument([segment(0, 1_000), segment(2_000, 1_500)]),
    ).toContain('Segment 2');
  });
});

describe('validateContentForPublish', () => {
  it('accepts a complete draft', () => {
    expect(validateContentForPublish(draft())).toBeNull();
  });

  it('refuses when the category is still a draft', () => {
    // Checked FIRST: publishing into a draft category produces content no
    // student can reach, which from the admin's side looks like a broken
    // feature rather than a rule.
    expect(
      validateContentForPublish(draft({ categoryIsPublished: false })),
    ).toBe(
      'Cannot publish: the category is still a draft. Publish the category first.',
    );
  });

  it('refuses when no mode is enabled', () => {
    expect(validateContentForPublish(draft({ supportedModes: [] }))).toBe(
      'Cannot publish: enable at least one practice mode.',
    );
  });

  it('refuses an empty media URL — the state every seeded recording is in', () => {
    expect(validateContentForPublish(draft({ mediaUrl: '' }))).toBe(
      'Cannot publish: add a media URL.',
    );
  });

  it('refuses a YouTube URL that is not a supported video URL', () => {
    expect(
      validateContentForPublish(
        draft({ mediaUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }),
      ),
    ).toContain('not a supported YouTube video URL');
  });

  it('refuses YouTube media with no attribution name', () => {
    // The video is embedded, never downloaded, so the channel it belongs to
    // has to stay visible to the student.
    expect(validateContentForPublish(draft({ sourceName: null }))).toContain(
      'requires a source/channel name',
    );
  });

  it('refuses YouTube media with no attribution URL', () => {
    expect(validateContentForPublish(draft({ sourceUrl: null }))).toContain(
      'requires an https source URL',
    );
  });

  it('refuses a YouTube source declared as AUDIO', () => {
    expect(
      validateContentForPublish(draft({ mediaType: ListeningMediaType.AUDIO })),
    ).toContain('must be of media type VIDEO');
  });

  it('accepts non-YouTube https audio without attribution', () => {
    // Self-hosted audio is our own; there is nobody to attribute.
    expect(
      validateContentForPublish(
        draft({
          mediaProvider: ListeningMediaProvider.EXTERNAL_URL,
          mediaType: ListeningMediaType.AUDIO,
          mediaUrl: 'https://cdn.example.com/lesson.mp3',
          sourceName: null,
          sourceUrl: null,
        }),
      ),
    ).toBeNull();
  });

  it('refuses a non-https media URL', () => {
    expect(
      validateContentForPublish(
        draft({
          mediaProvider: ListeningMediaProvider.EXTERNAL_URL,
          mediaType: ListeningMediaType.AUDIO,
          mediaUrl: 'http://cdn.example.com/lesson.mp3',
        }),
      ),
    ).toContain('must be an absolute https URL');
  });

  it('refuses content with no segments', () => {
    expect(validateContentForPublish(draft({ segments: [] }))).toBe(
      'Cannot publish: add at least one segment.',
    );
  });

  it('refuses overlapping segments, naming both positions', () => {
    expect(
      validateContentForPublish({
        ...draft(),
        segments: [segment(0, 5_000), segment(3_000, 8_000)],
      }),
    ).toBe(
      'Cannot publish: segment 2 starts at 3000ms, before segment 1 ends at 5000ms.',
    );
  });

  it('refuses segments that are out of chronological order', () => {
    // Checked against the ARRAY order, which becomes orderIndex — a subtitle
    // list that disagrees with the audio is the bug this prevents.
    expect(
      validateContentForPublish({
        ...draft(),
        segments: [segment(10_000, 14_000), segment(0, 4_000)],
      }),
    ).toContain('segment 2 starts at 0ms, before segment 1 ends at 14000ms');
  });

  it('accepts segments that touch exactly at a boundary', () => {
    expect(
      validateContentForPublish({
        ...draft(),
        segments: [segment(0, 4_000), segment(4_000, 8_000)],
      }),
    ).toBeNull();
  });

  it('refuses a segment ending past the media duration', () => {
    expect(
      validateContentForPublish({
        ...draft(),
        durationMs: 5_000,
        segments: [segment(0, 9_000)],
      }),
    ).toContain('past the media duration of 5000ms');
  });

  it('skips the duration check when the duration is unknown', () => {
    expect(
      validateContentForPublish({
        ...draft(),
        durationMs: null,
        segments: [segment(0, 900_000)],
      }),
    ).toBeNull();
  });

  it('refuses an over-long segment when SHADOWING is enabled', () => {
    expect(
      validateContentForPublish({
        ...draft(),
        supportedModes: [ListeningMode.SHADOWING],
        durationMs: 120_000,
        segments: [segment(0, MAX_SHADOWING_SEGMENT_MS + 1)],
      }),
    ).toContain(`over the ${MAX_SHADOWING_SEGMENT_MS}ms limit for shadowing`);
  });

  it('allows the same over-long segment when only DICTATION is enabled', () => {
    // The 30s cap mirrors the recorder, and there is no recorder in dictation.
    expect(
      validateContentForPublish({
        ...draft(),
        supportedModes: [ListeningMode.DICTATION],
        durationMs: 120_000,
        segments: [segment(0, MAX_SHADOWING_SEGMENT_MS + 1)],
      }),
    ).toBeNull();
  });

  it('re-checks per-segment sanity even though saving already did', () => {
    // A draft saved before these rules existed must not slip through publish.
    expect(
      validateContentForPublish({
        ...draft(),
        segments: [segment(0, 1_000, '  ')],
      }),
    ).toBe('Cannot publish: segment 1: text must not be empty.');
  });
});
