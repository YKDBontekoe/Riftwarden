// Open-squad browser: co-op lobbies whose host listed them (GET /rooms on the gateway), refreshed every 5 s.
import { useEffect, useState } from 'react';
import type { OpenSquad } from '@riftwarden/protocol/protocol';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { apiBase } from '../account/api';

const REFRESH_MS = 5000;

/** Read the listing; anything malformed is dropped (the response comes from the network). */
export function parseSquads(body: unknown): OpenSquad[] {
  const rows = (body as { rooms?: unknown })?.rooms;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r): OpenSquad[] => {
    const o = r as Record<string, unknown>;
    if (typeof o.code !== 'string' || typeof o.host !== 'string') return [];
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return [{ code: o.code.slice(0, 8), host: o.host.slice(0, 32), players: n(o.players), capacity: n(o.capacity) || 4, tier: Math.max(1, n(o.tier)), mode: o.mode === 'survival' ? 'survival' : 'defense' }];
  });
}

export function SquadBrowser({ onJoin, maxTier }: { onJoin: (code: string) => void; maxTier: number }) {
  const [rows, setRows] = useState<OpenSquad[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    fetch(`${apiBase()}/rooms`, { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return;
        setRows(parseSquads(b));
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    const t = window.setTimeout(() => setTick((n) => n + 1), REFRESH_MS);
    return () => {
      live = false;
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [tick]);
  return (
    <section className="squads" data-testid="squad-browser" aria-label="Open squads">
      <div className="squads-head">
        <span className="ds-lbl">Open squads</span>
        <button className="ds-btn squads-refresh" onClick={() => setTick((n) => n + 1)}>REFRESH</button>
      </div>
      {failed && <div className="squads-empty">The squad list is unreachable right now. Join codes still work.</div>}
      {!failed && rows === null && <div className="squads-empty">Looking for squads…</div>}
      {!failed && rows?.length === 0 && <div className="squads-empty">No listed squads at the moment. Create one and list it, or share your code.</div>}
      {!!rows?.length && (
        <ul className="squads-list">
          {rows.map((r) => {
            const locked = r.tier > maxTier;
            return (
              <li key={r.code} className="squad-row" data-testid="squad-row">
                <span className="squad-host">{r.host}</span>
                <span className="squad-meta ds-mono">RL {r.tier} · {getTier(r.tier).name}</span>
                <span className={`squad-mode ${r.mode}`}>{r.mode === 'survival' ? 'SURVIVAL' : 'DEFENSE'}</span>
                <span className="squad-slots" aria-label={`${r.players} of ${r.capacity} wardens`}>
                  {Array.from({ length: r.capacity }, (_, i) => <i key={i} className={i < r.players ? 'on' : ''} />)}
                </span>
                <button className="ds-btn" data-testid={`squad-join-${r.code}`} disabled={locked} title={locked ? `You have not unlocked RL ${r.tier}` : undefined} onClick={() => onJoin(r.code)}>
                  {locked ? 'LOCKED' : 'JOIN'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
