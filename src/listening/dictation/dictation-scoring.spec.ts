import { scoreDictationAttempt } from './dictation-scoring';
import { normalizeReferenceText } from '../text-normalization';

// The reference is always the STORED normalized column, so every fixture goes
// through the same normalizer the segment writer used. Hand-writing the
// normalized string here would test this file against a reference the database
// never contains.
const score = (reference: string, typed: string, revealed = 0) =>
  scoreDictationAttempt({
    normalizedReference: normalizeReferenceText(reference),
    typedText: typed,
    revealedWordCount: revealed,
  });

describe('scoreDictationAttempt', () => {
  describe('the solved rule', () => {
    it('solves only at 100%', () => {
      expect(score('the otter wraps her baby', 'the otter wraps her baby')).toMatchObject({
        accuracyPercent: 100,
        solved: true,
        wordsCorrect: 5,
        wordsTotal: 5,
      });
    });

    // Transcription with one word wrong is not transcription. This is why
    // there is no configurable threshold here, unlike the quiz.
    it('does not solve at 80%', () => {
      const result = score('the otter wraps her baby', 'the otter wraps her puppy');

      expect(result.accuracyPercent).toBe(80);
      expect(result.solved).toBe(false);
    });

    it('does not solve an empty answer', () => {
      expect(score('the otter wraps her baby', '')).toMatchObject({
        accuracyPercent: 0,
        solved: false,
        wordsCorrect: 0,
      });
    });
  });

  describe('normalization the client used to get wrong', () => {
    // >>> THE MIGRATION RISK OF PHASE 4A <<<
    // The client's `[^a-z0-9']` strip turned `well-known` into `wellknown`,
    // so typing it with the hyphen and typing it without were the same
    // answer. The canonical normalizer keeps a hyphen between two word
    // characters, so they are now different — and the hyphenated form is the
    // correct one.
    it('keeps a hyphen inside a compound word', () => {
      expect(normalizeReferenceText('a well-known fact')).toBe('a well-known fact');
      expect(score('a well-known fact', 'a well-known fact').solved).toBe(true);
      expect(score('a well-known fact', 'a wellknown fact').solved).toBe(false);
    });

    // A student on iOS gets a curly apostrophe from autocorrect. Both forms
    // must be the same answer, or the exercise becomes untypable on a phone.
    it('treats a typographic apostrophe as an ASCII one', () => {
      expect(score('don’t worry', "don't worry").solved).toBe(true);
      expect(score("don't worry", 'don’t worry').solved).toBe(true);
    });

    it('ignores case and trailing punctuation', () => {
      expect(score('Hello, there!', 'hello there').solved).toBe(true);
      expect(score('hello there', 'HELLO THERE.').solved).toBe(true);
    });

    it('collapses extra whitespace', () => {
      expect(score('one two three', '  one   two \n three  ').solved).toBe(true);
    });
  });

  describe('positional comparison, and what it costs', () => {
    it('compares word i with word i', () => {
      expect(score('a b c d', 'a x c d').accuracyPercent).toBe(75);
    });

    // The honest limitation, pinned so nobody "fixes" it by accident. A
    // missing first word shifts everything, so the student scores 0 rather
    // than 3/4. Correcting this needs alignment, which is Phase 4B's tool on
    // Phase 4B's input, not a quiet change here.
    it('penalises a dropped word for every position after it', () => {
      expect(score('a b c d', 'b c d').accuracyPercent).toBe(0);
    });

    it('ignores extra words past the end of the reference', () => {
      expect(score('a b', 'a b c d')).toMatchObject({
        accuracyPercent: 100,
        solved: true,
      });
    });
  });

  describe('revealed words never earn credit', () => {
    it('subtracts revealed words from wordsCorrect but not from accuracy', () => {
      const result = score('one two three four', 'one two three four', 2);

      // Accuracy still describes the sentence; wordsCorrect describes what was
      // earned unaided. Two different questions, two different numbers.
      expect(result.accuracyPercent).toBe(100);
      expect(result.wordsCorrect).toBe(2);
      expect(result.solved).toBe(true);
      expect(result.assisted).toBe(true);
    });

    it('never returns a negative wordsCorrect', () => {
      expect(score('one two', 'one two', 5).wordsCorrect).toBe(0);
    });

    // A client-supplied count is clamped, and it can only ever reduce a score.
    // Overstating it declines credit; there is no direction in which it lies
    // upward.
    it('clamps a revealed count beyond the sentence length', () => {
      expect(score('one two', 'one two', 99)).toMatchObject({
        wordsCorrect: 0,
        assisted: true,
        solved: true,
      });
    });

    it('ignores a negative revealed count', () => {
      expect(score('one two', 'one two', -3)).toMatchObject({
        wordsCorrect: 2,
        assisted: false,
      });
    });

    it('reports assisted=false when nothing was revealed', () => {
      expect(score('one two', 'one').assisted).toBe(false);
    });
  });

  describe('a reference that normalises to nothing', () => {
    // Publish validation already rejects empty sentence text. This is the
    // second lock: without it an all-punctuation sentence would mark itself
    // complete for every student who submitted an empty answer.
    it('cannot be solved, even by an empty answer', () => {
      expect(score('...', '')).toMatchObject({
        accuracyPercent: 0,
        wordsTotal: 0,
        wordsCorrect: 0,
        solved: false,
      });
    });
  });
});
