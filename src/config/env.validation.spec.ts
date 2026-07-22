import { envValidationSchema } from './env.validation';

interface ValidatedEnv {
  NODE_ENV: string;
  PORT: number;
  CORS_ALLOWED_ORIGINS: string;
  TRUST_PROXY: string;
  AUTH_LOGIN_RATE_LIMIT_MAX: number;
}

const VALIDATE_OPTIONS = { abortEarly: false, allowUnknown: true };

const validate = (
  env: Record<string, unknown>,
): { error?: { message: string }; value: ValidatedEnv } =>
  envValidationSchema.validate(env, VALIDATE_OPTIONS) as {
    error?: { message: string };
    value: ValidatedEnv;
  };

const omit = <T extends Record<string, unknown>>(
  obj: T,
  key: keyof T,
): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...obj };
  delete copy[key as string];
  return copy;
};

const baseDevEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(20),
};

const baseProdEnv = {
  ...baseDevEnv,
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(32),
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
};

describe('env.validation', () => {
  it('succeeds for a valid development configuration (defaults applied)', () => {
    const { error, value } = validate(baseDevEnv);
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3000);
    expect(value.CORS_ALLOWED_ORIGINS).toBe('http://localhost:5174');
    expect(value.TRUST_PROXY).toBe('false');
    expect(value.AUTH_LOGIN_RATE_LIMIT_MAX).toBe(5);
  });

  it('succeeds for a valid test configuration', () => {
    const { error } = validate({ ...baseDevEnv, NODE_ENV: 'test' });
    expect(error).toBeUndefined();
  });

  it('succeeds for a valid production configuration', () => {
    const { error } = validate(baseProdEnv);
    expect(error).toBeUndefined();
  });

  it('fails when JWT_SECRET is missing', () => {
    const { error } = validate(omit(baseDevEnv, 'JWT_SECRET'));
    expect(error?.message).toMatch(/JWT_SECRET/);
  });

  it('fails when JWT_SECRET is weak (too short) in production', () => {
    const { error } = validate({ ...baseProdEnv, JWT_SECRET: 'too-short' });
    expect(error?.message).toMatch(/JWT_SECRET/);
  });

  it('fails when DATABASE_URL is not a valid postgres URL', () => {
    const { error } = validate({ ...baseDevEnv, DATABASE_URL: 'not-a-url' });
    expect(error?.message).toMatch(/DATABASE_URL/);
  });

  it('fails when REDIS_URL is not a valid redis URL', () => {
    const { error } = validate({ ...baseDevEnv, REDIS_URL: 'not-a-url' });
    expect(error?.message).toMatch(/REDIS_URL/);
  });

  it('fails when CORS_ALLOWED_ORIGINS is missing in production', () => {
    const { error } = validate(omit(baseProdEnv, 'CORS_ALLOWED_ORIGINS'));
    expect(error?.message).toMatch(/CORS_ALLOWED_ORIGINS/);
  });

  it('fails when CORS_ALLOWED_ORIGINS is a malformed entry', () => {
    const { error } = validate({
      ...baseProdEnv,
      CORS_ALLOWED_ORIGINS: 'not a url at all',
    });
    expect(error?.message).toMatch(/CORS_ALLOWED_ORIGINS/);
  });

  it('fails when CORS_ALLOWED_ORIGINS contains a path', () => {
    const { error } = validate({
      ...baseProdEnv,
      CORS_ALLOWED_ORIGINS: 'https://app.example.com/path',
    });
    expect(error?.message).toMatch(/CORS_ALLOWED_ORIGINS/);
  });

  it('fails wildcard + credentials (CORS_ALLOWED_ORIGINS="*") even in production', () => {
    const { error } = validate({ ...baseProdEnv, CORS_ALLOWED_ORIGINS: '*' });
    expect(error?.message).toMatch(/wildcard/);
  });

  it('fails when TRUST_PROXY is the bare literal "true"', () => {
    const { error } = validate({ ...baseDevEnv, TRUST_PROXY: 'true' });
    expect(error?.message).toMatch(/TRUST_PROXY/);
  });

  it('accepts a TRUST_PROXY hop count', () => {
    const { error } = validate({ ...baseDevEnv, TRUST_PROXY: '1' });
    expect(error).toBeUndefined();
  });

  it('fails when a rate-limit max is not a positive integer', () => {
    const { error } = validate({
      ...baseDevEnv,
      AUTH_LOGIN_RATE_LIMIT_MAX: 0,
    });
    expect(error?.message).toMatch(/AUTH_LOGIN_RATE_LIMIT_MAX/);
  });

  it('fails when a rate-limit window is negative', () => {
    const { error } = validate({
      ...baseDevEnv,
      AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS: -1,
    });
    expect(error?.message).toMatch(/AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS/);
  });

  it('does not fail on unrelated/unknown env vars (e.g. Cloudinary)', () => {
    const { error } = validate({
      ...baseDevEnv,
      CLOUDINARY_API_KEY: 'whatever',
    });
    expect(error).toBeUndefined();
  });

  describe('Sprint 02A — GOOGLE_AUTH_ENABLED / GOOGLE_CLIENT_ID', () => {
    it('defaults GOOGLE_AUTH_ENABLED to false and boots with zero Google config', () => {
      const { error, value } = validate(baseDevEnv);
      expect(error).toBeUndefined();
      expect(
        (value as unknown as Record<string, unknown>).GOOGLE_AUTH_ENABLED,
      ).toBe(false);
    });

    it('passes when GOOGLE_AUTH_ENABLED is false and GOOGLE_CLIENT_ID is present anyway', () => {
      const { error } = validate({
        ...baseDevEnv,
        GOOGLE_AUTH_ENABLED: false,
        GOOGLE_CLIENT_ID: 'some-id.apps.googleusercontent.com',
      });
      expect(error).toBeUndefined();
    });

    it('fails when GOOGLE_AUTH_ENABLED is true and GOOGLE_CLIENT_ID is missing', () => {
      const { error } = validate({
        ...baseDevEnv,
        GOOGLE_AUTH_ENABLED: true,
      });
      expect(error?.message).toMatch(/GOOGLE_CLIENT_ID/);
    });

    it('fails when GOOGLE_AUTH_ENABLED is true and GOOGLE_CLIENT_ID is empty', () => {
      const { error } = validate({
        ...baseDevEnv,
        GOOGLE_AUTH_ENABLED: true,
        GOOGLE_CLIENT_ID: '',
      });
      expect(error?.message).toMatch(/GOOGLE_CLIENT_ID/);
    });

    it('succeeds when GOOGLE_AUTH_ENABLED is true and GOOGLE_CLIENT_ID is set', () => {
      const { error, value } = validate({
        ...baseDevEnv,
        GOOGLE_AUTH_ENABLED: true,
        GOOGLE_CLIENT_ID: 'some-id.apps.googleusercontent.com',
      });
      expect(error).toBeUndefined();
      expect(
        (value as unknown as Record<string, unknown>).GOOGLE_AUTH_ENABLED,
      ).toBe(true);
    });
  });

  describe('Sprint 02B — EMAIL_ENABLED / transactional mail config', () => {
    const validEmailConfig = {
      EMAIL_ENABLED: true,
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'noreply@example.com',
      EMAIL_FROM_NAME: 'EngMasterAI',
      EMAIL_PROVIDER_API_KEY: 'test-key',
      FRONTEND_APP_URL: 'https://app.example.com',
    };

    it('defaults EMAIL_ENABLED to false and boots with zero mail config', () => {
      const { error, value } = validate(baseDevEnv);
      expect(error).toBeUndefined();
      expect((value as unknown as Record<string, unknown>).EMAIL_ENABLED).toBe(
        false,
      );
    });

    it('passes when EMAIL_ENABLED is false and no mail vars are set at all', () => {
      const { error } = validate(baseDevEnv);
      expect(error).toBeUndefined();
    });

    it('fails when EMAIL_ENABLED is true and EMAIL_PROVIDER is missing', () => {
      const { EMAIL_PROVIDER, ...rest } = validEmailConfig;
      void EMAIL_PROVIDER;
      const { error } = validate({ ...baseDevEnv, ...rest });
      expect(error?.message).toMatch(/EMAIL_PROVIDER/);
    });

    it('fails when EMAIL_ENABLED is true and EMAIL_FROM is missing', () => {
      const { EMAIL_FROM, ...rest } = validEmailConfig;
      void EMAIL_FROM;
      const { error } = validate({ ...baseDevEnv, ...rest });
      expect(error?.message).toMatch(/EMAIL_FROM\b/);
    });

    it('fails when EMAIL_ENABLED is true and EMAIL_PROVIDER_API_KEY is missing', () => {
      const { EMAIL_PROVIDER_API_KEY, ...rest } = validEmailConfig;
      void EMAIL_PROVIDER_API_KEY;
      const { error } = validate({ ...baseDevEnv, ...rest });
      expect(error?.message).toMatch(/EMAIL_PROVIDER_API_KEY/);
    });

    it('fails when EMAIL_ENABLED is true and FRONTEND_APP_URL is missing', () => {
      const { FRONTEND_APP_URL, ...rest } = validEmailConfig;
      void FRONTEND_APP_URL;
      const { error } = validate({ ...baseDevEnv, ...rest });
      expect(error?.message).toMatch(/FRONTEND_APP_URL/);
    });

    it('succeeds when EMAIL_ENABLED is true and every required mail var is present', () => {
      const { error, value } = validate({ ...baseDevEnv, ...validEmailConfig });
      expect(error).toBeUndefined();
      expect(
        (value as unknown as Record<string, unknown>).EMAIL_PROVIDER_TIMEOUT_MS,
      ).toBe(5000);
      expect(
        (value as unknown as Record<string, unknown>)
          .EMAIL_VERIFICATION_TOKEN_TTL_MINUTES,
      ).toBe(30);
    });

    it('defaults FRONTEND_APP_URL to the local dev frontend origin when EMAIL_ENABLED is false', () => {
      const { error, value } = validate(baseDevEnv);
      expect(error).toBeUndefined();
      expect(
        (value as unknown as Record<string, unknown>).FRONTEND_APP_URL,
      ).toBe('http://localhost:5174');
    });

    it('fails when a rate-limit max for email verification is not a positive integer', () => {
      const { error } = validate({
        ...baseDevEnv,
        AUTH_EMAIL_VERIFY_RESEND_USER_RATE_LIMIT_MAX: 0,
      });
      expect(error?.message).toMatch(
        /AUTH_EMAIL_VERIFY_RESEND_USER_RATE_LIMIT_MAX/,
      );
    });
  });
});
