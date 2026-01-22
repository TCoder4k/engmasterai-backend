import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";

//Define a type or authentication request
export class LoginDTO {
    @IsEmail()
    @IsString()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    password: string;
}