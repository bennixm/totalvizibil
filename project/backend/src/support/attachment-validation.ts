import { BadRequestException } from '@nestjs/common';

/** Authoritative cap on the decoded file — the DTO's base64-string length
 *  check is just a loose upper bound to reject absurd payloads early. */
export const MAX_ATTACHMENT_BYTES = 6_000_000;

const DATA_URI_RE = /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * The claimed MIME in a `data:<mime>;base64,...` prefix is just text the
 * client typed — never trusted on its own anywhere else in this codebase
 * either, but here the file leaves the platform again (support staff
 * download it), so it's worth actually opening it: every accepted type is
 * confirmed by its real magic bytes, and anything that doesn't match one of
 * these signatures is rejected outright rather than stored with a
 * client-asserted label.
 */
function sniff(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('latin1'))) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Strip any path components and anything that isn't a plain filename
 *  character — this is stored and later echoed straight into a
 *  `Content-Disposition` header, so it must never carry a `/`, `\`, quotes
 *  or control characters. Falls back to a generic name with the real
 *  (sniffed) extension when nothing usable survives. */
function sanitizeFilename(raw: string, fallbackExt: string): string {
  const base = raw
    .replace(/[/\\]/g, '')
    .replace(/[^\w.\- ]+/g, '_')
    .trim()
    .slice(0, 120);
  if (!base) return `attachment.${fallbackExt}`;
  return /\.[a-zA-Z0-9]{1,8}$/.test(base) ? base : `${base}.${fallbackExt}`;
}

export function decodeAttachment(
  dataUri: string,
  declaredFilename: string,
): { mime: string; bytes: Buffer; filename: string } {
  const m = DATA_URI_RE.exec(dataUri.trim());
  if (!m) throw new BadRequestException('bad_attachment');
  const bytes = Buffer.from(m[1].replace(/\s/g, ''), 'base64');
  if (bytes.length === 0) throw new BadRequestException('bad_attachment');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new BadRequestException('attachment_too_large');

  const real = sniff(bytes);
  if (!real) throw new BadRequestException('unsupported_attachment_type');

  return { mime: real.mime, bytes, filename: sanitizeFilename(declaredFilename, real.ext) };
}
