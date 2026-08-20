import * as fsp from 'fs/promises';
import { isAudioDebugDumpEnabled, SpeakingLiveAudioDiagnostics } from './speaking-live-audio-diagnostics';

// Temporary diagnostic tool (docs/sprints/sprint-13-speaking-partner.md
// §16/§17) — this spec pins the two properties that matter for a debugging
// tool: (1) it is a true no-op, including no filesystem writes, unless
// explicitly enabled, and (2) once enabled, its math on KNOWN synthetic
// PCM16 data matches hand-computed expected values exactly — the whole
// point of this tool is to be trustworthy evidence, not another thing to
// doubt.

jest.mock('fs/promises');

const mockedMkdir = fsp.mkdir as jest.Mock;
const mockedWriteFile = fsp.writeFile as jest.Mock;

/** Encodes an array of already-normalised [-1, 1] float samples as a base64 PCM16 chunk, matching floatTo16BitPcm/int16ToBase64 in useSpeakingLiveCapture.ts. */
const encodeChunk = (samples: number[]): string => {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    buffer.writeInt16LE(Math.round(int16), index * 2);
  });
  return buffer.toString('base64');
};

describe('isAudioDebugDumpEnabled', () => {
  const original = process.env.SPEAKING_LIVE_AUDIO_DEBUG_DUMP;
  afterEach(() => {
    if (original === undefined) delete process.env.SPEAKING_LIVE_AUDIO_DEBUG_DUMP;
    else process.env.SPEAKING_LIVE_AUDIO_DEBUG_DUMP = original;
  });

  it('is false when unset, and true for "true"/"1" (case-insensitive)', () => {
    delete process.env.SPEAKING_LIVE_AUDIO_DEBUG_DUMP;
    expect(isAudioDebugDumpEnabled()).toBe(false);

    process.env.SPEAKING_LIVE_AUDIO_DEBUG_DUMP = 'TRUE';
    expect(isAudioDebugDumpEnabled()).toBe(true);

    process.env.SPEAKING_LIVE_AUDIO_DEBUG_DUMP = '1';
    expect(isAudioDebugDumpEnabled()).toBe(true);

    process.env.SPEAKING_LIVE_AUDIO_DEBUG_DUMP = 'false';
    expect(isAudioDebugDumpEnabled()).toBe(false);
  });
});

describe('SpeakingLiveAudioDiagnostics — disabled (the default)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('record()/finalize() are complete no-ops — no filesystem writes, no report', async () => {
    const diagnostics = new SpeakingLiveAudioDiagnostics(false);

    diagnostics.record(encodeChunk([0.5, -0.5, 0.5, -0.5]));
    const report = await diagnostics.finalize('turn');

    expect(report).toBeNull();
    expect(mockedMkdir).not.toHaveBeenCalled();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });
});

describe('SpeakingLiveAudioDiagnostics — enabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
  });

  it('finalize() with nothing recorded is a no-op (no write, null report)', async () => {
    const diagnostics = new SpeakingLiveAudioDiagnostics(true);

    const report = await diagnostics.finalize('turn');

    expect(report).toBeNull();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('computes duration/RMS/peak/clipped exactly on known synthetic PCM16 data', async () => {
    const diagnostics = new SpeakingLiveAudioDiagnostics(true);
    // Two chunks, 16000 samples total (0.5s @ 16kHz): first 8000 samples at
    // exactly half amplitude (0.5), the other 8000 at digital silence (0) —
    // hand-computable expected stats, split across chunks to also prove
    // multi-chunk concatenation works.
    diagnostics.record(encodeChunk(new Array<number>(8000).fill(0.5)));
    diagnostics.record(encodeChunk(new Array<number>(8000).fill(0)));

    const report = await diagnostics.finalize('turn');

    expect(report).not.toBeNull();
    expect(report!.chunkCount).toBe(2);
    expect(report!.byteCount).toBe(16000 * 2);
    expect(report!.durationSeconds).toBeCloseTo(1.0, 5); // 16000 samples / 16000Hz
    // RMS of [0.5 x8000, 0 x8000] = sqrt((8000*0.25)/16000) = sqrt(0.125)
    expect(report!.rms).toBeCloseTo(Math.sqrt(0.125), 3);
    expect(report!.peak).toBeCloseTo(0.5, 3);
    expect(report!.clippedRatio).toBe(0);
  });

  it('reports full-scale samples as clipped', async () => {
    const diagnostics = new SpeakingLiveAudioDiagnostics(true);
    diagnostics.record(encodeChunk([1, -1, 1, -1, 0.1]));

    const report = await diagnostics.finalize('turn');

    expect(report!.peak).toBeCloseTo(1, 2);
    expect(report!.clippedRatio).toBeCloseTo(4 / 5, 5);
  });

  it('reset() discards buffered chunks without writing anything', async () => {
    const diagnostics = new SpeakingLiveAudioDiagnostics(true);
    diagnostics.record(encodeChunk([0.9, -0.9]));

    diagnostics.reset();
    const report = await diagnostics.finalize('turn');

    expect(report).toBeNull();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('writes a WAV with a correct 44-byte RIFF/WAVE/fmt/data header and returns its path', async () => {
    const diagnostics = new SpeakingLiveAudioDiagnostics(true);
    diagnostics.record(encodeChunk([0.5, -0.5]));

    const report = await diagnostics.finalize('turn');

    expect(mockedMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBuffer] = mockedWriteFile.mock.calls[0] as [string, Buffer];
    expect(report!.wavPath).toBe(writtenPath);
    expect(writtenPath.endsWith('.wav')).toBe(true);

    const header = writtenBuffer.subarray(0, 44);
    expect(header.toString('ascii', 0, 4)).toBe('RIFF');
    expect(header.toString('ascii', 8, 12)).toBe('WAVE');
    expect(header.toString('ascii', 12, 16)).toBe('fmt ');
    expect(header.readUInt16LE(20)).toBe(1); // PCM
    expect(header.readUInt16LE(22)).toBe(1); // mono
    expect(header.readUInt32LE(24)).toBe(16000); // sample rate
    expect(header.readUInt16LE(34)).toBe(16); // bits per sample
    expect(header.toString('ascii', 36, 40)).toBe('data');
    expect(header.readUInt32LE(40)).toBe(4); // 2 samples * 2 bytes
    expect(writtenBuffer.length).toBe(44 + 4);
  });

  it('never throws even if the filesystem write fails — a diagnostic tool must not affect the real conversation', async () => {
    mockedWriteFile.mockRejectedValue(new Error('disk full'));
    const diagnostics = new SpeakingLiveAudioDiagnostics(true);
    diagnostics.record(encodeChunk([0.2, -0.2]));

    const report = await diagnostics.finalize('turn');

    expect(report).not.toBeNull();
    expect(report!.wavPath).toBeNull(); // write failed, stats still computed and returned
  });
});
