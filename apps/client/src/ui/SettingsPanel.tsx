// Settings (final design: "Settings", "Settings · graphics / controls / audio"). One row per option: label + one
// line of help on the left, a segmented choice or slider on the right. Every control changes real behaviour and
// persists (localStorage, versioned). SettingsScreen is the full page used from the main menu and the pause menu.
import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { minimapStore, setMinimap } from './hud/minimap';
import type { Flow } from '../core/Flow';
import { InstallApp } from '../touch/MobileUi';
import { AccountPanel } from '../account/AccountPanel';
import { RETICLE_COLORS, changedBindings, isReservedKey, keyLabel, ACTIONS, DEFAULT_SETTINGS, mobileDefaults, PRESETS, type Quality, type Settings } from '@riftwarden/game/core/settings';
import { isTouchDevice } from '../touch/touchMode';
import { sfx } from '@riftwarden/game/audio/Sfx';
import { RARITY_IDS } from '@riftwarden/rules/loot/rarity';
import { Backdrop, Crumb, Hint, pips, rarityCls } from './ds';

type Tab = 'display' | 'audio' | 'controls' | 'interface' | 'access' | 'account';
const TAB_LABEL: Record<Tab, string> = { display: 'Graphics', audio: 'Audio', controls: 'Controls', interface: 'Interface', access: 'Accessibility', account: 'Account' };

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <span className="set-text"><b>{label}</b>{help && <span className="ds-meta">{help}</span>}</span>
      <span className="set-ctl">{children}</span>
    </div>
  );
}

/** A range row. With `def`, double-clicking the slider or its value restores the default. */
function Slider({ label, help, min, max, step, value, fmt, onChange, testId, def }: { label: string; help?: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; onChange: (v: number) => void; testId?: string; def?: number }) {
  const reset = def === undefined || def === value ? undefined : () => onChange(def);
  const title = def === undefined ? undefined : `Double-click to reset (${fmt(def)})`;
  return (
    <Row label={label} help={help}>
      <input className="settings-range" type="range" aria-label={label} aria-valuetext={fmt(value)} data-testid={testId} title={title} min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} onDoubleClick={reset} />
      <b className={`set-val ${def !== undefined && def !== value ? 'changed' : ''}`} title={title} onDoubleClick={reset}>{fmt(value)}</b>
    </Row>
  );
}

function Seg<T extends string>({ label, help, value, options, onChange }: { label: string; help?: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <Row label={label} help={help}>
      <span className="set-seg" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" className="set-opt" aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </span>
    </Row>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const D = DEFAULT_SETTINGS;

const TAB_KEY = 'riftwarden.settingsTab';
/** The settings page reopens on the tab used last (this device). */
function lastTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t && t in TAB_LABEL ? (t as Tab) : 'display';
  } catch {
    return 'display';
  }
}

/** Colour-vision preview: rarity tiles and the verdict arrows in the active palette (colour always with a shape). */
function VisionPreview({ mode }: { mode: Settings['colorblind'] }) {
  return (
    <aside className="set-preview ds-glass ds-cut ds-col">
      <span className="ds-lbl">Preview · {mode === 'off' ? 'default palette' : mode === 'deuteranopia' ? 'red-green' : 'blue-yellow'}</span>
      <div className="set-tiles">
        {RARITY_IDS.map((r) => <div key={r} className={`ds-tile ${rarityCls(r)}`} title={r}><span className="ds-pips set-pip">{pips(r)}</span></div>)}
      </div>
      <div className="ds-row" style={{ gap: 18 }}><span className="ds-h3 ds-up">▲ Upgrade</span><span className="ds-h3 ds-bad">▼ Downgrade</span></div>
      <span className="ds-meta">Gain and loss change colour; the arrows, pips and words stay.</span>
    </aside>
  );
}

