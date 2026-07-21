// Shared `Authorization: Bearer <token>` parsing, used by the logout path
// (which deliberately does not sit behind JwtAuthGuard — see auth.controller.ts)
// so the substring logic isn't duplicated inline.
export const extractBearerToken = (
  authorizationHeader?: string,
): string | undefined => {
  if (!authorizationHeader?.startsWith('Bearer ')) return undefined;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
};
