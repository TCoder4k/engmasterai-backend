import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDTO {
  // Opaque base64url token (32 raw bytes) — same structural bound as
  // VerifyEmailDTO.token, see src/auth/tokens/secure-token.util.ts.
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
