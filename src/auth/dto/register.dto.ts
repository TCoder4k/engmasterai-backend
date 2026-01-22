import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";

//Define a type or authentication request
export class RegisterDTO {
    @IsEmail()
    @IsString()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    password: string;
}