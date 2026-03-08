/**
 * In-memory rate-limiter for source-domain permission tabs.
 *
 * When the background needs to open a PermissionGrant tab for a source
 * domain it has not been granted access to, it records a timestamp here
 * so that rapid repeated requests (e.g. multiple prepareStream calls for
 * the same CDN domain) only open ONE tab per domain per cooldown window.
 *
 * The map is intentionally in-memory (not persisted): if the service worker
 * is restarted the cooldown resets, which is fine — by that point the user
 * has already had a chance to grant or deny the permission.
 */

const recentPromptTimes = new Map<string, number>();

/** How long (ms) to suppress duplicate permission tabs for the same domain. */
const PROMPT_COOLDOWN_MS = 30_000;

export function wasRecentlyPrompted(domain: string): boolean {
  const t = recentPromptTimes.get(domain);
  return t !== undefined && Date.now() - t < PROMPT_COOLDOWN_MS;
}

export function markAsPrompted(domain: string): void {
  recentPromptTimes.set(domain, Date.now());
}

/**
 * Open a PermissionGrant tab for a source domain so the user can approve it.
 * Rate-limited per domain to avoid opening duplicate tabs during rapid repeated
 * requests (e.g. multiple prepareStream / makeRequest calls for the same CDN).
 */
export async function openSourcePermissionTab(domain: string): Promise<void> {
  if (wasRecentlyPrompted(domain)) return;
  markAsPrompted(domain);
  const params = new URLSearchParams({ type: 'source', domain });
  const url = (chrome || browser).runtime.getURL(`/tabs/PermissionGrant.html?${params.toString()}`);
  await (chrome || browser).tabs.create({ url });
}
