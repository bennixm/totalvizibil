import { authenticator } from 'otplib';
import { TotpService } from 'src/auth/totp.service';

describe('TotpService', () => {
  const svc = new TotpService();

  describe('generateSecret', () => {
    it('returns non-empty base32 string', () => {
      const secret = svc.generateSecret();
      expect(secret).toBeTruthy();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(10);
    });

    it('returns unique secrets on each call', () => {
      expect(svc.generateSecret()).not.toBe(svc.generateSecret());
    });
  });

  describe('otpauthUrl', () => {
    it('contains issuer Totalvizibil and account name', () => {
      const secret = svc.generateSecret();
      const url = svc.otpauthUrl(secret, 'user@example.com');
      expect(url).toContain('Totalvizibil');
      expect(url).toContain('user%40example.com');
      expect(url).toMatch(/^otpauth:\/\/totp\//);
    });
  });

  describe('verify', () => {
    it('returns true for a valid token', () => {
      const secret = svc.generateSecret();
      const token = authenticator.generate(secret);
      expect(svc.verify(token, secret)).toBe(true);
    });

    it('returns false for a wrong token', () => {
      const secret = svc.generateSecret();
      expect(svc.verify('000000', secret)).toBe(false);
    });

    it('returns false for a malformed token without throwing', () => {
      const secret = svc.generateSecret();
      expect(svc.verify('!!!!', secret)).toBe(false);
    });

    it('strips whitespace before verifying', () => {
      const secret = svc.generateSecret();
      const token = authenticator.generate(secret);
      expect(svc.verify(` ${token} `, secret)).toBe(true);
    });
  });
});
