import { HttpException, HttpStatus } from '@nestjs/common';

// Same 409-with-`code` shape as learning.exceptions.ts's
// IdempotencyKeyReusedException, module-local rather than shared — the
// frontend must react differently to this than to a version conflict.
export class PersonalReviewIdempotencyKeyReusedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'This clientReviewId was already used for a different word/rating. Retry with a new id.',
      },
      HttpStatus.CONFLICT,
    );
  }
}

// A stale optimistic write (PersonalVocabWord.version moved under us) — same
// role as learning.exceptions.ts's ReviewVersionConflictException. The
// correct client reaction is a silent refetch-and-retry, not surfacing a
// client-bug-style error.
export class PersonalWordVersionConflictException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'VERSION_CONFLICT',
        message:
          'This word was updated by another request. Refetch its current state and try again.',
      },
      HttpStatus.CONFLICT,
    );
  }
}

// A rename (PATCH text) or single add (POST) collided with an existing word
// for this user — the same @@unique([userId, textNormalized]) constraint
// bulk import dedups against, surfaced here as an explicit 409 rather than
// a generic 500 (see isUniqueConstraintViolation usage in the service).
export class PersonalWordAlreadyExistsException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'WORD_ALREADY_EXISTS',
        message: 'This word is already in your personal vocabulary list.',
      },
      HttpStatus.CONFLICT,
    );
  }
}
