/** Versioned, validated settings persisted in localStorage. */
export interface Settings {
  sensitivity: number;
  fov: number; // horizontal-ish degrees shown to the user (applied as vertical fov)
  quality: 'high' | 'low';
  volume: number;
}

const KEY = 'riftwarden.settings';
const VERSION = 1;

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, fov: 90, quality: 'high', volume: 0.7 };

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    sensitivity: clampNum(r.sensitivity, 0.2, 3, DEFAULT_SETTINGS.sensitivity),
    fov: clampNum(r.fov, 70, 110, DEFAULT_SETTINGS.fov),
    quality: r.quality === 'low' ? 'low' : 'high',
    volume: clampNum(r.volume, 0, 1, DEFAULT_SETTINGS.volume),
  };
}

export function loadSettings(): Settings {
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(txt) as { v?: number; data?: unknown };
    if (parsed.v !== VERSION) return sanitizeSettings(parsed.data);
    return sanitizeSettings(parsed.data);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, data: s }));
  } catch {
    /* storage unavailable: settings stay session-only */
  }
}
