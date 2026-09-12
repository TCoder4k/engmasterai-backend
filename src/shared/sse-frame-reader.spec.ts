import { SseFrameBuffer, consumeSseStream } from './sse-frame-reader';

describe('SseFrameBuffer', () => {
  it('extracts a single complete frame terminated by \\n\\n', () => {
    const buffer = new SseFrameBuffer();
    const frames = buffer.push('event: delta\ndata: {"text":"hi"}\n\n');
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"hi"}' }]);
  });

  it('extracts a single complete frame terminated by \\r\\n\\r\\n', () => {
    const buffer = new SseFrameBuffer();
    const frames = buffer.push('event: delta\r\ndata: {"text":"hi"}\r\n\r\n');
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"hi"}' }]);
  });

  it('holds a partial frame until the rest arrives in a later push, emitting nothing early', () => {
    const buffer = new SseFrameBuffer();
    const first = buffer.push('event: delta\ndata: {"te');
    expect(first).toEqual([]);
    const second = buffer.push('xt":"hi"}\n\n');
    expect(second).toEqual([{ event: 'delta', data: '{"text":"hi"}' }]);
  });

  it('extracts multiple frames delivered in one push, in order', () => {
    const buffer = new SseFrameBuffer();
    const frames = buffer.push(
      'event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\n',
    );
    expect(frames).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'delta', data: '{"text":"b"}' },
    ]);
  });

  it('keeps a trailing incomplete frame in the buffer after extracting complete ones ahead of it', () => {
    const buffer = new SseFrameBuffer();
    const frames = buffer.push('event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"tex');
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"a"}' }]);
    const rest = buffer.push('t":"b"}\n\n');
    expect(rest).toEqual([{ event: 'delta', data: '{"text":"b"}' }]);
  });

  it('joins multiple data: lines within one frame with a newline, per the SSE spec', () => {
    const buffer = new SseFrameBuffer();
    const frames = buffer.push('event: delta\ndata: line one\ndata: line two\n\n');
    expect(frames).toEqual([{ event: 'delta', data: 'line one\nline two' }]);
  });

  it('drops a frame with no data: line at all (e.g. a bare comment/keep-alive)', () => {
    const buffer = new SseFrameBuffer();
    const frames = buffer.push(': keep-alive\n\ndata: {"text":"a"}\n\n');
    expect(frames).toEqual([{ event: undefined, data: '{"text":"a"}' }]);
  });

  it('does not confuse an \\r\\n\\r\\n boundary for an \\n\\n boundary (no false-positive substring match)', () => {
    const buffer = new SseFrameBuffer();
    // If the implementation only ever looked for "\n\n", this would still
    // work by accident — the real risk is the reverse: this input must NOT
    // spuriously match "\n\n" and cut the frame in the wrong place.
    const frames = buffer.push('event: delta\r\ndata: {"text":"a"}\r\n\r\ndata: {"text":"b"}\n\n');
    expect(frames).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: undefined, data: '{"text":"b"}' },
    ]);
  });
});

describe('consumeSseStream', () => {
  const encoder = new TextEncoder();
  const streamOf = (pieces: string[], onCancel?: () => void): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
      cancel: onCancel,
    });

  it('reassembles a frame split across two underlying reads', async () => {
    const seen: string[] = [];
    await consumeSseStream(
      streamOf(['data: {"tex', 't":"hi"}\n\n']),
      (frame) => {
        seen.push(frame.data);
      },
    );
    expect(seen).toEqual(['{"text":"hi"}']);
  });

  it('processes every frame from a single chunk that carries several', async () => {
    const seen: string[] = [];
    await consumeSseStream(
      streamOf(['data: {"text":"a"}\n\ndata: {"text":"b"}\n\ndata: {"text":"c"}\n\n']),
      (frame) => {
        seen.push(frame.data);
      },
    );
    expect(seen).toEqual(['{"text":"a"}', '{"text":"b"}', '{"text":"c"}']);
  });

  it('stops reading and cancels the underlying stream when onFrame returns false', async () => {
    let cancelled = false;
    const seen: string[] = [];
    // Deliberately built WITHOUT closing the stream: if `close()` had
    // already run, cancelling a stream already marked closed is a spec-level
    // no-op that never invokes the source's own `cancel()` — this would
    // make the assertion below pass by accident regardless of whether
    // `consumeSseStream` actually calls `reader.cancel()`.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"text":"a"}\n\ndata: {"text":"b"}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });

    await consumeSseStream(body, (frame) => {
      seen.push(frame.data);
      return false;
    });

    expect(seen).toEqual(['{"text":"a"}']); // stopped after the first frame, never saw "b"
    expect(cancelled).toBe(true);
  });
});
