/** Versioned, validated settings persisted in localStorage. */
export type Quality = 'high' | 'medium' | 'low';
export type Level3 = 'low' | 'medium' | 'high';
export const ADAPTIVE_TARGETS = [0, 60, 120, 144] as const;
export const RETICLE_COLORS = ['white', 'green', 'yellow', 'cyan', 'magenta'] as const;
export type ReticleColor = (typeof RETICLE_COLORS)[number];
/** CSS colour per reticle option (high-contrast picks that stay readable on the game's palettes). */
export const RETICLE_HEX: Record<ReticleColor, string> = { white: '#ffffff', green: '#7dff6a', yellow: '#ffe14a', cyan: '#4ff2ff', magenta: '#ff5cf4' };
export type AdaptiveTarget = (typeof ADAPTIVE_TARGETS)[number];

export interface Settings {
  sensitivity: number;
  /** Vertical look speed relative to horizontal (0.5..2), for players who want slower pitch than yaw. */
  sensitivityY: number;
  /** Run at sprint speed whenever moving forward, without holding the dash key (accessibility: no held key). */
  autoSprint: boolean;
  /** Invert vertical look (mouse and touch). */
  invertY: boolean;
  fov: number; // horizontal-ish degrees shown to the user (applied as vertical fov)
  quality: Quality;
  /** Master volume. */
  volume: number;
  /** M7: per-category mix (0..1, multiplied by master). */
  sfxVolume: number;
  ambienceVolume: number;
  uiVolume: number;
  /** Hit confirmations and combat warnings, relative to Effects. */
  combatCueVolume: number;
  /** Adaptive score (CC0 loops + procedural layers), relative to master. */
  musicVolume: number;
  /** Mute everything without losing the mix. */
  muted: boolean;
  /** Fade the audio out while the window is hidden or unfocused. */
  muteInBackground: boolean;
  /** Small always-on frame-rate readout (F3 still opens the full stats). */
  showFps: boolean;
  /** M7: interface scale (0.8..1.3). */
  uiScale: number;
  reticle: 'dynamic' | 'fixed' | 'dot';
  reticleSize: number;
  /** Reticle colour (visibility on bright or busy scenes) and opacity (0.4..1). */
  reticleColor: ReticleColor;
  reticleOpacity: number;
  /** Photosensitivity: warnings hold steady instead of blinking, and full-screen hit and kill flashes are hidden. */
  reduceFlashing: boolean;
  /** Dark glass behind the HUD corners for readability over bright scenes. */
  hudBacking: boolean;
  aimFeedback: boolean;
  damageNumbers: 'all' | 'personal' | 'off';
  wheelSwap: boolean;
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
  /**
   * Adaptive quality: frame-rate target (0 = off). Below it, cosmetic effects and then render resolution step down
   * smoothly, and come back once there is headroom (core/adaptiveQuality.ts).
   */
  adaptiveTarget: AdaptiveTarget;
  /** Graphics backend (applies on the next start): WebGL2, or WebGPU where the browser supports it (beta until it
   * has been checked on real GPUs; it falls back to WebGL2 when WebGPU is unavailable). */
  renderer: 'webgl' | 'webgpu';
  /** M7: key bindings (action -> KeyboardEvent.code). */
  keys: Record<string, string>;
  /** Touch controls: auto (touch screens), always on, or off. */
  touchControls: 'auto' | 'on' | 'off';
  /** Touch look speed (0.3..3), on top of the mouse sensitivity. */
  touchLook: number;
  /** Opacity of the touch buttons (0.2..1). */
  touchOpacity: number;
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
  { id: 'slide', label: 'Slide / ground pound', def: 'ControlLeft' },
  { id: 'grapple', label: 'Grapple (also middle mouse)', def: 'KeyR' },
  { id: 'use', label: 'Use / pick up', def: 'KeyE' },
  { id: 'build', label: 'Build tower', def: 'KeyB' },
  { id: 'swap', label: 'Swap weapon', def: 'KeyZ' },
  { id: 'primary', label: 'Draw primary weapon', def: 'Digit1' },
  { id: 'secondary', label: 'Draw secondary weapon', def: 'Digit3' },
  { id: 'tactical', label: 'Tactical time', def: 'KeyQ' },
  { id: 'wave', label: 'Start wave', def: 'KeyG' },
  { id: 'inventory', label: 'Inventory', def: 'KeyI' },
  { id: 'recycle', label: 'Recycle tower (hold)', def: 'KeyX' },
  { id: 'repair', label: 'Repair tower / ability II', def: 'KeyF' },
  { id: 'ability', label: 'Ability I', def: 'Digit4' },
  { id: 'ultimate', label: 'Ultimate / tower panel', def: 'KeyT' },
  { id: 'checkpoint', label: 'Checkpoint / vote', def: 'KeyH' },
];

