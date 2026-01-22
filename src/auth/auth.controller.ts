import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDTO, RegisterDTO } from "./dto";
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService){

    }
    //some requests from client
    @Post("register") //register a new user
    //Gọi hàm register để xử lý 
    //@Body là decorator nói với Nestjs là dùng để lấy dữ liệu từ request body
    //RegisterDTO để định nghĩa CTDL và áp luật validation
    //dto dữ liệu người dùng gửi lên request body
    register(@Body() dto: RegisterDTO){
        
        return this.authService.register(dto);
    }
    //now controller calls service
    //POST:.../auth/login
    @Post("login")
    login(@Body() dto: LoginDTO){
        return this.authService.login(dto);
    }
}