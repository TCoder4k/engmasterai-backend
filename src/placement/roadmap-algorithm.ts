import { CefrLevel, CourseType, LearningGoal } from '@prisma/client';
import { PLACEMENT_SECTIONS } from './placement.constants';

// Pure function, no I/O — mirrors grade-question.ts/placement-scoring.ts's
// own discipline. PlacementService is the only caller; it loads resources
// and hands them in. GET /placement/roadmap (placement.service.ts's
// getRoadmap) joins these items against LIVE Course/VocabLibrary/
// ListeningCategory rows for display data on every read — this function
// itself never returns a title/thumbnail (see RoadmapItem below), so a
// renamed or unpublished resource is never served stale from a snapshot.

// Multi-pillar roadmap: each of the three CourseType pillars (Grammar/
// Vocabulary/Listening) is backed by a DIFFERENT resource table, with a
// fixed 1:1 mapping — GRAMMAR -> Course, VOCABULARY -> VocabLibrary,
// LISTENING -> ListeningCategory. Library/category is the roadmap-item
// granularity (not VocabDeck/ListeningContent), which is why this candidate
// shape is deliberately display-level, not lesson-level.
//
// SPEAKING is a fourth, OPTIONAL pillar layered on top — deliberately NOT a
// CourseType member (that enum also backs Course.type and
// PlacementQuestion.section, neither of which Speaking participates in; see
// PlacementService.loadAvailableResources for why it's queried as a
// completely separate, fail-closed candidate source). It never appears in
// PLACEMENT_SECTIONS and is never placement-tested.
export type RoadmapPillar = CourseType | 'SPEAKING';
export type RoadmapResourceType =
  | 'COURSE'
  | 'VOCAB_LIBRARY'
  | 'LISTENING_CATEGORY'
  | 'SPEAKING_SCENARIO';

// Extends the shape used elsewhere (display-only fields) rather than a
// second, separately-maintained "candidate" type — the AI planner's prompt
// builder (roadmap/roadmap-planner.provider.ts) consumes the exact same
// objects this function does, from the exact same
// PlacementService.loadAvailableResources(goal) call, already goal-filtered
// at the query level. This function itself never reads suitableGoals/
// title/description; it just carries them through untouched for that other
// consumer.
//
// `sortKey` normalizes each source's own strongest "authorial order" signal
// into one comparable number: Course has no orderIndex, so its createdAt
// (earlier-authored = more foundational, the same implicit assumption
// GrammarCourseCard's title-regex level parsing already makes) is used;
// VocabLibrary/ListeningCategory both have a real, admin-controlled
// orderIndex, which is a stronger signal than their createdAt would be.
export interface RoadmapResourceCandidate {
  resourceType: RoadmapResourceType;
  id: string;
  pillar: RoadmapPillar;
  level: CefrLevel | null;
  sortKey: number;
  title: string;
  description: string;
  suitableGoals: LearningGoal[];
}

export interface RoadmapItem {
  phase: number;
  pillar: RoadmapPillar;
  resourceType: RoadmapResourceType;
  resourceId: string;
  reason: string;
}

export interface GenerateRoadmapInput {
  goal: LearningGoal;
  // Always a real value now — 'A1' on the beginner-skip path (see
  // PlacementService.startBeginner), the graded estimate on the test path.
  // Whether it's backed by real section scores is `levelSource`'s job to
  // say, not this field's nullability.
  estimatedLevel: CefrLevel;
  // BEGINNER_ASSUMED: the student chose to skip the test — there is no
  // measured weak section, so every pillar is presented in the fixed
  // PLACEMENT_SECTIONS order and `sectionScores` is null. TEST_GRADED: real
  // scores exist and drive weakest-first ordering + the consolidation phase.
  levelSource: 'BEGINNER_ASSUMED' | 'TEST_GRADED';
  sectionScores: Partial<Record<CourseType, number>> | null;
}

