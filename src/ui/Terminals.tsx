import { useMemo, useState } from 'react';
import { sfx } from '../audio/Sfx';
import { BASE_STATS, computeStats, fmtNum, formatModifier, formatStat, maxHull, mitigation, STAT_DEFS } from '../combat/stats';
import type { Flow } from '../core/Flow';
import { ECONOMY, SENTINEL, towerCost } from '../data/defs';
import { STORAGE_EXPANSION, storageExpansionCost } from '../loot/economy';
import { equipmentModifiers, weaponDefFor, weaponStatRows, weaponSummary, withSocket } from '../loot/equipment';
import { FAMILIES, SOCKET_LABEL } from '../weapons/build';
import { canInstall, moduleTypeDef, removalCost } from '../weapons/modules';
import { WeaponViewer } from './WeaponViewer';
import { rarity } from '../loot/rarity';
import { MOVE } from '../player/Player';
import { type ItemInstance, type SlotId, SLOTS } from '../progression/items';
import {
  deployBlocker,
  type EngineeringResult,
  equippedItem,
  type SaveData,
  storedItems,
} from '../progression/save';
import { CHECKPOINT_INTERVAL, THREAT_TIERS, type ThreatTier, unlockText } from '../progression/tiers';
import { MILESTONES } from '../survival/records';
import { fmtTime, useSave } from './App';
import { Shell } from './shell';
import { CoopPanel } from './Coop';
import { ResourceBar, useTx, TxMessage, CostLine } from './economy';
import { dismantleYield } from '../economy/config';
import { uiEvents } from './store';
import { type InvEntry, InventoryView, ItemCard, ItemDetail, RarityLegend, sortEntries } from './items';

const pct = (m: number) => (m === 1 ? '—' : `×${m.toFixed(2)}`);

// ------------------------------------------------------------------ deployment

export function DeployTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'solo' | 'coop'>(flow.profile.online || flow.net ? 'coop' : 'solo');
  const selected = THREAT_TIERS.find((t) => t.id === save.threat.selected) ?? THREAT_TIERS[0];
  const weapon = equippedItem(save, 'weapon');
  const blocker = deployBlocker(save);
  const gearCount = SLOTS.filter((s) => save.loadout[s.id]).length;
  const deploy = () => {
    if (busy) return;
    setBusy(true);
    void flow.deploy(selected.id).then((ok) => {
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
      ) : flow.profile.online ? (
        <div className="deploy-block">Your online profile is active. Online operations are deployed through the co-op lobby; disconnect from the co-op server to play solo with your local profile.</div>
      ) : (
      <div className="deploy-grid">
        <div className="arena-card">
          <div className="arena-art">
            <svg viewBox="0 0 200 120" className="arena-map">
              <rect x="20" y="10" width="160" height="100" className="wall" />
              <path d="M100 10 V40 M180 60 H140 M20 60 H60" className="lane" />
              <path d="M100 40 L100 52 M140 60 L112 60 M60 60 L88 60" className="lane" />
              <path d="M100 110 V82 L112 75 L112 66 L104 64" className="lane sealed" />
              <circle cx="100" cy="60" r="9" className="core" />
              <circle cx="100" cy="60" r="16" className="ring" />
              <rect x="64" y="84" width="22" height="12" className="plat" />
              <rect x="114" y="84" width="22" height="12" className="plat" />
            </svg>
          </div>
          <div className="arena-name">SECTOR 07 · REACTOR DEFENSE</div>
          <p>Hold the reactor against endless machine waves arriving through three rift gates (a sealed fourth gate opens as the facility evolves). Build turrets beside the orange lanes; the grey reserved corridor stays free for the future route.</p>
          <ul className="rules">
            <li>
              Enemies drop <b>equipment</b>. Collected loot and salvage are <b className="o">unsecured</b> until a checkpoint.
            </li>
            <li>
              Every <b>{CHECKPOINT_INTERVAL} waves</b> everything collected is <b className="c">banked</b> to HQ storage, plus a checkpoint cache, and you may return home.
            </li>
            <li>Reactor loss forfeits unsecured loot, even if equipped. Gear you deploy with and secured items are never lost.</li>
            <li>Higher threat tiers raise item levels and rarity odds, elite frequency, events and boss power.</li>
            <li>The facility evolves during a run: new access routes open and containment machinery activates. Bosses and events are announced before their wave.</li>
          </ul>
          <div className="loadout-line">
            <span>LOADOUT · {gearCount}/{SLOTS.length} SLOTS</span>
            <b style={weapon ? { color: rarity(weapon.rarity).color } : undefined}>{weapon?.name.toUpperCase() ?? 'NO WEAPON'}</b>
          </div>
          {blocker && <div className="deploy-block">{blocker}</div>}
        </div>
        <div className="tier-col">
          <div className="col-label">SELECT THREAT TIER</div>
          {THREAT_TIERS.map((t) => (
            <TierCard key={t.id} tier={t} save={save} selected={t.id === selected.id} onSelect={() => flow.selectTier(t.id)} />
          ))}
          <button className="primary deploy" disabled={busy || !!blocker} onClick={deploy}>
            <span>{busy ? 'LAUNCHING…' : `DEPLOY · TIER ${selected.roman}`}</span>
            <i>▶</i>
          </button>
        </div>
      </div>
      )}
    </Shell>
  );
}

