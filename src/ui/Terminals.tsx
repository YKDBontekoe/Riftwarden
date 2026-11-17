import { type ReactNode, useEffect, useState } from 'react';
import { BASE_STATS } from '../combat/stats';
import type { Flow } from '../core/Flow';
import { ECONOMY } from '../data/defs';
import type { HomeBase } from '../home/HomeBase';
import { MOVE } from '../player/Player';
import { type ItemInstance, itemDef, SLOTS } from '../progression/items';
import { equipFromStorage, equippedItem, type SaveData, storedItems } from '../progression/save';
import { CHECKPOINT_INTERVAL, THREAT_TIERS, type ThreatTier } from '../progression/tiers';
import { fmtTime, useSave } from './App';
import { useHud } from './store';

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
  const weapon = itemDef(equippedItem(save, 'weapon'));
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
              Salvage from kills and cleared waves is <b className="o">unsecured</b> until a checkpoint.
            </li>
            <li>
              Every <b>{CHECKPOINT_INTERVAL} waves</b> it is <b className="c">banked</b> to HQ and you may return home.
            </li>
            <li>Reactor loss forfeits unsecured salvage. Secured salvage and equipped gear are never lost.</li>
          </ul>
          <div className="loadout-line">
            <span>LOADOUT</span>
            <b>{weapon?.name.toUpperCase() ?? 'NO WEAPON'}</b>
          </div>
        </div>
        <div className="tier-col">
          <div className="col-label">SELECT THREAT TIER</div>
          {THREAT_TIERS.map((t) => (
            <TierCard key={t.id} tier={t} save={save} selected={t.id === selected.id} onSelect={() => flow.selectTier(t.id)} />
          ))}
          <button className="primary deploy" disabled={busy || !weapon} onClick={deploy}>
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
      </div>
    </button>
  );
}

// ------------------------------------------------------------------ drone configuration

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

function LoadoutTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const weaponItem = equippedItem(save, 'weapon');
  const w = itemDef(weaponItem)?.weapon;
  const compatible = storedItems(save).filter((i) => itemDef(i)?.slot === 'weapon');
  return (
    <Shell code="DC-02" title="DRONE CONFIGURATION" sub="Warden Mk-I · current loadout" close={close} wide>
      <div className="loadout-grid">
        <div className="slots-col">
          <div className="col-label">EQUIPMENT SLOTS</div>
          {SLOTS.map((slot) => {
            const it = equippedItem(save, slot.id);
            const d = itemDef(it);
            return (
              <div key={slot.id} className={`slot ${d ? 'filled' : ''} ${slot.functional ? '' : 'offline'}`}>
                <span className="slot-label">{slot.label}</span>
                <b>{d ? d.name.toUpperCase() : 'EMPTY'}</b>
                <em>{d ? (slot.required ? 'EQUIPPED · REQUIRED' : 'EQUIPPED') : slot.functional ? 'NO ITEM' : 'NO COMPATIBLE EQUIPMENT'}</em>
              </div>
            );
          })}
        </div>
        <div className="stats-col">
          {w && (
            <>
              <div className="col-label">PRIMARY · {w.name}</div>
              <p className="desc">{itemDef(weaponItem)?.description}</p>
              <div className="stat-grid">
                <Stat k="DAMAGE / SHOT" v={String(w.damage)} />
                <Stat k="FIRE RATE" v={`${w.fireRate}/s`} />
                <Stat k="SUSTAINED DPS" v={String(Math.round(w.damage * w.fireRate))} />
                <Stat k="RANGE" v={`${w.range} m`} />
                <Stat k="HEAT / SHOT" v={`${w.heatPerShot}%`} />
                <Stat k="SHOTS TO OVERHEAT" v={String(Math.ceil(100 / w.heatPerShot))} />
                <Stat k="CRIT CHANCE" v={`${Math.round(BASE_STATS.critChance * 100)}% · weakpoints 100%`} />
                <Stat k="CRIT DAMAGE" v={`×${BASE_STATS.critMultiplier}`} />
              </div>
            </>
          )}
          <div className="col-label">DRONE</div>
          <div className="stat-grid">
            <Stat k="HULL INTEGRITY" v={String(ECONOMY.playerMaxHp + BASE_STATS.maxHealthBonus)} />
            <Stat k="SELF-REPAIR" v="18/s after 4 s" />
            <Stat k="SPEED · SPRINT" v={`${MOVE.runSpeed} · ${MOVE.sprintSpeed} m/s`} />
            <Stat k="DASH" v={`${MOVE.dashCharges} charges · ${MOVE.dashRecharge}s`} />
            <Stat k="AIR BOOST" v="1 per jump" />
            <Stat k="REBOOT AFTER LOSS" v={`${ECONOMY.playerRespawnTime} s`} />
          </div>
          {compatible.length > 0 && (
            <>
              <div className="col-label">IN STORAGE · COMPATIBLE</div>
              {compatible.map((it) => (
                <ItemRow key={it.uid} item={it} action="EQUIP" onAction={() => flow.profile.mutate((d) => equipFromStorage(d, it.uid))} />
              ))}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

function ItemRow({ item, action, onAction }: { item: ItemInstance; action?: string; onAction?: () => void }) {
  const d = itemDef(item);
  return (
    <div className="item-row">
      <span className="item-ico">◆</span>
      <div>
        <b>{d?.name ?? item.defId}</b>
        <em>{d ? d.slot.toUpperCase() : 'UNKNOWN ITEM'} · from {item.source === 'starter' ? 'starter kit' : 'operation'}</em>
      </div>
      {action && d && <button onClick={onAction}>{action}</button>}
    </div>
  );
}

// ------------------------------------------------------------------ storage

function StorageTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const items = storedItems(save);
  return (
    <Shell code="ST-03" title="SECURE STORAGE" sub="Persistent equipment & resources" close={close} wide>
      <div className="storage-grid">
        <div>
          <div className="col-label">RESOURCES</div>
          <div className="resource">
            <span className="res-ico">⬢</span>
            <div>
              <b>{save.resources.salvage}</b>
              <span>SALVAGE · secured at checkpoints</span>
            </div>
          </div>
          <div className="col-label">
            EQUIPMENT BAYS · {items.length} / {save.storage.capacity}
          </div>
          <div className="bays">
            {Array.from({ length: save.storage.capacity }, (_, i) => (
              <div key={i} className={`bay ${items[i] ? 'full' : ''}`} title={items[i] ? itemDef(items[i])?.name : ''} />
            ))}
          </div>
        </div>
        <div>
          <div className="col-label">STORED EQUIPMENT</div>
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-ico">∅</div>
              <b>No equipment in storage</b>
              <p>Equipment recovered during operations is stored here once it has been secured at a checkpoint. Gear you have equipped is listed at the drone configuration station.</p>
            </div>
          ) : (
            items.map((it) => (
              <ItemRow
                key={it.uid}
                item={it}
                action={itemDef(it) && SLOTS.find((s) => s.id === itemDef(it)!.slot)?.functional ? 'EQUIP' : undefined}
                onAction={() => flow.profile.mutate((d) => equipFromStorage(d, it.uid))}
              />
            ))
          )}
        </div>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ workshop

function WorkshopTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  return (
    <Shell code="WS-04" title="WORKSHOP" sub="Fabrication bench · standby" close={close} accent="amber">
      <div className="workshop-body">
        <div className="offline-badge">FABRICATOR OFFLINE · NO SCHEMATICS ON FILE</div>
        <p>
          This bench will handle weapon engineering, module installation and fabrication. It needs recovered equipment schematics before it can do any of that, and none have been recovered yet.
        </p>
        <div className="resource">
          <span className="res-ico">⬢</span>
          <div>
            <b>{save.resources.salvage}</b>
            <span>SALVAGE IN RESERVE · held for fabrication</span>
          </div>
        </div>
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
