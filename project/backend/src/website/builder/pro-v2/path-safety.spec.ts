import { BadRequestException } from '@nestjs/common';
import { normalizeProjectPath, assertFileSize } from './path-safety';

describe('normalizeProjectPath', () => {
  it('accepts a normal relative path and strips a leading slash', () => {
    expect(normalizeProjectPath('src/components/Hero.vue')).toBe('src/components/Hero.vue');
    expect(normalizeProjectPath('/src/App.vue')).toBe('src/App.vue');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeProjectPath('src\\App.vue')).toBe('src/App.vue');
  });

  it('rejects path traversal', () => {
    expect(() => normalizeProjectPath('../secrets.txt')).toThrow(BadRequestException);
    expect(() => normalizeProjectPath('src/../../etc/passwd')).toThrow(BadRequestException);
  });

  it('rejects env files', () => {
    expect(() => normalizeProjectPath('.env')).toThrow(BadRequestException);
    expect(() => normalizeProjectPath('server/.env.production')).toThrow(BadRequestException);
  });

  it('rejects node_modules / .git segments', () => {
    expect(() => normalizeProjectPath('node_modules/x/index.js')).toThrow(BadRequestException);
    expect(() => normalizeProjectPath('.git/config')).toThrow(BadRequestException);
  });

  it('rejects an absolute Windows path (colon is not a valid path char)', () => {
    expect(() => normalizeProjectPath('C:\\Users\\me\\secrets.txt')).toThrow(BadRequestException);
  });

  it('rejects empty / whitespace-only paths', () => {
    expect(() => normalizeProjectPath('')).toThrow(BadRequestException);
    expect(() => normalizeProjectPath('   ')).toThrow(BadRequestException);
  });
});

describe('assertFileSize', () => {
  it('accepts a small file and rejects an oversized one', () => {
    expect(() => assertFileSize('small')).not.toThrow();
    expect(() => assertFileSize('x'.repeat(90_000))).toThrow(BadRequestException);
  });
});
