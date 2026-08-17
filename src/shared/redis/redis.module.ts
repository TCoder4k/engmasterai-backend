import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  InjectRedis,
  RedisModule as IoRedisModule,
} from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';

// The single Redis connection for the whole app. Registered exactly once,
// imported only by AppModule (see docs/memory.md's auth architecture notes).
// AuthModule and any future consumer inject the connection via @InjectRedis()
// without re-registering it — @nestjs-modules/ioredis's underlying
// RedisCoreModule is already @Global() internally, so a second import
// anywhere else would not create a second client, but we still only import
// this module from AppModule to keep ownership unambiguous.
@Global()
@Module({
  imports: [
    IoRedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'single' as const,
        url:
          config.get<string>('REDIS_URL') ??
          `redis://${config.get<string>('REDIS_HOST', 'localhost')}:${config.get<string>('REDIS_PORT', '6379')}`,
        // Bounded, fast-failing retry behavior — a guard sits behind every
        // protected request, so an unreachable Redis must surface as a 503
        // within a predictable, short window (decision #8: fail closed, but
        // not "hang indefinitely," which would be its own availability bug).
        options: {
          connectTimeout: 5000,
          maxRetriesPerRequest: 3,
          retryStrategy: (times: number) => Math.min(times * 200, 1000),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [IoRedisModule],
})
export class SharedRedisModule implements OnModuleDestroy {
  // @nestjs-modules/ioredis has no lifecycle hook of its own (its
  // RedisCoreModule never closes the client it creates) — without this, the
  // raw socket and the retryStrategy's pending reconnect timer both outlive
  // app.close(), which is what actually keeps the process alive after tests
  // finish. Deliberately `disconnect()`, not `quit()`: `quit` is sent as a
  // normal Redis command, so against an unreachable Redis (see
  // auth.e2e-spec.ts's "Redis outage" suite, which points this client at a
  // closed port) it would sit in the offline queue waiting for a connection
  // that will never come. `disconnect()` clears the reconnect timer and
  // closes the socket synchronously regardless of connection state.
  constructor(@InjectRedis() private readonly redis: Redis) {}

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
