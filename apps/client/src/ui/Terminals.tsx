import { DeployMapPanel, ResumeCard } from './DeployMap';
import { useMemo, useState } from 'react';
import { sfx } from '@riftwarden/game/audio/Sfx';
import { fmtNum, formatModifier, STAT_DEFS } from '@riftwarden/rules/combat/stats';
import type { Flow } from '../core/Flow';
import { STORAGE_EXPANSION, storageExpansionCost } from '@riftwarden/rules/loot/economy';
import { weaponStatRows, withSocket } from '@riftwarden/rules/loot/equipment';
import { FAMILIES, SOCKET_LABEL } from '@riftwarden/rules/weapons/build';
import { canInstall, moduleTypeDef, removalCost } from '@riftwarden/rules/weapons/modules';
import { WeaponViewer } from './WeaponViewer';
import { DroneStats } from './DroneStats';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { ARENA } from '@riftwarden/rules/world/layout';
import { type ItemInstance, type SlotId, SLOTS } from '@riftwarden/rules/progression/items';
import {
  deployBlocker,
  type EngineeringResult,
  equippedItem,
  type SaveData,
  storedItems,
} from '@riftwarden/rules/progression/save';
import { CHECKPOINT_INTERVAL, THREAT_TIERS, type ThreatTier, unlockText } from '@riftwarden/rules/progression/tiers';
import { MILESTONES } from '@riftwarden/rules/survival/records';
import { fmtTime, useSave } from './App';
import { Shell } from './shell';
import { StationDirectory, WardenProgress } from './Directory';
import { CoopPanel } from './Coop';
import { ResourceBar, useTx, TxMessage, CostLine } from './economy';
import { dismantleYield } from '@riftwarden/rules/economy/config';
import { uiEvents } from '@riftwarden/game/ui/store';
import { type InvEntry, InventoryView, ItemCard, ItemDetail, RarityLegend, sortEntries } from './items';

const multiplier = (value: number) => `${Number(value.toFixed(2))}×`;

// ------------------------------------------------------------------ deployment

export function DeployTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'solo' | 'coop'>(flow.net ? 'coop' : 'solo');
  const selected = THREAT_TIERS.find((t) => t.id === save.threat.selected) ?? THREAT_TIERS[0];
  const weapon = equippedItem(save, 'weapon');
  const blocker = deployBlocker(save);
  const gearCount = SLOTS.filter((s) => save.loadout[s.id]).length;
  const [entry, setEntry] = useState<string | null>(null);
  const deploy = () => {
    if (busy) return;
    setBusy(true);
    void flow.deploy(selected.id, entry ?? undefined).then((ok) => {
      if (!ok) setBusy(false);
    });
  };
  return (
    <Shell code="DP-01" title="DEPLOYMENT" sub="Launch bay · survival operations" close={close} wide>
      <div className="tabs deploy-mode">
        <button className={mode === 'solo' ? 'on' : ''} data-testid="deploy-solo" onClick={() => setMode('solo')}>
          SOLO OPERATION
        </button>
        <button className={mode === 'coop' ? 'on' : ''} data-testid="deploy-coop" onClick={() => setMode('coop')}>
          CO-OP OPERATION · 2-4 WARDENS
        </button>
      </div>
      {mode === 'coop' ? (
        <CoopPanel flow={flow} />
      ) : (
      <div className={`deploy-grid${flow.mapMode ? ' war' : ''}`}>
        <div className="arena-card">
          <ResumeCard flow={flow} save={save} />
          {flow.mapMode ? <DeployMapPanel flow={flow} save={save} entry={entry} onEntry={setEntry} /> : <><div className="operation-heading"><h2>Reactor yard</h2><span>Sector 07</span></div>
          <FacilityPlan /></>}
          <p>Hold the reactor. Build along the marked approaches and bank your haul every {CHECKPOINT_INTERVAL} waves.</p>
          <details className="field-notes">
            <summary>Survival rules</summary>
            <ul className="rules">
              <li>Each checkpoint banks collected equipment and salvage, awards a cache, and opens a route home.</li>
              <li>Reactor loss costs all unsecured cargo, including newly found gear you equip. Your starting gear stays safe.</li>
              <li>The sealed southern approach opens as the facility evolves. Keep its marked lane clear for machines.</li>
              <li>Higher tiers increase rewards and enemy strength. Watch for event and boss warnings before a wave.</li>
            </ul>
          </details>
          <div className="loadout-line">
            <span>LOADOUT · {gearCount}/{SLOTS.length} SLOTS</span>
            <b style={weapon ? { color: rarity(weapon.rarity).color } : undefined}>{weapon?.name.toUpperCase() ?? 'NO WEAPON'}</b>
          </div>
          {blocker && <div className="deploy-block">{blocker}</div>}
        </div>
        <div className="tier-col">
          <div className="col-label">SELECT THREAT TIER</div>
          <div className="tier-selector" role="group" aria-label="Threat tier">
            {THREAT_TIERS.map(t => {
              const locked = t.id > save.threat.unlocked;
              return <button key={t.id} className={`tier-card ${t.id === selected.id ? 'on' : ''}`} disabled={locked || busy}
                aria-pressed={t.id === selected.id} aria-label={`Tier ${t.roman}, ${t.name}`}
                title={locked ? `${t.name} · ${unlockText(t.id)}` : t.name} onClick={() => flow.selectTier(t.id)}>{t.roman}</button>;
            })}
          </div>
          <TierBrief tier={selected} save={save} />
          <button className="primary deploy" disabled={busy || !!blocker} onClick={deploy}>
            <span>{busy ? 'LAUNCHING…' : `DEPLOY · TIER ${selected.roman}`}</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      )}
    </Shell>
  );
}

