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
import { SquadBrowser } from './SquadBrowser';
import { TradeWindow } from './Trade';
import { Backdrop, Crumb, Hint, rarityCls } from './ds';
import { FieldIcon } from './FieldIcon';
import { nodeInfo } from '@riftwarden/rules/runmap/map';

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
  const [sectors, setSectors] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = flow.net?.state.lobby;
      if (!l || e.repeat || e.target instanceof HTMLInputElement || flow.net?.state.trade) return;
      if (e.code === 'KeyM') setSectors((v) => !v);
      else if (e.code === 'KeyV' && l.hostId !== flow.net?.state.playerId && l.state === 'lobby') void flow.visitHostHq(!flow.visiting);
      else if (e.code === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) document.querySelector<HTMLButtonElement>('[data-testid=lobby-ready]:not(:disabled), [data-testid=lobby-start]:not(:disabled)')?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow]);
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
        <SquadBrowser maxTier={save.threat.unlocked} onJoin={(c) => flow.net?.send({ t: 'join', code: c })} />
        <button className="mini" data-testid="coop-disconnect" onClick={() => flow.coopDisconnect()}>
          LEAVE CO-OP
        </button>
      </div>
    );
  }

  const inviteOrigin = '__TAURI_INTERNALS__' in window ? 'https://riftwarden.ykdbonte.dev/' : `${location.origin}${location.pathname}`;
  const link = `${inviteOrigin}#/join/${lobby.code}`;
  const connected = lobby.players.filter((p) => p.connected);
  const ready = connected.filter((p) => p.host || p.ready).length;
  const allReady = connected.filter((p) => !p.host).every((p) => p.ready);
  const tier = getTier(lobby.tier);
  const leave = () => {
    flow.net?.send({ t: 'leave' });
    if (flow.visiting) void flow.visitHostHq(false);
  };
  return (
    <div className="coop lobby-screen screen ds-scr" data-testid="coop-lobby">
      <Backdrop />
      <div className="lobby-shade" />
      {net.trade && <TradeWindow flow={flow} trade={net.trade} me={me} />}
      <div className="ds-top">
        <Crumb parts={['Co-op', 'Squad lobby']} />
        <span className="ds-grow" />
        <span className="ds-meta">Room code</span>
        <span className="lobby-code" data-testid="lobby-code">{lobby.code}</span>
        <button
          className="ds-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'LINK COPIED' : 'COPY INVITE LINK'}
        </button>
        {host && lobby.state === 'lobby' && (
          <button className="ds-btn" data-testid="lobby-listed" aria-pressed={lobby.listed} onClick={() => flow.net?.send({ t: 'listed', listed: !lobby.listed })}>
            {lobby.listed ? 'LISTED · OPEN SQUAD' : 'PRIVATE · LIST SQUAD'}
          </button>
        )}
      </div>
      <LobbyTitle flow={flow} host={host} node={lobby.node} tier={tier.id} />
      <div className="lobby-modes ds-col">
        <span className="ds-lbl">Mode</span>
        <span className="set-seg">
          {(['defense', 'survival'] as const).map((m) => (
            <button key={m} data-testid={`lobby-mode-${m}`} className="set-opt" aria-pressed={lobby.mode === m} disabled={!host || lobby.state !== 'lobby'} onClick={() => flow.net?.send({ t: 'mode', mode: m })}>
              {m.toUpperCase()}
            </button>
          ))}
        </span>
        <span className="ds-meta">{lobby.mode === 'survival' ? 'No towers · hunted · one life per node' : 'Towers on · reactor to protect · shared cores'}</span>
      </div>
      <div className="lobby-setup">
        <div className="lobby-tier">
          <span className="ds-lbl">Rift level</span>
          <div className="min-w-[280px] flex-1" title="Every warden must have unlocked the level">
            <RiftLevelPicker value={lobby.tier} unlocked={lobby.maxTier} power={savePower(save)} disabled={!host || lobby.state !== 'lobby'} onPick={(rl) => flow.net?.send({ t: 'tier', tier: rl })} />
          </div>
        </div>
        {sectors && <LobbyWar flow={flow} host={host} node={lobby.node} disabled={lobby.state !== 'lobby'} />}
      </div>
      <div className="lobby-list">
        {Array.from({ length: lobby.capacity }, (_, i) => {
          const p = lobby.players[i];
          if (!p)
            return (
              <div key={`e${i}`} className="lobby-player empty">
                <span className="ds-row"><span className="lp-slot">{String(i + 1).padStart(2, '0')}</span></span>
                <span className="ds-tile empty" style={{ height: 100 }} />
                <span className="ds-col"><span className="ds-h2 lp-name">OPEN SLOT</span><span className="ds-meta">Share the code or the invite link</span></span>
              </div>
            );
          const you = p.id === me;
          return (
            <div key={p.id} className={`lobby-player ${p.connected ? '' : 'away'} ${you ? 'you' : ''}`} data-testid="lobby-player">
              <i className="swatch" style={{ background: SLOT_CSS[i % SLOT_CSS.length] }} />
              <span className="ds-row">
                <span className="lp-slot">{String(i + 1).padStart(2, '0')}{p.host ? ' · HOST' : ''}{you ? ' · YOU' : ''}</span>
                <span className="ds-grow" />
                <span className={`lp-ready ${p.host || p.ready ? 'ok' : ''}`}>{!p.connected ? 'RECONNECTING' : p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</span>
              </span>
              <span className={`ds-tile ${rarityCls(p.rarity)}`} style={{ height: 100 }}><span className="ds-tile-art lp-weapon-art"><FieldIcon name="firepower" /></span><span className="ds-lv">{p.level}</span></span>
              <span className="ds-row" style={{ alignItems: 'flex-end' }}>
                <span className="ds-col ds-grow">
                  <span className="ds-h2 lp-name">{p.name}</span>
                  <span className="ds-meta lp-weapon" style={{ color: rarity(p.rarity as never)?.color }}>{p.weapon} · LV {p.level}</span>
                </span>
                {!you && p.connected && lobby.state === 'lobby' && !net.trade && (
                  <button className="ds-btn lp-trade" data-testid={`lobby-trade-${i}`} onClick={() => flow.net?.send({ t: 'trade', op: 'open', with: p.id })}>TRADE</button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="ds-bot">
        <span className="ds-meta">{ready} of {connected.length} ready · starts when everyone is ready · {net.rtt} ms{lobby.state !== 'lobby' ? ` · ${lobby.state === 'deploying' ? 'deploying…' : `operation · wave ${lobby.wave}`}` : ''}</span>
        {net.error && <span className="term-msg bad">{net.error}</span>}
        <span className="ds-grow" />
        <Hint keys="M" onClick={() => setSectors((v) => !v)}>{sectors ? 'Hide sectors' : host ? 'Change sector' : 'Sector'}</Hint>
        {!host && lobby.state === 'lobby' && (
          <button className="ds-hint" data-testid="lobby-visit" onClick={() => void flow.visitHostHq(!flow.visiting)}><span className="ds-k">V</span>{flow.visiting ? 'Return to my HQ' : 'Visit host HQ'}</button>
        )}
        <button className="ds-hint" data-testid="lobby-leave" onClick={leave}>Leave squad</button>
        {!host && (
          <button className="ds-btn-p" data-testid="lobby-ready" disabled={lobby.state !== 'lobby'} onClick={() => flow.net?.send({ t: 'ready', ready: !mine?.ready })}>
            <span className="ds-kd">ENTER</span>{mine?.ready ? 'NOT READY' : 'READY'}
          </button>
        )}
        {host && (
          <button className="ds-btn-p" data-testid="lobby-start" disabled={!allReady || lobby.state !== 'lobby'} onClick={() => flow.net?.send({ t: 'start' })}>
            <span className="ds-kd">ENTER</span>{allReady ? `DEPLOY TEAM · RL ${tier.id}` : 'WAITING FOR READY'}
          </button>
        )}
      </div>
      <div className="ds-grain" />
    </div>
  );
}

/** Lobby title (canvas "Co-op lobby"): the sector the squad deploys to, its region, level and live events. */
function LobbyTitle({ flow, host, node, tier }: { flow: Flow; host: boolean; node: string | null; tier: number }) {
  const war = useSyncExternalStore(flow.war.store.subscribe, flow.war.store.get).war;
  const chosen = war ? (node && nodePlayable(war, node) ? node : defaultEntry(war)) : null;
  const n = war && chosen ? liveNode(war.seed, war, chosen) : null;
  const name = n ? nodeInfo(n).name : 'Rift War sector';
  const extra = n?.mods.filter((m) => ['distress', 'defense', 'convoy', 'corrupted', 'stronghold'].includes(m)).map((m) => m) ?? [];
  return (
    <div className="lobby-title ds-col">
      <span className="ds-ov ds-em">Operation · {host ? 'you are host' : 'the host chooses'}</span>
      <span className="ds-hero">{name.toUpperCase()}</span>
      <span className="ds-meta">{n ? `${n.region} · Rift Level ${tier} · ${n.actBoss ? 'capital' : `${n.kind} sector`}${extra.length ? ` · ${extra.join(' · ')}` : ''}` : `Rift Level ${tier}`}</span>
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
