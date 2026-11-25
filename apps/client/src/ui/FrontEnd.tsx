// Front end (final UI design): main menu and pause menu. Menu rows on the left over the blurred world, an aside on
// the right (live status, or the open sheet), currencies + breadcrumb on top, key hints + primary action at the bottom.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Flow } from '../core/Flow';
import { AccountPanel } from '../account/AccountPanel';
import { useAccount } from '../account/store';
import { BoundKey } from './hud/widgets';
import { CoopPanel } from './Coop';
import { MENU_SECTIONS, type MenuSection, useMenuSection } from './router';
import { SettingsScreen } from './SettingsPanel';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { levelInfo } from '@riftwarden/rules/progression/level';
import { freePoints } from '@riftwarden/rules/progression/skilltree';
import { readiness, recommendedLevel } from '@riftwarden/rules/progression/riftLevel';
import { resumable } from '@riftwarden/rules/runmap/state';
import { seasonEnd, seasonOf } from '@riftwarden/rules/progression/seasons';
import { FieldArt } from './FieldArt';
import { touchStore } from '../touch/touchMode';
import { InstallApp } from '../touch/MobileUi';
import { useHud } from './useHud';
import { useSave } from './useSave';
import { savePower } from './RiftLevel';
import { Backdrop, Bar, Crumb, Cur, Hint, RiskTag } from './ds';

const CONTROLS = [
  [<BoundKey action="move" />, 'Move'],
  [<kbd>MOUSE</kbd>, 'Aim · LMB fire'],
  [<BoundKey action="jump" />, 'Jump · press again for a directional boost'],
  [<BoundKey action="dash" />, 'Dash · hold to sprint'],
  [<BoundKey action="slide" />, 'Slide while running · ground pound in the air'],
  [<><BoundKey action="grapple" /><kbd>MMB</kbd></>, 'Grapple to the surface under the crosshair · jump releases'],
  [<kbd>WALL</kbd>, 'Run along a wall in the air · jump kicks off it'],
  [<BoundKey action="use" />, 'Use terminal or pick up loot'],
  [<><BoundKey action="inventory" /><kbd>TAB</kbd></>, 'Drone cargo'],
  [<><BoundKey action="swap" /><kbd>1</kbd></>, 'Swap to the other weapon (or mouse wheel) · 1 primary (the holstered one cools)'],
  [<kbd>RMB</kbd>, 'Ability I (equip ability items in the ABILITY slots)'],
  [<BoundKey action="repair" />, 'Ability II · repairs the tower under the crosshair on mazing arenas'],
  [<kbd>T</kbd>, 'Ultimate during a wave (charges from the damage you deal) · tower panel in preparation'],
  [<><BoundKey action="build" /><kbd>2</kbd></>, 'Build tower · C/V/N/M cycle parts'],
  [<kbd>T</kbd>, 'Tower engineering during preparation'],
  [<kbd>R/C/V/N</kbd>, 'Aim at a tower to level or refit it'],
  [<kbd>U</kbd>, 'Run build overview'],
  [<BoundKey action="tactical" />, 'Tactical slow-time'],
  [<BoundKey action="recycle" />, 'Hold to recycle a turret'],
  [<BoundKey action="wave" />, 'Start wave early'],
  [<BoundKey action="checkpoint" />, 'Run map once a node is secured: travel to the next node or extract to HQ'],
  [<kbd>ESC</kbd>, 'Pause or close terminal'],
  [<kbd>F3</kbd>, 'Performance stats'],
] as const;

const BRIEFING = [
  ['Deploy from headquarters', <>Use the deployment terminal with <BoundKey action="use" /> to pick a Rift Level.</>],
  ['Hold the reactor', <>Build turrets between waves. Collect equipment and salvage from fallen machines with <BoundKey action="use" />.</>],
  ['Bank your salvage', 'Every five waves, a checkpoint secures your haul. Return home or stay for another wave. Losing the reactor costs your unsecured cargo.'],
] as const;

const TOUCH_CONTROLS = [
  ['LEFT THUMB', 'Move: the stick appears where you touch · push past the ring to sprint'],
  ['RIGHT SIDE', 'Drag anywhere to aim · drag the FIRE button to aim while firing'],
  ['JUMP · DASH', 'Jump (again in the air for a boost) · dash'],
  ['SLIDE · HOOK', 'Slide while running, ground pound in the air · grapple to the surface under the crosshair'],
  ['ABILITIES', 'Ability buttons above FIRE · ULT appears during waves'],
  ['BUILD', 'Build mode: FIRE becomes PLACE, CANCEL leaves, WPN/CORE/MOD/BASE cycle parts'],
  ['TOWER', 'Aim at a tower: LEVEL, REPAIR, hold RECYCLE'],
  ['TOP RIGHT', 'Start wave · build · towers · slow time · run map · cargo · pause'],
] as const;

