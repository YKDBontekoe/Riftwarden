// Combat HUD in the final design: frameless, text-shadowed corners over the world.
//   top left: objective (wave, hostiles, reactor or HUNTED, at-risk loot, sector chips)
//   top centre: compass with reactor / gate / threat markers
//   top right: phase, cores, build key
//   bottom left: abilities, hull (big number) with shield and hull segments, movement + condition chips
//   bottom right: holstered weapon, element + weapon name, heat % and heat segments
import { useEffect, useRef, useState } from 'react';
import type { Game } from '@riftwarden/game/core/Game';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { uiEvents, type HudState } from '@riftwarden/game/ui/store';
import { useHud } from '../useHud';
import { BoundKey } from './widgets';
import { LiveBar, LiveText, useLiveStyle } from './live';
import { ElementTag } from '../ElementTag';
import { ELEMENT_COLOR } from '../ds';
import { NODE_MODS } from '@riftwarden/rules/runmap/defs';

const reactorOf = (s: HudState) => s.reactorHp / Math.max(1, s.reactorMax);
const hullOf = (s: HudState) => s.playerHp / Math.max(1, s.playerMax);
const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Top left: what to do right now. */
export function Objective() {
  const wave = useHud((s) => s.wave);
  const phase = useHud((s) => s.phase);
  const survival = useHud((s) => s.mode === 'survival');
  const hit = useHud((s) => s.reactorUnderAttack);
  const run = useHud((s) => s.run);
  const cargo = useHud((s) => s.cargo);
  const node = useHud((s) => s.node);
  const build = useHud((s) => s.buildMode);
  // Hostile bar: share of the wave still alive (peak count seen this wave = 100%).
  const peak = useRef({ wave: 0, n: 1 });
  const title = phase === 'prep' ? `PREP · WAVE ${wave} NEXT` : phase === 'combat' ? (survival ? `SURVIVE WAVE ${wave}` : `CLEAR WAVE ${wave}`) : `WAVE ${wave} SECURED`;
  const atRisk = run && (run.salvageUnsecured > 0 || cargo > 0);
  return (
    <div className="hud-objective" data-testid="hud-objective">
      <div className="ds-row">
        <span aria-hidden="true" className="obj-mark" />
        <span className="ds-h3">{build ? 'BUILD MODE' : title}</span>
        <span className="ds-grow" />
        <LiveText as="b" className="obj-clock" select={(s) => (s.phase === 'prep' ? clock(Math.ceil(s.phaseTimer)) : s.phase === 'combat' ? `${s.enemiesLeft}` : '—')} />
      </div>
      {phase === 'combat' && (
        <div className="obj-line">
          <LiveText className="ds-meta" select={(s) => `${s.enemiesLeft} hostile${s.enemiesLeft === 1 ? '' : 's'}`} />
          <LiveBar segments={1} className="obj-bar" select={(s) => {
            const p = peak.current;
            if (p.wave !== s.wave) { p.wave = s.wave; p.n = 1; }
            p.n = Math.max(p.n, s.enemiesLeft);
            return { value: s.enemiesLeft / p.n, tone: 'white' };
          }} />
        </div>
      )}
      {phase === 'prep' && !build && (
        <div className="obj-line"><span className="ds-hint" style={{ fontSize: 13 }}><BoundKey action="wave" />Call wave early · +2 cores per second</span></div>
      )}
      {survival ? (
        <div className="obj-line reactor survival-mode" data-testid="survival-banner">
          <span className="ds-meta obj-warn">Hunted · one life</span>
          <LiveBar segments={10} className="obj-seg" select={(s) => ({ value: hullOf(s), tone: hullOf(s) < 0.3 ? 'red' : 'white' })} />
          <LiveText as="b" className="ds-d" select={(s) => `${Math.ceil(hullOf(s) * 100)}%`} />
        </div>
      ) : (
        <div className={`obj-line reactor ${hit ? 'hit' : ''}`}>
          <span className="ds-meta">{hit ? <b className="obj-warn">Reactor ▲ hit</b> : 'Reactor'}</span>
          <LiveBar segments={10} className="obj-seg" select={(s) => ({ value: reactorOf(s), tone: reactorOf(s) < 0.3 ? 'red' : reactorOf(s) < 0.6 ? 'amber' : 'cyan' })} />
          <LiveText as="b" className="ds-d" select={(s) => `${Math.ceil(reactorOf(s) * 100)}%`} />
        </div>
      )}
      {atRisk && <span className="ds-risk-tag obj-risk">At risk · {run!.salvageUnsecured.toLocaleString()} salvage{cargo > 0 ? ` · ${cargo} item${cargo === 1 ? '' : 's'}` : ''}</span>}
      {node && (
        <span className="ds-row obj-chips" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="ds-chip">{node.name}</span>
          {node.mods?.slice(0, 2).map((m) => <span key={m} className="ds-chip">{NODE_MODS[m]?.name ?? m}</span>)}
        </span>
      )}
    </div>
  );
}

