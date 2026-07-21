import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleTokenVerifierService } from './google-token-verifier.service';
import { GoogleTokenInvalidError } from './google-token-invalid.error';

const verifyIdToken = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken,
  })),
}));

describe('GoogleTokenVerifierService', () => {
  let service: GoogleTokenVerifierService;
  let config: { get: jest.Mock };

  const enabledConfig = (overrides: Record<string, unknown> = {}) => ({
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        GOOGLE_AUTH_ENABLED: true,
        GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        ...overrides,
      };
      return values[key];
    }),
  });

  const payload = (overrides: Record<string, unknown> = {}) => ({
    sub: 'google-subject-123',
    email: 'User@Example.com',
    email_verified: true,
    iss: 'https://accounts.google.com',
    name: 'Test User',
    picture: 'https://example.com/pic.jpg',
    ...overrides,
  });

  beforeEach(() => {
    verifyIdToken.mockReset();
    config = enabledConfig();
    service = new GoogleTokenVerifierService(
      config as unknown as ConfigService,
    );
  });

  it('returns the verified identity for a valid credential, normalizing the email', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => payload() });

    const result = await service.verify('valid.jwt.token');

    expect(result).toEqual({
      sub: 'google-subject-123',
      email: 'user@example.com',
      name: 'Test User',
      picture: 'https://example.com/pic.jpg',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid.jwt.token',
      audience: 'test-client-id.apps.googleusercontent.com',
    });
  });

  it('throws GoogleTokenInvalidError when verifyIdToken rejects (bad signature/audience/issuer/expired)', async () => {
    verifyIdToken.mockRejectedValue(new Error('Wrong recipient'));

    await expect(service.verify('bad.jwt.token')).rejects.toBeInstanceOf(
      GoogleTokenInvalidError,
    );
  });

  it('throws GoogleTokenInvalidError when email_verified is false', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => payload({ email_verified: false }),
    });

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      GoogleTokenInvalidError,
    );
  });

  it('throws GoogleTokenInvalidError when the email claim is missing', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => payload({ email: undefined }),
    });

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      GoogleTokenInvalidError,
    );
  });

  it('throws GoogleTokenInvalidError when the sub claim is missing', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => payload({ sub: undefined }),
    });

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      GoogleTokenInvalidError,
    );
  });

  it('throws GoogleTokenInvalidError for an unexpected issuer', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => payload({ iss: 'https://evil.example.com' }),
    });

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      GoogleTokenInvalidError,
    );
  });

  it('throws GoogleTokenInvalidError when getPayload() returns undefined', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => undefined });

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      GoogleTokenInvalidError,
    );
  });

  it('throws ServiceUnavailableException without calling verifyIdToken when GOOGLE_AUTH_ENABLED is false', async () => {
    config = enabledConfig({ GOOGLE_AUTH_ENABLED: false });
    service = new GoogleTokenVerifierService(
      config as unknown as ConfigService,
    );

    await expect(service.verify('token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
