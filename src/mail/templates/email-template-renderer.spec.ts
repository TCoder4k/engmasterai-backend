import { EmailTemplateRenderer, escapeHtml } from './email-template-renderer';

describe('EmailTemplateRenderer', () => {
  let renderer: EmailTemplateRenderer;

  beforeEach(() => {
    renderer = new EmailTemplateRenderer();
  });

  it('returns subject, html, and text for the email-verification template', () => {
    const result = renderer.render('email-verification', {
      name: 'Jane',
      verifyUrl: 'https://app.example.com/verify-email?token=abc123',
      expiresInMinutes: 30,
    });

    expect(result.subject).toEqual(expect.any(String));
    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.html).toContain(
      'https://app.example.com/verify-email?token=abc123',
    );
    expect(result.text).toContain(
      'https://app.example.com/verify-email?token=abc123',
    );
    expect(result.html).toContain('Jane');
    expect(result.text).toContain('Jane');
    expect(result.text).toContain('30');
  });

  it('HTML-escapes a user-controlled value (name) in the html output', () => {
    const result = renderer.render('email-verification', {
      name: '<script>alert(1)</script>',
      verifyUrl: 'https://app.example.com/verify-email?token=abc123',
      expiresInMinutes: 30,
    });

    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  it('the plain-text output contains no raw HTML tags', () => {
    const result = renderer.render('email-verification', {
      name: 'Jane',
      verifyUrl: 'https://app.example.com/verify-email?token=abc123',
      expiresInMinutes: 30,
    });

    expect(result.text).not.toMatch(/<[a-z][\s\S]*>/i);
  });

  it('is pure — calling it twice with the same input produces the same output', () => {
    const variables = {
      name: 'Jane',
      verifyUrl: 'https://app.example.com/verify-email?token=abc123',
      expiresInMinutes: 30,
    };
    const first = renderer.render('email-verification', variables);
    const second = renderer.render('email-verification', variables);
    expect(first).toEqual(second);
  });
});

describe('EmailTemplateRenderer — Sprint 02C password-reset templates', () => {
  let renderer: EmailTemplateRenderer;

  beforeEach(() => {
    renderer = new EmailTemplateRenderer();
  });

  it('renders the password-reset template with the reset URL and expiry', () => {
    const result = renderer.render('password-reset', {
      name: 'Jane',
      resetUrl: 'https://app.example.com/reset-password?token=abc123',
      expiresInMinutes: 30,
    });

    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.html).toContain(
      'https://app.example.com/reset-password?token=abc123',
    );
    expect(result.text).toContain(
      'https://app.example.com/reset-password?token=abc123',
    );
    expect(result.html).toContain('Jane');
    expect(result.text).toContain('30');
  });

  it('HTML-escapes the name in the password-reset template', () => {
    const result = renderer.render('password-reset', {
      name: '<script>alert(1)</script>',
      resetUrl: 'https://app.example.com/reset-password?token=abc123',
      expiresInMinutes: 30,
    });
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  it('renders the google-only-password-reset-notice template with no link/token of any kind', () => {
    const result = renderer.render('google-only-password-reset-notice', {
      name: 'Jane',
    });

    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.html).toContain('Jane');
    expect(result.html).not.toMatch(/https?:\/\//);
    expect(result.text).not.toMatch(/https?:\/\//);
  });

  it('renders the password-reset-success template with no reset/undo link', () => {
    const result = renderer.render('password-reset-success', {
      name: 'Jane',
    });

    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.html).toContain('Jane');
    expect(result.html).not.toMatch(/https?:\/\//);
    expect(result.text).not.toMatch(/https?:\/\//);
  });

  it('unknown template ids throw rather than silently rendering nothing', () => {
    expect(() =>
      renderer.render(
        'not-a-real-template' as unknown as 'email-verification',
        { name: 'Jane', verifyUrl: 'x', expiresInMinutes: 1 },
      ),
    ).toThrow('Unknown email template');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('leaves ordinary text unchanged', () => {
    expect(escapeHtml('Jane Doe')).toBe('Jane Doe');
  });
});
