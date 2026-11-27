import { apiFetch } from '@/services/api'

export interface Money {
  minor: number
  credits: number
}

/** Numbers shared by the influencer's own panel and the admin detail page. */
export interface InfluencerStats {
  totals: {
    users: number
    depositors: number
    conversionPct: number
    deposits: number
    depositsPaid: Money
    depositsCredits: Money
    firstDepositsPaid: Money
    commissions: Money
  }
  months: { month: string; signups: number; firstDeposits: number; commissionMinor: number }[]
  users: {
    id: string
    name: string
    email: string
    joinedAt: string
    deposits: number
    depositsPaid: Money
    firstDepositAt: string | null
    commission: Money | null
  }[]
  deposits: {
    id: string
    userId?: string
    userName?: string
    paid: Money
    credits: Money
    discountPct: number
    first: boolean
    createdAt: string
  }[]
  commissions: {
    id: string
    userId?: string
    userName?: string
    depositPaid: Money
    commissionPct: number
    commission: Money
    invoiceId: string | null
    createdAt: string
  }[]
}

export interface InfluencerProfile {
  id: string
  code: string
  discountPct: number
  commissionPct: number
  active: boolean
  createdAt: string
}

export interface InfluencerDashboard extends InfluencerStats {
  influencer: InfluencerProfile
}

export interface AdminInfluencerRow {
  id: string
  code: string
  discountPct: number
  commissionPct: number
  active: boolean
  note: string | null
  createdAt: string
  user: { id: string; name: string; email: string; status: string }
  users: number
  depositors: number
  firstDepositsPaid: Money
  commissions: Money
}

export interface AdminInfluencerDetail extends InfluencerStats {
  influencer: InfluencerProfile & {
    note: string | null
    userId: string
    user: { id: string; name: string; email: string; status: string; lastLoginAt: string | null }
  }
  invited?: boolean
}

export interface InfluencerInput {
  code?: string
  discountPct?: number
  commissionPct?: number
  active?: boolean
  note?: string
}

/** The influencer's own, read-only panel. */
export function fetchMyInfluencerDashboard(): Promise<InfluencerDashboard> {
  return apiFetch<InfluencerDashboard>('/influencer/me')
}

export function adminListInfluencers(): Promise<{ items: AdminInfluencerRow[] }> {
  return apiFetch<{ items: AdminInfluencerRow[] }>('/admin/influencers')
}

export function adminGetInfluencer(id: string): Promise<AdminInfluencerDetail> {
  return apiFetch<AdminInfluencerDetail>(`/admin/influencers/${id}`)
}

export function adminCreateInfluencer(
  body: { email: string; name: string } & Required<Pick<InfluencerInput, 'code' | 'discountPct' | 'commissionPct'>> &
    Pick<InfluencerInput, 'note'>,
): Promise<AdminInfluencerDetail> {
  return apiFetch<AdminInfluencerDetail>('/admin/influencers', { method: 'POST', body })
}

export function adminUpdateInfluencer(id: string, body: InfluencerInput): Promise<AdminInfluencerDetail> {
  return apiFetch<AdminInfluencerDetail>(`/admin/influencers/${id}`, { method: 'PATCH', body })
}

export function adminResendInfluencerInvite(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/admin/influencers/${id}/resend-invite`, { method: 'POST' })
}
