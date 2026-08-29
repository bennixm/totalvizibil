import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes to an argon2id string that verifies', async () => {
    const hash = await svc.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await svc.verify(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await svc.hash('s3cret-value');
    expect(await svc.verify(hash, 's3cret-Value')).toBe(false);
  });

  it('returns false (no throw) for a malformed hash', async () => {
    expect(await svc.verify('not-a-hash', 'whatever')).toBe(false);
  });
});
