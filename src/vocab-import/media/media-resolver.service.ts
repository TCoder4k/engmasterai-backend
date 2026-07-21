import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ImportWord } from '../types/import-word';
import { DatasetConfig } from '../types/dataset-config';
import { MediaManifest, MediaManifestEntry } from '../types/artifacts';
import { normalizeDedupeKey } from '../validation/normalizers';
import { slugify } from './slug';
import { matchLocalFile, resolveMediaPath } from './media-matcher';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from './media-extensions';
import { FRAMEWORK_VERSION } from '../version';

@Injectable()
export class MediaResolverService {
  // Offline, no network — always safe to run, including under --dry-run
  // (approved plan §3/§8). Deduplicates by (kind, textKey) so an in-file
  // duplicate headword (see the validator's inFileDuplicates) doesn't
  // produce two manifest entries racing to upload the same public_id.
  resolve(
    words: ImportWord[],
    config: DatasetConfig,
    runId: string,
  ): MediaManifest {
    const entries: MediaManifestEntry[] = [];
    const seen = new Set<string>();

    for (const word of words) {
      const textKey = normalizeDedupeKey(word.text);
      const deckKey = word.deckKey ?? '';

      if (config.media?.audio) {
        this.pushEntry(
          entries,
          seen,
          'audio',
          word,
          textKey,
          deckKey,
          config.id,
          config.media.audio,
          AUDIO_EXTENSIONS,
        );
      }
      if (config.media?.image) {
        this.pushEntry(
          entries,
          seen,
          'image',
          word,
          textKey,
          deckKey,
          config.id,
          config.media.image,
          IMAGE_EXTENSIONS,
        );
      }
    }

    return {
      runId,
      datasetId: config.id,
      generatedAt: new Date().toISOString(),
      frameworkVersion: FRAMEWORK_VERSION,
      entries,
    };
  }

  private pushEntry(
    entries: MediaManifestEntry[],
    seen: Set<string>,
    kind: 'audio' | 'image',
    word: ImportWord,
    textKey: string,
    deckKey: string,
    datasetId: string,
    source: NonNullable<DatasetConfig['media']>['audio'],
    extensions: string[],
  ): void {
    if (!source) return;
    const dedupeKey = `${kind}:${textKey}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const slug = slugify(word.text, source.slug);
    const dir = path.join(source.root, deckKey);
    const match = matchLocalFile(dir, slug, extensions);
    const localPath =
      match.matchType !== 'none'
        ? resolveMediaPath(dir, match.fileName!)
        : undefined;
    const remoteUrl =
      kind === 'audio'
        ? word.media.audio?.remoteUrl
        : word.media.image?.remoteUrl;

    entries.push({
      textKey,
      kind,
      localPath,
      remoteUrl,
      publicId: `vocab/${kind === 'audio' ? 'audio' : 'images'}/${datasetId}/${textKey}`,
      status: localPath || remoteUrl ? 'pending' : 'missing',
    });
  }
}
