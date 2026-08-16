import { HttpException, HttpStatus } from '@nestjs/common';

// A stable `code`, not just an HTTP status — the frontend must react to this
// differently than to a generic 403 (send the student back to finish their
// Placement Test, never treat it as a retryable chat error). Same
// {statusCode, code, message} shape as learning.exceptions.ts.
export class AssessmentInProgressException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        code: 'ASSESSMENT_IN_PROGRESS',
        message: 'Engy is unavailable while a Placement Test attempt is in progress.',
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

// A second request for the SAME clientMessageId arrived while the first was
// still generating a reply (see chat-idempotency.store.ts's claim() header
// comment) — the correct response is "retry shortly", not a second, paid
// Gemini call and not silently waiting forever.
export class ChatReplyInProgressException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'CHAT_REPLY_IN_PROGRESS',
        message: 'A reply for this message is already being generated. Please retry shortly.',
      },
      HttpStatus.CONFLICT,
    );
  }
}
