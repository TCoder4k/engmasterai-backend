// Same key-prefix-constant + builder-function convention as
// chat-redis.constants.ts / speaking-redis.constants.ts, own namespace.

export const COMMUNITY_LIVE_TICKET_PREFIX = 'community:live-ticket:';

/** One single-use WS-connect ticket — see live/community-chat-ticket.store.ts. */
export const communityLiveTicketKey = (ticket: string): string =>
  `${COMMUNITY_LIVE_TICKET_PREFIX}${ticket}`;
