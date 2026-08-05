import {
  countReferenceWords,
  normalizeReferenceText,
} from './text-normalization';

// Sprint 11 — pins the normalizer's rules with literal strings.
//
// WHY LITERALS. `ListeningSegment.normalizedText` is written at authoring time
// and read (from Phase 4A) to grade a student. Widening these rules changes
// what counts as a correct answer, so every rule below is spelled out rather
// than asserted through a helper: a reviewer should be able to see the whole
// contract without running anything.
//
// The counterpart obligation is recorded in the module header — Phase 4A must
// ship a backfill when it widens these rules, or content authored today would
// be graded against a different standard than content authored after it.

describe('normalizeReferenceText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeReferenceText('  Good   MORNING everyone  ')).toBe(
      'good morning everyone',
    );
  });

  it('drops sentence punctuation', () => {
    expect(normalizeReferenceText('Good morning, everyone. Thank you!')).toBe(
      'good morning everyone thank you',
    );
  });

  it('keeps an apostrophe INSIDE a word', () => {
    expect(normalizeReferenceText("I don't know")).toBe("i don't know");
  });

  it('folds a typographic apostrophe onto the ASCII one', () => {
    // The single most likely real-world difference between a transcript pasted
    // from a document and one typed into the editor. If these normalized apart,
    // the same sentence authored two ways would grade differently.
    expect(normalizeReferenceText('I don’t know')).toBe(
      normalizeReferenceText("I don't know"),
    );
  });

  it('keeps a hyphen INSIDE a word', () => {
    expect(normalizeReferenceText('a well-known author')).toBe(
      'a well-known author',
    );
  });

  it('drops a quote or dash that is not joining two word characters', () => {
    expect(normalizeReferenceText("'quoted' word - dash")).toBe(
      'quoted word dash',
    );
  });

  it('keeps digits as digits', () => {
    // Spelled-out numbers are NOT unified with numerals here. That needs a
    // lookup table and belongs with the comparison logic in Phase 4A — this
    // test exists to make the current, narrower behaviour explicit rather than
    // accidental.
    expect(normalizeReferenceText('Flight 214 departs at 4:15.')).toBe(
      'flight 214 departs at 4 15',
    );
  });

  it('applies NFKC so compatibility forms compare equal', () => {
    expect(normalizeReferenceText('ﬁle')).toBe('file');
  });

  it('returns an empty string for text that is only punctuation', () => {
    expect(normalizeReferenceText('... !!! ---')).toBe('');
  });

  it('is idempotent — normalizing twice changes nothing', () => {
    const once = normalizeReferenceText('Good morning, everyone!');
    expect(normalizeReferenceText(once)).toBe(once);
  });
});

describe('countReferenceWords', () => {
  it('counts words in the normalized form', () => {
    expect(countReferenceWords('Good morning, everyone!')).toBe(3);
  });

  it('counts a contraction as ONE word', () => {
    expect(countReferenceWords("I don't know")).toBe(3);
  });

  it('is zero for text that normalizes to empty', () => {
    expect(countReferenceWords('!!!')).toBe(0);
  });
});
