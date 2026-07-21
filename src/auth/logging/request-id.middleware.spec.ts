import type { NextFunction, Request, Response } from 'express';
import { RequestIdMiddleware, RequestWithId } from './request-id.middleware';

function buildReqRes(headerValue?: string | string[]) {
  const headers: Record<string, string | string[] | undefined> = {};
  if (headerValue !== undefined) headers['x-request-id'] = headerValue;
  const req = { headers } as unknown as Request;
  const setHeader = jest.fn();
  const res = { setHeader } as unknown as Response;
  return { req, res, setHeader };
}

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  it('reuses a safe inbound X-Request-Id as-is', () => {
    const { req, res } = buildReqRes('client-supplied-id.123');
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);

    expect((req as RequestWithId).requestId).toBe('client-supplied-id.123');
    expect(next).toHaveBeenCalled();
  });

  it('generates a fresh UUID when no inbound header is present', () => {
    const { req, res } = buildReqRes(undefined);
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);

    expect((req as RequestWithId).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an inbound id containing control characters / newlines, replacing it with a fresh UUID', () => {
    const { req, res } = buildReqRes('bad\nid\x00here');
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);

    const assigned = (req as RequestWithId).requestId;
    expect(assigned).not.toContain('\n');
    expect(assigned).not.toContain('\x00');
    expect(assigned).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an over-length inbound id', () => {
    const { req, res } = buildReqRes('x'.repeat(200));
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);

    expect((req as RequestWithId).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects whitespace-containing values', () => {
    const { req, res } = buildReqRes('has space');
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);

    expect((req as RequestWithId).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets the response X-Request-Id header to the final resolved id', () => {
    const { req, res, setHeader } = buildReqRes('safe-id-1');
    const next: NextFunction = jest.fn();

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'safe-id-1');
  });
});
