import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ResendVerificationDTO {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
