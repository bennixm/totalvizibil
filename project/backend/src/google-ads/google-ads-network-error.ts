/** Node's fetch reports every network failure as "fetch failed" and hides
 *  the reason (DNS, refused connection, TLS…) in `cause`: surface it. */
export function networkErrorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'timeout';
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const why = cause?.code ?? cause?.message;
  return why ? `${err.message}: ${why}` : err.message;
}
