// Number and time formatting shared by the UI (pure).

/** m:ss, or h:mm:ss from an hour (long endless runs); bad input reads 0:00. */
export function fmtTime(s: number): string {
  const t = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Large totals: 12.3k, 4.56M, 7.89B (exponent past 1e15; a dash for non-finite values). */
export function fmtBig(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e15) return n.toExponential(2);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** "1 wave", "3 waves", "1 boss", "2 bosses": a count with its noun (localized digits). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