const CARDINAL = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_W = 600;
/** Pixels per radian across the strip (about 120 degrees visible). */
const PX_PER_RAD = COMPASS_W / ((Math.PI * 2) / 3);

/** Top centre: heading strip with the reactor, open gates and the nearest boss / elite (survival: no reactor). */
export function Compass({ game }: { game: Game }) {
  const strip = useRef<HTMLDivElement>(null);
  const reactor = useRef<HTMLSpanElement>(null);
  const threat = useRef<HTMLSpanElement>(null);
  const survival = useHud((s) => s.mode === 'survival');
  useEffect(() => {
    let raf = 0;
    const place = (el: HTMLElement | null, x: number, z: number, label?: string) => {
      if (!el) return;
      const p = game.player.position;
      let rel = Math.atan2(x - p.x, z - p.z) - game.player.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const px = COMPASS_W / 2 + rel * PX_PER_RAD;
      const on = px > 20 && px < COMPASS_W - 20;
      el.style.transform = `translateX(${Math.round(Math.max(20, Math.min(COMPASS_W - 20, px)))}px)`;
      el.style.opacity = on ? '1' : '0.55';
      if (label !== undefined) {
        const t = el.querySelector('i');
        if (t && t.textContent !== label) t.textContent = label;
      }
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = strip.current;
      if (!s || !game.player) return;
      const yaw = game.player.yaw;
      // Cardinal letters every 45 degrees, numbers between.
      for (const el of s.children as HTMLCollectionOf<HTMLElement>) {
        const a = Number(el.dataset.a);
        let rel = a - yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const px = COMPASS_W / 2 + rel * PX_PER_RAD;
        el.style.transform = `translateX(${Math.round(px)}px) translateX(-50%)`;
        el.style.visibility = px < 10 || px > COMPASS_W - 10 ? 'hidden' : 'visible';
      }
      const r = game.layout.reactor;
      const p = game.player.position;
      if (!survival) place(reactor.current, r.x, r.z, `REACTOR ${Math.round(Math.hypot(r.x - p.x, r.z - p.z))}M`);
      // A boss first, else the nearest elite.
      let best: { x: number; z: number; d: number; boss: boolean } | null = null;
      for (const e of game.enemies.active) {
        if (!e.alive) continue;
        const boss = e.def.role === 'boss';
        if (!boss && !e.elite) continue;
        const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
        if (!best || (boss && !best.boss) || (boss === best.boss && d < best.d)) best = { x: e.pos.x, z: e.pos.z, d, boss };
      }
      if (threat.current) threat.current.style.display = best ? '' : 'none';
      if (best) place(threat.current, best.x, best.z, `${best.boss ? 'BOSS' : 'ELITE'} ${Math.round(best.d)}M`);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game, survival]);
  const marks: { a: number; t: string; card: boolean }[] = [];
  for (let d = 0; d < 360; d += 15) marks.push({ a: (d * Math.PI) / 180, t: d % 45 === 0 ? CARDINAL[d / 45] : String(d), card: d % 45 === 0 });
  return (
    <div className="hud-compass" aria-hidden="true">
      <div className="hc-ticks" />
      <div ref={strip} className="hc-strip">
        {marks.map((m) => <span key={m.t} data-a={m.a} className={m.card ? 'hc-card' : 'hc-num'}>{m.card ? m.t : m.t}</span>)}
      </div>
      <span className="hc-caret" />
      {!survival && <span ref={reactor} className="hc-mark reactor"><b /><i /></span>}
      <span ref={threat} className="hc-mark threat" style={{ display: 'none' }}><b /><i /></span>
    </div>
  );
}

/** Top right: phase, cores and the build key (the cores flash when they grow). */
export function PhaseCores() {
  const phase = useHud((s) => s.phase);
  const wave = useHud((s) => s.wave);
  const survival = useHud((s) => s.mode === 'survival');
  const run = useHud((s) => s.run);
  const cargo = useHud((s) => s.cargo);
  const cargoMax = useHud((s) => s.cargoMax);
  const [gains, setGains] = useState<{ id: number; v: number }[]>([]);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('coresGained', (v) => {
      const my = ++id;
      setGains((g) => [...g.slice(-3), { id: my, v }]);
      setTimeout(() => setGains((g) => g.filter((x) => x.id !== my)), 1000);
    });
  }, []);
  const tier = run ? getTier(run.tier) : null;
  return (
    <div className="hud-phase cores">
      <span className="ds-lbl">{phase === 'prep' ? 'Prep' : phase === 'combat' ? 'Combat' : 'Secured'} · wave {wave}{tier ? ` · RL ${tier.id}` : ''}</span>
      {!survival && (
        <span className="ds-row" style={{ gap: 8 }}>
          {gains.map((g) => <span key={g.id} className="hp-gain">+{g.v}</span>)}
          <LiveText as="b" className="ds-h3 value" select={(s) => Math.floor(s.cores)} />
          <span className="ds-meta">cores</span>
          <BoundKey action="build" />
          <span className="ds-meta">build</span>
        </span>
      )}
      {run && (
        <span className="ds-meta hud-phase-sub">
          Cargo <BoundKey action="inventory" /> {cargo}/{cargoMax} · {run.checkpointOpen ? <>checkpoint open <BoundKey action="checkpoint" /></> : `bank at wave ${run.nextCheckpoint}`}
          {(run.xpUnsecured ?? 0) + (run.xpSecured ?? 0) > 0 && <> · XP <b data-testid="run-xp">{run.xpUnsecured ?? 0} / {run.xpSecured ?? 0}</b></>}
        </span>
      )}
    </div>
  );
}

