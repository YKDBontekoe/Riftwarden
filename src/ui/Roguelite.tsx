import { useEffect, useState } from 'react';
import type { Game } from '../core/Game';
import { STAT_DEFS } from '../combat/stats';
import { CATEGORY_LABEL, RARITY_COLOR, upgradeDef } from '../roguelite/upgrades';
import { BASES, CORES, MAX_TOWER_LEVEL, MODIFIERS, partDef, partsFor, swapCost, TOWER_SLOTS, type TowerConfig, type TowerSlot, WEAPONS } from '../towers/components';
import { ELEMENT_COLOR_CSS } from './elements';
import { BoundKey } from './hud/widgets';
import { useHud } from './store';

const SLOT_LABEL: Record<TowerSlot, string> = { base: 'BASE', weapon: 'WEAPON MODULE', core: 'POWER CORE', modifier: 'MODIFIER' };

function useForce() {
  const [, set] = useState(0);
  return () => set((n) => n + 1);
}

// ------------------------------------------------------------------ upgrade selection

export function UpgradePanel({ game }: { game: Game }) {
  const offer = game.offer ?? [];
  const build = game.director.build;
  const coop = useHud((s) => s.coop);
  const waiting = coop?.offerChooser;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (!e.repeat && !waiting && i >= 0 && game.offer?.[i]) {
        e.preventDefault();
        game.chooseUpgrade(game.offer[i].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, waiting]);
  return (
    <div className="screen dim upgrade-screen" data-testid="upgrade-panel">
      <div className="upgrade-wrap">
        <div className="cp-kicker">WAVE {game.waves.number - 1} CLEARED · RIFT UPGRADE</div>
        <div className="cp-title">{waiting ? `${waiting.toUpperCase()} IS CHOOSING` : coop ? 'Choose a team upgrade' : 'Choose an upgrade'}</div>
        {coop && (
          <div className="cp-sub">
            {waiting ? 'Team upgrades are picked in turn; this one applies to every warden.' : 'Your turn: this upgrade applies to the whole team.'} · {coop.offerLeft} s
            <button className="mini" style={{ marginLeft: 12 }} onClick={() => void game.closePanel?.()}>
              BACK TO THE ARENA
            </button>
          </div>
        )}
        <div className="cp-sub">Upgrades last for this operation.{!coop && ' The next wave waits for your choice.'}</div>
        <div className="upgrade-cards">
          {offer.map((u, i) => {
            const have = build.count(u.id);
            const color = RARITY_COLOR[u.rarity];
            return (
              <button key={u.id} data-testid={`upgrade-card-${i}`} data-id={u.id} className="ucard" disabled={!!waiting} style={{ ['--rc' as string]: color, animationDelay: `${i * 0.09}s` }} onClick={() => game.chooseUpgrade(u.id)}>
                <div className="uc-top">
                  <span className="uc-rarity">{u.rarity.toUpperCase()}</span>
                  <span className="uc-key">{i + 1}</span>
                </div>
                <span aria-hidden="true" className={`uc-art art-${u.category}`} />
                <div className="uc-name">{u.name}</div>
                <div className="uc-cat">{CATEGORY_LABEL[u.category]}{u.needs?.towers ? ' · TOWERS' : ''}</div>
                <div className="uc-text">{u.text(have + 1)}</div>
                {u.hint && <div className="uc-hint">{u.hint}</div>}
                <div className="uc-stack">{have > 0 ? `STACK ${have} → ${have + 1} / ${u.maxStacks}` : u.maxStacks > 1 ? `NEW · MAX ${u.maxStacks}` : 'NEW · UNIQUE'}</div>
              </button>
            );
          })}
        </div>
        {!waiting && (
          <div className="uc-foot">
            Press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> to pick and jump straight back in · <kbd>Esc</kbd> frees the cursor to click a card
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ run build overview

const KEY_STATS = ['weaponDamageMult', 'fireRateMult', 'critChance', 'critMultiplier', 'elementalPower', 'moveSpeedMult', 'shieldCapacity', 'damageResist', 'turretDamageMult', 'turretFireRateMult', 'turretRangeMult', 'coreIncomeMult', 'buildCostMult'] as const;

function fmtStat(k: (typeof KEY_STATS)[number], v: number): string {
  const d = STAT_DEFS[k];
  if (d.kind === 'chance') return `${(v * 100).toFixed(0)}%`;
  if (d.kind === 'mult') return `${v.toFixed(2)}x`;
  if (d.kind === 'flat') return v.toFixed(0);
  return `${(v * 100).toFixed(0)}%`;
}

export function BuildOverview({ game }: { game: Game }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyU') {
        e.preventDefault();
        void game.closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
  const dir = game.director;
  const picks = [...dir.build.stacks.entries()].map(([id, n]) => ({ def: upgradeDef(id)!, n })).filter((p) => p.def);
  const arch = dir.build.archetypes();
  return (
    <div className="screen terminal-screen" data-testid="build-overview">
      <div className="terminal panel-frame wide">
        <div className="term-head">
          <div className="term-code">RUN</div>
          <div className="term-titles">
            <div className="term-title">RUN BUILD</div>
            <div className="term-sub">Temporary upgrades · {dir.build.total} taken · wave {game.waves.number} · seed {dir.build.seed}</div>
          </div>
          <button className="term-close" onClick={() => void game.closePanel()}>
            <kbd>U</kbd>/<kbd>ESC</kbd> CLOSE
          </button>
        </div>
        <div className="build-grid">
          <div>
            <div className="cp-label">UPGRADES</div>
            {picks.length === 0 && <div className="muted-note">None yet: clear a wave to choose your first upgrade.</div>}
            <div className="build-list">
              {picks.map(({ def, n }) => (
                <div key={def.id} className="bl-row" style={{ ['--rc' as string]: RARITY_COLOR[def.rarity] }}>
                  <span className="bl-icon">{def.icon}</span>
                  <div>
                    <b>{def.name}</b> <em>{def.maxStacks > 1 ? `×${n}` : ''}</em>
                    <div className="bl-text">{def.text(n)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="cp-label">BUILD DIRECTION</div>
            {arch.length ? arch.map((a) => <div key={a.id} className="arch-tag">{a.name}</div>) : <div className="muted-note">No dominant theme yet.</div>}
            <div className="cp-label">ACTIVE BUFFS</div>
            {dir.buffs.length ? dir.buffs.map((b) => <div key={b.id} className="buff-row">{b.name} ×{b.stacks} · {b.t.toFixed(1)} s</div>) : <div className="muted-note">None</div>}
            <div className="cp-label">CALCULATED STATS</div>
            <div className="stat-list">
              {KEY_STATS.map((k) => (
                <div key={k}>
                  <span>{STAT_DEFS[k].label}</span>
                  <b>{fmtStat(k, game.stats[k])}</b>
                </div>
              ))}
            </div>
            <div className="cp-label">RUN COMBAT STATS</div>
            <div className="stat-list">
              <div><span>Triggered effects</span><b>{dir.bus.stats.triggered}</b></div>
              <div><span>Lightning strikes</span><b>{dir.lightning}</b></div>
              <div><span>Reactions (shock / overload / super)</span><b>{dir.reactions.thermalShock} / {dir.reactions.overload} / {dir.reactions.superconduct}</b></div>
              <div><span>Damage: weapon / tower / effects</span><b>{Math.round(dir.damageBy.weapon)} / {Math.round(dir.damageBy.tower)} / {Math.round(dir.damageBy.effect + dir.damageBy.reaction + dir.damageBy.status)}</b></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tower configuration

function partLines(slot: TowerSlot, id: string): string {
  const p = partDef(slot, id);
  return p ? p.blurb : '';
}

function SlotChips({ game, slot, cfg, onPick, tower }: { game: Game; slot: TowerSlot; cfg: TowerConfig; onPick: (id: string) => void; tower?: boolean }) {
  const mult = game.stats.buildCostMult;
  return (
    <div className="tp-chips">
      {partsFor(slot).map((p) => {
        const owned = !p.tech || game.towerTech.has(`${slot}:${p.id}`);
        const test: TowerConfig = { ...cfg, [slot]: p.id };
        const why = !owned ? 'Research this blueprint at HQ (Tower Technology)' : slotCompat(slot, cfg, test);
        const cur = cfg[slot] === p.id;
        const cost = tower && !cur ? swapCost(cfg, slot, p.id, mult) : 0;
        return (
          <button key={p.id} data-testid={`part-${slot}-${p.id}`} className={`chip ${cur ? 'cur' : ''} ${!owned ? 'locked' : ''}`} disabled={cur || !!why} title={`${p.blurb}${why ? ` — ${why}` : ''}`} onClick={() => onPick(p.id)}>
            {!owned ? '🔒 ' : ''}{p.name}
            {tower && !cur && !why ? <small> ◆{cost}</small> : null}
            {!tower && !cur && !why ? <small> ◆{p.cost}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

import { compatibility } from '../towers/components';
function slotCompat(slot: TowerSlot, cfg: TowerConfig, test: TowerConfig): string | null {
  void slot;
  void cfg;
  return compatibility(test);
}

export function TowerPanel({ game }: { game: Game }) {
  const force = useForce();
  const cores = game.wallet.cores;
  const towers = game.turrets.turrets;
  const [sel, setSel] = useState<number | null>(game.towerPanelFocus ?? towers[0]?.id ?? null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyT') {
        e.preventDefault();
        void game.closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
  const tower = towers.find((t) => t.id === sel) ?? null;
  const info = tower ? game.towerInfo(tower) : null;
  const tpl = game.buildConfig;
  const act = (r: { ok: boolean; reason?: string }) => {
    setMsg(r.ok ? '' : (r.reason ?? ''));
    force();
  };
  return (
    <div className="screen terminal-screen" data-testid="tower-panel">
      <div className="terminal panel-frame wide">
        <div className="term-head">
          <div className="term-code">TWR</div>
          <div className="term-titles">
            <div className="term-title">TOWER ENGINEERING</div>
            <div className="term-sub">Preparation: refit freely for cores · in combat, use tactical mode <BoundKey action="tactical" /> and the aim hotkeys</div>
          </div>
          <div className="tp-cores">◆ {cores}</div>
          <button className="term-close" onClick={() => void game.closePanel()}>
            <kbd>T</kbd>/<kbd>ESC</kbd> CLOSE
          </button>
        </div>
        {msg && <div className="tp-msg">{msg}</div>}
        <div className="tp-grid">
          <div className="tp-col">
            <div className="cp-label">BUILD TEMPLATE · next tower ◆{game.nextTowerCost}</div>
            {TOWER_SLOTS.map((slot) => (
              <div key={slot} className="tp-slot">
                <div className="tp-slot-h">{SLOT_LABEL[slot]}: <b>{partDef(slot, tpl[slot])?.name}</b></div>
                <div className="tp-blurb">{partLines(slot, tpl[slot])}</div>
                <SlotChips game={game} slot={slot} cfg={tpl} onPick={(id) => act(game.setBuildConfig(slot, id))} />
              </div>
            ))}
            <div className="tp-blurb">Place towers with <BoundKey action="build" /> / <kbd>2</kbd>. Weapon changes reset dependants that no longer fit.</div>
          </div>
          <div className="tp-col">
            <div className="cp-label">DEPLOYED TOWERS ({towers.length})</div>
            <div className="tp-list">
              {towers.length === 0 && <div className="muted-note">No towers built yet.</div>}
              {towers.map((t) => (
                <button key={t.id} data-testid={`tower-${t.id}`} className={`chip ${t.id === sel ? 'cur' : ''}`} onClick={() => setSel(t.id)}>
                  #{t.id} {t.name} L{t.level}
                </button>
              ))}
            </div>
            {tower && info && (
              <div className="tp-detail">
                <div className="tp-slot-h">{info.name} · {info.base} · level {info.level}/{info.maxLevel}{info.empowered ? ' · EMPOWERED' : ''}</div>
                <div className="stat-list">
                  <div><span>Damage per hit</span><b>{info.st.damage.toFixed(1)}</b></div>
                  <div><span>Attack rate</span><b>{info.st.fireRate.toFixed(2)}/s</b></div>
                  <div><span>Range</span><b>{info.st.range.toFixed(1)} m</b></div>
                  <div><span>Single-target DPS</span><b>{info.st.dps.toFixed(0)}</b></div>
                  <div><span>Element</span><b style={{ color: ELEMENT_COLOR_CSS[info.st.element] }}>{info.st.element.toUpperCase()}</b></div>
                  {info.st.chain > 0 && <div><span>Chain jumps</span><b>{info.st.chain}</b></div>}
                  {info.st.targets > 0 && <div><span>Extra targets</span><b>{info.st.targets}</b></div>}
                  <div><span>Kills · damage</span><b>{info.kills} · {info.damage}</b></div>
                </div>
                <button className="mini" data-testid="tower-level-up" disabled={info.level >= MAX_TOWER_LEVEL} onClick={() => act(game.modifyTower(tower, 'level'))}>
                  UPGRADE LEVEL {info.level < MAX_TOWER_LEVEL ? `→ ${info.level + 1} · ◆${info.levelCost}` : '(MAX)'}
                </button>
                {(['weapon', 'core', 'modifier'] as const).map((slot) => (
                  <div key={slot} className="tp-slot">
                    <div className="tp-slot-h">{SLOT_LABEL[slot]}: <b>{partDef(slot, tower.config[slot])?.name}</b></div>
                    <SlotChips game={game} slot={slot} cfg={tower.config} tower onPick={(id) => act(game.modifyTower(tower, slot, id))} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ in-run HUD additions

export function RunBadges() {
  const m5 = useHud((s) => s.m5);
  if (!m5) return null;
  return (
    <div className="m5-badges">
      {m5.upgrades > 0 && <div className="m5-chip">▲ {m5.upgrades} UPGRADES <kbd>U</kbd></div>}
      {m5.buffs.map((b) => (
        <div key={b.name} className="m5-chip buff">{b.name}{b.stacks > 1 ? ` ×${b.stacks}` : ''} · {b.t.toFixed(0)}s</div>
      ))}
      {m5.network > 0.5 && <div className="m5-chip net">NETWORK {Math.floor(m5.network)}</div>}
      {m5.grid > 0.5 && <div className="m5-chip net">GRID {Math.floor(m5.grid)}</div>}
      {m5.empowered > 0 && <div className="m5-chip emp">⟁ {m5.empowered} TOWERS EMPOWERED</div>}
      {m5.note && <div className="m5-chip note">{m5.note}</div>}
    </div>
  );
}

export { BASES, CORES, MODIFIERS, WEAPONS };