/** Every control changes real behaviour; values persist (localStorage, versioned). */
export function SettingsPanel({ flow, compact, page, onTab }: { flow: Flow; compact?: boolean; page?: boolean; onTab?: (label: string) => void }) {
  const [s, setS] = useState<Settings>(flow.settings);
  const inArena = flow.location === 'arena';
  const tabs: Tab[] = ['display', 'audio', 'controls', 'interface', 'access', ...(page && !inArena ? (['account'] as Tab[]) : [])];
  const [tab, setTabState] = useState<Tab>(() => {
    const t = lastTab();
    return tabs.includes(t) ? t : 'display';
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    onTab?.(TAB_LABEL[t]);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* private mode: not remembered */
    }
  };
  useEffect(() => {
    if (tab !== 'display') onTab?.(TAB_LABEL[tab]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [binding, setBindingState] = useState<string | null>(null);
  const [bindNote, setBindNote] = useState<string | null>(null);
  const setBinding = (b: string | null) => {
    setBindingState(b);
    if (b) setBindNote(null);
  };
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    flow.applySettings(next);
  };
  useEffect(() => {
    if (!binding) return;
    // A click anywhere else cancels listening (the row's own click restarts it).
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(`[data-action="${binding}"]`)) setBinding(null);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setBinding(null);
      if (e.repeat || !e.code || e.code === 'Unidentified') return;
      if (isReservedKey(e.code)) {
        setBindNote(`${keyLabel(e.code)} is reserved by the game. Pick another key, or Esc to cancel.`);
        return;
      }
      const keys = { ...s.keys };
      // Swap with whatever action already used that key (no dead bindings).
      const clash = Object.entries(keys).find(([, k]) => k === e.code);
      if (clash) keys[clash[0]] = keys[binding];
      keys[binding] = e.code;
      update({ keys });
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding, s]);
  const changed = changedBindings(s.keys);
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || binding || e.target instanceof HTMLInputElement) return;
      const i = tabs.indexOf(tab);
      if (e.code === 'KeyQ') setTab(tabs[(i + tabs.length - 1) % tabs.length]);
      else if (e.code === 'KeyR') setTab(tabs[(i + 1) % tabs.length]);
      else if (e.code === 'Delete') {
        // DEL: the focused key binding goes back to its default, otherwise the whole tab does.
        const focused = (document.activeElement as HTMLElement | null)?.dataset?.action;
        const a = ACTIONS.find((x) => x.id === focused);
        if (a) update({ keys: { ...s.keys, ...Object.fromEntries(Object.entries(s.keys).filter(([, k]) => k === a.def).map(([id]) => [id, s.keys[a.id]])), [a.id]: a.def } });
        else update(resetTab(tab));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className={`settings ${page ? 'page' : ''}`} data-testid="settings">
      <div className="tabs set-tabs">
        {page && <span className="ds-sh">Q</span>}
        {tabs.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} aria-pressed={tab === t} data-tab={t} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
        {page && <span className="ds-sh">R</span>}
      </div>
      <div className="set-body">
        <section className="set-rows">
          {tab === 'display' && (
            <>
              {!compact && (
                <div className="set-presets">
                  {(
                    [
                      ['high', 'Cinematic', 'Reflections · ambient occlusion · cascaded shadows'],
                      ['medium', 'Balanced', 'Soft shadows · bloom · full resolution'],
                      ['low', 'Performance', 'No shadows or bloom · 75% resolution · fewer particles'],
                    ] as [Quality, string, string][]
                  ).map(([q, l, d]) => (
                    <button key={q} type="button" data-testid={`quality-${q}`} className="set-preset" aria-pressed={s.quality === q} onClick={() => update({ quality: q, ...PRESETS[q] })}>
                      <b className="ds-h3">{l}</b>
                      <span className="ds-meta">{d}</span>
                    </button>
                  ))}
                </div>
              )}
              {inArena && <span className="ds-meta">Scene quality and shadows apply from the next sector.</span>}
              <Slider label="Field of view" help="Wider shows more, narrower feels faster" min={70} max={110} step={1} value={s.fov} def={D.fov} fmt={(v) => `${v}°`} onChange={(v) => update({ fov: v })} />
              <Seg label="Shadows" help="Sun shadows from structures and machines" value={s.shadows} options={[['off', 'Off'], ['low', 'Low'], ['high', 'High']]} onChange={(v) => update({ shadows: v })} />
              <Seg label="Particles" help="Sparks, smoke and debris density" value={s.particles} options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]} onChange={(v) => update({ particles: v })} />
              <Seg label="Bloom" help="Glow around bright lights and plasma" value={s.bloom ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => update({ bloom: v === 'on' })} />
              <Slider label="Render resolution" help="Lower is faster on weak GPUs" min={0.5} max={1} step={0.05} value={s.renderScale} def={PRESETS[s.quality].renderScale} fmt={pct} onChange={(v) => update({ renderScale: v })} />
              <Seg
                label="Adaptive quality"
                help="Below this frame rate, fewer particles first, then lower resolution, until it holds"
                value={String(s.adaptiveTarget)}
                options={[['0', 'Off'], ['60', '60 FPS'], ['120', '120 FPS'], ['144', '144 FPS']]}
                onChange={(v) => update({ adaptiveTarget: Number(v) as Settings['adaptiveTarget'] })}
              />
              <Seg label="Renderer" help={`${flow.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} now · applies on restart · WebGPU is a beta`} value={s.renderer} options={[['webgl', 'WebGL2'], ['webgpu', 'WebGPU']]} onChange={(v) => update({ renderer: v })} />
            </>
          )}
          {tab === 'audio' && (
            <>
              <Slider label="Master volume" help="Everything" testId="vol-master" min={0} max={1} step={0.05} value={s.volume} def={D.volume} fmt={pct} onChange={(v) => update({ volume: v })} />
              <Seg label="Mute" help="Silence everything and keep the mix" value={s.muted ? 'on' : 'off'} options={[['off', 'Sound on'], ['on', 'Muted']]} onChange={(v) => update({ muted: v === 'on' })} />
              <Slider label="Effects" help="Weapons, hits, explosions" min={0} max={1} step={0.05} value={s.sfxVolume} def={D.sfxVolume} fmt={pct} onChange={(v) => update({ sfxVolume: v })} />
              <Slider label="Combat cues" help="Hit confirmations and combat warnings, within the Effects mix" min={0} max={1} step={0.05} value={s.combatCueVolume} def={D.combatCueVolume} fmt={pct} onChange={(v) => update({ combatCueVolume: v })} />
              <Slider label="Music" help="Adaptive score: calmer in the HQ, building with the fight" testId="vol-music" min={0} max={1} step={0.05} value={s.musicVolume} def={D.musicVolume} fmt={pct} onChange={(v) => update({ musicVolume: v })} />
              <Slider label="Ambience" help="Reactor hum, machinery, weather" min={0} max={1} step={0.05} value={s.ambienceVolume} def={D.ambienceVolume} fmt={pct} onChange={(v) => update({ ambienceVolume: v })} />
              <Slider label="Interface" help="Menus, pickups, alerts" min={0} max={1} step={0.05} value={s.uiVolume} def={D.uiVolume} fmt={pct} onChange={(v) => update({ uiVolume: v })} />
              <Seg label="Mute in background" help="Fade the sound out while the game is in another tab or window" value={s.muteInBackground ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => update({ muteInBackground: v === 'on' })} />
              <Row label="Preview current mix">
                <span className="set-seg" role="group" aria-label="Audio previews">
                  <button className="set-opt" type="button" onClick={() => void sfx.preview('effects')}>Weapon</button>
                  <button className="set-opt" type="button" onClick={() => void sfx.preview('combat')}>Combat cue</button>
                  <button className="set-opt" type="button" onClick={() => void sfx.preview('ambience')}>Weather</button>
                  <button className="set-opt" type="button" onClick={() => void sfx.preview('interface')}>Menu</button>
                </span>
              </Row>
            </>
          )}
          {tab === 'controls' && (
            <>
              <div className="set-bind-table" data-testid="bind-table">
                <span className="ds-lbl">Action</span>
                <span className="ds-lbl">Key</span>
                <span className="ds-lbl">Alternate</span>
                {ACTIONS.map((a) => (
                  <Fragment key={a.id}>
                    <button type="button" className={`set-bind sbt-name ${binding === a.id ? 'listen' : ''} ${changed.has(a.id) ? 'changed' : ''}`} title={changed.has(a.id) ? `Default: ${keyLabel(a.def)} · DEL restores it` : undefined} aria-pressed={binding === a.id} data-testid={`bind-${a.id}`} data-action={a.id} onClick={() => setBinding(a.id)}>
                      <b>{a.label.replace(/ \(.*\)$/, '')}</b>
                    </button>
                    <span className={`sbt-key ${binding === a.id ? 'listen' : ''}`}><kbd>{binding === a.id ? 'PRESS A KEY…' : keyLabel(s.keys[a.id])}</kbd></span>
                    <span className="sbt-alt"><kbd>{a.id === 'swap' && s.wheelSwap ? 'WHEEL' : ALTERNATE[a.id] ?? '—'}</kbd></span>
                  </Fragment>
                ))}
              </div>
              {bindNote && <span className="ds-meta ds-warn" role="status" data-testid="bind-note">{bindNote}</span>}
              {changed.size > 0 && <span className="ds-meta">{changed.size} key{changed.size === 1 ? '' : 's'} changed from the default (marked).</span>}
              {!page && <MouseAndTouch s={s} update={update} />}
            </>
          )}
          {tab === 'interface' && (
            <>
              <Slider label="Interface scale" help="Size of every menu and HUD element" min={0.8} max={1.3} step={0.05} value={s.uiScale} def={D.uiScale} fmt={pct} onChange={(v) => update({ uiScale: v })} />
              <Seg label="Reticle style" value={s.reticle} options={[['dynamic', 'Dynamic'], ['fixed', 'Fixed'], ['dot', 'Dot']]} onChange={(v) => update({ reticle: v })} />
              <Slider label="Reticle size" min={0.75} max={1.5} step={0.05} value={s.reticleSize} def={D.reticleSize} fmt={pct} onChange={(v) => update({ reticleSize: v })} />
              <Seg label="Reticle colour" help="Pick one that stands out on bright sectors" value={s.reticleColor} options={RETICLE_COLORS.map((c) => [c, c[0].toUpperCase() + c.slice(1)])} onChange={(v) => update({ reticleColor: v })} />
              <Slider label="Reticle opacity" min={0.4} max={1} step={0.05} value={s.reticleOpacity} def={D.reticleOpacity} fmt={pct} onChange={(v) => update({ reticleOpacity: v })} />
              <Seg label="HUD backing" help="Dark glass behind the corner readouts for bright scenes" value={s.hudBacking ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => update({ hudBacking: v === 'on' })} />
              <Seg label="Target indication" help="Mark targets, shields and weakpoints under the reticle" value={s.aimFeedback ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => update({ aimFeedback: v === 'on' })} />
              <Seg label="Damage numbers" value={s.damageNumbers} options={[['all', 'All'], ['personal', 'My hits'], ['off', 'Off']]} onChange={(v) => update({ damageNumbers: v })} />
              <Seg label="Frame rate" help="A small FPS readout in the corner (F3 shows the full stats)" value={s.showFps ? 'on' : 'off'} options={[['off', 'Hidden'], ['on', 'Shown']]} onChange={(v) => update({ showFps: v === 'on' })} />
              <MinimapToggle />
              <TutorialToggle flow={flow} />
            </>
          )}
          {tab === 'access' && (
            <>
              <Seg
                label="Colour vision"
                help="Changes rarity, gain and loss colours everywhere"
                value={s.colorblind}
                options={[
                  ['off', 'Default'],
                  ['deuteranopia', 'Red-green'],
                  ['tritanopia', 'Blue-yellow'],
                ]}
                onChange={(v) => update({ colorblind: v })}
              />
              <Seg label="Reduce motion" help="Removes FOV kicks, camera roll and shake, lens aberration and most weapon bob" value={s.reduceMotion ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => update({ reduceMotion: v === 'on' })} />
              <Seg label="Reduce flashing" help="Warnings hold steady instead of blinking; full-screen hit and kill flashes are hidden" value={s.reduceFlashing ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => update({ reduceFlashing: v === 'on' })} />
              <Slider label="Camera shake" help="Explosions, hits and the ultimate" min={0} max={1.5} step={0.05} value={s.shake} def={D.shake} fmt={pct} onChange={(v) => update({ shake: v })} />
            </>
          )}
          {tab === 'account' && <AccountPanel />}
        </section>
        {page && tab === 'access' && <VisionPreview mode={s.colorblind} />}
        {page && tab === 'controls' && <MouseAndTouch s={s} update={update} />}
        {page && tab === 'display' && <LivePreview flow={flow} />}
      </div>
    </div>
  );
}

