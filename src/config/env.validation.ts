import * as Joi from 'joi';
import { DEFAULT_REFRESH_TOKEN_TTL_SECONDS } from '../auth/refresh-token.constants';
import { parseAllowedOrigins } from './cors-origins.util';
import { isValidTrustProxyValue } from './trust-proxy.util';

// Single source of truth for security-relevant environment variables
// (Sprint 01C). Wired into `ConfigModule.forRoot({ validationSchema })` in
// app.module.ts — an invalid or missing value fails application startup
// with a named-variable error, rather than misbehaving at request time.
// Error messages below never include the offending value itself, only the
// variable name — secrets must never appear in a startup log line.

const corsOriginsValidator: Joi.CustomValidator<string> = (value, helpers) => {
  try {
    const parsed = parseAllowedOrigins(value);
    if (parsed.length === 0) {
      return helpers.message({
        custom: 'CORS_ALLOWED_ORIGINS must not be empty',
      });
    }
  } catch (error) {
    return helpers.message({ custom: (error as Error).message });
  }
  return value;
};

const trustProxyValidator: Joi.CustomValidator<string> = (value, helpers) => {
  if (!isValidTrustProxyValue(value)) {
    return helpers.message({
      custom:
        'TRUST_PROXY must be "false", a positive hop count (e.g. "1"), or a trusted proxy IP/CIDR — never "true" (trusts every hop unconditionally)',
    });
  }
  return value;
};

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().integer().positive().max(65535).default(3000),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  // Redis connection format only — REDIS_HOST/REDIS_PORT's own fallback
  // defaults ('localhost'/6379) already live in shared/redis/redis.module.ts
  // and are left as the single place that owns them, so they aren't
  // duplicated here.
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),
  REDIS_HOST: Joi.string().min(1).optional(),
  REDIS_PORT: Joi.number().integer().port().optional(),

  // Strict in production (meaningful entropy required); a looser but still
  // non-empty floor in dev/test so existing fixtures aren't broken by this
  // sprint.
  JWT_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().min(16).required(),
  }),
  // Documented-but-unused (auth.service.ts hardcodes the access-token
  // lifetime) — pre-existing, unrelated debt this sprint doesn't fix.
  // Validated only loosely so a typo here can't newly break startup.
  JWT_EXPIRATION: Joi.string().optional(),

  REFRESH_TOKEN_TTL_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(DEFAULT_REFRESH_TOKEN_TTL_SECONDS),

  // Required in production; defaults to the local dev frontend origin
  // otherwise. Never allows a wildcard (see cors-origins.util.ts) —
  // credentials are always enabled, so a wildcard origin is never safe in
  // any environment, not just production.
  CORS_ALLOWED_ORIGINS: Joi.string()
    .custom(corsOriginsValidator, 'CORS allowed-origins validation')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.optional().default('http://localhost:5174'),
    }),

  TRUST_PROXY: Joi.string()
    .custom(trustProxyValidator, 'trust-proxy value validation')
    .optional()
    .default('false'),

  AUTH_LOGIN_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(5),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(60),
  AUTH_LOGIN_IP_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(20),

  AUTH_REGISTER_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(3),
  AUTH_REGISTER_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(3600),
  AUTH_REGISTER_EMAIL_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(5),

  AUTH_REFRESH_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(10),
  AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(60),
  AUTH_REFRESH_IP_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(30),

  // Sprint 02A — Google Sign-In is off by default; enabling it requires a
  // client ID, validated together so a half-configured deployment fails at
  // boot rather than at the first request to /auth/google.
  GOOGLE_AUTH_ENABLED: Joi.boolean().default(false),
  GOOGLE_CLIENT_ID: Joi.string().min(1).when('GOOGLE_AUTH_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  AUTH_GOOGLE_IP_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(30),
  AUTH_GOOGLE_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(60),
  AUTH_GOOGLE_LINK_IP_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(20),
  AUTH_GOOGLE_LINK_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(60),
  // Verified ip+email combo bucket checked inside AuthService.linkGoogle(),
  // not by the guard (see AuthRateLimitGuard) — no window var of its own
  // because it shares AUTH_GOOGLE_LINK_RATE_LIMIT_WINDOW_SECONDS above.
  AUTH_GOOGLE_LINK_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(5),
})
  // Cloudinary/other unrelated vars are intentionally out of this sprint's
  // scope (see docs/sprints/sprint-01C-security-hardening.md) — `unknown`
  // lets them pass through unvalidated rather than failing startup.
  .unknown(true);
