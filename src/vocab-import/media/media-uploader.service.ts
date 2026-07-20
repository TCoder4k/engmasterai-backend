import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { MediaManifest, MediaManifestEntry } from '../types/artifacts';
import { createLimiter } from './concurrency-limit';

const MAX_CONCURRENT = 5;
const MAX_RETRIES = 2;
const AUDIO_SIZE_CAP = 10 * 1024 * 1024; // matches POST /vocab/words/:id/audio
const IMAGE_SIZE_CAP = 5 * 1024 * 1024; // matches POST /vocab/words/:id/image

async function withRetry<T>(task: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

@Injectable()
export class MediaUploaderService {
  private readonly logger = new Logger(MediaUploaderService.name);

  constructor(private readonly cloudinaryService: CloudinaryService) {}

  // Mutates and persists the manifest incrementally (approved plan §8/§11):
  // onEntryUpdated is called after every single entry so an interrupted run
  // resumes by skipping everything already 'uploaded'. Concurrency-capped,
  // per-entry retry with backoff — one file's failure never aborts the run.
  async upload(manifest: MediaManifest, onEntryUpdated: (manifest: MediaManifest) => void): Promise<MediaManifest> {
    const limit = createLimiter(MAX_CONCURRENT);

    await Promise.all(
      manifest.entries.map((entry) =>
        limit(async () => {
          if (entry.status !== 'pending') return;

          try {
            const result = await withRetry(() => this.uploadEntry(entry), MAX_RETRIES);
            entry.status = 'uploaded';
            entry.secureUrl = result;
          } catch (err) {
            entry.status = 'failed';
            entry.error = (err as Error).message;
            this.logger.warn(`Media upload failed for ${entry.kind}/${entry.textKey}: ${entry.error}`);
          }

          onEntryUpdated(manifest);
        }),
      ),
    );

    return manifest;
  }

  private async uploadEntry(entry: MediaManifestEntry): Promise<string> {
    const buffer = entry.localPath
      ? fs.readFileSync(entry.localPath)
      : await this.fetchRemote(entry.remoteUrl!, entry.kind);

    const result = await this.cloudinaryService.uploadBuffer(buffer, {
      // No folder here — entry.publicId is already the full path
      // (vocab/{audio|images}/{datasetId}/{textKey}); passing folder too
      // would double the segment (this was a real bug, found and fixed
      // during Phase D verification against real Cloudinary uploads).
      publicId: entry.publicId,
      // Cloudinary stores audio under its 'video' resource type, same as
      // the existing per-word setAudio endpoint.
      resourceType: entry.kind === 'audio' ? 'video' : 'image',
      overwrite: false,
    });

    if (!('secure_url' in result)) {
      throw new Error(result.message || 'Upload failed');
    }
    return result.secure_url;
  }

  private async fetchRemote(url: string, kind: 'audio' | 'image'): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Remote fetch failed (${response.status}) for ${url}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const cap = kind === 'audio' ? AUDIO_SIZE_CAP : IMAGE_SIZE_CAP;
    if (arrayBuffer.byteLength > cap) {
      throw new Error(`Remote file exceeds the ${cap / (1024 * 1024)}MB cap for ${kind}`);
    }

    return Buffer.from(arrayBuffer);
  }
}
