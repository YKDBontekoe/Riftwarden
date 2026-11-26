// The gateway's account API (passkeys, sessions, recovery codes). Same origin in development (Vite proxies
// /auth), `VITE_API_URL` in production builds, `?api=<origin>` to point a client at another gateway.
import { isDesktop } from '../desktop/update';
import { desktopSignOut } from '../desktop/account';
import { assertionJSON, creationOptions, registrationJSON, requestOptions } from './webauthn';

export interface Account {
  id: string;
  name: string;
  admin: boolean;
  createdAt: string;
  canRenameAt?: string | null;
}

export interface PasskeyInfo {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

import { apiBase } from '@riftwarden/game/net/api';

export { apiBase };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('offline', 'The account service is unreachable', 0);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!res.ok) throw new ApiError(data?.error ?? 'http', data?.message ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

interface Started {
  ceremony: string;
  options: Record<string, unknown>;
}
interface SignedIn {
  account: Account;
  recoveryCode?: string;
}

async function create(options: Record<string, unknown>): Promise<PublicKeyCredential> {
  const cred = (await navigator.credentials.create(creationOptions(options))) as PublicKeyCredential | null;
  if (!cred) throw new ApiError('cancelled', 'Passkey creation was cancelled', 0);
  return cred;
}

async function get(options: Record<string, unknown>): Promise<PublicKeyCredential> {
  const cred = (await navigator.credentials.get(requestOptions(options))) as PublicKeyCredential | null;
  if (!cred) throw new ApiError('cancelled', 'Sign-in was cancelled', 0);
  return cred;
}

export const accountApi = {
  approveDesktop: (id: string) => call<void>('POST', '/auth/desktop/approve', { id }),
  me: () => call<{ account: Account; passkeys: PasskeyInfo[] }>('GET', '/auth/me'),
  nameCheck: (name: string) => call<{ available: boolean; name: string; reason?: string }>('GET', `/auth/name?name=${encodeURIComponent(name)}`),
  async register(name: string): Promise<SignedIn> {
    const s = await call<Started>('POST', '/auth/register/start', { name });
    const cred = await create(s.options);
    return call<SignedIn>('POST', '/auth/register/finish', { ceremony: s.ceremony, credential: registrationJSON(cred) });
  },
  async signIn(name: string): Promise<SignedIn> {
    const s = await call<Started>('POST', '/auth/login/start', { name });
    const cred = await get(s.options);
    return call<SignedIn>('POST', '/auth/login/finish', { ceremony: s.ceremony, credential: assertionJSON(cred) });
  },
  async recover(name: string, code: string): Promise<SignedIn> {
    const s = await call<Started>('POST', '/auth/recover/start', { name, code });
    const cred = await create(s.options);
    return call<SignedIn>('POST', '/auth/recover/finish', { ceremony: s.ceremony, credential: registrationJSON(cred) });
  },
  async addPasskey(label: string): Promise<void> {
    const s = await call<Started>('POST', '/auth/passkeys/start', { label });
    const cred = await create(s.options);
    await call<void>('POST', '/auth/passkeys/finish', { ceremony: s.ceremony, credential: registrationJSON(cred) });
  },
  removePasskey: (id: string) => call<void>('DELETE', `/auth/passkeys/${encodeURIComponent(id)}`),
  newRecoveryCode: () => call<{ recoveryCode: string }>('POST', '/auth/recovery-code'),
  rename: (name: string) => call<Account>('POST', '/auth/rename', { name }),
  async logout(): Promise<void> {
    await call<void>('POST', '/auth/logout');
    if (isDesktop()) await desktopSignOut();
  },
};
