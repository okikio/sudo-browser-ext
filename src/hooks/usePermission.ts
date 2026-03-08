import { useCallback, useEffect, useState } from 'react';

import { useDomainWhitelist } from './useDomainWhitelist';

/**
 * Build the pair of origin patterns for a given host, e.g.
 *   "example.com" → ["https://example.com/*", "http://example.com/*"]
 */
export function domainToOrigins(domain: string): string[] {
  return [`https://${domain}/*`, `http://${domain}/*`];
}

/**
 * Returns true if the extension has the broad <all_urls> permission OR
 * if the user has already completed the one-time initial setup acknowledgement
 * (stored as `permSetupDone` in local storage).
 *
 * This is backward-compatible: users who granted <all_urls> before the
 * per-domain system was introduced continue to work without any migration.
 */
export async function hasPermission(): Promise<boolean> {
  const [hasAll, setupDone] = await Promise.all([
    chrome.permissions.contains({ origins: ['<all_urls>'] }),
    new Promise<boolean>((resolve) => {
      chrome.storage.local.get('permSetupDone', (r) => resolve(!!r.permSetupDone));
    }),
  ]);
  return hasAll || setupDone;
}

/**
 * Returns true if the extension has been granted permission for the specific
 * host (either via per-domain grant or the legacy <all_urls> grant).
 */
export async function hasDomainPermission(domain: string): Promise<boolean> {
  const [hasAll, hasDomain] = await Promise.all([
    chrome.permissions.contains({ origins: ['<all_urls>'] }),
    chrome.permissions.contains({ origins: domainToOrigins(domain) }),
  ]);
  return hasAll || hasDomain;
}

/**
 * Grant browser-level permission for a SOURCE domain only — does NOT add the
 * domain to the hosting-site whitelist.  Used when the background needs to
 * proxy requests to a streaming provider that the user hasn't yet approved.
 */
export async function grantSourcePermission(domain: string): Promise<boolean> {
  return chrome.permissions.request({ origins: domainToOrigins(domain) });
}

export function usePermission() {
  const { addDomain } = useDomainWhitelist();
  const [permission, setPermission] = useState(false);

  /**
   * Grant permission.
   *
   * - When `domain` is provided (MALSync-style per-domain flow): requests only
   *   the origins for that specific domain, then adds it to the whitelist.
   * - When no `domain` is provided (initial setup acknowledgement): marks the
   *   extension as set up via a storage flag without requesting <all_urls>.
   */
  const grantPermission = useCallback(
    async (domain?: string) => {
      if (domain) {
        const granted = await chrome.permissions.request({ origins: domainToOrigins(domain) });
        if (granted) {
          addDomain(domain);
          setPermission(true);
        }
        return granted;
      }

      // Initial setup acknowledgement — no broad permission request
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ permSetupDone: true }, resolve);
      });
      setPermission(true);
      return true;
    },
    [addDomain],
  );

  useEffect(() => {
    hasPermission().then((has) => setPermission(has));
  }, []);

  return {
    hasPermission: permission,
    grantPermission,
  };
}
