import { useEffect, useState } from 'react';
import type { Flow } from '../core/Flow';
import { InstallApp } from '../touch/MobileUi';
import { keyLabel, ACTIONS, DEFAULT_SETTINGS, PRESETS, type Quality, type Settings } from '@riftwarden/game/core/settings';

type Tab = 'display' | 'audio' | 'controls' | 'access';

const optionRow = 'my-[6px] flex items-center justify-between gap-[10px] text-[15px] [@media(max-width:540px)]:[.menu-sheet_&]:flex-wrap';
const optionList = 'flex gap-[4px]';
const optionButton = 'm-0 min-h-0 w-auto px-[10px] py-[5px] text-left text-[11px] aria-pressed:[border-color:var(--cyan)] aria-pressed:bg-[rgba(156,207,194,0.12)]';

function Slider({ label, min, max, step, value, fmt, onChange, testId }: { label: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; onChange: (v: number) => void; testId?: string }) {
  return (
    <label className="grid grid-cols-[140px_1fr_52px] items-center gap-[12px] text-[15px] font-semibold tracking-[0.04em] text-muted [@media(max-width:600px)]:[.menu-sheet_&]:grid-cols-[minmax(80px,auto)_minmax(55px,1fr)_40px] [@media(max-width:600px)]:[.menu-sheet_&]:gap-[6px]">
      <span>{label}</span>
      <input className="settings-range h-[4px] w-full appearance-none bg-[rgba(255,255,255,0.12)] [outline:none]" type="range" data-testid={testId} min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <em className="text-right font-mono text-[12px] text-ink not-italic">{fmt(value)}</em>
    </label>
  );
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className={optionRow}>
      <span>{label}</span>
      <div className={optionList}>
        {options.map(([v, l]) => (
          <button key={v} className={optionButton} aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Every control changes real behaviour; values persist (localStorage, versioned). */
export function SettingsPanel({ flow, compact }: { flow: Flow; compact?: boolean }) {
  const [s, setS] = useState<Settings>(flow.settings);
  const [tab, setTab] = useState<Tab>('display');
  const [binding, setBinding] = useState<string | null>(null);
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    flow.applySettings(next);
  };
  const inArena = flow.location === 'arena';
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
  return (
    <div className="grid gap-[10px] text-left [.modal_&]:mt-[16px]" data-testid="settings">
      <div className="tabs mb-[10px] [.menu-sheet_&]:mt-0">
        {(['display', 'audio', 'controls', 'access'] as Tab[]).map((t) => (
          <button key={t} className={`${tab === t ? 'on' : ''} [@media(max-width:540px)]:[.menu-sheet_&]:px-[3px] [@media(max-width:540px)]:[.menu-sheet_&]:text-[10px]`} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'access' ? 'ACCESSIBILITY' : t.toUpperCase()}
          </button>
        ))}
      </div>
      {tab === 'display' && (
        <>
          <Slider label="Field of view" min={70} max={110} step={1} value={s.fov} fmt={(v) => `${v}°`} onChange={(v) => update({ fov: v })} />
          {!compact && (
            <div className="mt-[4px] grid gap-[8px] text-[15px] font-semibold text-muted">
              <span>Graphics preset{inArena ? ' (scene effects apply from the next location)' : ''}</span>
              <div className="grid grid-cols-[1fr_1fr] gap-[6px] [.menu-sheet_&]:grid-cols-3 [@media(max-width:540px)]:[.menu-sheet_&]:grid-cols-1">
                {(
                  [
                    ['high', 'CINEMATIC', 'Reflections · ambient occlusion · cascaded shadows'],
                    ['medium', 'BALANCED', 'Soft shadows · bloom · full resolution'],
                    ['low', 'PERFORMANCE', 'No shadows or bloom · 75% resolution · fewer particles'],
                  ] as [Quality, string, string][]
                ).map(([q, l, d]) => (
                  <button key={q} data-testid={`quality-${q}`} className="group m-0 px-[12px] py-[10px] text-left text-[13px] aria-pressed:[border-color:var(--cyan)] aria-pressed:bg-[rgba(156,207,194,0.12)]" aria-pressed={s.quality === q} onClick={() => update({ quality: q, ...PRESETS[q] })}>
                    {l}
                    <small className="mt-[2px] block font-sans text-[12px] font-medium tracking-[0.04em] text-faint group-aria-pressed:text-muted">{d}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Seg label="Shadows" value={s.shadows} options={[['off', 'OFF'], ['low', 'LOW'], ['high', 'HIGH']]} onChange={(v) => update({ shadows: v })} />
          <Seg label="Particles" value={s.particles} options={[['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']]} onChange={(v) => update({ particles: v })} />
          <Seg label="Bloom" value={s.bloom ? 'on' : 'off'} options={[['on', 'ON'], ['off', 'OFF']]} onChange={(v) => update({ bloom: v === 'on' })} />
          <Slider label="Render resolution" min={0.5} max={1} step={0.05} value={s.renderScale} fmt={pct} onChange={(v) => update({ renderScale: v })} />
          <Seg label={`Renderer · ${flow.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} now, applies on restart`} value={s.renderer} options={[['webgl', 'WEBGL2'], ['webgpu', 'WEBGPU (BETA)']]} onChange={(v) => update({ renderer: v })} />
        </>
      )}
      {tab === 'audio' && (
        <>
          <Slider label="Master volume" testId="vol-master" min={0} max={1} step={0.05} value={s.volume} fmt={pct} onChange={(v) => update({ volume: v })} />
          <Slider label="Effects" min={0} max={1} step={0.05} value={s.sfxVolume} fmt={pct} onChange={(v) => update({ sfxVolume: v })} />
          <Slider label="Ambience" min={0} max={1} step={0.05} value={s.ambienceVolume} fmt={pct} onChange={(v) => update({ ambienceVolume: v })} />
          <Slider label="Interface" min={0} max={1} step={0.05} value={s.uiVolume} fmt={pct} onChange={(v) => update({ uiVolume: v })} />
        </>
      )}
      {tab === 'controls' && (
        <>
          <Slider label="Mouse sensitivity" min={0.2} max={3} step={0.05} value={s.sensitivity} fmt={(v) => v.toFixed(2)} onChange={(v) => update({ sensitivity: v })} />
          <Seg label="Touch controls" value={s.touchControls} options={[['auto', 'AUTO'], ['on', 'ON'], ['off', 'OFF']]} onChange={(v) => update({ touchControls: v })} />
          <Slider label="Touch look speed" testId="touch-look" min={0.3} max={3} step={0.05} value={s.touchLook} fmt={(v) => v.toFixed(2)} onChange={(v) => update({ touchLook: v })} />
          <Slider label="Touch button opacity" min={0.2} max={1} step={0.05} value={s.touchOpacity} fmt={pct} onChange={(v) => update({ touchOpacity: v })} />
          <InstallApp />
          <div className="grid grid-cols-[1fr_1fr] gap-[4px] m-[8px_0]">
            {ACTIONS.map((a) => (
              <button key={a.id} className="m-0 flex items-center justify-between px-[8px] py-[5px] text-[13px] aria-pressed:[border-color:var(--amber)]" aria-pressed={binding === a.id} data-testid={`bind-${a.id}`} onClick={() => setBinding(a.id)}>
                <span>{a.label}</span>
                <kbd>{binding === a.id ? 'PRESS A KEY' : keyLabel(s.keys[a.id])}</kbd>
              </button>
            ))}
          </div>
          <button className="mini" onClick={() => update({ keys: { ...DEFAULT_SETTINGS.keys } })}>
            RESET KEYS
          </button>
        </>
      )}
      {tab === 'access' && (
        <>
          <Slider label="Interface scale" min={0.8} max={1.3} step={0.05} value={s.uiScale} fmt={pct} onChange={(v) => update({ uiScale: v })} />
          <Slider label="Camera shake" min={0} max={1.5} step={0.05} value={s.shake} fmt={pct} onChange={(v) => update({ shake: v })} />
          <Seg label="Reduce motion" value={s.reduceMotion ? 'on' : 'off'} options={[['off', 'OFF'], ['on', 'ON']]} onChange={(v) => update({ reduceMotion: v === 'on' })} />
          <Seg
            label="Colour vision"
            value={s.colorblind}
            options={[
              ['off', 'DEFAULT'],
              ['deuteranopia', 'RED-GREEN'],
              ['tritanopia', 'BLUE-YELLOW'],
            ]}
            onChange={(v) => update({ colorblind: v })}
          />
          <div className="text-[12px] text-faint m-[8px_0] leading-[1.4]">Reduce motion removes FOV kicks, camera roll and shake, lens aberration and most weapon bob. Colour vision changes the rarity colours used everywhere.</div>
          <TutorialToggle flow={flow} />
        </>
      )}
    </div>
  );
}

function TutorialToggle({ flow }: { flow: Flow }) {
  const t = flow.profile.save.tutorial;
  const [, force] = useState(0);
  const off = t.skipped || t.done.includes('complete');
  return (
    <div className={optionRow}>
      <span>Tutorial prompts</span>
      <div className={optionList}>
        <button
          className={optionButton}
          aria-pressed={!off}
          data-testid="tutorial-on"
          onClick={() => {
            flow.profile.op('tutorialReset', []);
            force((n) => n + 1);
          }}
        >
          REPLAY
        </button>
        <button
          className={optionButton}
          aria-pressed={off}
          data-testid="tutorial-off"
          onClick={() => {
            flow.profile.op('tutorialSkip', []);
            force((n) => n + 1);
          }}
        >
          OFF
        </button>
      </div>
    </div>
  );
}
