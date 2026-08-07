import { normalizeReferenceText } from '../text-normalization';

// Sprint 11 Phase 4B — aligning what a student said against what they should
// have said.
//
// PURE. No Prisma, no clock, no I/O, no provider. It takes two strings and
// returns a comparison, which is what makes the scoring rules testable without
// a speech engine and what keeps the engine unable to influence the verdict.
//
// WHY THIS IS NOT `dictation-scoring.ts`. Dictation compares a typed sentence
// position by position, because a typist who omits one word gets the rest
// wrong-by-position and that IS the mistake. Speech is different in kind: a
// speaker who drops one word says everything after it correctly, and a
// positional diff would score them near zero for a single slip. Shadowing
// therefore needs real alignment — the edit script — and that is a different
// algorithm, not a parameter on the old one.
//
// The two were deliberately NOT merged behind a shared abstraction. They agree
// on the normalizer, which is the part that must not diverge, and on nothing
// else.

export type AlignmentOp = 'MATCH' | 'SUBSTITUTE' | 'INSERT' | 'DELETE';

export interface AlignmentToken {
  op: AlignmentOp;
  /**
   * The expected word. Null for INSERT — the student said something that has
   * no counterpart in the sentence.
   */
  reference: string | null;
  /**
   * What the student was heard to say. Null for DELETE — a word of the
   * sentence that never arrived.
   */
  spoken: string | null;
  /** Position in the reference sentence, or null for INSERT. */
  referenceIndex: number | null;
}

export interface TranscriptAlignment {
  tokens: AlignmentToken[];
  wordsCorrect: number;
  /** Reference length. The denominator, and 0 for a sentence that normalizes to nothing. */
  wordsTotal: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  accuracyPercent: number;
}

const splitWords = (text: string): string[] =>
  text === '' ? [] : text.split(' ').filter(Boolean);

/**
 * Word-level Levenshtein with a backtrace, i.e. the standard WER alignment.
 *
 * Costs are 1 for each of substitute / insert / delete and 0 for a match, and
 * they are deliberately EQUAL. Weighting them differently (say, treating an
 * extra word as cheaper than a missing one) is a pedagogical judgement about
 * what kind of speaking mistake matters more, and this phase has no measured
 * basis for making one. Equal costs are the honest default and the standard.
 *
 * O(n·m) in words. A segment is capped at 30 seconds of speech at publish
 * time, so both dimensions are tens of words and the matrix is trivial.
 */
export const alignTranscript = (
  referenceNormalized: string,
  spokenNormalized: string,
): TranscriptAlignment => {
  const reference = splitWords(referenceNormalized);
  const spoken = splitWords(spokenNormalized);
  const n = reference.length;
  const m = spoken.length;

  // A reference that normalizes to nothing cannot be scored. Returning 0
  // rather than dividing by zero, and never "100% because there was nothing to
  // get wrong" — that would mark an empty sentence as mastered.
  if (n === 0) {
    return {
      tokens: [],
      wordsCorrect: 0,
      wordsTotal: 0,
      substitutions: 0,
      insertions: m,
      deletions: 0,
      accuracyPercent: 0,
    };
  }

  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i += 1) cost[i][0] = i;
  for (let j = 0; j <= m; j += 1) cost[0][j] = j;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const substitute = cost[i - 1][j - 1] + (reference[i - 1] === spoken[j - 1] ? 0 : 1);
      const deleteRef = cost[i - 1][j] + 1;
      const insertSpoken = cost[i][j - 1] + 1;
      cost[i][j] = Math.min(substitute, deleteRef, insertSpoken);
    }
  }

  const tokens: AlignmentToken[] = [];
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;
  let wordsCorrect = 0;

  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    // Diagonal first, so an equal-cost tie resolves to match/substitute rather
    // than to a delete-then-insert pair. Both are the same edit distance; only
    // one of them reads as "you said the wrong word here" instead of "you
    // missed a word and added a different one".
    if (
      i > 0 &&
      j > 0 &&
      cost[i][j] === cost[i - 1][j - 1] + (reference[i - 1] === spoken[j - 1] ? 0 : 1)
    ) {
      const matched = reference[i - 1] === spoken[j - 1];
      tokens.push({
        op: matched ? 'MATCH' : 'SUBSTITUTE',
        reference: reference[i - 1],
        spoken: spoken[j - 1],
        referenceIndex: i - 1,
      });
      if (matched) wordsCorrect += 1;
      else substitutions += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      tokens.push({
        op: 'DELETE',
        reference: reference[i - 1],
        spoken: null,
        referenceIndex: i - 1,
      });
      deletions += 1;
      i -= 1;
    } else {
      tokens.push({
        op: 'INSERT',
        reference: null,
        spoken: spoken[j - 1],
        referenceIndex: null,
      });
      insertions += 1;
      j -= 1;
    }
  }

  tokens.reverse();

  // WER-style, so INSERTIONS COUNT AGAINST THE SCORE. Using `wordsCorrect / n`
  // instead would let a student read the sentence and then say anything else
  // they liked and still score 100% — and, more practically, it would reward
  // whatever filler a speech engine hallucinates around quiet audio.
  //
  // Floored at 0: the error count can exceed the reference length, and a
  // negative percentage is not a thing a student can act on.
  const errors = substitutions + insertions + deletions;
  const accuracyPercent = Math.max(0, Math.round(((n - errors) / n) * 100));

  return {
    tokens,
    wordsCorrect,
    wordsTotal: n,
    substitutions,
    insertions,
    deletions,
    accuracyPercent,
  };
};

/**
 * Align a raw transcript against a pre-normalized reference.
 *
 * The reference arrives already normalized (`ListeningSegment.normalizedText`,
 * computed at write time); the transcript is normalized here with the SAME
 * function. Using two normalizers would let a student be marked wrong for a
 * difference neither they nor the engine created.
 */
export const alignRawTranscript = (
  referenceNormalized: string,
  rawTranscript: string,
): TranscriptAlignment & { normalizedTranscript: string } => {
  const normalizedTranscript = normalizeReferenceText(rawTranscript);
  return {
    ...alignTranscript(referenceNormalized, normalizedTranscript),
    normalizedTranscript,
  };
};
