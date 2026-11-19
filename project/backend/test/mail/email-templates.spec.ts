import {
  appointmentClientEmail,
  emailChangedOldAddressEmail,
  leadReplyEmail,
  passwordResetEmail,
  verificationCodeEmail,
} from 'src/mail/templates/emails';
import { ctaButton, detailsTable, renderEmailLayout, textToHtml } from 'src/mail/templates/layout';
import { NotificationsService } from 'src/notifications/notifications.service';
import { emailPresentationFor } from 'src/notifications/email-presentation';

/** Every `[if mso]` / `[if !mso]` opener must have a closer, or Outlook
 *  swallows the rest of the email as a comment. */
function expectBalancedConditionals(html: string) {
  const opens = (html.match(/<!--\[if [^\]]+\]>/g) ?? []).length;
  const closes = (html.match(/<!\[endif\]-->/g) ?? []).length;
  expect(opens).toBe(closes);
}

describe('email layout', () => {
  it('escapes every dynamic value it renders', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderEmailLayout({
      heading: evil,
      eyebrow: evil,
      preheader: evil,
      footerNote: evil,
      bodyHtml:
        textToHtml(evil) +
        detailsTable([{ label: evil, value: evil }]) +
        ctaButton(evil, 'https://x.ro/?a=1&b="2"'),
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://x.ro/?a=1&amp;b=&quot;2&quot;"');
    expectBalancedConditionals(html);
  });

  it('renders numbered and bulleted blocks as lists, other text as paragraphs', () => {
    const html = textToHtml('Intro.\n\n1. Unu\n2. Doi\n\n- a\n- b');
    expect(html).toContain('Intro.');
    expect(html.match(/<p /g)).toHaveLength(1);
    expect(html).toContain('Unu');
    expect(html).toContain('b');
  });

  it('shows footer links only when the platform origin is given', () => {
    const withLinks = renderEmailLayout({
      heading: 'h',
      bodyHtml: '',
      appOrigin: 'https://totalvizibil.ro/',
    });
    expect(withLinks).toContain('href="https://totalvizibil.ro/support"');
    const without = renderEmailLayout({ heading: 'h', bodyHtml: '' });
    expect(without).not.toContain('/support"');
  });
});

describe('direct email templates', () => {
  it('verification code: code in subject, text and html', () => {
    const m = verificationCodeEmail({ name: 'Ana', code: '123456', ttlMinutes: 10 });
    expect(m.subject).toContain('123456');
    expect(m.text).toContain('123456');
    expect(m.html).toContain('123456');
    expect(m.text).toContain('10 minute');
  });

  it('password reset: the token URL reaches both parts intact', () => {
    const url = 'https://totalvizibil.ro/reset-password?token=abc_DEF-123';
    const m = passwordResetEmail({ url });
    expect(m.text).toContain(url);
    expect(m.html).toContain(`href="${url}"`);
    expectBalancedConditionals(m.html);
  });

  it('old-address notice names both addresses', () => {
    const m = emailChangedOldAddressEmail({
      oldEmail: 'old@x.ro',
      newEmail: 'new@x.ro',
      byAdmin: true,
      supportUrl: 'https://totalvizibil.ro/support',
    });
    for (const part of [m.text, m.html]) {
      expect(part).toContain('old@x.ro');
      expect(part).toContain('new@x.ro');
    }
    expect(m.text).toContain('administrator');
  });

  it.each(['pending', 'confirmed', 'canceled'] as const)(
    'appointment %s carries the booking details',
    (status) => {
      const m = appointmentClientEmail({
        status,
        companyName: 'Salon',
        when: '24 nov. 2026, 10:30',
        durationMinutes: 45,
      });
      expect(m.subject).toContain('Salon');
      for (const part of [m.text, m.html]) {
        expect(part).toContain('24 nov. 2026, 10:30');
        expect(part).toContain('45 min');
      }
    },
  );

  it('lead reply sends the owner message verbatim and quotes the original', () => {
    const m = leadReplyEmail({
      companyName: 'Pop',
      message: 'Venim joi.',
      originalMessage: 'Vreau ofertă',
    });
    expect(m.subject).toBe('Răspuns de la Pop');
    expect(m.text).toContain('Venim joi.');
    expect(m.text).toContain('Vreau ofertă');
    expect(m.html).toContain('Vreau ofertă');
  });
});

describe('notification emails', () => {
  function build(appOrigin?: string) {
    const sent: { subject: string; text: string; html?: string; attachments?: unknown[] }[] = [];
    const mail = { appOrigin, send: jest.fn(async (m) => (sent.push(m), { dispatched: true })) };
    const prisma = {
      notification: {
        create: jest.fn(async () => ({ id: 'n1', createdAt: new Date() })),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn(async () => ({ email: 'a@x.ro', name: 'Ana' })) },
    };
    const svc = new NotificationsService(
      prisma as never,
      mail as never,
      { pushToUser: jest.fn() } as never,
    );
    return { svc, sent, mail };
  }

  it('renders details, notice, quote and CTA in both parts; resolves app paths', async () => {
    const { svc, sent } = build('https://totalvizibil.ro');
    await svc.notify({
      userId: 'u1',
      type: 'new_session',
      title: 'Conectare nouă',
      body: 'b',
      channels: { email: true },
      email: {
        greet: true,
        text: 'Mesaj.',
        details: [{ label: 'Dispozitiv', value: 'Chrome' }],
        notice: { title: 'Nu ai fost tu?', text: 'Schimbă parola.', tone: 'danger' },
        quote: { text: 'Citat', label: 'Eticheta' },
        cta: { label: 'Vezi sesiunile', url: '/account?tab=sessions' },
        attachments: [
          { filename: 'f.pdf', content: Buffer.from('x'), contentType: 'application/pdf' },
        ],
      },
    });
    const m = sent[0];
    expect(m.subject).toBe('Conectare nouă');
    for (const part of [m.text, m.html!]) {
      expect(part).toContain('Ana');
      expect(part).toContain('Chrome');
      expect(part).toContain('Schimbă parola.');
      expect(part).toContain('Citat');
      expect(part).toContain('https://totalvizibil.ro/account?tab=sessions');
    }
    expect(m.attachments).toHaveLength(1);
    expect(m.html).toContain('Securitate cont');
    expectBalancedConditionals(m.html!);
  });

  it('leaves absolute CTA URLs untouched', async () => {
    const { svc, sent } = build('https://totalvizibil.ro');
    await svc.notify({
      userId: 'u1',
      type: 'payment_succeeded',
      title: 't',
      body: 'b',
      channels: { email: true },
      email: { cta: { label: 'Factura', url: 'https://other.ro/i/1' } },
    });
    expect(sent[0].text).toContain('https://other.ro/i/1');
  });

  it('maps notification types to a category and tone, with a safe fallback', () => {
    expect(emailPresentationFor('password_changed')).toEqual({
      eyebrow: 'Securitate cont',
      tone: 'brand',
    });
    expect(emailPresentationFor('account_suspended').tone).toBe('danger');
    expect(emailPresentationFor('campaign_depleted')).toEqual({
      eyebrow: 'Campanie',
      tone: 'warning',
    });
    expect(emailPresentationFor('payment_succeeded').tone).toBe('success');
    expect(emailPresentationFor('something_new')).toEqual({ eyebrow: 'Notificare', tone: 'brand' });
  });
});
