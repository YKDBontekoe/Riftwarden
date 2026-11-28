// Settings follow the profile: every change is recorded as a `setPrefs` op (rules/progression/prefs.ts), so it syncs
// to the account with the rest of the profile, and a newer copy from another device is applied here. Device-specific
// options (renderer, graphics quality, resolution, touch mode) stay on each device. Small UI choices (radar,
// inventory sort, comparison priority) travel with them.
import { COMPARISON_PRIORITIES, type ComparisonPriority } from '@riftwarden/rules/loot/loadoutScore';
import type { SyncedPrefs } from '@riftwarden/rules/progression/prefs';
import { sanitizeSettings, type Settings } from '@riftwarden/game/core/settings';
import type { Flow } from './Flow';
import { minimapStore, setMinimap } from '../ui/hud/minimap';
import { comparison, savePriority } from '../ui/compare';
import { SORT_KEY } from '../ui/inventory/InventoryView';

/** Options that belong to the device, not the player. */
export const DEVICE_FIELDS: readonly (keyof Settings)[] = ['renderer', 'quality', 'particles', 'shadows', 'bloom', 'renderScale', 'adaptiveTarget', 'touchControls'];

/** The part of the settings that syncs (pure). */
export function syncedSettings(s: Settings): SyncedPrefs['settings'] {
  const out: SyncedPrefs['settings'] = {};
  for (const [k, v] of Object.entries(s) as [keyof Settings, Settings[keyof Settings]][]) {
    if (DEVICE_FIELDS.includes(k)) continue;
    out[k] = k === 'keys' ? { ...(v as Record<string, string>) } : (v as string | number | boolean);
  }
  return out;
}

/** Local settings with the synced part applied (pure): device fields stay local, everything is sanitized again. */
export function mergeSynced(local: Settings, synced: SyncedPrefs['settings']): Settings {
  const merged = sanitizeSettings({ ...local, ...synced }, 2);
  for (const k of DEVICE_FIELDS) (merged as unknown as Record<string, unknown>)[k] = local[k];
  return merged;
}

/** Same synced content (order-independent), ignoring the timestamp (pure). */
export function samePrefs(a: Pick<SyncedPrefs, 'settings' | 'ui'> | undefined, b: Pick<SyncedPrefs, 'settings' | 'ui'>): boolean {
  if (!a) return false;
  const norm = (p: Pick<SyncedPrefs, 'settings' | 'ui'>) => JSON.stringify([sortKeys(p.settings), sortKeys(p.ui)]);
  return norm(a) === norm(b);
}

function sortKeys<T extends Record<string, unknown>>(o: T): unknown {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k] && typeof o[k] === 'object' ? sortKeys(o[k] as Record<string, unknown>) : o[k]]));
}

function readUi(): SyncedPrefs['ui'] {
  const ui: SyncedPrefs['ui'] = { minimap: minimapStore.get().on, priority: comparison.get().priority };
  try {
    const sort = localStorage.getItem(SORT_KEY);
    if (sort) ui.invSort = sort;
  } catch {
    /* storage unavailable */
  }
  return ui;
}

function applyUi(ui: SyncedPrefs['ui']): void {
  if (typeof ui.minimap === 'boolean' && ui.minimap !== minimapStore.get().on) setMinimap(ui.minimap);
  if (typeof ui.priority === 'string' && COMPARISON_PRIORITIES.includes(ui.priority as ComparisonPriority) && ui.priority !== comparison.get().priority) savePriority(ui.priority as ComparisonPriority);
  if (typeof ui.invSort === 'string') {
    try {
      localStorage.setItem(SORT_KEY, ui.invSort);
    } catch {
      /* storage unavailable */
    }
  }
}

const AT_KEY = 'riftwarden.prefsAt';

/** Watch the profile for newer synced prefs and record local changes (debounced). Returns a push trigger. */
export function startPrefsSync(flow: Flow): () => void {
  let applied = 0;
  try {
    applied = Number(localStorage.getItem(AT_KEY) ?? 0) || 0;
  } catch {
    /* storage unavailable */
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const push = () => {
    timer = null;
    const next = { settings: syncedSettings(flow.settings), ui: readUi() };
    if (samePrefs(flow.profile.save.prefs, next)) return;
    flow.profile.op('setPrefs', [next]);
  };
  const queue = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, 1500);
  };
  const check = () => {
    const p = flow.profile.save.prefs;
    // A profile without prefs yet (first sign-in, a fresh account) takes this device's.
    if (!p) return queue();
    if (p.at <= applied) return;
    applied = p.at;
    try {
      localStorage.setItem(AT_KEY, String(applied));
    } catch {
      /* storage unavailable */
    }
    const merged = mergeSynced(flow.settings, p.settings);
    if (JSON.stringify(merged) !== JSON.stringify(flow.settings)) flow.applySettings(merged, true);
    applyUi(p.ui);
  };
  flow.profile.store.subscribe(check);
  minimapStore.subscribe(queue);
  comparison.subscribe(queue);
  check();
  return queue;
}
