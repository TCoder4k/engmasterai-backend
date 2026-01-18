import { Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService){

    }
    //some requests from client
    @Post("register") //register a new user
    register(){
        return this.authService.register();
    }
    //now controller calls service
    //POST:.../auth/login
    @Post("login")
    login(){
        return this.authService.login();
    }
}