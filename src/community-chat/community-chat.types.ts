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
    // Computed from User.role — never the raw UserRole enum, so the public
    // shape stays closed/stable even if that enum grows a third value later.
    // Non-sensitive (unlike email, deliberately stripped by
    // SAFE_AUTHOR_SELECT): role is already exposed to the frontend today via
    // authService's own stored user, used for role-based routing — labeling
    // an admin's broadcast message is exactly the point of exposing it here.
    isAdmin: boolean;
  };
}

export interface ListCommunityMessagesResult {
  data: CommunityMessageDto[];
  meta: {
    hasMore: boolean;
    oldestId: string | null;
  };
}
