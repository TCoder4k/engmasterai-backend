import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

// A retried submission whose clientAttemptId matches a prior one but whose
// answers differ — the same "this is a client bug, surface it distinctly"
// reasoning as Sprint 04's IdempotencyKeyReusedException, kept as a
// separate class (not a reuse) because quiz attempts and word reviews are
// unrelated domains with their own message text.
export class QuizIdempotencyConflictException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'QUIZ_IDEMPOTENCY_CONFLICT',
        message:
          'This clientAttemptId was already used for a different set of answers. Retry with a new id.',
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class QuizNotPublishedException extends BadRequestException {
  constructor() {
    super(
      'Cannot publish a quiz with zero questions. Add at least one question first.',
    );
  }
}

export class QuizHasAttemptsException extends ConflictException {
  constructor() {
    super(
      'Cannot delete a quiz with existing student attempts. Unpublish it instead.',
    );
  }
}

export class InvalidQuestionContentException extends BadRequestException {
  constructor(index: number, reason: string) {
    super(`Question #${index + 1} is invalid: ${reason}`);
  }
}

// Sprint 06B.5 — an IMMEDIATE-mode attempt finalized before every question
// has a recorded answer. Scoring the unanswered ones as wrong would be a
// silent judgement the student never made, so the attempt is refused
// instead.
export class QuizAttemptIncompleteException extends BadRequestException {
  constructor(remaining: number) {
    super(
      `Cannot finish this quiz yet — ${remaining} question(s) still need an answer.`,
    );
  }
}

// Sprint 06B.5 — POST .../quiz/answer against a quiz whose author chose
// ON_SUBMIT. Per-question grading would reveal the answers that mode
// deliberately withholds until the end, so it is refused rather than
// quietly accepted.
export class QuizNotImmediateFeedbackException extends BadRequestException {
  constructor() {
    super(
      'This quiz reveals results only after the whole attempt is submitted. Use POST /quiz/submit instead.',
    );
  }
}

// Sprint 06C — Trap Hunter reached before any quiz attempt has been
// finished. Traps are derived from a COMPLETED attempt's recorded mistakes,
// so there is genuinely nothing to correct yet. Refused rather than answered
// with an empty set, which would look identical to "you made no mistakes"
// and is the opposite message.
export class TrapHunterNotAvailableException extends BadRequestException {
  constructor() {
    super(
      'Finish the quiz first — Trap Hunter works from the questions you got wrong.',
    );
  }
}

// Sprint 06D — Advanced Practice reached before its prerequisites are met.
//
// Thrown ONLY from the mutating endpoints (start / answer / submit). The GET
// deliberately succeeds and reports `availability: { state: 'blocked' }`
// instead, following the convention Trap Hunter set in Sprint 06C: a read
// that describes why you cannot proceed is more useful than one that refuses
// to answer, and the UI needs the reason to say "clear your traps first"
// rather than showing a generic lock.
//
// `reason` is carried on the body so the client renders the specific blocker
// rather than guessing from the status code.
export type PracticeBlockedReason = 'quiz_not_passed' | 'traps_outstanding';

export class PracticePrerequisitesNotMetException extends ForbiddenException {
  constructor(reason: PracticeBlockedReason) {
    super({
      statusCode: 403,
      error: 'Forbidden',
      reason,
      message:
        reason === 'quiz_not_passed'
          ? 'Pass the lesson quiz before starting Advanced Practice.'
          : 'Clear your remaining traps before starting Advanced Practice.',
    });
  }
}

// Sprint 06D — answer/submit with no attempt in flight. Advanced Practice
// starts explicitly (POST .../practice/start) rather than on read, so an
// answer arriving before that is a client out of sync, not a reason to
// silently create an attempt the student never began.
export class PracticeAttemptNotStartedException extends BadRequestException {
  constructor() {
    super(
      'Start the practice attempt before answering — POST /practice/start.',
    );
  }
}

// Sprint 06C — a hint level this question cannot offer. Levels are built
// only from authored content (see trap-hints.ts), so asking past the end
// means the client is out of sync, not that a hint should be invented to
// satisfy it.
export class TrapHintUnavailableException extends BadRequestException {
  constructor(level: number, available: number) {
    super(
      available === 0
        ? 'This question has no hints available.'
        : `Hint level ${level} does not exist for this question (${available} available).`,
    );
  }
}