const LEVEL_ORDER: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const PILLAR_LABELS: Record<RoadmapPillar, string> = {
  GRAMMAR: 'ngữ pháp',
  VOCABULARY: 'từ vựng',
  LISTENING: 'kỹ năng nghe',
  SPEAKING: 'giao tiếp',
};

// Prefers the resource whose level is closest to the student's estimated
// level (ties broken toward the smallest sortKey — the earliest-authored
// course, or the lowest admin-ordered library/category). Falls back to
// sortKey ordering only when NO resource in this pillar has a level set yet
// — level adoption is still in progress (some resources may never get
// tagged), and an unleveled catalog must still produce SOME roadmap rather
// than an empty one. Goal suitability is already filtered out of
// `candidates` before this runs (see
// PlacementService.loadAvailableResources) — this function only ever sees
// candidates the student's goal actually allows.
const pickResource = (
  pillar: RoadmapPillar,
  estimatedLevel: CefrLevel,
  candidates: RoadmapResourceCandidate[],
): RoadmapResourceCandidate | null => {
  const inPillar = candidates.filter((c) => c.pillar === pillar);
  if (inPillar.length === 0) return null;

  const bySortKey = (a: RoadmapResourceCandidate, b: RoadmapResourceCandidate) =>
    a.sortKey - b.sortKey;

  const leveled = inPillar.filter(
    (c): c is RoadmapResourceCandidate & { level: CefrLevel } => c.level !== null,
  );
  if (leveled.length === 0) {
    return [...inPillar].sort(bySortKey)[0];
  }

  const targetIndex = LEVEL_ORDER.indexOf(estimatedLevel);
  return [...leveled].sort((a, b) => {
    const distanceA = Math.abs(LEVEL_ORDER.indexOf(a.level) - targetIndex);
    const distanceB = Math.abs(LEVEL_ORDER.indexOf(b.level) - targetIndex);
    return distanceA !== distanceB ? distanceA - distanceB : bySortKey(a, b);
  })[0];
};

// Sections are always presented weakest-first on the graded path (see the
// sort in generateRoadmap), so only phase 1's text says "weakest" — later
// phases describe their own score without implying every phase is also the
// weakest one. On the beginner-assumed path there are no real scores to
// name, so the reason stays a plain, honest "starting point" rather than
// inventing a percentage.
//
// Vietnamese, not a hardcoded English template — this is the deterministic
// FALLBACK path (used whenever AI planning is unavailable/invalid), and it
// must never leak raw English into an otherwise Vietnamese-language UI.
// Stays provider-agnostic (zero dependency on any Gemini file): pillar
// labels are defined locally rather than imported from
// gemini-roadmap-analysis.provider.ts's GOAL_LABELS, since this function
// must keep working even when AI is entirely disabled.
const buildReason = (
  pillar: RoadmapPillar,
  phase: number,
  levelSource: 'BEGINNER_ASSUMED' | 'TEST_GRADED',
  sectionScores: Partial<Record<CourseType, number>> | null,
): string => {
  const label = PILLAR_LABELS[pillar];
  if (levelSource === 'BEGINNER_ASSUMED') {
    return `Điểm khởi đầu cho phần ${label}.`;
  }
  const score = sectionScores?.[pillar] ?? 0;
  return phase === 1
    ? `Phần yếu nhất (${score}%) — nên học trước.`
    : `Củng cố ${label} (${score}%).`;
};

// Speaking never has a section score — it is never placement-tested (see
// PLACEMENT_SECTIONS) — so, unlike buildReason, this never renders a
// percentage. Fixed copy, not templated by levelSource/phase: the pitch for
// "practice speaking naturally with an AI partner" doesn't change based on
// where in the roadmap it lands.
const buildSpeakingReason = (): string =>
  'Giao tiếp tự nhiên với AI Partner — luyện phản xạ nói mỗi ngày.';

const nextLevelUp = (level: CefrLevel): CefrLevel | null => {
  const index = LEVEL_ORDER.indexOf(level);
  return index >= 0 && index < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[index + 1] : null;
};

