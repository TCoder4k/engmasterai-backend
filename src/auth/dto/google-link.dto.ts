import {
  IsJWT,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GoogleLinkDTO {
  @IsJWT()
  @MaxLength(4096)
  credential: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