const ABILITY_KEY = { ability: 'RMB', ability2: 'F', ultimate: 'T' } as const;
type AbilityRow = HudState['abilities'][number];

function AbilitySlot({ slot, name }: { slot: AbilityRow['slot']; name: string }) {
  const ult = slot === 'ultimate';
  const row = (s: HudState) => s.abilities.find((r) => r.slot === slot);
  const state = useHud((s) => {
    const r = row(s);
    return !r ? 'cooling' : r.active > 0 ? 'active' : r.ready ? 'ready' : 'cooling';
  });
  const fill = useLiveStyle(
    (s) => {
      const r = row(s);
      return r ? Math.max(0, Math.min(1, ult ? r.cd : r.max > 0 ? 1 - r.cd / r.max : 1)) : 0;
    },
    (st, v) => (st.height = `${Math.round(v * 100)}%`),
  );
  return (
    <div className={`ab-slot ${ult ? 'ult' : ''} ${state}`} title={name}>
      <i className="ab-fill" ref={fill} />
      <span className="ab-name">{name}</span>
      <LiveText
        className="ab-state"
        select={(s) => {
          const r = row(s);
          return !r ? '' : r.active > 0 ? `${r.active.toFixed(1)}s` : r.ready ? 'READY' : ult ? `${Math.floor(r.cd * 100)}%` : `${r.cd.toFixed(1)}`;
        }}
      />
      <kbd>{ABILITY_KEY[slot]}</kbd>
    </div>
  );
}

function AbilityBar() {
  const slots = useHud((s) => s.abilities.map((r) => `${r.slot}:${r.name}`).join('|'));
  const dash = useHud((s) => `${s.dashCharges}/${s.dashMax}`);
  const recharge = useLiveStyle((s) => (s.dashCharges >= s.dashMax ? 1 : s.dashRecharge), (st, v) => (st.height = `${Math.round(v * 100)}%`));
  return (
    <div className="ability-bar">
      {slots && slots.split('|').map((k) => {
        const [slot, ...name] = k.split(':');
        return <AbilitySlot key={slot} slot={slot as AbilityRow['slot']} name={name.join(':')} />;
      })}
      <div className={`ab-dash ${dash.startsWith('0/') ? 'cooling' : 'ready'}`} title="Dash">
        <i className="ab-fill" ref={recharge} />
        <span className="ab-name">DASH</span>
        <span className="ab-state">{dash}</span>
        <BoundKey action="dash" />
      </div>
    </div>
  );
}

