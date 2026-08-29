const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown }

/** First-line message from a NestJS error body, if present. */
function messageFromBody(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message
    if (Array.isArray(m)) return m.map(String).join(', ')
    if (typeof m === 'string') return m
  }
  return undefined
}

/**
 * Thin fetch wrapper around the backend API. Auth is carried by an httpOnly
 * session cookie, so every call opts into credentials; the frontend never
 * handles the token itself.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options

  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const payload = response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFromBody(payload) ?? `API ${response.status} on ${path}`,
      payload,
    )
  }

  return payload as T
}
