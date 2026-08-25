import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CaptchaVerificationFailedException } from '../exceptions/captcha-verification-failed.exception';

// Cloudflare Turnstile on /auth/register (2026-08-25) — added after a bot
// created 330 fake accounts in one day by rotating source IPs, trivially
// staying under the existing per-IP rate limits (register-ip/register-combo
// in auth.controller.ts). This service is a complementary layer, not a
// replacement for those limits.
//
// PLAIN `fetch`, NO SDK — same stated convention as every other external
// provider in this codebase (see dictionary/free-dictionary-api.provider.ts).
const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileSiteverifyResponse {
  success?: boolean;
}

@Injectable()
export class TurnstileVerifierService {
  private readonly logger = new Logger(TurnstileVerifierService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Throws CaptchaVerificationFailedException on any failure — a disabled
   * feature flag is the one case that resolves silently, so registration
   * keeps working in every environment that hasn't configured Cloudflare
   * yet (opposite polarity from GoogleTokenVerifierService, which throws
   * when ITS flag is off, because Google sign-in is an optional alternate
   * path while registration itself must never be blocked by an unconfigured
   * optional gate).
   */
  async verify(
    token: string | undefined,
    remoteIp: string | null,
  ): Promise<void> {
    if (this.config.get<boolean>('TURNSTILE_ENABLED') !== true) return;

    if (!token) {
      this.warn('no_token');
      throw new CaptchaVerificationFailedException();
    }

    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY') as string;
    const timeoutMs = this.config.get<number>(
      'TURNSTILE_VERIFY_TIMEOUT_MS',
      5000,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret,
          response: token,
          remoteip: remoteIp ?? undefined,
        }),
        signal: controller.signal,
      });
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      this.warn(aborted ? 'timeout' : 'network_error');
      throw new CaptchaVerificationFailedException();
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.warn(`http_${response.status}`);
      throw new CaptchaVerificationFailedException();
    }

    let payload: TurnstileSiteverifyResponse;
    try {
      payload = (await response.json()) as TurnstileSiteverifyResponse;
    } catch {
      this.warn('malformed_response');
      throw new CaptchaVerificationFailedException();
    }

    if (payload.success !== true) {
      this.warn('not_success');
      throw new CaptchaVerificationFailedException();
    }
  }

  // Never logs the token or secret — message text + a fixed reason code only.
  private warn(reason: string): void {
    this.logger.warn(`Turnstile verification failed: ${reason}`);
  }
}
