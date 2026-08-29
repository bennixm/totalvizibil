import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

const ISSUER = 'Totalvizibil';

/** Thin wrapper around otplib for RFC 6238 TOTP (Google Authenticator, etc.). */
@Injectable()
export class TotpService {
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  otpauthUrl(secret: string, accountName: string): string {
    return authenticator.keyuri(accountName, ISSUER, secret);
  }

  verify(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token: token.replace(/\s+/g, ''), secret });
    } catch {
      return false;
    }
  }
}
