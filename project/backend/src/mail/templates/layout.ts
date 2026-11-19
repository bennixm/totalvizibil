/**
 * The email design system: one branded HTML shell plus a small set of
 * content blocks (paragraphs, steps, button, code, details, notice, quote)
 * that every outgoing email is composed from. Nothing here is per-email, so
 * the visual identity stays unitary across the whole platform by
 * construction instead of by convention.
 *
 * Compatibility rules this file follows on purpose:
 *  - Table-based layout with inline styles. That is the only markup every
 *    client renders consistently, including Outlook desktop's Word engine.
 *    The `<style>` block in the head is progressive enhancement only
 *    (mobile tweaks + dark mode); every email reads correctly without it.
 *  - Outlook desktop gets a fixed 600px "ghost" table and VML buttons
 *    (inside `[if mso]` comments), and a forced Segoe UI/Arial font stack,
 *    because it falls back to Times New Roman when the first font in a
 *    stack is a web font it doesn't have.
 *  - No image logo. The app's brand mark is an icon-font glyph, unavailable
 *    outside the app shell, and remote images are blocked by default in
 *    many clients. The mark is built from a coloured table cell instead,
 *    so the header is visible in every client before images load.
 *  - Colours reuse the frontend tokens (`--tvz-brand-1/2`, see
 *    frontend/src/styles/tokens.scss) rather than a separate email palette.
 *  - Every dynamic value goes through `escapeHtml` exactly once, inside the
 *    block that renders it. Callers pass plain text, never HTML.
 */

const BRAND = '#0f52ba';
const BRAND_DARK = '#0a3e93';
const INK = '#101828';
const TEXT = '#3d4451';
const MUTED = '#6b7280';
const BORDER = '#e6e8ee';
const PAPER = '#f4f5f8';
const SOFT = '#f7f8fb';
const CARD = '#ffffff';

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

/** Signs off every platform email (HTML and plain text alike). */
export const EMAIL_SIGNOFF = 'Echipa Totalvizibil';

/** Assembles the plain-text MIME part: the content blocks, then the same
 *  sign-off and footer note the HTML layout shows, so the two parts never
 *  drift. Empty/falsy parts are dropped. */
export function plainTextEmail(
  parts: (string | null | undefined | false)[],
  footerNote?: string,
  signoff: string | null = EMAIL_SIGNOFF,
): string {
  return [...parts, signoff, footerNote ? `---\n${footerNote}` : null]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join('\n\n');
}

export type EmailTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

/** fg = text/accent, bg = tinted surface, line = border. The `dark` pair is
 *  only used by clients that honour `prefers-color-scheme` (Apple Mail,
 *  Outlook for Mac, iOS Mail). */
const TONES: Record<
  EmailTone,
  { fg: string; bg: string; line: string; darkFg: string; darkBg: string }
