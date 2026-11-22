import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import type { Flow } from '../core/Flow';
import { STAT_DEFS, type StatKey } from '@riftwarden/rules/combat/stats';
import { levelInfo, pointsAt, RING_EVERY, ringsAt } from '@riftwarden/rules/progression/level';
import {
  BRANCH_INFO,
  BRANCHES,
  CORE_ID,
  allocateBlocker,
  describeMod,
  describeRule,
  generateTree,
  respecCost,
  treeModifiers,
  treeRules,
  type TreeNode,
} from '@riftwarden/rules/progression/skilltree';
import { useSave } from './App';
import { ConfirmButton, CostLine, ResourceBar, TxMessage, useTx } from './economy';
import { Shell } from './shell';

const RING_GAP = 58;
const CORE_R = 34;
const label = (k: StatKey) => STAT_DEFS[k].label;
const kind = (k: StatKey) => STAT_DEFS[k].kind;
const nodeStyle = (n: TreeNode, state: string) => ({ stroke: BRANCH_INFO[n.branch].color, fill: state === 'on' ? BRANCH_INFO[n.branch].color : undefined });
const pos = (n: { ring: number; angle: number }) => {
  const r = CORE_R + n.ring * RING_GAP;
  return { x: Math.cos(n.angle) * r, y: -Math.sin(n.angle) * r };
};

