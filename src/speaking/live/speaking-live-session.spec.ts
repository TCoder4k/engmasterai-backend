import { combine, SpeakingLiveServerEvent, SpeakingLiveSession } from './speaking-live-session';
import {
  SpeakingLiveConnectCallbacks,
  SpeakingLiveConnectionHandle,
  SpeakingLiveConnectionProvider,
  SpeakingLiveConnectOptions,
} from './speaking-live-connection.provider';
import { SpeakingSessionStore } from '../speaking-session.store';
import { SpeakingAiExerciseContext } from '../speaking.types';

// The correctness-critical suite for the whole Live rewrite — see this
// file's sibling speaking-live-session.ts header for the accumulator/
// finalize contract being tested here. No real Gemini call, no real Redis:
// a FAKE connection provider hands the test direct control over exactly
// when/what "Gemini" sends back, and SpeakingSessionStore is a jest mock so
// every test can assert on appendTurn's call count directly — the same
// discipline speaking-attempt.service.spec.ts already uses for its own
// fake SPEAKING_AI_PROVIDER/SPEAKING_SPEECH_TO_TEXT_PROVIDER.

const EXERCISE: SpeakingAiExerciseContext = {
  aiRole: 'a barista',
  level: 'A2',
  description: 'Ordering coffee',
  openingLine: 'Hi! What can I get you today?',
  conversationGoal: null,
};

class FakeConnection implements SpeakingLiveConnectionHandle {
  sendRealtimeInput = jest.fn();
  sendClientTurn = jest.fn();
  close = jest.fn();
}

class FakeConnectionProvider implements SpeakingLiveConnectionProvider {
  connection = new FakeConnection();
  callbacks: SpeakingLiveConnectCallbacks | null = null;
  connectError: Error | null = null;

  async connect(options: SpeakingLiveConnectOptions): Promise<SpeakingLiveConnectionHandle> {
    if (this.connectError) throw this.connectError;
    this.callbacks = options.callbacks;
    return this.connection;
  }
}

const buildStoreMock = (): SpeakingSessionStore =>
  ({
    appendTurn: jest.fn().mockResolvedValue(undefined),
  }) as unknown as SpeakingSessionStore;

/** appendTurn's success path sends `turnFinalized` inside a `.then()` — flush it before asserting on events. */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const setup = () => {
  const provider = new FakeConnectionProvider();
  const store = buildStoreMock();
  const events: SpeakingLiveServerEvent[] = [];
  const session = new SpeakingLiveSession(
    'user-1',
    'attempt-1',
    EXERCISE,
    provider,
    store,
    (event) => events.push(event),
  );
  return { provider, store, events, session };
};

/** Simulates Gemini finishing the cued opening-line turn — every test that exercises real student turns starts here, since the mic gate (phase !== 'idle') only opens once this fires. */
const completeOpening = (provider: FakeConnectionProvider) => {
  provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });
};

describe('combine()', () => {
  it('concatenates deltas in arrival order — confirmed empirically, not a cumulative-string replace', () => {
    expect(combine('The ocean', ' covers')).toBe('The ocean covers');
    expect(combine('', 'Hello')).toBe('Hello');
  });
});

describe('SpeakingLiveSession — opening line', () => {
  it('start() cues Gemini to speak the authored opening line verbatim, via sendClientTurn, not sendRealtimeInput', async () => {
    const { provider, session } = setup();
    await session.start();

    expect(provider.connection.sendClientTurn).toHaveBeenCalledTimes(1);
    expect(provider.connection.sendClientTurn).toHaveBeenCalledWith(
      expect.stringContaining(EXERCISE.openingLine),
    );
    expect(provider.connection.sendRealtimeInput).not.toHaveBeenCalled();
  });

  it('blocks activityStart until the opening line finishes — no real turn can start mid-greeting', async () => {
    const { provider, session } = setup();
    await session.start();

    session.handleActivityStart(); // too early — opening still in flight
    expect(provider.connection.sendRealtimeInput).not.toHaveBeenCalled();

    completeOpening(provider);
    session.handleActivityStart();
    expect(provider.connection.sendRealtimeInput).toHaveBeenCalledWith({ activityStart: {} });
  });

  it("the opening line's turnComplete emits openingReady, not turnFinalized, and never touches the store", async () => {
    const { provider, store, events, session } = setup();
    await session.start();

    // Gemini's own spoken rendition of the opening line still produces
    // audio + an output transcript while phase === 'opening' — none of it
    // should be persisted or reported as a real turn.
    provider.callbacks!.onmessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: 'GREETING_AUDIO' } }] } },
    });
    provider.callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'Hi! What can I get you today?' } } });
    completeOpening(provider);

    expect(store.appendTurn).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'openingReady' });
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'turnFinalized' }));
    // The audio itself still relays live, same as any other turn's audio.
    expect(events).toContainEqual({ type: 'audioChunk', data: 'GREETING_AUDIO' });
  });

  it('a duplicate/late turnComplete for the opening line is a no-op', async () => {
    const { provider, events, session } = setup();
    await session.start();

    completeOpening(provider);
    completeOpening(provider); // duplicate/late

    expect(events.filter((e) => e.type === 'openingReady')).toHaveLength(1);
  });
});

