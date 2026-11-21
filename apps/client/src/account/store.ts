// Account session state for the UI: unknown (checking) -> offline | signedOut | signedIn.
import { useSyncExternalStore } from 'react';
import { Store } from '@riftwarden/game/ui/store';
import type { SyncStatus } from '@riftwarden/game/net/SessionClient';
import { type Account, accountApi, ApiError, type PasskeyInfo } from './api';

export interface AccountState {
  status: 'unknown' | 'offline' | 'signedOut' | 'signedIn';
  account: Account | null;
  passkeys: PasskeyInfo[];
  /** Shown once after sign-up / recovery / regeneration; cleared when the player confirms they saved it. */
  recoveryCode: string | null;
  busy: boolean;
  error: string;
  /** Profile sync with the server while signed in. */
  sync: SyncStatus | null;
}

export const accountStore = new Store<AccountState>({ status: 'unknown', account: null, passkeys: [], recoveryCode: null, busy: false, error: '', sync: null });

export function useAccount(): AccountState {
  return useSyncExternalStore(accountStore.subscribe, () => accountStore.get());
}

export async function refreshAccount(): Promise<void> {
  try {
    const me = await accountApi.me();
    accountStore.set({ status: 'signedIn', account: me.account, passkeys: me.passkeys, error: '' });
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) accountStore.set({ status: 'signedOut', account: null, passkeys: [], error: '' });
    else accountStore.set({ status: 'offline', account: null, passkeys: [], error: '' });
  }
}

/** Runs an account action with busy/error bookkeeping, then refreshes the session view. */
export async function accountAction(fn: () => Promise<{ recoveryCode?: string } | void>): Promise<boolean> {
  accountStore.set({ busy: true, error: '' });
  try {
    const r = await fn();
    if (r && r.recoveryCode) accountStore.set({ recoveryCode: r.recoveryCode });
    await refreshAccount();
    return true;
  } catch (e) {
    const err = e as Error & { code?: string };
    accountStore.set({ error: err.code === 'NotAllowedError' || err.name === 'NotAllowedError' ? 'The passkey prompt was cancelled' : err.message });
    return false;
  } finally {
    accountStore.set({ busy: false });
  }
}