> = {
  brand: { fg: BRAND, bg: '#eaf1fc', line: '#c9dbf6', darkFg: '#8fb4f5', darkBg: '#16233b' },
  success: { fg: '#0e7a4b', bg: '#e9f6ef', line: '#c2e6d1', darkFg: '#6fd3a0', darkBg: '#12291f' },
  warning: { fg: '#93590a', bg: '#fdf5e6', line: '#f2ddb3', darkFg: '#f1c06e', darkBg: '#2e2412' },
  danger: { fg: '#b42318', bg: '#fdeeec', line: '#f5cbc6', darkFg: '#f59a90', darkBg: '#33181a' },
  neutral: { fg: '#475467', bg: '#f2f4f7', line: BORDER, darkFg: '#b4bccb', darkBg: '#20242d' },
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const P_STYLE = `margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.65;color:${TEXT};`;

/** A block where every line is "1. …" renders as numbered steps, one where
 *  every line is "- …" as a bullet list. Anything else is a paragraph. */
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const BULLET = /^\s*[-•]\s+(.*)$/;

function listHtml(items: { marker: string; text: string }[], numbered: boolean): string {
  const rows = items
    .map(
      (it) => `
      <tr>
        <td valign="top" width="30" style="width:30px;padding:0 0 10px;">
          ${
            numbered
              ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                   <td class="tvz-tone-brand" align="center" bgcolor="${TONES.brand.bg}"
                       style="width:22px;height:22px;border-radius:11px;background:${TONES.brand.bg};font-family:${FONT};font-size:12px;font-weight:700;line-height:22px;color:${BRAND};">
                     <span class="tvz-tone-brand-fg" style="color:${BRAND};">${escapeHtml(it.marker)}</span>
                   </td></tr></table>`
              : `<div style="margin:10px 0 0 7px;width:6px;height:6px;border-radius:3px;background:${BRAND};font-size:0;line-height:0;">&nbsp;</div>`
          }
        </td>
        <td valign="top" class="tvz-text" style="padding:1px 0 10px;font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT};">
          ${escapeHtml(it.text)}
        </td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">${rows}</table>`;
}

/** Plain text (never raw HTML: it is escaped here) → styled paragraphs,
 *  preserving blank-line breaks and single line breaks inside a block. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length > 1 && lines.every((l) => NUMBERED.test(l))) {
        return listHtml(
          lines.map((l) => {
            const m = NUMBERED.exec(l)!;
            return { marker: m[1], text: m[2] };
          }),
          true,
        );
      }
      if (lines.length > 1 && lines.every((l) => BULLET.test(l))) {
        return listHtml(
          lines.map((l) => ({ marker: '', text: BULLET.exec(l)![1] })),
          false,
        );
      }
      return `<p class="tvz-text" style="${P_STYLE}">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

/**
 * The primary call-to-action. A VML round-rect for Outlook desktop (which
 * ignores padding on links and border-radius everywhere), a padded link
 * for everyone else. With `showUrl`, the raw link is printed underneath for
 * clients or corporate filters that break buttons: worth it for flows the
 * recipient can't complete any other way (password reset).
 */
export function ctaButton(label: string, url: string, opts: { showUrl?: boolean } = {}): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  // Outlook's VML button needs an explicit width; roughly 8.6px per
  // character at 15px semibold plus horizontal padding, never narrower than
  // a comfortable tap target.
  const vmlWidth = Math.max(200, Math.min(520, Math.round(label.length * 8.6 + 56)));
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="tvz-btn" style="margin:8px 0 ${opts.showUrl ? '14px' : '28px'};">
      <tr>
        <td align="center" bgcolor="${BRAND}" style="border-radius:10px;background:${BRAND};">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${safeUrl}" style="height:48px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="21%" stroke="f" fillcolor="${BRAND}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:bold;">${safeLabel}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${safeUrl}" target="_blank" rel="noopener"
             style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;background:${BRAND};background-image:linear-gradient(180deg, ${BRAND} 0%, ${BRAND_DARK} 100%);">
            ${safeLabel}
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>${
      opts.showUrl
        ? `
    <p class="tvz-muted" style="margin:0 0 28px;font-family:${FONT};font-size:13px;line-height:1.55;color:${MUTED};">
      Butonul nu funcționează? Copiază linkul în browser:<br>
      <a href="${safeUrl}" target="_blank" rel="noopener" style="color:${BRAND};text-decoration:underline;word-break:break-all;">${safeUrl}</a>
    </p>`
        : ''
    }`;
}

/** A prominent one-time code: verification, 2FA, etc. Deliberately not
 *  inline text, since the code is usually the one thing the recipient came
 *  for. `caption` sits under it (e.g. how long it stays valid). */
export function codeBlock(code: string, caption?: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 28px;">
      <tr>
        <td class="tvz-soft tvz-line" align="center" bgcolor="${SOFT}"
            style="background:${SOFT};border:1px solid ${BORDER};border-radius:12px;padding:22px 16px;">
          <div class="tvz-ink tvz-code" style="font-family:${MONO};font-size:34px;font-weight:700;letter-spacing:10px;line-height:1.2;color:${INK};padding-left:10px;">
            ${escapeHtml(code)}
          </div>
          ${
            caption
              ? `<div class="tvz-muted" style="margin-top:8px;font-family:${FONT};font-size:13px;color:${MUTED};">${escapeHtml(caption)}</div>`
              : ''
          }
        </td>
      </tr>
    </table>`;
}

/** Label/value summary card: receipts, invoice summaries, appointment and
 *  contact details. Rows stack (label above value) on narrow screens so a
 *  long value such as an email address or a device string never squeezes
 *  its label into a one-word column. */
