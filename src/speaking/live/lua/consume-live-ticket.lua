-- Atomically consumes a single-use Speaking Live WS ticket: read it, and if
-- present, delete it in the SAME EVAL so no second caller can ever read the
-- same still-valid value in the gap between a GET and a DEL — the whole
-- reason this is a ticket at all (see speaking-live-ticket.store.ts's own
-- header comment).
--
-- KEYS[1] = speaking:live-ticket:<ticket>
--
-- Returns the stored JSON string, or false if the ticket was missing,
-- expired, or already consumed.

local raw = redis.call('GET', KEYS[1])
if raw then
  redis.call('DEL', KEYS[1])
end
return raw
