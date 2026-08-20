import {
  generateRoadmap,
  GenerateRoadmapInput,
  RoadmapPillar,
  RoadmapResourceCandidate,
  RoadmapResourceType,
} from './roadmap-algorithm';

// Goal filtering itself happens upstream, at the query level, in
// PlacementService.loadAvailableResources — this function only ever sees
// candidates the caller's goal already allows. `suitableGoals`/`title`/
// `description` are carried on every fixture (matching the real shape) but
// are irrelevant to this file's own assertions.
const resource = (
  resourceType: RoadmapResourceType,
  pillar: RoadmapPillar,
  id: string,
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null,
  sortKey: number,
): RoadmapResourceCandidate => ({
  resourceType,
  id,
  pillar,
  level,
  sortKey,
  title: id,
  description: '',
  suitableGoals: [],
});

// Course's sortKey is createdAt.getTime() in the real loader — dates keep
// the "older/newer" narrative readable in fixtures below.
const course = (
  id: string,
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null,
  createdAt: Date,
) => resource('COURSE', 'GRAMMAR', id, level, createdAt.getTime());

// VocabLibrary/ListeningCategory's sortKey is orderIndex in the real loader
// — a plain small integer.
const vocabLibrary = (
  id: string,
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null,
  orderIndex = 0,
) => resource('VOCAB_LIBRARY', 'VOCABULARY', id, level, orderIndex);

const listeningCategory = (
  id: string,
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null,
  orderIndex = 0,
) => resource('LISTENING_CATEGORY', 'LISTENING', id, level, orderIndex);

// Only ever present in `candidates` when the caller's goal is
// GENERAL_ENGLISH — that gating happens upstream, at the query level, in
// PlacementService.loadAvailableResources (see its own header comment), not
// in this pure function. generateRoadmap itself has no goal-based branching
// for Speaking at all: it simply appends whatever pickResource('SPEAKING',
// ...) finds (or nothing, if the candidates array has none).
const speakingScenario = (
  id: string,
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null = null,
  orderIndex = 0,
) => resource('SPEAKING_SCENARIO', 'SPEAKING', id, level, orderIndex);

const beginnerInput = (
  overrides: Partial<GenerateRoadmapInput> = {},
): GenerateRoadmapInput => ({
  goal: 'FOUNDATION',
  estimatedLevel: 'A1',
  levelSource: 'BEGINNER_ASSUMED',
  sectionScores: null,
  ...overrides,
});

const gradedInput = (
  overrides: Partial<GenerateRoadmapInput> = {},
): GenerateRoadmapInput => ({
  goal: 'TOEIC_450',
  estimatedLevel: 'B1',
  levelSource: 'TEST_GRADED',
  sectionScores: {},
  ...overrides,
});