/** Bottom left: abilities, hull and shield. */
export function Vitals({ children }: { children?: React.ReactNode }) {
  const low = useHud((s) => s.playerHp / s.playerMax < 0.35);
  const max = useHud((s) => Math.round(s.playerMax));
  const shieldMax = useHud((s) => Math.round(s.playerShieldMax));
  const build = useHud((s) => s.buildMode);
  return (
    <div className={`bottom-left hud-vitals ${low ? 'low' : ''}`}>
      {!build && <AbilityBar />}
      <div className="ds-row hv-main">
        <LiveText as="b" className="ds-numxl hv-num" select={(s) => Math.ceil(s.playerHp)} />
        <div className="ds-col hv-bars">
          {shieldMax > 0 && <LiveBar segments={8} className="hv-shield" select={(s) => ({ value: s.playerShield / Math.max(1, s.playerShieldMax), tone: 'shield' })} />}
          <LiveBar segments={12} className="hv-hull" select={(s) => ({ value: hullOf(s), tone: hullOf(s) < 0.35 ? 'red' : 'white' })} />
        </div>
      </div>
      <LiveText as="div" className="ds-lbl hv-label" select={(s) => `Hull ${Math.ceil(s.playerHp)} / ${max}${s.playerShieldMax > 0 ? ` · shield ${Math.ceil(s.playerShield)}` : ''}`} />
      {children}
    </div>
  );
}

/** Bottom right: holstered weapon, weapon in hand, heat. */
export function WeaponBlock() {
  const name = useHud((s) => s.weaponName);
  const holster = useHud((s) => s.holster);
  const element = useHud((s) => s.weaponElement);
  const aff = useHud((s) => s.weaponAff);
  const build = useHud((s) => s.buildMode);
  const survival = useHud((s) => s.mode === 'survival');
  const color = ELEMENT_COLOR[element] ?? 'var(--ds-ink)';
  return (
    <div className={`bottom-right hud-weapon ${build ? 'stowed' : ''}`}>
      {holster && (
        <div className={`wc-holster ds-row ${holster.overheated ? 'warn' : ''}`}>
          <span className="ds-lbl wh-name">{holster.name}</span>
          <ElementTag element={holster.element} />
          {holster.aff !== 0 && <span className={`el-aff ${holster.aff > 0 ? 'weak' : 'resist'}`}>{holster.aff > 0 ? '▲' : '▼'}</span>}
          <span className="ds-meta wh-heat">{holster.overheated ? 'VENTING' : holster.heat > 0.01 ? `${Math.round(holster.heat * 100)}%` : 'ready'}</span>
          <BoundKey action="swap" />
        </div>
      )}
      <div className="weapon-card ds-row">
        <span className="ds-col" style={{ alignItems: 'flex-end' }}>
          <span className="ds-lbl" style={{ color }}>
            <ElementTag element={element} />
            {aff !== 0 && <span className={`el-aff ${aff > 0 ? 'weak' : 'resist'}`} title={aff > 0 ? 'This sector\'s faction is weak to this element' : 'This sector\'s faction resists this element'}>{aff > 0 ? '▲ WEAK' : '▼ RESIST'}</span>}
          </span>
          <span className="ds-h3 weapon" style={{ fontSize: 24 }}>{name}</span>
        </span>
        <LiveText as="b" className="ds-numxl hw-heat" select={(s) => (s.overheated ? 'HOT' : `${Math.round(s.heat * 100)}`)} />
        <span className="hw-pct">%</span>
      </div>
      <LiveBar segments={20} className="hw-bar" select={(s) => ({ value: s.heat, tone: s.overheated ? 'red' : s.heat > 0.7 ? 'amber' : 'heat' })} />
      <LiveText as="div" className="ds-lbl heat-label" select={(s) => (s.overheated ? 'Overheated · venting' : 'Heat · locks out at 100')} />
      <div className="slots">
        <span className={!build ? 'on' : ''}><kbd>1</kbd> weapon</span>
        {!survival && <span className={build ? 'on' : ''}><kbd>2</kbd> build</span>}
      </div>
    </div>
  );
}
