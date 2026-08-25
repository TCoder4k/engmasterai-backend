import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

//Define a type for registration request
export class RegisterDTO {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  // Optional at this layer on purpose — TurnstileVerifierService is what
  // enforces "required when TURNSTILE_ENABLED", not this DTO, so a missing
  // token surfaces the clearer CAPTCHA-specific error instead of a generic
  // validation-pipe message, and a staggered backend/frontend deploy can't
  // produce a confusing 400 from this decorator alone.
  @IsOptional()
  @IsString()
  captchaToken?: string;
}
