import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'

export type BillingKind = 'individual' | 'company'

export interface BillingProfile {
  id: string
  kind: BillingKind
  name: string
  taxId: string | null
  regCom: string | null
  vatPayer: boolean
  address: string
  city: string
  county: string | null
  postalCode: string | null
  country: string
  billingEmail: string | null
  iban: string | null
  bankName: string | null
}

export interface BillingProfileInput {
  kind: BillingKind
  name: string
  taxId?: string
  regCom?: string
  vatPayer?: boolean
  address: string
  city: string
  county?: string
  postalCode?: string
  country?: string
  billingEmail?: string
  iban?: string
  bankName?: string
}

export interface Invoice {
  id: string
  number: string
  issuedAt: string
  buyerKind: BillingKind
  buyerName: string
  buyerTaxId: string | null
  buyerRegCom: string | null
  buyerVatPayer: boolean
  buyerAddress: string
  buyerCity: string
  buyerCounty: string | null
  buyerPostalCode: string | null
  buyerCountry: string
  buyerEmail: string | null
  issuerName: string
  issuerTaxId: string | null
  issuerRegCom: string | null
  issuerAddress: string
  issuerIban: string | null
  issuerBank: string | null
  currency: string
  description: string
  subtotalMinor: number
  vatRatePct: number
  vatMinor: number
  totalMinor: number
  eurCents: number | null
  fxRate: number | null
}

interface State {
  profile: BillingProfile | null
  isComplete: boolean
  unbilledCount: number
  invoices: Invoice[]
  loading: boolean
  working: boolean
  error: string
  /** Set right after a save that just completed the profile and issued back-invoices. */
  lastBackfillCount: number | null
}

/** The user's billing identity (Account → Facturare) + the invoices issued from it. */
export const useBillingStore = defineStore('billing', {
  state: (): State => ({
    profile: null,
    isComplete: false,
    unbilledCount: 0,
    invoices: [],
    loading: false,
    working: false,
    error: '',
    lastBackfillCount: null,
  }),

  actions: {
    async load(): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        const res = await apiFetch<{
          profile: BillingProfile | null
          isComplete: boolean
          unbilled: { count: number }
        }>('/account/billing/profile')
        this.profile = res.profile
        this.isComplete = res.isComplete
        this.unbilledCount = res.unbilled.count
        await this.loadInvoices()
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async loadInvoices(): Promise<void> {
      this.invoices = await apiFetch<Invoice[]>('/account/billing/invoices')
    },

    async saveProfile(input: BillingProfileInput): Promise<boolean> {
      this.working = true
      this.error = ''
      this.lastBackfillCount = null
      try {
        const res = await apiFetch<{
          profile: BillingProfile
          isComplete: boolean
          invoicesIssued: number
        }>('/account/billing/profile', { method: 'PUT', body: input })
        this.profile = res.profile
        this.isComplete = res.isComplete
        this.lastBackfillCount = res.invoicesIssued
        if (res.invoicesIssued > 0) {
          this.unbilledCount = 0
          await this.loadInvoices()
        }
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.working = false
      }
    },

    async backfill(): Promise<number> {
      this.working = true
      this.error = ''
      try {
        const res = await apiFetch<{ issued: number }>('/account/billing/invoices/backfill', {
          method: 'POST',
        })
        if (res.issued > 0) {
          this.unbilledCount = 0
          await this.loadInvoices()
        }
        return res.issued
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return 0
      } finally {
        this.working = false
      }
    },
  },
})
