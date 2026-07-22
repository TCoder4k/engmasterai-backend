import { NullMailProvider } from './null-mail.provider';

describe('NullMailProvider', () => {
  it('resolves to a structured "disabled" failure, never sends, never throws', async () => {
    const provider = new NullMailProvider();
    const result = await provider.send(
      { subject: 's', html: 'h', text: 't' },
      'user@example.com',
    );

    expect(result).toEqual({
      success: false,
      failureCategory: 'disabled',
      durationMs: 0,
    });
  });
});
