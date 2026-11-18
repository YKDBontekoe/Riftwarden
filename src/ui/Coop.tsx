import { useEffect, useState } from 'react';
import type { Flow } from '../core/Flow';
import { MAX_PLAYERS, normalizeCode } from '../net/protocol';
import type { NetState } from '../net/NetClient';
import { rarity } from '../loot/rarity';
import { THREAT_TIERS } from '../progression/tiers';
import { SLOT_CSS } from '../visuals/droneModel';
import { useSave } from './App';

function useNet(flow: Flow): NetState | null {
  const [s, setS] = useState<NetState | null>(flow.net?.state ?? null);
  useEffect(() => {
    let off: (() => void) | null = null;
    const attach = () => {
      if (off || !flow.net) return;
      setS(flow.net.state);
      const st = flow.net.store;
      off = st.subscribe(() => setS({ ...st.get() }));
    };
    attach();
    const t = setInterval(attach, 250);
    return () => {
      clearInterval(t);
      off?.();
    };
  }, [flow]);
  return s;
}

/** Join code from the page URL (?join=CODE), used once. */
export function urlJoinCode(): string {
  return normalizeCode(new URLSearchParams(location.search).get('join') ?? '');
}

/**
 * Co-op operations panel (main menu tab and deployment terminal): connect with a guest identity,
 * create or import the online profile, create/join a private session by code or link, ready up,
 * pick the threat tier (host) and deploy the team.
 */
