import { HttpException, HttpStatus } from '@nestjs/common';

// A 409 with a `code` field, not just an HTTP status — the frontend must
// react differently to this than to a version conflict (surface as a
// client bug, never silently retried), so the two need to be
// distinguishable in the response body, not just both "409" (sprint plan
// §10/§14).
export class IdempotencyKeyReusedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'This clientReviewId was already used for a different word/rating/practiceMode. Retry with a new id.',
      },
      HttpStatus.CONFLICT,
    );
  }
}

// A stale optimistic write (UserWordProgress.version moved under us) —
// distinct from IdempotencyKeyReusedException: the frontend's correct
// reaction here is to silently refetch and let the user re-rate, not to
// surface a client-bug-style error (sprint plan §10/§14).
export class ReviewVersionConflictException extends HttpException {
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