function TierCard({ tier, save, selected, onSelect }: { tier: ThreatTier; save: SaveData; selected: boolean; onSelect: () => void }) {
  const locked = tier.id > save.threat.unlocked;
  const rec = save.records[String(tier.id)];
  return (
    <button className={`tier-card ${selected ? 'on' : ''} ${locked ? 'locked' : ''}`} disabled={locked} onClick={onSelect}>
      <div className="tc-head">
        <span className="tc-roman">{tier.roman}</span>
        <span className="tc-name">{tier.name}</span>
        <span className="tc-rec">{locked ? 'LOCKED' : rec ? `BEST WAVE ${rec.bestWave} · ${rec.runs} RUN${rec.runs === 1 ? '' : 'S'}` : 'NO RECORD'}</span>
      </div>
      <div className="tc-blurb">{locked ? unlockText(tier.id) : tier.blurb}</div>
      <div className="tc-mods">
        <span>
          HP <b>{pct(tier.hpMult)}</b>
        </span>
        <span>
          DMG <b>{pct(tier.damageMult)}</b>
        </span>
        <span>
          SPEED <b>{pct(tier.speedMult)}</b>
        </span>
        <span>
          COUNT <b>{pct(tier.countMult)}</b>
        </span>
        <span className="o">
          SALVAGE <b>{pct(tier.salvageMult)}</b>
        </span>
        <span className="c">
          ITEM LV <b>+{tier.lootLevelBonus}</b>
        </span>
        <span className="c">
          LOOT LUCK <b>{pct(tier.lootLuck)}</b>
        </span>
        <span className="v">
          ELITES <b>{pct(tier.eliteRate)}</b>
        </span>
        <span className="v">
          MODS ≤ <b>{tier.maxMods}</b>
        </span>
        <span className="v">
          BOSSES FROM W<b>{tier.bossFirstWave}</b>
        </span>
      </div>
    </button>
  );
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

/** Calculated drone statistics from the real stat pipeline. */
function DroneStats({ equipped }: { equipped: Record<SlotId, ItemInstance | null> }) {
  const items = Object.values(equipped).filter((i): i is ItemInstance => !!i);
  const st = computeStats(equipmentModifiers(items));
  const w = weaponDefFor(equipped.weapon);
  const ws = w ? weaponSummary(w, st) : null;
  const b = BASE_STATS;
  const d = (k: keyof typeof st): 'up' | 'down' | undefined => {
    const def = STAT_DEFS[k];
    if (Math.abs(st[k] - b[k]) < 1e-9) return undefined;
    return (st[k] > b[k]) === (def.better === 'higher') ? 'up' : 'down';
  };
  return (
    <>
      {w && ws && (
        <>
          <div className="col-label">PRIMARY · {w.name}</div>
          <div className="stat-grid">
            <Stat k="DAMAGE / SHOT" v={fmtNum(ws.damage)} tone={d('weaponDamageMult')} />
            <Stat k="FIRE RATE" v={`${fmtNum(ws.rate)}/s`} tone={d('fireRateMult')} />
            <Stat k="EXPECTED DPS (CRITS)" v={fmtNum(ws.dps)} />
            <Stat k="RANGE" v={`${w.range} m`} />
            <Stat k="HEAT / SHOT" v={`${fmtNum(ws.heat)}%`} tone={d('heatEfficiency')} />
            <Stat k="SHOTS TO OVERHEAT" v={String(ws.shotsToOverheat)} tone={d('heatEfficiency')} />
            <Stat k="COOLING" v={`${fmtNum(ws.cool)}%/s`} tone={d('coolRateMult')} />
            <Stat k="CRIT CHANCE" v={`${formatStat('critChance', st.critChance)} · weakpoints 100%`} tone={d('critChance')} />
            <Stat k="CRIT DAMAGE" v={formatStat('critMultiplier', st.critMultiplier)} tone={d('critMultiplier')} />
          </div>
        </>
      )}
      <div className="col-label">DRONE</div>
      <div className="stat-grid">
        <Stat k="HULL INTEGRITY" v={fmtNum(maxHull(ECONOMY.playerMaxHp, st))} tone={st.maxHealthBonus !== 0 || st.maxHealthMult !== 1 ? 'up' : undefined} />
        <Stat k="SELF-REPAIR" v="18/s after 4 s" />
        <Stat k="SHIELD" v={st.shieldCapacity > 0 ? `${fmtNum(st.shieldCapacity)} · +${fmtNum(st.shieldRegen)}/s` : 'NONE'} tone={d('shieldCapacity')} />
        <Stat k="SHIELD DELAY" v={st.shieldCapacity > 0 ? formatStat('shieldDelay', st.shieldDelay) : '—'} tone={st.shieldCapacity > 0 ? d('shieldDelay') : undefined} />
        <Stat k="ARMOR · RESIST" v={`${fmtNum(st.armor)} · ${formatStat('damageResist', st.damageResist)}`} tone={d('armor') ?? d('damageResist')} />
        <Stat k="DAMAGE REDUCTION (W1)" v={`${fmtNum(mitigation(st) * 100)}%`} />
        <Stat k="SPEED · SPRINT" v={`${fmtNum(MOVE.runSpeed * st.moveSpeedMult)} · ${fmtNum(MOVE.sprintSpeed * st.moveSpeedMult)} m/s`} tone={d('moveSpeedMult')} />
        <Stat k="DASH RECHARGE" v={`${MOVE.dashCharges} × ${fmtNum(MOVE.dashRecharge / st.dashRechargeMult)} s`} tone={d('dashRechargeMult')} />
      </div>
      <div className="col-label">DEFENSES & TACTICAL</div>
      <div className="stat-grid">
        <Stat k="TURRET DAMAGE" v={formatStat('turretDamageMult', st.turretDamageMult)} tone={d('turretDamageMult')} />
        <Stat k="TURRET FIRE RATE" v={formatStat('turretFireRateMult', st.turretFireRateMult)} tone={d('turretFireRateMult')} />
        <Stat k="TURRET RANGE" v={`${fmtNum(SENTINEL.range * st.turretRangeMult)} m`} tone={d('turretRangeMult')} />
        <Stat k="SENTINEL COST" v={`${towerCost(SENTINEL, st.buildCostMult)} cores`} tone={d('buildCostMult')} />
        <Stat k="TACTICAL RECHARGE" v={formatStat('tacticalRechargeMult', st.tacticalRechargeMult)} tone={d('tacticalRechargeMult')} />
      </div>
    </>
  );
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
