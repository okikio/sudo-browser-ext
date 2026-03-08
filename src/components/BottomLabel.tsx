import { useCallback } from 'react';

import { useVersion } from '~hooks/useVersion';
import './BottomLabel.css';

export function BottomLabel() {
  const version = useVersion({ prefixed: true });

  const openPermissions = useCallback(() => {
    const url = (chrome || browser).runtime.getURL('/tabs/Permissions.html');
    (chrome || browser).tabs.create({ url });
  }, []);

  return (
    <h3 className="bottom-label">
      {version}
      <div className="dot" />
      P-Stream
      <div className="dot" />
      <a href="https://github.com/p-stream/extension" target="_blank" rel="noopener noreferrer" className="github-link">
        GitHub ↗
      </a>
      <div className="dot" />
      <button type="button" className="github-link perm-link" onClick={openPermissions}>
        Permissions ↗
      </button>
    </h3>
  );
}

export function TopRightLabel() {
  const version = useVersion({ prefixed: true });

  return <h3 className="top-right-label">{version}</h3>;
}
