import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDTO, RegisterDTO } from "./dto";
import * as argon from 'argon2';
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";

@Injectable()
export class AuthService {
  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService
    ) {
    
  }

    async register(dto: RegisterDTO ){
        try {
            //generate password to hashpassword
        const hashedPassWord = await argon.hash(dto.password);
    //insert data to database
        const user = await this.prismaService.user.create({
            data: {
                email: dto.email,
                 password: hashedPassWord,
                name: 'Lam',
            },
            //Only show id, email, createdAt
            select: {
                id: true,
                email: true,
                role: true,
                createdAt: true
            }
        })
        //Cấp token khi đăng ký thành công
              return await this.signJwtToken(user.id, user.email, user.role)

        } catch (error) {
            if(error.code == 'P2002'){
                throw new ForbiddenException("Error in credentials");
            }
        }
    }
   async login(dto: LoginDTO){
       //find user with input email
       const user = await this.prismaService.user
       .findUnique({
        where: {
            email: dto.email,
        }
       })
       //Nếu không thấy user này thì chặn
       if(!user){
        throw new ForbiddenException("Email or password invalid");
       }
       //Hash mật khẩu người nhập, đồng thời so với hash password trong db
       const passwordMatched = await argon.verify(
        user.password,
        dto.password
       )
       if(!passwordMatched){
        throw new ForbiddenException("Email or password invalid");
       }
       //Đăng nhập thành công thì cấp token
       return await this.signJwtToken(user.id, user.email, user.role)
    }
    //Phát hành token
    async signJwtToken(userid: string, email: string, role: UserRole): Promise<{ accessToken: string }> {
        //Tạo payload jwt(thông tin nhét vào token)
        const payload = {
            sub: userid,
            email,
            role
        }
        //Ký jwt (đóng dấu vào thẻ)
        const jwtString = await this.jwtService.signAsync(payload, {
            expiresIn: '10m',
            secret: process.env.JWT_SECRET
        })
        //trả token
        return {
            accessToken: jwtString,
        }
    }
}