/** Built-in second inputs the game always accepts next to the binding. */
const ALTERNATE: Record<string, string> = { grapple: 'MMB', ability: 'RMB' };

/** Defaults for one tab (DEL on the settings page). */
function resetTab(tab: Tab): Partial<Settings> {
  const d = DEFAULT_SETTINGS;
  switch (tab) {
    case 'display': return { quality: d.quality, ...PRESETS[d.quality], fov: d.fov, renderer: d.renderer, adaptiveTarget: d.adaptiveTarget };
    case 'audio': return { volume: d.volume, sfxVolume: d.sfxVolume, ambienceVolume: d.ambienceVolume, uiVolume: d.uiVolume, combatCueVolume: d.combatCueVolume, musicVolume: d.musicVolume, muted: d.muted, muteInBackground: d.muteInBackground };
    case 'controls': return { sensitivity: d.sensitivity, sensitivityY: d.sensitivityY, autoSprint: d.autoSprint, invertY: d.invertY, touchControls: d.touchControls, touchLook: d.touchLook, touchOpacity: d.touchOpacity, wheelSwap: d.wheelSwap, keys: { ...d.keys } };
    case 'interface': return { uiScale: d.uiScale, reticle: d.reticle, reticleSize: d.reticleSize, aimFeedback: d.aimFeedback, damageNumbers: d.damageNumbers, showFps: d.showFps, reticleColor: d.reticleColor, reticleOpacity: d.reticleOpacity, hudBacking: d.hudBacking };
    case 'access': return { colorblind: d.colorblind, reduceMotion: d.reduceMotion, shake: d.shake, reduceFlashing: d.reduceFlashing };
    default: return {};
  }
}

