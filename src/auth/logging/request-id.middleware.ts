import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const MAX_REQUEST_ID_LENGTH = 64;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface RequestWithId extends Request {
  requestId: string;
}

function isSafeRequestId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID_PATTERN.test(value)
  );
}

/**
 * Attaches a request-scoped correlation ID (Sprint 01C, §8). An inbound
 * `X-Request-Id` is reused only if it passes `isSafeRequestId` — bounded
 * length, no control characters, no newlines, no whitespace, nothing
 * outside a safe character allowlist. An unsafe or missing inbound value is
 * replaced with a freshly generated UUID and is never logged anywhere:
 * an attacker-controlled header flowing verbatim into structured logs is a
 * log-injection vector, so validation runs before the ID reaches
 * `AuthEventLogger` or anywhere else.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers['x-request-id'];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId =
      candidate && isSafeRequestId(candidate) ? candidate : randomUUID();

    (req as RequestWithId).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
