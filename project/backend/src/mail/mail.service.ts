import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfig } from '../config/env';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Rendered HTML alternative — see mail/templates/layout.ts. `text` is
   *  always sent alongside it (nodemailer multipart/alternative) so plain-text
   *  clients and spam filters still see real content, not an empty fallback. */
  html?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

/**
 * Outgoing email. With `SMTP_USER`/`SMTP_PASS` set (a Gmail account + App
 * Password works for testing), this sends for real over Gmail's SMTP. Empty
 * ⇒ same dev fallback as before: the message is logged in full so the flow
 * is visible end-to-end, and nothing is ever faked as sent.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly isProd: boolean;
  private readonly from: string;
  private readonly transporter: Transporter | null;

  constructor(config: ConfigService<AppConfig, true>) {
    this.isProd = config.get('nodeEnv', { infer: true }) === 'production';
    this.from = config.get('smtpFrom', { infer: true });
    const user = config.get('smtpUser', { infer: true });
    const pass = config.get('smtpPass', { infer: true });
    const port = config.get('smtpPort', { infer: true });
    this.transporter =
      user && pass
        ? createTransport({
            host: config.get('smtpHost', { infer: true }),
            port,
            // 465 is implicit TLS from the first byte (`secure: true`); every
            // other port (587 standard submission, 25) starts plaintext and
            // upgrades via STARTTLS (`secure: false`) — nodemailer doesn't
            // infer this from the port itself.
            secure: port === 465,
            auth: { user, pass },
          })
        : null;
    if (!this.transporter) {
      this.logger.log('SMTP_USER/SMTP_PASS not set — outgoing mail is dev-logged only');
    }
  }

  get configured(): boolean {
    return this.transporter != null;
  }

  async send(msg: MailMessage): Promise<{ dispatched: boolean }> {
    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          replyTo: msg.replyTo,
          attachments: msg.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        });
        return { dispatched: true };
      } catch (err) {
        this.logger.error(
          `Failed to send email to ${msg.to} ("${msg.subject}")`,
          err instanceof Error ? err.stack : err,
        );
        return { dispatched: false };
      }
    }

    if (this.isProd) {
      this.logger.warn(`Email to ${msg.to} not sent — no transport configured ("${msg.subject}")`);
      return { dispatched: false };
    }
    const meta =
      (msg.html ? ' [+html]' : '') +
      (msg.attachments?.length ? ` [+${msg.attachments.length} attachment(s)]` : '');
    this.logger.log(
      `[DEV MAIL] to=${msg.to}${msg.replyTo ? ` reply-to=${msg.replyTo}` : ''}${meta}\n` +
        `  subject: ${msg.subject}\n` +
        msg.text
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
    );
    return { dispatched: false };
  }
}
