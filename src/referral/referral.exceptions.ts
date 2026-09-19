import { ConflictException } from '@nestjs/common';

// Mirrors PersonalWordAlreadyExistsException's reasoning: Referral.inviteeId
// is @unique, so a second redemption attempt for the same account always
// collides at the database level — surfaced as an explicit 409, never a
// generic 500.
export class ReferralAlreadyRedeemedException extends ConflictException {
  constructor() {
    super('You have already redeemed a referral code.');
  }
}
