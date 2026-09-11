// The chain to use everywhere unless a feature overrides it. Four STABLE
// models only — gemini-3-flash-preview is deliberately EXCLUDED (Google's
// own docs mark it PREVIEW, tighter rate limits, and its deprecation notice
// for gemini-2.5-flash points at gemini-3.6-flash, already in the chain).
//
// ORDER re-tuned 2026-09-09 after a confirmed production incident: measured
// directly against the real API with the exact production request shape,
// gemini-3.8-flash (previously first) was hanging with NO response at all
// (not a fast 429/503 — a genuine timeout), gemini-3.6-flash likewise;
// gemini-3.7-flash returned a fast 503 (temporarily over capacity, still
// "alive"); gemini-3.5-flash answered normally in ~9s. Reordered
// healthiest-observed-first. This is a snapshot of THAT incident, not a
// permanent ranking — Google's own per-model capacity has already been
// observed to fluctuate over just hours (see the 2026-09-05 fallback-chain
// milestone in docs/memory.md) and may need reordering again later. The
// 2026-09-09 fallback-on-timeout fix (see gemini-fetch-with-fallback.ts) is
// the durable half of that fix; THIS ordering is the fast, situational half.
export const DEFAULT_GEMINI_MODEL_CHAIN =
  'gemini-3.5-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-3.6-flash';

// Non-empty + deduped. Throws naming the config key so a misconfigured env
// var fails at boot, not as a runtime "models list is empty" deep in a request.
export const parseGeminiModelList = (raw: string, configKey: string): string[] => {
  const models = Array.from(new Set(raw.split(',').map((m) => m.trim()).filter(Boolean)));
  if (models.length === 0) {
    throw new Error(`${configKey} must list at least one Gemini model`);
  }
  return models;
};