export const PRESETS: Record<Quality, Pick<Settings, 'particles' | 'shadows' | 'bloom' | 'renderScale'>> = {
  high: { particles: 'high', shadows: 'high', bloom: true, renderScale: 1 },
  medium: { particles: 'medium', shadows: 'low', bloom: true, renderScale: 1 },
  low: { particles: 'low', shadows: 'off', bloom: false, renderScale: 0.75 },
};

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  sensitivityY: 1,
  autoSprint: false,
  invertY: false,
  fov: 90,
  quality: 'high',
  volume: 0.7,
  sfxVolume: 1,
  ambienceVolume: 0.8,
  uiVolume: 0.8,
  combatCueVolume: 1,
  musicVolume: 0.6,
  muted: false,
  muteInBackground: true,
  showFps: false,
  uiScale: 1,
  reticle: 'dynamic',
  reticleSize: 1,
  reticleColor: 'white',
  reticleOpacity: 0.95,
  reduceFlashing: false,
  hudBacking: false,
  aimFeedback: true,
  damageNumbers: 'all',
  wheelSwap: true,
  shake: 1,
  reduceMotion: false,
  colorblind: 'off',
  ...PRESETS.high,
  adaptiveTarget: 60,
  renderer: 'webgl',
  keys: Object.fromEntries(ACTIONS.map((a) => [a.id, a.def])),
  touchControls: 'auto',
  touchLook: 1,
  touchOpacity: 0.6,
};

/** First start on a phone or tablet: the performance preset (no SSR/SSAO/shadows/MSAA) at a lower render scale. */
export function mobileDefaults(): Settings {
  return { ...structuredClone(DEFAULT_SETTINGS), quality: 'low', ...PRESETS.low, renderScale: 0.7 };
}

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
  // Reserve explicit bindings first, then restore available defaults. A new action can borrow a
  // free default if a legacy save already uses its key for another action.
  for (const { id } of ACTIONS) {
    const key = rk[id];
    if (typeof key !== 'string' || !/^[A-Za-z0-9]{2,20}$/.test(key) || used.has(key)) continue;
    keys[id] = key;
    used.add(key);
  }
  for (const { id, def } of ACTIONS) {
    if (keys[id] || used.has(def)) continue;
    keys[id] = def;
    used.add(def);
  }
  const available = ACTIONS.map(({ def }) => def).filter((key) => !used.has(key));
  for (const { id } of ACTIONS) if (!keys[id]) keys[id] = available.shift()!;
  return {
    sensitivity: clampNum(r.sensitivity, 0.2, 3, DEFAULT_SETTINGS.sensitivity),
    sensitivityY: clampNum(r.sensitivityY, 0.5, 2, DEFAULT_SETTINGS.sensitivityY),
    invertY: r.invertY === true,
    autoSprint: r.autoSprint === true,
    fov: clampNum(r.fov, 70, 110, DEFAULT_SETTINGS.fov),
    quality,
    volume: clampNum(r.volume, 0, 1, DEFAULT_SETTINGS.volume),
    sfxVolume: clampNum(r.sfxVolume, 0, 1, 1),
    ambienceVolume: clampNum(r.ambienceVolume, 0, 1, 0.8),
    uiVolume: clampNum(r.uiVolume, 0, 1, 0.8),
    combatCueVolume: clampNum(r.combatCueVolume, 0, 1, DEFAULT_SETTINGS.combatCueVolume),
    musicVolume: clampNum(r.musicVolume, 0, 1, DEFAULT_SETTINGS.musicVolume),
    muted: r.muted === true,
    muteInBackground: r.muteInBackground !== false,
    showFps: r.showFps === true,
    uiScale: clampNum(r.uiScale, 0.8, 1.3, 1),
    reticle: pick(r.reticle, ['dynamic', 'fixed', 'dot'] as const, DEFAULT_SETTINGS.reticle),
    reticleSize: clampNum(r.reticleSize, 0.75, 1.5, DEFAULT_SETTINGS.reticleSize),
    reticleColor: pick(r.reticleColor, RETICLE_COLORS, DEFAULT_SETTINGS.reticleColor),
    reticleOpacity: clampNum(r.reticleOpacity, 0.4, 1, DEFAULT_SETTINGS.reticleOpacity),
    reduceFlashing: r.reduceFlashing === true,
    hudBacking: r.hudBacking === true,
    aimFeedback: r.aimFeedback !== false,
    damageNumbers: pick(r.damageNumbers, ['all', 'personal', 'off'] as const, DEFAULT_SETTINGS.damageNumbers),
    wheelSwap: r.wheelSwap !== false,
    shake: clampNum(r.shake, 0, 1.5, 1),
    reduceMotion: r.reduceMotion === true,
    colorblind: pick(r.colorblind, ['off', 'deuteranopia', 'tritanopia'] as const, 'off'),
    particles: v1 ? preset.particles : pick(r.particles, ['low', 'medium', 'high'] as const, preset.particles),
    shadows: v1 ? preset.shadows : pick(r.shadows, ['off', 'low', 'high'] as const, preset.shadows),
    bloom: v1 ? preset.bloom : typeof r.bloom === 'boolean' ? r.bloom : preset.bloom,
    renderScale: v1 ? preset.renderScale : clampNum(r.renderScale, 0.5, 1, preset.renderScale),
    adaptiveTarget: ADAPTIVE_TARGETS.includes(r.adaptiveTarget as AdaptiveTarget) ? (r.adaptiveTarget as AdaptiveTarget) : 60,
    renderer: pick(r.renderer, ['webgl', 'webgpu'] as const, 'webgl'),
    keys,
    touchControls: pick(r.touchControls, ['auto', 'on', 'off'] as const, 'auto'),
    touchLook: clampNum(r.touchLook, 0.3, 3, 1),
    touchOpacity: clampNum(r.touchOpacity, 0.2, 1, 0.6),
  };
}