export function detailsTable(rows: { label: string; value: string }[]): string {
  const trs = rows
    .map((r, i) => {
      const divider = i === 0 ? '' : `border-top:1px solid ${BORDER};`;
      return `
      <tr>
        <td class="tvz-dl-label tvz-muted tvz-line" valign="top"
            style="${divider}padding:12px 18px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};white-space:nowrap;">
          ${escapeHtml(r.label)}
        </td>
        <td class="tvz-dl-value tvz-ink tvz-line" valign="top" align="right"
            style="${divider}padding:12px 18px;font-family:${FONT};font-size:14px;line-height:1.5;font-weight:600;color:${INK};text-align:right;word-break:break-word;">
          ${escapeHtml(r.value)}
        </td>
      </tr>`;
    })
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="tvz-dl tvz-soft tvz-line" bgcolor="${SOFT}"
           style="margin:4px 0 28px;background:${SOFT};border:1px solid ${BORDER};border-radius:12px;border-collapse:separate;">
      ${trs}
    </table>`;
}

/** A tinted callout for the one sentence that must not be skimmed past:
 *  "wasn't you? do this", "your money is safe", an irreversible deadline. */
export function noticeBox(text: string, tone: EmailTone = 'neutral', title?: string): string {
  const t = TONES[tone];
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">
      <tr>
        <td class="tvz-tone-${tone}" bgcolor="${t.bg}"
            style="background:${t.bg};border-left:3px solid ${t.fg};border-radius:8px;padding:14px 18px;">
          ${
            title
              ? `<div class="tvz-tone-${tone}-fg" style="margin:0 0 4px;font-family:${FONT};font-size:14px;font-weight:700;line-height:1.5;color:${t.fg};">${escapeHtml(title)}</div>`
              : ''
          }
          <div class="tvz-text" style="font-family:${FONT};font-size:14px;line-height:1.6;color:${TEXT};">
            ${escapeHtml(text).replace(/\n/g, '<br>')}
          </div>
        </td>
      </tr>
    </table>`;
}

