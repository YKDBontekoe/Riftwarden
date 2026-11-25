import { BoundKey } from './hud/widgets';
import { useState } from 'react';
import type { Flow } from '../core/Flow';
import { BUILD_CATEGORIES, costText } from '@riftwarden/game/home/build/BuildMode';
import { LIGHT_COLORS, LIMITS, PIECES, type PieceDef, pieceDef } from '@riftwarden/rules/home/build/catalog';
import { blueprintStatus, CRAFT_PIECES } from '@riftwarden/rules/home/build/ops';
import { MOVABLE_STATIONS } from '@riftwarden/rules/home/build/catalog';
import { HQ_STATIONS } from '@riftwarden/rules/home/layout';
import { useSave } from './useSave';
import { CostLine, ResourceBar, TxMessage, useTx } from './economy';
import { Shell } from './shell';
import { useHud } from './useHud';

/** Architect console: construction entry point, blueprint catalogue, owned pieces, facility summary. */
export function ArchitectTerminal({ flow, close }: { flow: Flow; close: () => void }) {
  const save = useSave(flow);
  const tx = useTx(flow, 'workshop');
  const s = save.base.structure;
  const floors = Object.keys(s.floors).length;
  const lit = save.base.placeables.filter((p) => pieceDef(p.type)?.light && p.props.on !== false).length;
  const market = PIECES.filter((p) => p.unlock.by === 'merchant');
  const progression = PIECES.filter((p) => p.unlock.by === 'milestone' || p.unlock.by === 'tier');
  return (
    <Shell code="AR-10" title="ARCHITECT CONSOLE" sub="Headquarters construction · blueprints · facilities" close={close} wide>
      <ResourceBar save={save} />
      <div className="grid grid-cols-[1fr_1fr] gap-[22px]">
        <div>
          <div className="col-label">CONSTRUCTION</div>
          <p className="arch-lead">
            Extend the headquarters through the sealed <b>hangar</b> (west) and <b>transit</b> (east) gateways on a 5 m grid: floors, walls, windows, doors, ceilings and pillars snap together; furniture, machinery, lights and facilities go anywhere on a reachable floor. Every station except deployment can be relocated. Removing anything refunds it in full.
          </p>
          <div className="arch-stats">
            <span>
              MODULES <b>{floors}</b>/{LIMITS.floors}
            </span>
            <span>
              WALLS <b>{Object.keys(s.edges).length}</b>
            </span>
            <span>
              OBJECTS <b>{save.base.placeables.length}</b>/{LIMITS.props}
            </span>
            <span>
              LIGHTS ON <b>{lit}</b>/{LIMITS.lights}
            </span>
            <span>
              RELOCATED STATIONS <b>{Object.keys(save.base.stations).length}</b>
            </span>
          </div>
          <button className="primary deploy" data-testid="enter-construction" disabled={!!save.activeRun || flow.home?.readOnly} onClick={() => flow.home?.enterConstruction()}>
            <span>ENTER CONSTRUCTION MODE</span>
            <i>▶</i>
          </button>
          <div className="col-label">FACILITIES</div>
          {PIECES.filter((p) => p.kind === 'facility').map((p) => (
            <div key={p.id} className="arch-row">
              <span>
                <b>{p.name}</b> · {p.effect}
              </span>
              <em>
                {save.base.placeables.filter((q) => q.type === p.id).length}/{p.limit} placed · {blueprintStatus(save, p).unlocked ? costText(p) : blueprintStatus(save, p).how}
              </em>
            </div>
          ))}
          <div className="col-label">FABRICATED PIECES</div>
          {Object.entries(CRAFT_PIECES).map(([id, cost]) => {
            const p = pieceDef(id)!;
            return (
              <div key={id} className="arch-row">
                <span>
                  <b>{p.name}</b> · owned {save.base.owned[id] ?? 0}
                </span>
                <CostLine cost={cost} save={save} />
                <button className="mini" data-testid={`fab-${id}`} onClick={() => tx.run('craft', 'hqFabricate', [id], () => `${p.name} fabricated · place it in construction mode`)}>
                  FABRICATE
                </button>
              </div>
            );
          })}
        </div>
        <div>
          <div className="col-label">BLUEPRINT CATALOGUE</div>
          {market.map((p) => {
            const st = blueprintStatus(save, p);
            const price = p.unlock.by === 'merchant' ? p.unlock.price : 0;
            return (
              <div key={p.id} className={`arch-row ${st.unlocked ? 'owned' : ''}`}>
                <span>
                  <b>{p.name}</b> · {p.blurb}
                </span>
                {st.unlocked ? (
                  <em>OWNED</em>
                ) : (
                  <button className="mini" data-testid={`bp-${p.id}`} disabled={save.resources.credits < price} onClick={() => tx.run('buy', 'hqBlueprint', [p.id], () => `${p.name} blueprint acquired`)}>
                    BUY · {price} cr
                  </button>
                )}
              </div>
            );
          })}
          <div className="col-label">EARNED IN OPERATIONS</div>
          {progression.map((p) => {
            const st = blueprintStatus(save, p);
            return (
              <div key={p.id} className={`arch-row ${st.unlocked ? 'owned' : 'locked'}`}>
                <span>
                  <b>{p.name}</b>
                </span>
                <em>{st.unlocked ? 'UNLOCKED' : st.how}</em>
              </div>
            );
          })}
          <TxMessage msg={tx.msg} />
        </div>
      </div>
    </Shell>
  );
}

