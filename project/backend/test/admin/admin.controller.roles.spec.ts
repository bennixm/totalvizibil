import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRolesGuard } from 'src/auth/platform-roles.guard';
import { AdminController } from 'src/admin/admin.controller';

/**
 * The `finance` (Contabil) role's reach into the admin panel.
 *
 * `AdminController` is `@PlatformRoles('admin')` at the class level, and a
 * handful of handlers carry their own `@PlatformRoles('admin', 'finance')`.
 * Because `PlatformRolesGuard` resolves with `Reflector.getAllAndOverride`,
 * the method-level decorator REPLACES the class-level one for that handler
 * only — which is the entire mechanism these tests pin down.
 *
 * Deliberately driven through the REAL guard and the REAL `Reflector`
 * against the REAL controller metadata: a hand-rolled reflector mock (as in
 * platform-roles.guard.spec.ts, which tests the guard in isolation) would
 * assert nothing about whether the decorators are actually ON these methods.
 */

type Handler = (...args: never[]) => unknown;

function contextFor(handler: Handler) {
  return {
    getHandler: () => handler,
    getClass: () => AdminController,
    switchToHttp: () => ({
      getRequest: () => ({ user: principal }),
    }),
  } as never;
}

/** A Contabil with NO admin role — before the method-level overrides, every
 *  one of these handlers threw for this principal. */
let principal: { id: string; platformRoles: string[] } = {
  id: 'staff1',
  platformRoles: ['finance'],
};

const guard = new PlatformRolesGuard(new Reflector());

const proto = AdminController.prototype as unknown as Record<string, Handler>;

/** Every handler the audit's C1–C10 items widened to `finance`. */
const WIDENED: [string, string][] = [
  ['getSettings', 'C9 — settings read'],
  ['getUser', 'C1 — user detail / wallet tab'],
  ['listUserTransactions', 'C2 — per-user ledger'],
  ['exportUserTransactions', 'C2 — ledger PDF export'],
  ['blockWallet', 'C4 — wallet block/unblock'],
  ['adjustWallet', 'C3 — wallet adjust'],
  ['refundBalance', 'C5 — admin-initiated refund'],
  ['cancelWalletRefund', 'C5 — refund cancel'],
  ['updateUserBillingProfile', 'C7 — billing-profile edit'],
  ['listInvoices', 'C6 — invoice list'],
  ['invoiceDetail', 'C6 — invoice detail'],
  ['voidInvoice', 'C6 — invoice void'],
  ['unvoidInvoice', 'C6 — invoice unvoid'],
  ['listReferrals', 'C10 — referrals read'],
  ['exportReferrals', 'C10 — referrals PDF export'],
];

/** Handlers that must stay admin-only — the whole reason the class decorator
 *  was left alone instead of being broadened. */
const STILL_ADMIN_ONLY: [string, string][] = [
  ['updateSettings', 'settings PATCH re-prices the platform'],
  ['broadcastMaintenance', 'emails every active user'],
  ['setUserPassword', 'account takeover'],
  ['updateUser', 'grants platform roles'],
  ['createCategory', 'taxonomy CRUD'],
  ['updateCategory', 'taxonomy CRUD'],
  ['deleteCategory', 'taxonomy CRUD'],
  ['listUsers', 'full user directory'],
  ['overview', 'platform-wide stats dashboard'],
  ['setCompanyStatus', 'business moderation'],
  ['saveCampaign', 'business moderation'],
];

describe('AdminController platform-role gating', () => {
  beforeEach(() => {
    principal = { id: 'staff1', platformRoles: ['finance'] };
  });

  it('every handler named here actually exists on the controller (a rename must fail this spec, not silently skip it)', () => {
    for (const [name] of [...WIDENED, ...STILL_ADMIN_ONLY]) {
      expect(typeof proto[name]).toBe('function');
    }
  });

  describe('a finance-only principal (no admin role)', () => {
    for (const [name, label] of WIDENED) {
      it(`is allowed through ${name} — ${label}`, () => {
        expect(guard.canActivate(contextFor(proto[name]))).toBe(true);
      });
    }

    for (const [name, why] of STILL_ADMIN_ONLY) {
      it(`is still refused by ${name} — ${why}`, () => {
        expect(() => guard.canActivate(contextFor(proto[name]))).toThrow(ForbiddenException);
      });
    }
  });

  describe('an admin principal', () => {
    beforeEach(() => {
      principal = { id: 'staff2', platformRoles: ['admin'] };
    });

    it('keeps access to the widened handlers (the override ADDS finance, it does not swap admin out)', () => {
      for (const [name] of WIDENED) {
        expect(guard.canActivate(contextFor(proto[name]))).toBe(true);
      }
    });

    it('keeps access to the admin-only handlers', () => {
      for (const [name] of STILL_ADMIN_ONLY) {
        expect(guard.canActivate(contextFor(proto[name]))).toBe(true);
      }
    });
  });

  describe('an unrelated staff role', () => {
    it('support/moderator reach none of the money endpoints', () => {
      for (const roles of [['support'], ['moderator'], []]) {
        principal = { id: 'staff3', platformRoles: roles };
        for (const [name] of [...WIDENED, ...STILL_ADMIN_ONLY]) {
          expect(() => guard.canActivate(contextFor(proto[name]))).toThrow(ForbiddenException);
        }
      }
    });
  });
});
