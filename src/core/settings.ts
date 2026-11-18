/** Versioned, validated settings persisted in localStorage. */
export type Quality = 'high' | 'medium' | 'low';
export type Level3 = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;
  fov: number; // horizontal-ish degrees shown to the user (applied as vertical fov)
  quality: Quality;
  /** Master volume. */
  volume: number;
  /** M7: per-category mix (0..1, multiplied by master). */
  sfxVolume: number;
  ambienceVolume: number;
  uiVolume: number;
  /** M7: interface scale (0.8..1.3). */
  uiScale: number;
  /** M7: camera shake strength (0 = off). */
  shake: number;
  /** M7: reduce motion (no FOV kicks, roll, chromatic aberration, viewmodel bob). */
  reduceMotion: boolean;
  /** M7: colour accessibility for rarity / team colours. */
  colorblind: 'off' | 'deuteranopia' | 'tritanopia';
  /** M7: performance options (presets set them; each can be changed). */
  particles: Level3;
  shadows: 'off' | 'low' | 'high';
  bloom: boolean;
  /** Render resolution scale (0.5..1). */
  renderScale: number;
  /** M7: key bindings (action -> KeyboardEvent.code). */
  keys: Record<string, string>;
}

const KEY = 'riftwarden.settings';
const VERSION = 2;

/** Rebindable actions and their default physical keys (the game reads the default codes). */
export const ACTIONS: readonly { id: string; label: string; def: string }[] = [
  { id: 'forward', label: 'Move forward', def: 'KeyW' },
  { id: 'back', label: 'Move back', def: 'KeyS' },
  { id: 'left', label: 'Strafe left', def: 'KeyA' },
  { id: 'right', label: 'Strafe right', def: 'KeyD' },
  { id: 'jump', label: 'Jump / boost', def: 'Space' },
  { id: 'dash', label: 'Dash / sprint', def: 'ShiftLeft' },
  { id: 'use', label: 'Use / pick up', def: 'KeyE' },
  { id: 'build', label: 'Build tower', def: 'KeyB' },
  { id: 'tactical', label: 'Tactical time', def: 'KeyQ' },
  { id: 'wave', label: 'Start wave', def: 'KeyG' },
  { id: 'inventory', label: 'Inventory', def: 'KeyI' },
  { id: 'recycle', label: 'Recycle tower (hold)', def: 'KeyX' },
  { id: 'checkpoint', label: 'Checkpoint / vote', def: 'KeyH' },
];

export const PRESETS: Record<Quality, Pick<Settings, 'particles' | 'shadows' | 'bloom' | 'renderScale'>> = {
  high: { particles: 'high', shadows: 'high', bloom: true, renderScale: 1 },
  medium: { particles: 'medium', shadows: 'low', bloom: true, renderScale: 1 },
  low: { particles: 'low', shadows: 'off', bloom: false, renderScale: 0.75 },
};

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 90,
  quality: 'high',
  volume: 0.7,
  sfxVolume: 1,
  ambienceVolume: 0.8,
  uiVolume: 0.8,
  uiScale: 1,
  shake: 1,
  reduceMotion: false,
  colorblind: 'off',
  ...PRESETS.high,
  keys: Object.fromEntries(ACTIONS.map((a) => [a.id, a.def])),
};

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}
const pick = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb);

export function sanitizeSettings(raw: unknown, version = VERSION): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const quality = pick(r.quality, ['high', 'medium', 'low'] as const, 'high');
  // v1 saves only had quality: derive the performance options from its preset.
  const preset = PRESETS[quality];
  const v1 = version < 2;
  const keys: Record<string, string> = {};
  const rk = (r.keys && typeof r.keys === 'object' ? r.keys : {}) as Record<string, unknown>;
  const used = new Set<string>();
  for (const a of ACTIONS) {
    const k = typeof rk[a.id] === 'string' && /^[A-Za-z0-9]{2,20}$/.test(rk[a.id] as string) ? (rk[a.id] as string) : a.def;
    keys[a.id] = used.has(k) ? a.def : k;
    used.add(keys[a.id]);
  }
  return {
    sensitivity: clampNum(r.sensitivity, 0.2, 3, DEFAULT_SETTINGS.sensitivity),
    fov: clampNum(r.fov, 70, 110, DEFAULT_SETTINGS.fov),
    quality,
    volume: clampNum(r.volume, 0, 1, DEFAULT_SETTINGS.volume),
    sfxVolume: clampNum(r.sfxVolume, 0, 1, 1),
    ambienceVolume: clampNum(r.ambienceVolume, 0, 1, 0.8),
    uiVolume: clampNum(r.uiVolume, 0, 1, 0.8),
    uiScale: clampNum(r.uiScale, 0.8, 1.3, 1),
    shake: clampNum(r.shake, 0, 1.5, 1),
    reduceMotion: r.reduceMotion === true,
    colorblind: pick(r.colorblind, ['off', 'deuteranopia', 'tritanopia'] as const, 'off'),
    particles: v1 ? preset.particles : pick(r.particles, ['low', 'medium', 'high'] as const, preset.particles),
    shadows: v1 ? preset.shadows : pick(r.shadows, ['off', 'low', 'high'] as const, preset.shadows),
    bloom: v1 ? preset.bloom : typeof r.bloom === 'boolean' ? r.bloom : preset.bloom,
    renderScale: v1 ? preset.renderScale : clampNum(r.renderScale, 0.5, 1, preset.renderScale),
    keys,
  };
}

export function loadSettings(): Settings {
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(txt) as { v?: number; data?: unknown };
    return sanitizeSettings(parsed.data, typeof parsed.v === 'number' ? parsed.v : 1);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, data: s }));
  } catch {
    /* storage unavailable: settings stay session-only */
  }
}

/** Physical key -> the default code the game logic listens for (key rebinding). */
export function keyRemap(s: Settings): Map<string, string> {
  const m = new Map<string, string>();
  const bound = new Set(ACTIONS.map((a) => s.keys[a.id] ?? a.def));
  for (const a of ACTIONS) {
    const k = s.keys[a.id] ?? a.def;
    if (k !== a.def) m.set(k, a.def);
  }
  // A default key nobody is bound to any more does nothing.
  for (const a of ACTIONS) if (!bound.has(a.def) && !m.has(a.def)) m.set(a.def, '__unbound');
  return m;
}