function FacilityPlan() {
  return <figure className="facility-plan">
    <svg viewBox="-84 -64 168 128" role="img" aria-label="North-up yard plan. North, east and west lanes converge on the reactor. The southern gate starts sealed.">
      <g transform="scale(1 -1)">
        {ARENA.boxes.filter(box => box.kind !== 'reactor').map(({ min, max, kind }, i) =>
          <rect key={i} className={`plan-${kind}`} x={min[0]} y={min[2]} width={max[0] - min[0]} height={max[2] - min[2]} />)}
        {ARENA.ramps.map((r, i) => <rect key={i} className="plan-ramp" x={r.x0} y={r.z0} width={r.x1 - r.x0} height={r.z1 - r.z0} />)}
        {Object.values(ARENA.routes).map(route => <polyline key={route.gate} className={ARENA.initialGates.includes(route.gate) ? 'plan-lane' : 'plan-sealed'}
          points={route.points.map(p => `${p.x},${p.z}`).join(' ')} />)}
        <circle className="plan-ring" cx={ARENA.reactor.x} cy={ARENA.reactor.z} r={ARENA.reactor.radius + 2} />
        <circle className="plan-core" cx={ARENA.reactor.x} cy={ARENA.reactor.z} r={ARENA.reactor.radius} />
      </g>
      <text x="-77" y="-49">N ↑</text>
    </svg>
    <figcaption><span><i className="open" />Open lane</span><span><i className="sealed" />Sealed lane</span><span><i className="core" />Reactor</span></figcaption>
  </figure>;
}

