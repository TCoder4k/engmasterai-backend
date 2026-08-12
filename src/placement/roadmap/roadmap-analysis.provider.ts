import { CefrLevel, CourseType, LearningGoal } from '@prisma/client';

// Personalized Onboarding & Placement Test, Phase 6 — the AI narration seam
// for the deterministic roadmap.
//
// >>> WHY THIS PROVIDER IS STRUCTURALLY INCAPABLE OF ALTERING THE ROADMAP <<<
//
// The roadmap itself — which phases, which courses, in which order — is
// computed entirely by roadmap-algorithm.ts, a pure, deterministic function
// with no AI involved, before this provider is ever called (see
// PlacementService.finalizeNow / startBeginner). This interface receives
// that FINISHED plan as read-only input (`RoadmapAnalysisRequest.phases`)
// and its result type has exactly one field: prose (`summary`). There is no
// course id, no phase number, no reordering anywhere in
// RoadmapAnalysisResult — a model hallucinating a course that does not exist,
// or convincing itself Vocabulary should come before Grammar, has no field
// to write that opinion into. The narrative is advisory only, the same
// guarantee PronunciationFeedbackResult gives the grading path in Shadowing
// (see listening/shadowing/pronunciation-feedback.provider.ts's own header)
// — and for the same reason: keeping "this text cannot change the outcome"
// true at the type level, not merely by convention, means no call site can
// wire it in wrong without the compiler noticing.
//
// A SEPARATE PROVIDER FROM Shadowing's, feature-local rather than shared —
// an explicit project decision (see the plan), not an oversight: the two
// features fail independently (an outage in one must never surface as
// "onboarding is broken" or vice versa), and a shared abstraction over "call
// Gemini with a prompt" would be two lines of savings wrapped around a
// coupling that makes both features harder to change independently.

/** DI token. A string token because the interface is a type and erases at runtime. */
export const ROADMAP_ANALYSIS_PROVIDER = 'ROADMAP_ANALYSIS_PROVIDER';

export interface RoadmapAnalysisSectionScores {
  grammar: number;
  vocabulary: number;
  listening: number;
}

/** One deterministic phase, already joined against a live Course row's title. */
export interface RoadmapAnalysisPhase {
  phase: number;
  courseType: CourseType;
  courseTitle: string;
  reason: string;
}

export interface RoadmapAnalysisRequest {
  goal: LearningGoal;
  estimatedLevel: CefrLevel | null;
  /** Null on the beginner-skip path — no test was ever taken, so there is nothing to score. */
  sectionScores: RoadmapAnalysisSectionScores | null;
  /** The finished, ordered plan. Read-only input — see the file header. */
  phases: RoadmapAnalysisPhase[];
}

export interface RoadmapAnalysisResult {
  /** Plain prose for the student. Never a score, never JSON the client parses. */
  summary: string;
}

/**
 * Every way analysis can fail, as far as the caller needs to care.
 *
 * No UNSUPPORTED_AUDIO kind here, unlike PronunciationFeedbackFailureKind —
 * this provider is given text only, never a recording.
 */
export type RoadmapAnalysisFailureKind =
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'NOT_CONFIGURED';

export class RoadmapAnalysisError extends Error {
  constructor(
    readonly kind: RoadmapAnalysisFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'RoadmapAnalysisError';
  }
}

export interface RoadmapAnalysisProvider {
  /** Which engine produced it. Stored on Roadmap.aiSummaryModel so old narratives stay attributable. */
  readonly model: string;
  generate(request: RoadmapAnalysisRequest): Promise<RoadmapAnalysisResult>;
}
