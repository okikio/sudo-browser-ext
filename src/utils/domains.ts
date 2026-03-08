export function makeUrlIntoDomain(url: string): string | null {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns true when `candidate` is a valid bare hostname (with optional port).
 *
 * Accepts e.g. "example.com" or "cdn.example.com:8080".
 * Rejects full URLs, wildcards (`*`), paths, and any other characters that
 * could produce overly broad or invalid browser permission patterns.
 */
export function isValidHostname(candidate: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9\-._]*[a-zA-Z0-9])?(:\d{1,5})?$/.test(candidate);
}
