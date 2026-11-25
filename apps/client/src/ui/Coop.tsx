import { useEffect, useState, useSyncExternalStore } from 'react';
import { defaultEntry, liveNode, nodePlayable } from '@riftwarden/rules/war/world';
import { RegionMap, RegionTabs, regionOfNode } from './WarMap';
import type { Flow } from '../core/Flow';
import { MAX_PLAYERS, normalizeCode } from '@riftwarden/protocol/protocol';
import type { NetState } from '@riftwarden/game/net/NetClient';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { RiftLevelPicker, savePower } from './RiftLevel';
import { SLOT_CSS } from '@riftwarden/game/visuals/droneModel';
import { useSave } from './useSave';
import { inviteCode } from './router';
import { useAccount } from '../account/store';
import { NamedDrops } from './NamedDrops';

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

/** Join code from an invite link (#/join/CODE or ?join=CODE). */
export function urlJoinCode(): string {
  return normalizeCode(inviteCode());
}

/**
 * Co-op operations panel (main menu tab and deployment terminal): join with the signed-in account, create/join a private session by code or link, ready up,
 * pick the threat tier (host) and deploy the team.
 */
export function CoopPanel({ flow, compact }: { flow: Flow; compact?: boolean }) {
  const net = useNet(flow);
  const save = useSave(flow);
  const account = useAccount();
  const [code, setCode] = useState(urlJoinCode());
  const [copied, setCopied] = useState(false);
  const status = net?.status ?? 'offline';
  const lobby = net?.lobby ?? null;
  const me = net?.playerId ?? '';
  const host = lobby?.hostId === me;
  const mine = lobby?.players.find((p) => p.id === me);

  const connect = () => void flow.coopConnect();

  // Auto-join from an invite link once the online profile is ready.
  useEffect(() => {
    if (status === 'online' && !lobby && code && urlJoinCode() === code) flow.net?.send({ t: 'join', code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status === 'offline' || status === 'error' || status === 'connecting') {
    const signedIn = account.status === 'signedIn';
    return (
      <div className={`coop ${compact ? 'compact' : ''}`} data-testid="coop-panel">
        <div className="text-muted leading-[1.45]">Defend the reactor with up to {MAX_PLAYERS - 1} friends. Each warden keeps their own equipment and loot; towers, cores and the reactor are shared.</div>
        {signedIn ? (
          <div className="text-amber text-[13px]">
            Playing as <b>{account.account!.name}</b>
          </div>
        ) : (
          <div className="text-amber text-[13px]" data-testid="coop-signin">Co-op needs an account: open ACCOUNT in the main menu to sign in with a passkey.</div>
        )}
        {code && <div className="text-amber text-[13px]">Invite code <b>{code}</b> will be joined after connecting.</div>}
        <button className="primary" data-testid="coop-connect" disabled={!signedIn || status === 'connecting'} onClick={connect}>
          {status === 'connecting' ? 'CONNECTING…' : 'GO ONLINE'}
        </button>
        {net?.error && <div className="term-msg bad">{net.error}</div>}
        <div className="text-faint text-[12px] leading-[1.4]">Co-op results (loot, resources, records) are saved to your account, which syncs with this device.</div>
      </div>
    );
  }

  if (status === 'reconnecting') return <div className="coop"><div className="text-amber text-[13px]">Connection lost · reconnecting…</div></div>;
  if (!net) return null;

  if (!lobby) {
    return (
      <div className="coop" data-testid="coop-online">
        <div className="coop-status">
          <i className="dot on" /> ONLINE as <b>{net.name}</b> · {net.rtt} ms
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
          LEAVE CO-OP
        </button>
      </div>
    );
  }

  const link = `${location.origin}${location.pathname}#/join/${lobby.code}`;
  const allReady = lobby.players.filter((p) => p.connected && !p.host).every((p) => p.ready);
  const tier = getTier(lobby.tier);
  return (
    <div className="coop" data-testid="coop-lobby">
      <div className="lobby-head">
        <div>
          <div className="ds-lbl">Room code</div>
          <div className="lobby-code" data-testid="lobby-code">{lobby.code}</div>
        </div>
        <button
          className="ds-btn"
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
            <span className="lp-slot ds-mono">SLOT {i + 1}</span>
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
            <span className="lp-slot ds-mono">SLOT {lobby.players.length + i + 1}</span>
            <span className="lp-name">Open slot · share the code</span>
          </div>
        ))}
      </div>
      <div className="lobby-tier">
        <span>RIFT LEVEL</span>
        <div className="min-w-[280px] flex-1" title="Every warden must have unlocked the level">
          <RiftLevelPicker value={lobby.tier} unlocked={lobby.maxTier} power={savePower(save)} disabled={!host || lobby.state !== 'lobby'} onPick={(rl) => flow.net?.send({ t: 'tier', tier: rl })} />
        </div>
      </div>
      <LobbyWar flow={flow} host={host} node={lobby.node} disabled={lobby.state !== 'lobby'} />
      <div className="lobby-tier lobby-mode">
        <span>GAME MODE</span>
        <span className="set-seg">
        {(['defense', 'survival'] as const).map((m) => (
          <button key={m} data-testid={`lobby-mode-${m}`} className="set-opt" aria-pressed={lobby.mode === m} disabled={!host || lobby.state !== 'lobby'} onClick={() => flow.net?.send({ t: 'mode', mode: m })}>
            {m.toUpperCase()}
          </button>
        ))}
        </span>
        <em>{lobby.mode === 'survival' ? 'No towers · hunted · one life per node' : 'Hold the reactor · build towers'}</em>
      </div>
      <div className="lobby-actions">
        {!host && (
          <button className={mine?.ready ? '' : 'primary'} data-testid="lobby-ready" disabled={lobby.state !== 'lobby'} onClick={() => flow.net?.send({ t: 'ready', ready: !mine?.ready })}>
            {mine?.ready ? 'NOT READY' : 'READY'}
          </button>
        )}
        {host && (
          <button className="primary" data-testid="lobby-start" disabled={!allReady || lobby.state !== 'lobby'} onClick={() => flow.net?.send({ t: 'start' })}>
            {allReady ? `DEPLOY TEAM · RL ${tier.id}` : 'WAITING FOR READY'}
          </button>
        )}
        {!host && lobby.state === 'lobby' && (
          <button data-testid="lobby-visit" onClick={() => void flow.visitHostHq(!flow.visiting)}>
            {flow.visiting ? 'RETURN TO MY HQ' : 'VISIT HOST HQ'}
          </button>
        )}
        <button
          data-testid="lobby-leave"
          onClick={() => {
            flow.net?.send({ t: 'leave' });
            if (flow.visiting) void flow.visitHostHq(false);
          }}
        >
          LEAVE SESSION
        </button>
      </div>
      {net.error && <div className="term-msg bad">{net.error}</div>}
      <div className="text-faint text-[12px] leading-[1.4]">Prepare your loadout at HQ terminals while you wait: changes sync to your account before the operation starts.</div>
    </div>
  );
}