/** Controls side panel (canvas "Settings · controls"): pointer and touch options next to the key table. */
function MouseAndTouch({ s, update }: { s: Settings; update: (p: Partial<Settings>) => void }) {
  return (
    <aside className="set-aside ds-glass ds-cut ds-col" data-testid="mouse-touch">
      <span className="ds-h3">MOUSE AND TOUCH</span>
      <Slider label="Mouse sensitivity" min={0.2} max={3} step={0.05} value={s.sensitivity} def={D.sensitivity} fmt={(v) => v.toFixed(2)} onChange={(v) => update({ sensitivity: v })} />
      <Slider label="Vertical look speed" help="Relative to horizontal" testId="sens-y" min={0.5} max={2} step={0.05} value={s.sensitivityY} def={D.sensitivityY} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => update({ sensitivityY: v })} />
      <Slider label="Touch look speed" testId="touch-look" min={0.3} max={3} step={0.05} value={s.touchLook} def={D.touchLook} fmt={(v) => `${v.toFixed(1)}×`} onChange={(v) => update({ touchLook: v })} />
      <Seg label="Invert vertical look" value={s.invertY ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => update({ invertY: v === 'on' })} />
      <Seg label="Auto-sprint" help="Run at full speed whenever you move forward; the dash key still dashes" value={s.autoSprint ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => update({ autoSprint: v === 'on' })} />
      <Seg label="Scroll to swap weapons" value={s.wheelSwap ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => update({ wheelSwap: v === 'on' })} />
      <Seg label="Touch controls" help="Auto turns on for touch screens" value={s.touchControls} options={[['auto', 'Auto'], ['on', 'On'], ['off', 'Off']]} onChange={(v) => update({ touchControls: v })} />
      <Slider label="Touch button opacity" min={0.2} max={1} step={0.05} value={s.touchOpacity} def={D.touchOpacity} fmt={pct} onChange={(v) => update({ touchOpacity: v })} />
      <InstallApp />
      <span className="ds-meta">A key already in use swaps with the action that had it: a binding is never lost silently. DEL on a row restores its default; double-click a slider to reset it.</span>
    </aside>
  );
}

