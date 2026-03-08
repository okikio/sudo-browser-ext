import { useCallback } from 'react';

import { usePermission } from '~hooks/usePermission';
import { useDomainStorage } from '~utils/storage';

export function useDomainWhitelist() {
  const [domainWhitelist, setDomainWhitelist] = useDomainStorage();

  const removeDomain = useCallback((domain: string | null) => {
    if (!domain) return;
    setDomainWhitelist((s) => [...(s ?? []).filter((v) => v !== domain)]);
  }, []);

  const addDomain = useCallback((domain: string | null) => {
    if (!domain) return;
    setDomainWhitelist((s) => [...(s ?? []).filter((v) => v !== domain), domain]);
  }, []);

  return {
    removeDomain,
    addDomain,
    domainWhitelist,
  };
}

export function useToggleWhitelistDomain(domain: string | null) {
  const { domainWhitelist, removeDomain } = useDomainWhitelist();
  const isWhitelisted = domainWhitelist.includes(domain ?? '');
  const { grantPermission } = usePermission();
  const iconPath = (chrome || browser).runtime.getURL(isWhitelisted ? 'assets/active.png' : 'assets/inactive.png');

  (chrome || browser).action.setIcon({
    path: iconPath,
  });

  /**
   * Toggle the domain whitelist state.
   *
   * When enabling a domain the extension also requests browser-level host
   * permission for that specific domain (MALSync-style per-domain grant).
   * The domain is only added to the whitelist if the user actually grants
   * the permission prompt.  Disabling a domain only removes it from the
   * whitelist; the browser permission is kept so the user can re-enable
   * without another prompt.
   *
   * Returns immediately (no-op) when `domain` is null/empty to avoid silently
   * appearing to succeed without performing any action.
   */
  const toggle = useCallback(async () => {
    if (!domain) return;

    if (!isWhitelisted) {
      await grantPermission(domain);
      return;
    }

    removeDomain(domain);
  }, [isWhitelisted, domain, removeDomain, grantPermission]);

  return {
    toggle,
    isWhitelisted,
  };
}
