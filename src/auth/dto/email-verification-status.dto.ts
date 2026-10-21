import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class EmailVerificationStatusDTO {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