/** Graphics side panel (canvas "Settings · graphics"): the frame rate of the world behind the page, live. */
function LivePreview({ flow }: { flow: Flow }) {
  const [fps, setFps] = useState(() => flow.engine.getFps());
  useEffect(() => {
    const t = window.setInterval(() => setFps(flow.engine.getFps()), 500);
    return () => window.clearInterval(t);
  }, [flow]);
  const f = Number.isFinite(fps) ? fps : 0;
  return (
    <aside className="set-aside set-live ds-col" data-testid="live-preview">
      <span className="ds-lbl">Live preview · behind this panel</span>
      <span className="ds-numxl">{Math.round(f)}<span style={{ fontSize: 22, color: 'var(--ds-muted)' }}> fps</span></span>
      <span className="ds-meta">Measured on the world behind this page. Frame time {f > 0 ? (1000 / f).toFixed(1) : '—'} ms · {flow.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}.</span>
      <span className="ds-bar" style={{ '--c': f >= 55 ? '#8ff0b6' : f >= 30 ? '#ffd84d' : '#ff5a4a' } as React.CSSProperties}><i style={{ width: `${Math.min(100, Math.round((f / 120) * 100))}%` }} /></span>
      <span className="ds-meta">WebGPU is a beta: some effects may differ until it is checked on your GPU.</span>
    </aside>
  );
}

