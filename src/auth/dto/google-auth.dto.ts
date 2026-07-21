import { IsJWT, MaxLength } from 'class-validator';

// A structural JWT-shape check only (three dot-separated base64url
// segments) — rejects malformed input at 400 before the credential ever
// reaches GoogleTokenVerifierService. It does NOT mean the token is a valid
// Google credential; that's verified separately.
export class GoogleAuthDTO {
  @IsJWT()
  @MaxLength(4096)
  credential: string;
}