/** Quoted user-written text: a lead's message, a support agent's reply. */
export function quoteBlock(text: string, label?: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 28px;">
      <tr>
        <td class="tvz-soft" bgcolor="${SOFT}"
            style="background:${SOFT};border-left:3px solid #c5cbd6;border-radius:8px;padding:14px 18px;">
          ${
            label
              ? `<div class="tvz-muted" style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${MUTED};">${escapeHtml(label)}</div>`
              : ''
          }
          <div class="tvz-ink" style="font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">
            ${escapeHtml(text).replace(/\n/g, '<br>')}
          </div>
        </td>
      </tr>
    </table>`;
}

export interface EmailLayoutOptions {
  /** Inbox preview line, not rendered in the body. Should add something the
   *  subject doesn't already say. */
  preheader?: string;
  heading: string;
  /** Small category label above the heading ("Securitate", "Plăți"…). */
  eyebrow?: string;
  /** Colours the eyebrow; also the semantic weight of the whole email. */
  tone?: EmailTone;
  /** Pre-built inner HTML, composed from the blocks above. */
  bodyHtml: string;
  /** Why this was sent / what to do if it was unexpected. Shown in the footer. */
  footerNote?: string;
  /** Platform origin. When set, the footer links to the panel, support and
   *  account settings; leave it out for emails to people without an account
   *  (booking visitors, lead replies). */
  appOrigin?: string;
  /** Sign-off under the body. Defaults to EMAIL_SIGNOFF; `null` hides it
   *  (e.g. a business replying to its own customer signs the body itself). */
  signoff?: string | null;
}

function darkModeCss(): string {
  const tones = (Object.keys(TONES) as EmailTone[])
    .map(
      (k) =>
        `.tvz-tone-${k}{background:${TONES[k].darkBg} !important;}` +
        `.tvz-tone-${k}-fg{color:${TONES[k].darkFg} !important;}`,
    )
    .join('');
  return `
      @media (prefers-color-scheme: dark) {
        .tvz-bg { background:#0e1014 !important; }
        .tvz-card { background:#171a21 !important; border-left-color:#2a2f3a !important; border-right-color:#2a2f3a !important; border-bottom-color:#2a2f3a !important; }
        .tvz-soft { background:#1d212a !important; }
        .tvz-line { border-color:#2a2f3a !important; }
        .tvz-ink { color:#eef1f6 !important; }
        .tvz-text { color:#c6ccd6 !important; }
        .tvz-muted { color:#8c95a5 !important; }
        .tvz-link { color:#8fb4f5 !important; }
        ${tones}
      }`;
}

export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const year = new Date().getFullYear();
  const tone = TONES[opts.tone ?? 'brand'];
  const toneKey = opts.tone ?? 'brand';
  const signoff = opts.signoff === undefined ? EMAIL_SIGNOFF : opts.signoff;
  const origin = opts.appOrigin?.replace(/\/+$/, '');
  const footerNote =
    opts.footerNote ?? 'Acest email a fost trimis automat de platforma Totalvizibil.';

  // Zero-width padding after the preheader keeps clients from pulling the
  // first lines of the body into the inbox preview after it.
  const preheaderPad = '&#8199;&#65279;&#847; '.repeat(60);

  const footerLink = (label: string, path: string) =>
    `<a class="tvz-muted" href="${escapeHtml(`${origin}${path}`)}" target="_blank" rel="noopener" style="color:${MUTED};text-decoration:underline;">${label}</a>`;

  return `<!doctype html>
<html lang="ro" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeHtml(opts.heading)}</title>
    <!--[if mso]>
    <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
    <style>body, table, td, div, p, a, h1, span { font-family: 'Segoe UI', Arial, sans-serif !important; }</style>
    <![endif]-->
    <!--[if !mso]><!-->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <!--<![endif]-->
    <style>
      body { margin:0 !important; padding:0 !important; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
      table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
      a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
      @media screen and (max-width: 600px) {
        .tvz-shell { padding:24px 10px 32px !important; }
        .tvz-pad { padding-left:22px !important; padding-right:22px !important; }
        .tvz-h1 { font-size:22px !important; }
        .tvz-code { font-size:28px !important; letter-spacing:7px !important; }
        .tvz-btn { width:100% !important; }
        .tvz-btn a { display:block !important; text-align:center !important; }
        .tvz-dl-label, .tvz-dl-value { display:block !important; width:auto !important; text-align:left !important; white-space:normal !important; }
        .tvz-dl-label { padding-bottom:0 !important; }
        .tvz-dl-value { padding-top:2px !important; border-top:0 !important; }
      }${darkModeCss()}
    </style>
  </head>
  <body class="tvz-bg" style="margin:0;padding:0;background:${PAPER};">
    ${
      opts.preheader
        ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(opts.preheader)}${preheaderPad}</div>`
        : ''
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="tvz-bg" bgcolor="${PAPER}" style="background:${PAPER};">
      <tr>
        <td align="center" class="tvz-shell" style="padding:40px 16px 48px;">
          <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">

            <!-- Brand -->
            <tr>
              <td style="padding:0 4px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="30" height="30" align="center" valign="middle" bgcolor="${BRAND}"
                        style="width:30px;height:30px;border-radius:8px;background:${BRAND};background-image:linear-gradient(180deg, ${BRAND} 0%, ${BRAND_DARK} 100%);">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
                        <td width="8" height="8" style="width:8px;height:8px;border:2px solid #ffffff;border-radius:6px;font-size:0;line-height:0;">&nbsp;</td>
                      </tr></table>
                    </td>
                    <td class="tvz-ink" style="padding-left:10px;font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:-0.02em;color:${INK};">
                      Totalvizibil
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td class="tvz-card" bgcolor="${CARD}"
                  style="background:${CARD};border:1px solid ${BORDER};border-top:3px solid ${tone.fg};border-radius:14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="tvz-pad" style="padding:36px 40px 12px;">
                      ${
                        opts.eyebrow
                          ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr>
                               <td class="tvz-tone-${toneKey}" bgcolor="${tone.bg}" style="background:${tone.bg};border-radius:6px;padding:4px 10px;">
                                 <span class="tvz-tone-${toneKey}-fg" style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tone.fg};">${escapeHtml(opts.eyebrow)}</span>
                               </td></tr></table>`
                          : ''
                      }
                      <h1 class="tvz-ink tvz-h1" style="margin:0 0 18px;font-family:${FONT};font-size:24px;font-weight:700;letter-spacing:-0.02em;line-height:1.3;color:${INK};">
                        ${escapeHtml(opts.heading)}
                      </h1>
                      ${opts.bodyHtml}
                    </td>
                  </tr>
                  ${
                    signoff
                      ? `<tr>
                    <td class="tvz-pad" style="padding:0 40px 34px;">
                      <p class="tvz-text" style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT};">
                        <strong class="tvz-ink" style="color:${INK};font-weight:600;">${escapeHtml(signoff)}</strong>
                      </p>
                    </td>
                  </tr>`
                      : `<tr><td style="padding:0 0 22px;font-size:0;line-height:0;">&nbsp;</td></tr>`
                  }
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding:26px 24px 0;">
                <p class="tvz-muted" style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
                  ${escapeHtml(footerNote)}
                </p>
                ${
                  origin
                    ? `<p class="tvz-muted" style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
                  ${footerLink('Panoul tău', '/dashboard')}&nbsp;&nbsp;·&nbsp;&nbsp;${footerLink('Suport', '/support')}&nbsp;&nbsp;·&nbsp;&nbsp;${footerLink('Setări cont', '/account')}
                </p>`
                    : ''
                }
                <p class="tvz-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:#98a2b3;">
                  © ${year} Totalvizibil
                </p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
