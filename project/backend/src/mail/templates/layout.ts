/**
 * One shared branded HTML shell for every outgoing email — table-based,
 * inline-styled (the only markup email clients render consistently,
 * including Outlook's Word engine). Every notification type supplies its own
 * heading/body/CTA/details through NotificationsService; nothing here is
 * per-type, so the visual identity stays unitary across the whole platform
 * by construction instead of by convention.
 *
 * No image logo: the app's own brand mark is a Material Design Icon glyph,
 * unavailable outside the app shell, and email clients render inline SVG/
 * embedded images too inconsistently (Outlook desktop drops SVG outright) to
 * rely on for the one thing every recipient must see. A plain bold wordmark
 * in the brand color is what most transactional-email systems fall back to
 * for exactly this reason, and it matches this codebase's own "no decorative
 * elements without purpose" design principle.
 */

const BRAND = '#0f52ba';
const INK = '#131722';
const MUTED = '#5b6472';
const BORDER = '#e4e7ec';
const PAPER = '#f7f8fa';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text (already escaped by the caller's data, never raw HTML) → one
 *  or more styled paragraphs, preserving blank-line breaks. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">` +
        `${escapeHtml(block).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

export function ctaButton(label: string, url: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
      <tr>
        <td style="border-radius:8px;background:${BRAND};">
          <a href="${escapeHtml(url)}"
             style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;
                    color:#ffffff;text-decoration:none;border-radius:8px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

/** A label/value receipt table — payment confirmations, invoice summaries. */
export function detailsTable(rows: { label: string; value: string }[]): string {
  const trs = rows
    .map(
      (r, i) => `
      <tr>
        <td style="padding:10px 0;font-size:13px;color:${MUTED};border-top:${i === 0 ? 'none' : `1px solid ${BORDER}`};">
          ${escapeHtml(r.label)}
        </td>
        <td style="padding:10px 0;font-size:13px;color:${INK};font-weight:600;text-align:right;border-top:${i === 0 ? 'none' : `1px solid ${BORDER}`};">
          ${escapeHtml(r.value)}
        </td>
      </tr>`,
    )
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:4px 0 24px;background:${PAPER};border-radius:10px;padding:4px 16px;">
      ${trs}
    </table>`;
}

export interface EmailLayoutOptions {
  /** Shown by the client's inbox preview line — not rendered in the body. */
  preheader?: string;
  heading: string;
  /** Pre-built inner HTML — compose with textToHtml/detailsTable/ctaButton. */
  bodyHtml: string;
  /** Small line under the footer, e.g. why this was sent / who to contact. */
  footerNote?: string;
}

export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="ro">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(opts.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    ${
      opts.preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>`
        : ''
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
            <tr>
              <td style="background:${BRAND};padding:20px 28px;">
                <span style="font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#ffffff;">Totalvizibil</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px;">
                <h1 style="margin:0 0 16px;font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${INK};">
                  ${escapeHtml(opts.heading)}
                </h1>
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px;border-top:1px solid ${BORDER};">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
                  ${opts.footerNote ? escapeHtml(opts.footerNote) : 'Acest email a fost trimis automat de platforma Totalvizibil.'}
                </p>
                <p style="margin:8px 0 0;font-size:12px;color:${MUTED};">© ${year} Totalvizibil</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