/** Neural Lattice: the Warden's procedural skill tree (seeded per profile, a ring per 5 levels). */
export function SkillTreeTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const { xp, tree: st, respecs } = save.progress;
  const info = levelInfo(xp);
  const rings = ringsAt(info.level);
  // One locked preview ring beyond the revealed ones.
  const tree = useMemo(() => generateTree(st.seed, rings + 1), [st.seed, rings]);
  const have = useMemo(() => new Set(st.allocated), [st.allocated]);
  const free = Math.max(0, pointsAt(info.level) - st.allocated.length);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const { msg, run } = useTx(flow, 'lattice');
  const node = sel ? tree.byId.get(sel) ?? null : null;
  const blocker = node ? allocateBlocker(tree, st.allocated, node.id, info.level) : null;
  const totals = useMemo(() => treeModifiers(st.seed, st.allocated), [st.seed, st.allocated]);
  const rules = useMemo(() => treeRules(st.seed, st.allocated), [st.seed, st.allocated]);
  const extent = CORE_R + (rings + 1) * RING_GAP + 30;
  const size = extent * 2 / view.z;

  const reachable = (n: TreeNode) => n.parents.some((p) => p === CORE_ID || have.has(p));
  const onWheel = (e: RWheelEvent) => setView((v) => ({ ...v, z: Math.max(0.6, Math.min(4, v.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) }));
  const onDown = (e: RPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = size / (e.currentTarget as Element).getBoundingClientRect().width;
    setView((v) => ({ ...v, x: d.vx - (e.clientX - d.x) * k, y: d.vy - (e.clientY - d.y) * k }));
  };

  return (
    <Shell code="NL-07" title="NEURAL LATTICE" sub={`Warden level ${info.level} · ${free} skill point${free === 1 ? '' : 's'} free`} close={close} accent="violet" wide>
      <div className="lattice">
        <div className="lattice-map">
          <svg
            data-testid="skill-tree"
            viewBox={`${view.x - size / 2} ${view.y - size / 2} ${size} ${size}`}
            onWheel={onWheel}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
          >
            {Array.from({ length: rings + 1 }, (_, i) => (
              <circle key={i} className={`ring ${i + 1 > rings ? 'locked' : ''}`} r={CORE_R + (i + 1) * RING_GAP} />
            ))}
            {BRANCHES.map((b, i) => {
              const a = (i + 0.5) * (Math.PI / 2);
              const r = extent - 14;
              return (
                <text key={b} className="branch-label" x={Math.cos(a) * r} y={-Math.sin(a) * r} fill={BRANCH_INFO[b].color}>
                  {BRANCH_INFO[b].name.toUpperCase()}
                </text>
              );
            })}
            {tree.nodes.map((n) =>
              n.parents.map((p) => {
                const a = pos(n);
                const b = p === CORE_ID ? { x: Math.cos(n.angle) * CORE_R, y: -Math.sin(n.angle) * CORE_R } : pos(tree.byId.get(p)!);
                const on = have.has(n.id) && (p === CORE_ID || have.has(p));
                return <line key={`${n.id}-${p}`} className={`edge ${on ? 'on' : ''} ${n.ring > rings ? 'locked' : ''}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={on ? { stroke: BRANCH_INFO[n.branch].color } : undefined} />;
              }),
            )}
            <circle className="core" r={CORE_R} />
            <text className="core-label" y={5}>
              LV {info.level}
            </text>
            {tree.nodes.map((n) => {
              const p = pos(n);
              const locked = n.ring > rings;
              const state = have.has(n.id) ? 'on' : locked ? 'locked' : reachable(n) ? 'open' : 'far';
              const r = n.kind === 'keystone' ? 13 : n.kind === 'notable' ? 9.5 : 7;
              return (
                <g key={n.id} transform={`translate(${p.x} ${p.y})`} className={`node ${state} ${n.kind} ${sel === n.id ? 'sel' : ''}`} data-node={n.id} data-state={state} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSel(n.id)}>
                  {n.kind === 'keystone' ? <rect x={-r} y={-r} width={r * 2} height={r * 2} transform="rotate(45)" style={nodeStyle(n, state)} /> : <circle r={r} style={nodeStyle(n, state)} />}
                </g>
              );
            })}
          </svg>
          <div className="absolute left-[10px] bottom-[8px] [font:10px_var(--mono)] text-faint pointer-events-none">Drag to pan · scroll to zoom · a new ring opens every {RING_EVERY} levels</div>
        </div>
        <div className="grid [align-content:start] gap-[12px]">
          <div className="lattice-level">
            <b>LEVEL {info.level}</b>
            <div className="xp-bar">
              <i style={{ width: `${Math.round(info.frac * 100)}%` }} />
            </div>
            <small>
              {info.into.toLocaleString()} / {info.need.toLocaleString()} XP to level {info.level + 1}
            </small>
          </div>
          {node ? (
            <div className="lattice-node" data-testid="lattice-node">
              <div className="[font:600_10px_var(--mono)] tracking-[0.16em] text-faint" style={{ color: BRANCH_INFO[node.branch].color }}>
                {BRANCH_INFO[node.branch].name.toUpperCase()} · {node.kind.toUpperCase()} · RING {node.ring}
              </div>
              <h3>{node.name}</h3>
              <ul>
                {node.mods.map((m, i) => (
                  <li key={i} className={m.value < 0 && STAT_DEFS[m.stat].better === 'higher' ? 'neg' : ''}>
                    {describeMod(m, label, kind)}
                  </li>
                ))}
                {node.rule && describeRule(node.rule).map((r) => <li key={r}>{r}</li>)}
              </ul>
              {have.has(node.id) ? (
                <div className="term-msg">Allocated</div>
              ) : (
                <button className="primary" data-testid="lattice-allocate" disabled={!!blocker} title={blocker ?? ''} onClick={() => run('allocate', 'treeAllocate', [node.id], () => `${node.name} allocated`)}>
                  {blocker ?? 'ALLOCATE · 1 POINT'}
                </button>
              )}
            </div>
          ) : (
            <div className="lattice-node muted">Select a node. Nodes connected to the core or to an allocated node can be taken.</div>
          )}
          <TxMessage msg={msg} />
          <div className="lattice-totals">
            <div className="[font:600_10px_var(--mono)] tracking-[0.16em] text-faint">TREE TOTAL ({st.allocated.length} nodes)</div>
            {totals.length === 0 && <small>Nothing allocated yet.</small>}
            <ul>
              {totals.map((m) => (
                <li key={`${m.stat}${m.op}`} className={m.value < 0 && STAT_DEFS[m.stat].better === 'higher' ? 'neg' : ''}>
                  {describeMod(m, label, kind)}
                </li>
              ))}
              {describeRule({ xpMult: rules.xpMult - 1, startCores: rules.startCores }).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <small>Bonuses per stat are soft-capped: stacking one stat gives diminishing returns.</small>
          </div>
          <div className="lattice-respec">
            <CostLine cost={{ credits: respecCost(respecs) }} save={save} label="RESPEC" />
            <ConfirmButton
              label="REFUND ALL POINTS"
              confirm="Refund every point?"
              testId="lattice-respec"
              disabled={!st.allocated.length || save.resources.credits < respecCost(respecs)}
              onConfirm={() => {
                setSel(null);
                run('respec', 'treeRespec', [], () => 'All points refunded');
              }}
            />
          </div>
          <ResourceBar save={save} compact />
        </div>
      </div>
    </Shell>
  );
}
