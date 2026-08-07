import { alignTranscript, alignRawTranscript } from './transcript-alignment';

// Sprint 11 Phase 4B — the alignment engine.
//
// This file decides what a spoken attempt is worth, so it is tested against
// the mistakes learners actually make rather than against synthetic strings:
// dropping a word, saying the wrong one, adding filler, and being transcribed
// as silence.

describe('alignTranscript', () => {
  it('scores a perfect reading 100 with every token a match', () => {
    const result = alignTranscript('the otter wraps her baby', 'the otter wraps her baby');

    expect(result.accuracyPercent).toBe(100);
    expect(result.wordsCorrect).toBe(5);
    expect(result.wordsTotal).toBe(5);
    expect(result.tokens.every((token) => token.op === 'MATCH')).toBe(true);
    expect([result.substitutions, result.insertions, result.deletions]).toEqual([0, 0, 0]);
  });

  // THE CASE THAT MOTIVATED REAL ALIGNMENT. A positional diff — which is what
  // Dictation uses — would mark every word after the omission wrong and score
  // this near zero. A speaker who drops one word said the rest correctly.
  it('charges one error for a dropped word, not one per word after it', () => {
    const result = alignTranscript(
      'the otter wraps her baby in kelp',
      'the otter wraps baby in kelp',
    );

    expect(result.deletions).toBe(1);
    expect(result.substitutions).toBe(0);
    expect(result.wordsCorrect).toBe(6);
    expect(result.accuracyPercent).toBe(86);
  });

  it('records a wrong word as a substitution, not as a delete plus an insert', () => {
    const result = alignTranscript('the otter wraps her baby', 'the otter wraps his baby');

    expect(result.substitutions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.insertions).toBe(0);
    const wrong = result.tokens.find((token) => token.op === 'SUBSTITUTE');
    expect(wrong).toMatchObject({ reference: 'her', spoken: 'his', referenceIndex: 3 });
  });

  // WHY INSERTIONS COUNT. Scoring `wordsCorrect / wordsTotal` would give this
  // 100%: every reference word was said. A student could read the sentence and
  // then say anything else they liked, and — more practically — an engine that
  // hallucinates filler around quiet audio would be rewarded for it.
  it('penalises extra words even when every reference word was said', () => {
    const result = alignTranscript(
      'the otter wraps her baby',
      'um the otter wraps her baby you know',
    );

    expect(result.wordsCorrect).toBe(5);
    expect(result.insertions).toBe(3);
    expect(result.accuracyPercent).toBe(40);
  });

  it('reports every reference word as deleted when nothing was heard', () => {
    const result = alignTranscript('the otter wraps her baby', '');

    expect(result.deletions).toBe(5);
    expect(result.wordsCorrect).toBe(0);
    expect(result.accuracyPercent).toBe(0);
    expect(result.tokens).toHaveLength(5);
    expect(result.tokens.every((token) => token.op === 'DELETE')).toBe(true);
  });

  // The error count can exceed the reference length. A negative percentage is
  // not something a student can act on.
  it('floors the score at zero rather than going negative', () => {
    const result = alignTranscript(
      'the otter',
      'completely different words at considerable length here',
    );

    expect(result.accuracyPercent).toBe(0);
  });

  // Not "100% because there was nothing to get wrong" — that would mark an
  // empty sentence as mastered.
  it('scores an empty reference zero rather than perfect', () => {
    const result = alignTranscript('', 'anything at all');

    expect(result.wordsTotal).toBe(0);
    expect(result.accuracyPercent).toBe(0);
  });

  // Every reference word appears exactly once across MATCH/SUBSTITUTE/DELETE,
  // in order. This is what lets the client render the sentence from the tokens
  // rather than trying to interleave them with the original text itself.
  it('covers the reference exactly once, in order', () => {
    const result = alignTranscript(
      'the otter wraps her baby in kelp',
      'the otters wrap baby in dry kelp',
    );

    const covered = result.tokens
      .filter((token) => token.op !== 'INSERT')
      .map((token) => token.referenceIndex);
    expect(covered).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('keeps the error counts and the correct count consistent with the total', () => {
    const result = alignTranscript(
      'the otter wraps her baby in kelp',
      'the otters wrap baby in dry kelp',
    );

    expect(result.wordsCorrect + result.substitutions + result.deletions).toBe(
      result.wordsTotal,
    );
  });
});

describe('alignRawTranscript', () => {
  // The engine returns punctuation and capitals; the reference is stored
  // already normalized. Both sides must go through the SAME normalizer, or a
  // student is marked wrong for a difference neither they nor the engine made.
  it('normalises the transcript with the same rules as the reference', () => {
    const result = alignRawTranscript(
      "don't drop the well-known otter",
      "Don’t drop the well-known otter!",
    );

    expect(result.normalizedTranscript).toBe("don't drop the well-known otter");
    expect(result.accuracyPercent).toBe(100);
  });

  it('does not split a hyphenated compound into two words', () => {
    const result = alignRawTranscript('a well-known otter', 'a well-known otter');

    expect(result.wordsTotal).toBe(3);
    expect(result.accuracyPercent).toBe(100);
  });

  it('is unaffected by trailing punctuation and casing', () => {
    const result = alignRawTranscript('the otter swims', 'The otter swims.');

    expect(result.accuracyPercent).toBe(100);
  });
});
