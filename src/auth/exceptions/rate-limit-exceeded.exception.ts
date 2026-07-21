import { HttpException, HttpStatus } from '@nestjs/common';

// The exact 429 body the sprint requires — never exposes which bucket
// tripped, internal counters, or account-existence information.
export class RateLimitExceededException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests. Please try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
