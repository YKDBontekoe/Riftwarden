// Session memory for UI choices (a terminal's tab, a map view): reopening a station shows what you looked at last.
// Kept in memory only (a reload starts fresh) and off under automation, where suites expect the default views.
import { useCallback, useState } from 'react';

const memory = new Map<string, string>();
const automation = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');

/** Read a remembered value (pure aside from the session map): `valid` rejects stale ones (a tab that is now locked). */
export function recall<T extends string>(key: string, fallback: T, valid: (v: string) => boolean = () => true, map = memory): T {
  const v = map.get(key);
  return v !== undefined && valid(v) ? (v as T) : fallback;
}

/** useState that starts from the remembered value for `key` and remembers every change for the session. */
export function useRemembered<T extends string>(key: string, initial: T | (() => T), valid?: (v: string) => boolean): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === 'function' ? (initial as () => T)() : initial;
    return automation ? fallback : recall(key, fallback, valid);
  });
  const set = useCallback((v: T) => {
    if (!automation) memory.set(key, v);
    setValue(v);
  }, [key]);
  return [value, set];
}
