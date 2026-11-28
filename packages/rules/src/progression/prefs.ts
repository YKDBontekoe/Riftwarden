// Synced preferences: the player's settings and small UI choices ride along with the profile, so a signed-in warden
// gets the same controls, audio mix, interface and accessibility options on every device. The rules package keeps the
// value opaque but bounded (it cannot know the client's settings schema); the client sanitizes it again on use and
// keeps device-specific options (renderer, graphics quality, resolution, touch mode) local.

/** Preferences stored on the profile (`save.prefs`, optional: absent until a player changes a setting). */
export interface SyncedPrefs {
  /** Settings fields (flat primitives, plus `keys`: action -> key code). */
  settings: Record<string, string | number | boolean | Record<string, string>>;
  /** Small UI choices (radar toggle, inventory sort, comparison priority). */
  ui: Record<string, string | number | boolean>;
  /** When they were last changed (entry time): newer wins on another device. */
  at: number;
}

const MAX_FIELDS = 80;
const MAX_STR = 40;

const prim = (v: unknown): v is string | number | boolean => (typeof v === 'string' && v.length <= MAX_STR) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';
const okKey = (k: string) => /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(k);

/** Bounded copy of untrusted prefs (pure): unknown shapes are dropped field by field; null when nothing is usable. */
export function sanitizePrefs(raw: unknown): SyncedPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const settings: SyncedPrefs['settings'] = {};
  const src = r.settings && typeof r.settings === 'object' ? (r.settings as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(src).slice(0, MAX_FIELDS)) {
    if (!okKey(k)) continue;
    if (prim(v)) settings[k] = v;
    else if (k === 'keys' && v && typeof v === 'object') {
      const keys: Record<string, string> = {};
      for (const [a, code] of Object.entries(v as Record<string, unknown>).slice(0, MAX_FIELDS)) if (okKey(a) && typeof code === 'string' && /^[A-Za-z0-9]{1,24}$/.test(code)) keys[a] = code;
      settings.keys = keys;
    }
  }
  const ui: SyncedPrefs['ui'] = {};
  const usrc = r.ui && typeof r.ui === 'object' ? (r.ui as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(usrc).slice(0, 20)) if (okKey(k) && prim(v)) ui[k] = v;
  if (!Object.keys(settings).length && !Object.keys(ui).length) return null;
  const at = typeof r.at === 'number' && Number.isFinite(r.at) && r.at > 0 ? r.at : 0;
  return { settings, ui, at };
}

/** Profile op: replace the synced preferences (stamped with the entry time so replays agree). */
export const PREFS_OPS = {
  setPrefs: {
    args: ['json'] as ['json'],
    run: (d: { prefs?: SyncedPrefs }, a: unknown[], _tx: string | undefined, now: number) => {
      const p = sanitizePrefs(a[0]);
      if (!p) return { ok: false as const, reason: 'Nothing to save' };
      d.prefs = { ...p, at: now };
      return { ok: true as const };
    },
  },
};
