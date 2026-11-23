import { NodeCard } from './RunMap';
import { useEffect, useMemo, useState } from 'react';
import { FACTION_AFFINITY } from '@riftwarden/rules/combat/elements';
import { ElementTag } from './ElementTag';
import { arenaStats } from '@riftwarden/rules/world/arenaGen';
import { biomeOf } from '@riftwarden/rules/world/biomes';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { pickTip } from './loadingTips';
import { type TransitInfo } from '@riftwarden/game/ui/store';
import { useHud } from './useHud';
import { FieldArt } from './FieldArt';

const STAGES = {
  arena: ['Charting sector', 'Raising structures', 'Calibrating optics', 'Drop clearance'],
  hq: ['Drone recovery', 'Restoring headquarters', 'Warming systems', 'Docking'],
  visit: ['Uplink to host', 'Mirroring headquarters', 'Warming systems', 'Docking'],
} as const;

/** Scene-swap loading screen: sector briefing with a live map of the generated arena, stages and tips. */
export function LoadingScreen() {
  const t = useHud((s) => s.transit);
  const kind = t?.kind ?? 'hq';
  const [tipN, setTipN] = useState(() => Math.floor(Math.random() * 1000));
  useEffect(() => {
    const id = setInterval(() => setTipN((n) => n + 1), 4200);
    return () => clearInterval(id);
  }, []);
  const stage = t?.stage ?? 0;
  const labels = STAGES[kind];
  return (
    <div className={`screen transit load-screen load-${kind}`} data-testid="loading-screen">
      <div className="ls-grid" aria-hidden="true" />
      <div className="ls-sweep" aria-hidden="true" />
      <div className="ls-body">
        <div className="ls-side">
          <div className="ls-kicker">{kind === 'arena' ? 'SECTOR BRIEFING' : kind === 'visit' ? 'CO-OP UPLINK' : 'WARDEN RECOVERY'}</div>
          <div className="transit-title">{t?.title ?? 'TRANSFERRING'}</div>
          <div className="transit-sub">{t?.sub ?? ''}</div>
          {t?.sector && <SectorCard s={t.sector} />}
          <ol className="ls-stages">
            {labels.map((l, i) => (
              <li key={l} className={i < stage ? 'done' : i === stage ? 'now' : ''}>
                <i />
                <span>{l}</span>
              </li>
            ))}
          </ol>
          <div className="load-bar ls-bar">
            <b style={{ transform: `scaleX(${Math.min(1, (stage + 0.5) / labels.length)})` }} />
            <i />
          </div>
          <div className="ls-tip">
            <em>TIP</em>
            <span key={tipN}>{pickTip(kind === 'arena' ? 'arena' : 'hq', tipN)}</span>
          </div>
        </div>
        <div className="ls-map" data-biome={t?.sector?.layout.biome}>
          {t?.sector ? <>{!t.sector.layout.biome && <FieldArt className="ls-map-art" name="hub-reactor" />}<SectorMap layout={t.sector.layout} /></> : <FieldArt className="recovery-illustration" name="operation-recovery" />}
        </div>
      </div>
    </div>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  transfer: 'Grapple galleries',
  maze: 'Maze',
  serpentine: 'Chicane',
  containers: 'Container yard',
  overpass: 'Overpass',
  redoubt: 'Redoubt',
  skyway: 'Skyway',
  ring: 'Bastion ring',
};

function SectorCard({ s }: { s: NonNullable<TransitInfo['sector']> }) {
  const st = arenaStats(s.layout);
  return (
    <div className="ls-card">
      <div className="flex justify-between gap-[10px] font-mono text-[11px] tracking-[0.16em] text-muted">
        <span className="text-cyan">{s.code}</span>
        <span className="text-orange">{/^RL /.test(s.tier) ? s.tier : `TIER ${s.tier}`} · {s.tierName}</span>
      </div>
      <div className="ls-name font-display font-[700] [font-size:clamp(18px,2vw,24px)] tracking-[0.08em] m-[6px_0_10px] uppercase">{s.name}</div>
      {s.node && <NodeCard b={s.node} />}
      {s.layout.biome && (
        <div className={`ls-biome b-${s.layout.biome}`} data-testid="ls-biome">
          <b>{biomeOf(s.layout).name}</b>
          <span>{biomeOf(s.layout).blurb}</span>
          <em>
            HOSTILE FACTION · {biomeOf(s.layout).faction.name.toUpperCase()}
          </em>
          <span>{biomeOf(s.layout).faction.blurb}</span>
          <AffinityRow faction={biomeOf(s.layout).faction.id} />
        </div>
      )}
      <div className="ls-stats">
        <div><b>{st.size} m</b><span>SPAN</span></div>
        <div><b>{st.structures}</b><span>STRUCTURES</span></div>
        <div><b>{st.platforms}</b><span>PLATEAUS</span></div>
        <div><b>{st.rifts}</b><span>FWD RIFTS</span></div>
        <div><b>{st.lanes}</b><span>OPEN GATES</span></div>
        {s.players ? <div><b>{s.players}</b><span>WARDENS</span></div> : null}
      </div>
      {!!s.layout.features?.length && (
        <div className="ls-feats">
          {[...new Set(s.layout.features)].map((f) => (
            <span key={f}>{FEATURE_LABEL[f] ?? f}</span>
          ))}
        </div>
      )}
      {s.layout.mazing && <div className="mt-[10px] text-[12px] text-amber">Mazing sector: towers block ground lanes and can be breached.</div>}
    </div>
  );
}

/** Top-down sector map (SVG): structures by kind, ramps, lanes, rifts, reactor and drop point. */
function SectorMap({ layout: L }: { layout: ArenaLayout }) {
  const biome = L.biome ?? 'outpost';
  const ext = L.half + 14;
  const content = useMemo(() => {
    const solids = L.boxes.filter((b) => b.kind !== 'reactor');
    return (
      <>
        <rect className="lm-floor" x={-L.half} y={-L.half} width={L.half * 2} height={L.half * 2} />
        {Array.from({ length: Math.floor((L.half * 2) / 10) + 1 }, (_, i) => -L.half + i * 10).map((g) => (
          <g key={g} className="lm-grid">
            <line x1={g} y1={-L.half} x2={g} y2={L.half} />
            <line x1={-L.half} y1={g} x2={L.half} y2={g} />
          </g>
        ))}
        {solids.map((b, i) => (
          <rect key={i} className={`lm-${b.kind}`} x={b.min[0]} y={-b.max[2]} width={b.max[0] - b.min[0]} height={b.max[2] - b.min[2]} style={{ animationDelay: `${(i % 24) * 0.02}s` }} />
        ))}
        {L.ramps.map((r, i) => (
          <rect key={`r${i}`} className="lm-ramp" x={r.x0} y={-r.z1} width={r.x1 - r.x0} height={r.z1 - r.z0} />
        ))}
        {Object.values(L.routes).map((r) => (
          <polyline key={r.gate} className={L.initialGates.includes(r.gate) ? 'lm-lane' : 'lm-lane sealed'} points={r.points.map((p) => `${p.x},${-p.z}`).join(' ')} />
        ))}
        {(L.rifts ?? []).map((r, i) => (
          <g key={`q${i}`} className="lm-rift" transform={`translate(${r.x} ${-r.z})`}>
            <circle r={4.5} />
            <circle r={1.6} className="core" />
          </g>
        ))}
        {(L.hazards ?? []).map((h, i) => (
          <circle key={`h${i}`} className={`lm-haz ${h.kind}`} cx={h.x} cy={-h.z} r={h.r} />
        ))}
        <circle className="[fill:none] [stroke:var(--cyan)] [stroke-width:0.5] [stroke-dasharray:2_1.5]" cx={L.reactor.x} cy={-L.reactor.z} r={L.reactor.radius + 6} />
        <circle className="[fill:var(--cyan)] [filter:drop-shadow(0_0_3px_var(--cyan))]" cx={L.reactor.x} cy={-L.reactor.z} r={L.reactor.radius} />
        <path className="[fill:var(--white)]" d={`M ${L.playerSpawn.x} ${-L.playerSpawn.z - 3} l 2.4 5 l -4.8 0 z`} />
      </>
    );
  }, [L]);
  return (
    <div className={`ls-mapframe biome-${biome}`}>
      <svg viewBox={`${-ext} ${-ext} ${ext * 2} ${ext * 2}`} className="lm" aria-label="Sector map">
        {content}
      </svg>
      <div className="ls-radar" aria-hidden="true" />
      <div className="ls-legend">
        <span className="k-lane">HOSTILE LANE</span>
        <span className="k-rift">FORWARD RIFT</span>
        <span className="k-core">REACTOR</span>
        <span className="k-spawn">DROP POINT</span>
      </div>
    </div>
  );
}

/** Faction element row: what to bring (weak) and what to leave home (resisted). */
export function AffinityRow({ faction }: { faction: string }) {
  const row = FACTION_AFFINITY[faction];
  if (!row) return null;
  return (
    <div className="aff-row" data-testid="ls-affinity">
      <span className="aff-label">WEAK</span>
      {row.weak.map((e) => <ElementTag key={e} element={e} long />)}
      <span className="aff-label" style={{ marginLeft: 8 }}>RESISTS</span>
      {row.resist.map((e) => <ElementTag key={e} element={e} long />)}
    </div>
  );
}
