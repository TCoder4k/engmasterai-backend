-- Atomically consumes a single-use Community Live WS ticket: read it, and if
-- present, delete it in the SAME EVAL so no second caller can ever read the
-- same still-valid value in the gap between a GET and a DEL — same
-- reasoning as speaking/live/lua/consume-live-ticket.lua, own copy (every
-- module owns its own Lua scripts in this codebase, no cross-module
-- sharing).
--
-- KEYS[1] = community:live-ticket:<ticket>
--
-- Returns the stored JSON string, or false if the ticket was missing,
-- expired, or already consumed.

local raw = redis.call('GET', KEYS[1])
if raw then
  redis.call('DEL', KEYS[1])
end
return raw
