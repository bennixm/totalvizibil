import { BadRequestException } from '@nestjs/common';
import { decodeAttachment, MAX_ATTACHMENT_BYTES } from '../../support/attachment-validation';

const DATA_URI_RE = /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/;

/** XML e-invoices (UBL / CII, e.g. RO e-Factura) start with an XML prolog or
 *  a root element, optionally after a UTF-8 BOM. */
function looksLikeXml(bytes: Buffer): boolean {
  let s = bytes.subarray(0, 200).toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.trimStart();
  return s.startsWith('<?xml') || /^<[A-Za-z][\w:.-]*[\s>]/.test(s);
}

function xmlName(raw: string): string {
  const base = raw
    .replace(/[/\\]/g, '')
    .replace(/[^\w.\- ]+/g, '_')
    .trim()
    .slice(0, 120);
  if (!base) return 'invoice.xml';
  return /\.xml$/i.test(base) ? base : `${base.replace(/\.[a-zA-Z0-9]{1,8}$/, '')}.xml`;
}

/**
 * A supplier document: PDF / PNG / JPEG / GIF / WEBP (magic-byte checked by
 * the shared support validator) or an XML e-invoice. Anything else is
 * rejected; the client-claimed MIME is never trusted.
 */
export function decodeInvoiceFile(
  dataUri: string,
  filename: string,
): { mime: string; bytes: Buffer; filename: string } {
  try {
    return decodeAttachment(dataUri, filename);
  } catch (e) {
    if (!(e instanceof BadRequestException) || e.message !== 'unsupported_attachment_type') throw e;
    const m = DATA_URI_RE.exec(dataUri.trim());
    if (!m) throw e;
    const bytes = Buffer.from(m[1].replace(/\s/g, ''), 'base64');
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new BadRequestException('attachment_too_large');
    if (!looksLikeXml(bytes)) throw e;
    return { mime: 'application/xml', bytes, filename: xmlName(filename) };
  }
}
