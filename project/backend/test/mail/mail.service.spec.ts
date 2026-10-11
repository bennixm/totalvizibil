jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

import * as nodemailer from 'nodemailer';
import { MailService } from 'src/mail/mail.service';

function fakeConfig(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    nodeEnv: 'development',
    smtpUser: '',
    smtpPass: '',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpFrom: 'no-reply@example.com',
  };
  return { get: jest.fn((k: string) => ({ ...defaults, ...overrides }[k])) };
}

const fakeTransporter = () => ({
  sendMail: jest.fn(),
  verify: jest.fn().mockResolvedValue(true),
});

describe('MailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('configured', () => {
    it('is false when smtpUser is empty', () => {
      const svc = new MailService(fakeConfig() as any);
      expect(svc.configured).toBe(false);
    });

    it('is true when smtpUser and smtpPass are set', () => {
      const transport = fakeTransporter();
      (nodemailer.createTransport as jest.Mock).mockReturnValue(transport);
      const svc = new MailService(fakeConfig({ smtpUser: 'user', smtpPass: 'pass' }) as any);
      expect(svc.configured).toBe(true);
    });
  });

  describe('send', () => {
    const msg = { to: 'a@b.com', subject: 'Hi', text: 'Hello' };

    it('returns dispatched: false and does not throw when not configured (dev)', async () => {
      const svc = new MailService(fakeConfig({ nodeEnv: 'development' }) as any);
      const result = await svc.send(msg);
      expect(result).toEqual({ dispatched: false });
    });

    it('returns dispatched: false when not configured in production', async () => {
      const svc = new MailService(fakeConfig({ nodeEnv: 'production' }) as any);
      const result = await svc.send(msg);
      expect(result).toEqual({ dispatched: false });
    });

    it('returns dispatched: true when transporter resolves', async () => {
      const transport = fakeTransporter();
      transport.sendMail.mockResolvedValue({});
      (nodemailer.createTransport as jest.Mock).mockReturnValue(transport);
      const svc = new MailService(fakeConfig({ smtpUser: 'u', smtpPass: 'p' }) as any);
      const result = await svc.send(msg);
      expect(result).toEqual({ dispatched: true });
    });

    it('returns dispatched: false and does not throw when transporter rejects', async () => {
      const transport = fakeTransporter();
      transport.sendMail.mockRejectedValue(new Error('SMTP error'));
      (nodemailer.createTransport as jest.Mock).mockReturnValue(transport);
      const svc = new MailService(fakeConfig({ smtpUser: 'u', smtpPass: 'p' }) as any);
      const result = await svc.send(msg);
      expect(result).toEqual({ dispatched: false });
    });
  });
});
