// Sprint 11 — the canonical normalizer for listening reference text.
//
// Pure: no Prisma, no clock, no I/O.
//
// WHAT IT IS FOR. `ListeningSegment.normalizedText` is the form a student's
// answer will eventually be compared against. Sprint 11 only WRITES it (there
// is no scoring yet); Phase 4A builds the comparison on top.
//
// WHY IT IS COMPUTED AT WRITE TIME rather than on every read: the comparison
// runs once per submitted attempt and the reference never changes between
// attempts, so normalizing per request would repeat identical work on the
// hottest path the feature will have.
//
// >>> A CONTRACT FOR PHASE 4A <<<
// Stored values are only as current as the rules below. Every segment write
// recomputes the column, so an edited segment self-heals — but a segment nobody
// touches keeps whatever this file produced on the day it was authored. When
// Phase 4A widens these rules (contractions, spelled-out numbers, hyphenation),
// it MUST ship a backfill that recomputes every existing row in the same
// migration. Widening the normalizer without one leaves old content graded
// against a different standard than new content, silently and per-row.
//
// Deliberately conservative for now. It removes only what is unambiguously not
// a word: it does NOT expand contractions and does NOT convert numerals to
// words, because both need a lookup table that belongs with the comparison
// logic that consumes it, not here.

/**
 * Reduce a sentence to the whitespace-separated word form used for comparison.
 *
 * - Unicode NFKC, so a typographic apostrophe and an ASCII one are one token
 * - lowercase
 * - curly quotes folded to `'`
 * - punctuation dropped, EXCEPT an apostrophe or hyphen sitting between two
 *   word characters (`don't`, `well-known` stay one token; a trailing quote
 *   does not)
 * - whitespace collapsed and trimmed
 */
export const normalizeReferenceText = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    // Every Unicode apostrophe variant folds to the ASCII one BEFORE the
    // punctuation strip below, so `don’t` and `don't` cannot normalize apart.
    .replace(/[‘’ʼʹ՚＇]/g, "'")
    .replace(/[‐-―−]/g, '-')
    // Keep an apostrophe/hyphen only when it joins two word characters.
    .replace(/(?<![\p{L}\p{N}])['-]|['-](?![\p{L}\p{N}])/gu, ' ')
    // Everything that is not a letter, digit, space, apostrophe or hyphen.
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Word count of the normalized form. Zero for text that normalizes to empty. */
export const countReferenceWords = (text: string): number => {
  const normalized = normalizeReferenceText(text);
  return normalized === '' ? 0 : normalized.split(' ').length;
};