export function Controls() {
  const touch = useSyncExternalStore(touchStore.subscribe, touchStore.get);
  if (touch)
    return (
      <div className="grid gap-[9px] text-[15px] text-muted" data-testid="touch-legend">
        {TOUCH_CONTROLS.map(([k, v]) => (
          <div key={k} className="flex items-center gap-[8px]">
            <kbd className="min-w-[96px] text-center">{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
    );
  return (
    <div className="grid grid-cols-[1fr] gap-y-[9px] text-[14px] text-muted">
      {CONTROLS.map(([k, v]) => (
        <div key={v} className="flex items-center gap-[8px]">
          <span className="flex min-w-[78px] flex-wrap items-center gap-[3px] [&_kbd]:m-0">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Briefing() {
  return (
    <>
      <FieldArt name="hub-reactor" className="menu-brief-art" />
      <ol className="m-0 py-0 pr-0 pl-[22px]">
        {BRIEFING.map(([title, detail]) => (
          <li key={title} className="mt-[15px] pl-[6px] marker:font-mono marker:text-[12px] marker:text-orange">
            <b className="ds-h3">{title}</b>
            <p className="ds-body mt-[5px]">{detail}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Warden mark: the diamond insignia with the rift bolt. */
export function WardenMark({ size = 58 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 58 58">
      <path d="M29 2 L56 29 L29 56 L2 29 Z" fill="none" stroke="#ff8a3d" strokeWidth="2" />
      <path d="M29 12 L46 29 L29 46 L12 29 Z" fill="rgba(255,138,61,0.15)" stroke="#ff8a3d" strokeWidth="1" />
      <path d="M31 14 L26 29 L32 31 L27 44" fill="none" stroke="#fff2e6" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}

/** Up/down + Enter over a list of actions (menus). Ignored while typing. */
function useMenuKeys(count: number, run: (i: number) => void, enabled = true): [number, (i: number) => void] {
  const [sel, setSel] = useState(0);
  const ref = useRef({ sel, count, run });
  ref.current = { sel, count, run };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      const { sel: s, count: n, run: go } = ref.current;
      if (e.code === 'ArrowDown') { e.preventDefault(); setSel((s + 1) % n); }
      else if (e.code === 'ArrowUp') { e.preventDefault(); setSel((s - 1 + n) % n); }
      else if (e.code === 'Enter' && !(t instanceof HTMLButtonElement)) { e.preventDefault(); go(s); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
  return [sel, setSel];
}

const SECTION_NOTE: Partial<Record<MenuSection, string>> = { 'co-op': 'Squad up · 2-4 wardens', account: 'Passkey · sync', briefing: 'How a run works' };

function Sheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <section className="menu-sheet ds-abs ds-glass ds-cut ds-col" aria-label={title}
      style={{ right: 44, top: 74, bottom: 84, width: 'min(560px, calc(100vw - 560px))', minWidth: 360, padding: '22px 26px', gap: 14, overflowY: 'auto' }}>
      <div className="menu-sheet-head ds-row"><h2 className="ds-h2 ds-grow">{title}</h2><button className="ds-btn" style={{ minHeight: 36, padding: '0 14px' }} aria-label="Back to main menu" onClick={close}>BACK</button></div>
      {children}
    </section>
  );
}

export function MainMenu({ flow }: { flow: Flow }) {
  const [tab, setTab] = useMenuSection();
  const save = useSave(flow);
  const account = useAccount();
  const tier = getTier(save.threat.selected);
  const info = levelInfo(save.progress.xp);
  const points = freePoints(info.level, save.progress.tree.allocated);
  const power = savePower(save);
  const ready = readiness(power, tier.id);
  const rec = recommendedLevel(power, save.threat.unlocked);
  const run = save.activeRun;
  const canResume = !!run && resumable(run.map);
  const now = Date.now();
  const season = seasonOf(now);
  const days = Math.max(0, Math.ceil((seasonEnd(season) - now) / 86_400_000));
  const record = save.records[String(tier.id)];
  const sections = Object.keys(MENU_SECTIONS) as MenuSection[];
  const items: { id: string; title: string; badge?: string; solid?: boolean; go: () => void }[] = [
    ...(canResume ? [{ id: 'resume', title: 'Resume operation', badge: `ACT ${run!.map?.act ?? 1} · NODE ${(run!.map?.path.length ?? 0) + 1}`, go: () => void flow.enterHq() }] : []),
    ...sections.map((s) => ({ id: s, title: MENU_SECTIONS[s], badge: s === 'account' && account.status === 'signedIn' ? 'SIGNED IN' : undefined, go: () => setTab(tab === s ? null : s) })),
  ];
  const all = [{ id: 'deploy', title: 'Deploy', go: () => void flow.enterHq() }, ...items];
  const [sel, setSel] = useMenuKeys(all.length, (i) => all[i].go(), tab !== 'settings');
  const close = useRef(setTab);
  close.current = setTab;
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current(null); };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, []);
  const name = account.account?.name ?? 'GUEST';
  if (tab === 'settings') return <SettingsScreen flow={flow} from="Main menu" close={() => setTab(null)} />;
  const sync = account.status === 'signedIn' ? 'synced' : account.status === 'offline' ? 'offline · playing locally' : 'progress on this device';
  return (
    <main className="screen menu ds-scr">
      <Backdrop />
      <div className="ds-scrim-b" />
      <div className="ds-top">
        <span className="ds-mono">RW-OPS // HQ-01 · {account.status === 'signedIn' ? 'ONLINE' : account.status === 'offline' ? 'OFFLINE' : 'LOCAL'}</span>
        <span className="ds-grow" />
        <Cur k="credits" value={save.resources.credits} />
        {save.resources.shards > 0 && <Cur k="shards" value={save.resources.shards} />}
      </div>
      <button className="menu-identity ds-abs ds-row" aria-label="Riftwarden main menu" onClick={() => setTab(null)} style={{ left: 56, top: 70, gap: 18, background: 'none', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        <WardenMark />
        <span className="ds-col">
          <span style={{ font: "800 64px/0.9 var(--ds-d)", letterSpacing: '0.16em' }}>RIFTWARDEN</span>
          <span className="ds-ov ds-em" style={{ letterSpacing: '0.42em' }}>Season {season} · {days} day{days === 1 ? '' : 's'} left</span>
        </span>
      </button>

      <nav aria-label="Main menu" className="menu-nav ds-abs ds-menu" style={{ left: 44, top: 206, width: 470 }}>
        <button className={`deploy ds-menu-item ${sel === 0 ? 'ds-sel' : ''}`} onMouseEnter={() => setSel(0)} onClick={() => void flow.enterHq()}>
          <span className="ds-row" style={{ alignItems: 'baseline', gap: 14 }}>
            <span className="ds-mono">01</span>
            <span className="ds-menu-title">DEPLOY</span>
          </span>
          <span className="ds-menu-sub">Enter headquarters · Rift Level {tier.id} {tier.name} · gear {ready}{rec !== tier.id ? ` (suggested RL ${rec})` : ''}</span>
        </button>
        {items.map((m, i) => (
          <button key={m.id} aria-pressed={tab === m.id} className={`ds-menu-item ${sel === i + 1 ? 'ds-sel' : ''}`} onMouseEnter={() => setSel(i + 1)} onClick={m.go}>
            {sel === i + 1 ? (
              <span className="ds-row" style={{ alignItems: 'baseline', gap: 14 }}><span className="ds-mono">{String(i + 2).padStart(2, '0')}</span><span className="ds-menu-title">{m.title}</span><span className="ds-grow" />{m.badge && <span className="ds-chip">{m.badge}</span>}</span>
            ) : (
              <><span className="ds-mono">{String(i + 2).padStart(2, '0')}</span><span>{m.title}</span><span className="ds-grow" />{m.badge && <span className="ds-chip">{m.badge}</span>}</>
            )}
            {sel === i + 1 && SECTION_NOTE[m.id as MenuSection] && <span className="ds-menu-sub">{SECTION_NOTE[m.id as MenuSection]}</span>}
          </button>
        ))}
      </nav>

      {tab === null ? (
        <aside className="menu-hero ds-abs ds-col" style={{ right: 48, top: 74, width: 400, gap: 12 }}>
          <div className="ds-glass ds-cut-tr ds-col" style={{ padding: '18px 20px', gap: 8, boxShadow: 'inset 0 0 0 1px rgba(255,138,61,0.35)' }}>
            <span className="ds-ov ds-em">Rift Level</span>
            <span className="ds-row" style={{ alignItems: 'flex-end' }}>
              <span className="ds-col ds-grow"><span style={{ font: '700 34px/0.9 var(--ds-d)' }}>RL {tier.id} · {tier.name.toUpperCase()}</span><span className="ds-meta">Gear readiness: {ready} · {save.threat.unlocked} unlocked</span></span>
              <span className="ds-num">{record?.bestWave ?? 0}<span style={{ fontSize: 16, color: 'var(--ds-dim)' }}> best wave</span></span>
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <div className="ds-glass ds-cut-tr ds-col" style={{ padding: '14px 16px', gap: 4, borderTop: '2px solid #b9ece0' }}><span className="ds-lbl">Operations</span><span className="ds-num">{save.totals.runs.toLocaleString()}</span><span className="ds-meta" style={{ color: 'var(--ds-muted)' }}>{Object.values(save.records).reduce((n, r) => n + (r?.checkpoints ?? 0), 0)} checkpoints banked</span></div>
            <div className="ds-glass ds-cut-tr ds-col" style={{ padding: '14px 16px', gap: 4, borderTop: '2px solid #edb282' }}><span className="ds-lbl">Salvage</span><span className="ds-num">{save.resources.salvage.toLocaleString()}</span><span className="ds-meta" style={{ color: 'var(--ds-muted)' }}>secured in storage</span></div>
          </div>
          {canResume && <div className="ds-glass ds-toast risk"><span className="ds-dot" style={{ background: 'var(--ds-risk)' }} /><span className="ds-col"><b>Operation suspended</b><span className="ds-meta">Resume or end it at the deployment console</span></span></div>}
          <InstallApp />
        </aside>
      ) : (
        <Sheet title={MENU_SECTIONS[tab]} close={() => setTab(null)}>
          {tab === 'briefing' && <Briefing />}
          {tab === 'co-op' && <CoopPanel flow={flow} compact />}
          {tab === 'account' && <AccountPanel />}
          {tab === 'controls' && <Controls />}
        </Sheet>
      )}

      <footer className="menu-ledger ds-abs ds-row" style={{ left: 56, bottom: 30, gap: 14 }}>
        <div className="ds-cut-s" aria-hidden="true" style={{ width: 52, height: 52, background: 'linear-gradient(135deg, #ff8a3d, #7a3410)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 26px var(--ds-d)' }}>{info.level}</div>
        <div className="ds-col" style={{ gap: 4, width: 300 }}>
          <span className="ds-row" style={{ alignItems: 'baseline' }}><span className="ds-h3" style={{ fontSize: 22 }}>{name}</span><span className="ds-meta">Warden{points > 0 ? ` · ${points} skill point${points > 1 ? 's' : ''}` : ''} · {sync}</span></span>
          <Bar value={info.frac} color="#ff8a3d" />
          <span className="ds-mono">{info.into.toLocaleString()} / {info.need.toLocaleString()} XP</span>
        </div>
      </footer>
      <div className="ds-abs ds-row" style={{ right: 48, bottom: 34, gap: 22 }}>
        <Hint keys="↑↓">Navigate</Hint>
        <Hint keys="ENTER">Select</Hint>
      </div>
      <div className="ds-grain" />
    </main>
  );
}

export function PauseMenu({ flow }: { flow: Flow }) {
  const [tab, setTab] = useState<'settings' | 'controls' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [resuming, setResuming] = useState(false);
  const run = useHud((s) => s.run);
  const wave = useHud((s) => s.wave);
  const cargo = useHud((s) => s.cargo);
  const node = useHud((s) => s.node);
  const coop = useHud((s) => s.coop);
  const builds = useHud((s) => s.m5?.upgrades ?? 0);
  const inArena = flow.location === 'arena';
  const resume = useCallback(() => {
    if (resuming) return;
    setResuming(true);
    if (inArena) void flow.arena?.resume();
    else void flow.home?.takeControl();
    // Re-enable if pointer lock was denied outright so the menu isn't stuck.
    window.setTimeout(() => setResuming(false), 4000);
  }, [flow, inArena, resuming]);
  const rows: { id: string; label: string; danger?: boolean; go: () => void }[] = [
    { id: 'resume', label: resuming ? 'Resuming…' : 'Resume', go: resume },
    { id: 'settings', label: 'Settings', go: () => setTab(tab === 'settings' ? null : 'settings') },
    { id: 'controls', label: 'Controls', go: () => setTab(tab === 'controls' ? null : 'controls') },
    ...(inArena ? [{ id: 'abandon', label: 'Abandon run', danger: true, go: () => setConfirm(true) }] : []),
  ];
  const [sel, setSel] = useMenuKeys(rows.length, (i) => rows[i].go(), !confirm && tab !== 'settings');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.code !== 'Escape') return;
      e.preventDefault();
      if (confirm) setConfirm(false);
      else if (tab) setTab(null);
      else resume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, resume, tab]);
  const rl = flow.arena?.cfg.tier.id ?? flow.run?.tier ?? 1;
  if (tab === 'settings') return <SettingsScreen flow={flow} from={inArena ? 'Pause' : 'Headquarters · pause'} close={() => setTab(null)} />;
  const at = run ? run.salvageUnsecured : 0;
  return (
    <div className="screen dim ds-scr">
      <Backdrop />
      <div className="ds-top">
        <Crumb parts={inArena ? ['Run', node?.name ?? `Sector · RL ${rl}`, 'Paused'] : ['Headquarters', 'Paused']} />
        <span className="ds-grow" />
        <span className="ds-mono">{coop ? 'CO-OP · WORLD KEEPS RUNNING' : 'SOLO · WORLD PAUSED'}</span>
      </div>
      <div className="ds-abs ds-col" style={{ left: 44, top: 84, gap: 4 }}>
        <span className="ds-ov">{inArena ? `Wave ${wave} · Rift Level ${rl}` : 'Headquarters'}</span>
        <span className="ds-hero">PAUSED</span>
      </div>
      <nav aria-label="Pause menu" className="ds-abs ds-menu" style={{ left: 32, top: 200, width: 440 }}>
        {rows.map((r, i) => (
          <button key={r.id} data-testid={`pause-${r.id}`} className={`ds-menu-item ${sel === i ? 'ds-sel' : ''} ${r.danger ? 'ds-danger' : ''}`} disabled={r.id === 'resume' && resuming}
            onMouseEnter={() => setSel(i)} onClick={r.go} style={sel === i ? { fontSize: 40, fontWeight: 700 } : undefined}>
            {r.label}
          </button>
        ))}
        {confirm && (
          <div className="confirm ds-glass ds-cut ds-col" style={{ margin: '10px 0 0 28px', padding: '16px 18px', gap: 12 }}>
            <span className="confirm-text ds-body">Abandon the run? Unsecured salvage and items are lost. Secured loot and the gear you deployed with are kept.</span>
            <div className="ds-row">
              <button className="danger ds-btn ds-danger" onClick={() => void flow.abandonRun()}>ABANDON</button>
              <button className="ds-btn" onClick={() => setConfirm(false)}>CANCEL</button>
            </div>
          </div>
        )}
      </nav>
      {tab === 'controls' ? (
        <section className="ds-abs ds-glass ds-cut ds-col" style={{ right: 44, top: 90, bottom: 90, width: 'min(560px, calc(100vw - 520px))', minWidth: 360, padding: '22px 24px', gap: 12, overflowY: 'auto' }}>
          <span className="ds-h2">CONTROLS</span>
          <Controls />
        </section>
      ) : inArena && run ? (
        <aside className="ds-abs ds-glass ds-cut ds-col" style={{ right: 44, top: 110, width: 440, padding: '22px 24px', gap: 12 }}>
          <span className="ds-h2">IF YOU LEAVE NOW</span>
          <div className="ds-col">
            <div className="ds-list-row"><span className="ds-dot" style={{ background: 'var(--ds-up)' }} /><span className="ds-grow">{run.lastBankedWave > 0 ? `Banked at wave ${run.lastBankedWave}` : 'Gear you deployed with'}</span><b className="ds-up">kept</b></div>
            <div className="ds-list-row"><span className="ds-grow"><RiskTag>{at.toLocaleString()} salvage · {cargo} item{cargo === 1 ? '' : 's'}</RiskTag></span><b className="ds-bad">lost</b></div>
            <div className="ds-list-row"><span className="ds-dot" style={{ background: '#d4b2ff' }} /><span className="ds-grow">Unbanked XP {(run.xpUnsecured ?? 0).toLocaleString()}</span><b>25% kept</b></div>
          </div>
          {builds > 0 && <span className="ds-meta">Run build: {builds} upgrade{builds > 1 ? 's' : ''} (lost when the run ends).</span>}
          <span className="ds-meta">Reach wave {run.nextCheckpoint} ({Math.max(0, run.nextCheckpoint - wave)} wave{run.nextCheckpoint - wave === 1 ? '' : 's'}) to bank everything and extract safely.</span>
          {coop && <><div className="ds-hr" /><span className="ds-lbl">Co-op</span><span className="ds-meta">In a squad the world keeps running while this menu is open.</span></>}
        </aside>
      ) : null}
      <div className="ds-bot">
        <span className="ds-grow" />
        <Hint keys="↑↓">Choose</Hint>
        <Hint keys="ESC">Resume</Hint>
        <button className="ds-btn-p" disabled={resuming} onClick={() => rows[sel].go()}><span className="ds-kd">ENTER</span>SELECT</button>
      </div>
      <div className="ds-grain" />
    </div>
  );
}
