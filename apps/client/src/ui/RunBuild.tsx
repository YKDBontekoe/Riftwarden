// Run build overview (final design "Run build"): every upgrade taken as a card, tag totals, build direction, live
// buffs and the stats the build produces. U / Esc close; the run keeps its upgrades until it ends.
import { useEffect } from 'react';
import type { Game } from '@riftwarden/game/core/Game';
import { STAT_DEFS } from '@riftwarden/rules/combat/stats';
import { CATEGORY_LABEL, upgradeDef } from '@riftwarden/rules/roguelite/upgrades';
import { useHud } from './useHud';
import { Backdrop, Crumb, Hint } from './ds';

const KEY_STATS = ['weaponDamageMult', 'fireRateMult', 'critChance', 'critMultiplier', 'elementalPower', 'moveSpeedMult', 'shieldCapacity', 'damageResist', 'turretDamageMult', 'turretFireRateMult', 'turretRangeMult', 'coreIncomeMult', 'buildCostMult'] as const;
const UP_COLOR: Record<string, string> = { common: '#c9cdc4', rare: '#8cc4ff', epic: '#d4b2ff', legendary: '#ffcf73' };

function fmtStat(k: (typeof KEY_STATS)[number], v: number): string {
  const d = STAT_DEFS[k];
  if (d.kind === 'chance') return `${(v * 100).toFixed(0)}%`;
  if (d.kind === 'mult') return `${v.toFixed(2)}×`;
  if (d.kind === 'flat') return v.toFixed(0);
  return `${(v * 100).toFixed(0)}%`;
}

export function BuildOverview({ game }: { game: Game }) {
  const node = useHud((s) => s.node);
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
  const tags = new Map<string, number>();
  for (const p of picks) for (const t of p.def.tags) tags.set(t, (tags.get(t) ?? 0) + p.n);
  const tagList = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="screen ds-scr run-build" data-testid="build-overview">
      <Backdrop />
      <div className="ds-top">
        <Crumb parts={['Run', node?.name ?? 'Sector', 'Run build']} />
        <span className="ds-grow" />
        <span className="ds-mono">{dir.build.total} UPGRADE{dir.build.total === 1 ? '' : 'S'} · LASTS UNTIL THE RUN ENDS · SEED {dir.build.seed}</span>
      </div>
      <section className="rb-cards ds-abs">
        {picks.length === 0 && <div className="ds-meta">None yet: clear a wave to choose your first upgrade.</div>}
        {picks.map(({ def, n }) => {
          const c = UP_COLOR[def.rarity] ?? '#c9cdc4';
          return (
            <div key={def.id} className="rb-card" style={{ '--r': c } as React.CSSProperties}>
              <span className="ds-row"><span className="rb-rar" style={{ color: c }}>{def.rarity}</span><span className="ds-grow" /><b className="ds-d">{def.maxStacks > 1 ? `×${n}` : ''}</b></span>
              <b className="ds-h3">{def.name}</b>
              <span className="ds-meta">{def.text(n)}</span>
              <span className="ds-row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="ds-chip">{CATEGORY_LABEL[def.category]}</span>{def.tags.filter((t) => t !== def.category).slice(0, 2).map((t) => <span key={t} className="ds-chip">{t}</span>)}</span>
            </div>
          );
        })}
      </section>
      <aside className="rb-side ds-abs ds-glass ds-cut ds-col">
        <span className="ds-h3">Tags</span>
        {tagList.length ? tagList.map(([t, n]) => <div key={t} className="ds-list-row"><span className="ds-grow" style={{ textTransform: 'capitalize' }}>{t}</span><b className="ds-d" style={{ fontSize: 18 }}>{n}</b></div>) : <span className="ds-meta">No tags yet.</span>}
        <span className="ds-h3" style={{ marginTop: 8 }}>Build direction</span>
        {arch.length ? <span className="ds-row" style={{ gap: 6, flexWrap: 'wrap' }}>{arch.map((a) => <span key={a.id} className="ds-chip green">{a.name}</span>)}</span> : <span className="ds-meta">No dominant theme yet.</span>}
        <span className="ds-h3" style={{ marginTop: 8 }}>Active buffs</span>
        {dir.buffs.length ? dir.buffs.map((b) => <div key={b.id} className="ds-list-row"><span className="ds-grow">{b.name} ×{b.stacks}</span><span className="ds-meta">{b.t.toFixed(1)} s</span></div>) : <span className="ds-meta">None</span>}
        <details className="rb-stats">
          <summary className="ds-lbl">Calculated stats · combat log</summary>
          {KEY_STATS.map((k) => <div key={k} className="ds-list-row"><span className="ds-grow">{STAT_DEFS[k].label}</span><b>{fmtStat(k, game.stats[k])}</b></div>)}
          <div className="ds-list-row"><span className="ds-grow">Triggered effects</span><b>{dir.bus.stats.triggered}</b></div>
          <div className="ds-list-row"><span className="ds-grow">Lightning strikes</span><b>{dir.lightning}</b></div>
          <div className="ds-list-row"><span className="ds-grow">Reactions (shock / overload / super)</span><b>{dir.reactions.thermalShock} / {dir.reactions.overload} / {dir.reactions.superconduct}</b></div>
          <div className="ds-list-row"><span className="ds-grow">Damage: weapon / tower / effects</span><b>{Math.round(dir.damageBy.weapon)} / {Math.round(dir.damageBy.tower)} / {Math.round(dir.damageBy.effect + dir.damageBy.reaction + dir.damageBy.status)}</b></div>
        </details>
      </aside>
      <div className="ds-bot">
        <span className="ds-meta">Curses and blessings of this act are on the sector map</span>
        <span className="ds-grow" />
        <Hint keys={['U', 'ESC']} onClick={() => void game.closePanel()}>Close</Hint>
      </div>
      <div className="ds-grain" />
    </div>
  );
}
