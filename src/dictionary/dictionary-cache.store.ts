import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { dictionaryCacheKey } from './dictionary-redis.constants';
import { DictionaryLookupResult } from './dictionary.types';

// Dictionary Phase A, tier 2 — Redis, not Postgres.
//
// A dictionary entry is close to immutable, so this is a plain SET-with-TTL
// read-through cache (same idiom as RefreshTokenService.issue), never a
// Prisma model: a lookup cache carries no ownership, no relations and no
// query need beyond "get by normalized word" — a migration for that would be
// pure ceremony. If Dictionary ever needs to become a real, admin-editable
// data asset, THAT is the point to reconsider Postgres, not before.
//
// >>> READ/WRITE FAILURES HERE ARE FAIL-OPEN, NOT FAIL-CLOSED <<<
// This differs from RateLimiterService/RefreshTokenService's fail-closed
// convention deliberately: those guard security/session INVARIANTS, where a
// silent bypass is the risk. This cache guards nothing but latency — a miss
// (real or from a Redis hiccup) just falls through to the external source
// (dictionary.service.ts), and a write failure after a good external answer
// must never turn an already-successful lookup into a 503 for the student.
@Injectable()
export class DictionaryCacheStore {
  private readonly logger = new Logger(DictionaryCacheStore.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async get(normalizedWord: string): Promise<DictionaryLookupResult | null> {
    try {
      const raw = await this.redis.get(dictionaryCacheKey(normalizedWord));
      if (!raw) return null;
      return JSON.parse(raw) as DictionaryLookupResult;
    } catch (error) {
      this.logger.warn(
        `Dictionary cache read failed for "${normalizedWord}", falling through to the external source`,
        error as Error,
      );
      return null;
    }
  }

  async set(normalizedWord: string, entry: DictionaryLookupResult): Promise<void> {
    const ttlSeconds = this.config.get<number>(
      'DICTIONARY_CACHE_TTL_SECONDS',
      2592000,
    );
    try {
      await this.redis.set(
        dictionaryCacheKey(normalizedWord),
        JSON.stringify(entry),
        'EX',
        ttlSeconds,
      );
    } catch (error) {
      // Best-effort — the caller already has a correct answer to return.
      this.logger.warn(
        `Dictionary cache write failed for "${normalizedWord}"`,
        error as Error,
      );
    }
  }
}
