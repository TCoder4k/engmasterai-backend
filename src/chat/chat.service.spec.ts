import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { AssessmentInProgressException, ChatReplyInProgressException } from './chat.exceptions';
import { EngyChatError } from './engy-chat.provider';
import { ChatContextInput } from './chat-context.types';

const GENERAL: ChatContextInput = { type: 'GENERAL' };

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
    model: 'fake-engy-model',
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

describe('ChatService.sendMessage', () => {
  it('blocks with AssessmentInProgressException when a Placement attempt is in progress, before touching context resolution, idempotency or Gemini', async () => {
    const lockError = new AssessmentInProgressException();
    const { service, contextResolver, idempotency, provider } = buildService({
      assertNotInPlacementAttempt: jest.fn().mockRejectedValue(lockError),
    });

    await expect(service.sendMessage('user-1', 'msg-1', 'hello', GENERAL)).rejects.toBe(
      lockError,
    );
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
      service.sendMessage('user-1', 'msg-1', 'hello', {
        type: 'LESSON',
        resourceId: 'lesson-1',
      }),
    ).rejects.toBe(notFound);
    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it('an idempotent replay (claim resolves to done) returns the cached reply without calling Gemini', async () => {
    const { service, provider } = buildService({
      claim: jest.fn().mockResolvedValue({
        outcome: 'done',
        reply: 'cached answer',
        repliedAt: '2026-01-01T00:00:00.000Z',
      }),
    });

    const result = await service.sendMessage('user-1', 'msg-1', 'hello', GENERAL);

    expect(result).toEqual({
      clientMessageId: 'msg-1',
      reply: 'cached answer',
      repliedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it('a concurrent duplicate clientMessageId (claim resolves to conflict) throws ChatReplyInProgressException, never calling Gemini', async () => {
    const { service, provider } = buildService({
      claim: jest.fn().mockResolvedValue({ outcome: 'conflict' }),
    });

    await expect(
      service.sendMessage('user-1', 'msg-1', 'hello', GENERAL),
    ).rejects.toBeInstanceOf(ChatReplyInProgressException);
    expect(provider.reply).not.toHaveBeenCalled();
  });

  it('the claim owner reads history, calls Gemini with it, commits, and appends the new turn', async () => {
    const { service, idempotency, sessionStore, provider } = buildService({
      getTurns: jest
        .fn()
        .mockResolvedValue([{ role: 'user', text: 'earlier', at: 1 }]),
      reply: jest.fn().mockResolvedValue({ reply: 'Hi there!' }),
    });

    const result = await service.sendMessage('user-1', 'msg-1', 'hello', GENERAL);

    expect(provider.reply).toHaveBeenCalledWith({
      history: [{ role: 'user', text: 'earlier' }],
      message: 'hello',
      context: null,
    });
    expect(idempotency.commit).toHaveBeenCalledWith(
      'user-1',
      'msg-1',
      'Hi there!',
      expect.any(String),
      1800,
    );
    expect(sessionStore.appendTurn).toHaveBeenCalledWith('user-1', 'hello', 'Hi there!');
    expect(result.reply).toBe('Hi there!');
    expect(result.clientMessageId).toBe('msg-1');
  });

  it('passes the resolved context text (not the raw context input) through to the provider', async () => {
    const { service, provider, contextResolver } = buildService({
      resolveContext: jest.fn().mockResolvedValue('The student is viewing lesson "Present Perfect".'),
    });

    await service.sendMessage('user-1', 'msg-1', 'Explain more', {
      type: 'LESSON',
      resourceId: 'lesson-1',
      stage: 'theory',
    });

    expect(contextResolver.resolve).toHaveBeenCalledWith({
      type: 'LESSON',
      resourceId: 'lesson-1',
      stage: 'theory',
    });
    expect(provider.reply).toHaveBeenCalledWith({
      history: [],
      message: 'Explain more',
      context: 'The student is viewing lesson "Present Perfect".',
    });
  });

  it('a Gemini failure releases the claim and reports 503, never committing or appending', async () => {
    const { service, idempotency, sessionStore } = buildService({
      reply: jest.fn().mockRejectedValue(new EngyChatError('UNAVAILABLE', 'down')),
    });

    await expect(
      service.sendMessage('user-1', 'msg-1', 'hello', GENERAL),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(idempotency.release).toHaveBeenCalledWith('user-1', 'msg-1');
    expect(idempotency.commit).not.toHaveBeenCalled();
    expect(sessionStore.appendTurn).not.toHaveBeenCalled();
  });

  it('an unexpected (non-EngyChatError) failure still releases the claim and propagates unchanged', async () => {
    const boom = new Error('unexpected');
    const { service, idempotency } = buildService({
      reply: jest.fn().mockRejectedValue(boom),
    });

    await expect(service.sendMessage('user-1', 'msg-1', 'hello', GENERAL)).rejects.toBe(boom);
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
