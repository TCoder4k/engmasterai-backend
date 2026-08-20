import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Speaking Partner Live — TEMPORARY diagnostic scaffolding for the
// transcript-accuracy investigation in
// docs/sprints/sprint-13-speaking-partner.md (§16/§17). OFF by default,
// gated entirely by SPEAKING_LIVE_AUDIO_DEBUG_DUMP (read directly from
// process.env, not ConfigService — this class, like SpeakingLiveSession
// itself, is deliberately NOT a NestJS provider; see that file's header).
//
// Accumulates the EXACT PCM16 bytes SpeakingLiveSession forwards to Gemini
// for one real turn, then on finalize() computes structural stats
// (duration/RMS/peak/clipping) and writes a real WAV file, so a developer
// can LISTEN to exactly what Gemini received — the only way to separate
// "our capture/encode pipeline is broken" from "Gemini Live's own
// transcription is unreliable for this input" (the latter cannot be ruled
// out by reading source code, only by hearing the actual audio).
//
// NEVER LOGS CONVERSATION CONTENT — only byte/sample counts, duration and
// signal stats, matching gemini-speaking-live-connection.provider.ts's own
// stated discipline.
//
// WRITES RAW STUDENT AUDIO TO DISK when enabled — a deliberate, opt-in
// exception to this codebase's "audio is never persisted" rule (see
// Shadowing's design, which never stores audio at all). Written ONLY to the
// OS temp directory (os.tmpdir()), NEVER the repo, and only when a
// developer has manually set the env var. Meant to be removed once the
// investigation this exists for concludes.

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // Int16, little-endian
const CLIPPED_THRESHOLD = 32760; // near the Int16 ceiling (32767) — counts near-full-scale samples

export const isAudioDebugDumpEnabled = (): boolean => {
  const raw = (process.env.SPEAKING_LIVE_AUDIO_DEBUG_DUMP ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
};

const buildWavHeader = (dataLength: number): Buffer => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(dataLength, 40);
  return header;
};

export interface AudioDiagnosticsStats {
  chunkCount: number;
  byteCount: number;
  durationSeconds: number;
  rms: number;
  peak: number;
  clippedRatio: number;
  wavPath: string | null;
}

const computeStats = (pcm: Buffer, chunkCount: number): Omit<AudioDiagnosticsStats, 'wavPath'> => {
  const sampleCount = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  let sumSquares = 0;
  let peak = 0;
  let clippedCount = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const raw = pcm.readInt16LE(i * BYTES_PER_SAMPLE);
    const normalized = raw / 32768;
    sumSquares += normalized * normalized;
    const abs = Math.abs(normalized);
    if (abs > peak) peak = abs;
    if (Math.abs(raw) >= CLIPPED_THRESHOLD) clippedCount += 1;
  }
  return {
    chunkCount,
    byteCount: pcm.length,
    durationSeconds: sampleCount / SAMPLE_RATE,
    rms: sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0,
    peak,
    clippedRatio: sampleCount > 0 ? clippedCount / sampleCount : 0,
  };
};

export class SpeakingLiveAudioDiagnostics {
  private static readonly logger = new Logger('SpeakingLiveAudioDiagnostics');

  private chunks: Buffer[] = [];

  constructor(private readonly enabled: boolean = isAudioDebugDumpEnabled()) {}

  /** Records one chunk EXACTLY as forwarded to Gemini (same base64 string, decoded). No-op when disabled. */
  record(base64Pcm16: string): void {
    if (!this.enabled) return;
    this.chunks.push(Buffer.from(base64Pcm16, 'base64'));
  }

  /** Discards any buffered chunks without writing anything — used when a turn resets or is abandoned. */
  reset(): void {
    this.chunks = [];
  }

  /**
   * Computes stats, writes a WAV file under the OS temp dir, logs a
   * structural (content-free) summary, then resets. No-op when disabled or
   * nothing was recorded for this turn. Never throws — a diagnostic tool
   * failing must never affect the real conversation flow.
   */
  async finalize(label: string): Promise<AudioDiagnosticsStats | null> {
    if (!this.enabled || this.chunks.length === 0) {
      this.reset();
      return null;
    }

    const pcm = Buffer.concat(this.chunks);
    const chunkCount = this.chunks.length;
    this.reset();

    const stats = computeStats(pcm, chunkCount);
    let wavPath: string | null = null;
    try {
      const dir = path.join(os.tmpdir(), 'engmasterai-speaking-live-debug');
      await fsp.mkdir(dir, { recursive: true });
      wavPath = path.join(dir, `${label}-${Date.now()}-${randomUUID().slice(0, 8)}.wav`);
      await fsp.writeFile(wavPath, Buffer.concat([buildWavHeader(pcm.length), pcm]));
    } catch (error) {
      SpeakingLiveAudioDiagnostics.logger.warn('Failed to write Speaking Live debug WAV', error as Error);
      wavPath = null;
    }

    const report: AudioDiagnosticsStats = { ...stats, wavPath };
    SpeakingLiveAudioDiagnostics.logger.debug(
      `[SpeakingLive audio diagnostics] label=${label} chunks=${report.chunkCount} bytes=${report.byteCount} ` +
        `duration=${report.durationSeconds.toFixed(3)}s rms=${report.rms.toFixed(3)} peak=${report.peak.toFixed(3)} ` +
        `clipped=${(report.clippedRatio * 100).toFixed(2)}%${wavPath ? ` wav=${wavPath}` : ''}`,
    );
    return report;
  }
}
