// Tower panel (final design "Tower panel · refit"): the selected tower's card (level, structure, kills, damage share),
// refits with their net cost (50% of the old part refunded), level up; the build template on the right.
// T / Esc close. Test hooks: tower-panel, tower-<id>, tower-level-up, part-<slot>-<id>.
import { useEffect, useState } from 'react';
import type { Game } from '@riftwarden/game/core/Game';
import { MAX_TOWER_LEVEL, partDef, partsFor, swapCost, TOWER_SLOTS, compatibility, type TowerConfig, type TowerSlot } from '@riftwarden/rules/towers/components';
import { BoundKey } from './hud/widgets';
import { useHud } from './useHud';
import { Backdrop, Crumb, Cur, ELEMENT_COLOR, Hint } from './ds';

const SLOT_LABEL: Record<TowerSlot, string> = { base: 'Base', weapon: 'Weapon', core: 'Core', modifier: 'Modifier' };
const REFIT_KEY: Partial<Record<TowerSlot, string>> = { weapon: 'C', core: 'V', modifier: 'N' };

function useForce() {
  const [, set] = useState(0);
  return () => set((n) => n + 1);
}

/** Every part of a slot: current, affordable refits with their cost, locked blueprints and why. */
function SlotChips({ game, slot, cfg, onPick, tower }: { game: Game; slot: TowerSlot; cfg: TowerConfig; onPick: (id: string) => void; tower?: boolean }) {
  const mult = game.stats.buildCostMult;
  return (
    <div className="tp-chips">
      {partsFor(slot).map((p) => {
        const owned = !p.tech || game.towerTech.has(`${slot}:${p.id}`);
        const why = !owned ? 'Research this blueprint at HQ (tower tech)' : compatibility({ ...cfg, [slot]: p.id });
        const cur = cfg[slot] === p.id;
        const cost = tower ? (cur ? 0 : swapCost(cfg, slot, p.id, mult)) : p.cost;
        return (
          <button key={p.id} data-testid={`part-${slot}-${p.id}`} className={`ds-chip tp-chip ${cur ? 'solid cur' : ''} ${!owned ? 'locked' : ''}`} disabled={cur || !!why} title={`${p.blurb}${why ? ` — ${why}` : ''}`} onClick={() => onPick(p.id)}>
            {!owned ? '⨯ ' : ''}{p.name}
            {!cur && !why ? <small> +{cost}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

export function TowerPanel({ game }: { game: Game }) {
  const force = useForce();
  const node = useHud((s) => s.node);
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
  const totalDamage = towers.reduce((n, t) => n + (game.towerInfo(t)?.damage ?? 0), 0);
  const act = (r: { ok: boolean; reason?: string }) => {
    setMsg(r.ok ? '' : (r.reason ?? ''));
    force();
  };
  return (
    <div className="screen ds-scr tower-panel" data-testid="tower-panel">
      <Backdrop />
      <div className="ds-top">
        <Crumb parts={['Run', node?.name ?? 'Sector', 'Towers']} />
        <span className="ds-grow" />
        <Cur k="cores" value={cores} />
      </div>
      <section className="tp-main ds-abs ds-col">
        <div className="tp-list ds-row">
          {towers.length === 0 && <span className="ds-meta">No towers built yet. Place them with <BoundKey action="build" /> / <kbd>2</kbd> during preparation.</span>}
          {towers.map((t) => (
            <button key={t.id} data-testid={`tower-${t.id}`} className={`ds-chip ${t.id === sel ? 'solid cur' : ''}`} onClick={() => setSel(t.id)}>
              #{t.id} {t.name} L{t.level}
            </button>
          ))}
        </div>
        {tower && info && (
          <div className="tp-card ds-col">
            <span className="ds-ov">{info.st.archetype} · <span style={{ color: ELEMENT_COLOR[info.st.element] ?? 'inherit' }}>{info.st.element}</span>{info.empowered ? ' · empowered' : ''}</span>
            <span className="ds-h1">{info.name} <span className="ds-meta" style={{ fontSize: 22 }}>LV {info.level} / {info.maxLevel}</span></span>
            <div className="tp-stats">
              <div className="ds-col"><span className="ds-lbl">DPS</span><b className="ds-num">{info.st.dps.toFixed(0)}</b></div>
              <div className="ds-col"><span className="ds-lbl">Range</span><b className="ds-num">{info.st.range.toFixed(0)} m</b></div>
              <div className="ds-col"><span className="ds-lbl">Kills</span><b className="ds-num">{info.kills.toLocaleString()}</b></div>
              <div className="ds-col"><span className="ds-lbl">Damage</span><b className="ds-num">{info.damage >= 1000 ? `${(info.damage / 1000).toFixed(1)}K` : info.damage}</b></div>
              <div className="ds-col"><span className="ds-lbl">Share</span><b className="ds-num">{totalDamage > 0 ? Math.round((info.damage / totalDamage) * 100) : 0}%</b></div>
            </div>
            <span className="ds-lbl">Refit · net cost after a 50% refund of the old part</span>
            {(['weapon', 'core', 'modifier'] as const).map((slot) => (
              <div key={slot} className="tp-refit">
                <span className="ds-k">{REFIT_KEY[slot]}</span>
                <span className="tp-slot-h">{SLOT_LABEL[slot]} · <b>{partDef(slot, tower.config[slot])?.name}</b></span>
                <SlotChips game={game} slot={slot} cfg={tower.config} tower onPick={(id) => act(game.modifyTower(tower, slot, id))} />
              </div>
            ))}
            <div className="tp-refit">
              <span className="ds-k">R</span>
              <span className="tp-slot-h">Level {info.level < MAX_TOWER_LEVEL ? `up to ${info.level + 1}` : 'max'}</span>
              <button className="ds-btn" data-testid="tower-level-up" disabled={info.level >= MAX_TOWER_LEVEL} onClick={() => act(game.modifyTower(tower, 'level'))}>
                {info.level < MAX_TOWER_LEVEL ? `UPGRADE · ${info.levelCost} CORES` : 'MAX LEVEL'}
              </button>
            </div>
            <span className="ds-meta">Refits work in preparation, or in combat while slow time (<BoundKey action="tactical" />) is active.</span>
          </div>
        )}
        {msg && <span className="tp-msg ds-meta ds-bad">{msg}</span>}
      </section>
      <aside className="tp-template ds-abs ds-glass ds-cut ds-col">
        <span className="ds-ov ds-em">Build template</span>
        <span className="ds-h3">Next tower · {game.nextTowerCost} cores</span>
        {TOWER_SLOTS.map((slot) => (
          <div key={slot} className="ds-col" style={{ gap: 4 }}>
            <span className="tp-slot-h">{SLOT_LABEL[slot]} · <b>{partDef(slot, tpl[slot])?.name}</b></span>
            <SlotChips game={game} slot={slot} cfg={tpl} onPick={(id) => act(game.setBuildConfig(slot, id))} />
          </div>
        ))}
        <span className="ds-meta">Weapon changes reset parts that no longer fit.</span>
      </aside>
      <div className="ds-bot">
        <span className="ds-hint"><BoundKey action="recycle" />Hold to recycle (aim at a tower)</span>
        <span className="ds-grow" />
        <Hint keys={['T', 'ESC']} onClick={() => void game.closePanel()}>Close</Hint>
      </div>
      <div className="ds-grain" />
    </div>
  );
}
