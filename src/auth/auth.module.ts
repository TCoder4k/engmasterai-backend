import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PrismaModule } from "../prisma/prisma.module";
import { JwtModule } from "@nestjs/jwt";
import { JwtStrategy } from "./strategy";
import { TokenBlacklistService } from './token-blacklist.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

//We need access PrismaClient here!
@Module({
    imports: [
        PrismaModule,
        JwtModule.register({}),
    ],
    controllers: [
        AuthController
    ],
    providers: [
        AuthService,
        JwtStrategy,
        TokenBlacklistService,
        JwtAuthGuard
    ],
    exports: [
        JwtAuthGuard,
        TokenBlacklistService
    ]
})
export class AuthModule {}