/** Full settings page (main menu and pause): crumb, tabs, rows, hints. Esc returns. */
export function SettingsScreen({ flow, from, close }: { flow: Flow; from: string; close: () => void }) {
  const [tabLabel, setTabLabel] = useState(TAB_LABEL.display);
  // Reset all is two clicks (the first arms it for a few seconds); the panel remounts on the new values.
  const [armed, setArmed] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const resetAll = () => {
    if (!armed) return setArmed(true);
    flow.applySettings(structuredClone(isTouchDevice() ? mobileDefaults() : DEFAULT_SETTINGS));
    setArmed(false);
    setGeneration((g) => g + 1);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);
  return (
    <div className="screen ds-scr settings-screen" data-testid="settings-screen">
      <Backdrop />
      <div className="ds-top">
        <Crumb parts={[from, 'Settings', tabLabel]} />
        <span className="ds-grow" />
        {flow.location === 'arena' && tabLabel === 'Graphics' && <span className="ds-mono">SCENE QUALITY APPLIES NEXT SECTOR</span>}
      </div>
      <div className="set-page ds-abs">
        <SettingsPanel key={generation} flow={flow} page onTab={setTabLabel} />
      </div>
      <div className="ds-bot">
        <button type="button" className={`ds-btn ${armed ? 'ds-danger' : ''}`} data-testid="settings-reset-all" onClick={resetAll}>{armed ? 'CLICK AGAIN TO RESET EVERYTHING' : 'RESET ALL SETTINGS'}</button>
        <span className="ds-grow" />
        <Hint keys={['Q', 'R']}>Tabs</Hint>
        <Hint keys="DEL">Reset tab</Hint>
        <Hint keys="ESC" onClick={close}>Done</Hint>
      </div>
      <div className="ds-grain" />
    </div>
  );
}

function TutorialToggle({ flow }: { flow: Flow }) {
  const t = flow.profile.save.tutorial;
  const [, force] = useState(0);
  const off = t.skipped || t.done.includes('complete');
  return (
    <Row label="Tutorial prompts" help="Replay the first-run cards from the start">
      <span className="set-seg">
        <button
          type="button"
          className="set-opt"
          aria-pressed={!off}
          data-testid="tutorial-on"
          onClick={() => {
            flow.profile.op('tutorialReset', []);
            force((n) => n + 1);
          }}
        >
          Replay
        </button>
        <button
          type="button"
          className="set-opt"
          aria-pressed={off}
          data-testid="tutorial-off"
          onClick={() => {
            flow.profile.op('tutorialSkip', []);
            force((n) => n + 1);
          }}
        >
          Off
        </button>
      </span>
    </Row>
  );
}

/** Arena minimap: the compass is the default; the top-down radar can be added back (this device only). */
function MinimapToggle() {
  const on = useSyncExternalStore(minimapStore.subscribe, minimapStore.get).on;
  return <Seg label="Arena minimap" help="The compass always shows; add the top-down radar" value={on ? 'on' : 'off'} options={[['off', 'Compass'], ['on', 'Radar too']]} onChange={(v) => setMinimap(v === 'on')} />;
}
