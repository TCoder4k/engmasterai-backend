// The Vietnamese-translation seam — deliberately its OWN token/interface,
// not shared with dictionary-source.provider.ts or the (future) Engy chat
// provider. Same "fail independently" discipline the Shadowing module's two
// providers use: this one only ever translates a definition ALREADY produced
// by a deterministic source, never invents an English definition of its own
// — the request shape below has no field for that.
export const VI_TRANSLATION_PROVIDER = 'VI_TRANSLATION_PROVIDER';

export interface ViTranslationRequest {
  word: string;
  definitionEn: string;
}

export interface ViTranslationResult {
  translation: string;
}

export type ViTranslationFailureKind = 'UNAVAILABLE' | 'TIMEOUT' | 'NOT_CONFIGURED';

export class ViTranslationError extends Error {
  constructor(
    readonly kind: ViTranslationFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'ViTranslationError';
  }
}

export interface ViTranslationProvider {
  readonly model: string;
  translate(request: ViTranslationRequest): Promise<ViTranslationResult>;
}
