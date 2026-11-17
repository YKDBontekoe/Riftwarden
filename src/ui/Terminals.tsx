import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { sfx } from '../audio/Sfx';
import { BASE_STATS, computeStats, fmtNum, formatStat, maxHull, mitigation, STAT_DEFS } from '../combat/stats';
import type { Flow } from '../core/Flow';
import { ECONOMY, SENTINEL, towerCost } from '../data/defs';
import type { HomeBase } from '../home/HomeBase';
import { scrapValue, STORAGE_EXPANSION, storageExpansionCost } from '../loot/economy';
import { equipmentModifiers, weaponDefFor, weaponSummary } from '../loot/equipment';
import { rarity } from '../loot/rarity';
import { MOVE } from '../player/Player';
import { type ItemInstance, type SlotId, SLOTS } from '../progression/items';
import {
  deployBlocker,
  equipFromStorage,
  equippedItem,
  expandStorage,
  loadPreset,
  type SaveData,
  savePreset,
  scrapItem,
  storedItems,
  unequipToStorage,
} from '../progression/save';
import { CHECKPOINT_INTERVAL, THREAT_TIERS, type ThreatTier } from '../progression/tiers';
import { fmtTime, useSave } from './App';
import { useHud } from './store';
import { type InvEntry, InventoryView, ItemCard, ItemDetail, RarityLegend, sortEntries } from './items';

/** Routes the open station to its interface. */
export function TerminalHost({ flow, home }: { flow: Flow; home: HomeBase }) {
  const id = useHud((s) => s.terminal);
  const close = () => void home.closeTerminal();
  switch (id) {
    case 'deploy':
      return <DeployTerminal flow={flow} close={close} />;
    case 'loadout':
      return <LoadoutTerminal flow={flow} close={close} />;
    case 'storage':
      return <StorageTerminal flow={flow} close={close} />;
    case 'workshop':
      return <WorkshopTerminal flow={flow} close={close} />;
    case 'command':
      return <CommandTerminal flow={flow} close={close} />;
    default:
      return null;
  }
}

function Shell({ code, title, sub, close, children, accent = 'cyan', wide }: { code: string; title: string; sub: string; close: () => void; children: ReactNode; accent?: 'cyan' | 'amber'; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyE') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="screen terminal-screen">
      <div className={`terminal panel-frame ${accent} ${wide ? 'wide' : ''}`}>
        <div className="term-head">
          <div className="term-code">{code}</div>
          <div className="term-titles">
            <div className="term-title">{title}</div>
            <div className="term-sub">{sub}</div>
          </div>
          <button className="term-close" onClick={close}>
            <kbd>E</kbd>/<kbd>ESC</kbd> CLOSE
          </button>
        </div>
        <div className="term-body">{children}</div>
      </div>
    </div>
  );
}

const pct = (m: number) => (m === 1 ? '—' : `×${m.toFixed(2)}`);

// ------------------------------------------------------------------ deployment

function DeployTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const [busy, setBusy] = useState(false);
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
      <div className="deploy-grid">
        <div className="arena-card">
          <div className="arena-art">
            <svg viewBox="0 0 200 120" className="arena-map">
              <rect x="20" y="10" width="160" height="100" className="wall" />
              <path d="M100 10 V40 M180 60 H140 M20 60 H60" className="lane" />
              <path d="M100 40 L100 52 M140 60 L112 60 M60 60 L88 60" className="lane" />
              <circle cx="100" cy="60" r="9" className="core" />
              <circle cx="100" cy="60" r="16" className="ring" />
              <rect x="64" y="84" width="22" height="12" className="plat" />
              <rect x="114" y="84" width="22" height="12" className="plat" />
            </svg>
          </div>
          <div className="arena-name">SECTOR 07 · REACTOR DEFENSE</div>
          <p>Hold the reactor against endless machine waves arriving through three rift gates. Build Sentinel turrets beside the orange lanes.</p>
          <ul className="rules">
            <li>
              Enemies drop <b>equipment</b>. Collected loot and salvage are <b className="o">unsecured</b> until a checkpoint.
            </li>
            <li>
              Every <b>{CHECKPOINT_INTERVAL} waves</b> everything collected is <b className="c">banked</b> to HQ storage, plus a checkpoint cache, and you may return home.
            </li>
            <li>Reactor loss forfeits unsecured loot, even if equipped. Gear you deploy with and secured items are never lost.</li>
            <li>Higher threat tiers raise item levels and rarity odds.</li>
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
      <div className="tc-blurb">{locked ? `Secure a wave-${CHECKPOINT_INTERVAL} checkpoint on Tier ${THREAT_TIERS[tier.id - 2]?.roman} to unlock.` : tier.blurb}</div>
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

