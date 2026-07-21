import { HttpException, HttpStatus } from '@nestjs/common';

// A verified Google email matches an existing local (password-based)
// account with no linked Google identity yet. Distinct status (409, unused
// elsewhere in this API) + an explicit `code` discriminator — apiFetch on
// the frontend only special-cases 401, so every other status would
// otherwise collapse into the same generic error banner every other
// failure takes. Never issued from unauthenticated auto-linking — see
// docs/adr/004-google-auth.md's account-linking policy.
export class AccountLinkRequiredException extends HttpException {
  constructor(email: string) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'ACCOUNT_LINK_REQUIRED',
        message:
          'An account already exists with this email. Log in with your password to link Google.',
        email,
      },
      HttpStatus.CONFLICT,
    );
  }
}