describe('generateRoadmap', () => {
  it('beginner-assumed path: presents pillars in the fixed order', () => {
    const candidates = [
      course('g-old', 'A1', new Date('2024-01-01')),
      course('g-new', 'A1', new Date('2024-06-01')),
      vocabLibrary('v1', null),
      listeningCategory('l1', 'B1'),
    ];
    const items = generateRoadmap(beginnerInput(), candidates);
    expect(items.map((i) => i.pillar)).toEqual(['GRAMMAR', 'VOCABULARY', 'LISTENING']);
    expect(items.map((i) => i.phase)).toEqual([1, 2, 3]);
  });

  // The exact reported bug: goal=FOUNDATION + "start from beginner" must not
  // blindly pick the earliest-ordered course in the pillar — it must prefer
  // the course whose level is closest to the assumed 'A1' baseline. Mirrors
  // the live catalog shape at the time the bug was found: an OLDER,
  // TOEIC-leveled course and a NEWER, A1-leveled foundation course in the
  // same GRAMMAR pillar.
  it('beginner-assumed path: prefers the level-appropriate course over blind createdAt ordering', () => {
    const candidates = [
      course('toeic-grammar', 'B1', new Date('2024-01-01')), // older
      course('foundation-grammar', 'A1', new Date('2024-06-01')), // newer, correct level
    ];
    const items = generateRoadmap(beginnerInput(), candidates);
    expect(items[0].resourceId).toBe('foundation-grammar');
  });

  it('orders pillars weakest-first when the path is test-graded', () => {
    const candidates = [
      course('g1', 'B1', new Date('2024-01-01')),
      vocabLibrary('v1', 'B1'),
      listeningCategory('l1', 'B1'),
    ];
    const items = generateRoadmap(
      gradedInput({
        sectionScores: { GRAMMAR: 75, VOCABULARY: 25, LISTENING: 50 },
      }),
      candidates,
    );
    // VOCABULARY (25%) is weakest -> phase 1, then LISTENING (50%), then
    // GRAMMAR (75%) last.
    expect(items.map((i) => i.pillar)).toEqual(['VOCABULARY', 'LISTENING', 'GRAMMAR']);
    expect(items[0].reason).toContain('Phần yếu nhất');
  });

  it('beginner-assumed reason text never states a percentage (no real score exists)', () => {
    const candidates = [course('g1', 'A1', new Date())];
    const items = generateRoadmap(beginnerInput(), candidates);
    expect(items[0].reason).not.toMatch(/%/);
  });

  it('reason text is Vietnamese and never leaks the old raw-English templates', () => {
    const candidates = [
      course('g1', 'B1', new Date('2024-01-01')),
      vocabLibrary('v1', 'B1'),
      listeningCategory('l1', 'B1'),
    ];
    const items = generateRoadmap(
      gradedInput({
        sectionScores: { GRAMMAR: 75, VOCABULARY: 25, LISTENING: 50 },
      }),
      candidates,
    );
    for (const item of items) {
      expect(item.reason).not.toContain('Weakest section');
      expect(item.reason).not.toContain('Reinforcing');
      expect(item.reason).not.toContain('Starting point');
    }
  });

  it('picks the resource whose level is closest to the estimated level', () => {
    const candidates = [
      course('g-a1', 'A1', new Date('2024-01-01')),
      course('g-b2', 'B2', new Date('2024-01-01')),
      course('g-b1', 'B1', new Date('2024-01-01')),
    ];
    const items = generateRoadmap(
      gradedInput({ sectionScores: { GRAMMAR: 50 } }),
      candidates,
    );
    expect(items.find((i) => i.pillar === 'GRAMMAR')?.resourceId).toBe('g-b1');
  });

  it('falls back to sortKey ordering when no resource in a pillar has a level set', () => {
    const candidates = [
      course('g-new', null, new Date('2024-06-01')),
      course('g-old', null, new Date('2024-01-01')),
    ];
    const items = generateRoadmap(
      gradedInput({ sectionScores: { GRAMMAR: 50 } }),
      candidates,
    );
    expect(items[0].resourceId).toBe('g-old');
  });

  it('omits a pillar entirely when no eligible resource for it exists — never crashes, never substitutes', () => {
    const candidates = [course('g1', 'A1', new Date())];
    const items = generateRoadmap(gradedInput({ estimatedLevel: 'A1' }), candidates);
    expect(items).toHaveLength(1);
    expect(items[0].pillar).toBe('GRAMMAR');
  });

  it('phase numbers are contiguous starting at 1 even when a pillar is omitted', () => {
    const candidates = [
      course('g1', 'A1', new Date()),
      listeningCategory('l1', 'A1'),
    ];
    const items = generateRoadmap(gradedInput({ estimatedLevel: 'A1' }), candidates);
    expect(items.map((i) => i.phase)).toEqual([1, 2]);
  });

  // Acceptance fixture mirroring the real content backfill (see the plan's
  // C.3): FOUNDATION now has a genuine, tagged candidate for all 3 pillars
  // — Course "Ngữ pháp cơ bản" (A1), VocabLibrary "1000 Từ Tiếng Anh Thông
  // Dụng" (A1), ListeningCategory "Daily Conversations" (A1). A
  // FOUNDATION + beginner-skip roadmap must produce all 3 real phases, one
  // per pillar, never collapsing to 1-2 phases the way the original bug did.
  it('FOUNDATION + beginner-assumed produces all 3 pillars when each has a real, tagged candidate', () => {
    const candidates = [
      course('grammar-co-ban', 'A1', new Date('2026-07-26')),
      vocabLibrary('1000-tu-thong-dung', 'A1', 4),
      listeningCategory('daily-conversations', 'A1', 3),
    ];
    const items = generateRoadmap(beginnerInput(), candidates);
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.pillar))).toEqual(
      new Set(['GRAMMAR', 'VOCABULARY', 'LISTENING']),
    );
    expect(items.find((i) => i.pillar === 'GRAMMAR')?.resourceType).toBe('COURSE');
    expect(items.find((i) => i.pillar === 'VOCABULARY')?.resourceType).toBe('VOCAB_LIBRARY');
    expect(items.find((i) => i.pillar === 'LISTENING')?.resourceType).toBe('LISTENING_CATEGORY');
  });

  describe('consolidation phase', () => {
    it('adds a 4th phase revisiting the weakest pillar one level up, after the other three', () => {
      const candidates = [
        course('g1', 'B1', new Date('2024-01-01')),
        vocabLibrary('v1', 'B1'),
        vocabLibrary('v2-b2', 'B2'),
        listeningCategory('l1', 'B1'),
      ];
      const items = generateRoadmap(
        gradedInput({
          sectionScores: { GRAMMAR: 75, VOCABULARY: 25, LISTENING: 50 },
        }),
        candidates,
      );
      // VOCABULARY is weakest (phase 1) -> consolidation revisits VOCABULARY
      // at B2, as the LAST phase.
      expect(items).toHaveLength(4);
      const last = items[items.length - 1];
      expect(last.phase).toBe(4);
      expect(last.pillar).toBe('VOCABULARY');
      expect(last.resourceType).toBe('VOCAB_LIBRARY');
      expect(last.resourceId).toBe('v2-b2');
      expect(last.reason).toContain('Củng cố');
    });

    it('never recommends the SAME resource twice for the consolidation phase', () => {
      const candidates = [
        course('g1', 'B1', new Date('2024-01-01')),
        vocabLibrary('v1', 'B1'), // only B1 available
        listeningCategory('l1', 'B1'),
      ];
      const items = generateRoadmap(
        gradedInput({
          sectionScores: { GRAMMAR: 75, VOCABULARY: 25, LISTENING: 50 },
        }),
        candidates,
      );
      // No OTHER Vocabulary library at B2 exists -> consolidation is omitted
      // rather than recommending v1 (phase 1's own resource) again.
      expect(items).toHaveLength(3);
    });

    it('omits consolidation entirely on the beginner-assumed path (no measured weakest pillar)', () => {
      const candidates = [
        course('g1', 'A1', new Date('2024-01-01')),
        course('g2-a2', 'A2', new Date('2024-01-01')),
      ];
      const items = generateRoadmap(beginnerInput(), candidates);
      expect(items).toHaveLength(1);
    });

    it('omits consolidation when the estimated level is already C2 (nowhere higher to go)', () => {
      const candidates = [
        course('g1', 'C2', new Date('2024-01-01')),
        vocabLibrary('v1', 'C2'), // weakest, but already at the ceiling
        listeningCategory('l1', 'C2'),
      ];
      const items = generateRoadmap(
        gradedInput({
          goal: 'TOEIC_800',
          estimatedLevel: 'C2',
          sectionScores: { GRAMMAR: 80, VOCABULARY: 10, LISTENING: 50 },
        }),
        candidates,
      );
      expect(items).toHaveLength(3); // one per pillar, no 4th consolidation phase
      // "Củng cố" alone also appears in ordinary phase>1 reinforcement text
      // ("Củng cố từ vựng (25%)."); the consolidation-specific phrase is
      // "nâng trình độ" ("level up"), which must be entirely absent here.
      expect(items.every((i) => !i.reason.includes('nâng trình độ'))).toBe(true);
    });

    it('generalizes to a non-Course pillar as the weakest — consolidation revisits Listening', () => {
      const candidates = [
        course('g1', 'B1', new Date('2024-01-01')),
        vocabLibrary('v1', 'B1'),
        listeningCategory('l1', 'B1'),
        listeningCategory('l2-b2', 'B2'),
      ];
      const items = generateRoadmap(
        gradedInput({
          sectionScores: { GRAMMAR: 75, VOCABULARY: 50, LISTENING: 25 },
        }),
        candidates,
      );
      expect(items).toHaveLength(4);
      const last = items[items.length - 1];
      expect(last.pillar).toBe('LISTENING');
      expect(last.resourceType).toBe('LISTENING_CATEGORY');
      expect(last.resourceId).toBe('l2-b2');
    });
  });

  // Acceptance criteria pinned with the product owner: GENERAL_ENGLISH +
  // beginner-skip -> 4 phases, Speaking last. GENERAL_ENGLISH + graded ->
  // 3 pillars + consolidation + Speaking, Speaking still last, up to 5
  // phases. Any other goal -> a `candidates` array with no SPEAKING
  // resource at all (that gating is PlacementService.loadAvailableResources'
  // job, not this function's — see the file header), so Speaking is simply
  // never added.
  describe('SPEAKING pillar', () => {
    it('GENERAL_ENGLISH + beginner-assumed: appends Speaking as phase 4, after the 3 fixed pillars', () => {
      const candidates = [
        course('g1', 'A1', new Date('2024-01-01')),
        vocabLibrary('v1', 'A1'),
        listeningCategory('l1', 'A1'),
        speakingScenario('free-talk'),
      ];
      const items = generateRoadmap(
        beginnerInput({ goal: 'GENERAL_ENGLISH' }),
        candidates,
      );
      expect(items.map((i) => i.pillar)).toEqual([
        'GRAMMAR',
        'VOCABULARY',
        'LISTENING',
        'SPEAKING',
      ]);
      expect(items.map((i) => i.phase)).toEqual([1, 2, 3, 4]);
      const speaking = items[items.length - 1];
      expect(speaking.resourceType).toBe('SPEAKING_SCENARIO');
      expect(speaking.resourceId).toBe('free-talk');
      expect(speaking.reason).not.toMatch(/%/); // never a fabricated score
    });

    it('GENERAL_ENGLISH + graded with consolidation: Speaking is still last, up to 5 phases total', () => {
      const candidates = [
        course('g1', 'B1', new Date('2024-01-01')),
        vocabLibrary('v1', 'B1'),
        vocabLibrary('v2-b2', 'B2'),
        listeningCategory('l1', 'B1'),
        speakingScenario('free-talk'),
      ];
      const items = generateRoadmap(
        gradedInput({
          goal: 'GENERAL_ENGLISH',
          sectionScores: { GRAMMAR: 75, VOCABULARY: 25, LISTENING: 50 },
        }),
        candidates,
      );
      expect(items).toHaveLength(5);
      expect(items.map((i) => i.phase)).toEqual([1, 2, 3, 4, 5]);
      const last = items[items.length - 1];
      expect(last.pillar).toBe('SPEAKING');
      expect(last.resourceId).toBe('free-talk');
    });

    it('never appends Speaking when no SPEAKING candidate is present (any other goal, per the upstream gate)', () => {
      const candidates = [
        course('g1', 'A1', new Date('2024-01-01')),
        vocabLibrary('v1', 'A1'),
        listeningCategory('l1', 'A1'),
      ];
      const items = generateRoadmap(
        beginnerInput({ goal: 'TOEIC_450' }),
        candidates,
      );
      expect(items.some((i) => i.pillar === 'SPEAKING')).toBe(false);
      expect(items).toHaveLength(3);
    });
  });
});
