import { useEffect, useMemo, useRef } from 'react';
import { NODE_KINDS } from '@riftwarden/rules/runmap/defs';
import type { MapNode } from '@riftwarden/rules/runmap/map';
import { GlobeView } from '../war/GlobeView';
import { regionLayout } from '@riftwarden/rules/war/regions';
import { HOUR, nodeLiberation, orderText, regionLiberation, regionState, type WarLogEntry, type WarState } from '@riftwarden/rules/war/state';
import { findNode } from '@riftwarden/rules/war/world';
import { KIND_COLOR } from './RunMap';
import { FieldIcon, NODE_ICON } from './FieldIcon';

const W = 1000;
const H = 640;
const px = (n: MapNode) => 60 + (n.x ?? 0.5) * (W - 120);
const py = (n: MapNode) => 40 + (n.y ?? 0.5) * (H - 80);
const hrs = (ms: number) => (ms <= 0 ? 'now' : ms < HOUR ? `${Math.ceil(ms / 60000)} min` : `${Math.ceil(ms / HOUR)} h`);

/** The hologram globe (its own engine on a small canvas). */
export function Globe({ war, selected, onSelect, size = 220 }: { war: WarState; selected: number; onSelect: (k: number) => void; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef<GlobeView | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const v = new GlobeView(ref.current);
    view.current = v;
    return () => {
      v.dispose();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    if (!view.current) return;
    view.current.onSelect = onSelect;
    view.current.update(war, selected);
  }, [war, selected, onSelect]);
  return <canvas ref={ref} className="war-globe" width={size} height={size} style={{ width: size, height: size }} data-testid="war-globe" />;
}

export interface RegionMapProps {
  war: WarState;
  k: number;
  current?: string | null;
  path?: readonly string[];
  /** Nodes the run can travel to (lit); `pickAll` makes every node of an unlocked region selectable (deployment). */
  reachable?: readonly string[];
  pickAll?: boolean;
  selected: string | null;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  votes?: Record<string, string[]>;
  ahead?: readonly string[];
  /** Log entries newer than this flash on the map (reactions). */
  seenAt?: number;
}

/**
 * One region of the Rift War as a hologram map: territory glow per sector (liberated cyan, contested orange,
 * corrupted red), links, a liberation ring per node, live events (distress, threat, convoy) with timers, the path
 * taken, and a ping on every sector whose state changed since the player last looked.
 */
