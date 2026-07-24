import { sha256Hex } from '../utils/hash.util';
import {
  RATE_LIMIT_EMAIL_VERIFY_IP_PREFIX,
  RATE_LIMIT_EMAIL_VERIFY_RESEND_IP_PREFIX,
  RATE_LIMIT_EMAIL_VERIFY_RESEND_USER_PREFIX,
  RATE_LIMIT_EMAIL_VERIFY_TOKEN_PREFIX,
  RATE_LIMIT_GOOGLE_IP_PREFIX,
  RATE_LIMIT_GOOGLE_LINK_COMBO_PREFIX,
  RATE_LIMIT_GOOGLE_LINK_IP_PREFIX,
  RATE_LIMIT_LOGIN_COMBO_PREFIX,
  RATE_LIMIT_LOGIN_IP_PREFIX,
  RATE_LIMIT_PASSWORD_FORGOT_COMBO_PREFIX,
  RATE_LIMIT_PASSWORD_FORGOT_IP_PREFIX,
  RATE_LIMIT_PASSWORD_RESET_IP_PREFIX,
  RATE_LIMIT_REFRESH_FAMILY_PREFIX,
  RATE_LIMIT_REFRESH_IP_PREFIX,
  RATE_LIMIT_REGISTER_COMBO_PREFIX,
  RATE_LIMIT_REGISTER_IP_PREFIX,
} from '../auth-redis.constants';

/**
 * `sha256Hex(email)`, truncated to 16 hex chars — the only form of an email
 * address ever written to a rate-limit Redis key or a structured log line.
 * Same truncation length as `hashClientIp` for consistency, not because the
 * two need identical collision resistance.
 */
export const emailHashPrefix = (email: string): string =>
  sha256Hex(email.trim().toLowerCase()).slice(0, 16);

export const loginComboKey = (ipHash: string, emailHash: string): string =>
  `${RATE_LIMIT_LOGIN_COMBO_PREFIX}${ipHash}:${emailHash}`;

export const loginIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_LOGIN_IP_PREFIX}${ipHash}`;

export const registerIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_REGISTER_IP_PREFIX}${ipHash}`;

export const registerComboKey = (ipHash: string, emailHash: string): string =>
  `${RATE_LIMIT_REGISTER_COMBO_PREFIX}${ipHash}:${emailHash}`;

export const refreshFamilyRateLimitKey = (familyId: string): string =>
  `${RATE_LIMIT_REFRESH_FAMILY_PREFIX}${familyId}`;

export const refreshIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_REFRESH_IP_PREFIX}${ipHash}`;

export const googleIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_GOOGLE_IP_PREFIX}${ipHash}`;

export const googleLinkIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_GOOGLE_LINK_IP_PREFIX}${ipHash}`;

// Checked inside AuthService.linkGoogle() itself (not by AuthRateLimitGuard)
// — the guard runs before Google verification, so no *backend-verified*
// email is available to it yet. See auth-redis.constants.ts.
export const googleLinkComboKey = (ipHash: string, emailHash: string): string =>
  `${RATE_LIMIT_GOOGLE_LINK_COMBO_PREFIX}${ipHash}:${emailHash}`;

// sha256Hex(token), truncated to 16 hex chars — the only form a raw
// email-verification token ever takes in a Redis key. Same truncation
// convention as emailHashPrefix/hashClientIp; never the raw token itself.
export const tokenHashPrefix = (token: string): string =>
  sha256Hex(token).slice(0, 16);

// Checked inside AuthService.resendVerification() itself (not by
// AuthRateLimitGuard) — the guard runs before JwtAuthGuard for this route
// (class-level guards always precede method-level ones), so req.user isn't
// populated yet when the guard evaluates. See auth-redis.constants.ts.
export const emailVerifyResendUserKey = (userId: string): string =>
  `${RATE_LIMIT_EMAIL_VERIFY_RESEND_USER_PREFIX}${userId}`;

export const emailVerifyResendIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_EMAIL_VERIFY_RESEND_IP_PREFIX}${ipHash}`;

export const emailVerifyIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_EMAIL_VERIFY_IP_PREFIX}${ipHash}`;

export const emailVerifyTokenKey = (tokenHash: string): string =>
  `${RATE_LIMIT_EMAIL_VERIFY_TOKEN_PREFIX}${tokenHash}`;

// Sprint 02C — checked directly by AuthRateLimitGuard (both keys are
// derivable pre-verification: IP always, and the submitted email is present
// in the forgot-password body itself — unlike /auth/google, there's no
// unverified-JWT-claim concern here since the email is the literal input,
// not an attacker-controlled claim being decoded early).
export const passwordForgotIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_PASSWORD_FORGOT_IP_PREFIX}${ipHash}`;

export const passwordForgotComboKey = (
  ipHash: string,
  emailHash: string,
): string => `${RATE_LIMIT_PASSWORD_FORGOT_COMBO_PREFIX}${ipHash}:${emailHash}`;

export const passwordResetIpKey = (ipHash: string): string =>
  `${RATE_LIMIT_PASSWORD_RESET_IP_PREFIX}${ipHash}`;