describe('SpeakingLiveSession', () => {
  it('multi-chunk transcripts reconstruct correctly on both sides via combine()', async () => {
    const { provider, store, events, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'A latte' } } });
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: ', please.' } } });
    session.handleActivityEnd();
    provider.callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'Great' } } });
    provider.callbacks!.onmessage({ serverContent: { outputTranscription: { text: ' choice!' } } });
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });
    await flushMicrotasks(); // finalizeTurn's sendToClient runs after appendTurn's promise resolves

    expect(store.appendTurn).toHaveBeenCalledTimes(1);
    expect(store.appendTurn).toHaveBeenCalledWith('user-1', 'attempt-1', 'A latte, please.', 'Great choice!');
    expect(events).toContainEqual({
      type: 'turnFinalized',
      userText: 'A latte, please.',
      aiText: 'Great choice!',
    });
  });

  it('a duplicate turnComplete for the same turn appends to the store exactly once', async () => {
    const { provider, store, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'Hi' } } });
    provider.callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'Hello!' } } });
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } }); // duplicate/late

    expect(store.appendTurn).toHaveBeenCalledTimes(1);
  });

  it('interleaved input/output transcription chunks still resolve to the correct text per side', async () => {
    const { provider, store, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    // Deliberately mixed order — the accumulators are independent, so
    // interleaving between the two fields must not corrupt either one.
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'Two' } } });
    provider.callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'Sure' } } });
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: ' coffees' } } });
    provider.callbacks!.onmessage({ serverContent: { outputTranscription: { text: ', coming up!' } } });
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });

    expect(store.appendTurn).toHaveBeenCalledWith(
      'user-1',
      'attempt-1',
      'Two coffees',
      'Sure, coming up!',
    );
  });

  it('turnComplete with an empty transcript on either side appends nothing and emits turnEmpty', async () => {
    const { provider, store, events, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    session.handleActivityEnd(); // student tapped stop immediately, said nothing
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });

    expect(store.appendTurn).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'turnEmpty' });
  });

  it('turnComplete with only ONE side empty (e.g. Gemini produced no reply) also appends nothing', async () => {
    const { provider, store, events, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'Hello?' } } });
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } }); // no output transcription arrived

    expect(store.appendTurn).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'turnEmpty' });
  });

  it('a Gemini error mid-turn discards the in-flight accumulators, never touches the store, and emits turnError then sessionClosed', async () => {
    const { provider, store, events, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'partial' } } });
    provider.callbacks!.onerror(new Error('transport dropped'));

    // A late-arriving turnComplete after the fatal error must also be inert.
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });

    expect(store.appendTurn).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'turnError' });
    expect(events).toContainEqual({ type: 'sessionClosed', reason: 'error: transport dropped' });
  });

  it('a Gemini error with NO in-flight turn does not emit turnError, only sessionClosed', async () => {
    const { provider, events, session } = setup();
    await session.start();
    completeOpening(provider);

    provider.callbacks!.onerror(new Error('idle disconnect'));

    expect(events).not.toContainEqual({ type: 'turnError' });
    expect(events.some((e) => e.type === 'sessionClosed')).toBe(true);
  });

  it('close() (client disconnect mid-turn) discards the in-flight turn — the store is never called', async () => {
    const { provider, store, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'unfinished' } } });
    session.close();

    // A stray late message must also be inert once closed.
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });

    expect(store.appendTurn).not.toHaveBeenCalled();
    expect(provider.connection.close).toHaveBeenCalledTimes(1);
  });

  it('two full turns in the same session never double-count — appendTurn fires exactly twice', async () => {
    const { provider, store, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'One' } } });
    provider.callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'First reply' } } });
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });

    session.handleActivityStart(); // accumulators reset for the second turn
    provider.callbacks!.onmessage({ serverContent: { inputTranscription: { text: 'Two' } } });
    provider.callbacks!.onmessage({ serverContent: { outputTranscription: { text: 'Second reply' } } });
    provider.callbacks!.onmessage({ serverContent: { turnComplete: true } });

    expect(store.appendTurn).toHaveBeenCalledTimes(2);
    expect(store.appendTurn).toHaveBeenNthCalledWith(1, 'user-1', 'attempt-1', 'One', 'First reply');
    expect(store.appendTurn).toHaveBeenNthCalledWith(2, 'user-1', 'attempt-1', 'Two', 'Second reply');
  });

  it('relays each audio chunk to the client as it arrives, independent of transcript finalization', async () => {
    const { provider, events, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    provider.callbacks!.onmessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAAA' } }] } },
    });

    expect(events).toContainEqual({ type: 'audioChunk', data: 'AAAA' });
  });

  it('relays interrupted as a defensive signal even though manual activity control never expects it', async () => {
    const { provider, events, session } = setup();
    await session.start();
    completeOpening(provider);

    provider.callbacks!.onmessage({ serverContent: { interrupted: true } });

    expect(events).toContainEqual({ type: 'interrupted' });
  });

  it('forwards activityStart/audio/activityEnd to the underlying connection', async () => {
    const { provider, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleActivityStart();
    session.handleAudioChunk('base64chunk');
    session.handleActivityEnd();

    expect(provider.connection.sendRealtimeInput).toHaveBeenNthCalledWith(1, { activityStart: {} });
    expect(provider.connection.sendRealtimeInput).toHaveBeenNthCalledWith(2, {
      audio: { data: 'base64chunk', mimeType: 'audio/pcm;rate=16000' },
    });
    expect(provider.connection.sendRealtimeInput).toHaveBeenNthCalledWith(3, { activityEnd: {} });
  });

  it('ignores an audio chunk sent outside an active turn (defensive — should not happen given the mic gating)', async () => {
    const { provider, session } = setup();
    await session.start();
    completeOpening(provider);

    session.handleAudioChunk('stray-chunk'); // no activityStart yet

    expect(provider.connection.sendRealtimeInput).not.toHaveBeenCalled();
  });
});
