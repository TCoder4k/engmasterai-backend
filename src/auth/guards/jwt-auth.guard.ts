import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TokenBlacklistService } from '../token-blacklist.service';

/**
 * JWT Auth Guard
 * Kiểm tra JWT token và xác thực token có bị blacklist không
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private tokenBlacklistService: TokenBlacklistService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Lấy request từ context
    const request = context.switchToHttp().getRequest();
    
    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      // Kiểm tra token có bị blacklist không (synchronous với in-memory)
      if (this.tokenBlacklistService.isBlacklisted(token)) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    // Gọi AuthGuard('jwt') mặc định để xác thực token
    const result = await super.canActivate(context);
    return result as boolean;
  }
}
