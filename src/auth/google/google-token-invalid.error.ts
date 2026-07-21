import { HttpException, HttpStatus } from '@nestjs/common';

// One generic outcome for every way a Google credential can fail
// verification (bad signature, wrong audience/issuer, expired,
// email_verified=false, missing sub/email) — the caller never learns which
// specific check failed, matching login()'s own enumeration-avoidance
// treatment (Sprint 01C).
export class GoogleTokenInvalidError extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Google sign-in failed',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
