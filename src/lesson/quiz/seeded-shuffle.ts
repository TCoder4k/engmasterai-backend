// Fisher-Yates over a seeded PRNG.
//
// Sprint 06B.5 introduced this inside QuizService to keep an ORDERING
// question's DISPLAY order stable for the life of one attempt (an unseeded
// shuffle visibly re-ordered the options under an already-graded question on
// every refresh). Sprint 06C extracted it here because Trap Hunter's Level 1
// hint needs the same property for a different reason: which distractors get
// struck out must not change when the student refreshes mid-correction, or
// the "hint" would leak a different subset on every reload until only the
// correct answer was left.
//
// No security property rests on this — it orders things a student is already
// allowed to see. The correct answer lives in Question.correctAnswer, which
// this function never touches.
//
// xmur3 string hash → mulberry32 PRNG: small, dependency-free, and stable
// across Node versions (Math.random is neither seedable nor reproducible).
export const seededShuffle = <T>(items: T[], seed: string): T[] => {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = (h ^= h >>> 16) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
