import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategy';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtAuthGuard, RolesGuard } from './guards';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { RateLimiterService } from './rate-limit/rate-limiter.service';
import { AuthEventLogger } from './logging/auth-event-logger.service';
import { RequestIdMiddleware } from './logging/request-id.middleware';

// Note: this module deliberately does NOT import/register the Redis
// connection itself — SharedRedisModule (src/shared/redis/redis.module.ts)
// is @Global() and imported exactly once by AppModule; every provider here
// that injects @InjectRedis() shares that one connection.
//
// @Global() is required, not just convenient: `JwtAuthGuard` now has a
// constructor dependency on `TokenBlacklistService` (Sprint 01A's Redis
// blacklist check), and every other module references `JwtAuthGuard` by
// class in `@UseGuards(JwtAuthGuard)` without importing AuthModule. Without
// @Global(), Nest can auto-instantiate the guard for those routes but can't
// resolve its constructor dependency from a module that never imported
// AuthModule — it silently injects `undefined` instead of failing at
// bootstrap, which then throws at request time the first time a blacklist
// check runs outside AuthModule. Found via the Sprint 01A e2e suite (every
// guard-consolidation/Redis-outage test outside `/auth/*` failed with a
// `Cannot read properties of undefined (reading 'isBlacklisted')` 500
// before this fix). Marking AuthModule global makes its exported providers
// (`JwtAuthGuard`, `RolesGuard`, `TokenBlacklistService`) resolvable from
// every module's DI scope, matching the exact pattern SharedRedisModule
// already uses for the same class of cross-cutting-infrastructure problem.
@Global()
@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    TokenBlacklistService,
    RefreshTokenService,
    JwtAuthGuard,
    RolesGuard,
    RateLimiterService,
    AuthRateLimitGuard,
    AuthEventLogger,
  ],
  exports: [JwtAuthGuard, RolesGuard, TokenBlacklistService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation-ID assignment (Sprint 01C) — scoped to this module's own
    // routes, not applied app-wide (out of scope: a full observability
    // platform).
    consumer.apply(RequestIdMiddleware).forRoutes(AuthController);
  }
}
