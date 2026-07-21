import { sha256Hex } from '../utils/hash.util';
import {
  RATE_LIMIT_LOGIN_COMBO_PREFIX,
  RATE_LIMIT_LOGIN_IP_PREFIX,
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
