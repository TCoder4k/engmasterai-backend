-- Atomically appends a user+assistant turn pair to a bounded speaking
-- session (Phase 1+2). Copy of chat/lua/append-chat-turn.lua's exact
-- mechanism, keyed per-attempt instead of per-user.
--
-- KEYS[1] = speaking:session:<userId>:<attemptId>
-- ARGV[1] = userText
-- ARGV[2] = assistantText
-- ARGV[3] = nowMs
-- ARGV[4] = maxTurns   -- e.g. 24 (12 exchanges); oldest PAIR dropped once exceeded
-- ARGV[5] = ttlSeconds -- sliding TTL, refreshed on every append
--
-- Read-modify-truncate-write as ONE EVAL so two turns for the same attempt
-- (a genuinely concurrent double-tap, a retried request) can never lose one
-- another — Redis serializes EVAL calls against the same key. Per-turn
-- idempotency (not calling the STT/AI engines twice for the same
-- clientTurnId) is a separate concern handled by
-- speaking-idempotency.store.ts BEFORE this script ever runs — and,
-- matching Chat's own chosen ordering, the idempotency commit happens
-- BEFORE this append runs, not after (see SpeakingAttemptService.submitTurn).
--
-- Always inserts exactly 2 entries and maxTurns is always even, so the
-- while-loop below only ever removes whole (user, assistant) pairs from the
-- front — pairing can never end up split.

local raw = redis.call('GET', KEYS[1])
local turns
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  turns = (ok and decoded.turns) or {}
else
  turns = {}
end

table.insert(turns, { role = 'user', text = ARGV[1], at = tonumber(ARGV[3]) })
table.insert(turns, { role = 'assistant', text = ARGV[2], at = tonumber(ARGV[3]) })

local maxTurns = tonumber(ARGV[4])
while #turns > maxTurns do
  table.remove(turns, 1)
end

redis.call('SET', KEYS[1], cjson.encode({ turns = turns }), 'EX', ARGV[5])
return 'OK'
