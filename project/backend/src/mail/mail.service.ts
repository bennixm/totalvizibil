import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

/**
 * Outgoing email. No provider is wired yet (PRD §17): in development the message
 * is logged in full so the flow is visible end-to-end; in production it is
 * recorded as "pending dispatch" until an SMTP transport is added here. Nothing
 * is ever faked as sent.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly isProd: boolean;

  constructor(config: ConfigService<AppConfig, true>) {
    this.isProd = config.get('nodeEnv', { infer: true }) === 'production';
  }

  async send(msg: MailMessage): Promise<{ dispatched: boolean }> {
    if (this.isProd) {
      this.logger.warn(
        `Email to ${msg.to} not sent — no transport configured ("${msg.subject}")`,
      );
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
