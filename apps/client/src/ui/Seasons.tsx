// Seasons + leaderboards in the HQ (docs/design/progression-design.md §11): switch between the permanent and this month's
// seasonal profile, the season rule and time left, the journey, archived seasons, and the boards (server profiles
// only: guests never appear, solo runs were validated by the rules worker).
import { plural } from './format';
import { useEffect, useState } from 'react';
import type { Flow } from '../core/Flow';
import { JOURNEY, journeyDone, journeyTitle, seasonEnd, seasonOf, seasonRule } from '@riftwarden/rules/progression/seasons';
import type { SaveData } from '@riftwarden/rules/progression/save';
import { isUnlocked } from '@riftwarden/rules/progression/unlocks';
import { apiBase } from '../account/api';
import { sfx } from '@riftwarden/game/audio/Sfx';

const daysLeft = (id: number, now: number) => Math.max(0, Math.ceil((seasonEnd(id) - now) / 86_400_000));

/** Deploy terminal header: which profile is active, the season rule, switch / start the season. */
export function SeasonBar({ flow, save }: { flow: Flow; save: SaveData }) {
  const now = Date.now();
  const id = seasonOf(now);
  const perm = flow.profile.permanent;
  const seasonal = flow.profile.seasonActive;
  const rule = seasonRule(id);
  const [msg, setMsg] = useState<string | null>(null);
  const started = perm.seasonal?.id === id;
  const busy = !!save.activeRun;
  // Staged unlocks: a new warden does not need a second ladder yet (an already started season always shows).
  if (!started && !seasonal && !isUnlocked(perm, 'seasons')) return null;
  return (
    <div className={`flex flex-wrap items-center gap-[10px] border p-[8px_12px] m-[0_0_12px] ${seasonal ? 'border-violet/60 bg-[rgb(170_120_255/0.08)]' : 'border-line'}`} data-testid="season-bar">
      <div className="grid">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-faint">{seasonal ? `SEASONAL PROFILE · SEASON ${id}` : 'PERMANENT PROFILE'}</span>
        <span className="text-[13px]"><b>Season {id}</b> · {rule.name}: {rule.blurb} · <span className="text-muted">{plural(daysLeft(id, now), 'day')} left</span></span>
      </div>
      <div className="flex gap-[6px] ml-auto">
        {!started && (
          <button className="m-0 w-auto primary px-[12px] py-[8px] text-[12px]" disabled={busy} data-testid="season-start" onClick={() => {
            const r = flow.profile.permanentOp('startSeason', [id]);
            if (r.ok) flow.profile.setSeasonMode(true);
            sfx.play(r.ok ? 'chargeReady' : 'buildDeny');
            setMsg(r.ok ? `Season ${id} started: a fresh warden, a faster ladder, everything moves to your permanent profile when the month ends.` : (r as { reason?: string }).reason ?? 'Refused');
          }}>START SEASON {id}</button>
        )}
        {started && (
          <button className="m-0 w-auto px-[12px] py-[8px] text-[12px]" disabled={busy} data-testid="season-toggle" onClick={() => {
            const ok = flow.profile.setSeasonMode(!seasonal);
            sfx.play(ok ? 'ui' : 'buildDeny');
            setMsg(ok ? null : 'Finish the running operation first');
          }}>{seasonal ? 'PLAY PERMANENT' : 'PLAY SEASONAL'}</button>
        )}
      </div>
      {msg && <div className="basis-full text-[12px] text-muted">{msg}</div>}
    </div>
  );
}

