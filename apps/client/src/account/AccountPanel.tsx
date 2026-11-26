// Main-menu account section: passkey sign-up / sign-in / recovery, and the signed-in account
// (passkeys, recovery code, rename, sign-out). Playing never needs an account: offline play stays local.
import { useEffect, useState } from 'react';
import { accountApi } from './api';
import { accountAction, accountStore, refreshAccount, useAccount } from './store';
import { passkeysSupported } from './webauthn';
import { desktopSignIn, manageAccount } from '../desktop/account';
import { isDesktop } from '../desktop/update';

type Mode = 'signin' | 'create' | 'recover';

function RecoveryCodeCard({ code }: { code: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="grid gap-2 border border-gold bg-gold/8 p-3" data-testid="acct-recovery">
      <b>Recovery code</b>
      <p>Write this down. It is the only way back in if you lose every passkey. It is shown once.</p>
      <code className="text-xl tracking-[0.12em] select-all" data-testid="acct-recovery-code">{code}</code>
      <div className="flex flex-wrap items-center gap-2">
        <button className="mini" onClick={() => void navigator.clipboard?.writeText(code)}>COPY</button>
        <label><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="acct-recovery-saved" /> I saved it</label>
        <button className="mini primary" disabled={!saved} onClick={() => accountStore.set({ recoveryCode: null })} data-testid="acct-recovery-done">DONE</button>
      </div>
    </div>
  );
}

function NameField({ value, onChange, check }: { value: string; onChange: (v: string) => void; check: boolean }) {
  const [hint, setHint] = useState('');
  useEffect(() => {
    if (!check || value.trim().length < 3) return setHint('');
    const t = window.setTimeout(() => {
      accountApi.nameCheck(value).then((r) => setHint(r.available ? 'Available' : r.reason ?? 'Taken'), () => setHint(''));
    }, 300);
    return () => window.clearTimeout(t);
  }, [value, check]);
  return (
    <label className="grid gap-1">
      <span className="caps text-[11px] opacity-70">Warden name</span>
      <input className="field-input" data-testid="acct-name" value={value} maxLength={18} autoComplete="username webauthn" onChange={(e) => onChange(e.target.value)} />
      {hint && <em data-testid="acct-name-hint" className={`text-xs not-italic ${hint === 'Available' ? 'text-ok' : 'text-bad'}`}>{hint}</em>}
    </label>
  );
}

function SignedOut() {
  const s = useAccount();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const supported = passkeysSupported();
  const go = () => {
    if (mode === 'signin') void accountAction(() => accountApi.signIn(name));
    else if (mode === 'create') void accountAction(() => accountApi.register(name));
    else void accountAction(() => accountApi.recover(name, code));
  };
  if (isDesktop()) return (
    <div className="grid gap-2.5">
      <p>Sign in or create your account in your browser to sync your progress and play co-op.</p>
      <button className="primary" disabled={s.busy} onClick={() => void accountAction(desktopSignIn)}>SIGN IN IN BROWSER</button>
      {s.busy && <p>Complete sign-in in your browser…</p>}
      {s.error && <p className="text-bad">{s.error}</p>}
    </div>
  );
  return (
    <div className="grid gap-2.5">
      <p className="m-0 opacity-80">An account keeps your progress on the server and on every device. Sign in with a passkey: no password.</p>
      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {(['signin', 'create', 'recover'] as Mode[]).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={`mini ${mode === m ? 'on' : ''}`} data-testid={`acct-tab-${m}`} onClick={() => setMode(m)}>
            {m === 'signin' ? 'SIGN IN' : m === 'create' ? 'CREATE ACCOUNT' : 'RECOVER'}
          </button>
        ))}
      </div>
      <form className="grid gap-2.5" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <NameField value={name} onChange={setName} check={mode === 'create'} />
        {mode === 'recover' && (
          <label className="grid gap-1">
            <span className="caps text-[11px] opacity-70">Recovery code</span>
            <input className="field-input" data-testid="acct-code" value={code} placeholder="XXXX-XXXX-XXXX-XXXX" onChange={(e) => setCode(e.target.value)} />
          </label>
        )}
        <button className="primary" type="submit" data-testid="acct-submit" disabled={s.busy || !supported || name.trim().length < 3 || (mode === 'recover' && code.trim().length < 16)}>
          {mode === 'signin' ? 'SIGN IN WITH PASSKEY' : mode === 'create' ? 'CREATE PASSKEY' : 'RECOVER AND ADD A PASSKEY'}
        </button>
      </form>
      {!supported && <p className="text-bad">This browser has no passkey support.</p>}
      {s.error && <p className="text-bad" data-testid="acct-error">{s.error}</p>}
    </div>
  );
}

