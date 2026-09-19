import type { WalletTxn } from '@/stores/wallet'

// Known backend `description` values that a raw generic type label wouldn't
// explain on their own (a platform fee, not a wallet-level event) — mapped to
// a clearer, localized line. Anything else falls back to the generic
// purchase/spend/refund/adjustment label, which is already accurate for it.
const DESCRIPTION_LABELS: Record<string, string> = {
  'Advanced website builder': 'wallet.txnLabel.unlock',
  'Additional business': 'wallet.txnLabel.additionalBusiness',
}

const TYPE_ICON: Record<WalletTxn['type'], string> = {
  purchase: 'mdi-cash-plus',
  spend: 'mdi-cash-minus',
  refund: 'mdi-cash-refund',
  adjustment: 'mdi-tune-variant',
}

/** A specific, human line for a wallet transaction — e.g. "AI prompt" or
 * "Ad clicks" instead of the generic "Spend" every non-CPC/AI spend used to
 * share, so it's clear exactly what the money went to. */
export function txnLabel(txn: WalletTxn, t: (key: string) => string): string {
  if (txn.clicks != null) return t('wallet.adClicks')
  if (txn.provider === 'ai-usage') return t('wallet.txnLabel.aiPrompt')
  if (txn.description && DESCRIPTION_LABELS[txn.description]) {
    return t(DESCRIPTION_LABELS[txn.description])
  }
  return t('wallet.txnType.' + txn.type)
}

export function txnIcon(txn: WalletTxn): string {
  if (txn.clicks != null) return 'mdi-cursor-default-click-outline'
  if (txn.provider === 'ai-usage') return 'mdi-robot-outline'
  return TYPE_ICON[txn.type]
}
