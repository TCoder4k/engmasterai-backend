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

  // Cloudflare Turnstile on /auth/register (2026-08-25) — off by default,
  // same conditional pattern as GOOGLE_AUTH_ENABLED. The per-IP rate limits
  // above are keyed per-IP and were bypassed by a bot rotating source IPs;
  // this is a complementary human-verification layer, not a replacement.
  TURNSTILE_ENABLED: Joi.boolean().default(false),
  TURNSTILE_SECRET_KEY: Joi.string().min(1).when('TURNSTILE_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  TURNSTILE_VERIFY_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(30000)
    .default(5000),

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

  // Sprint 02B — transactional email + email verification. Off by default;
  // the whole app boots with zero mail configuration and email-dependent
  // endpoints fail closed (503) rather than attempting a real provider
  // request. Enabling requires provider credentials + FRONTEND_APP_URL,
  // validated together so a half-configured deployment fails at boot rather
  // than at the first send (same conditional pattern as GOOGLE_AUTH_ENABLED).
  EMAIL_ENABLED: Joi.boolean().default(false),
  // Only 'brevo' has a real adapter today (BrevoMailProvider) — Resend and
  // SendGrid were both tried and removed the same day, 2026-08-20 (see
  // docs/memory.md). Widen this enum again only alongside a new
  // MailProvider class in src/mail/providers/.
  EMAIL_PROVIDER: Joi.string()
    .valid('brevo')
    .when('EMAIL_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  EMAIL_FROM: Joi.string().email().when('EMAIL_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  EMAIL_FROM_NAME: Joi.string().min(1).when('EMAIL_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  // Never exposed to the frontend — backend-only, read exclusively by
  // BrevoMailProvider.
  EMAIL_PROVIDER_API_KEY: Joi.string().min(1).when('EMAIL_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  // Canonical single application URL used to build links embedded in
  // outgoing emails — deliberately distinct from CORS_ALLOWED_ORIGINS (an
  // allowlist array serving a different purpose; see
  // docs/sprints/sprint-02B-email-verification.md's Environment Variables
  // section for why the two are not conflated).
  FRONTEND_APP_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('EMAIL_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional().default('http://localhost:5174'),
    }),
  EMAIL_PROVIDER_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(30000)
    .default(5000),
  EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: Joi.number()
    .integer()
    .min(5)
    .max(1440)
    .default(30),

  // Resend: guard-level IP bucket + a service-level user-scoped bucket
  // (checked inside AuthService.resendVerification(), not the guard — same
  // reason /auth/google/link's combo bucket is service-level: the class-level
  // AuthRateLimitGuard always runs before a method-level JwtAuthGuard, so
  // req.user isn't populated yet when the guard evaluates).
  AUTH_EMAIL_VERIFY_RESEND_USER_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(3),
  AUTH_EMAIL_VERIFY_RESEND_IP_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(10),
  AUTH_EMAIL_VERIFY_RESEND_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(900),

  // Verify: guard-level IP bucket + a guard-level token-hash-prefix bucket
  // (bounds repeated attempts against one specific link — brute-forcing the
  // 256-bit token itself remains cryptographically infeasible regardless).
  AUTH_EMAIL_VERIFY_IP_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(30),
  AUTH_EMAIL_VERIFY_TOKEN_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(10),
  AUTH_EMAIL_VERIFY_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(900),

  // Sprint 02C — forgot password / password reset. No feature flag of its
  // own; reuses EMAIL_ENABLED directly (see docs/sprints/sprint-02C-...md's
  // Endpoint Contracts — the two global modes are governed by that one
  // switch, never a separate PASSWORD_RESET_ENABLED).
  PASSWORD_RESET_TOKEN_TTL_MINUTES: Joi.number()
    .integer()
    .min(5)
    .max(1440)
    .default(30),

  // Forgot: guard-level IP bucket + a normalized-email-hash combo bucket.
  AUTH_PASSWORD_FORGOT_IP_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(10),
  AUTH_PASSWORD_FORGOT_EMAIL_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(3),
  AUTH_PASSWORD_FORGOT_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(3600),

  // Reset: guard-level IP bucket only — no token-hash bucket (256-bit token
  // space already makes brute force infeasible) and no combo bucket (the
  // endpoint sets newPassword, it never verifies a guess against one).
  AUTH_PASSWORD_RESET_IP_RATE_LIMIT_MAX: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(20),
  AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(300),

  // Revision 3 — the escape hatch documented in ADR 006 / the sprint doc's
  // "Google-Only Account Policy": true sends a distinct instructional email
  // to a Google-only account's own verified mailbox; false silently ignores
  // such requests instead (no mail call at all), for deployments prioritizing
  // minimal outbound email. Either way the API response is unaffected.
  PASSWORD_RESET_GOOGLE_NOTICE_ENABLED: Joi.boolean().default(true),

  // Sprint 06B — Lesson Quiz Engine. Fallback used whenever a quiz's own
  // LessonTask.passingScorePercent is null; never a hardcoded 80% in code.
  // A per-quiz override always wins over this default (see QuizService).
  QUIZ_DEFAULT_PASSING_SCORE_PERCENT: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(70),

  // Sprint 11 Phase 4B — Shadowing speech-to-text.
  //
  // OPTIONAL, and deliberately not `.required()`. A deployment without a key
  // must still boot: every other module works, and Shadowing reports itself
  // unavailable at the point of use rather than taking the whole API down.
  // Failing startup here would make one optional feature's configuration a
  // hard dependency of the login page.
  GEMINI_API_KEY: Joi.string().allow('').optional(),

  // gemini-3.6-flash, not gemini-2.5-flash (2026-09-04 incident — see
  // GEMINI_ENGY_MODEL's comment below for the root cause). Verified this
  // model still accepts audio inline_data the same way before switching:
  // a real WAV sample sent with this exact request shape came back
  // correctly transcribed, with usageMetadata reporting an AUDIO-modality
  // token count — not silently ignored as text.
  GEMINI_STT_MODEL: Joi.string().default('gemini-3.6-flash'),

  // Bounded, always. Without a ceiling a hung provider holds the student's
  // request, their browser and a server connection until something else gives
  // up first.
  SHADOWING_STT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(60000)
    .default(20000),

  // PROVISIONAL. 70 matches QUIZ_DEFAULT_PASSING_SCORE_PERCENT because that is
  // this codebase's existing answer to "good enough", NOT because anyone has
  // measured what a competent learner scores against this engine. Every
  // attempt records the threshold it was judged against, so tuning this cannot
  // silently rewrite the meaning of scores already given.
  SHADOWING_PASSING_ACCURACY_PERCENT: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(70),

  // Sprint 11 Phase 4C — AI pronunciation feedback.
  //
  // Its own model variable, sharing GEMINI_API_KEY. Separate because the two
  // calls have different jobs: transcription wants the cheapest model that
  // hears accurately, coaching wants the one that writes usefully, and pinning
  // both to one name would force an operator to trade one against the other.
  // gemini-3.6-flash, not gemini-2.5-flash — same 2026-09-04 audio
  // compatibility verification as GEMINI_STT_MODEL above.
  GEMINI_FEEDBACK_MODEL: Joi.string().default('gemini-3.6-flash'),

  SHADOWING_FEEDBACK_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(60000)
    .default(25000),

  // Floating Dictionary, Phase A. Shares GEMINI_API_KEY; the translation
  // model is deliberately its own variable (not reusing GEMINI_STT_MODEL/
  // GEMINI_FEEDBACK_MODEL) for the same reason those two are separate from
  // each other — different jobs should stay independently tunable.
  // gemini-3.6-flash, not gemini-3.5-flash-lite (2026-09-04 incident):
  // Google's 3.5 line started returning 503 "high demand" for this key —
  // confirmed by curling generateContent directly for every model this
  // provider could plausibly use — while 3.6-flash answered 200 every
  // time; Google's own 404 body for the now-fully-retired gemini-2.5-flash
  // explicitly names gemini-3.6-flash as the replacement. Text-only call
  // (no inline_data/audio part here), so this swap needed no further
  // compatibility check.
  GEMINI_DICTIONARY_TRANSLATION_MODEL: Joi.string().default(
    'gemini-3.6-flash',
  ),
  DICTIONARY_TRANSLATION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(30000)
    .default(10000),
  DICTIONARY_SOURCE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(30000)
    .default(8000),
  // TTL for a tier-3 (external) lookup cached in Redis. Long by design — a
  // dictionary entry is close to immutable, unlike a rate-limit window or a
  // session. 30 days default; bounded 1–90 days.
  DICTIONARY_CACHE_TTL_SECONDS: Joi.number()
    .integer()
    .min(86400)
    .max(7776000)
    .default(2592000),

  // Engy Chat, Phase B. Shares GEMINI_API_KEY; its own model variable for
  // the same reason Dictionary's translation model is its own — a
  // conversational-prose job should stay independently tunable from
  // translation/feedback/roadmap jobs. gemini-3.6-flash, not
  // gemini-3.5-flash-lite (2026-09-04 incident — see
  // GEMINI_DICTIONARY_TRANSLATION_MODEL's comment above for the full
  // root-cause writeup: this is the SAME outage, reported live by a
  // student unable to send an Engy message in production).
  GEMINI_ENGY_MODEL: Joi.string().default('gemini-3.6-flash'),
  CHAT_REPLY_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(20000),
  // Sliding TTL for a user's bounded Redis chat history (chat:session:<userId>)
  // — the plan's approved "~30 minutes" default. Also the TTL a committed
  // idempotency claim's final reply is cached under (chat.service.ts), so a
  // late legitimate replay within this window still gets its answer without
  // a second Gemini call.
  CHAT_SESSION_TTL_SECONDS: Joi.number().integer().min(60).max(7200).default(1800),

  // Speaking Partner. The conversation itself is Gemini Live
  // (GEMINI_LIVE_MODEL/GEMINI_LIVE_VOICE, src/speaking/live/) — a single
  // audio-to-audio session replaces the old two-step transcription +
  // conversational-reply pipeline entirely (retired vars:
  // GEMINI_SPEAKING_STT_MODEL, SPEAKING_STT_TIMEOUT_MS,
  // GEMINI_SPEAKING_MODEL, SPEAKING_REPLY_TIMEOUT_MS — no longer read
  // anywhere). Shares GEMINI_API_KEY like every other Gemini feature here.
  GEMINI_LIVE_MODEL: Joi.string().default('gemini-3.1-flash-live-preview'),
  GEMINI_LIVE_VOICE: Joi.string().default('Erinome'),
  // BCP-47 language hints for Gemini's own transcription of each side of the
  // call (AudioTranscriptionConfig.languageCodes) — comma-separated, split
  // in gemini-speaking-live-connection.provider.ts. Deliberately TWO
  // independent vars, not one shared list: input is the student's own
  // speech (may be English or Vietnamese), output is Gemini's spoken reply
  // (mostly English, occasionally one short Vietnamese aside per the system
  // instruction) — different reasoning, so a different knob, even though
  // today's defaults happen to match. An EMPTY string omits the field
  // entirely (Gemini's own automatic language detection, the original
  // behaviour before this var existed) — set this to run the A/B/C
  // comparison documented in the Speaking Live sprint doc, not a supported
  // permanent configuration.
  GEMINI_LIVE_INPUT_LANGUAGE_CODES: Joi.string().allow('').default('en-US,vi-VN'),
  GEMINI_LIVE_OUTPUT_LANGUAGE_CODES: Joi.string().allow('').default('en-US,vi-VN'),
  // Temporary diagnostic scaffolding, OFF by default — when enabled, dumps
  // each real Speaking Live turn's raw captured audio to a WAV file in the
  // OS temp dir (never the repo) plus duration/RMS/peak/clipping stats to
  // the console, never conversation content. A deliberate, opt-in exception
  // to this codebase's "audio is never persisted" rule (see Shadowing),
  // scoped to local debugging only. Meant to be removed once the Speaking
  // Live transcription-accuracy investigation concludes — see
  // docs/sprints/sprint-13-speaking-partner.md.
  SPEAKING_LIVE_AUDIO_DEBUG_DUMP: Joi.boolean().default(false),
  // Sliding TTL for a bounded Redis conversation history
  // (speaking:session:<userId>:<attemptId>) — same shape as
  // CHAT_SESSION_TTL_SECONDS.
  SPEAKING_SESSION_TTL_SECONDS: Joi.number().integer().min(60).max(7200).default(1800),
  // A THIRD, independent Speaking Gemini job — on-demand subtitle
  // translation (POST /speaking/translate), own token/provider/env vars,
  // never folded into GEMINI_SPEAKING_MODEL's own call. gemini-3.6-flash,
  // not gemini-3.5-flash-lite — same 2026-09-04 outage as
  // GEMINI_ENGY_MODEL/GEMINI_DICTIONARY_TRANSLATION_MODEL above (see
  // GEMINI_DICTIONARY_TRANSLATION_MODEL's comment for the root cause).
  GEMINI_SPEAKING_TRANSLATE_MODEL: Joi.string().default('gemini-3.6-flash'),
  SPEAKING_TRANSLATE_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(20000),
})
  // Cloudinary/other unrelated vars are intentionally out of this sprint's
  // scope (see docs/sprints/sprint-01C-security-hardening.md) — `unknown`
  // lets them pass through unvalidated rather than failing startup.
  .unknown(true);
