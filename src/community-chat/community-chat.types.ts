// One shape, shared by the REST list response, the POST response, and the
// WS broadcast payload — exactly one place in the module maps a Prisma row
// into what a client ever sees.
export interface CommunityMessageDto {
  id: string;
  content: string;
  clientMessageId: string;
  createdAt: string;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
    level: number;
  };
}

export interface ListCommunityMessagesResult {
  data: CommunityMessageDto[];
  meta: {
    hasMore: boolean;
    oldestId: string | null;
  };
}
