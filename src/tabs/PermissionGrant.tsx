import { useCallback, useState } from 'react';

import { Button } from '~components/Button';
import { grantSourcePermission, usePermission } from '~hooks/usePermission';
import { isValidHostname, makeUrlIntoDomain } from '~utils/domains';

import './PermissionGrant.css';

/**
 * PermissionGrant handles two distinct flows:
 *
 * 1. SITE grant  (?redirectUrl=https://pstream.example.com/...)
 *    The movie-web page navigates here via openPage.  After granting, the user
 *    is redirected back to the original URL.
 *
 * 2. SOURCE grant  (?type=source&domain=ee3.me)
 *    The background service worker opens this in a new tab when a source domain
 *    needs permission before the extension can set up streaming rules.
 *    After granting (or declining) the tab simply closes.
 */

type GrantType = 'site' | 'source';

export default function PermissionGrant() {
  const { grantPermission } = usePermission();
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied'>('idle');

  const queryParams = new URLSearchParams(window.location.search);
  const type: GrantType = (queryParams.get('type') as GrantType | null) ?? 'site';
  const redirectUrl = queryParams.get('redirectUrl') ?? undefined;

  // Domain comes from ?domain= for source type, extracted from redirectUrl for site type.
  // Validate and normalise to a bare hostname to prevent crafted query-param values
  // from generating overly broad or invalid permission patterns.
  const rawDomain = queryParams.get('domain');
  const normalizedDomain: string | undefined = (() => {
    const candidate =
      type === 'source'
        ? (rawDomain ?? undefined)
        : ((redirectUrl ? makeUrlIntoDomain(redirectUrl) : undefined) ?? rawDomain ?? undefined);
    if (!candidate) return undefined;
    // Accept only bare hostnames (with optional port); reject URLs, wildcards, paths.
    if (!isValidHostname(candidate)) return undefined;
    return candidate;
  })();
  const domain = normalizedDomain;

  const redirectBack = useCallback(() => {
    if (redirectUrl) {
      chrome.tabs.getCurrent((tab) => {
        if (!tab?.id) return;
        chrome.tabs.update(tab.id, { url: redirectUrl });
      });
    } else {
      window.close();
    }
  }, [redirectUrl]);

  const handleGrant = useCallback(async () => {
    if (!domain) return;

    let granted = false;
    if (type === 'source') {
      granted = await grantSourcePermission(domain);
    } else {
      granted = await grantPermission(domain);
    }

    if (granted) {
      setStatus('granted');
      // For source grants close the tab; for site grants redirect back.
      if (type === 'source') {
        setTimeout(() => window.close(), 800);
      } else {
        redirectBack();
      }
    } else {
      setStatus('denied');
    }
  }, [domain, type, grantSourcePermission, grantPermission, redirectBack]);

  const handleDecline = useCallback(() => {
    setStatus('denied');
    if (type === 'source') {
      setTimeout(() => window.close(), 800);
    } else {
      redirectBack();
    }
  }, [type, redirectBack]);

  if (!domain) {
    return (
      <div className="permission-grant container">
        <div className="inner-container">
          <div className="permission-card">
            <h1 className="color-white">Permission</h1>
            <p className="text-color" style={{ textAlign: 'center' }}>
              No domain found to grant permission to.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'granted') {
    return (
      <div className="permission-grant container">
        <div className="inner-container">
          <div className="permission-card">
            <h1 className="color-white">✓ Approved</h1>
            <p className="text-color" style={{ textAlign: 'center' }}>
              Permission granted for <span className="color-white">{domain}</span>.
              {type === 'source' ? ' This tab will close shortly.' : ''}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="permission-grant container">
        <div className="inner-container">
          <div className="permission-card">
            <h1 className="color-white">Denied</h1>
            <p className="text-color" style={{ textAlign: 'center' }}>
              Permission was not granted for <span className="color-white">{domain}</span>.
              {type === 'source' ? ' This tab will close shortly.' : ''}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="permission-grant container">
      <div className="inner-container">
        <div className="permission-card">
          {type === 'source' ? (
            <>
              <h1 className="color-white">Source Access Needed</h1>
              <p className="text-color" style={{ textAlign: 'center' }}>
                The streaming source <span className="color-white">{domain}</span> needs browser permission so the
                extension can proxy requests and set up CORS headers for playback.
              </p>
              <p className="text-color" style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                The extension will only access this domain when you have the extension enabled on a movie-web or
                P-Stream hosting site.
              </p>
            </>
          ) : (
            <>
              <h1 className="color-white">Site Access</h1>
              <p className="text-color" style={{ textAlign: 'center' }}>
                The website <span className="color-white">{domain}</span> wants to use the extension on their page. Do
                you trust them?
              </p>
            </>
          )}
          <div className="buttons">
            <Button full onClick={handleGrant}>
              {type === 'source' ? 'Allow Source' : 'Grant Permission'}
            </Button>
            <Button full onClick={handleDecline} type="secondary">
              {type === 'source' ? 'Deny' : 'Decline'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
