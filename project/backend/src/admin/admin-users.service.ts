import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BillingProfile, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { WalletService } from '../wallet/wallet.service';
import { BillingService } from '../billing/billing.service';
import { BillingProfileDto } from '../billing/dto/billing-profile.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditActor, AuditLogService } from './audit-log.service';
import { MailService } from '../mail/mail.service';
import { ctaButton, detailsTable, renderEmailLayout, textToHtml } from '../mail/templates/layout';
import { AppConfig } from '../config/env';
import { money } from '../wallet/money';
import { effectiveActiveSeconds } from '../analytics/visibility';
import { SUPPORT_STAFF_ROLES } from '../support/support.constants';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { BlockWalletDto } from './dto/block-wallet.dto';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);
  private readonly frontendOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly wallet: WalletService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly audit: AuditLogService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.frontendOrigin = config.get('frontendOrigin', { infer: true });
  }

  async list(query: ListUsersQuery) {
    const { search, status, role, staffOnly, page = 1, pageSize = 20 } = query;

    const where: Prisma.UserWhereInput = {
      ...(status ? { status } : {}),
      ...(role ? { platformRoles: { some: { role } } } : {}),
      ...(staffOnly && !role ? { platformRoles: { some: {} } } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          platformRoles: true,
          wallet: { select: { balanceMinor: true, blockedAt: true } },
          _count: { select: { companyMembers: true, sessions: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        platformRoles: u.platformRoles.map((r) => r.role),
        twoFactorEnabled: !!u.totpEnabledAt,
        companyCount: u._count.companyMembers,
        walletCredits: u.wallet ? money(u.wallet.balanceMinor).credits : 0,
        walletBlocked: !!u.wallet?.blockedAt,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
      page,
      pageSize,
      total,
    };
  }

  async detail(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        platformRoles: true,
        wallet: true,
        // The billing identity every one of this user's invoices is made out
        // to. It used to be omitted here, which meant NOBODY on staff —
        // admin included — could see or correct a wrong CUI/address while
        // looking at the exact invoices it had been snapshotted onto.
        billingProfile: true,
        companyMembers: {
          where: { status: 'active' },
          include: {
            company: {
              select: {
                id: true,
                displayName: true,
                slug: true,
                status: true,
                ownerUserId: true,
                createdAt: true,
                campaign: true,
                _count: { select: { leads: true, adClicks: true } },
              },
            },
          },
        },
      },
    });
    if (!u) throw new NotFoundException('User not found');

    const now = new Date();
    const companyIds = u.companyMembers.map((m) => m.company.id);

    const [sessions, walletSummary, transactionsPage, invoices, consumedBy] = await Promise.all([
      this.sessions.listActiveForUser(id),
      this.wallet.getSummary(id),
      // Reuses the same row shape (+ refund eligibility/state) the
      // customer's own transactions page gets — one source of truth
      // instead of a second hand-rolled mapping here.
      this.wallet.listTransactions(id, { limit: 20 }),
      this.billing.listForUser(id),
      // Same CPC-only ad-spend helper the Businesses list and company-detail
      // page use — the inline groupBy this used to do omitted the provider
      // filter, so it double-counted one-off fees (builder unlock, AI
      // usage) as ad spend and showed a different number for the same
      // company than every other admin page.
      this.wallet.consumedByCompanies(companyIds),
    ]);

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      platformRoles: u.platformRoles.map((r) => r.role),
      twoFactorEnabled: !!u.totpEnabledAt,
      lastLoginAt: u.lastLoginAt,
      passwordChangedAt: u.passwordChangedAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      wallet: {
        balance: walletSummary.balance,
        purchased: walletSummary.purchased,
        spent: walletSummary.spent,
        currency: walletSummary.currency,
        eurRonRate: walletSummary.eurRonRate,
        blocked: walletSummary.blocked,
        blockedAt: walletSummary.blockedAt,
        blockedReason: walletSummary.blockedReason,
        refundable: walletSummary.refundable,
      },
      // Null until the user has declared one — a brand-new account has no
      // billing identity yet, and the panel has to be able to show that
      // state (it's exactly why their purchases are being blocked).
      billingProfile: u.billingProfile ? billingProfileSnapshot(u.billingProfile) : null,
      companies: u.companyMembers.map((m) => {
        const c = m.company;
        const camp = c.campaign;
        const activeSeconds = camp
          ? effectiveActiveSeconds(
              camp.activeSecondsAccrued,
              camp.activatedAt,
              camp.status === 'active',
              now,
              camp.pausedAt,
            )
          : 0;
        return {
          id: c.id,
          displayName: c.displayName,
          slug: c.slug,
          status: c.status,
          role: m.role,
          isOwner: c.ownerUserId === id,
          leadCount: c._count.leads,
          clickCount: c._count.adClicks,
          consumed: money(consumedBy.get(c.id) ?? 0),
          createdAt: c.createdAt,
          campaign: camp
            ? {
                status: camp.status,
                dailyBudget: money(camp.dailyBudgetMinor),
                cpc: money(camp.cpcMinor),
                appearFirst: camp.appearFirst,
                spentToday: money(camp.spentTodayMinor),
                activeDays: Math.floor(activeSeconds / 86_400),
              }
            : null,
        };
      }),
      transactions: transactionsPage.items,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        totalMinor: inv.totalMinor,
        currency: inv.currency,
        voided: !!inv.voidedAt,
        issuedAt: inv.issuedAt,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
      })),
    };
  }

  async update(callerId: string, callerSessionId: string, id: string, dto: UpdateUserDto) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      include: { platformRoles: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const isSelf = callerId === id;
    if (isSelf) {
      if (dto.status === 'suspended') {
        throw new ForbiddenException('You cannot suspend your own account');
      }
      if (dto.platformRoles && !dto.platformRoles.includes('admin')) {
        throw new ForbiddenException('You cannot remove your own admin role');
      }
    }

    // Same "don't lock the platform out of itself" guard as the self-admin
    // check above, for `finance`: the Contabil role is the only way into the
    // finance module and the money-management endpoints, and nothing else
    // can grant it back except an admin noticing. Dropping the last holder
    // (from anyone, not just yourself — the admin check above only covers
    // the caller's own row) is refused rather than silently emptying the role.
    if (dto.platformRoles && !dto.platformRoles.includes('finance')) {
      const hadFinance = target.platformRoles.some((r) => r.role === 'finance');
      if (hadFinance) {
        const remaining = await this.prisma.platformRoleAssignment.count({
          where: { role: 'finance', userId: { not: id } },
        });
        if (remaining === 0) {
          throw new ForbiddenException('cannot_remove_last_finance_role');
        }
      }
    }

    const emailChanged = !!dto.email && dto.email !== target.email;
    if (emailChanged) {
      const taken = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (taken) throw new BadRequestException('That email is already in use');
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    ops.push(
      this.prisma.user.update({
        where: { id },
        data: {
          name: dto.name,
          email: dto.email,
          status: dto.status,
          ...(dto.disableTotp ? { totpSecret: null, totpEnabledAt: null } : {}),
          // The new address hasn't been proven to belong to this user (no
          // code was sent/confirmed the way self-service signup requires),
          // so an admin-initiated email change forces re-verification —
          // otherwise the account would sit "verified" on an address nobody
          // ever confirmed.
          ...(emailChanged ? { emailVerifiedAt: null } : {}),
        },
      }),
    );

    if (dto.platformRoles) {
      const current = new Set(target.platformRoles.map((r) => r.role));
      const desired = new Set(dto.platformRoles);
      const toAdd = [...desired].filter((r) => !current.has(r));
      const toRemove = [...current].filter((r) => !desired.has(r));
      if (toRemove.length) {
        ops.push(
          this.prisma.platformRoleAssignment.deleteMany({
            where: { userId: id, role: { in: toRemove } },
          }),
        );
      }
      for (const role of toAdd) {
        ops.push(this.prisma.platformRoleAssignment.create({ data: { userId: id, role } }));
      }
    }

    await this.prisma.$transaction(ops);

    // A user who no longer works the support queue must not keep holding
    // tickets: assigned tickets stopped showing as "unassigned" in the queue
    // while their assignee could no longer open them, so they were invisible
    // to everyone. Only fires when NO support-staff role is left (dropping
    // `admin` from someone who still has `support` changes nothing).
    if (dto.platformRoles) {
      const had = target.platformRoles.some((r) => SUPPORT_STAFF_ROLES.includes(r.role));
      const has = dto.platformRoles.some((r) => SUPPORT_STAFF_ROLES.includes(r));
      if (had && !has) {
        await this.prisma.supportTicket.updateMany({
          where: { assigneeId: id },
          data: { assigneeId: null },
        });
      }
    }

    // Mirrors the self-service email-change flow (account.service.ts): both
    // addresses get told, so if this was unexpected, the rightful owner's
    // OLD inbox still hears about it — an admin changing an email silently
    // left the real owner with no signal at all.
    if (emailChanged) {
      const oldEmail = target.email;
      const newEmail = dto.email as string;
      const supportCta = { label: 'Contactează suportul', url: `${this.frontendOrigin}/support` };
      const oldEmailMessage = `Adresa de email a contului tău Totalvizibil a fost schimbată de un administrator.`;
      const oldEmailDetails = [
        { label: 'Adresa veche', value: oldEmail },
        { label: 'Adresa nouă', value: newEmail },
      ];
      const oldEmailFooter = 'Mesaj de securitate trimis automat la adresa veche a contului.';
      void this.mail
        .send({
          to: oldEmail,
          subject: 'Adresa de email a contului tău a fost schimbată',
          text: [
            oldEmailMessage,
            oldEmailDetails.map((d) => `${d.label}: ${d.value}`).join('\n'),
            'Dacă nu te aștepți la asta, deschide imediat un tichet de suport — contul poate fi compromis.',
            `${supportCta.label}: ${supportCta.url}`,
            oldEmailFooter,
          ].join('\n\n'),
          html: renderEmailLayout({
            heading: 'Adresa de email a contului a fost schimbată',
            preheader: `Noua adresă este ${newEmail}.`,
            bodyHtml:
              textToHtml(
                `${oldEmailMessage} Dacă nu te aștepți la asta, deschide imediat un tichet de suport — contul poate fi compromis.`,
              ) +
              detailsTable(oldEmailDetails) +
              ctaButton(supportCta.label, supportCta.url),
            footerNote: oldEmailFooter,
          }),
        })
        .catch((err) =>
          this.logger.error(
            'Admin email-change (old address) notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
      void this.notifications
        .notify({
          userId: id,
          type: 'email_changed',
          title: 'Confirmă noua adresă de email a contului',
          body: `Un administrator a schimbat adresa de email a contului în ${newEmail}.`,
          channels: { email: true },
          email: {
            greet: true,
            text: `Un administrator Totalvizibil a schimbat adresa de email a contului tău în ${newEmail}.\n\nCe trebuie să faci: confirmă noua adresă la următoarea conectare — îți trimitem un cod de verificare pe ${newEmail}. Până atunci, unele funcții ale contului rămân limitate.\n\nDacă nu te aștepți la această schimbare, scrie-ne înainte să confirmi.`,
            cta: supportCta,
          },
        })
        .catch((err) =>
          this.logger.error(
            'Admin email-change notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    }

    // Removing a security control an admin didn't set up must still reach
    // the account it belongs to — the user's OWN `totpDisable` self-service
    // path already notifies `totp_disabled`; this admin-initiated path used
    // to be silent. Gated on the user actually having had 2FA enabled
    // beforehand, so a no-op `disableTotp: true` on an already-disabled
    // account doesn't send a confusing alert.
    if (dto.disableTotp && target.totpEnabledAt) {
      void this.notifications
        .notify({
          userId: id,
          type: 'totp_disabled',
          title: 'Autentificarea în doi pași a fost dezactivată',
          body: 'Un administrator a dezactivat autentificarea în doi pași pe contul tău.',
          channels: { email: true },
          email: {
            greet: true,
            text: 'Un administrator Totalvizibil a dezactivat autentificarea în doi pași pe contul tău. De acum, pentru conectare este suficientă parola.\n\nDacă nu te aștepți la această schimbare, contactează suportul și reactivează autentificarea în doi pași.',
            cta: {
              label: 'Reactivează autentificarea în doi pași',
              url: `${this.frontendOrigin}/account?tab=security`,
            },
          },
        })
        .catch((err) =>
          this.logger.error(
            'Admin 2FA-disable notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    }

    // Banning a user pulls their businesses out of the feed too.
    if (dto.status === 'suspended') {
      await this.suspendOwnedListings(id);
    }

    if (dto.revokeSessions || dto.status === 'suspended') {
      // `revokeAllForUser`'s second arg is a SESSION id to keep alive, not a
      // user id — passing `callerId` here never matched anything (no
      // Session.id equals a User.id), so an admin revoking their own
      // sessions was silently logging themselves out of the very request
      // doing the revoking too.
      await this.sessions.revokeAllForUser(id, isSelf ? callerSessionId : undefined);
    }

    if (dto.status && dto.status !== target.status) {
      const suspended = dto.status === 'suspended';
      void this.notifications
        .notify({
          userId: id,
          type: suspended ? 'account_suspended' : 'account_reactivated',
          title: suspended ? 'Contul tău a fost suspendat' : 'Contul tău a fost reactivat',
          body: suspended
            ? 'Contul tău a fost suspendat de un administrator. Afacerile tale au fost oprite din feed.'
            : 'Contul tău a fost reactivat — te poți conecta din nou normal.',
          channels: { email: true },
        })
        .catch((err) =>
          this.logger.error(
            'Account status-change notification failed',
            err instanceof Error ? err.stack : err,
          ),
        );
    }

    return this.detail(id);
  }

  /** Pause every campaign and unpublish every website owned by a banned user. */
  private async suspendOwnedListings(ownerUserId: string) {
    const companies = await this.prisma.company.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    if (!companies.length) return;
    const ids = companies.map((c) => c.id);
    await this.prisma.$transaction([
      this.prisma.campaign.updateMany({
        where: { companyId: { in: ids }, status: 'active' },
        data: { status: 'paused', pausedAt: new Date(), autoOptimize: false },
      }),
      this.prisma.company.updateMany({
        where: { id: { in: ids }, status: 'active' },
        data: { status: 'draft', featured: false },
      }),
      this.prisma.website.updateMany({
        where: { companyId: { in: ids } },
        data: { status: 'unpublished' },
      }),
    ]);
  }

  async setPassword(id: string, newPassword: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        passwordChangedAt: new Date(),
      },
    });
    await this.sessions.revokeAllForUser(id);

    void this.notifications
      .notify({
        userId: id,
        type: 'password_changed',
        title: 'Parola contului tău a fost resetată',
        body: 'Un administrator a resetat parola contului tău. Setează-ți una nouă ca să te poți conecta.',
        channels: { email: true },
        email: {
          greet: true,
          text: 'Un administrator Totalvizibil a resetat parola contului tău, iar sesiunile deschise au fost închise.\n\nCe trebuie să faci: setează-ți o parolă nouă folosind „Am uitat parola” de pe pagina de conectare. Noi nu trimitem niciodată parole prin email.\n\nDacă nu te aștepți la această resetare, contactează-ne înainte să te reconectezi.',
          cta: { label: 'Setează o parolă nouă', url: `${this.frontendOrigin}/forgot-password` },
        },
      })
      .catch((err) =>
        this.logger.error(
          'Admin-set-password notification failed',
          err instanceof Error ? err.stack : err,
        ),
      );

    return { ok: true as const };
  }

  /** Paginated/filterable transaction history for the Activity tab — the
   *  same `listTransactions` the owner's own transactions page uses, just
   *  scoped to whichever user the admin is looking at instead of the caller.
   *  The user-detail payload above only ever embeds the most recent 20 (no
   *  filters); this is what "search by id" / "load more" call into. */
  async listTransactions(
    id: string,
    opts: { limit?: number; cursor?: string; type?: string; search?: string },
  ) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    return this.wallet.listTransactions(id, opts);
  }

  /** Same transaction history as a downloadable PDF — the admin equivalent
   *  of the owner's own Transactions page export. */
  async exportTransactions(
    id: string,
    opts: { type?: string; category?: string; from?: string; to?: string; search?: string },
  ): Promise<Buffer> {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { name: true } });
    if (!target) throw new NotFoundException('User not found');
    return this.wallet.exportTransactionsPdf(id, target.name, opts);
  }

  async blockWallet(id: string, dto: BlockWalletDto, actor: AuditActor) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    await this.wallet.setBlocked(id, dto.blocked, dto.reason ?? null, actor);
    return this.detail(id);
  }

  /** `actor` is the staff member performing the adjustment: their id is
   *  recorded on the `adjustment` ledger row for attribution, and their id +
   *  role snapshot on the audit log. `WalletService.adjust` also uses the id
   *  to refuse an adjustment of the actor's OWN wallet. */
  async adjustWallet(id: string, dto: AdjustWalletDto, actor: AuditActor) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    const result = await this.wallet.adjust(id, dto.credits, dto.reason, {
      initiatedByAdminId: actor.id,
      actorRoles: actor.roles,
    });
    const detail = await this.detail(id);
    // Surfaced so the admin panel can tell "applied in full" from "balance
    // was too low, only part of a claw-back actually moved" instead of a
    // blanket success for both.
    return { ...detail, lastAdjustment: result };
  }

  /** Admin-initiated refund of up to the user's current wallet balance — same
   *  7-day hold + customer-cancelable flow as a self-service request (see
   *  WalletService.requestRefund). */
  async refundBalance(id: string, credits: number, adminUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    await this.wallet.requestRefund(id, credits, { initiatedByAdminId: adminUserId });
    return this.detail(id);
  }

  /** `actor` must actually reach `WalletService.cancelRefund`: the param had
   *  existed there from the start but was never passed from here, so every
   *  admin-canceled refund looked like the customer canceling their own —
   *  the user got the quiet panel-only notification instead of the email
   *  telling them money they were expecting isn't coming, and nothing
   *  recorded who did it. */
  async cancelRefund(id: string, refundId: string, actor: AuditActor) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    await this.wallet.cancelRefund(id, refundId, actor.id, actor.roles);
    return this.detail(id);
  }

  /**
   * Staff-side edit of a customer's billing identity (name/CUI/address the
   * invoices are made out to). Deliberately the SAME field set the customer's
   * own `/account/billing/profile` accepts — a staff edit must not be able to
   * put a profile into a shape the self-service form could never produce,
   * and `BillingService.upsertProfile` is what enforces that plus the
   * "profile just became complete ⇒ backfill the pending invoices" rule.
   *
   * Audit-logged with the before/after profile, since this rewrites who a
   * fiscal document is addressed to.
   */
  async updateBillingProfile(id: string, dto: BillingProfileDto, actor: AuditActor) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');

    const before = await this.billing.getProfile(id);
    const { profile, isComplete, invoicesIssued } = await this.billing.upsertProfile(id, dto);

    await this.audit.log({
      actorId: actor.id,
      actorRoles: actor.roles,
      action: 'billing_profile.update',
      targetType: 'billing_profile',
      targetId: id,
      before: before ? billingProfileSnapshot(before) : null,
      after: billingProfileSnapshot(profile),
    });

    return { profile, isComplete, invoicesIssued };
  }
}

/** The invoice-relevant subset of a billing profile — what the audit row's
 *  before/after needs, without the timestamps and surrogate ids that make a
 *  diff unreadable. */
function billingProfileSnapshot(p: BillingProfile) {
  return {
    kind: p.kind,
    name: p.name,
    taxId: p.taxId,
    regCom: p.regCom,
    vatPayer: p.vatPayer,
    address: p.address,
    city: p.city,
    county: p.county,
    postalCode: p.postalCode,
    country: p.country,
    billingEmail: p.billingEmail,
    iban: p.iban,
    bankName: p.bankName,
  };
}
