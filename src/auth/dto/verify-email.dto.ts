import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// The token is an opaque base64url string (32 raw bytes), not a JWT — see
// src/auth/tokens/secure-token.util.ts. MaxLength is a generous structural
// bound (44 chars for 32 bytes base64url-encoded, rounded well up) that
// rejects grossly oversized input before it ever reaches a database lookup.
export class VerifyEmailDTO {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;
}
