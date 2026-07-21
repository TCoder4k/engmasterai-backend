import { createHash } from 'crypto';

// Hex-encoded SHA-256. Used everywhere a secret (access token, refresh secret)
// must be stored/compared without ever persisting the raw value in Redis.
export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