function TierBrief({ tier, save }: { tier: ThreatTier; save: SaveData }) {
  const record = save.records[String(tier.id)];
  const next = THREAT_TIERS.find(t => t.id === save.threat.unlocked + 1);
  const modifiers = [
    ['Enemy health', multiplier(tier.hpMult)], ['Enemy damage', multiplier(tier.damageMult)],
    ['Movement speed', multiplier(tier.speedMult)], ['Spawn count', multiplier(tier.countMult)],
    ['Salvage', multiplier(tier.salvageMult)], ['Item level', `+${tier.lootLevelBonus}`],
    ['Loot luck', multiplier(tier.lootLuck)], ['Elite rate', multiplier(tier.eliteRate)],
    ['Max elite modifiers', tier.maxMods], ['Bosses from', `Wave ${tier.bossFirstWave}`],
  ];
  return <div className="tier-brief">
    <h3>{tier.name.toLowerCase()}</h3><p>{tier.blurb}</p>
    <div className="tier-facts">
      <div><b>{multiplier(tier.salvageMult)}</b><span>Salvage</span></div>
      <div><b>{tier.bossFirstWave}</b><span>First possible boss wave</span></div>
      <div><b>{record?.bestWave ?? '—'}</b><span>Best wave · {record?.runs ?? 0} runs</span></div>
    </div>
    <details className="field-notes"><summary>Tier modifiers</summary>
      <dl className="tier-modifiers">{modifiers.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </details>
    {next && <p className="next-tier"><strong>Tier {next.roman} · {next.name.toLowerCase()}</strong> {unlockText(next.id)}</p>}
  </div>;
}

// ------------------------------------------------------------------ drone configuration

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

export function useEquipped(save: SaveData): Record<SlotId, ItemInstance | null> {
  return useMemo(() => Object.fromEntries(SLOTS.map((s) => [s.id, equippedItem(save, s.id)])) as Record<SlotId, ItemInstance | null>, [save]);
}

export function LoadoutTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const equipped = useEquipped(save);
  const [msg, setMsg] = useState('');
  const mutate = (op: string, args: unknown[], ok: string, fail: string) => {
    const done = flow.profile.op(op, args).ok;
    setMsg(done ? ok : fail);
    sfx.play(done ? 'equip' : 'buildDeny');
  };
  return (
    <Shell code="DC-02" title="DRONE CONFIGURATION" sub="Warden Mk-I · loadout & calculated statistics" close={close} wide>
      <div className="loadout-grid">
        <div className="slots-col">
          <div className="col-label">EQUIPMENT SLOTS</div>
          {SLOTS.map((slot) => {
            const it = equipped[slot.id];
            const r = it ? rarity(it.rarity) : null;
            return (
              <div key={slot.id} className={`slot ${it ? 'filled' : ''}`} style={r ? { ['--rc' as string]: r.color } : undefined}>
                <span className="slot-label">{slot.label}</span>
                <b>{it ? it.name : 'EMPTY'}</b>
                <em>
                  {it ? `${r!.label.toUpperCase()} · LV ${fmtNum(it.level)} · ${it.affixes.length} affix${it.affixes.length === 1 ? '' : 'es'}` : 'Equip from the storage terminal'}
                  {it && !slot.required && (
                    <button className="mini" onClick={() => mutate('unequipToStorage', [slot.id], 'Moved to storage', 'Storage full')}>
                      UNEQUIP
                    </button>
                  )}
                </em>
              </div>
            );
          })}
          <div className="col-label">SAVED CONFIGURATIONS</div>
          <div className="presets">
            {save.presets.map((p, i) => {
              const n = Object.values(p.slots).filter(Boolean).length;
              const missing = Object.values(p.slots).filter((u) => u && !save.items.some((it) => it.uid === u)).length;
              const active = n > 0 && SLOTS.every((s) => (p.slots[s.id] ?? null) === (save.loadout[s.id] ?? null));
              return (
                <div key={i} className={`preset ${active ? 'on' : ''}`}>
                  <b>{p.name}</b>
                  <em>{n ? `${n} item${n === 1 ? '' : 's'}${missing ? ` · ${missing} missing` : ''}${active ? ' · ACTIVE' : ''}` : 'EMPTY'}</em>
                  <button className="mini" onClick={() => mutate('savePreset', [i], `Saved to ${p.name}`, 'Cannot save')}>
                    SAVE
                  </button>
                  <button className="mini" disabled={!n || active} onClick={() => mutate('loadPreset', [i], `${p.name} equipped`, 'Nothing to change')}>
                    LOAD
                  </button>
                </div>
              );
            })}
          </div>
          {msg && <div className="term-msg">{msg}</div>}
        </div>
        <div className="stats-col">
          <DroneStats equipped={equipped} />
        </div>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ storage

export function saveEntries(save: SaveData): InvEntry[] {
  const out: InvEntry[] = [];
  for (const s of SLOTS) {
    const it = equippedItem(save, s.id);
    if (it) out.push({ item: it, status: 'equipped', equippedIn: s.id });
  }
  for (const it of storedItems(save)) out.push({ item: it, status: 'stored', equippedIn: null });
  return out;
}

export function StorageTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const equipped = useEquipped(save);
  const entries = useMemo(() => saveEntries(save), [save]);
  const used = save.storage.uids.length;
  const over = used > save.storage.capacity;
  const cost = storageExpansionCost(save.storage.expansions);
  const act = (op: string, args: unknown[]) => {
    const ok = flow.profile.op(op, args).ok;
    sfx.play(ok ? 'equip' : 'buildDeny');
  };
  const tx = useTx(flow, 'salvage');
  return (
    <Shell code="ST-03" title="SECURE STORAGE" sub="Persistent equipment · secured at checkpoints" close={close} wide>
      <InventoryView
        entries={entries}
        equipped={equipped}
        actions={{
          canChange: true,
          lockedReason: '',
          equip: (uid, slot) => act('equipFromStorage', [uid, slot ?? null]),
          unequip: (slot) => act('unequipToStorage', [slot]),
          remove: {
            label: (e) => {
              const y = dismantleYield(e.item);
              return `DISMANTLE · +${y.salvage} SALVAGE${y.components ? ` · +${y.components} COMP` : ''}`;
            },
            allowed: (e) => e.status === 'stored' && !e.item.locked,
            run: (uid) => void tx.run('dismantle', 'dismantleItems', [[uid]], (r) => `Dismantled · +${r.salvage} salvage${r.components ? ` · +${r.components} components` : ''}`),
            confirm: 'Dismantle permanently?',
          },
          extra: (e) =>
            e.status === 'stored' || e.status === 'equipped' ? (
              <button className="mini" onClick={() => void tx.run('lock', 'setItemLock', [e.item.uid, !e.item.locked], () => (e.item.locked ? 'Unlocked' : 'Locked: protected from selling and dismantling'))}>
                {e.item.locked ? 'UNLOCK' : 'LOCK'}
              </button>
            ) : null,
        }}
        header={
          <div className="storage-bar">
            <ResourceBar save={save} compact />
            <div className={`cap ${over ? 'over' : ''}`}>
              <span>
                BAYS {used} / {save.storage.capacity} {over && '· OVER CAPACITY: DEPLOYMENT LOCKED'}
              </span>
              <div className="cap-bar">
                <i style={{ width: `${Math.min(100, (used / save.storage.capacity) * 100)}%` }} />
              </div>
            </div>
            <button className="mini expand" disabled={save.resources.salvage < cost} onClick={() => act('expandStorage', [])}>
              +{STORAGE_EXPANSION} BAYS · <CostLine cost={{ salvage: cost }} save={save} />
            </button>
            <RarityLegend />
            <TxMessage msg={tx.msg} />
          </div>
        }
      />
    </Shell>
  );
}

// ------------------------------------------------------------------ workshop

/** M3 module bench (now the MODULES tab of the engineering workshop). */
export function ModuleBench({ flow, selW, setSelW }: { flow: Flow; selW: string | null; setSelW: (uid: string) => void }) {
  const save = useSave(flow);
  const weapons = useMemo(() => sortEntries(saveEntries(save).filter((e) => e.item.category === 'weapon'), 'rarity'), [save]);
  const modules = useMemo(() => sortEntries(saveEntries(save).filter((e) => e.item.category === 'module'), 'rarity'), [save]);
  const [selS, setSelS] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const weapon = weapons.find((e) => e.item.uid === selW)?.item ?? weapons[0]?.item ?? null;
  const socket = weapon && selS < weapon.sockets ? selS : 0;
  const installed = weapon?.socketed[socket] ?? null;
  const hoverModule = modules.find((m) => m.item.uid === hover)?.item ?? null;
  // The preview shows the hovered module already installed (visual + stat preview).
  const shown = weapon && hoverModule && !installed && canInstall(weapon, socket, hoverModule).ok ? withSocket(weapon, socket, hoverModule) : weapon;
  const before = useMemo(() => (weapon ? weaponStatRows(weapon) : []), [weapon]);
  const after = useMemo(() => (shown && shown !== weapon ? weaponStatRows(shown) : null), [shown, weapon]);
  const removal = installed ? removalCost(installed) : 0;

  const run = (op: string, args: unknown[], okText: string, sound: 'install' | 'uninstall') => {
    const r = flow.profile.op(op, args) as EngineeringResult;
    setMsg(r.ok ? { text: `${okText}${r.cost ? ` · −${r.cost} salvage` : ''}`, ok: true } : { text: r.reason, ok: false });
    sfx.play(r.ok ? sound : 'buildDeny');
    if (r.ok) uiEvents.emit('econ', { station: 'workshop', kind: 'module', delta: r.cost ? { salvage: -r.cost } : {} });
    setHover(null);
  };
  // Other owned weapons with a compatible empty socket for the installed module (transfer targets).
  const targets: { w: ItemInstance; i: number }[] = [];
  if (installed) {
    for (const e of weapons) {
      const probe = e.item.uid === weapon!.uid ? withSocket(e.item, socket, null) : e.item;
      for (let i = 0; i < e.item.sockets; i++) if (!(e.item.uid === weapon!.uid && i === socket) && canInstall(probe, i, installed).ok) targets.push({ w: e.item, i });
    }
  }

  return (
    <>
      <div className="eng-grid">
        <div className="eng-col">
          <div className="col-label">OWNED WEAPONS · {weapons.length}</div>
          <div className="inv-list short">
            {weapons.map((e) => (
              <ItemCard
                key={e.item.uid}
                e={e}
                selected={e.item.uid === weapon?.uid}
                onSelect={() => {
                  setSelW(e.item.uid);
                  setSelS(0);
                  setMsg(null);
                }}
              />
            ))}
          </div>
          <div className="faint small">Installing is free · removal and transfer cost salvage</div>
        </div>
        <div className="eng-col eng-center">
          <WeaponViewer item={shown} caption={hoverModule && shown !== weapon ? `PREVIEW · ${hoverModule.name.toUpperCase()} INSTALLED` : undefined} />
          {weapon && (
            <>
              <div className="eng-title" style={{ ['--rc' as string]: rarity(weapon.rarity).color }}>
                <b>{weapon.name}</b>
                <span>
                  {rarity(weapon.rarity).label.toUpperCase()} · LV {fmtNum(weapon.level)} · {weapon.build ? FAMILIES[weapon.build.family].label.toUpperCase() : ''}
                </span>
              </div>
              <div className="sockets">
                {weapon.sockets === 0 && <div className="id-none">This weapon has no module sockets. Uncommon and better weapons have 1–4.</div>}
                {weapon.build?.sockets.map((k, i) => {
                  const m = weapon.socketed[i];
                  return (
                    <button key={i} className={`sock ${i === socket ? 'on' : ''} ${m ? 'filled' : ''}`} style={m ? { ['--rc' as string]: rarity(m.rarity).color } : undefined} onClick={() => setSelS(i)}>
                      <i className={`sock-ico k-${k}`} />
                      <span>{SOCKET_LABEL[k]}</span>
                      <b>{m ? m.name : 'EMPTY'}</b>
                    </button>
                  );
                })}
              </div>
              <table className="cmp-table eng-stats">
                <thead>
                  <tr>
                    <th>WEAPON</th>
                    <th>CURRENT</th>
                    {after && <th>WITH MODULE</th>}
                  </tr>
                </thead>
                <tbody>
                  {before.map((r) => {
                    const a = after?.find((x) => x.key === r.key);
                    const v = a ? (Math.abs(a.value - r.value) < 1e-9 ? 0 : (a.value > r.value) === (r.better === 'higher') ? 1 : -1) : 0;
                    return (
                      <tr key={r.key} className={v > 0 ? 'up' : v < 0 ? 'down' : ''}>
                        <td>{r.label}</td>
                        <td>{r.text}</td>
                        {after && <td>{a ? `${a.text} ${v > 0 ? '▲' : v < 0 ? '▼' : ''}` : '—'}</td>}
                      </tr>
                    );
                  })}
                  {after?.filter((a) => !before.some((b) => b.key === a.key)).map((a) => (
                    <tr key={a.key} className="up">
                      <td>{a.label}</td>
                      <td>—</td>
                      <td>{a.text} ▲</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="eng-col">
          {weapon && weapon.sockets > 0 && installed && (
            <>
              <div className="col-label">INSTALLED · {SOCKET_LABEL[weapon.build!.sockets[socket]]} SOCKET</div>
              <ItemDetail item={installed} />
              <button
                className="mini wide"
                disabled={save.resources.salvage < removal || save.storage.uids.length >= save.storage.capacity}
                onClick={() => run('uninstallModule', [weapon.uid, socket], `${installed.name} returned to storage`, 'uninstall')}
              >
                REMOVE TO STORAGE · {removal} SALVAGE
              </button>
              {save.storage.uids.length >= save.storage.capacity && <div className="faint small">Storage full: free a bay or transfer instead.</div>}
              <div className="col-label">TRANSFER · {removal} SALVAGE</div>
              {targets.length === 0 && <div className="id-none">No other weapon has a free compatible socket.</div>}
              {targets.map((t) => (
                <button key={`${t.w.uid}.${t.i}`} className="mini wide" disabled={save.resources.salvage < removal} onClick={() => run('transferModule', [weapon.uid, socket, t.w.uid, t.i], `Transferred to ${t.w.name}`, 'install')}>
                  → {t.w.name} · {SOCKET_LABEL[t.w.build!.sockets[t.i]]} {t.i + 1}
                </button>
              ))}
            </>
          )}
          {weapon && weapon.sockets > 0 && !installed && (
            <>
              <div className="col-label">
                MODULES FOR THIS {SOCKET_LABEL[weapon.build!.sockets[socket]]} SOCKET · {modules.length} IN STORAGE
              </div>
              {modules.length === 0 && (
                <div className="empty-state small">
                  <b>No modules in storage</b>
                  <p>Enemies drop upgrade modules. Collect them and secure them at a checkpoint.</p>
                </div>
              )}
              <div className="mod-list">
                {modules.map((e) => {
                  const chk = canInstall(weapon, socket, e.item);
                  const def = moduleTypeDef(e.item.module?.type);
                  return (
                    <div
                      key={e.item.uid}
                      className={`mod-row ${chk.ok ? '' : 'bad'}`}
                      style={{ ['--rc' as string]: rarity(e.item.rarity).color }}
                      onMouseEnter={() => setHover(e.item.uid)}
                      onMouseLeave={() => setHover((h) => (h === e.item.uid ? null : h))}
                    >
                      <div>
                        <b>{e.item.name}</b>
                        <span>
                          {rarity(e.item.rarity).label.toUpperCase()} · LV {fmtNum(e.item.level)} · {def ? SOCKET_LABEL[def.socket] : '?'}
                        </span>
                        <small>{[...e.item.base, ...e.item.affixes].map((x) => `${formatModifier(x.stat, x.op, x.value)} ${STAT_DEFS[x.stat].label.toLowerCase()}`).join(' · ')}</small>
                        {!chk.ok && <em>{chk.reason}</em>}
                      </div>
                      <button className="mini" disabled={!chk.ok} onFocus={() => setHover(e.item.uid)} onClick={() => run('installModule', [weapon.uid, socket, e.item.uid], `${e.item.name} installed`, 'install')}>
                        INSTALL
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {weapon && weapon.sockets === 0 && <ItemDetail item={weapon} />}
          {msg && <div className={`term-msg ${msg.ok ? '' : 'bad'}`}>{msg.text}</div>}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ command / records

export function CommandTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const savedAt = flow.profile.store.get().savedAt || save.profile.lastSavedAt;
  const t = save.totals;
  return (
    <Shell code="CC-00" title="COMMAND CONSOLE" sub={`Service record · ${save.profile.callsign}`} close={close} wide>
      <div className="command-grid">
        <div>
          <div className="col-label">SERVICE RECORD</div>
          <div className="stat-grid">
            <Stat k="OPERATIONS" v={String(t.runs)} />
            <Stat k="EXTRACTED AT CHECKPOINT" v={String(t.returned)} />
            <Stat k="REACTOR LOST" v={String(t.defeated)} />
            <Stat k="ABANDONED / INTERRUPTED" v={`${t.abandoned} / ${t.interrupted}`} />
            <Stat k="HOSTILES DESTROYED" v={String(t.kills)} />
            <Stat k="SALVAGE SECURED (TOTAL)" v={String(t.salvageSecured)} />
            <Stat k="BOSSES · ELITES DESTROYED" v={`${t.bossesDefeated} · ${t.elitesDefeated}`} />
            <Stat k="HIGHEST THREAT TIER UNLOCKED" v={THREAT_TIERS[save.threat.unlocked - 1]?.roman ?? 'I'} />
          </div>
          <WardenProgress flow={flow} />
          <div className="col-label">MILESTONES · {save.milestones.length}/{MILESTONES.length}</div>
          <div className="milestones" data-testid="milestones">
            {MILESTONES.map((m) => (
              <span key={m.id} className={`ms ${save.milestones.includes(m.id) ? 'on' : ''}`} title={m.label}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="col-label">SURVIVAL RECORDS</div>
          <table className="rec-table">
            <thead>
              <tr>
                <th>TIER</th>
                <th>BEST WAVE</th>
                <th>REACHED</th>
                <th>BOSSES</th>
                <th>ELITES</th>
                <th>RUNS</th>
                <th>LONGEST</th>
              </tr>
            </thead>
            <tbody>
              {THREAT_TIERS.map((tier) => {
                const r = save.records[String(tier.id)];
                const locked = tier.id > save.threat.unlocked;
                return (
                  <tr key={tier.id} className={locked ? 'locked' : ''}>
                    <td>
                      {tier.roman} · {tier.name}
                    </td>
                    <td className="hi">{locked ? 'LOCKED' : (r?.bestWave ?? 0)}</td>
                    <td>{r?.highestWave ?? 0}</td>
                    <td>{r ? `${r.bossesDefeated}${r.bestBossesRun > 1 ? ` (best ${r.bestBossesRun})` : ''}` : 0}</td>
                    <td>{r?.elitesDefeated ?? 0}</td>
                    <td>{r?.runs ?? 0}</td>
                    <td>{r ? fmtTime(r.longestRun) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <StationDirectory flow={flow} close={close} />
          <div className="col-label">RECENT OPERATIONS</div>
          {save.history.length === 0 ? (
            <div className="empty-state small">
              <b>No operations on record</b>
              <p>Use the deployment terminal in the launch bay to begin.</p>
            </div>
          ) : (
            <div className="history">
              {save.history.map((h) => (
                <div key={h.id} className={`hist ${h.outcome}`}>
                  <span className="h-out">{h.outcome === 'returned' ? 'EXTRACTED' : h.outcome === 'defeat' ? 'REACTOR LOST' : h.outcome.toUpperCase()}</span>
                  <span>T{THREAT_TIERS[h.tier - 1]?.roman}</span>
                  <span>W{h.finalWave}</span>
                  <span>{h.kills} kills</span>
                  {h.bosses.length > 0 && <span className="boss">{h.bosses.length} boss{h.bosses.length > 1 ? 'es' : ''}</span>}
                  {h.elites > 0 && <span>{h.elites} elites</span>}
                  <span className="o">+{h.salvageSecured}</span>
                  {h.salvageLost > 0 && <span className="r">−{h.salvageLost}</span>}
                  {(h.newRecord || h.records.length > 0) && <span className="rec">RECORD</span>}
                  {h.dev && <span className="dev">DEV</span>}
                </div>
              ))}
            </div>
          )}
          <div className="save-status">
            PROFILE SAVED LOCALLY · {savedAt ? new Date(savedAt).toLocaleTimeString() : '—'}
            {flow.profile.store.get().lastWriteOk ? '' : ' · WRITE FAILED (storage unavailable)'}
          </div>
        </div>
      </div>
    </Shell>
  );
}
