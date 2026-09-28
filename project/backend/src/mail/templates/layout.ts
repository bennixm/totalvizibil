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
 *
 * The header's gradient/shadow/rounded corners are progressive enhancement,
 * not load-bearing: Outlook desktop's Word engine ignores `background-image`,
 * `box-shadow`, and `border-radius` and falls back to the plain `bgcolor`/
 * `background` colour underneath, which is deliberately set to the same
 * brand colour the gradient starts from — so the email is still fully
 * readable and on-brand there, just flatter. Every other major client
 * (Apple Mail, Gmail, Outlook.com/new Outlook, mobile) renders the full
 * design. Colours reuse the exact frontend tokens (`--tvz-gradient-brand`,
 * `--v-theme-primary`) rather than inventing a separate email palette.
 */

const BRAND = '#0f52ba';
const BRAND_DARK = '#0a3e93';
const INK = '#131722';
const MUTED = '#5b6472';
const BORDER = '#e4e7ec';
const PAPER = '#f3f5f9';
const CARD = '#ffffff';

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
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${INK};">` +
        `${escapeHtml(block).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

export function ctaButton(label: string, url: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 26px;">
      <tr>
        <td bgcolor="${BRAND}"
            style="border-radius:10px;background:${BRAND};background-image:linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%);box-shadow:0 4px 14px rgba(15,82,186,0.28);">
          <a href="${escapeHtml(url)}"
             style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;
                    color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:-0.01em;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

/** A label/value receipt table — payment confirmations, invoice summaries,
 *  appointment details. Zebra-tinted rows read as a single cohesive card
 *  rather than a bare list, and hold up in clients that drop border-radius. */
export function detailsTable(rows: { label: string; value: string }[]): string {
  const trs = rows
    .map(
      (r, i) => `
      <tr>
        <td bgcolor="${i % 2 === 0 ? PAPER : CARD}"
            style="padding:11px 16px;font-size:13px;color:${MUTED};background:${i % 2 === 0 ? PAPER : CARD};">
          ${escapeHtml(r.label)}
        </td>
        <td bgcolor="${i % 2 === 0 ? PAPER : CARD}"
            style="padding:11px 16px;font-size:13px;color:${INK};font-weight:700;text-align:right;background:${i % 2 === 0 ? PAPER : CARD};">
          ${escapeHtml(r.value)}
        </td>
      </tr>`,
    )
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:6px 0 26px;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
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
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(opts.heading)}</title>
    <style>
      @media screen and (max-width: 480px) {
        .tvz-card-pad { padding-left:20px !important; padding-right:20px !important; }
        .tvz-header-pad { padding-left:20px !important; padding-right:20px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    ${
      opts.preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(opts.preheader)}</div>`
        : ''
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:36px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="max-width:560px;background:${CARD};border-radius:16px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 2px 10px rgba(19,23,34,0.05),0 12px 32px rgba(19,23,34,0.06);">
            <tr>
              <td bgcolor="${BRAND}" class="tvz-header-pad"
                  style="background:${BRAND};background-image:linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%);padding:24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:22px;height:22px;border-radius:7px;background:rgba(255,255,255,0.22);text-align:center;vertical-align:middle;font-size:13px;line-height:22px;">
                      ✦
                    </td>
                    <td style="padding-left:10px;font-size:18px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">
                      Totalvizibil
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="tvz-card-pad" style="padding:32px 32px 8px;">
                <h1 style="margin:0 0 18px;font-size:21px;font-weight:800;letter-spacing:-0.015em;line-height:1.3;color:${INK};">
                  ${escapeHtml(opts.heading)}
                </h1>
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td class="tvz-card-pad" style="padding:18px 32px 28px;border-top:1px solid ${BORDER};">
                <p style="margin:0;font-size:12.5px;line-height:1.6;color:${MUTED};">
                  ${opts.footerNote ? escapeHtml(opts.footerNote) : 'Acest email a fost trimis automat de platforma Totalvizibil.'}
                </p>
                <p style="margin:10px 0 0;font-size:12px;color:${MUTED};opacity:0.85;">© ${year} Totalvizibil</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