export function RegionMap(p: RegionMapProps) {
  const def = regionLayout(p.war.seed, p.k);
  const reg = regionState(p.war, p.k);
  const now = Date.now();
  const fresh = useMemo(() => new Set(p.war.log.filter((l) => l.t > (p.seenAt ?? Infinity) && l.region === p.k && l.node).map((l) => l.node!)), [p.war, p.k, p.seenAt]);
  const reach = new Set(p.reachable ?? []);
  const ahead = new Set(p.ahead ?? []);
  const visited = new Set(p.path ?? []);
  const pathEdges = new Set<string>();
  for (let i = 1; i < (p.path?.length ?? 0); i++) pathEdges.add(`${p.path![i - 1]}>${p.path![i]}`).add(`${p.path![i]}>${p.path![i - 1]}`);
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const drawn = new Set<string>();
  const events = p.war.events.filter((e) => e.region === p.k);
  return (
    <svg className={`war-map${ahead.size ? ' has-ahead' : ''}`} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${def.name} region map`} data-testid="war-map">
      <defs>
        <radialGradient id="wmLib"><stop offset="0" stopColor="#5ff2d0" stopOpacity="0.32" /><stop offset="1" stopColor="#5ff2d0" stopOpacity="0" /></radialGradient>
        <radialGradient id="wmEnemy"><stop offset="0" stopColor="#ff8a50" stopOpacity="0.22" /><stop offset="1" stopColor="#ff8a50" stopOpacity="0" /></radialGradient>
        <radialGradient id="wmRift"><stop offset="0" stopColor="#ff2a3a" stopOpacity="0.45" /><stop offset="1" stopColor="#ff2a3a" stopOpacity="0" /></radialGradient>
        <pattern id="wmHex" width="28" height="48.5" patternUnits="userSpaceOnUse" patternTransform="scale(0.8)">
          <path d="M14 0 L28 8 L28 24 L14 32 L0 24 L0 8 Z M14 32 L14 48.5" fill="none" stroke="rgba(160,220,210,0.07)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="url(#wmHex)" />
      {/* Territory: soft glows per sector merge into fronts. */}
      {def.nodes.map((n) => {
        const st = reg?.nodes[n.id];
        const lib = reg ? nodeLiberation(p.war, n.id, def) : 0;
        const fill = st?.corrupt ? 'url(#wmRift)' : lib >= 100 || reg?.status === 'liberated' ? 'url(#wmLib)' : 'url(#wmEnemy)';
        return <circle key={`t${n.id}`} className={st?.corrupt ? 'wm-rift' : ''} cx={px(n)} cy={py(n)} r={st?.corrupt ? 120 : 105} fill={fill} />;
      })}
      {def.nodes.flatMap((n) =>
        n.links.map((l) => {
          const key = [n.id, l].sort().join('|');
          if (drawn.has(key)) return null;
          drawn.add(key);
          const m = byId.get(l);
          if (!m) {
            // Link to another region: a stub toward the map edge.
            const east = l.endsWith('n0');
            return <g key={key} className="wm-exit"><line x1={px(n)} y1={py(n)} x2={east ? W - 8 : 8} y2={py(n)} /><text x={east ? W - 14 : 14} y={py(n) - 8} textAnchor={east ? 'end' : 'start'}>{east ? 'NEXT REGION ›' : '‹ PREVIOUS REGION'}</text></g>;
          }
          const walked = pathEdges.has(`${n.id}>${l}`);
          const open = (p.current === n.id && reach.has(l)) || (p.current === l && reach.has(n.id));
          return <line key={key} className={`wm-link${walked ? ' walked' : ''}${open ? ' open' : ''}${ahead.has(n.id) && ahead.has(l) ? ' ahead' : ''}`} x1={px(n)} y1={py(n)} x2={px(m)} y2={py(m)} />;
        }),
      )}
      {def.nodes.map((n) => {
        const st = reg?.nodes[n.id];
        const lib = reg ? nodeLiberation(p.war, n.id, def) : 0;
        const can = p.pickAll ? !!reg : reach.has(n.id);
        const r = n.actBoss ? 30 : 22;
        const circ = 2 * Math.PI * (r + 5);
        const ev = events.filter((e) => e.node === n.id);
        const vs = p.votes?.[n.id] ?? [];
        const c = KIND_COLOR[n.kind];
        return (
          <g
            key={n.id}
            className={`wm-node${can ? ' can' : ''}${visited.has(n.id) ? ' seen' : ''}${p.current === n.id ? ' cur' : ''}${p.selected === n.id ? ' sel' : ''}${st?.corrupt ? ' corrupt' : ''}${lib >= 100 ? ' free' : ''}${ahead.has(n.id) ? ' ahead' : ''}${fresh.has(n.id) ? ' fresh' : ''}`}
            transform={`translate(${px(n)} ${py(n)})`}
            tabIndex={p.onHover || can ? 0 : undefined}
            role={p.onHover || can ? 'button' : undefined}
            aria-label={`${n.actBoss ? 'Capital' : `Sector ${n.col + 1}`} · ${NODE_KINDS[n.kind].name}`}
            aria-disabled={!can}
            aria-pressed={p.selected === n.id}
            onClick={() => can && p.onSelect?.(n.id)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              if (can) p.onSelect?.(n.id);
            }}
            // Keep the keyboard inspection available when focus moves to the intel tabs.
            onFocus={() => p.onHover?.(n.id)}
            onMouseEnter={() => p.onHover?.(n.id)}
            onMouseLeave={() => p.onHover?.(null)}
            data-testid={`wm-node-${n.id}`}
            data-kind={n.kind}
            style={{ ['--kc' as string]: c }}
          >
            {fresh.has(n.id) && <circle className="wm-ping" r={r + 14} />}
            {can && <circle className="wm-pulse" r={r + 9} />}
            <circle className="wm-track" r={r + 5} />
            {st && <circle className="wm-lib" r={r + 5} strokeDasharray={`${(circ * lib) / 100} ${circ}`} transform="rotate(-90)" />}
            <circle className="wm-badge" r={r} />
            <g className="wm-node-icon" transform={n.actBoss ? 'translate(-17 -17) scale(1.42)' : 'translate(-12 -12)'}>
              <FieldIcon name={st?.corrupt ? 'corrupt' : NODE_ICON[n.kind]} />
            </g>
            {p.current === n.id && <circle className="wm-cur" r={r + 11} />}
            {st && <text className="wm-pct" y={r + 24}>{Math.round(lib)}%</text>}
            {ev.map((e, i) => (
              <g key={e.id} className={`wm-ev ev-${e.kind}`} transform={`translate(${r + 6} ${-r - 4 + i * 18})`}>
                <circle r={12} />
                <g className="wm-event-icon" transform="translate(-8 -8)">
                  <FieldIcon name={e.kind === 'distress' ? 'corrupt' : e.kind === 'defense' ? 'survivability' : 'courier'} />
                </g>
                <text className="wm-evt" x={16} y={5}>{hrs(e.until - now)}</text>
              </g>
            ))}
            {vs.length > 0 && <text className="wm-votes" y={-r - 12}>{vs.join(' · ')}</text>}
          </g>
        );
      })}
      <text className="wm-title" x={20} y={28}>{def.name.toUpperCase()} · {def.faction.toUpperCase()}</text>
    </svg>
  );
}

/** Region status strip: liberation, corruption, status. */
export function RegionStrip({ war, k }: { war: WarState; k: number }) {
  const reg = regionState(war, k);
  const def = regionLayout(war.seed, k);
  const lib = regionLiberation(war, k);
  const corrupt = reg ? Object.values(reg.nodes).filter((n) => n.corrupt).length : 0;
  return (
    <div className="war-strip" data-testid="war-strip">
      <b>{def.name}</b>
      <span>{!reg ? 'LOCKED' : reg.status === 'liberated' ? 'LIBERATED' : `${Math.round(lib)}% LIBERATED`}</span>
      <i className="war-bar"><i style={{ width: `${lib}%` }} /></i>
      {reg?.status === 'active' && <span className="war-corrupt">☣ {corrupt} corrupted{reg.fallbacks ? ` · fell back ${reg.fallbacks}×` : ''}</span>}
    </div>
  );
}

/** War order banner. */
export function OrderBanner({ war }: { war: WarState }) {
  const o = war.order;
  const buffs = war.buffs.filter((b) => b.until > Date.now());
  if (!o && !buffs.length) return null;
  return (
    <div className="war-order" data-testid="war-order">
      {o && (
        <div>
          <b>WAR ORDER · {regionLayout(war.seed, o.region).name}</b>
          <span>{orderText(o)} · {hrs(o.until - Date.now())} left</span>
        </div>
      )}
      {buffs.map((b, i) => (
        <div key={i} className="war-buff"><b>ORDER REWARD ACTIVE</b><span>{b.kind === 'luck' ? 'Loot luck' : 'Income'} +{Math.round((b.mult - 1) * 100)}% · {hrs(b.until - Date.now())} left</span></div>
      ))}
    </div>
  );
}

const LOG_ICON: Partial<Record<WarLogEntry['kind'], string>> = { liberated: '✓', corrupted: '☣', purged: '✚', threat: '⛨', repelled: '⛨', fell: '☠', distress: '!', convoy: '◈', convoyDown: '◈', order: '★', orderDone: '★', orderFailed: '✗', region: '⚑', fallback: '☠' };

/** War report: what changed on the front; entries newer than the last look are highlighted (the "reaction"). */
export function WarReport({ war, seenAt, max = 8 }: { war: WarState; seenAt: number; max?: number }) {
  const list = war.log.slice(0, max);
  const fresh = war.log.filter((l) => l.t > seenAt).length;
  return (
    <div className="war-report" data-testid="war-report">
      <div className="cp-label">WAR REPORT{fresh ? ` · ${fresh} NEW` : ''}</div>
      {!list.length && <div className="rm-none">The front is quiet.</div>}
      {list.map((l, i) => (
        <div key={`${l.t}${i}`} className={`wr-line k-${l.kind}${l.t > seenAt ? ' new' : ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
          <i>{LOG_ICON[l.kind] ?? '·'}</i>
          <span>{l.text}</span>
          <em>{hrs(Date.now() - l.t)} ago</em>
        </div>
      ))}
    </div>
  );
}