export function CoopPanel({ flow, compact }: { flow: Flow; compact?: boolean }) {
  const net = useNet(flow);
  const save = useSave(flow);
  const [name, setName] = useState(flow.net?.name ?? localName());
  const [code, setCode] = useState(urlJoinCode());
  const [copied, setCopied] = useState(false);
  const status = net?.status ?? 'offline';
  const lobby = net?.lobby ?? null;
  const me = net?.playerId ?? '';
  const host = lobby?.hostId === me;
  const mine = lobby?.players.find((p) => p.id === me);

  const connect = () => void flow.coopConnect(name.trim() || undefined);

  // Auto-join from an invite link once the online profile is ready.
  useEffect(() => {
    if (status === 'online' && net?.hasProfile && !lobby && code && urlJoinCode() === code) flow.net?.send({ t: 'join', code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, net?.hasProfile]);

  if (status === 'offline' || status === 'error' || status === 'connecting') {
    return (
      <div className={`coop ${compact ? 'compact' : ''}`} data-testid="coop-panel">
        <div className="coop-lead">Defend the reactor with up to {MAX_PLAYERS - 1} friends. Each warden keeps their own equipment and loot; towers, cores and the reactor are shared.</div>
        <label className="coop-field">
          <span>CALLSIGN</span>
          <input data-testid="coop-name" maxLength={18} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {code && <div className="coop-note">Invite code <b>{code}</b> will be joined after connecting.</div>}
        <button className="primary" data-testid="coop-connect" disabled={status === 'connecting'} onClick={connect}>
          {status === 'connecting' ? 'CONNECTING…' : 'CONNECT TO CO-OP SERVER'}
        </button>
        {net?.error && <div className="term-msg bad">{net.error}</div>}
        <div className="coop-fine">Co-op uses an online profile stored on the server. Your single-player save is never changed by co-op.</div>
      </div>
    );
  }

  if (status === 'reconnecting') return <div className="coop"><div className="coop-note">Connection lost · reconnecting…</div></div>;

  if (!net?.hasProfile) {
    return (
      <div className="coop" data-testid="coop-profile">
        <div className="coop-title">ONLINE PROFILE</div>
        <div className="coop-lead">This server has no profile for you yet. Co-op progression (equipment, resources, records, HQ) lives on the server so teammates cannot be shortchanged by edited saves.</div>
        <div className="coop-choices">
          <button className="primary" data-testid="coop-import" onClick={() => flow.coopProfileInit('import')}>
            IMPORT A COPY OF MY LOCAL PROFILE
            <small>{flow.profile.localSave.items.length} items · {flow.profile.localSave.resources.credits} cr · your local save stays as it is</small>
          </button>
          <button data-testid="coop-fresh" onClick={() => flow.coopProfileInit('fresh')}>
            START A FRESH ONLINE PROFILE
          </button>
        </div>
        <button className="mini" onClick={() => flow.coopDisconnect()}>CANCEL</button>
      </div>
    );
  }

  if (!lobby) {
    return (
      <div className="coop" data-testid="coop-online">
        <div className="coop-status">
          <i className="dot on" /> ONLINE as <b>{net.name}</b> · {net.rtt} ms · online profile active
        </div>
        <div className="coop-row">
          <button className="primary" data-testid="coop-create" onClick={() => flow.net?.send({ t: 'create', tier: save.threat.selected })}>
            CREATE SESSION
          </button>
          <div className="coop-join">
            <input data-testid="coop-code" placeholder="JOIN CODE" maxLength={8} value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} />
            <button data-testid="coop-join" disabled={code.length < 5} onClick={() => flow.net?.send({ t: 'join', code })}>
              JOIN
            </button>
          </div>
        </div>
        {net.error && <div className="term-msg bad">{net.error}</div>}
        <button className="mini" data-testid="coop-disconnect" onClick={() => flow.coopDisconnect()}>
          DISCONNECT · BACK TO SINGLE PLAYER
        </button>
      </div>
    );
  }

  const link = `${location.origin}${location.pathname}?join=${lobby.code}`;
  const allReady = lobby.players.filter((p) => p.connected && !p.host).every((p) => p.ready);
  const tier = THREAT_TIERS.find((t) => t.id === lobby.tier) ?? THREAT_TIERS[0];
  return (
    <div className="coop" data-testid="coop-lobby">
      <div className="lobby-head">
        <div>
          <div className="coop-kicker">SESSION CODE</div>
          <div className="lobby-code" data-testid="lobby-code">{lobby.code}</div>
        </div>
        <button
          className="mini"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'LINK COPIED' : 'COPY INVITE LINK'}
        </button>
        <div className="lobby-cap">
          {lobby.players.length}/{lobby.capacity} WARDENS · {lobby.state === 'lobby' ? 'IN LOBBY' : lobby.state === 'deploying' ? 'DEPLOYING…' : `OPERATION · WAVE ${lobby.wave}`}
        </div>
      </div>
      <div className="lobby-list">
        {lobby.players.map((p, i) => (
          <div key={p.id} className={`lobby-player ${p.connected ? '' : 'away'}`} data-testid="lobby-player">
            <i className="swatch" style={{ background: SLOT_CSS[i % SLOT_CSS.length] }} />
            <span className="lp-name">
              {p.host && <b className="host">★</b>} {p.name}
              {p.id === me && <em> (you)</em>}
            </span>
            <span className="lp-weapon" style={{ color: rarity(p.rarity as never)?.color }}>
              {p.weapon} · LV {p.level}
            </span>
            <span className={`lp-ready ${p.host || p.ready ? 'ok' : ''}`}>{!p.connected ? 'RECONNECTING' : p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</span>
          </div>
        ))}
        {Array.from({ length: Math.max(0, lobby.capacity - lobby.players.length) }).map((_, i) => (
          <div key={`e${i}`} className="lobby-player empty">
            <i className="swatch" />
            <span className="lp-name">Open slot · share the code</span>
          </div>
        ))}
      </div>
      <div className="lobby-tier">
        <span>THREAT TIER</span>
        {THREAT_TIERS.map((t) => (
          <button key={t.id} data-testid={`lobby-tier-${t.id}`} className={`mini ${t.id === lobby.tier ? 'on' : ''}`} disabled={!host || t.id > lobby.maxTier || lobby.state !== 'lobby'} title={t.id > lobby.maxTier ? 'Every warden must have unlocked this tier' : t.name} onClick={() => flow.net?.send({ t: 'tier', tier: t.id })}>
            {t.roman}
          </button>
        ))}
        <em>{tier.name}</em>
      </div>
      <div className="lobby-actions">
        {!host && (
          <button className={mine?.ready ? '' : 'primary'} data-testid="lobby-ready" disabled={lobby.state !== 'lobby'} onClick={() => flow.net?.send({ t: 'ready', ready: !mine?.ready })}>
            {mine?.ready ? 'NOT READY' : 'READY'}
          </button>
        )}
        {host && (
          <button className="primary" data-testid="lobby-start" disabled={!allReady || lobby.state !== 'lobby'} onClick={() => flow.net?.send({ t: 'start' })}>
            {allReady ? `DEPLOY TEAM · TIER ${tier.roman}` : 'WAITING FOR READY'}
          </button>
        )}
        <button data-testid="lobby-leave" onClick={() => flow.net?.send({ t: 'leave' })}>
          LEAVE SESSION
        </button>
      </div>
      {net.error && <div className="term-msg bad">{net.error}</div>}
      <div className="coop-fine">Prepare your loadout at HQ terminals while you wait: changes are saved to your online profile instantly.</div>
    </div>
  );
}

function localName(): string {
  try {
    const raw = localStorage.getItem('riftwarden.identity');
    if (raw) return (JSON.parse(raw) as { name?: string }).name ?? 'Warden';
  } catch {
    /* ignore */
  }
  return 'Warden';
}
