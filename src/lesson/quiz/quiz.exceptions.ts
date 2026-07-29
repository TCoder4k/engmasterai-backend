import {
  BadRequestException,
  ConflictException,
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
