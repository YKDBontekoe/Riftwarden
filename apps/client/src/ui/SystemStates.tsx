// System states (final design): the offline banner shown on top of every menu while the server is unreachable.
import { useAccount } from '../account/store';

/** Offline state (system states): shown on top of the menus while the server cannot be reached. */
export function OfflineBanner() {
  const account = useAccount();
  if (account.status !== 'offline') return null;
  return (
    <div className="offline-banner ds-glass ds-toast risk" role="status" data-testid="offline-banner">
      <span className="ds-dot" style={{ background: 'var(--ds-risk)' }} />
      <span className="ds-col"><b>Offline · playing locally</b><span className="ds-meta">Runs, loot and progress save on this device and sync when you reconnect. Co-op and the shared war need a connection.</span></span>
    </div>
  );
}
