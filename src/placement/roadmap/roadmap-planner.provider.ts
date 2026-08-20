import { CefrLevel, LearningGoal } from '@prisma/client';
import { RoadmapResourceCandidate } from '../roadmap-algorithm';
import { RoadmapAnalysisSectionScores } from './roadmap-analysis.provider';

// POST /placement/roadmap/plan — the AI PLANNING seam. A sibling of
// roadmap-analysis.provider.ts, deliberately a SEPARATE provider/token: this
// one selects/orders real resources (hybrid, AI-assisted) across all three
// pillars (Grammar/Vocabulary/Listening), that one only narrates a plan
// already decided. Splitting them keeps each feature's failure independent
// — see roadmap-analysis.provider.ts's own header for why that independence
// matters — and keeps this file's guarantee narrow and easy to audit on its
// own.
//
// `overallReason` ALSO comes from this same call (not a second Gemini
// round-trip) — a short, whole-plan rationale generated in the SAME
// temperature:0 structured response as `phases`. This is a low-risk
// extension of an already-proven pattern: per-phase `reason` strings are
// already generated at temperature:0 today. `/placement/roadmap/analysis`
// (roadmap-analysis.provider.ts) is deprecated as of this change — nothing
// in the live onboarding/dashboard flow calls it anymore, though it is kept
// in place rather than deleted (see the plan's Open Items).
//
// >>> WHY THIS PROVIDER CANNOT INVENT A RESOURCE <<<
//
// `RoadmapPlanningRequest.candidates` is the CLOSED, already-filtered set
// PlacementService.loadAvailableResources(goal) produced — the SAME set the
// deterministic algorithm itself would choose from (see roadmap-algorithm.ts
// for why there is only one such loader, not two). The model is asked to
// select/order from this set and nothing else. Its result type,
// RoadmapPlanningResult, carries only `resourceType`/`resourceId` (which the
// caller re-validates against that exact candidate set — any pair outside it
// is rejected wholesale, see validate-roadmap-plan.ts) and `reason` (bounded
// prose, never a field the app trusts for anything structural). `phase` and
// `pillar` are NEVER read from the model — the caller derives both from the
// matched candidate and the validated array's own position. A model that
// hallucinates a resource, invents a fourth pillar, or tries to reorder
// itself into a `phase` field has nothing to write that opinion into.

/** DI token. A string token because the interface is a type and erases at runtime. */
export const ROADMAP_PLANNER_PROVIDER = 'ROADMAP_PLANNER_PROVIDER';

export interface RoadmapPlanningRequest {
  goal: LearningGoal;
  estimatedLevel: CefrLevel;
  levelSource: 'BEGINNER_ASSUMED' | 'TEST_GRADED';
  /** Null on the beginner-assumed path — no test was ever taken. */
  sectionScores: RoadmapAnalysisSectionScores | null;
  /** The closed candidate set — see the file header. Never the whole catalog. */
  candidates: RoadmapResourceCandidate[];
}

/** One phase the model chose. Read-only, re-validated by the caller — see the file header. */
export interface RoadmapPlanningPhase {
  resourceType: 'COURSE' | 'VOCAB_LIBRARY' | 'LISTENING_CATEGORY' | 'SPEAKING_SCENARIO';
  resourceId: string;
  reason: string;
}

export interface RoadmapPlanningResult {
  phases: RoadmapPlanningPhase[];
  /** Short, whole-plan rationale — see the file header. Persisted as Roadmap.aiSummary. */
  overallReason: string;
}

/**
 * Every way planning can fail, as far as the caller needs to care.
 *
 * No kind for "returned an invalid/disallowed resource id" — that is not a
 * provider failure, it is an ordinary validation outcome the caller handles
 * by falling back to the deterministic roadmap (see requestRoadmapPlan). This
 * type only covers the model/network genuinely not answering.
 */
export type RoadmapPlanningFailureKind = 'UNAVAILABLE' | 'TIMEOUT' | 'NOT_CONFIGURED';

export class RoadmapPlanningError extends Error {
  constructor(
    readonly kind: RoadmapPlanningFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'RoadmapPlanningError';
  }
}

export interface RoadmapPlannerProvider {
  /** Which engine produced it. Stored on Roadmap.aiPlanningModel so old plans stay attributable. */
  readonly model: string;
  plan(request: RoadmapPlanningRequest): Promise<RoadmapPlanningResult>;
}
