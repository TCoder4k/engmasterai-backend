/**
 * The single centralized email-normalization rule (Sprint 02B), reused by
 * registration, login, Google identity matching, and email-verification
 * resend — closing a real, confirmed inconsistency: local accounts were
 * previously stored/matched with whatever casing/whitespace the user typed,
 * while GoogleTokenVerifierService already lowercased/trimmed internally.
 * See docs/sprints/sprint-02B-email-verification.md's Email Normalization
 * Policy for the full reasoning and the account-linking bug this closes.
 *
 * Deliberately does NOT: strip dots (Gmail-specific, not a universal rule —
 * would incorrectly conflate distinct addresses at other providers), strip
 * plus-address tags (a real, user-intentional distinct-address mechanism),
 * or apply any other provider-specific normalization.
 *
 * Does NOT perform any database migration of existing rows — see the policy
 * doc's explicit "no silent migration" requirement. Existing mixed-case
 * local-account rows remain a documented, tracked technical debt item until
 * a dedicated future cleanup task runs the audit query it specifies.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