function SyncLine() {
  const s = useAccount().sync;
  if (!s) return null;
  const text =
    s.state === 'syncing' ? 'Syncing…' : s.state === 'offline' || s.state === 'connecting' ? `Offline · ${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : s.state === 'error' ? `Sync error: ${s.error}` : `Synced · revision ${s.rev}`;
  return (
    <div className="grid gap-0.5 text-[13px] opacity-90" data-testid="acct-sync" data-state={s.state} data-rev={s.rev} data-pending={s.pending}>
      <span>{text}</span>
      {s.claimed && <small>Your progress on this device moved into the account.</small>}
      {s.rejected.length > 0 && <small className="text-bad" data-testid="acct-rejected">{s.rejected.length} change(s) refused by the server: {s.rejected[0].reason}</small>}
    </div>
  );
}

function SignedIn() {
  const s = useAccount();
  const a = s.account!;
  const [label, setLabel] = useState('');
  const [rename, setRename] = useState('');
  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span>Signed in as</span>
        <strong className="text-lg" data-testid="acct-signed-in">{a.name}</strong>
        <button className="mini" data-testid="acct-logout" disabled={s.busy} onClick={() => void accountAction(() => accountApi.logout())}>SIGN OUT</button>
      </div>
      <SyncLine />
      {isDesktop() && <button className="mini" onClick={() => void manageAccount()}>MANAGE ACCOUNT IN BROWSER</button>}
      {!isDesktop() && <h3 className="caps mt-1.5 mb-0 text-xs tracking-[0.14em] opacity-70">Passkeys</h3>}
      <ul className="m-0 grid list-none gap-1.5 p-0" data-testid="acct-passkeys">
        {s.passkeys.map((k) => (
          <li key={k.id} className="flex items-baseline gap-2.5">
            <span>{k.label}</span>
            <small className="flex-1 opacity-60">added {new Date(k.createdAt).toLocaleDateString()}{k.lastUsedAt ? ` · used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ''}</small>
            <button className="mini" disabled={s.busy || s.passkeys.length < 2} title={s.passkeys.length < 2 ? 'Keep at least one passkey' : 'Remove'} onClick={() => void accountAction(() => accountApi.removePasskey(k.id))}>REMOVE</button>
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void (isDesktop() ? manageAccount() : accountAction(() => accountApi.addPasskey(label))).then(() => setLabel('')); }}>
        <input className="field-input" placeholder="Label (e.g. laptop)" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} data-testid="acct-add-label" />
        <button className="mini" type="submit" disabled={s.busy} data-testid="acct-add">ADD PASSKEY</button>
      </form>
      <h3 className="caps mt-1.5 mb-0 text-xs tracking-[0.14em] opacity-70">Recovery</h3>
      <div className="flex flex-wrap items-center gap-2">
        <button className="mini" disabled={s.busy} data-testid="acct-new-code" onClick={() => void accountAction(() => accountApi.newRecoveryCode())}>NEW RECOVERY CODE</button>
        <small>Replaces the old code.</small>
      </div>
      <h3 className="caps mt-1.5 mb-0 text-xs tracking-[0.14em] opacity-70">Name</h3>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void accountAction(async () => { await accountApi.rename(rename); }).then((ok) => ok && setRename('')); }}>
        <input className="field-input" placeholder={a.name} value={rename} maxLength={18} onChange={(e) => setRename(e.target.value)} disabled={!!a.canRenameAt} data-testid="acct-rename" />
        <button className="mini" type="submit" disabled={s.busy || !!a.canRenameAt || rename.trim().length < 3}>RENAME</button>
        {a.canRenameAt && <small>Next rename after {new Date(a.canRenameAt).toLocaleDateString()}</small>}
      </form>
      {s.error && <p className="text-bad" data-testid="acct-error">{s.error}</p>}
    </div>
  );
}

function DesktopApproval({ id }: { id: string }) {
  const account = useAccount();
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  if (account.status !== 'signedIn') return <p>Sign in below to approve the Riftwarden desktop client.</p>;
  if (done) return <p>Desktop sign-in approved. You can return to Riftwarden.</p>;
  return (
    <div className="grid gap-2.5">
      <p>Allow the Riftwarden desktop client to sign in as {account.account?.name}?</p>
      <button className="primary" onClick={() => void accountApi.approveDesktop(id).then(() => setDone(true), (err: Error) => setError(err.message))}>APPROVE DESKTOP SIGN-IN</button>
      {error && <p className="text-bad">{error}</p>}
    </div>
  );
}

export function AccountPanel() {
  const s = useAccount();
  useEffect(() => {
    if (s.status === 'unknown') void refreshAccount();
  }, [s.status]);
  return (
    <div className="grid max-w-[560px] gap-3.5" data-testid="acct-panel" data-status={s.status}>
      {new URLSearchParams(location.search).get('desktop') && <DesktopApproval id={new URLSearchParams(location.search).get('desktop')!} />}
      {s.recoveryCode && <RecoveryCodeCard code={s.recoveryCode} />}
      {s.status === 'unknown' && <p>Checking your account…</p>}
      {s.status === 'offline' && (
        <div className="grid gap-2.5">
          <p data-testid="acct-offline">The account service is unreachable. You can keep playing offline; your progress stays on this device.</p>
          <button className="mini" onClick={() => void refreshAccount()}>RETRY</button>
        </div>
      )}
      {s.status === 'signedOut' && <SignedOut />}
      {s.status === 'signedIn' && <SignedIn />}
    </div>
  );
}
