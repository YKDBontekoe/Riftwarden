// Account <-> profile glue (architecture v2 section 7). Signed in: the profile switches to the account's copy on
// this device and the session socket keeps it synced; a guest profile with a complete log is uploaded the first
// time (the account adopts it if it has no profile yet). Signed out: back to the guest profile. Namespace
// switches wait until no run is active.
import { SessionClient, type SyncStatus } from '@riftwarden/game/net/SessionClient';
import { fromDoc } from '@riftwarden/protocol/value';
import type { Flow } from '../core/Flow';
import { apiBase } from './api';
import { accountStore } from './store';

export function sessionUrl(): string {
  const base = apiBase() || location.origin;
  return base.replace(/^http/, 'ws') + '/session';
}

let client: SessionClient | null = null;
export const syncStatus = (): SyncStatus | null => client?.status.get() ?? null;
export const sessionClient = (): SessionClient | null => client;

/** Signed in for the first time on this device: upload the guest profile, then hold the account copy. */
async function adopt(flow: Flow, account: string, c: SessionClient): Promise<void> {
  const p = flow.profile;
  const guest = p.journal.state;
  const upload = guest.complete && !!guest.genesis && guest.entries.length > 0;
  if (upload) {
    const r = await c.syncCall(guest.device, guest.entries.map((e) => ({ seq: e.seq, at: e.at, body: { op: e.op, run: e.run } })), guest.genesis);
    p.useNamespace(account);
    p.adoptServer(fromDoc(r.doc), Number(r.rev), 0, []);
    // The progress now lives in the account; the guest starts over so it cannot be uploaded twice.
    if (r.claimed) p.resetGuest();
    c.status.set({ claimed: r.claimed, rev: Number(r.rev) });
  } else {
    p.useNamespace(account);
  }
}

function idle(flow: Flow): boolean {
  return (!flow.run || flow.run.ended) && flow.location !== 'arena' && !flow.coopRun;
}

export function startAccountSync(flow: Flow): void {
  // Automation hook (browser suites).
  if (new URLSearchParams(location.search).has('test')) (window as unknown as { __session?: () => SessionClient | null }).__session = () => client;
  let current: string | null = null;
  let switching = false;

  const apply = async () => {
    const s = accountStore.get();
    const want = s.status === 'signedIn' ? s.account!.id : null;
    if (want === current || switching) return;
    if (!idle(flow)) return void setTimeout(() => void apply(), 2000);
    switching = true;
    try {
      flow.coopDisconnect();
      client?.close();
      client = null;
      flow.profile.onEntry = null;
      if (want) {
        const c = new SessionClient(sessionUrl(), flow.profile);
        client = c;
        c.status.subscribe(() => accountStore.set({ sync: c.status.get() }));
        c.open();
        // The first answer decides whether a guest profile is uploaded; wait for the socket briefly.
        const firstTime = !localStorage.getItem(`riftwarden.acct.${want}.save`);
        if (firstTime) {
          for (let i = 0; i < 50 && !c.connected; i++) await new Promise((r) => setTimeout(r, 100));
          if (c.connected) await adopt(flow, want, c);
          else flow.profile.useNamespace(want);
        } else flow.profile.useNamespace(want);
        flow.profile.onEntry = () => c.nudge();
        c.autoSync = true;
        void c.sync();
      } else {
        flow.profile.useNamespace(null);
        accountStore.set({ sync: null });
      }
      current = want;
      // The HQ shows the profile it was built from: rebuild it for the new copy (the current screen stays).
      flow.profileSwitched();
    } catch (e) {
      accountStore.set({ error: `Sync failed: ${(e as Error).message}` });
    } finally {
      switching = false;
    }
  };
  accountStore.subscribe(() => void apply());
}
