import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { parseAllowedOrigins } from './config/cors-origins.util';
import { resolveTrustProxyValue } from './config/trust-proxy.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Backend port — validated/defaulted by env.validation.ts, read via
  // ConfigService rather than process.env directly (Sprint 01C: single
  // source of truth for configuration).
  const port = config.get<number>('PORT', 3000);

  // Only meaningful once this app sits behind a real reverse proxy/load
  // balancer — TRUST_PROXY defaults to "false" (raw socket IP, current
  // safe-by-default behavior). Never a bare `true`; see
  // config/trust-proxy.util.ts and docs/memory.md for why. All client-IP
  // derivation elsewhere in the app (rate limiting) reads `req.ip`, which
  // this setting governs — never a hand-parsed X-Forwarded-For header.
  app.set(
    'trust proxy',
    resolveTrustProxyValue(config.get<string>('TRUST_PROXY', 'false')),
  );

  // CORS_ALLOWED_ORIGINS is validated at startup (env.validation.ts) — a
  // missing/malformed/wildcard value fails application boot rather than
  // silently degrading to allow-all at request time (the C2 finding this
  // replaces). A non-allowlisted Origin is rejected by withholding CORS
  // permission (`callback(null, false)`), never by passing an Error —
  // passing an Error would surface as an artificial 500 on every
  // disallowed-origin request instead of the browser's normal CORS block.
  const allowedOrigins = parseAllowedOrigins(
    config.get<string>('CORS_ALLOWED_ORIGINS'),
  );

  app.enableCors({
    origin: (origin, callback) => {
      // No Origin header at all (same-origin requests, curl,
      // server-to-server calls, and this project's own curl-based
      // verification convention) — CORS has no meaning without one to
      // check, so these are allowed through unrestricted.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin.toLowerCase())) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: 'GET,POST,PATCH,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Required to read the httpOnly refresh-token cookie (req.cookies) on
  // POST /auth/refresh and POST /auth/logout.
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe());

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Backend running on http://localhost:${port}`);
}

bootstrap();
