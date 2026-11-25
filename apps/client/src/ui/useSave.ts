import { useSyncExternalStore } from 'react';
import type { Flow } from '../core/Flow';
import type { SaveData } from '@riftwarden/rules/progression/save';

/** The active profile's save, re-rendering on every committed change. */
export function useSave(flow: Flow): SaveData {
  return useSyncExternalStore(flow.profile.store.subscribe, () => flow.profile.store.get().save);
}
