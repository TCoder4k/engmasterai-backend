import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  let prisma: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };
  let service: HealthService;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    redis = { ping: jest.fn() };
    service = new HealthService(
      prisma as unknown as PrismaService,
      redis as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports ready:true, database:"up", redis:"up" when both dependencies respond', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');

    const result = await service.checkReadiness();

    expect(result).toEqual({ ready: true, database: 'up', redis: 'up' });
  });

  it('reports ready:false, database:"down" when Postgres rejects — never leaks the underlying error', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('password authentication failed for user "myuser"'),
    );
    redis.ping.mockResolvedValue('PONG');

    const result = await service.checkReadiness();

    expect(result).toEqual({ ready: false, database: 'down', redis: 'up' });
  });

  it('reports ready:false, redis:"down" when Redis rejects', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await service.checkReadiness();

    expect(result).toEqual({ ready: false, database: 'up', redis: 'down' });
  });

  it('treats a hung dependency call as "down" once the bounded timeout elapses, rather than hanging forever', async () => {
    jest.useFakeTimers();
    prisma.$queryRaw.mockReturnValue(new Promise(() => {})); // never resolves
    redis.ping.mockResolvedValue('PONG');

    const resultPromise = service.checkReadiness();
    await jest.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result).toEqual({ ready: false, database: 'down', redis: 'up' });
  });
});
