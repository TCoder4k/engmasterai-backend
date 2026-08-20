import { SpeakingAiExerciseContext } from '../speaking.types';

// Speaking Partner Live — the system instruction for one Gemini Live
// session. SALVAGED from gemini-speaking-ai.provider.ts's own
// buildSystemInstruction (that provider is retired along with the old
// STT→text→TTS pipeline — see docs/CLAUDE.md's Speaking Live section) —
// same exercise-persona core (role, level, topic, opening-line-awareness,
// in-character rules), extended with the voice/pacing guidance from the
// product owner's own Live config sketch. The two are combined here rather
// than kept as two separate instructions because the Live API takes exactly
// one systemInstruction string per session.
//
// THE OPENING LINE NOW GOES THROUGH GEMINI LIVE TOO (2026-08-19 follow-up).
// It was originally static DB content spoken via the browser's own TTS —
// deliberately, to avoid a Gemini call before the student ever says a word.
// In real use that meant the greeting played in the OS's default
// SpeechSynthesis voice (on Windows, typically a dated-sounding male voice)
// while every real turn afterward played in the Live session's own
// configured voice (see GEMINI_LIVE_VOICE) — two audibly different
// "characters" in what is supposed to read as one conversation partner,
// flagged directly by the product owner testing it live. Fixed by having
// `SpeakingLiveSession.start()` cue Gemini itself to speak the authored line
// verbatim as the session's first generated turn (see
// buildSpeakingLiveOpeningCue below and speaking-live-session.ts's
// `triggerOpeningLine()`), so the opening line and every later turn share
// the exact same voice. The system instruction below reflects that: the
// model is told it WILL be cued, not that it already spoke.
export const buildSpeakingLiveSystemInstruction = (exercise: SpeakingAiExerciseContext): string => {
  const goalClause = exercise.conversationGoal
    ? `, steering naturally toward: ${exercise.conversationGoal}`
    : '';

  return [
    `You are an English conversation partner, role-playing as ${exercise.aiRole}.`,
    '',
    `Student CEFR level: ${exercise.level}`,
    `Topic: ${exercise.description}`,
    `You will be cued to open the conversation. When cued, say exactly this line, word for word, nothing added before or after it: "${exercise.openingLine}". After that, never repeat it or re-greet.`,
    '',
    'Voice and delivery:',
    '- Speak in natural American English.',
    '- Use a clear, warm, youthful conversational tone.',
    '- Speak at a moderate pace suitable for CEFR A1-B2 learners.',
    '- Keep pronunciation clear and natural.',
    '- Use short sentences when the student\'s level is low.',
    '- Do not sound like a narrator, presenter, or advertisement.',
    '',
    'Language:',
    '- The student is a Vietnamese native speaker learning English — they may sometimes speak or mix in Vietnamese, especially when stuck for a word.',
    '- Always understand Vietnamese input correctly; never treat it as noise, mistranscribe it, or ignore it.',
    '- Reply primarily in English. If the student is clearly stuck (asks in Vietnamese, hesitates, or explicitly asks for help), you may give ONE short Vietnamese clarifying phrase or hint, then immediately continue in English.',
    '- Never let a Vietnamese aside turn your whole reply into Vietnamese, and never switch the main language of the conversation away from English.',
    '',
    'Rules:',
    `- Keep responses appropriate for ${exercise.level}.`,
    '- Use short natural sentences — 1-3 spoken sentences per turn, never a list or heading.',
    '- Ask only one main question at a time.',
    '- Encourage the student to continue speaking.',
    '- Do not give long explanations.',
    '- Do not immediately correct every small mistake.',
    `- Stay within the current conversation topic${goalClause}.`,
    `- Stay in character as ${exercise.aiRole}; never break character to mention being an AI.`,
    `- No stage directions, no asterisked actions — only what ${exercise.aiRole} would actually say.`,
  ].join('\n');
};

/**
 * The synthetic "kickoff" client turn sent immediately after connecting, so
 * Gemini generates the authored opening line as real Live audio in its own
 * voice instead of it being spoken by the browser's unrelated TTS voice.
 * Sent via sendClientContent (text, not audio) — see
 * SpeakingLiveConnectionHandle.sendClientTurn.
 */
export const buildSpeakingLiveOpeningCue = (openingLine: string): string =>
  `[System cue — not something the student said] Begin the conversation now: say exactly this line, word for word, nothing added before or after it: "${openingLine}"`;