/** Stored settings, or `fallback` (default: DEFAULT_SETTINGS) when nothing was saved yet. */
export function loadSettings(fallback: Settings = DEFAULT_SETTINGS): Settings {
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt) return structuredClone(fallback);
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

/** Readable names for codes that do not shorten to a single character (KeyW -> W, Digit1 -> 1 are handled below). */
const KEY_NAMES: Record<string, string> = {
  ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
  MetaLeft: 'L-CMD', MetaRight: 'R-CMD', Space: 'SPACE', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP', CapsLock: 'CAPS',
  Escape: 'ESC', Delete: 'DEL', Insert: 'INS', Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[',
  BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
  NumpadEnter: 'NUM ENTER', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -', NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /',
  NumpadDecimal: 'NUM .', ContextMenu: 'MENU',
};

export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  const m = /^(?:Key|Digit)([A-Z0-9])$/.exec(code);
  if (m) return m[1];
  const num = /^Numpad([0-9])$/.exec(code);
  if (num) return `NUM ${num[1]}`;
  return code.toUpperCase();
}

/**
 * Keys the game handles itself regardless of bindings: binding an action to one would make it fire twice or never
 * (Escape pauses, Tab opens cargo, F3/F4/F10 are the stats, dev and tutorial keys).
 */
export const RESERVED_KEYS: readonly string[] = ['Escape', 'Tab', 'F3', 'F4', 'F10', 'F11', 'F12'];

export function isReservedKey(code: string): boolean {
  return RESERVED_KEYS.includes(code);
}

/** Actions whose binding differs from the default (the settings table marks them). */
export function changedBindings(keys: Settings['keys']): Set<string> {
  return new Set(ACTIONS.filter((a) => (keys[a.id] ?? a.def) !== a.def).map((a) => a.id));
}

/** Printed movement keys follow the same left-to-right order as the familiar WASD legend. */
export function movementLabel(keys: Settings['keys']): string {
  const labels = ['forward', 'left', 'back', 'right'].map(action => keyLabel(keys[action]));
  return labels.join(labels.every(label => label.length === 1) ? '' : ' / ');
}
