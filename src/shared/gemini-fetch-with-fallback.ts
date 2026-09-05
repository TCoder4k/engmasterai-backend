import { Logger } from '@nestjs/common';

export interface GeminiFallbackResult {
  response: Response;
  model: string; // whichever model actually produced this response
}

// Carries which model was being attempted when fetch() itself threw (network
// failure or AbortError/timeout) — without this, a catch block has no way to
// know which model failed once the promise rejects instead of resolving.
export class GeminiFetchError extends Error {
  readonly model: string;
  constructor(model: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Gemini fetch failed', { cause });
    this.name = 'GeminiFetchError';
    this.model = model;
  }
}

export const isGeminiTimeout = (caught: unknown): boolean =>
  caught instanceof GeminiFetchError &&
  caught.cause instanceof Error &&
  caught.cause.name === 'AbortError';

const RETRYABLE_STATUSES = new Set([429, 503]);

/**
 * Tries each model in order. Falls through to the next model ONLY on HTTP
 * 429 or 503 — the "this specific model has no capacity right now" signal.
 * Any other response (400, a blocked-content 200, etc.) is returned
 * immediately, even if models remain — those would fail identically on any
 * model. A thrown error (network failure, or AbortError on timeout) is NOT
 * retried across models either — it propagates immediately as a
 * GeminiFetchError, so a genuine timeout fails as fast as it does today
 * instead of multiplying the wait by every model in the chain.
 *
 * Every fallback hop and a fully-exhausted chain are logged in a structured,
 * greppable line for production observability:
 *   `Gemini fallback from=<model> to=<next> status=<code> provider=<name>`
 *   `Gemini fallback exhausted model=<last> status=<code> provider=<name>`
 */
export async function fetchGeminiWithFallback(
  models: readonly string[],
  timeoutMs: number,
  endpoint: (model: string) => string,
  buildInit: (model: string, signal: AbortSignal) => RequestInit,
  logger: Logger,
  providerName: string,
): Promise<GeminiFallbackResult> {
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint(model), buildInit(model, controller.signal));
      if (RETRYABLE_STATUSES.has(response.status)) {
        const isLast = i === models.length - 1;
        if (!isLast) {
          logger.warn(
            `Gemini fallback from=${model} to=${models[i + 1]} status=${response.status} provider=${providerName}`,
          );
          continue;
        }
        logger.warn(
          `Gemini fallback exhausted model=${model} status=${response.status} provider=${providerName}`,
        );
      }
      return { response, model };
    } catch (caught) {
      throw new GeminiFetchError(model, caught);
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable — parseGeminiModelList guarantees models.length >= 1.
  throw new Error('fetchGeminiWithFallback: models list is empty');
}
