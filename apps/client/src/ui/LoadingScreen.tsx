import { useEffect, useMemo, useState } from 'react';
import { FACTION_AFFINITY } from '@riftwarden/rules/combat/elements';
import { arenaStats } from '@riftwarden/rules/world/arenaGen';
import { biomeOf } from '@riftwarden/rules/world/biomes';
import type { ArenaLayout } from '@riftwarden/rules/world/layout';
import { pickTip } from './loadingTips';
import { type TransitInfo } from '@riftwarden/game/ui/store';
import { useHud } from './useHud';
import { FieldArt } from './FieldArt';
import { Bar, ElementGem } from './ds';

const STAGES = {
  arena: ['Charting sector', 'Raising structures', 'Calibrating optics', 'Drop clearance'],
  hq: ['Drone recovery', 'Restoring headquarters', 'Warming systems', 'Docking'],
  visit: ['Uplink to host', 'Mirroring headquarters', 'Warming systems', 'Docking'],
} as const;

const BIOME_ART: Record<string, string> = { cryo: 'ls-art-cryo', foundry: 'ls-art-foundry', outpost: 'ls-art-outpost' };

/** Scene-swap loading screen (final design): sector briefing on the left (name, faction, modifiers, weak / resisted
 * elements), the generated map in a glass frame on the right, load stages + tip along the bottom. */
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
  const s = t?.sector ?? null;
  const biome = s?.layout.biome ? biomeOf(s.layout) : null;
  return (
    <div className={`screen transit load-screen load-${kind} ds-scr`} data-testid="loading-screen">
      <div className={`ls-art ${BIOME_ART[s?.layout.biome ?? (kind === 'arena' ? 'outpost' : 'none')] ?? ''}`} aria-hidden="true" />
      <div className="ds-scrim-l" />
      <div className="ds-vig" />
      <div className="ds-top">
        <span className="ds-mono">{kind === 'arena' ? `DROP IN PROGRESS // ${s?.code ?? 'SECTOR'}` : kind === 'visit' ? 'CO-OP UPLINK' : 'WARDEN RECOVERY'}</span>
        <span className="ds-grow" />
        {s && <span className="ds-mono">{s.layout.seed !== undefined ? `SEED 0x${(s.layout.seed >>> 0).toString(16).toUpperCase()}` : ''}</span>}
      </div>
      <div className="ls-side ds-abs ds-col" style={{ left: 56, top: 92, width: 540, gap: 16 }}>
        <span className="ds-ov ds-em">{s?.node ? `${s.node.kind} sector · ${s.node.region || `act ${s.node.act}`}` : kind === 'arena' ? 'Sector briefing' : kind === 'visit' ? 'Co-op uplink' : 'Warden recovery'}</span>
        <span className="transit-title ls-name ds-hero" style={{ fontSize: 'clamp(56px, 6.5vw, 84px)' }}>{s?.name ?? t?.title ?? 'TRANSFERRING'}</span>
        {(biome || t?.sub) && (
          <span className="transit-sub ds-body" style={{ fontSize: 15 }}>
            {biome ? <>{biome.blurb} Held by the <b>{biome.faction.name}</b>: {biome.faction.blurb}</> : t?.sub}
          </span>
        )}
        {s && <SectorCard s={s} />}
      </div>
      <div className={`ls-map ds-abs ds-glass ds-cut ds-edge`} data-biome={s?.layout.biome} style={{ right: 56, top: 92, width: 'min(470px, 38vw)', aspectRatio: '470 / 420', padding: 0, overflow: 'hidden' }}>
        {s ? <>{!s.layout.biome && <FieldArt className="ls-map-art" name="hub-reactor" />}<SectorMap layout={s.layout} /></> : <FieldArt className="recovery-illustration" name="operation-recovery" />}
      </div>
      <div className="ds-abs ds-col" style={{ left: 56, right: 56, bottom: 34, gap: 12 }}>
        <div className="ds-row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <ol className="ls-stages ds-row" style={{ gap: 24, margin: 0, padding: 0, listStyle: 'none' }}>
            {labels.map((l, i) => (
              <li key={l} className={`ds-row ${i < stage ? 'done' : i === stage ? 'now' : ''}`} style={{ gap: 8, font: '700 14px var(--ds-d)', letterSpacing: '0.2em', textTransform: 'uppercase', color: i < stage ? 'var(--ds-ink)' : i === stage ? 'var(--ds-ember-soft)' : 'var(--ds-dim)' }}>
                {i < stage ? <span className="ds-up">✓</span> : i === stage ? <span className="ds-dia" style={{ background: 'var(--ds-ember)' }} /> : null}
                <span>{l}</span>
              </li>
            ))}
          </ol>
          <span className="ds-grow" />
          <span className="ls-tip ds-meta"><b style={{ color: 'var(--ds-ink)' }}>Tip: </b><span key={tipN}>{pickTip(kind === 'arena' ? 'arena' : 'hq', tipN)}</span></span>
        </div>
        <Bar value={Math.min(1, (stage + 0.5) / labels.length)} color="#ff8a3d" height={3} />
      </div>
      <div className="ds-grain" />
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

const TONE_CHIP: Record<string, string> = { risk: 'red', reward: 'green' };

function SectorCard({ s }: { s: NonNullable<TransitInfo['sector']> }) {
  const st = arenaStats(s.layout);
  const biome = s.layout.biome ? biomeOf(s.layout) : null;
  return (
    <div className="ls-card ds-col" style={{ gap: 14 }}>
      <div className="ds-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {s.node?.mods.map((m) => <span key={m.id} className={`ds-chip ${TONE_CHIP[m.tone] ?? ''}`} title={m.text}>{m.name}</span>)}
        {[...new Set(s.layout.features ?? [])].map((f) => <span key={f} className="ds-chip">{FEATURE_LABEL[f] ?? f}</span>)}
        <span className="ds-chip">{/^RL /.test(s.tier) ? s.tier : `Rift Level ${s.tier}`} · {s.tierName}</span>
        {s.players ? <span className="ds-chip">{s.players} wardens</span> : null}
      </div>
      {s.node && <span className="ds-meta">{s.node.blurb}{s.node.reward ? ` · ${s.node.reward}` : ''}</span>}
      <div className="ds-hr" />
      {biome && <div className={`ls-biome b-${s.layout.biome}`} data-testid="ls-biome"><AffinityRow faction={biome.faction.id} /></div>}
      <div className="ds-row ds-meta" style={{ gap: 18, flexWrap: 'wrap' }}>
        <span><b className="ds-d" style={{ fontSize: 18, color: 'var(--ds-ink)' }}>{st.size} m</b> span</span>
        <span><b className="ds-d" style={{ fontSize: 18, color: 'var(--ds-ink)' }}>{st.structures}</b> structures</span>
        <span><b className="ds-d" style={{ fontSize: 18, color: 'var(--ds-ink)' }}>{st.platforms}</b> plateaus</span>
        <span><b className="ds-d" style={{ fontSize: 18, color: 'var(--ds-ink)' }}>{st.rifts}</b> forward rifts</span>
        <span><b className="ds-d" style={{ fontSize: 18, color: 'var(--ds-ink)' }}>{st.lanes}</b> open gates</span>
      </div>
      {s.layout.mazing && <span className="ds-risk-tag" style={{ fontSize: 13 }}>Mazing sector: towers block ground lanes and can be breached</span>}
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
    <div className="aff-row ds-row" data-testid="ls-affinity" style={{ gap: 28, flexWrap: 'wrap' }}>
      <div className="ds-col" style={{ gap: 8 }}>
        <span className="ds-lbl">WEAK TO</span>
        <span className="ds-row" style={{ gap: 10 }}>{row.weak.map((e) => <span key={e} title={e}><ElementGem el={e} /><span className="ds-sr">{e.toUpperCase()}</span></span>)}<span className="ds-h3 ds-up">▲ ×1.35</span></span>
      </div>
      <div className="ds-col" style={{ gap: 8 }}>
        <span className="ds-lbl">RESISTS</span>
        <span className="ds-row" style={{ gap: 10 }}>{row.resist.map((e) => <span key={e} title={e}><ElementGem el={e} /><span className="ds-sr">{e.toUpperCase()}</span></span>)}<span className="ds-h3 ds-bad">▼ ×0.65</span></span>
      </div>
    </div>
  );
}
