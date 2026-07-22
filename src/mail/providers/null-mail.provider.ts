import { Injectable } from '@nestjs/common';
import { MailProvider, MailSendResult, RenderedEmail } from '../mail.types';

/**
 * Used whenever EMAIL_ENABLED=false (the default). Never sends, never
 * throws, never makes a network call — resolves immediately with a
 * structured `disabled` failure so every caller goes through the exact same
 * MailSendResult-branching code path a live provider failure would take
 * (Sprint 02B).
 */
@Injectable()
export class NullMailProvider implements MailProvider {
  // Interface-mandated signature — this implementation deliberately ignores
  // both arguments (it never sends anything).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(rendered: RenderedEmail, to: string): Promise<MailSendResult> {
    return Promise.resolve({
      success: false,
      failureCategory: 'disabled',
      durationMs: 0,
    });
  }
}
