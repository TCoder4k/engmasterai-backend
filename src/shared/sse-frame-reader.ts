// A single SSE ("Server-Sent Events") event over the wire is one or more
// `field: value` lines terminated by a BLANK line — this module treats the
// blank line as the only thing that marks "this frame is complete".
export interface SseFrame {
  event?: string;
  data: string;
}

/**
 * Buffers decoded text across multiple `reader.read()` calls and yields only
 * COMPLETE frames, never a naive per-chunk split.
 *
 * WHY THIS EXISTS (2026-09-12, Engy Chat streaming): a real SSE producer
 * (Gemini's `alt=sse`, and this app's own relayed stream) does not align
 * frame boundaries to network chunk boundaries — a single frame can arrive
 * split across two chunks, and several frames can arrive in one chunk. A
 * test that mocks "one chunk == one frame" never exercises either case and
 * gives false confidence; this class is what makes both cases mechanical to
 * test (see gemini-engy-chat.provider.spec.ts's chunk-boundary tests).
 *
 * Accepts BOTH `\n\n` and `\r\n\r\n` as the frame terminator — real producers
 * vary, and there is no reason to gamble on which one shows up in
 * production. Does not special-case a lone `\r\n` or mixed line endings
 * inside one frame (per-line splitting already tolerates `\r\n` or `\n`
 * indiscriminately); only the BLANK-LINE terminator itself needs the two
 * literal forms recognised.
 */
export class SseFrameBuffer {
  private buffer = '';

  /** Feed newly-decoded text; returns every complete frame extractable now, oldest first. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const boundary = this.findBoundary();
      if (!boundary) break;
      const raw = this.buffer.slice(0, boundary.start);
      this.buffer = this.buffer.slice(boundary.end);
      const frame = parseSseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  private findBoundary(): { start: number; end: number } | null {
    const lf = this.buffer.indexOf('\n\n');
    const crlf = this.buffer.indexOf('\r\n\r\n');
    if (lf === -1 && crlf === -1) return null;
    // `\r\n\r\n` never contains `\n\n` as a substring (the two `\n`s are
    // separated by a `\r`), so the two searches never collide — take
    // whichever boundary starts earlier in the buffer.
    if (crlf !== -1 && (lf === -1 || crlf < lf)) return { start: crlf, end: crlf + 4 };
    return { start: lf, end: lf + 2 };
  }
}

const parseSseFrame = (raw: string): SseFrame | null => {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split(/\r\n|\n/)) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  // A comment-only or empty frame (e.g. a keep-alive ping) carries no data —
  // nothing for a caller to act on.
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
};

/**
 * Drains a streamed HTTP body as SSE frames, in order, via the buffer above.
 * `onFrame` returning `false` stops the read early (`reader.cancel()`) —
 * used by gemini-engy-chat.provider.ts to stop as soon as the reply-length
 * cap is reached, without waiting for Gemini to finish generating.
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => boolean | void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseFrameBuffer();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    for (const frame of sse.push(decoder.decode(value, { stream: true }))) {
      if (onFrame(frame) === false) {
        await reader.cancel();
        return;
      }
    }
  }
}
