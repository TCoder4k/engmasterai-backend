-- Atomic fixed-window counter increment (Sprint 01C).
--
-- KEYS[1] = the rate-limit bucket key (see src/auth/rate-limit/rate-limit-key.util.ts)
-- ARGV[1] = windowSeconds -- TTL applied only when this call creates the key
--
-- Returns the counter's value *after* this increment (a Lua integer).
--
-- INCR + a conditional EXPIRE (only on the first increment, when the counter
-- was just created) is the standard atomic fixed-window pattern: one EVAL
-- round trip, no read-then-write race between checking a count and writing
-- it back (the GET -> increment-in-app -> SET anti-pattern this replaces).
-- Every subsequent increment against the same key does NOT touch the TTL, so
-- the window has a fixed start (first request) and a fixed end (that
-- request's TTL), never a sliding one.

local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