/** In-mode construction panel (catalogue, tool, selection, undo/redo). */
export function ConstructionPanel({ flow }: { flow: Flow }) {
  const h = useHud((s) => s.construct);
  const save = useSave(flow);
  const [cat, setCat] = useState<(typeof BUILD_CATEGORIES)[number]['id']>('structure');
  const bm = flow.home?.build;
  if (!h || !bm) return null;
  const tool = h.tool;
  const pieces = PIECES.filter((p) => p.category === cat);
  const sel = h.selection;
  const selDef = sel?.type === 'prop' ? pieceDef(sel.piece) : undefined;
  const sp: Record<string, unknown> = sel?.type === 'prop' ? sel.props : {};
  return (
    <div className="construct" data-testid="construct-panel">
      <div className="cons-top">
        <div className="cons-title">CONSTRUCTION MODE</div>
        <ResourceBar save={save} compact />
        <button className="mini" onClick={() => bm.undo()} disabled={!h.undo} data-testid="cons-undo">
          UNDO ({h.undo})
        </button>
        <button className="mini" onClick={() => bm.redo()} disabled={!h.redo} data-testid="cons-redo">
          REDO ({h.redo})
        </button>
        <button className="mini" onClick={() => void flow.home?.exitConstruction()} data-testid="cons-exit">
          DONE <BoundKey action="build" />
        </button>
      </div>
      <div className="cons-side">
        <div className="cons-tools">
          <button className={tool.kind === 'select' ? 'on' : ''} onClick={() => bm.setTool({ kind: 'select' })}>
            SELECT / MOVE
          </button>
          <button className={tool.kind === 'remove' ? 'on' : ''} onClick={() => bm.setTool({ kind: 'remove' })}>
            REMOVE
          </button>
          <button className={h.snap ? 'on' : ''} onClick={() => bm.toggleSnap()}>
            SNAP {h.snap ? 'ON' : 'OFF'} <BoundKey action="wave" />
          </button>
        </div>
        <div className="cons-cats">
          {BUILD_CATEGORIES.map((c) => (
            <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="cons-list">
          {cat === 'stations'
            ? HQ_STATIONS.filter((s) => (MOVABLE_STATIONS as readonly string[]).includes(s.id)).map((s) => (
                <div key={s.id} className="cons-item">
                  <b>{s.title}</b>
                  <small>{save.base.stations[s.id] ? 'Relocated' : 'Original position'} · select it in the HQ, then MOVE</small>
                </div>
              ))
            : pieces.map((p) => <PieceCard key={p.id} p={p} lock={blueprintStatus(save, p)} owned={save.base.owned[p.id] ?? 0} active={tool.kind === 'place' && tool.piece === p.id} onPick={() => bm.setTool({ kind: 'place', piece: p.id })} />)}
        </div>
      </div>
      <div className={`cons-status ${h.valid ? 'ok' : 'bad'}`} data-testid="cons-status">
        {h.message || 'Choose a piece from the catalogue, or select an object to move it'}
        {h.tool.kind === 'place' && <span> · rotation {Math.round((h.yaw * 180) / Math.PI)}° · scale {Math.round(h.scale * 100)}%</span>}
      </div>
      {sel && (
        <div className="cons-sel" data-testid="cons-selection">
          <div className="cons-title">{sel.type === 'prop' ? selDef?.name ?? sel.piece : sel.title}</div>
          <div className="row2">
            <button onClick={() => bm.startMove()} disabled={h.moving}>
              {h.moving ? 'MOVING…' : 'MOVE (M)'}
            </button>
            <button className="danger" onClick={() => bm.removeSelected()}>
              {sel.type === 'prop' ? 'REMOVE · REFUND' : 'RESET POSITION'}
            </button>
          </div>
          {selDef && (selDef.light || selDef.id === 'lightStrip') && (
            <div className="cons-light">
              <div className="swatches">
                {Object.entries(LIGHT_COLORS).map(([k, c]) => (
                  <button key={k} className={sp.color === k ? 'on' : ''} style={{ background: `rgb(${c.map((v) => Math.round(v * 255)).join(',')})` }} onClick={() => bm.setProps({ color: k })} title={k} />
                ))}
              </div>
              <label>
                INTENSITY
                <input type="range" min={0.2} max={1.6} step={0.1} value={Number(sp.intensity ?? 1)} onChange={(e) => bm.setProps({ intensity: Number(e.target.value) })} />
              </label>
              <button className="mini" onClick={() => bm.setProps({ on: sp.on === false })}>
                {sp.on === false ? 'SWITCH ON' : 'SWITCH OFF'}
              </button>
              <small>
                Real lights on: {h.lights}/{LIMITS.lights} (lights beyond the budget glow but do not light the room)
              </small>
            </div>
          )}
        </div>
      )}
      <div className="cons-help">
        <BoundKey action="move" /> pan · <BoundKey action="tactical" />/<BoundKey action="use" /> orbit · wheel zoom · <kbd>LMB</kbd> place/select · <kbd>RMB</kbd> cancel · <kbd>R</kbd> rotate · <kbd>+</kbd>/<kbd>−</kbd> scale · <kbd>Del</kbd> remove · <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> undo/redo
      </div>
    </div>
  );
}

function PieceCard({ p, active, onPick, lock, owned }: { p: PieceDef; active: boolean; onPick: () => void; lock: { unlocked: boolean; how: string }; owned: number }) {
  return (
    <button className={`cons-item ${active ? 'on' : ''} ${lock.unlocked ? '' : 'locked'}`} data-testid={`piece-${p.id}`} onClick={onPick} title={p.blurb}>
      <b>{p.name}</b>
      <small>{!lock.unlocked ? `LOCKED · ${lock.how}` : p.owned ? `owned ×${owned}` : costText(p)}</small>
    </button>
  );
}