// Consolidation phase: after the three pillars have each had one phase
// (weakest first), add ONE final phase that revisits the ORIGINAL weakest
// pillar one CEFR level up from whatever was picked for phase 1 —
// reinforcing the area the student struggled with most instead of leaving
// it at a single touchpoint. Graded path only (levelSource === 'TEST_GRADED'):
// the beginner-assumed path has no measured "weakest section" to reinforce
// — every pillar there ties at zero real score — and every pillar
// already got exactly one phase for the same reason.
//
// Returns null (no crash, no partial item) when: the weakest pillar never
// got a phase 1 item to begin with, the student is already at C2 (nowhere
// higher to go), or the catalog has no OTHER resource one level up in that
// pillar — a short catalog is a content gap, not a reason to fail
// generation.
const buildConsolidationItem = (
  weakestPillar: RoadmapPillar,
  weakestItem: RoadmapItem | undefined,
  estimatedLevel: CefrLevel,
  candidates: RoadmapResourceCandidate[],
  phase: number,
): RoadmapItem | null => {
  if (!weakestItem) return null;
  const targetLevel = nextLevelUp(estimatedLevel);
  if (!targetLevel) return null;

  const eligible = candidates.filter(
    (c) =>
      c.pillar === weakestPillar &&
      c.level === targetLevel &&
      c.id !== weakestItem.resourceId,
  );
  if (eligible.length === 0) return null;

  const resource = [...eligible].sort((a, b) => a.sortKey - b.sortKey)[0];
  const label = PILLAR_LABELS[weakestPillar];
  return {
    phase,
    pillar: weakestPillar,
    resourceType: resource.resourceType,
    resourceId: resource.id,
    reason: `Củng cố: nâng trình độ ${label} (${estimatedLevel} → ${targetLevel}).`,
  };
};

export const generateRoadmap = (
  input: GenerateRoadmapInput,
  availableResources: RoadmapResourceCandidate[],
): RoadmapItem[] => {
  const orderedPillars =
    input.levelSource === 'BEGINNER_ASSUMED'
      ? [...PLACEMENT_SECTIONS]
      : [...PLACEMENT_SECTIONS].sort(
          (a, b) =>
            (input.sectionScores?.[a] ?? 0) - (input.sectionScores?.[b] ?? 0),
        );

  const items: RoadmapItem[] = [];
  let phase = 1;
  for (const pillar of orderedPillars) {
    const resource = pickResource(pillar, input.estimatedLevel, availableResources);
    // No published, goal-eligible resource for this pillar exists yet — the
    // item is omitted, not a crash. A short catalog is a content gap, not a
    // reason to fail roadmap generation entirely.
    if (!resource) continue;
    items.push({
      phase,
      pillar,
      resourceType: resource.resourceType,
      resourceId: resource.id,
      reason: buildReason(pillar, phase, input.levelSource, input.sectionScores),
    });
    phase += 1;
  }

  if (input.levelSource === 'TEST_GRADED' && orderedPillars.length > 0) {
    const weakestPillar = orderedPillars[0];
    const weakestItem = items.find((i) => i.pillar === weakestPillar);
    const consolidation = buildConsolidationItem(
      weakestPillar,
      weakestItem,
      input.estimatedLevel,
      availableResources,
      phase,
    );
    if (consolidation) {
      items.push(consolidation);
      phase += 1;
    }
  }

  // Speaking: always attempted LAST, after the 3 fixed pillars and the
  // optional consolidation phase — never conditioned on goal here (that
  // gating already happened upstream, at the query level, in
  // PlacementService.loadAvailableResources: availableResources only ever
  // contains a SPEAKING candidate when the caller's goal is
  // GENERAL_ENGLISH). Omitted, not a crash, when no eligible candidate
  // exists — same "content gap, not a failure" discipline as every other
  // pillar above.
  const speakingResource = pickResource('SPEAKING', input.estimatedLevel, availableResources);
  if (speakingResource) {
    items.push({
      phase,
      pillar: 'SPEAKING',
      resourceType: speakingResource.resourceType,
      resourceId: speakingResource.id,
      reason: buildSpeakingReason(),
    });
  }

  return items;
};
