import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum } from "class-validator";
import { UserRole } from "@prisma/client";

//Define a type for login request
export class LoginDTO {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    password: string;

    @IsEnum(UserRole, { message: 'Role must be either USER or ADMIN' })
    @IsNotEmpty()
    role: UserRole;
}