/** Header: shared vs offline war, wardens online, regions held. */
export function WarHeader({ war, source, online }: { war: WarState; source: 'server' | 'local'; online: number }) {
  const held = war.regions.filter((r) => r.status === 'liberated').length;
  return (
    <div className="war-head" data-testid="war-head">
      <span className={`war-src ${source}`}>{source === 'server' ? 'SHARED RIFT WAR' : 'OFFLINE COPY · NOT COUNTED'}</span>
      {source === 'server' && <span>{online} online · avg {war.avgOnline.toFixed(1)}</span>}
      <span>{held} region{held === 1 ? '' : 's'} liberated · front: {regionLayout(war.seed, Math.max(...war.regions.map((r) => r.k))).name}</span>
    </div>
  );
}

/** Region tabs for the unlocked regions (newest first). */
export function RegionTabs({ war, k, onPick }: { war: WarState; k: number; onPick: (k: number) => void }) {
  return (
    <div className="war-tabs">
      {[...war.regions].reverse().map((r) => (
        <button key={r.k} className={`${r.k === k ? 'on' : ''} ${r.status}`} data-testid={`war-region-${r.k}`} onClick={() => onPick(r.k)}>
          {regionLayout(war.seed, r.k).name}
          <em>{Math.round(regionLiberation(war, r.k))}%</em>
        </button>
      ))}
    </div>
  );
}

/** Node lookup with a region fallback (selected id may sit in another region). */
export const regionOfNode = (seed: number, id: string | null | undefined, fallback: number): number => {
  const n = id ? findNode(seed, id) : null;
  return n ? n.act - 1 : fallback;
};
