import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Argon2id password hashing (PRD §20).
 *
 * Cost is set to the OWASP minimum for argon2id (m=19 MiB, t=2, p=1) rather than
 * the library's heavier default (m=64 MiB, t=3, p=4). It keeps a comfortable
 * security margin while shaving ~2-3x off every login. `argon2.verify` reads the
 * cost from the stored hash, so existing hashes keep verifying unchanged.
 */
const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, HASH_OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** True when the stored hash was made with heavier/older parameters. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, HASH_OPTIONS);
    } catch {
      return false;
    }
  }
}
