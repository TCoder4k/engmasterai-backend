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
 * Tries each model in order. Falls through to the next model on HTTP 429 or
 * 503 (the "this specific model has no capacity right now" signal), AND on
 * a per-model TIMEOUT (AbortError) — added 2026-09-09 after a confirmed
 * production incident: `gemini-3.8-flash` (front of the default chain)
 * simply stopped responding at all (no error status, a genuine hang past
 * the configured timeout) while `gemini-3.5-flash` (back of the same chain)
 * answered normally in ~9s — measured directly against the real API with
 * the exact production request shape. The ORIGINAL design (see git history)
 * deliberately did NOT retry a timeout across models, reasoning that a
 * genuine per-model hang would "multiply the wait by every model in the
 * chain" — correct as a description of the cost, but it means a single
 * hung model at the front of the chain now fails 100% of requests outright,
 * even when every other model in the chain is healthy. Revisited: a bounded
 * multiplied wait (worst case timeoutMs × models.length, e.g. 20s × 4 = 80s
 * if EVERY model is simultaneously down) is a better failure mode than an
 * unconditional, guaranteed failure whenever only the front model is
 * affected — which is exactly the scenario observed. `timeoutMs` itself is
 * unchanged (still each individual attempt's own budget, comfortably above
 * the ~9s a real answer took in the incident's own measurement) — only the
 * catch branch's behavior changed.
 *
 * A THROWN NETWORK ERROR (DNS failure, connection refused — anything that
 * is not an AbortError) still propagates immediately, unretried, exactly as
 * before: that class of failure usually indicates a broader connectivity
 * problem this process cannot fix by trying a different model name against
 * the same unreachable host.
 *
 * Any non-retryable HTTP response (400, a blocked-content 200, etc.) is
 * still returned immediately, even if models remain — those fail
 * identically on any model.
 *
 * Every fallback hop and a fully-exhausted chain are logged in a structured,
 * greppable line for production observability:
 *   `Gemini fallback from=<model> to=<next> status=<code> provider=<name>`
 *   `Gemini fallback (timeout) from=<model> to=<next> provider=<name>`
 *   `Gemini fallback exhausted model=<last> status=<code> provider=<name>`
 *
 * OPTIONAL `externalSignal` (added 2026-09-12 for Engy Chat streaming): a
 * caller-owned abort signal — e.g. "the client's HTTP connection just
 * closed" — combined with each attempt's own timeout signal via
 * `AbortSignal.any`. Firing it aborts the CURRENT fetch (and, per the Fetch
 * spec, an in-progress streamed body read too — the signal keeps governing
 * the response after this function returns) and STOPS THE WHOLE CHAIN
 * immediately, unlike a per-attempt timeout which tries the next model. The
 * catch block distinguishes the two by checking `externalSignal?.aborted`
 * BEFORE the existing timeout-fallback branch — trying another (paid) model
 * after the caller has already given up would be pure waste. Every existing
 * caller omits this parameter and is completely unaffected.
 */
export async function fetchGeminiWithFallback(
  models: readonly string[],
  timeoutMs: number,
  endpoint: (model: string) => string,
  buildInit: (model: string, signal: AbortSignal) => RequestInit,
  logger: Logger,
  providerName: string,
  externalSignal?: AbortSignal,
): Promise<GeminiFallbackResult> {
  for (let i = 0; i < models.length; i++) {
    if (externalSignal?.aborted) {
      throw new GeminiFetchError(models[i], new DOMException('Aborted by caller', 'AbortError'));
    }
    const model = models[i];
    const isLast = i === models.length - 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
    try {
      const response = await fetch(endpoint(model), buildInit(model, signal));
      if (RETRYABLE_STATUSES.has(response.status)) {
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
      if (externalSignal?.aborted) {
        // The caller gave up (e.g. client disconnected) — stop the whole
        // chain now, never try another model for a response nobody wants.
        throw new GeminiFetchError(model, caught);
      }
      const aborted = caught instanceof Error && caught.name === 'AbortError';
      if (aborted && !isLast) {
        logger.warn(`Gemini fallback (timeout) from=${model} to=${models[i + 1]} provider=${providerName}`);
        continue;
      }
      throw new GeminiFetchError(model, caught);
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable — parseGeminiModelList guarantees models.length >= 1.
  throw new Error('fetchGeminiWithFallback: models list is empty');
}