/** The season's journey (seasonal profile) and archived seasons (permanent). */
export function SeasonPanel({ flow }: { flow: Flow }) {
  const perm = flow.profile.permanent;
  const s = perm.seasonal;
  const done = s ? journeyDone(s.doc) : [];
  if (!s && !isUnlocked(perm, 'seasons')) return null;
  return (
    <div className="grid gap-[6px]" data-testid="season-panel">
      <div className="col-label">SEASON {s?.id ?? seasonOf(Date.now())} JOURNEY · {done.length}/{JOURNEY.length}</div>
      {!s ? (
        <span className="text-[12.5px] text-muted">Start this month's season at the deployment terminal: a fresh warden on a faster ladder, a season rule, its own leaderboards. When the month ends everything it earned moves here.</span>
      ) : (
        <div className="grid grid-cols-2 gap-[3px]">
          {JOURNEY.map((g) => (
            <span key={g.id} className={`text-[12.5px] ${done.includes(g.id) ? 'text-ok' : 'text-muted'}`} data-journey={g.id}>{done.includes(g.id) ? '✓' : '·'} {g.label}</span>
          ))}
          {journeyTitle(s.id, done.length) && <span className="col-span-2 font-mono text-[11px] text-violet">TITLE · {journeyTitle(s.id, done.length)!.toUpperCase()}</span>}
        </div>
      )}
      {!!perm.seasonsDone?.length && (
        <details className="field-notes">
          <summary>Past seasons ({perm.seasonsDone.length})</summary>
          {perm.seasonsDone.slice().reverse().map((a) => (
            <div key={a.id} className="text-[12.5px]">Season {a.id}: RL {a.rl} · wave {a.wave} · journey {a.journey}/{JOURNEY.length}{a.title ? ` · ${a.title}` : ''}</div>
          ))}
        </details>
      )}
    </div>
  );
}

interface BoardRow {
  name: string;
  rl: number;
  wave: number;
  waveRl: number;
}

/** Leaderboards (server profiles): this season or permanent, by Rift Level or deepest wave. */
/** `online` = false when the client runs without a server (local war): no request, the offline note shows. */
export function Leaderboards({ online = true }: { online?: boolean }) {
  const [scope, setScope] = useState<'season' | 'permanent'>('season');
  const [metric, setMetric] = useState<'rl' | 'wave'>('rl');
  const [rows, setRows] = useState<BoardRow[] | null | 'offline'>(null);
  const season = seasonOf(Date.now());
  useEffect(() => {
    let live = true;
    if (!online) {
      setRows('offline');
      return;
    }
    setRows(null);
    fetch(`${apiBase()}/boards?scope=${scope}&season=${season}&metric=${metric}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((v: { rows: BoardRow[] }) => live && setRows(v.rows))
      .catch(() => live && setRows('offline'));
    return () => {
      live = false;
    };
  }, [scope, metric, season, online]);
  const tab = (on: boolean) => `mini m-0 w-auto ${on ? 'on' : ''}`;
  return (
    <div className="grid gap-[6px]" data-testid="boards">
      <div className="col-label">LEADERBOARDS</div>
      <div className="flex flex-wrap gap-[5px]">
        <button className={tab(scope === 'season')} onClick={() => setScope('season')}>SEASON {season}</button>
        <button className={tab(scope === 'permanent')} onClick={() => setScope('permanent')}>ALL TIME</button>
        <span className="w-[10px]" />
        <button className={tab(metric === 'rl')} onClick={() => setMetric('rl')}>RIFT LEVEL</button>
        <button className={tab(metric === 'wave')} onClick={() => setMetric('wave')}>DEEPEST WAVE</button>
      </div>
      {rows === null && <span className="text-[12px] text-faint">Loading…</span>}
      {rows === 'offline' && <span className="text-[12px] text-muted" data-testid="boards-offline">Boards need the server: sign in with a passkey and play online. Only server-validated progress is ranked.</span>}
      {Array.isArray(rows) && !rows.length && <span className="text-[12px] text-muted">Nobody on this board yet.</span>}
      {Array.isArray(rows) && rows.map((r, i) => (
        <div key={r.name} className="flex justify-between text-[13px] border-b border-line py-[2px]">
          <span><span className="font-mono text-faint w-[26px] inline-block">{i + 1}</span>{r.name}</span>
          <b className="font-mono">{metric === 'rl' ? `RL ${r.rl}` : `W${r.wave} · RL ${r.waveRl}`}</b>
        </div>
      ))}
    </div>
  );
}