/** Lobby: the Rift War sector the team deploys to (the host picks on the map; default: the front's landing). */
function LobbyWar({ flow, host, node, disabled }: { flow: Flow; host: boolean; node: string | null; disabled: boolean }) {
  const wv = useSyncExternalStore(flow.war.store.subscribe, flow.war.store.get);
  const [k, setK] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    void flow.war.refresh();
  }, [flow]);
  const war = wv.war;
  if (!war) return null;
  const chosen = node && nodePlayable(war, node) ? node : defaultEntry(war);
  const region = k ?? regionOfNode(war.seed, chosen, 0);
  const n = liveNode(war.seed, war, chosen);
  const inspected = hover ? liveNode(war.seed, war, hover) : n;
  return (
    <div className="lobby-war" data-testid="lobby-war">
      <div className="lobby-tier">
        <span>DEPLOYMENT SECTOR</span>
        <em>{n ? `${n.region} · ${n.actBoss ? 'capital' : `sector ${n.col + 1}`}` : '—'}{host ? ' · click a sector to choose' : ' · the host chooses'}</em>
      </div>
      <RegionTabs war={war} k={region} onPick={(next) => { setHover(null); setK(next); }} />
      <RegionMap war={war} k={region} pickAll={host && !disabled} selected={chosen} onSelect={(id) => flow.net?.send({ t: 'node', node: id })} onHover={setHover} seenAt={wv.seenAt} />
      {inspected && <NamedDrops node={inspected} />}
    </div>
  );
}
