import { buildInitialManifest, withDomainStatus } from './run-manifest';
import type { DomainName } from './content-domains';

const plannedIds: Record<DomainName, Record<string, readonly string[]>> = {
  grammar: { Course: ['c1', 'c2'], Lesson: [], LessonTask: [], Question: [] },
  vocabulary: {
    VocabLibrary: [],
    VocabDeck: [],
    VocabWord: [],
    VocabWordMeaning: [],
    VocabWordExample: [],
    VocabDeckWord: [],
  },
  listening: { ListeningCategory: [], ListeningContent: [], ListeningSegment: [] },
  placement: { PlacementQuestion: ['p1'] },
};

describe('buildInitialManifest', () => {
  it('marks every domain pending with no committedAt, before any write', () => {
    const manifest = buildInitialManifest('run-1', 'engmasterai', 'railway', plannedIds);
    expect(manifest.runId).toBe('run-1');
    expect(manifest.sourceDatabase).toBe('engmasterai');
    expect(manifest.destinationDatabase).toBe('railway');
    for (const domain of Object.keys(plannedIds) as DomainName[]) {
      expect(manifest.domains[domain].status).toBe('pending');
      expect(manifest.domains[domain].committedAt).toBeNull();
    }
  });

  it('carries the planned ids through verbatim, never row content', () => {
    const manifest = buildInitialManifest('run-1', 'engmasterai', 'railway', plannedIds);
    expect(manifest.domains.grammar.plannedIds.Course).toEqual(['c1', 'c2']);
    expect(manifest.domains.placement.plannedIds.PlacementQuestion).toEqual(['p1']);
  });

  it('never includes connection strings or credentials in the manifest shape', () => {
    const manifest = buildInitialManifest('run-1', 'engmasterai', 'railway', plannedIds);
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
  });
});

describe('withDomainStatus', () => {
  it('marks a domain committed with a timestamp, leaving others untouched', () => {
    const manifest = buildInitialManifest('run-1', 'engmasterai', 'railway', plannedIds);
    const updated = withDomainStatus(manifest, 'grammar', 'committed');
    expect(updated.domains.grammar.status).toBe('committed');
    expect(updated.domains.grammar.committedAt).not.toBeNull();
    expect(updated.domains.vocabulary.status).toBe('pending');
  });

  it('marks a domain failed without setting committedAt', () => {
    const manifest = buildInitialManifest('run-1', 'engmasterai', 'railway', plannedIds);
    const updated = withDomainStatus(manifest, 'placement', 'failed');
    expect(updated.domains.placement.status).toBe('failed');
    expect(updated.domains.placement.committedAt).toBeNull();
  });

  it('is pure — does not mutate the input manifest', () => {
    const manifest = buildInitialManifest('run-1', 'engmasterai', 'railway', plannedIds);
    withDomainStatus(manifest, 'grammar', 'committed');
    expect(manifest.domains.grammar.status).toBe('pending');
  });
});
