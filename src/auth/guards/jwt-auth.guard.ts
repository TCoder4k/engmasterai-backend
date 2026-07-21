import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { TokenBlacklistService } from '../token-blacklist.service';

/**
 * JWT Auth Guard — the single source of truth (Sprint 01A consolidation).
 * Checks the Redis-backed access-token blacklist before delegating to
 * Passport. Every protected route in the app uses this guard; the old
 * non-blacklist-aware `auth/guard/jwt-auth.guard.ts` has been removed.
 *
 * A Redis outage during the blacklist check is not swallowed and does not
 * fail open — `TokenBlacklistService.isBlacklisted` throws
 * `ServiceUnavailableException` (503) in that case, which propagates
 * through this guard exactly like any other thrown exception.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private tokenBlacklistService: TokenBlacklistService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const authHeader = request.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      if (await this.tokenBlacklistService.isBlacklisted(token)) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    // Delegate to the default AuthGuard('jwt') for signature/expiry verification.
    const result = await super.canActivate(context);
    return result as boolean;
  }
}
