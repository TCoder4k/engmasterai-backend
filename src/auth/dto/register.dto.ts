import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";

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
}