// Shared shapes for the Engy Chat MVP (Phase B) — used by the session store,
// the idempotency store and the controller's response typing.

export interface StoredChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Epoch ms. Internal only — never re-serialized as a raw number to the client (see chat.controller.ts). */
  at: number;
}

export interface ChatSessionSnapshot {
  turns: StoredChatTurn[];
  /** ISO timestamp, or null when there is no live session (nothing stored, or it expired). */
  expiresAt: string | null;
}

export interface SendChatMessageResult {
  clientMessageId: string;
  reply: string;
  repliedAt: string;
}
