import { HttpException, HttpStatus } from '@nestjs/common';

// A password-reset confirmation whose newPassword matches the account's
// current password. Distinct status (409) + an explicit `code`
// discriminator — same pattern as AccountLinkRequiredException. Safe to be
// specific here (unlike the generic invalid/expired/consumed collapse):
// reaching this check already requires a valid, unconsumed, unexpired
// PasswordResetToken, so revealing "you chose the same password" leaks
// nothing about account existence or token validity. The token is
// deliberately NOT consumed when this is thrown — see
// AuthService.resetPassword().
export class PasswordReuseException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'PASSWORD_REUSE',
        message: 'New password must differ from your current password.',
      },
      HttpStatus.CONFLICT,
    );
  }
}
