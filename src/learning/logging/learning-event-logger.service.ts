import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Sprint 04 (Learning Engine) event taxonomy. A separate class/union from
// AuthEventLogger's — that one is auth-scoped by construction (see its own
// header comment); this mirrors its shape (JSON-line over Nest's Logger,
// explicit field allowlist, try/catch-wrapped) rather than extending it.
export type LearningEventName =
  | 'learning.review.submitted'
  | 'learning.review.idempotent_replay'
  | 'learning.review.idempotency_conflict'
  | 'learning.review.version_conflict'
  | 'learning.queue.loaded'
  | 'learning.progress.created'
  | 'learning.progress.mastered'
  | 'learning.progress.lapsed';

// The full allowlist across every event — not every event uses every
// field. Never widened with an index signature (see AuthEventLogger's
// identical discipline): any new field must be added here deliberately.
export interface LearningEventFields {
  requestId?: string;
  userId?: string;
  wordId?: string;
  rating?: string;
  practiceMode?: string;
  previousState?: string;
  newState?: string;
  intervalDays?: number;
  resultVersion?: number;
  algorithmVersion?: number;
  responseTimeMs?: number;
  totalReturned?: number;
}

/**
 * Thin wrapper around Nest's built-in `Logger` producing single-line JSON
 * payloads from an explicit field allowlist — never typed answers, raw
 * tokens, or a full request body. Every call wrapped in try/catch so a
 * serialization/logging failure can never propagate into (or delay) the
 * review it's logging. Structurally identical to
 * `src/auth/logging/auth-event-logger.service.ts`, deliberately not reused
 * directly since that class's event union is auth-specific.
 */
@Injectable()
export class LearningEventLogger {
  private readonly logger = new Logger('LearningEvent');

  constructor(private readonly config: ConfigService) {}

  log(event: LearningEventName, fields: LearningEventFields = {}): void {
    try {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        environment: this.config.get<string>('NODE_ENV'),
        ...fields,
      };
      this.logger.log(JSON.stringify(payload));
    } catch {
      this.logger.warn('structured learning logging failed');
    }
  }
}
