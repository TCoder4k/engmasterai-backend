import { NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { AssessmentInProgressException, ChatReplyInProgressException } from './chat.exceptions';
import { EngyChatError } from './engy-chat.provider';
import { ChatContextInput } from './chat-context.types';

const GENERAL: ChatContextInput = { type: 'GENERAL' };
const noopOnDelta = (): void => {};

const buildService = (overrides: {
  assertNotInPlacementAttempt?: jest.Mock;
  resolveContext?: jest.Mock;
  claim?: jest.Mock;
  commit?: jest.Mock;
  release?: jest.Mock;
  getTurns?: jest.Mock;
  getSnapshot?: jest.Mock;
  clear?: jest.Mock;
  appendTurn?: jest.Mock;
  reply?: jest.Mock;
  ttlSeconds?: number;
}) => {
  const assessmentLock = {
    assertNotInPlacementAttempt:
      overrides.assertNotInPlacementAttempt ?? jest.fn().mockResolvedValue(undefined),
  };
  const contextResolver = {
    resolve: overrides.resolveContext ?? jest.fn().mockResolvedValue(null),
  };
  const sessionStore = {
    getTurns: overrides.getTurns ?? jest.fn().mockResolvedValue([]),
    getSnapshot:
      overrides.getSnapshot ?? jest.fn().mockResolvedValue({ turns: [], expiresAt: null }),
    clear: overrides.clear ?? jest.fn().mockResolvedValue(undefined),
    appendTurn: overrides.appendTurn ?? jest.fn().mockResolvedValue(undefined),
    ttlSeconds: overrides.ttlSeconds ?? 1800,
  };
  const idempotency = {
    claim: overrides.claim ?? jest.fn().mockResolvedValue({ outcome: 'claimed' }),
    commit: overrides.commit ?? jest.fn().mockResolvedValue(undefined),
    release: overrides.release ?? jest.fn().mockResolvedValue(undefined),
  };
  const provider = {
    reply: overrides.reply ?? jest.fn().mockResolvedValue({ reply: 'Hi there!' }),
  };
  const config = { get: (_key: string, fallback?: unknown) => fallback };

  const service = new ChatService(
    assessmentLock as never,
    contextResolver as never,
    sessionStore as never,
    idempotency as never,
    provider as never,
    config as never,
  );

  return { service, assessmentLock, contextResolver, sessionStore, idempotency, provider };
};

describe('ChatService.prepareSend', () => {
  it('blocks with AssessmentInProgressException when a Placement attempt is in progress, before touching context resolution, idempotency or Gemini', async () => {
    const lockError = new AssessmentInProgressException();
    const { service, contextResolver, idempotency, provider } = buildService({
      assertNotInPlacementAttempt: jest.fn().mockRejectedValue(lockError),
    });

    await expect(service.prepareSend('user-1', 'msg-1', 'hello', GENERAL)).rejects.toBe(lockError);
    expect(contextResolver.resolve).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it('a context resolution failure (e.g. an invisible lesson) propagates before the idempotency claim or Gemini are touched', async () => {
    const notFound = new NotFoundException('Quiz for lesson x not found');
    const { service, idempotency, provider } = buildService({
      resolveContext: jest.fn().mockRejectedValue(notFound),
    });

    await expect(
      service.prepareSend('user-1', 'msg-1', 'hello', { type: 'LESSON', resourceId: 'lesson-1' }),
    ).rejects.toBe(notFound);
    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it('an idempotent replay (claim resolves to done) returns the cached reply as `kind: replay`, without calling Gemini', async () => {
    const { service, provider } = buildService({
      claim: jest.fn().mockResolvedValue({
        outcome: 'done',
        reply: 'cached answer',
        repliedAt: '2026-01-01T00:00:00.000Z',
      }),
    });

    const prepared = await service.prepareSend('user-1', 'msg-1', 'hello', GENERAL);

    expect(prepared).toEqual({
      kind: 'replay',
      result: {
        clientMessageId: 'msg-1',
        reply: 'cached answer',
        repliedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it('a concurrent duplicate clientMessageId (claim resolves to conflict) throws ChatReplyInProgressException, never calling Gemini', async () => {
    const { service, provider } = buildService({
      claim: jest.fn().mockResolvedValue({ outcome: 'conflict' }),
    });

    await expect(service.prepareSend('user-1', 'msg-1', 'hello', GENERAL)).rejects.toBeInstanceOf(
      ChatReplyInProgressException,
    );
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it('the claim owner gets `kind: claimed` with the resolved context text and mapped history', async () => {
    const { service, contextResolver } = buildService({
      resolveContext: jest.fn().mockResolvedValue('The student is viewing lesson "Present Perfect".'),
      getTurns: jest.fn().mockResolvedValue([{ role: 'user', text: 'earlier', at: 1 }]),
    });

    const prepared = await service.prepareSend('user-1', 'msg-1', 'Explain more', {
      type: 'LESSON',
      resourceId: 'lesson-1',
      stage: 'theory',
    });

    expect(contextResolver.resolve).toHaveBeenCalledWith({
      type: 'LESSON',
      resourceId: 'lesson-1',
      stage: 'theory',
    });
    expect(prepared).toEqual({
      kind: 'claimed',
      contextText: 'The student is viewing lesson "Present Perfect".',
      history: [{ role: 'user', text: 'earlier' }],
    });
  });
});

describe('ChatService.streamReply', () => {
  const signal = () => new AbortController().signal;

  it('calls the provider with onDelta, commits, appends the turn, and returns `kind: done`', async () => {
    const { service, idempotency, sessionStore, provider } = buildService({
      reply: jest.fn().mockResolvedValue({ reply: 'Hi there!' }),
    });
    const deltas: string[] = [];

    const outcome = await service.streamReply(
      'user-1',
      'msg-1',
      'hello',
      null,
      [{ role: 'user', text: 'earlier' }],
      { signal: signal(), onDelta: (t) => deltas.push(t) },
    );

    expect(provider.reply).toHaveBeenCalledWith(
      { history: [{ role: 'user', text: 'earlier' }], message: 'hello', context: null },
      expect.any(Function),
      expect.any(Object),
    );
    expect(idempotency.commit).toHaveBeenCalledWith(
      'user-1',
      'msg-1',
      'Hi there!',
      expect.any(String),
      1800,
    );
    expect(sessionStore.appendTurn).toHaveBeenCalledWith('user-1', 'hello', 'Hi there!');
    expect(outcome).toEqual({
      kind: 'done',
      result: { clientMessageId: 'msg-1', reply: 'Hi there!', repliedAt: expect.any(String) },
    });
  });

  it('forwards onDelta calls from the provider straight through to the caller', async () => {
    const { service } = buildService({
      reply: jest.fn().mockImplementation(async (_req, onDelta: (t: string) => void) => {
        onDelta('Hi ');
        onDelta('there!');
        return { reply: 'Hi there!' };
      }),
    });
    const deltas: string[] = [];

    await service.streamReply('user-1', 'msg-1', 'hello', null, [], {
      signal: signal(),
      onDelta: (t) => deltas.push(t),
    });

    expect(deltas).toEqual(['Hi ', 'there!']);
  });

  it('a Gemini failure releases the claim and returns `kind: error`, never committing or appending', async () => {
    const { service, idempotency, sessionStore } = buildService({
      reply: jest.fn().mockRejectedValue(new EngyChatError('UNAVAILABLE', 'down')),
    });

    const outcome = await service.streamReply('user-1', 'msg-1', 'hello', null, [], {
      signal: signal(),
      onDelta: noopOnDelta,
    });

    expect(outcome).toEqual({ kind: 'error' });
    expect(idempotency.release).toHaveBeenCalledWith('user-1', 'msg-1');
    expect(idempotency.commit).not.toHaveBeenCalled();
    expect(sessionStore.appendTurn).not.toHaveBeenCalled();
  });

  // 2026-09-12 review decision: a client disconnect mid-stream cancels the
  // Gemini call and releases the claim rather than letting it finish and
  // commit a reply nobody received — see chat.controller.ts's res.on('close').
  it('a disconnect (signal already aborted when the provider throws) releases the claim and returns `kind: aborted`, never committing or appending, and does not re-throw', async () => {
    const controller = new AbortController();
    const { service, idempotency, sessionStore } = buildService({
      reply: jest.fn().mockImplementation(async () => {
        controller.abort();
        throw new Error('aborted mid-stream');
      }),
    });

    const outcome = await service.streamReply('user-1', 'msg-1', 'hello', null, [], {
      signal: controller.signal,
      onDelta: noopOnDelta,
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(idempotency.release).toHaveBeenCalledWith('user-1', 'msg-1');
    expect(idempotency.commit).not.toHaveBeenCalled();
    expect(sessionStore.appendTurn).not.toHaveBeenCalled();
  });

  it('an unexpected (non-EngyChatError, non-abort) failure still releases the claim and propagates unchanged', async () => {
    const boom = new Error('unexpected');
    const { service, idempotency } = buildService({
      reply: jest.fn().mockRejectedValue(boom),
    });

    await expect(
      service.streamReply('user-1', 'msg-1', 'hello', null, [], {
        signal: signal(),
        onDelta: noopOnDelta,
      }),
    ).rejects.toBe(boom);
    expect(idempotency.release).toHaveBeenCalledWith('user-1', 'msg-1');
  });
});

describe('ChatService.getSession / clearSession', () => {
  it('getSession delegates to the session store', async () => {
    const getSnapshot = jest.fn().mockResolvedValue({ turns: [], expiresAt: null });
    const { service } = buildService({ getSnapshot });

    await service.getSession('user-1');

    expect(getSnapshot).toHaveBeenCalledWith('user-1');
  });

  it('clearSession delegates to the session store', async () => {
    const clear = jest.fn().mockResolvedValue(undefined);
    const { service } = buildService({ clear });

    await service.clearSession('user-1');

    expect(clear).toHaveBeenCalledWith('user-1');
  });
});
