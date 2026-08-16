-- Atomically appends a user+assistant turn pair to a bounded chat session
-- (Phase B).
--
-- KEYS[1] = chat:session:<userId>
-- ARGV[1] = userText
-- ARGV[2] = assistantText
-- ARGV[3] = nowMs
-- ARGV[4] = maxTurns   -- e.g. 12 (6 exchanges); oldest PAIR dropped once exceeded
-- ARGV[5] = ttlSeconds -- sliding TTL, refreshed on every append
--
-- Read-modify-truncate-write as ONE EVAL so two DIFFERENT messages for the
-- same user arriving concurrently (e.g. two browser tabs) can never lose one
-- another's turn — Redis serializes EVAL calls against the same key, the
-- same guarantee rotate-refresh-token.lua relies on. This script only ever
-- touches the SESSION key; per-message idempotency (not calling Gemini
-- twice for the same clientMessageId) is a separate concern handled by
-- chat-idempotency.store.ts BEFORE this script ever runs.
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
