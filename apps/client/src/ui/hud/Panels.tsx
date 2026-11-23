import { currencyTooltip } from '@riftwarden/rules/economy/currencies';
import { ElementTag } from '../ElementTag';
import { useEffect, useRef, useState } from 'react';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { type BannerEvent, uiEvents } from '@riftwarden/game/ui/store';
import { useHud } from '../useHud';
import { BoundKey, Key, SegBar, fmtClock } from './widgets';
import { LiveBar, LiveText, useLiveStyle } from './live';
import type { HudState } from '@riftwarden/game/ui/store';

export function Overlays() {
  const tactical = useHud((s) => s.tacticalActive);
  const hp = useHud((s) => s.playerHp / s.playerMax);
  const alive = useHud((s) => s.respawnIn <= 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let level = 0;
    const off = uiEvents.on('hurt', (v) => {
      level = Math.min(1, level + 0.35 + v.severity * 0.8);
    });
    const tick = () => {
      if (level > 0) level = Math.max(0, level - 0.025);
      if (ref.current) ref.current.style.setProperty('--hurt', level.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);
  const low = hp < 0.35 && alive ? (0.35 - hp) / 0.35 : 0;
  return (
    <div ref={ref} className="overlays fixed inset-[0] [--hurt:0] [--low:0]" style={{ ['--low' as string]: low.toFixed(3) }}>
      <div className={`tactical-tint ${tactical ? 'on' : ''}`}>
        <div className="absolute inset-[18px] [border:1px_solid_rgba(167,123,255,0.35)] [clip-path:polygon(0_0,60px_0,60px_1px,1px_1px,1px_60px,0_60px,0_100%,60px_100%,60px_calc(100%_-_1px),1px_calc(100%_-_1px),1px_calc(100%_-_60px),0_calc(100%_-_60px),0_0,100%_0,100%_60px,calc(100%_-_1px)_60px,calc(100%_-_1px)_1px,calc(100%_-_60px)_1px,calc(100%_-_60px)_0,100%_0,100%_100%,calc(100%_-_60px)_100%,calc(100%_-_60px)_calc(100%_-_1px),calc(100%_-_1px)_calc(100%_-_1px),calc(100%_-_1px)_calc(100%_-_60px),100%_calc(100%_-_60px))]" />
      </div>
      <div className="fixed inset-[0] [opacity:var(--hurt)] [background:radial-gradient(ellipse_at_center,transparent_45%,rgba(255,30,10,0.25)_75%,rgba(255,20,10,0.6)_100%)]" />
      <div className={`lowhp ${low > 0 ? 'on' : ''}`} />
    </div>
  );
}

const reactorOf = (s: HudState) => s.reactorHp / s.reactorMax;
const hullOf = (s: HudState) => s.playerHp / Math.max(1, s.playerMax);
const phaseDetail = (s: HudState) => (s.phase === 'prep' ? fmtClock(Math.ceil(s.phaseTimer)) : s.phase === 'combat' ? `${s.enemiesLeft} HOSTILE${s.enemiesLeft === 1 ? '' : 'S'}` : '—');

export function TopCenter() {
  const wave = useHud((s) => s.wave);
  const phase = useHud((s) => s.phase);
  const critical = useHud((s) => s.reactorHp / s.reactorMax < 0.3);
  const hit = useHud((s) => s.reactorUnderAttack);
  const survival = useHud((s) => s.mode === 'survival');
  const phaseText = phase === 'prep' ? 'PREPARATION' : phase === 'combat' ? 'ENGAGED' : 'SECURED';
  return (
    <div className={`top-center ${hit ? 'hit' : ''} ${critical ? 'critical' : ''}`}>
      <div className="wave-row">
        <div className="wave-tag">
          <span>WAVE</span>
          <b>{String(wave).padStart(2, '0')}</b>
        </div>
        <div className={`phase-pill ${phase}`}>
          <i />
          {phaseText}
          <LiveText as="em" select={phaseDetail} />
        </div>
      </div>
      {survival ? (
        <div className="reactor survival-mode" data-testid="survival-banner">
          <div className="reactor-label">
            <span>SURVIVAL · HUNTED · ONE LIFE</span>
            <LiveText as="b" select={(s) => `${Math.ceil(hullOf(s) * 100)}%`} />
          </div>
          <LiveBar select={(s) => ({ value: hullOf(s), tone: hullOf(s) < 0.3 ? 'red' : hullOf(s) < 0.6 ? 'amber' : 'white' })} segments={30} className="big" />
        </div>
      ) : (
      <div className="reactor">
        <div className="reactor-label">
          <span>REACTOR INTEGRITY</span>
          {hit && <span className="alert">▲ UNDER ATTACK</span>}
          <LiveText as="b" select={(s) => `${Math.ceil(reactorOf(s) * 100)}%`} />
        </div>
        <LiveBar select={(s) => ({ value: reactorOf(s), tone: reactorOf(s) < 0.3 ? 'red' : reactorOf(s) < 0.6 ? 'amber' : 'cyan' })} segments={30} className="big" />
      </div>
      )}
    </div>
  );
}

export function Cores() {
  const [gains, setGains] = useState<{ id: number; v: number }[]>([]);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('coresGained', (v) => {
      const my = ++id;
      setBump(my);
      setGains((g) => [...g.slice(-3), { id: my, v }]);
      setTimeout(() => setGains((g) => g.filter((x) => x.id !== my)), 1000);
    });
  }, []);
  return (
    <div className="cores panel-frame">
      <svg className="gem" viewBox="0 0 24 24" width="26" height="26">
        <path d="M12 2 L21 9 L12 22 L3 9 Z" />
        <path d="M3 9 H21 M12 2 L8 9 L12 22 L16 9 Z" className="facet" />
      </svg>
      <div className="cores-text">
        <LiveText key={bump} as="div" className="value" select={(s) => Math.floor(s.cores)} />
        <div className="label">CORES</div>
      </div>
      <div className="gains">
        {gains.map((g) => (
          <div key={g.id} className="gain">
            +{g.v}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Threat tier, salvage (unsecured vs secured) and checkpoint progress. */
export function RunPanel() {
  const run = useHud((s) => s.run);
  const cargo = useHud((s) => s.cargo);
  const cargoMax = useHud((s) => s.cargoMax);
  const [gains, setGains] = useState<{ id: number; v: number }[]>([]);
  useEffect(() => {
    let id = 0;
    return uiEvents.on('salvageGained', (v) => {
      const my = ++id;
      setGains((g) => [...g.slice(-2), { id: my, v }]);
      setTimeout(() => setGains((g) => g.filter((x) => x.id !== my)), 900);
    });
  }, []);
  const [cgains, setCgains] = useState<{ id: number; v: number; c: boolean }[]>([]);
  useEffect(() => {
    let id = 0;
    const push = (v: number, c: boolean) => {
      if (!v) return;
      const my = ++id;
      setCgains((g) => [...g.slice(-2), { id: my, v, c }]);
      setTimeout(() => setCgains((g) => g.filter((x) => x.id !== my)), 1100);
    };
    const a = uiEvents.on('creditsGained', (v) => push(v, false));
    const b = uiEvents.on('componentsGained', (v) => push(v, true));
    return () => {
      a();
      b();
    };
  }, []);
  if (!run) return null;
  const tier = getTier(run.tier);
  return (
    <div className="run-panel panel-frame">
      <div className="flex items-baseline gap-[8px] mb-[4px]">
        <span className="font-display font-[700] text-[15px] tracking-[0.14em] text-amber">TIER {tier.roman}</span>
        <span className="text-[10px] tracking-[0.2em] text-faint">{tier.name}</span>
      </div>
      <div className="rp-row">
        <span>Salvage at risk</span><b className="unsec">{run.salvageUnsecured}</b>
        <div className="gains">{gains.map(g => <div key={g.id} className="gain">+{g.v}</div>)}</div>
      </div>
      {run.salvageSecured > 0 && <div className="rp-row"><span>Banked salvage</span><b className="sec">{run.salvageSecured}</b></div>}
      {run.creditsUnsecured + run.creditsSecured > 0 && <div className="rp-row"><span>Credits <small>held / banked</small></span><b>{run.creditsUnsecured} / {run.creditsSecured}</b></div>}
      {(run.xpUnsecured ?? 0) + (run.xpSecured ?? 0) > 0 && <div className="rp-row res-xp" title={currencyTooltip('xp')}><span>Warden XP <small>at risk / banked</small></span><b data-testid="run-xp">{run.xpUnsecured ?? 0} / {run.xpSecured ?? 0}</b></div>}
      {run.componentsUnsecured + run.componentsSecured > 0 && <div className="rp-row"><span>Components <small>held / banked</small></span><b>{run.componentsUnsecured} / {run.componentsSecured}</b></div>}
      <div className="rp-row">
        <span>Cargo <BoundKey action="inventory" /></span><b>{cargo} / {cargoMax}</b>
        <div className="gains">{cgains.map(g => <div key={g.id} className={`gain ${g.c ? 'comp' : 'cr'}`}>+{g.v} {g.c ? 'COMP' : 'CR'}</div>)}</div>
      </div>
      <div className={`rp-cp ${run.checkpointOpen ? 'open' : ''}`}>{run.checkpointOpen ? <>CHECKPOINT · <BoundKey action="checkpoint" /> RETURN TO HQ</> : `Checkpoint · Wave ${run.nextCheckpoint}`}</div>
    </div>
  );
}

export function PlayerPanel() {
  const low = useHud((s) => s.playerHp / s.playerMax < 0.35);
  const max = useHud((s) => Math.round(s.playerMax));
  const hasShield = useHud((s) => s.playerShieldMax > 0);
  const charges = useHud((s) => s.dashCharges);
  const dashMax = useHud((s) => s.dashMax);
  const recharge = useLiveStyle((s) => s.dashRecharge, (st, v) => (st.transform = `scaleX(${v})`));
  return (
    <div className={`bottom-left panel-frame ${low ? 'low' : ''}`}>
      <div className="vitals">
        <div className="hp-num">
          <LiveText as="b" select={(s) => Math.ceil(s.playerHp)} />
          <span>/{max}</span>
        </div>
        <div className="flex-[1]">
          <div className="label">DRONE INTEGRITY</div>
          <LiveBar select={(s) => ({ value: s.playerHp / s.playerMax, tone: s.playerHp / s.playerMax < 0.35 ? 'red' : 'white' })} segments={10} className="big" />
        </div>
      </div>
      {hasShield && (
        <div className="shield-row">
          <span className="label">SHIELD</span>
          <LiveBar select={(s) => ({ value: s.playerShield / Math.max(1, s.playerShieldMax), tone: 'cyan' })} segments={12} />
          <LiveText as="b" select={(s) => Math.ceil(s.playerShield)} />
        </div>
      )}
      <div className="dash">
        <span className="label">
          DASH <BoundKey action="dash" />
        </span>
        <div className="chevrons flex gap-[4px]">
          {Array.from({ length: dashMax }, (_, i) => (
            <span key={i} className={`chev ${i < charges ? 'full' : ''}`}>
              {i === charges && <i ref={recharge} />}
            </span>
          ))}
        </div>
      </div>
      <MoveRow />
    </div>
  );
}

/** Grapple and ground pound cooldowns (slide and wall-run have no cooldown worth showing). */
function MoveChip({ label, action, kind }: { label: string; action: string; kind: 'grapple' | 'pound' }) {
  const max = (s: HudState) => (kind === 'grapple' ? s.moves.grappleMax : s.moves.poundMax);
  const cd = (s: HudState) => (kind === 'grapple' ? s.moves.grapple : s.moves.pound);
  const state = useHud((s) => (s.moves.state === kind ? 'active' : cd(s) > 0 ? 'cooling' : 'ready'));
  const fill = useLiveStyle((s) => (max(s) > 0 ? Math.max(0, Math.min(1, 1 - cd(s) / max(s))) : 1), (st, v) => (st.transform = `scaleX(${v})`));
  return (
    <span className={`mv-chip ${state}`}>
      <BoundKey action={action} /> {label}
      <i ref={fill} />
    </span>
  );
}

function MoveRow() {
  const state = useHud((s) => s.moves.state);
  const contextual = useHud((s) => s.phase === 'combat' && !s.buildMode);
  const ready = useHud((s) => s.moves.grapple <= 0 && s.moves.pound <= 0);
  if (contextual && ready && !state) return null;
  return (
    <div className="movement-row flex gap-[6px] items-center mt-[6px] text-[10px] tracking-[0.08em]">
      <MoveChip label="GRAPPLE" action="grapple" kind="grapple" />
      <MoveChip label="POUND" action="slide" kind="pound" />
      {state === 'slide' && <b className="mv-state">SLIDE</b>}
      {state === 'wall' && <b className="mv-state">WALL-RUN</b>}
    </div>
  );
}

export function CenterPanel() {
  const active = useHud((s) => s.tacticalActive);
  const min = useHud((s) => s.tacticalMin);
  const low = useHud((s) => s.tactical < s.tacticalMin);
  const build = useHud((s) => s.buildMode);
  const valid = useHud((s) => s.buildValid);
  const msg = useHud((s) => s.buildMessage);
  const cost = useHud((s) => s.buildCost);
  const cores = useHud((s) => s.cores);
  const inspect = useHud((s) => s.inspect);
  const m5 = useHud((s) => s.m5);
  return (
    <div className="bottom-center">
      {build && (
        <div className={`build-panel panel-frame ${valid ? 'ok' : 'bad'}`}>
          <div className="bp-head">
            <span className="bp-icon">◈</span>
            <span className="bp-title">{m5?.template ?? 'TOWER'}</span>
            <span className={cores >= cost ? 'cost' : 'cost bad'}>◆ {cost}</span>
          </div>
          <div className="status">
            <i />
            {msg}
          </div>
          <div className="keys">
            <Key k="C" /> weapon <Key k="V" /> core <Key k="N" /> mod <Key k="M" /> base · <Key k="LMB" /> place <Key k="RMB" /> cancel {active ? <span className="rapid">RAPID PLACEMENT</span> : <><BoundKey action="tactical" /> tactical</>}
          </div>
        </div>
      )}
      {!build && inspect && (
        <div className="inspect-panel panel-frame">
          <div className="bp-head">
            <span className="bp-icon">◈</span>
            <span className="bp-title">{inspect.name}</span>
          </div>
          <div className="stat-row">
            <div>
              <b>{inspect.kills}</b>
              <span>KILLS</span>
            </div>
            <div>
              <b>{inspect.damage}</b>
              <span>DAMAGE</span>
            </div>
            <div>
              <b>◆{inspect.refund}</b>
              <span>REFUND</span>
            </div>
          </div>
          {inspect.card && (
            <div className="tc" data-testid="tower-card">
              <div className="tc-line"><span>L{inspect.card.level}/{inspect.card.maxLevel} · {inspect.card.base}</span><b>{inspect.card.st.dps.toFixed(0)} DPS</b>{inspect.card.empowered && <em className="emp">EMPOWERED</em>}</div>
              {inspect.card.slots.map((sl) => (
                <div key={sl.slot} className="tc-line">
                  <span>{sl.slot.toUpperCase()}</span>
                  <b>{sl.name}</b>
                  {sl.next ? <small>→ {sl.next} ◆{sl.nextCost}</small> : <small>—</small>}
                </div>
              ))}
              <div className="keys">
                <Key k="R" /> level {inspect.card.level < inspect.card.maxLevel ? `◆${inspect.card.levelCost}` : 'MAX'} <Key k="C" /> weapon <Key k="V" /> core <Key k="N" /> modifier
              </div>
              {inspect.edit && <div className="tc-warn">{inspect.edit}</div>}
            </div>
          )}
          {inspect.hp && (
            <div className={`tower-hp ${inspect.hp.wrecked ? 'wrecked' : ''}`} data-testid="tower-hp">
              <div className="tc-line">
                <span>{inspect.hp.wrecked ? 'WRECKED · NOT FIRING, NOT BLOCKING' : 'STRUCTURE'}</span>
                <b>{inspect.hp.wrecked ? '0' : inspect.hp.hp} / {inspect.hp.max}</b>
              </div>
              <SegBar value={inspect.hp.wrecked ? 0 : inspect.hp.hp / Math.max(1, inspect.hp.max)} tone={inspect.hp.wrecked || inspect.hp.hp < inspect.hp.max * 0.35 ? 'red' : 'cyan'} segments={16} />
              {inspect.hp.repair > 0 && (
                <div className="keys">
                  <BoundKey action="repair" /> {inspect.hp.wrecked ? 'rebuild' : 'repair'} ◆{inspect.hp.repair}
                </div>
              )}
            </div>
          )}
          <div className="keys">
            Hold <BoundKey action="recycle" /> to recycle
          </div>
          {inspect.recycle > 0 && <SegBar value={inspect.recycle} tone="amber" segments={12} />}
        </div>
      )}
      <div className={`tactical ${active ? 'active' : ''} ${low && !active ? 'low' : ''}`}>
        <div className="tac-label">
          <BoundKey action="tactical" />
          <span>TACTICAL</span>
          <em>{active ? 'TIME DILATED' : low ? 'RECHARGING' : 'READY'}</em>
        </div>
        <LiveBar select={(s) => ({ value: s.tactical, tone: 'violet' })} segments={24} marker={min} />
      </div>
    </div>
  );
}

const ABILITY_KEY = { ability: 'RMB', ability2: 'F', ultimate: 'T' } as const;

type AbilityRow = HudState['abilities'][number];

/** One ability slot: structure from React (name, slot), cooldown text and fill from the live snapshot. */
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
    (st, v) => (st.transform = `scaleX(${v})`),
  );
  return (
    <div className={`ab-slot ${ult ? 'ult' : ''} ${state}`} title={name}>
      <kbd>{ABILITY_KEY[slot]}</kbd>
      <span className="ab-name">{name}</span>
      <LiveText
        className="ab-state"
        select={(s) => {
          const r = row(s);
          return !r ? '' : r.active > 0 ? `${r.active.toFixed(1)}s` : r.ready ? 'READY' : ult ? `${Math.floor(r.cd * 100)}%` : `${r.cd.toFixed(1)}s`;
        }}
      />
      <i className="ab-fill" ref={fill} />
    </div>
  );
}

/** Ability I/II cooldowns and the ultimate charge, stacked above the weapon card. */
function AbilityBar() {
  // Re-renders only when the set of slots (or their names) changes.
  const slots = useHud((s) => s.abilities.map((r) => `${r.slot}:${r.name}`).join('|'));
  if (!slots) return null;
  return (
    <div className="ability-bar">
      {slots.split('|').map((k) => {
        const [slot, ...name] = k.split(':');
        return <AbilitySlot key={slot} slot={slot as AbilityRow['slot']} name={name.join(':')} />;
      })}
    </div>
  );
}

export function WeaponPanel() {
  const name = useHud((s) => s.weaponName);
  const holster = useHud((s) => s.holster);
  const element = useHud((s) => s.weaponElement);
  const aff = useHud((s) => s.weaponAff);
  const hot = useHud((s) => s.overheated);
  const build = useHud((s) => s.buildMode);
  const survival = useHud((s) => s.mode === 'survival');
  return (
    <div className={`bottom-right ${build ? 'stowed' : ''}`}>
      <AbilityBar />
      <div className="weapon-card panel-frame">
        <div className="wc-head">
          <span className="weapon">{name}</span>
          <ElementTag element={element} />
          {aff !== 0 && <span className={`el-aff ${aff > 0 ? 'weak' : 'resist'}`} title={aff > 0 ? 'This sector\'s faction is weak to this element' : 'This sector\'s faction resists this element'}>{aff > 0 ? '▲ WEAK' : '▼ RESIST'}</span>}
          <span className="ammo">∞</span>
        </div>
        <LiveBar select={(s) => ({ value: s.heat, tone: s.overheated ? 'red' : s.heat > 0.7 ? 'amber' : 'heat' })} segments={20} />
        <LiveText as="div" className={`label heat-label ${hot ? 'warn' : ''}`} select={(s) => (s.overheated ? 'OVERHEATED · VENTING' : `HEAT ${Math.round(s.heat * 100)}%`)} />
        {holster && (
          <div className={`wc-holster ${holster.overheated ? 'warn' : ''}`}>
            <BoundKey action="swap" />
            <span className="wh-name">{holster.secondary ? 'SECONDARY' : 'PRIMARY'} · {holster.name}</span>
            <ElementTag element={holster.element} />
            {holster.aff !== 0 && <span className={`el-aff ${holster.aff > 0 ? 'weak' : 'resist'}`}>{holster.aff > 0 ? '▲' : '▼'}</span>}
            <span className="wh-heat">{holster.overheated ? 'VENTING' : holster.heat > 0.01 ? `${Math.round(holster.heat * 100)}%` : 'READY'}</span>
          </div>
        )}
      </div>
      <div className="slots">
        <span className={!build ? 'on' : ''}>
          <Key k="1" /> WEAPON
        </span>
        {!survival && (
          <span className={build ? 'on' : ''}>
            <Key k="2" /> BUILD
          </span>
        )}
      </div>
    </div>
  );
}

export function Banner() {
  const [b, setB] = useState<(BannerEvent & { id: number }) | null>(null);
  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout>;
    const off = uiEvents.on('banner', (e) => {
      setB({ ...e, id: ++id });
      clearTimeout(timer);
      timer = setTimeout(() => setB(null), 3000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  if (!b) return null;
  return (
    <div key={b.id} className={`banner ${b.tone}`}>
      <div className="rule" />
      <div className="t" data-text={b.title}>
        {b.title}
      </div>
      {b.sub && <div className="s">{b.sub}</div>}
      <div className="rule" />
    </div>
  );
}

export function Hint() {
  const hint = useHud((s) => s.hint);
  return hint ? (
    <div key={hint} className="hint">
      <span className="hint-tag">INTEL</span>
      {hint}
    </div>
  ) : null;
}

export function Respawn() {
  const down = useHud((s) => s.respawnIn > 0);
  const survival = useHud((s) => s.mode === 'survival');
  const team = useHud((s) => !!s.coop);
  if (!down) return null;
  if (survival)
    return (
      <div className="respawn">
        <div className="glitch" data-text="DRONE LOST">
          DRONE LOST
        </div>
        <small>{team ? 'Survival: one life. Your team fights on; you rejoin when the node is secured.' : 'Survival: one life.'}</small>
      </div>
    );
  return (
    <div className="respawn">
      <div className="glitch" data-text="DRONE DISABLED">
        DRONE DISABLED
      </div>
      <div className="reboot">
        REBOOTING <LiveText as="b" select={(s) => `${s.respawnIn.toFixed(1)}s`} />
      </div>
      <small>Turrets remain online</small>
    </div>
  );
}

export function Perf() {
  const p = useHud((s) => s.perf);
  if (!p) return null;
  return (
    <div className="perf">
      {p.fps} FPS · {p.enemies} enemies · {p.towers ?? 0} towers · {p.projectiles ?? 0} proj · {p.draws} draws · {p.particles} particles
      <br />
      fx queue {p.pending ?? 0} · {p.effects ?? 0} effects · {p.triggers ?? 0} triggers/s · {p.statuses ?? 0} statuses · dropped {p.dropped ?? 0} · dps player {p.dpsPlayer ?? 0} / tower {p.dpsTower ?? 0}
      <br />
      sim {p.frameMs ?? 0} ms · AI {p.aiMs ?? 0} ms · telegraphs {p.telegraphs ?? 0} · ordnance {p.ordnance ?? 0} · wave {p.wave} · tier {p.tier} · event {p.event} · boss {p.boss} · budget {p.budget} · spawn queue {p.spawnQueue} · elites {p.elites} · hp ×{p.hpMult} · dmg ×{p.dmgMult}
      {p.dev ? ' · DEV SESSION' : ''}
    </div>
  );
}
