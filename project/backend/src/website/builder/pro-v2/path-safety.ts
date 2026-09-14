import { BadRequestException } from '@nestjs/common';

/**
 * PRO V2 files are DB rows keyed by (projectId, path) — there is no real
 * filesystem access here, so "path traversal" can't actually escape onto the
 * host. This still matters: a project's file tree gets handed to the browser
 * to mount into a real WebContainer virtual filesystem, and the path also
 * becomes a Vite module path Claude's own generated code will `import` — a
 * malformed or hostile-looking path would corrupt that build, and an
 * `.env`-shaped filename would invite Claude (or a future feature) to put a
 * "secret" in a file that is fully client-visible inside the container.
 */
export const MAX_FILES_PER_PROJECT = 60;
export const MAX_FILE_BYTES = 80_000;
export const MAX_PATH_LENGTH = 200;

/** A built `dist/` output file is a different animal from a hand-edited
 *  source file — a bundled JS/CSS chunk or an image can legitimately be a
 *  few hundred KB. Its path still goes through the same `normalizeProjectPath`
 *  validation above (no traversal, no `.env`-shaped names). */
export const MAX_BUNDLE_FILES = 300;
export const MAX_BUNDLE_FILE_BYTES = 5_000_000;
export const MAX_BUNDLE_TOTAL_BYTES = 25_000_000;

const VALID_PATH_RE = /^[A-Za-z0-9_.\-/]+$/;
const BLOCKED_SEGMENTS = new Set(['..', '.', '.git', 'node_modules', '.env']);

/** Normalizes and validates a project-relative file path, or throws. */
export function normalizeProjectPath(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new BadRequestException('path is required');
  }
  const p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.length > MAX_PATH_LENGTH) {
    throw new BadRequestException(`Path is too long (max ${MAX_PATH_LENGTH} chars)`);
  }
  if (!VALID_PATH_RE.test(p)) {
    throw new BadRequestException(
      `Invalid path "${raw}" — only letters, digits, "._-/" are allowed`,
    );
  }
  const segments = p.split('/').filter(Boolean);
  if (!segments.length) throw new BadRequestException('path is required');
  for (const seg of segments) {
    if (BLOCKED_SEGMENTS.has(seg) || seg.startsWith('.env')) {
      throw new BadRequestException(`Path segment "${seg}" is not allowed`);
    }
  }
  return segments.join('/');
}

export function assertFileSize(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    throw new BadRequestException(`File exceeds the ${MAX_FILE_BYTES}-byte limit`);
  }
}
