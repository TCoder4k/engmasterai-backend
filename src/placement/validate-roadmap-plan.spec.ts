import {
  RoadmapPillar,
  RoadmapResourceCandidate,
  RoadmapResourceType,
} from './roadmap-algorithm';
import { validateRoadmapPlan, MAX_PLAN_PHASES } from './validate-roadmap-plan';
import { RoadmapPlanningResult } from './roadmap/roadmap-planner.provider';

const candidate = (
  id: string,
  resourceType: RoadmapResourceType = 'COURSE',
  pillar: RoadmapPillar = 'GRAMMAR',
): RoadmapResourceCandidate => ({
  resourceType,
  id,
  pillar,
  level: 'A1',
  sortKey: 0,
  title: id,
  description: '',
  suitableGoals: [],
});

const plan = (
  phases: RoadmapPlanningResult['phases'],
  overallReason = 'Overall reason.',
): RoadmapPlanningResult => ({ phases, overallReason });

describe('validateRoadmapPlan', () => {
  it('accepts a plan entirely within the candidate set, deriving phase/pillar/resourceType server-side', () => {
    const candidates = [
      candidate('c1', 'COURSE', 'GRAMMAR'),
      candidate('c2', 'VOCAB_LIBRARY', 'VOCABULARY'),
    ];
    const result = validateRoadmapPlan(
      plan(
        [
          { resourceType: 'COURSE', resourceId: 'c1', reason: 'Fits.' },
          { resourceType: 'VOCAB_LIBRARY', resourceId: 'c2', reason: 'Also fits.' },
        ],
        'Whole-plan rationale.',
      ),
      candidates,
    );
    expect(result).toEqual({
      items: [
        { phase: 1, pillar: 'GRAMMAR', resourceType: 'COURSE', resourceId: 'c1', reason: 'Fits.' },
        { phase: 2, pillar: 'VOCABULARY', resourceType: 'VOCAB_LIBRARY', resourceId: 'c2', reason: 'Also fits.' },
      ],
      overallReason: 'Whole-plan rationale.',
    });
  });

  // THE core guarantee: nothing from the model except resourceType/
  // resourceId/reason ever reaches the persisted RoadmapItem — phase is the
  // array's own position, pillar/resourceType are re-asserted from the
  // matched candidate, never copied from the model's own claim.
  it('derives pillar/resourceType from the CANDIDATE, never from anything the model might have said', () => {
    const candidates = [candidate('c1', 'LISTENING_CATEGORY', 'LISTENING')];
    const result = validateRoadmapPlan(
      plan([{ resourceType: 'LISTENING_CATEGORY', resourceId: 'c1', reason: 'x' }]),
      candidates,
    );
    expect(result!.items[0].pillar).toBe('LISTENING');
    expect(result!.items[0].resourceType).toBe('LISTENING_CATEGORY');
  });

  it('rejects the WHOLE plan (no partial application) when any resourceId is outside the candidate set', () => {
    const candidates = [candidate('c1'), candidate('c2')];
    const result = validateRoadmapPlan(
      plan([
        { resourceType: 'COURSE', resourceId: 'c1', reason: 'Fits.' },
        { resourceType: 'COURSE', resourceId: 'not-a-candidate', reason: 'Hallucinated.' },
      ]),
      candidates,
    );
    expect(result).toBeNull();
  });

  // The composite-key guarantee: a resourceId that IS real but claimed under
  // the WRONG resourceType must be rejected just as hard as an id that
  // doesn't exist at all — checking id alone would let this through.
  it('rejects a plan whose resourceId matches a real candidate but under the wrong resourceType', () => {
    const candidates = [candidate('shared-id', 'VOCAB_LIBRARY', 'VOCABULARY')];
    const result = validateRoadmapPlan(
      plan([{ resourceType: 'COURSE', resourceId: 'shared-id', reason: 'x' }]),
      candidates,
    );
    expect(result).toBeNull();
  });

  it('rejects the whole plan on a duplicate resourceType:resourceId pair', () => {
    const candidates = [candidate('c1')];
    const result = validateRoadmapPlan(
      plan([
        { resourceType: 'COURSE', resourceId: 'c1', reason: 'First.' },
        { resourceType: 'COURSE', resourceId: 'c1', reason: 'Again.' },
      ]),
      candidates,
    );
    expect(result).toBeNull();
  });

  it('rejects an empty plan', () => {
    expect(validateRoadmapPlan(plan([]), [candidate('c1')])).toBeNull();
  });

  it(`rejects a plan longer than MAX_PLAN_PHASES (${MAX_PLAN_PHASES})`, () => {
    const candidates = Array.from({ length: MAX_PLAN_PHASES + 1 }, (_, i) =>
      candidate(`c${i}`),
    );
    const phases = candidates.map((c) => ({
      resourceType: c.resourceType,
      resourceId: c.id,
      reason: 'x',
    }));
    expect(validateRoadmapPlan(plan(phases), candidates)).toBeNull();
  });

  // Pillar-coverage guarantee: the AI must not be able to silently turn a
  // genuine 3-pillar roadmap into a 1- or 2-pillar one by simply omitting a
  // phase for a pillar it had a valid, eligible candidate for. The
  // allow-list check alone would NOT catch this — everything it DID return
  // is perfectly valid, it just left something out.
  it('rejects the whole plan when the AI drops a pillar that had a real, eligible candidate', () => {
    const candidates = [
      candidate('c1', 'COURSE', 'GRAMMAR'),
      candidate('c2', 'VOCAB_LIBRARY', 'VOCABULARY'),
      candidate('c3', 'LISTENING_CATEGORY', 'LISTENING'),
    ];
    const result = validateRoadmapPlan(
      plan([
        { resourceType: 'COURSE', resourceId: 'c1', reason: 'x' },
        { resourceType: 'VOCAB_LIBRARY', resourceId: 'c2', reason: 'y' },
        // LISTENING dropped despite c3 being a valid, eligible candidate.
      ]),
      candidates,
    );
    expect(result).toBeNull();
  });

  it('accepts a plan covering every available pillar exactly once, even across 3 different resourceTypes', () => {
    const candidates = [
      candidate('c1', 'COURSE', 'GRAMMAR'),
      candidate('c2', 'VOCAB_LIBRARY', 'VOCABULARY'),
      candidate('c3', 'LISTENING_CATEGORY', 'LISTENING'),
    ];
    const result = validateRoadmapPlan(
      plan([
        { resourceType: 'COURSE', resourceId: 'c1', reason: 'x' },
        { resourceType: 'VOCAB_LIBRARY', resourceId: 'c2', reason: 'y' },
        { resourceType: 'LISTENING_CATEGORY', resourceId: 'c3', reason: 'z' },
      ]),
      candidates,
    );
    expect(result?.items).toHaveLength(3);
  });

  // Speaking-last is a PRODUCT INVARIANT, not just a prompt suggestion —
  // mirrors roadmap-algorithm.ts's deterministic generateRoadmap, which
  // always appends Speaking after every other phase. A model could return a
  // perfectly valid, non-duplicate, fully-covering plan that simply places
  // Speaking in the wrong position; this must be rejected just as hard as a
  // hallucinated resource.
  describe('Speaking-last invariant', () => {
    const grammar = candidate('c1', 'COURSE', 'GRAMMAR');
    const vocab = candidate('c2', 'VOCAB_LIBRARY', 'VOCABULARY');
    const listening = candidate('c3', 'LISTENING_CATEGORY', 'LISTENING');
    const speaking = candidate('c4', 'SPEAKING_SCENARIO', 'SPEAKING');

    it('rejects the whole plan when Speaking is NOT the last phase', () => {
      const candidates = [grammar, vocab, listening, speaking];
      const result = validateRoadmapPlan(
        plan([
          { resourceType: 'COURSE', resourceId: 'c1', reason: 'x' },
          { resourceType: 'VOCAB_LIBRARY', resourceId: 'c2', reason: 'y' },
          { resourceType: 'SPEAKING_SCENARIO', resourceId: 'c4', reason: 'z' },
          { resourceType: 'LISTENING_CATEGORY', resourceId: 'c3', reason: 'w' },
        ]),
        candidates,
      );
      expect(result).toBeNull();
    });

    it('accepts the plan when Speaking IS the last phase', () => {
      const candidates = [grammar, vocab, listening, speaking];
      const result = validateRoadmapPlan(
        plan([
          { resourceType: 'COURSE', resourceId: 'c1', reason: 'x' },
          { resourceType: 'VOCAB_LIBRARY', resourceId: 'c2', reason: 'y' },
          { resourceType: 'LISTENING_CATEGORY', resourceId: 'c3', reason: 'w' },
          { resourceType: 'SPEAKING_SCENARIO', resourceId: 'c4', reason: 'z' },
        ]),
        candidates,
      );
      expect(result?.items.map((i) => i.pillar)).toEqual([
        'GRAMMAR',
        'VOCABULARY',
        'LISTENING',
        'SPEAKING',
      ]);
    });
  });
});
