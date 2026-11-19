import { useI18n } from 'vue-i18n'

import { ApiError } from '@/services/api'
import type { ExternalInvoice, InvoiceSource } from '@/stores/externalInvoices'

const CURRENCY_SUFFIX: Record<string, string> = { EUR: '€', RON: 'lei', USD: '$', GBP: '£' }

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary'

/** Formatting + status vocabulary shared by every supplier-invoice view. */
export function useInvoiceFormat() {
  const { t, locale } = useI18n()

  /** Amount in the document's own currency (never converted). */
  function amount(minor: number | null | undefined, currency: string): string {
    if (minor === null || minor === undefined) return '-'
    const value = (minor / 100).toLocaleString('ro-RO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return `${value} ${CURRENCY_SUFFIX[currency] ?? currency}`
  }

  function date(s: string | null | undefined): string {
    return s ? new Date(s).toLocaleDateString('ro-RO', { timeZone: 'UTC' }) : '-'
  }

  function dateTime(s: string): string {
    return new Date(s).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })
  }

  function fileSize(bytes: number): string {
    return bytes >= 1_000_000
      ? `${(bytes / 1_000_000).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1000))} KB`
  }

  function monthName(m: number, y?: number): string {
    const s = new Date(Date.UTC(y ?? 2000, m - 1, 1)).toLocaleDateString(locale.value, {
      month: 'long',
      ...(y ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    })
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  /** Days until (positive) / since (negative) the due date. */
  function daysToDue(due: string | null): number | null {
    if (!due) return null
    const now = new Date()
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    return Math.round((new Date(due).getTime() - today) / 86_400_000)
  }

  function payment(r: Pick<ExternalInvoice, 'paymentStatus' | 'dueState' | 'dueDate'>): {
    label: string
    tone: Tone
    icon: string
  } {
    if (r.paymentStatus === 'paid') {
      return { label: t('supplierInvoices.statusPaid'), tone: 'success', icon: 'mdi-check-circle-outline' }
    }
    if (r.paymentStatus === 'unpaid') {
      const d = daysToDue(r.dueDate)
      if (r.dueState === 'overdue' && d !== null) {
        return { label: t('supplierInvoices.overdueBy', { n: Math.abs(d) }), tone: 'error', icon: 'mdi-alert-circle-outline' }
      }
      if (r.dueState === 'due_soon' && d !== null) {
        return {
          label: d === 0 ? t('supplierInvoices.dueToday') : t('supplierInvoices.dueIn', { n: d }),
          tone: 'warning',
          icon: 'mdi-clock-alert-outline',
        }
      }
      return { label: t('supplierInvoices.statusUnpaid'), tone: 'info', icon: 'mdi-clock-outline' }
    }
    return { label: t('supplierInvoices.statusUnknown'), tone: 'neutral', icon: 'mdi-help-circle-outline' }
  }

  function processing(r: Pick<ExternalInvoice, 'processingStatus' | 'possibleDuplicateOfId' | 'issues'>): {
    label: string
    tone: Tone
    icon: string
  } {
    if (r.processingStatus === 'verified') {
      return { label: t('supplierInvoices.procVerified'), tone: 'success', icon: 'mdi-shield-check-outline' }
    }
    if (r.possibleDuplicateOfId) {
      return { label: t('supplierInvoices.procDuplicate'), tone: 'error', icon: 'mdi-content-duplicate' }
    }
    return { label: t('supplierInvoices.procReview'), tone: 'warning', icon: 'mdi-eye-check-outline' }
  }

  function sourceLabel(s: InvoiceSource): string {
    return t(`supplierInvoices.source.${s}`)
  }
  function sourceIcon(s: InvoiceSource): string {
    return (
      {
        api: 'mdi-api',
        manual: 'mdi-upload-outline',
        email: 'mdi-email-outline',
        efactura: 'mdi-file-certificate-outline',
        peppol: 'mdi-transit-connection-variant',
      } as Record<InvoiceSource, string>
    )[s]
  }

  /** Backend reason codes → readable text; anything else shown as-is. */
  function errText(e: unknown): string {
    const raw = e instanceof ApiError || e instanceof Error ? e.message : ''
    return reason(raw) || t('admin.genericError')
  }
  function reason(code: string | null | undefined): string {
    if (!code) return ''
    const key = `supplierInvoices.err.${code}`
    const translated = t(key)
    return translated !== key ? translated : code
  }

  return {
    amount,
    date,
    dateTime,
    fileSize,
    monthName,
    daysToDue,
    payment,
    processing,
    sourceLabel,
    sourceIcon,
    errText,
    reason,
  }
}

/** Reads a File as a `data:` URI. */
export function readDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export const MAX_FILE_BYTES = 6_000_000
export const FILE_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,.xml,application/xml,text/xml'