function useEquipped(save: SaveData): Record<SlotId, ItemInstance | null> {
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

function LoadoutTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const equipped = useEquipped(save);
  const [msg, setMsg] = useState('');
  const mutate = (fn: (d: SaveData) => boolean, ok: string, fail: string) => {
    const done = flow.profile.mutate(fn);
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
                    <button className="mini" onClick={() => mutate((d) => unequipToStorage(d, slot.id), 'Moved to storage', 'Storage full')}>
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
                  <button className="mini" onClick={() => mutate((d) => savePreset(d, i), `Saved to ${p.name}`, 'Cannot save')}>
                    SAVE
                  </button>
                  <button className="mini" disabled={!n || active} onClick={() => mutate((d) => loadPreset(d, i), `${p.name} equipped`, 'Nothing to change')}>
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

function StorageTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const equipped = useEquipped(save);
  const entries = useMemo(() => saveEntries(save), [save]);
  const used = save.storage.uids.length;
  const over = used > save.storage.capacity;
  const cost = storageExpansionCost(save.storage.expansions);
  const act = (fn: (d: SaveData) => boolean | number) => {
    const ok = flow.profile.mutate((d) => !!fn(d));
    sfx.play(ok ? 'equip' : 'buildDeny');
  };
  return (
    <Shell code="ST-03" title="SECURE STORAGE" sub="Persistent equipment · secured at checkpoints" close={close} wide>
      <InventoryView
        entries={entries}
        equipped={equipped}
        actions={{
          canChange: true,
          lockedReason: '',
          equip: (uid, slot) => act((d) => equipFromStorage(d, uid, slot)),
          unequip: (slot) => act((d) => unequipToStorage(d, slot)),
          remove: {
            label: (e) => `SCRAP · +${scrapValue(e.item)} SALVAGE`,
            allowed: (e) => e.status === 'stored',
            run: (uid) => act((d) => scrapItem(d, uid)),
            confirm: 'Dismantle permanently?',
          },
        }}
        header={
          <div className="storage-bar">
            <div className="resource small">
              <span className="res-ico">⬢</span>
              <div>
                <b>{save.resources.salvage}</b>
                <span>SALVAGE</span>
              </div>
            </div>
            <div className={`cap ${over ? 'over' : ''}`}>
              <span>
                BAYS {used} / {save.storage.capacity} {over && '· OVER CAPACITY: DEPLOYMENT LOCKED'}
              </span>
              <div className="cap-bar">
                <i style={{ width: `${Math.min(100, (used / save.storage.capacity) * 100)}%` }} />
              </div>
            </div>
            <button className="mini expand" disabled={save.resources.salvage < cost} onClick={() => act((d) => expandStorage(d))}>
              +{STORAGE_EXPANSION} BAYS · {cost} SALVAGE
            </button>
            <RarityLegend />
          </div>
        }
      />
    </Shell>
  );
}

// ------------------------------------------------------------------ workshop

function WorkshopTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const modules = useMemo(() => sortEntries(saveEntries(save).filter((e) => e.item.category === 'module'), 'rarity'), [save]);
  const [sel, setSel] = useState<string | null>(null);
  const cur = modules.find((m) => m.item.uid === sel) ?? modules[0] ?? null;
  const socketed = SLOTS.map((s) => equippedItem(save, s.id)).filter((i): i is ItemInstance => !!i);
  return (
    <Shell code="WS-04" title="WORKSHOP" sub="Engineering bench · module archive" close={close} accent="amber" wide>
      <div className="workshop-grid">
        <div>
          <div className="offline-badge">MODULE INSTALLATION OFFLINE · ENGINEERING NOT YET AVAILABLE</div>
          <p>Upgrade modules recovered in the field are archived here. They cannot be installed yet, so they have no effect on your drone. Their rolls are kept exactly as found.</p>
          <div className="col-label">MODULE ARCHIVE · {modules.length}</div>
          {modules.length === 0 ? (
            <div className="empty-state small">
              <b>No modules recovered</b>
              <p>Enemies occasionally drop upgrade modules. Collect them and secure them at a checkpoint.</p>
            </div>
          ) : (
            <div className="inv-list short">
              {modules.map((e) => (
                <ItemCard key={e.item.uid} e={e} selected={e.item.uid === cur?.item.uid} onSelect={() => setSel(e.item.uid)} />
              ))}
            </div>
          )}
          <div className="col-label">SOCKETS ON EQUIPPED GEAR</div>
          <div className="socket-list">
            {socketed.map((it) => (
              <div key={it.uid} className="socket-row" style={{ ['--rc' as string]: rarity(it.rarity).color }}>
                <b>{it.name}</b>
                <span>
                  {Array.from({ length: Math.max(1, it.sockets) }, (_, i) => (
                    <i key={i} className={i < it.sockets ? 'free' : 'none'} />
                  ))}
                  {it.sockets} SOCKET{it.sockets === 1 ? '' : 'S'}
                </span>
              </div>
            ))}
          </div>
          <div className="resource">
            <span className="res-ico">⬢</span>
            <div>
              <b>{save.resources.salvage}</b>
              <span>SALVAGE IN RESERVE</span>
            </div>
          </div>
        </div>
        <div>{cur ? <ItemDetail item={cur.item} status="stored" /> : null}</div>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ command / records

function CommandTerminal({ flow, close }: { flow: Flow; close: () => void }) {
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
          </div>
          <div className="col-label">SURVIVAL RECORDS</div>
          <table className="rec-table">
            <thead>
              <tr>
                <th>TIER</th>
                <th>BEST WAVE</th>
                <th>RUNS</th>
                <th>CHECKPOINTS</th>
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
                    <td>{locked ? 'LOCKED' : (r?.bestWave ?? 0)}</td>
                    <td>{r?.runs ?? 0}</td>
                    <td>{r?.checkpoints ?? 0}</td>
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
                  <span className="o">+{h.salvageSecured}</span>
                  {h.salvageLost > 0 && <span className="r">−{h.salvageLost}</span>}
                  {h.newRecord && <span className="rec">RECORD</span>}
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
