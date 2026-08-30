import { apiFetch } from './api'
import type { LocalizedName } from '@/stores/companies'

export interface CategoryLeaf {
  id: string
  slug: string
  name: LocalizedName
  icon: string | null
}

export interface CategoryGroup extends CategoryLeaf {
  children: CategoryLeaf[]
}

/** The public two-level category tree (parent groups + exact-niche children). */
export async function fetchCategoryTree(): Promise<CategoryGroup[]> {
  const { data } = await apiFetch<{ data: CategoryGroup[] }>('/categories')
  return data
}
