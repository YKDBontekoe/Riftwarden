import { useEffect, useState } from 'react';
import type { Game } from '@riftwarden/game/core/Game';
import { STAT_DEFS } from '@riftwarden/rules/combat/stats';
import { CATEGORY_LABEL, RARITY_COLOR, upgradeDef } from '@riftwarden/rules/roguelite/upgrades';
import { BASES, CORES, MAX_TOWER_LEVEL, MODIFIERS, partDef, partsFor, swapCost, TOWER_SLOTS, type TowerConfig, type TowerSlot, WEAPONS } from '@riftwarden/rules/towers/components';
import { ELEMENT_COLOR_CSS } from './elements';
import { BoundKey } from './hud/widgets';
import { useHud } from './useHud';
import { Backdrop, Crumb, ElementGem, ELEMENT_PATH, Gem, Hint } from './ds';

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
  // Synergy: picks already taken that share a tag with the offered card; the run's tag totals for the footer.
  const owned = [...build.stacks.entries()].map(([id, n]) => ({ def: upgradeDef(id), n })).filter((p) => p.def);
  const tagCount = new Map<string, number>();
  for (const p of owned) for (const t of p.def!.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + p.n);
  const runTags = [...tagCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
  const node = useHud((s) => s.node);
  return (
    <div className="screen dim upgrade-screen ds-scr" data-testid="upgrade-panel">
      <Backdrop scrim="none" />
      <div className="ds-top">
        <Crumb parts={['Run', node?.name ?? 'Sector', 'Run upgrade']} />
        <span className="ds-grow" />
        <span className="ds-mono">{coop ? `TEAM PICK · ${coop.offerLeft} S` : 'WORLD PAUSED'}</span>
      </div>
      <div className="ds-abs ds-col" style={{ left: 0, right: 0, top: 62, alignItems: 'center', gap: 4, textAlign: 'center' }}>
        <span className="ds-ov ds-up">Wave {game.waves.number - 1} cleared · {coop ? 'team upgrade' : 'world paused'}</span>
        <span className="ds-hero">{waiting ? `${waiting} is choosing` : coop ? 'Choose a team upgrade' : 'Choose an upgrade'}</span>
        <span className="ds-meta">{coop ? (waiting ? 'Team upgrades are picked in turn; this one applies to every warden.' : 'Your turn: this upgrade applies to the whole team.') : 'Lasts for this run · numbers include what you already took'}</span>
        {coop && <button className="ds-btn" style={{ minHeight: 36, marginTop: 6 }} onClick={() => void game.closePanel?.()}>BACK TO THE ARENA</button>}
      </div>
      <div className="upgrade-cards ds-abs" style={{ left: 'max(24px, 9vw)', right: 'max(24px, 9vw)', top: coop ? 236 : 200, display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, offer.length)}, minmax(0, 1fr))`, gap: 28 }}>
        {offer.map((u, i) => {
          const have = build.count(u.id);
          const color = UP_COLOR[u.rarity] ?? RARITY_COLOR[u.rarity];
          const el = u.tags.find((t) => t in ELEMENT_PATH);
          const syn = owned.filter((p) => p.def!.id !== u.id && p.def!.tags.some((t) => u.tags.includes(t) && t !== u.category));
          const synTag = syn.length ? u.tags.find((t) => syn.some((p) => p.def!.tags.includes(t))) : null;
          return (
            <button key={u.id} data-testid={`upgrade-card-${i}`} data-id={u.id} className="ucard ds-card" disabled={!!waiting} style={{ '--r': color } as React.CSSProperties} onClick={() => game.chooseUpgrade(u.id)}>
              <span className="ds-row" style={{ justifyContent: 'space-between', width: '100%' }}>
                <span style={{ font: '700 13px var(--ds-d)', letterSpacing: '0.3em', color }}>{u.rarity.toUpperCase()}</span>
                <span className="ds-k">{i + 1}</span>
              </span>
              <span style={{ margin: '6px 0 4px 8px' }}>
                {el ? <ElementGem el={el} size={54} /> : <Gem color={color} size={54}><span aria-hidden="true" style={{ font: '700 22px var(--ds-d)', color }}>{u.icon}</span></Gem>}
              </span>
              <span style={{ font: "800 34px/0.95 var(--ds-d)", letterSpacing: '0.03em', textTransform: 'uppercase' }}>{u.name}</span>
              <span className="ds-body" style={{ fontSize: 15 }}>{u.text(have + 1)}</span>
              {u.hint && <span className="ds-meta">{u.hint}</span>}
              <span className="ds-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="ds-chip">{CATEGORY_LABEL[u.category]}</span>
                {u.tags.filter((t) => t !== u.category).slice(0, 2).map((t) => <span key={t} className="ds-chip">{t}</span>)}
                {u.needs?.towers ? <span className="ds-chip">Towers</span> : null}
              </span>
              {synTag && <span style={{ font: '700 14px var(--ds-d)', letterSpacing: '0.12em', color: 'var(--ds-up)', textTransform: 'uppercase' }}>▲ Synergy · {syn.length} {synTag} pick{syn.length > 1 ? 's' : ''} taken</span>}
              <span className="ds-meta" style={{ marginTop: 'auto' }}>{have > 0 ? `Owned ${have} · stack ${have + 1} of ${u.maxStacks}` : u.maxStacks > 1 ? `New · stacks to ${u.maxStacks}` : 'New · unique'}</span>
            </button>
          );
        })}
      </div>
      <div className="ds-bot">
        {runTags.length > 0 && (
          <span className="ds-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="ds-lbl">Your run</span>
            {runTags.map(([t, n]) => <span key={t} className="ds-chip">{t} {n}</span>)}
          </span>
        )}
        <span className="ds-grow" />
        {!waiting && <span className="ds-hint"><span className="ds-k">1</span><span className="ds-k">2</span><span className="ds-k">3</span>Pick</span>}
        <Hint keys="ESC">Free cursor</Hint>
      </div>
      <div className="ds-grain" />
    </div>
  );
}

const UP_COLOR: Record<string, string> = { common: '#c9cdc4', rare: '#8cc4ff', epic: '#d4b2ff', legendary: '#ffcf73' };

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
          <div className="flex-[1]">
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
            {picks.length === 0 && <div className="text-faint text-[14px] p-[4px_0]">None yet: clear a wave to choose your first upgrade.</div>}
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
            {arch.length ? arch.map((a) => <div key={a.id} className="arch-tag">{a.name}</div>) : <div className="text-faint text-[14px] p-[4px_0]">No dominant theme yet.</div>}
            <div className="cp-label">ACTIVE BUFFS</div>
            {dir.buffs.length ? dir.buffs.map((b) => <div key={b.id} className="buff-row">{b.name} ×{b.stacks} · {b.t.toFixed(1)} s</div>) : <div className="text-faint text-[14px] p-[4px_0]">None</div>}
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

import { compatibility } from '@riftwarden/rules/towers/components';
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
          <div className="flex-[1]">
            <div className="term-title">TOWER ENGINEERING</div>
            <div className="term-sub">Preparation: refit freely for cores · in combat, use tactical mode <BoundKey action="tactical" /> and the aim hotkeys</div>
          </div>
          <div className="font-mono text-amber text-[16px] p-[0_16px] [align-self:center]">◆ {cores}</div>
          <button className="term-close" onClick={() => void game.closePanel()}>
            <kbd>T</kbd>/<kbd>ESC</kbd> CLOSE
          </button>
        </div>
        {msg && <div className="tp-msg">{msg}</div>}
        <div className="tp-grid">
          <div className="tp-col">
            <div className="cp-label">BUILD TEMPLATE · next tower ◆{game.nextTowerCost}</div>
            {TOWER_SLOTS.map((slot) => (
              <div key={slot} className="m-[10px_0_14px]">
                <div className="tp-slot-h">{SLOT_LABEL[slot]}: <b>{partDef(slot, tpl[slot])?.name}</b></div>
                <div className="text-[13px] text-faint m-[2px_0_4px]">{partLines(slot, tpl[slot])}</div>
                <SlotChips game={game} slot={slot} cfg={tpl} onPick={(id) => act(game.setBuildConfig(slot, id))} />
              </div>
            ))}
            <div className="text-[13px] text-faint m-[2px_0_4px]">Place towers with <BoundKey action="build" /> / <kbd>2</kbd>. Weapon changes reset dependants that no longer fit.</div>
          </div>
          <div className="tp-col">
            <div className="cp-label">DEPLOYED TOWERS ({towers.length})</div>
            <div className="tp-list">
              {towers.length === 0 && <div className="text-faint text-[14px] p-[4px_0]">No towers built yet.</div>}
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
                  <div key={slot} className="m-[10px_0_14px]">
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
