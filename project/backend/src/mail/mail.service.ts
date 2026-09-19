import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfig } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
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
    this.transporter =
      user && pass
        ? createTransport({
            host: config.get('smtpHost', { infer: true }),
            port: config.get('smtpPort', { infer: true }),
            secure: false, // STARTTLS on 587, the standard Gmail submission port
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
          replyTo: msg.replyTo,
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
    this.logger.log(
      `[DEV MAIL] to=${msg.to}${msg.replyTo ? ` reply-to=${msg.replyTo}` : ''}\n` +
        `  subject: ${msg.subject}\n` +
        msg.text
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
    );
    return { dispatched: false };
  }
}
