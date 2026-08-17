import {
  CONTENT_MODELS,
  DOMAIN_ORDER,
  modelsForDomain,
  assertAllowlistExcludesUserData,
} from './content-domains';

describe('content-domains', () => {
  it('contains exactly the 14 approved content models', () => {
    expect(CONTENT_MODELS.map((m) => m.name).sort()).toEqual(
      [
        'Course',
        'Lesson',
        'LessonTask',
        'Question',
        'VocabLibrary',
        'VocabDeck',
        'VocabWord',
        'VocabWordMeaning',
        'VocabWordExample',
        'VocabDeckWord',
        'ListeningCategory',
        'ListeningContent',
        'ListeningSegment',
        'PlacementQuestion',
      ].sort(),
    );
  });

  it('never accidentally includes an excluded (user/dormant) model', () => {
    expect(() => assertAllowlistExcludesUserData()).not.toThrow();
  });

  it('throws if the allowlist were ever polluted with an excluded model', () => {
    const polluted = [...CONTENT_MODELS, { ...CONTENT_MODELS[0], name: 'User' }];
    expect(() => assertAllowlistExcludesUserData(polluted)).toThrow(/User/);
  });

  it('orders every domain parent-before-child', () => {
    for (const domain of DOMAIN_ORDER) {
      const models = modelsForDomain(domain);
      const seen = new Set<string>();
      for (const model of models) {
        for (const fk of model.foreignKeys) {
          expect(seen.has(fk.referencesModel)).toBe(true);
        }
        seen.add(model.name);
      }
    }
  });

  it('covers every content model in exactly one domain', () => {
    const totalAcrossDomains = DOMAIN_ORDER.reduce(
      (sum, domain) => sum + modelsForDomain(domain).length,
      0,
    );
    expect(totalAcrossDomains).toBe(CONTENT_MODELS.length);
  });
});
