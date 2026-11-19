import type { ExternalSupplier, PrismaClient } from '@prisma/client';
import { providerInfo } from './external-invoice-providers';
import { addDays, type NormalizedInvoice } from './external-invoice-model';

/** Matching key for a supplier name: "Exemplu Hosting S.R.L." and
 *  "exemplu hosting srl" are the same supplier. */
export function supplierNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function supplierDisplayName(provider: string, providerName?: string | null): string {
  if (provider === 'other' && providerName?.trim()) return providerName.trim();
  return providerInfo(provider)?.name ?? provider;
}

type Db = Pick<PrismaClient, 'externalSupplier' | 'externalInvoice'>;

/**
 * Finds (or creates) the registry entry an invoice belongs to: by provider +
 * normalized name, falling back to the VAT id for `other` suppliers whose
 * name was written differently. Learns the VAT id when it's first seen.
 */
export async function resolveSupplier(db: Db, n: NormalizedInvoice): Promise<ExternalSupplier> {
  const name = supplierDisplayName(n.provider, n.providerName);
  const nameKey = supplierNameKey(name) || n.provider;
  let s = await db.externalSupplier.findUnique({
    where: { provider_nameKey: { provider: n.provider, nameKey } },
  });
  if (!s && n.supplierVatId && n.provider === 'other') {
    s = await db.externalSupplier.findFirst({
      where: { provider: 'other', vatId: n.supplierVatId },
    });
  }
  if (!s) {
    s = await db.externalSupplier.upsert({
      where: { provider_nameKey: { provider: n.provider, nameKey } },
      create: { provider: n.provider, name, nameKey, vatId: n.supplierVatId ?? null },
      update: {},
    });
  } else if (!s.vatId && n.supplierVatId) {
    s = await db.externalSupplier.update({ where: { id: s.id }, data: { vatId: n.supplierVatId } });
  }
  return s;
}

/** Anomaly thresholds: a total more than 50% above the supplier's recent
 *  average (same currency, at least 3 earlier invoices) and at least 50
 *  currency units more. Deliberately conservative: a flag, not a block. */
const ANOMALY_RATIO = 1.5;
const ANOMALY_MIN_DIFF_MINOR = 5000;
const ANOMALY_HISTORY = 6;

/**
 * Ingestion-time signals that need the supplier's history:
 *  - amount_anomaly: unusually high total for this supplier
 *  - vat_id_changed: a VAT id different from the one on record (could be a
 *    legitimate change, or a fraudulent invoice; worth a human look)
 *  - due_from_terms: no due date on the document, filled in from the
 *    supplier's payment terms
 */
export async function supplierSignals(
  db: Db,
  supplier: ExternalSupplier,
  n: NormalizedInvoice,
): Promise<{ flags: string[]; dueDate: Date | null }> {
  const flags: string[] = [];
  if (
    supplier.vatId &&
    n.supplierVatId &&
    supplierNameKey(supplier.vatId) !== supplierNameKey(n.supplierVatId)
  ) {
    flags.push('vat_id_changed');
  }
  const recent = await db.externalInvoice.findMany({
    where: { supplierId: supplier.id, currency: n.currency, issueDate: { lt: n.issueDate } },
    orderBy: { issueDate: 'desc' },
    take: ANOMALY_HISTORY,
    select: { totalMinor: true },
  });
  if (recent.length >= 3) {
    const avg = recent.reduce((s, r) => s + r.totalMinor, 0) / recent.length;
    if (n.totalMinor > avg * ANOMALY_RATIO && n.totalMinor - avg >= ANOMALY_MIN_DIFF_MINOR) {
      flags.push('amount_anomaly');
    }
  }
  let dueDate = n.dueDate ?? null;
  if (!dueDate && supplier.paymentTermsDays !== null && supplier.paymentTermsDays !== undefined) {
    dueDate = addDays(n.issueDate, supplier.paymentTermsDays);
    flags.push('due_from_terms');
  }
  return { flags, dueDate };
}
