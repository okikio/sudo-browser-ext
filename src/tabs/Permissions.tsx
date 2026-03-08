import { useCallback, useEffect, useState } from 'react';

import { domainToOrigins } from '~hooks/usePermission';
import { makeUrlIntoDomain } from '~utils/domains';
import { useDomainStorage } from '~utils/storage';

import './Permissions.css';

interface PermissionEntry {
  domain: string;
  type: 'site' | 'source';
}

/** Strip pattern suffix "/*" and protocol prefix from a Chrome origin string. */
function originToDomain(origin: string): string | null {
  return makeUrlIntoDomain(origin.replace(/\/\*$/, ''));
}

export default function Permissions() {
  const [whitelist, setWhitelist] = useDomainStorage();
  const [entries, setEntries] = useState<PermissionEntry[]>([]);

  const loadPermissions = useCallback(() => {
    chrome.permissions.getAll((perms) => {
      const origins = perms.origins ?? [];
      const hostingSet = new Set(whitelist ?? []);

      // Collect unique domains from granted origins, skipping the broad wildcard
      const seen = new Set<string>();
      const result: PermissionEntry[] = [];
      for (const origin of origins) {
        if (origin === '<all_urls>' || origin === '*://*/*') continue;
        const domain = originToDomain(origin);
        if (!domain || seen.has(domain)) continue;
        seen.add(domain);
        result.push({
          domain,
          type: hostingSet.has(domain) ? 'site' : 'source',
        });
      }

      // Sort: hosting sites first, then source domains, both alphabetical
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'site' ? -1 : 1;
        return a.domain.localeCompare(b.domain);
      });
      setEntries(result);
    });
  }, [whitelist]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const revoke = useCallback(
    async (entry: PermissionEntry) => {
      await chrome.permissions.remove({ origins: domainToOrigins(entry.domain) });
      // For hosting sites, also remove from the whitelist so the popup toggle
      // reflects the revocation immediately.
      if (entry.type === 'site') {
        setWhitelist((prev) => (prev ?? []).filter((d) => d !== entry.domain));
      }
      loadPermissions();
    },
    [loadPermissions, setWhitelist],
  );

  const siteEntries = entries.filter((e) => e.type === 'site');
  const sourceEntries = entries.filter((e) => e.type === 'source');

  return (
    <div className="permissions-page">
      <div className="perm-inner">
        <h1 className="perm-title">Granted Permissions</h1>
        <p className="perm-subtitle">
          These are all the domains the extension has been granted browser-level access to. You can revoke any entry at
          any time — the extension will prompt again if access is needed.
        </p>

        <section>
          <h2 className="perm-section-title">Hosting Sites</h2>
          <p className="perm-section-desc">Movie-web / P-Stream instances where you have enabled the extension.</p>
          {siteEntries.length === 0 ? (
            <p className="perm-empty">None yet — enable the extension on a site via the popup.</p>
          ) : (
            <ul className="perm-list">
              {siteEntries.map((e) => (
                <li key={e.domain} className="perm-row">
                  <span className="perm-domain">{e.domain}</span>
                  <button type="button" className="perm-revoke" onClick={() => revoke(e)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: '2rem' }}>
          <h2 className="perm-section-title">Source Domains</h2>
          <p className="perm-section-desc">
            Streaming provider / CDN domains the extension has been allowed to proxy requests to and set up CORS headers
            for. These are used by movie-web to stream video content.
          </p>
          {sourceEntries.length === 0 ? (
            <p className="perm-empty">None yet — source domains are approved on demand when you start streaming.</p>
          ) : (
            <ul className="perm-list">
              {sourceEntries.map((e) => (
                <li key={e.domain} className="perm-row">
                  <span className="perm-domain">{e.domain}</span>
                  <button type="button" className="perm-revoke" onClick={() => revoke(e)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
