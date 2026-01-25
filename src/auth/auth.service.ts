import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDTO, RegisterDTO } from "./dto";
import * as argon from 'argon2';
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import { TokenBlacklistService } from './token-blacklist.service';

@Injectable()
export class AuthService {
  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService,
    private tokenBlacklistService: TokenBlacklistService
    ) {
    
  }

    async register(dto: RegisterDTO ){
        try {
            // Hash password securely
            const hashedPassword = await argon.hash(dto.password);
            
            // Create user with USER role (registration is for learners only)
            const user = await this.prismaService.user.create({
                data: {
                    name: dto.name,
                    email: dto.email,
                    password: hashedPassword,
                    role: UserRole.USER, // USER role = learner
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    createdAt: true
                }
            });
            
            // Generate access token
            const { accessToken } = await this.signJwtToken(user.id, user.email, user.role);
            
            return {
                message: 'Registration successful',
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                },
                accessToken
            };

        } catch (error) {
            if(error.code === 'P2002'){
                throw new ForbiddenException('Email already exists');
            }
            throw new ForbiddenException('Registration failed');
        }
    }
   async login(dto: LoginDTO){
       // Find user by email
       const user = await this.prismaService.user.findUnique({
           where: {
               email: dto.email,
           },
           select: {
               id: true,
               name: true,
               email: true,
               password: true,
               role: true,
           }
       });
       
       // Check if user exists
       if(!user){
           throw new ForbiddenException('Invalid credentials');
       }
       
       // Verify role matches
       if(user.role !== dto.role){
           throw new ForbiddenException('Invalid credentials or unauthorized role');
       }
       
       // Verify password
       const passwordMatched = await argon.verify(
           user.password,
           dto.password
       );
       
       if(!passwordMatched){
           throw new ForbiddenException('Invalid credentials');
       }
       
       // Generate access token
       const { accessToken } = await this.signJwtToken(user.id, user.email, user.role);
       
       return {
           message: 'Login successful',
           user: {
               id: user.id,
               name: user.name,
               email: user.email,
               role: user.role,
           },
           accessToken
       };
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

    /**
     * Logout - vô hiệu hóa token hiện tại
     * @param token - JWT token cần vô hiệu hóa
     */
    async logout(token: string): Promise<{ message: string }> {
        try {
            // Decode token để lấy thông tin expiration
            const decoded = this.jwtService.decode(token) as any;
            
            if (!decoded || !decoded.exp) {
                throw new ForbiddenException('Invalid token');
            }

            // Thêm token vào blacklist (in-memory)
            this.tokenBlacklistService.addToBlacklist(token, decoded.exp);

            return {
                message: 'Logout successful'
            };
        } catch (error) {
            throw new ForbiddenException('Logout failed');
        }
    }
}