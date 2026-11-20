import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for customers' Google OAuth refresh tokens at rest. The key
 * comes from `GOOGLE_ADS_TOKEN_KEY` (32 bytes, base64 or 64 hex chars) and
 * never from the database, so a database dump alone cannot be used to reach
 * anyone's Google Ads account. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */

export class TokenCrypto {
  private readonly key: Buffer | null;

  constructor(rawKey: string | undefined) {
    this.key = TokenCrypto.parseKey(rawKey ?? '');
  }

  static parseKey(raw: string): Buffer | null {
    const v = raw.trim();
    if (!v) return null;
    const buf = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
    return buf.length === 32 ? buf : null;
  }

  get configured(): boolean {
    return !!this.key;
  }

  encrypt(plain: string): string {
    if (!this.key) throw new Error('GOOGLE_ADS_TOKEN_KEY is not configured');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, enc]
      .map((x) => (typeof x === 'string' ? x : x.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string): string {
    if (!this.key) throw new Error('GOOGLE_ADS_TOKEN_KEY is not configured');
    const [v, iv, tag, enc] = payload.split('.');
    if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unknown token format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(enc, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** sha256 hex, for draft tokens and OAuth state (only hashes are stored). */
export function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
