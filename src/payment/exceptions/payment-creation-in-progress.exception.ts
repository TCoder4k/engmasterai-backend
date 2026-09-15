import { HttpException, HttpStatus } from '@nestjs/common';

// A second POST /payments for the same user+plan arrived while the create
// lock (see payment-redis.constants.ts's paymentCreateLockKey) was still
// held and the poll budget ran out — mirrors ChatReplyInProgressException's
// role exactly (src/chat/chat.exceptions.ts): "retry shortly", not a second
// row and not blocking indefinitely. In practice this should be vanishingly
// rare (the lock is held for a single findFirst+create, milliseconds) —
// seeing this in production suggests something is holding the lock far
// longer than expected, not routine contention.
export class PaymentCreationInProgressException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'PAYMENT_CREATION_IN_PROGRESS',
        message:
          'A payment order is already being created for this plan. Please retry shortly.',
      },
      HttpStatus.CONFLICT,
    );
  }
}
