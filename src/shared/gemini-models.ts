// The chain to use everywhere unless a feature overrides it. Four STABLE
// models only — gemini-3-flash-preview is deliberately EXCLUDED (Google's
// own docs mark it PREVIEW, tighter rate limits, and its deprecation notice
// for gemini-2.5-flash points at gemini-3.6-flash, already in the chain).
export const DEFAULT_GEMINI_MODEL_CHAIN =
  'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash';

// Non-empty + deduped. Throws naming the config key so a misconfigured env
// var fails at boot, not as a runtime "models list is empty" deep in a request.
export const parseGeminiModelList = (raw: string, configKey: string): string[] => {
  const models = Array.from(new Set(raw.split(',').map((m) => m.trim()).filter(Boolean)));
  if (models.length === 0) {
    throw new Error(`${configKey} must list at least one Gemini model`);
  }
  return models;
};
