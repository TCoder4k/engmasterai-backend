// Import Injectable để NestJS biết đây là một provider (service/strategy)
// Import UnauthorizedException để ném lỗi khi token không hợp lệ
import { Injectable, UnauthorizedException } from '@nestjs/common';

// ConfigService dùng để đọc biến môi trường từ .env (JWT_SECRET)
import { ConfigService } from '@nestjs/config';

// PassportStrategy là class base để tạo strategy cho passport
import { PassportStrategy } from '@nestjs/passport';

// Strategy là strategy JWT của passport-jwt
// ExtractJwt dùng để lấy token từ request
import { ExtractJwt, Strategy } from 'passport-jwt';

import { UserRole } from '@prisma/client';

/**
 * Interface mô tả payload bên trong JWT
 * Đây chính là dữ liệu bạn đã "ký" khi sign token
 */
export interface JwtPayload {
  sub: string;        // userId (theo chuẩn JWT, sub = subject)
  email: string;      // email user
  role: UserRole;     // user role (USER or ADMIN)
  iat?: number;       // issued at - thời điểm token được tạo (tự sinh)
  exp?: number;       // expiration - thời điểm token hết hạn (tự sinh)
}

@Injectable() // Đánh dấu class này là injectable để NestJS quản lý
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {

  /**
   * Constructor chạy khi NestJS khởi tạo JwtStrategy
   * super(...) dùng để cấu hình cho passport-jwt
   */
  constructor(private readonly configService: ConfigService) {
    super({
      /**
       * jwtFromRequest:
       * Xác định JWT sẽ được lấy từ đâu trong request
       * => Authorization: Bearer <token>
       */
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      /**
       * ignoreExpiration: false
       * => Nếu token hết hạn (exp < now) thì passport tự reject
       */
      ignoreExpiration: false,

      /**
       * secretOrKey:
       * Secret dùng để VERIFY chữ ký của JWT
       * PHẢI giống secret đã dùng khi sign token
       */
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * validate() sẽ được gọi TỰ ĐỘNG khi:
   * - Token hợp lệ
   * - Chữ ký đúng
   * - Token chưa hết hạn
   *
   * payload chính là phần data đã sign trong JWT
   */
  async validate(payload: JwtPayload): Promise<{ userId: string; email: string; role: UserRole }> {

    // Nếu payload không có sub => token sai cấu trúc
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    /**
     * Giá trị return ở đây sẽ được gắn vào:
     * request.user
     *
     * Ví dụ:
     * req.user = { userId, email, role }
     */
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}
