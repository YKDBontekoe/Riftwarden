// Settings (final design: "Settings", "Settings · graphics / controls / audio"). One row per option: label + one
// line of help on the left, a segmented choice or slider on the right. Every control changes real behaviour and
// persists (localStorage, versioned). SettingsScreen is the full page used from the main menu and the pause menu.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { minimapStore, setMinimap } from './hud/minimap';
import type { Flow } from '../core/Flow';
import { InstallApp } from '../touch/MobileUi';
import { AccountPanel } from '../account/AccountPanel';
import { keyLabel, ACTIONS, DEFAULT_SETTINGS, PRESETS, type Quality, type Settings } from '@riftwarden/game/core/settings';
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

function Slider({ label, help, min, max, step, value, fmt, onChange, testId }: { label: string; help?: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; onChange: (v: number) => void; testId?: string }) {
  return (
    <Row label={label} help={help}>
      <input className="settings-range" type="range" aria-label={label} data-testid={testId} min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <b className="set-val">{fmt(value)}</b>
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
export function SettingsPanel({ flow, compact, page }: { flow: Flow; compact?: boolean; page?: boolean }) {
  const [s, setS] = useState<Settings>(flow.settings);
  const [tab, setTab] = useState<Tab>('display');
  const [binding, setBinding] = useState<string | null>(null);
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    flow.applySettings(next);
  };
  const inArena = flow.location === 'arena';
  const tabs: Tab[] = ['display', 'audio', 'controls', 'interface', 'access', ...(page && !inArena ? (['account'] as Tab[]) : [])];
  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setBinding(null);
      const keys = { ...s.keys };
      // Swap with whatever action already used that key (no dead bindings).
      const clash = Object.entries(keys).find(([, k]) => k === e.code);
      if (clash) keys[clash[0]] = keys[binding];
      keys[binding] = e.code;
      update({ keys });
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binding, s]);
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || binding || e.target instanceof HTMLInputElement) return;
      const i = tabs.indexOf(tab);
      if (e.code === 'KeyQ') setTab(tabs[(i + tabs.length - 1) % tabs.length]);
      else if (e.code === 'KeyR') setTab(tabs[(i + 1) % tabs.length]);
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
              {inArena && <span className="ds-meta">Scene effects apply from the next sector.</span>}
              <Slider label="Field of view" help="Wider shows more, narrower feels faster" min={70} max={110} step={1} value={s.fov} fmt={(v) => `${v}°`} onChange={(v) => update({ fov: v })} />
              <Seg label="Shadows" help="Sun shadows from structures and machines" value={s.shadows} options={[['off', 'Off'], ['low', 'Low'], ['high', 'High']]} onChange={(v) => update({ shadows: v })} />
              <Seg label="Particles" help="Sparks, smoke and debris density" value={s.particles} options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]} onChange={(v) => update({ particles: v })} />
              <Seg label="Bloom" help="Glow around bright lights and plasma" value={s.bloom ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => update({ bloom: v === 'on' })} />
              <Slider label="Render resolution" help="Lower is faster on weak GPUs" min={0.5} max={1} step={0.05} value={s.renderScale} fmt={pct} onChange={(v) => update({ renderScale: v })} />
              <Seg label="Renderer" help={`${flow.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} now · applies on restart · WebGPU is a beta`} value={s.renderer} options={[['webgl', 'WebGL2'], ['webgpu', 'WebGPU']]} onChange={(v) => update({ renderer: v })} />
            </>
          )}
          {tab === 'audio' && (
            <>
              <Slider label="Master volume" help="Everything" testId="vol-master" min={0} max={1} step={0.05} value={s.volume} fmt={pct} onChange={(v) => update({ volume: v })} />
              <Slider label="Effects" help="Weapons, hits, explosions" min={0} max={1} step={0.05} value={s.sfxVolume} fmt={pct} onChange={(v) => update({ sfxVolume: v })} />
              <Slider label="Ambience" help="Reactor hum, machinery, weather" min={0} max={1} step={0.05} value={s.ambienceVolume} fmt={pct} onChange={(v) => update({ ambienceVolume: v })} />
              <Slider label="Interface" help="Menus, pickups, alerts" min={0} max={1} step={0.05} value={s.uiVolume} fmt={pct} onChange={(v) => update({ uiVolume: v })} />
              <span className="ds-meta">Every alert is also text on screen: sound is never the only signal.</span>
            </>
          )}
          {tab === 'controls' && (
            <>
              <Slider label="Mouse sensitivity" min={0.2} max={3} step={0.05} value={s.sensitivity} fmt={(v) => v.toFixed(2)} onChange={(v) => update({ sensitivity: v })} />
              <Seg label="Touch controls" help="Auto turns on for touch screens" value={s.touchControls} options={[['auto', 'Auto'], ['on', 'On'], ['off', 'Off']]} onChange={(v) => update({ touchControls: v })} />
              <Slider label="Touch look speed" testId="touch-look" min={0.3} max={3} step={0.05} value={s.touchLook} fmt={(v) => v.toFixed(2)} onChange={(v) => update({ touchLook: v })} />
              <Slider label="Touch button opacity" min={0.2} max={1} step={0.05} value={s.touchOpacity} fmt={pct} onChange={(v) => update({ touchOpacity: v })} />
              <InstallApp />
              <div className="set-binds">
                {ACTIONS.map((a) => (
                  <button key={a.id} type="button" className="set-bind" aria-pressed={binding === a.id} data-testid={`bind-${a.id}`} onClick={() => setBinding(a.id)}>
                    <span>{a.label}</span>
                    <kbd>{binding === a.id ? 'PRESS A KEY' : keyLabel(s.keys[a.id])}</kbd>
                  </button>
                ))}
              </div>
              <div className="ds-row">
                <button type="button" className="ds-btn" onClick={() => update({ keys: { ...DEFAULT_SETTINGS.keys } })}>RESET KEYS</button>
                <span className="ds-meta">A key already in use swaps with the action that had it: no binding is ever lost silently.</span>
              </div>
            </>
          )}
          {tab === 'interface' && (
            <>
              <Slider label="Interface scale" help="Size of every menu and HUD element" min={0.8} max={1.3} step={0.05} value={s.uiScale} fmt={pct} onChange={(v) => update({ uiScale: v })} />
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
              <Slider label="Camera shake" help="Explosions, hits and the ultimate" min={0} max={1.5} step={0.05} value={s.shake} fmt={pct} onChange={(v) => update({ shake: v })} />
            </>
          )}
          {tab === 'account' && <AccountPanel />}
        </section>
        {page && tab === 'access' && <VisionPreview mode={s.colorblind} />}
      </div>
    </div>
  );
}

/** Full settings page (main menu and pause): crumb, tabs, rows, hints. Esc returns. */
export function SettingsScreen({ flow, from, close }: { flow: Flow; from: string; close: () => void }) {
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
        <Crumb parts={[from, 'Settings']} />
        <span className="ds-grow" />
        <span className="ds-mono">{flow.location === 'arena' ? 'ARENA CHANGES APPLY ON THE NEXT SECTOR' : 'CHANGES APPLY AT ONCE'}</span>
      </div>
      <div className="set-page ds-abs">
        <SettingsPanel flow={flow} page />
      </div>
      <div className="ds-bot">
        <span className="ds-grow" />
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
