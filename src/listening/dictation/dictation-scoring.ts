import { normalizeReferenceText } from '../text-normalization';

// Sprint 11 Phase 4A — grading a dictation attempt. Pure: no Prisma, no clock,
// no I/O.
//
// >>> THIS IS A POSITIONAL WORD DIFF, NOT AN ALIGNMENT ENGINE <<<
// Word `i` of the answer is compared with word `i` of the reference, and a
// missing word shifts every later comparison. That is a real limitation and it
// is chosen deliberately for two reasons.
//
// First, it is what Dictation ALREADY DOES. The rule shipped in
// DictationWorkspace.tsx since Sprint 03G is positional, and Phase 4A moves the
// judgement to the server without changing what counts as correct. Swapping in
// Levenshtein alignment here would silently re-grade a live exercise as part of
// a persistence change — a behaviour change hiding inside an architecture
// change, which is the kind nobody reviews.
//
// Second, the input is TYPED TEXT, not a speech transcript. A student typing
// what they hear produces occasional wrong words in the right places; a speech
// recogniser produces insertions and deletions that only alignment can survive.
// Alignment is Phase 4B's problem, on Phase 4B's input.
//
// WHAT DOES CHANGE, AND IT IS THE ONE MIGRATION RISK OF THIS PHASE. The client
// normalised with `word.toLowerCase().replace(/[^a-z0-9']/g, '')`, which drops
// hyphens (`well-known` -> `wellknown`) and mangles non-ASCII. This file uses
// the canonical `normalizeReferenceText`, which is NFKC-aware, folds curly
// apostrophes, and KEEPS a hyphen between two word characters. On a sentence
// containing a hyphenated compound or a typographic quote the two rules
// disagree, and the server's is the correct one. `dictation-scoring.spec.ts`
// pins each divergent case explicitly so the difference is a documented
// decision rather than a surprise in production.

export interface DictationScoreInput {
  /** The stored `ListeningSegment.normalizedText` — already canonical. */
  normalizedReference: string;
  /** Raw text the student typed. Normalised here, never by the client. */
  typedText: string;
  /**
   * How many words the student revealed with a hint.
   *
   * A CLIENT-SUPPLIED CLAIM, and treated as one: it is clamped to the
   * reference length and only ever REDUCES `wordsCorrect`. A student cannot
   * inflate a score with it, and understating it is not worth defending
   * against — the honest failure mode of a hint counter is that someone
   * declines credit they were owed.
   */
  revealedWordCount: number;
}

export interface DictationScore {
  /** 0–100, rounded. The share of reference words matched positionally. */
  accuracyPercent: number;
  /** Matched words MINUS revealed ones — what was earned unaided. */
  wordsCorrect: number;
  /** Reference word count. Zero only for a sentence that normalises to empty. */
  wordsTotal: number;
  /**
   * Fully correct.
   *
   * 100% and nothing less, matching the rule Dictation has always used: the
   * exercise is transcription, and a sentence with one wrong word is not
   * transcribed. Deliberately NOT a configurable threshold — the quiz's
   * `QUIZ_DEFAULT_PASSING_SCORE_PERCENT` exists because a quiz is a test of
   * knowledge with partial credit; this is a test of hearing with none.
   */
  solved: boolean;
  /** True when any word was revealed. Sticks to the progress row. */
  assisted: boolean;
}

const splitWords = (normalized: string): string[] =>
  normalized === '' ? [] : normalized.split(' ');

export const scoreDictationAttempt = ({
  normalizedReference,
  typedText,
  revealedWordCount,
}: DictationScoreInput): DictationScore => {
  const referenceWords = splitWords(normalizedReference);
  const typedWords = splitWords(normalizeReferenceText(typedText));

  const wordsTotal = referenceWords.length;

  // A sentence that normalises to nothing cannot be transcribed, so it cannot
  // be solved. Returning 100% for it would let an empty reference mark itself
  // complete — publish validation already rejects empty text, and this is the
  // second lock rather than a substitute for the first.
  if (wordsTotal === 0) {
    return {
      accuracyPercent: 0,
      wordsCorrect: 0,
      wordsTotal: 0,
      solved: false,
      assisted: revealedWordCount > 0,
    };
  }

  let matched = 0;
  for (let i = 0; i < wordsTotal; i += 1) {
    if (typedWords[i] !== undefined && typedWords[i] === referenceWords[i]) {
      matched += 1;
    }
  }

  // Extra words past the end of the reference are ignored rather than
  // penalised, which is what the positional rule has always done: accuracy is
  // "how much of the sentence did you get", and there is no reference word for
  // a trailing word to be wrong against.
  const accuracyPercent = Math.round((matched / wordsTotal) * 100);

  const revealed = Math.max(0, Math.min(revealedWordCount, wordsTotal));

  return {
    accuracyPercent,
    // Never negative: a student who reveals every word and then types them all
    // scores 0 earned words, not a negative count.
    wordsCorrect: Math.max(0, matched - revealed),
    wordsTotal,
    solved: matched === wordsTotal,
    assisted: revealed > 0,
  };
};
