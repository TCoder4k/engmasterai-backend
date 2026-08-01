import { TaskSubmitOutcome } from './quiz.types';

// Sprint 10 — the ONE place a TaskSubmitOutcome becomes a wire response.
//
// Shared by QuizStudentController and PracticeController rather than written
// twice: the two submit endpoints must not drift about whether XP is reported,
// and both feed the same client-side toast.
//
// The merge happens at the CONTROLLER EDGE and nowhere deeper. `outcome
// .response` is the object that gets written to LessonTaskAttempt.result and
// LessonTaskProgress.lastSubmitResult and handed back verbatim on a replay; if
// the merge moved into the service, `gamification` would be persisted with it
// and every replay would re-announce an award that never happened.
//
// The wire shape gains exactly one key, so a client built before Sprint 10
// keeps working untouched.
export const toSubmitResponse = (outcome: TaskSubmitOutcome) => ({
  ...outcome.response,
  gamification: outcome.gamification,
});
